/* Bounded Drum Rack mono mixer. No allocation, IO, locks, or retained pointers.
 * ctypes supplies at most 32 slot states, immutable float32 sample addresses,
 * and a preallocated <=128-frame double scratch buffer. */
#include <stdint.h>
#include <stddef.h>

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

void drum_mix(DrumVoice *voices, int count, double *out, int frames,
              int attack, int fade) {
    if (count < 0 || count > 32 || frames < 0 || frames > 128 || attack < 1 || fade < 1)
        return;
    for (int frame = 0; frame < frames; ++frame) out[frame] = 0.0;
    for (int slot = 0; slot < count; ++slot) {
        DrumVoice *v = &voices[slot];
        if (!v->data && v->old_remaining <= 0) {
            v->last = 0.0;
            continue;
        }
        for (int frame = 0; frame < frames; ++frame) {
            double mixed = 0.0;
            if (v->data) {
                mixed = value(v->data, v->frames, v->pos, v->age, v->gain, attack);
                if (v->remaining >= 0) {
                    mixed *= (double)v->remaining / (double)fade;
                    --v->remaining;
                }
                v->pos += v->step;
                ++v->age;
                if (v->pos >= v->frames || v->remaining == 0) v->data = NULL;
            }
            if (v->old_remaining > 0) {
                double old = v->old_data
                    ? value(v->old_data, v->old_frames, v->old_pos, v->old_age, v->old_gain, attack)
                    : v->old_scalar;
                mixed += old * (double)v->old_remaining / (double)fade;
                if (v->old_data) {
                    v->old_pos += v->old_step;
                    ++v->old_age;
                    if (v->old_pos >= v->old_frames) v->old_remaining = 1;
                }
                --v->old_remaining;
                if (v->old_remaining <= 0) v->old_data = NULL;
            }
            out[frame] += mixed;
            v->last = mixed;
            if (!v->data && v->old_remaining <= 0) {
                if (frame + 1 < frames) v->last = 0.0;
                break;
            }
        }
    }
}
