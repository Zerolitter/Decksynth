/* Sampler track voices (15 Nov): one sample played across the keys, mono or stereo (27 Nov).
 * A stereo sample is its mid (the mono mix every other part uses) plus a side channel (p->side):
 * left = mid + side, right = mid - side. The side runs through the same envelope and its own filter state.
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
    double b1, b2, b3, ic3, ic4, amul;    /* 24 dB low-pass second stage; amul scales the attack (velocity, 25 Nov) */
    double sc1, sc2, sc3, sc4;            /* the side channel's filter state (stereo samples, 27 Nov) */
    int64_t fade_left, fade_len, age, stamp, start, end, loop_start, loop_end, xfade;
    int32_t active, stage, dir, looped;   /* looped: the voice has gone round its loop at least once (27 Nov) */
} SamplerVoice;

typedef struct {
    const float *data;
    int64_t frames, start, end, loop_start, loop_end, xfade, edge;
    int32_t mode, filter;
    double attack, decay, sustain;
    const float *side;                    /* stereo: the side channel, or NULL for a mono sample */
    double fade_in, fade_out;             /* frames of the sample faded at the start and end of what a key plays (0: off) */
} SamplerParams;

size_t sampler_voice_size(void) { return sizeof(SamplerVoice); }
size_t sampler_params_size(void) { return sizeof(SamplerParams); }

/* 4-point cubic Hermite inside the voice's [start, end); silence outside. */
static double at(const float *data, const SamplerParams *p, const SamplerVoice *v, int64_t i) {
    return (i >= v->start && i < v->end && i < p->frames) ? (double)data[i] : 0.0;
}

static double interp_of(const float *data, const SamplerParams *p, const SamplerVoice *v, double pos) {
    int64_t i = (int64_t)pos;
    if (pos < 0.0) i = -1;
    double t = pos - (double)i;
    double xm = at(data, p, v, i - 1), x0 = at(data, p, v, i), x1 = at(data, p, v, i + 1), x2 = at(data, p, v, i + 2);
    double c1 = 0.5 * (x1 - xm);
    double c2 = xm - 2.5 * x0 + 2.0 * x1 - 0.5 * x2;
    double c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
    return ((c3 * t + c2) * t + c1) * t + x0;
}

static double interp(const SamplerParams *p, const SamplerVoice *v, double pos) { return interp_of(p->data, p, v, pos); }

/* The voice's filter, one sample. 1 low-pass, 2 band-pass, 3 high-pass (12 dB), 4 low-pass 24 dB:
 * the 12 dB low-pass (a1..a3) into a second one (b1..b3) on its own state. */
static inline double filter_on(const SamplerVoice *v, int filter, double value, double *ic1, double *ic2, double *ic3, double *ic4) {
    double v3 = value - *ic2;
    double v1 = v->a1 * *ic1 + v->a2 * v3;
    double v2 = *ic2 + v->a2 * *ic1 + v->a3 * v3;
    *ic1 = 2.0 * v1 - *ic1;
    *ic2 = 2.0 * v2 - *ic2;
    if (filter == 4) {
        double w3 = v2 - *ic4;
        double w1 = v->b1 * *ic3 + v->b2 * w3;
        double w2 = *ic4 + v->b2 * *ic3 + v->b3 * w3;
        *ic3 = 2.0 * w1 - *ic3;
        *ic4 = 2.0 * w2 - *ic4;
        return w2;
    }
    return filter == 1 ? v2 : filter == 2 ? v1 : value - v->k * v1 - v2;
}

static inline double voice_filter(SamplerVoice *v, int filter, double value) {
    return filter_on(v, filter, value, &v->ic1, &v->ic2, &v->ic3, &v->ic4);
}

static inline double side_filter(SamplerVoice *v, int filter, double value) {
    return filter_on(v, filter, value, &v->sc1, &v->sc2, &v->sc3, &v->sc4);
}

/* Fade in and Fade out (27 Nov): straight fades over the first and last frames of what the key plays (its trimmed
 * sample or its slice), in the playing direction, like the Drum Rack's. A looping voice fades in on its first
 * pass only, and never reaches its end. */
static inline double fades(const SamplerParams *p, const SamplerVoice *v, double pos, int looping) {
    double g = 1.0;
    if (p->fade_in > 0.0 && !(looping && v->looped)) {
        double d = v->dir > 0 ? pos - (double)v->start : (double)v->end - pos;
        if (d < p->fade_in) g = d > 0.0 ? d / p->fade_in : 0.0;
    }
    if (p->fade_out > 0.0 && !looping) {
        double d = v->dir > 0 ? (double)v->end - pos : pos - (double)v->start + 1.0;
        if (d < p->fade_out) g *= d > 0.0 ? d / p->fade_out : 0.0;
    }
    return g;
}

/* Every active voice, added into out (mono) or, for a stereo sample, into out and right. `stereo` is a
 * constant at each call, so the mono path stays as it was. */
static inline void mix_voices(SamplerVoice *voices, int count, const SamplerParams *p, double *out, double *right,
                              int frames, int stereo) {
    int faded = p->fade_in > 0.0 || p->fade_out > 0.0;
    for (int slot = 0; slot < count; ++slot) {
        SamplerVoice *v = &voices[slot];
        if (!v->active) continue;
        int64_t span = v->loop_end - v->loop_start;
        int looping = p->mode == 2 && span > 1;
        for (int f = 0; f < frames; ++f) {
            double value = interp(p, v, v->pos), side = 0.0;
            if (stereo) side = interp_of(p->side, p, v, v->pos);
            if (looping && v->dir > 0 && v->xfade > 0 && v->pos >= (double)(v->loop_end - v->xfade)) {
                double t = (v->pos - (double)(v->loop_end - v->xfade)) / (double)v->xfade;
                value = value * (1.0 - t) + interp(p, v, v->pos - (double)span) * t;
                if (stereo) side = side * (1.0 - t) + interp_of(p->side, p, v, v->pos - (double)span) * t;
            }
            if (!looping) {
                double edge = (v->dir > 0 ? (double)v->end - v->pos : v->pos - (double)v->start + 1.0) / (double)p->edge;
                if (edge < 1.0) { double e = edge > 0.0 ? edge : 0.0; value *= e; if (stereo) side *= e; }
            }
            if (faded) { double g = fades(p, v, v->pos, looping); value *= g; if (stereo) side *= g; }
            if (p->filter > 0) {
                value = voice_filter(v, p->filter, value);
                if (stereo) side = side_filter(v, p->filter, side);
            }
            if (v->stage == 0) {
                v->env += p->attack * v->amul;
                if (v->env >= 1.0) { v->env = 1.0; v->stage = 1; }
            } else if (v->stage == 1) {
                v->env -= p->decay;
                if (v->env <= p->sustain) { v->env = p->sustain; v->stage = 2; }
            } else if (v->stage == 3) {
                v->env -= v->rel;
                if (v->env <= 0.0) { v->env = 0.0; v->active = 0; }
            }
            double level = v->env * v->gain;
            value *= level;
            if (stereo) side *= level;
            if (v->fade_left >= 0) {
                double k = (double)v->fade_left / (double)v->fade_len;
                value *= k;
                if (stereo) side *= k;
                if (--v->fade_left < 0) v->active = 0;
            }
            if (stereo) { out[f] += value + side; right[f] += value - side; }
            else out[f] += value;
            if (v->glide != 0.0) {
                v->step += v->glide;
                if ((v->glide > 0.0 && v->step >= v->target) || (v->glide < 0.0 && v->step <= v->target)) {
                    v->step = v->target; v->glide = 0.0;
                }
            }
            v->pos += v->dir > 0 ? v->step * v->pmul : -(v->step * v->pmul); ++v->age;
            if (looping) {
                if (v->dir > 0) { if (v->pos >= (double)v->loop_end) { v->pos -= (double)span; v->looped = 1; } }
                else if (v->pos < (double)v->loop_start) { v->pos += (double)span; v->looped = 1; }
            } else if (v->dir > 0 ? v->pos >= (double)v->end : v->pos < (double)v->start) v->active = 0;
            if (!v->active) break;
        }
    }
}

/* Adds `frames` samples of every active voice into out: mono, or left in out and right in `right` when the
 * sample is stereo (p->side) and right is given. A stereo sample with no right buffer plays its mid.
 * Modes: 0 one shot, 1 hold, 2 loop. Filter: 0 off, 1 low-pass, 2 band-pass, 3 high-pass, 4 low-pass 24 dB. */
void sampler_mix(SamplerVoice *voices, int count, const SamplerParams *p, double *out, double *right, int frames) { ds_ftz();
    if (!p->data || count < 0 || count > 64 || frames < 0 || frames > 4096) return;
    if (p->side && right) mix_voices(voices, count, p, out, right, frames, 1);
    else mix_voices(voices, count, p, out, NULL, frames, 0);
}

/* ---- Grain mode (24 Nov) ----------------------------------------------------------------------
 * Each held key is a "cloud": many short overlapping grains read from the voice's region around a
 * read point (Position plus how far Scan has moved it). The cloud then goes through the same
 * filter, amp envelope and steal fade as a normal voice. Grains start on the exact frame.
 * Window shapes and the pitch steps of Spread (already snapped to the scale) come from Python as
 * tables, and random numbers from a small xorshift per cloud, so this part needs no libm either.
 * The Python fallback (sampler.mix_grains_python) runs the same arithmetic in the same order. */
#define GRAIN_WINDOW 1024

typedef struct {
    double pos, step, amp, wpos, winc;
    int64_t left, delay;
    int32_t active, voice, pad0, pad1;
} SamplerGrain;

typedef struct {
    double next, offset;
    uint32_t rng, flags;                  /* flags: 1 every grain backwards (a reversed slice), 2 gate closed */
} SamplerCloud;

typedef struct {
    const double *window;                 /* GRAIN_WINDOW + 1 points */
    double position, size, interval, spray, scan, jitter, size_rnd, amp_rnd, reverse, level;
    double ratio[25];                     /* pitch ratio for a spread of -12..12 semitones */
    int32_t spread, grains;
} SamplerGrainParams;

size_t sampler_grain_size(void) { return sizeof(SamplerGrain); }
size_t sampler_cloud_size(void) { return sizeof(SamplerCloud); }
size_t sampler_grain_params_size(void) { return sizeof(SamplerGrainParams); }

static double grain_rnd(SamplerCloud *c) {
    uint32_t x = c->rng;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    c->rng = x;
    return (double)(x >> 8) * (1.0 / 16777216.0);
}

/* A new grain for voice `slot`, starting `at` frames into this block. Returns the next gap in frames. */
static double grain_spawn(const SamplerVoice *v, SamplerCloud *c, const SamplerGrainParams *g, SamplerGrain *grains,
                          int slot, int at) {
    double u1 = grain_rnd(c), u2 = grain_rnd(c), u3 = grain_rnd(c), u4 = grain_rnd(c), u5 = grain_rnd(c), u6 = grain_rnd(c);
    double zone = (double)(v->end - v->start);
    double o = g->position * zone + c->offset;
    while (o >= zone) o -= zone;
    while (o < 0.0) o += zone;
    double centre = (double)v->start + o + g->spray * (2.0 * u1 - 1.0) * 0.5 * zone;
    double len = g->size * (1.0 + g->size_rnd * (1.75 * u2 - 0.75));
    if (len < 16.0) len = 16.0;
    int64_t frames = (int64_t)len;
    int k = 0;
    if (g->spread > 0) {
        k = (int)(u3 * (double)(2 * g->spread + 1)) - g->spread;
        if (k > g->spread) k = g->spread;
    }
    double step = v->step * v->pmul * g->ratio[k + 12];
    if ((u4 < g->reverse) != ((c->flags & 1u) != 0u)) step = -step;
    /* The whole grain stays inside the region (25 Nov): a grain that ran past the start or end read
     * silence there and was cut off mid-fade, which popped. Too long for the room: it gets shorter. */
    double lo = (double)v->start + 1.0, hi = (double)v->end - 3.0, speed = step < 0.0 ? -step : step;
    double room = hi - lo, span = (double)frames * speed;
    if (span > room) { frames = speed > 0.0 ? (int64_t)(room / speed) : 0; span = (double)frames * speed; }
    if (centre - 0.5 * span < lo) centre = lo + 0.5 * span;
    if (centre + 0.5 * span > hi) centre = hi - 0.5 * span;
    double gap = g->interval * (1.0 + g->jitter * (2.0 * u6 - 1.0));
    if (gap < 1.0) gap = 1.0;
    if ((c->flags & 2u) || frames < 2) return gap;
    for (int i = 0; i < g->grains; ++i) {
        SamplerGrain *gr = &grains[i];
        if (gr->active) continue;
        gr->pos = centre - 0.5 * (double)frames * step;
        gr->step = step;
        gr->amp = g->level * (1.0 - g->amp_rnd * u5);
        gr->wpos = 0.0;
        gr->winc = (double)GRAIN_WINDOW / (double)frames;
        gr->left = frames;
        gr->delay = at;
        gr->voice = slot;
        gr->active = 1;
        break;
    }
    return gap;
}

/* Grains into out (mono), or left into out and right into `right` for a stereo sample (p->side), like sampler_mix. */
static inline void grain_voices(SamplerVoice *voices, SamplerCloud *clouds, int count, const SamplerParams *p,
                                const SamplerGrainParams *g, SamplerGrain *grains, double *out, double *right, int frames, int stereo) {
    double buf[4096], sbuf[4096];
    for (int slot = 0; slot < count; ++slot) {
        SamplerVoice *v = &voices[slot];
        if (!v->active) continue;
        SamplerCloud *c = &clouds[slot];
        double zone = (double)(v->end - v->start);
        if (zone < 2.0) { v->active = 0; continue; }
        double t = c->next;
        while (t < (double)frames) t += grain_spawn(v, c, g, grains, slot, (int)t);
        c->next = t - (double)frames;
        c->offset += g->scan * (double)frames;
        while (c->offset >= zone) c->offset -= zone;
        while (c->offset < 0.0) c->offset += zone;
        for (int f = 0; f < frames; ++f) buf[f] = 0.0;
        if (stereo) for (int f = 0; f < frames; ++f) sbuf[f] = 0.0;
        for (int i = 0; i < g->grains; ++i) {
            SamplerGrain *gr = &grains[i];
            if (!gr->active || gr->voice != slot) continue;
            for (int64_t f = gr->delay; f < frames && gr->left > 0; ++f) {
                int w = (int)gr->wpos;
                double frac = gr->wpos - (double)w;
                double shape = g->window[w] + (g->window[w + 1] - g->window[w]) * frac;
                buf[f] += interp(p, v, gr->pos) * shape * gr->amp;
                if (stereo) sbuf[f] += interp_of(p->side, p, v, gr->pos) * shape * gr->amp;
                gr->pos += gr->step; gr->wpos += gr->winc; --gr->left;
            }
            gr->delay = 0;
            if (gr->left <= 0) gr->active = 0;
        }
        for (int f = 0; f < frames; ++f) {
            double value = buf[f], side = stereo ? sbuf[f] : 0.0;
            if (p->filter > 0) {
                value = voice_filter(v, p->filter, value);
                if (stereo) side = side_filter(v, p->filter, side);
            }
            if (v->stage == 0) {
                v->env += p->attack * v->amul;
                if (v->env >= 1.0) { v->env = 1.0; v->stage = 1; }
            } else if (v->stage == 1) {
                v->env -= p->decay;
                if (v->env <= p->sustain) { v->env = p->sustain; v->stage = 2; }
            } else if (v->stage == 3) {
                v->env -= v->rel;
                if (v->env <= 0.0) { v->env = 0.0; v->active = 0; }
            }
            double level = v->env * v->gain;
            value *= level;
            if (stereo) side *= level;
            if (v->fade_left >= 0) {
                double k = (double)v->fade_left / (double)v->fade_len;
                value *= k;
                if (stereo) side *= k;
                if (--v->fade_left < 0) v->active = 0;
            }
            if (stereo) { out[f] += value + side; right[f] += value - side; }
            else out[f] += value;
            if (v->glide != 0.0) {
                v->step += v->glide;
                if ((v->glide > 0.0 && v->step >= v->target) || (v->glide < 0.0 && v->step <= v->target)) {
                    v->step = v->target; v->glide = 0.0;
                }
            }
            ++v->age;
            if (!v->active) break;
        }
        v->pos = (double)v->start + c->offset;
        if (!v->active)
            for (int i = 0; i < g->grains; ++i) if (grains[i].voice == slot) grains[i].active = 0;
    }
}

void sampler_grain_mix(SamplerVoice *voices, SamplerCloud *clouds, int count, const SamplerParams *p,
                       const SamplerGrainParams *g, SamplerGrain *grains, double *out, double *right, int frames) { ds_ftz();
    if (!p->data || !g->window || count < 0 || count > 64 || frames < 0 || frames > 4096 || g->grains < 0 || g->grains > 1024) return;
    if (p->side && right) grain_voices(voices, clouds, count, p, g, grains, out, right, frames, 1);
    else grain_voices(voices, clouds, count, p, g, grains, out, NULL, frames, 0);
}
