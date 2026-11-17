/* Sampler track voices (15 Nov): one mono sample played across the keys.
 * Each voice plays its own region (the whole trimmed sample, or one slice), forwards or reversed,
 * through an optional state-variable filter. The filter coefficients and the pitch-envelope factor
 * are set per voice by Python between blocks, so this file needs no libm.
 * No allocation, IO, locks or retained pointers. The Python fallback in sampler.py runs the same
 * arithmetic in the same order. */
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
    double pos, step, target, glide, env, rel, gain, pmul, a1, a2, a3, k, ic1, ic2;
    int64_t fade_left, fade_len, age, stamp, start, end, loop_start, loop_end, xfade;
    int32_t active, stage, dir, pad;
} SamplerVoice;

typedef struct {
    const float *data;
    int64_t frames, start, end, loop_start, loop_end, xfade, edge;
    int32_t mode, filter;
    double attack, decay, sustain;
} SamplerParams;

size_t sampler_voice_size(void) { return sizeof(SamplerVoice); }
size_t sampler_params_size(void) { return sizeof(SamplerParams); }

/* 4-point cubic Hermite inside the voice's [start, end); silence outside. */
static double at(const SamplerParams *p, const SamplerVoice *v, int64_t i) {
    return (i >= v->start && i < v->end && i < p->frames) ? (double)p->data[i] : 0.0;
}

static double interp(const SamplerParams *p, const SamplerVoice *v, double pos) {
    int64_t i = (int64_t)pos;
    if (pos < 0.0) i = -1;
    double t = pos - (double)i;
    double xm = at(p, v, i - 1), x0 = at(p, v, i), x1 = at(p, v, i + 1), x2 = at(p, v, i + 2);
    double c1 = 0.5 * (x1 - xm);
    double c2 = xm - 2.5 * x0 + 2.0 * x1 - 0.5 * x2;
    double c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
    return ((c3 * t + c2) * t + c1) * t + x0;
}

/* Adds `frames` samples of every active voice into out (mono).
 * Modes: 0 one shot, 1 hold, 2 loop. Filter: 0 off, 1 low-pass, 2 band-pass, 3 high-pass. */
void sampler_mix(SamplerVoice *voices, int count, const SamplerParams *p, double *out, int frames) { ds_ftz();
    if (!p->data || count < 0 || count > 64 || frames < 0 || frames > 4096) return;
    for (int slot = 0; slot < count; ++slot) {
        SamplerVoice *v = &voices[slot];
        if (!v->active) continue;
        int64_t span = v->loop_end - v->loop_start;
        int looping = p->mode == 2 && span > 1;
        for (int f = 0; f < frames; ++f) {
            double value = interp(p, v, v->pos);
            if (looping && v->dir > 0 && v->xfade > 0 && v->pos >= (double)(v->loop_end - v->xfade)) {
                double t = (v->pos - (double)(v->loop_end - v->xfade)) / (double)v->xfade;
                value = value * (1.0 - t) + interp(p, v, v->pos - (double)span) * t;
            }
            if (!looping) {
                double edge = (v->dir > 0 ? (double)v->end - v->pos : v->pos - (double)v->start + 1.0) / (double)p->edge;
                if (edge < 1.0) value *= edge > 0.0 ? edge : 0.0;
            }
            if (p->filter > 0) {
                double v3 = value - v->ic2;
                double v1 = v->a1 * v->ic1 + v->a2 * v3;
                double v2 = v->ic2 + v->a2 * v->ic1 + v->a3 * v3;
                v->ic1 = 2.0 * v1 - v->ic1;
                v->ic2 = 2.0 * v2 - v->ic2;
                value = p->filter == 1 ? v2 : p->filter == 2 ? v1 : value - v->k * v1 - v2;
            }
            if (v->stage == 0) {
                v->env += p->attack;
                if (v->env >= 1.0) { v->env = 1.0; v->stage = 1; }
            } else if (v->stage == 1) {
                v->env -= p->decay;
                if (v->env <= p->sustain) { v->env = p->sustain; v->stage = 2; }
            } else if (v->stage == 3) {
                v->env -= v->rel;
                if (v->env <= 0.0) { v->env = 0.0; v->active = 0; }
            }
            value *= v->env * v->gain;
            if (v->fade_left >= 0) {
                value *= (double)v->fade_left / (double)v->fade_len;
                if (--v->fade_left < 0) v->active = 0;
            }
            out[f] += value;
            if (v->glide != 0.0) {
                v->step += v->glide;
                if ((v->glide > 0.0 && v->step >= v->target) || (v->glide < 0.0 && v->step <= v->target)) {
                    v->step = v->target; v->glide = 0.0;
                }
            }
            v->pos += v->dir > 0 ? v->step * v->pmul : -(v->step * v->pmul); ++v->age;
            if (looping) {
                if (v->dir > 0) { if (v->pos >= (double)v->loop_end) v->pos -= (double)span; }
                else if (v->pos < (double)v->loop_start) v->pos += (double)span;
            } else if (v->dir > 0 ? v->pos >= (double)v->end : v->pos < (double)v->start) v->active = 0;
            if (!v->active) break;
        }
    }
}
