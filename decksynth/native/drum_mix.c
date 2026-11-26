/* Bounded Drum Rack stereo mixer (per-pad pan gains, review 2026-11-15 round 2). No allocation, IO, locks, or retained pointers.
 * ctypes supplies at most 32 slot states, immutable float32 sample addresses,
 * and a preallocated <=128-frame double scratch buffer. */
#include <stdint.h>
#include <stddef.h>

/* Flush-to-zero / denormals-are-zero: a decaying reverb or filter tail never slows the CPU down. x86 only (the Deck). */
#if defined(__SSE__) || defined(__x86_64__)
#include <xmmintrin.h>
static inline void ds_ftz(void) { _mm_setcsr(_mm_getcsr() | 0x8040); }
#else
static inline void ds_ftz(void) {}
#endif

typedef struct {
    const float *data;
    int64_t frames;
    double pos, step, gain;
    int64_t age, remaining;
    const float *old_data;
    int64_t old_frames;
    double old_pos, old_step, old_gain;
    int64_t old_age, old_remaining;
    double old_scalar, last;
    double gl, gr, old_gl, old_gr;
} DrumVoice;

size_t drum_voice_size(void) { return sizeof(DrumVoice); }

static double value(const float *data, int64_t frames, double pos,
                    int64_t age, double gain, int attack) {
    int64_t index = (int64_t)pos;
    if (index >= frames) return 0.0;
    double fraction = pos - (double)index;
    double a = data[index];
    double b = index + 1 < frames ? data[index + 1] : 0.0;
    double pcm = a + (b - a) * fraction;
    double env = (double)age / (double)attack;
    if (env > 1.0) env = 1.0;
    double end = ((double)frames - pos) / (double)attack;
    if (end < env) env = end;
    if (env < 0.0) env = 0.0;
    return pcm * gain * env;
}

/* out holds 2*frames doubles: left in [0, frames), right in [frames, 2*frames). */
void drum_mix(DrumVoice *voices, int count, double *out, int frames,
              int attack, int fade) { ds_ftz();
    if (count < 0 || count > 32 || frames < 0 || frames > 128 || attack < 1 || fade < 1)
        return;
    double *right = out + frames;
    for (int frame = 0; frame < frames; ++frame) out[frame] = right[frame] = 0.0;
    for (int slot = 0; slot < count; ++slot) {
        DrumVoice *v = &voices[slot];
        if (!v->data && v->old_remaining <= 0) {
            v->last = 0.0;
            continue;
        }
        for (int frame = 0; frame < frames; ++frame) {
            double mixed = 0.0, left = 0.0, rgt = 0.0;
            if (v->data) {
                mixed = value(v->data, v->frames, v->pos, v->age, v->gain, attack);
                if (v->remaining >= 0) {
                    mixed *= (double)v->remaining / (double)fade;
                    --v->remaining;
                }
                v->pos += v->step;
                ++v->age;
                if (v->pos >= v->frames || v->remaining == 0) v->data = NULL;
                left = mixed * v->gl; rgt = mixed * v->gr;
            }
            if (v->old_remaining > 0) {
                double old = v->old_data
                    ? value(v->old_data, v->old_frames, v->old_pos, v->old_age, v->old_gain, attack)
                    : v->old_scalar;
                old *= (double)v->old_remaining / (double)fade;
                mixed += old; left += old * v->old_gl; rgt += old * v->old_gr;
                if (v->old_data) {
                    v->old_pos += v->old_step;
                    ++v->old_age;
                    if (v->old_pos >= v->old_frames) v->old_remaining = 1;
                }
                --v->old_remaining;
                if (v->old_remaining <= 0) v->old_data = NULL;
            }
            out[frame] += left; right[frame] += rgt;
            v->last = mixed;
            if (!v->data && v->old_remaining <= 0) {
                if (frame + 1 < frames) v->last = 0.0;
                break;
            }
        }
    }
}

/* ---- Per-pad shaping (non-destructive copy, rendered off the audio path) ----
 * Runs in place on the trimmed/reversed float copy. ctypes releases the GIL for the call, so the
 * audio thread never waits on it. p[] is in sample frames / Hz of the copy (tune already applied):
 *  0 attack  1 hold  2 decay  3 fade_in  4 fade_out  5 cut_head  6 cut_tail  7 edge  8 gate
 *  9 low_cut 10 high_cut 11 eq_low_db 12 eq_mid_db 13 eq_freq 14 eq_high_db
 * 15 comp_threshold_db 16 comp_ratio 17 comp_attack 18 comp_release 19 comp_makeup_db 20 drive
 * 21 rate 22 low_shelf_hz 23 high_shelf_hz */
#include <math.h>

typedef struct { double b0, b1, b2, a1, a2; } Biquad;

static void biquad_run(float *d, int64_t n, Biquad q) {
    double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (int64_t i = 0; i < n; ++i) {
        double x = d[i], y = q.b0 * x + q.b1 * x1 + q.b2 * x2 - q.a1 * y1 - q.a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = (float)y;
    }
}

/* RBJ cookbook. kind: 0 low-pass, 1 high-pass, 2 peak, 3 low shelf, 4 high shelf. */
Biquad drum_biquad(int kind, double freq, double rate, double q, double db) {
    double f = freq < rate * .45 ? freq : rate * .45;
    double w = 2 * 3.14159265358979323846 * f / rate, cw = cos(w), sw = sin(w), A = pow(10., db / 40.);
    double alpha = sw / (2 * q), b0, b1, b2, a0, a1, a2;
    if (kind == 0) { b0 = b2 = (1 - cw) / 2; b1 = 1 - cw; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
    else if (kind == 1) { b0 = b2 = (1 + cw) / 2; b1 = -(1 + cw); a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
    else if (kind == 2) { b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; }
    else {
        double s = 2 * sqrt(A) * (sw / (2 * .7071)), sign = kind == 3 ? -1 : 1;
        b0 = A * ((A + 1) + sign * (A - 1) * cw + s);
        b1 = -2 * sign * A * ((A - 1) + sign * (A + 1) * cw);
        b2 = A * ((A + 1) + sign * (A - 1) * cw - s);
        a0 = (A + 1) - sign * (A - 1) * cw + s;
        a1 = 2 * sign * ((A - 1) - sign * (A + 1) * cw);
        a2 = (A + 1) - sign * (A - 1) * cw - s;
    }
    Biquad out = { b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0 };
    return out;
}

void drum_shape(float *d, int64_t n, const double *p) { ds_ftz();
    double attack = p[0], hold = p[1], decay = p[2], fi = p[3], fo = p[4], rate = p[21];
    double k = decay > 0 ? -6.907755 / decay : 0.;  /* -60 dB at the end of the decay */
    if (attack >= 1 || decay > 0 || p[8] > 0)
        for (int64_t i = 0; i < n; ++i) {
            double g = 1;
            if (i < attack) g = i / attack;
            else if (decay > 0 && i >= attack + hold) g = exp(k * (i - attack - hold));
            d[i] *= (float)g;
        }
    for (int64_t i = 0; i < n && i < (int64_t)fi; ++i) d[i] *= (float)(i / fi);
    for (int64_t i = 0; i < n && i < (int64_t)fo; ++i) d[n - 1 - i] *= (float)(i / fo);
    int64_t edge = (int64_t)p[7];
    for (int64_t i = 0; i < edge && i < n; ++i) {
        double g = (double)i / edge;
        if (p[5] > 0) d[i] *= (float)g;
        if (p[6] > 0) d[n - 1 - i] *= (float)g;
    }
    if (p[9] > 20.5) biquad_run(d, n, drum_biquad(1, p[9], rate, .7071, 0));
    if (p[10] < 19999.5) biquad_run(d, n, drum_biquad(0, p[10], rate, .7071, 0));
    if (p[11] != 0) biquad_run(d, n, drum_biquad(3, p[22], rate, .7071, p[11]));
    if (p[12] != 0) biquad_run(d, n, drum_biquad(2, p[13], rate, 1., p[12]));
    if (p[14] != 0) biquad_run(d, n, drum_biquad(4, p[23], rate, .7071, p[14]));
    if (p[16] > 1) {
        double thr = p[15], ratio = p[16], makeup = pow(10., p[19] / 20.);
        double ca = exp(-1. / (p[17] > 1 ? p[17] : 1)), cr = exp(-1. / (p[18] > 1 ? p[18] : 1)), gr = 0;
        for (int64_t i = 0; i < n; ++i) {
            double level = fabs(d[i]), db = level > 1e-9 ? 20 * log10(level) : -180;
            double target = db > thr ? (db - thr) * (1 - 1 / ratio) : 0;  /* dB of reduction */
            gr = target > gr ? ca * gr + (1 - ca) * target : cr * gr + (1 - cr) * target;
            d[i] = (float)(d[i] * pow(10., -gr / 20.) * makeup);
        }
    }
    if (p[20] > 0) {
        double g = 1 + p[20] * 9, norm = 1 / tanh(g);
        for (int64_t i = 0; i < n; ++i) d[i] = (float)(tanh(d[i] * g) * norm);
    }
}

/* WAV decoding for the sample loader (samples.py _decode and _resample, the same arithmetic, so a sample loads
 * bit for bit as before). It runs on the loader thread with Python's lock released (CDLL), so a kit loading at
 * startup never holds up the audio. No flush-to-zero here: the loader thread is a plain Python thread.
 * drum_decode: `count` signed little-endian PCM values (16, 24 or 32 bit) from pcm+offset, one or two channels,
 * to mono float32 (two channels: their mean). */
void drum_decode(const unsigned char *pcm, int64_t offset, int64_t count, int channels, int bits, float *out) {
    const unsigned char *p = pcm + offset;
    int width = bits / 8;
    double scale = 1.0 / (double)((int64_t)1 << ((bits != 24 ? bits : 32) - 1));
    double half = .5 * scale;
    int64_t frames = channels == 2 ? count / 2 : count;
    for (int64_t i = 0; i < frames; i++) {
        int64_t v[2] = {0, 0};
        for (int c = 0; c < channels; c++) {
            const unsigned char *b = p + (i * channels + c) * width;
            if (bits == 16) v[c] = (int16_t)(uint16_t)(b[0] | (b[1] << 8));
            else if (bits == 24) v[c] = (int32_t)(((uint32_t)b[0] << 8) | ((uint32_t)b[1] << 16) | ((uint32_t)b[2] << 24));
            else v[c] = (int32_t)((uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24));
        }
        out[i] = channels == 2 ? (float)((double)(v[0] + v[1]) * half) : (float)((double)v[0] * scale);
    }
}

/* drum_resample: linear interpolation from source_rate to output_rate, `frames` output samples. */
void drum_resample(const float *in, int64_t count, int64_t source_rate, int64_t output_rate, float *out, int64_t frames) {
    int64_t last = count - 1;
    for (int64_t i = 0; i < frames; i++) {
        int64_t t = i * source_rate, left = t / output_rate, fraction = t % output_rate;
        if (left >= last) { out[i] = in[last]; continue; }
        double a = in[left];
        out[i] = (float)(a + ((double)in[left + 1] - a) * ((double)fraction / (double)output_rate));
    }
}
