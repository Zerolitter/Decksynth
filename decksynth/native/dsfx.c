/* DeckSynth FX chain: 26 effect modules (22 mono, 4 true-stereo ambient ones) processed in blocks.
 * Written for DeckSynth; module set follows the user's PrismFX reference,
 * all DSP here is original and generic (SVF, Schroeder/Freeverb-style reverb, etc.).
 * Build: gcc -O2 -fPIC -shared -o libdsfx.so dsfx.c -lm
 */
#include <math.h>
#include <stdlib.h>
#include <string.h>

/* Flush-to-zero / denormals-are-zero: a decaying reverb or filter tail never slows the CPU down. x86 only (the Deck). */
#if defined(__SSE__) || defined(__x86_64__)
#include <xmmintrin.h>
static inline void ds_ftz(void) { _mm_setcsr(_mm_getcsr() | 0x8040); }
#else
static inline void ds_ftz(void) {}
#endif

#define NMOD 26
#define NPAR 8
#define PI 3.14159265358979323846

enum { STUTTER, FILTER, OVERDRIVE, BITCRUSH, VOLUME, PHASER, FLANGER, RINGMOD, DELAY, REVERB, TIMEFX,
       CHORUS, COMP, EQ, AUTOWAH, RESONATOR, AUDIOGATE, CLOUD, PITCH, AUTOTUNE, DUCK, VOCODER,
       TAPE, SMEAR, SHIMMER, SPACE };

#define DLY_LEN (48000*3)
#define FLG_LEN 2048
#define STU_LEN (48000*2)
#define TIM_LEN 8192
static const int COMB_LEN[4] = {1557, 1617, 1491, 1422};
static const int AP_LEN[2] = {556, 441};
#define PRE_LEN 9600
#define CHO_LEN 4096
#define RES_STR 6
#define RES_LEN 4096
#define PS_LEN 8192
#define AT_LEN 1024
#define VOC_B 16
#define SH_FADE 256
#define SH_CORR 192
#define SH_SEARCH 300
/* pitch shifter: one read head plays; near the end of its range a second head starts where the
 * sound looks the same (best correlation) and the two crossfade, so the splice keeps the waveform */
typedef struct { float buf[PS_LEN]; int w; double d[2]; int act, fade, init; } Shifter;

/* Ambient effects (25 Nov): Tape, Smear, Shimmer and Space. They are stereo in, stereo out, so their state
 * lives in the left channel's FxTrack only (the mono chain runs them on two copies and averages).
 * Every buffer length is a power of two: reads wrap with a mask. */
#define TP_LEN 2048
typedef struct { float buf[2][TP_LEN]; int w, init, rnd_n; unsigned seed;
    double ph1, ph2, phf, phf2, rnd, rnd_t, dprev, env, lp[2][2], hpx[2], hpy[2]; } TapeState;
#define SM_N 8
#define SM_LEN 4096
typedef struct { float buf[2][SM_N][SM_LEN]; int w, init; double ph[2][SM_N], d[2][SM_N], lp[2]; } SmearState;
#define FDN 8
#define DIF_LEN 1024
#define SHM_LEN 8192
#define SHF_LEN 4096
#define SHF_WIN 2048.0
typedef struct { float line[FDN][SHM_LEN], sh[FDN][SHF_LEN], dif[2][2][DIF_LEN]; int w;
    double shd, lp[FDN], dcx[2], dcy[2]; } ShimmerState;
#define SP_LEN 16384
#define SP_PRE 16384
typedef struct { float line[FDN][SP_LEN], pre[2][SP_PRE], dif[2][4][DIF_LEN]; int w, init;
    double ph[FDN], d[FDN], lp[FDN], frz, dcx[2], dcy[2]; } SpaceState;

typedef struct {
    double rate;
    double stereo_phase,stereo_width,haas_delay; float haas[2048]; int haas_w;
    float cloud[96000]; int cloud_w; double cloud_phase[4],cloud_lp,cloud_diff;
    /* stutter */
    float stu[STU_LEN]; int stu_w, stu_pos_in_cycle, stu_slice; double stu_r;
    /* filter (TPT SVF) */
    double f_ic1, f_ic2;
    /* bitcrusher */
    double bc_hold; double bc_phase;
    /* phaser */
    double ph_z[4], ph_lfo, ph_fb;
    /* flanger */
    float flg[FLG_LEN]; int flg_w; double flg_lfo;
    /* ring mod */
    double rm_phase;
    /* delay */
    float dly[DLY_LEN]; int dly_w;
    /* reverb */
    float pre[PRE_LEN]; int pre_w;
    float comb[4][1700]; int comb_w[4]; double comb_lp[4];
    float ap[2][600]; int ap_w[2];
    double rv_hp_x, rv_hp_y, rv_lp;
    /* time (2-tap varispeed) */
    float tim[TIM_LEN]; int tim_w; double tim_r;
    /* chorus */
    float cho[CHO_LEN]; int cho_w; double cho_lfo;
    /* compressor */
    double cmp_env, cmp_gr;
    /* 3-band EQ: three biquads, direct form 1 */
    double eq_x[3][2], eq_y[3][2];
    /* auto-wah: envelope follower into an SVF */
    double aw_env, aw_ic1, aw_ic2;
    /* resonator: tuned feedback combs ("sympathetic strings") */
    float res[RES_STR][RES_LEN]; int res_w; double res_lp[RES_STR];
    double res_f[RES_STR]; int res_n; double res_d[RES_STR];
    /* audio gate: position in beats (synced to the transport while it plays), smoothed gain */
    double g_beat, g_env; int g_init;
    /* click-free control: parameters glide inside each block, effects fade in and out when switched */
    double pcur[NMOD * NPAR]; int pinit; double onamt[NMOD];
    /* output levels per module, for UI graphs */
    double level[NMOD];
    int g_extended,g_hold; double g_phase,g_notelen;
    int g_events[256],g_event_count,g_event_index,g_offset;
    /* pitch shifter and auto-tune: two crossfaded read heads, as in Time */
    Shifter psh, ash;
    /* auto-tune pitch detection: input decimated by 4 into a ring, YIN every 256 decimated samples */
    float at_an[AT_LEN]; int at_an_w, at_dec_n, at_new; double at_dec_acc, at_ratio, at_target, at_note, at_heard;
    int at_mask, at_root;
    /* key inputs from another track, valid during one process call: [0] ducking, [1] vocoder */
    const double *key[2]; int key_n[2];
    double dk_env, dk_red;
    double vc_c[VOC_B][2], vc_m[VOC_B][4], vc_env[VOC_B], vc_cenv[VOC_B], vc_hp, vc_hpx;
    TapeState tp; SmearState sm; ShimmerState shm; SpaceState sp;
} FxTrack;

/* Parameters per module in the params array; Python refuses a library whose layout differs. */
int dsfx_npar(void) { return NPAR; }

FxTrack *dsfx_create(double rate) {
    FxTrack *t = calloc(1, sizeof(FxTrack));
    if (t) t->rate = rate;
    return t;
}
void dsfx_destroy(FxTrack *t) { free(t); }
void dsfx_reset(FxTrack *t) { double r = t->rate; int mask = t->at_mask, root = t->at_root;
    memset(t, 0, sizeof(FxTrack)); t->rate = r; t->at_mask = mask; t->at_root = root; }
void dsfx_levels(FxTrack *t, double *out) { memcpy(out, t->level, sizeof(t->level)); }
/* Gain reduction of the compressor in dB, for its meter. */
double dsfx_comp_gr(FxTrack *t) { return t->cmp_gr; }

static double clampd(double x, double lo, double hi) { return x < lo ? lo : x > hi ? hi : x; }
static double soft(double x) { return tanh(x); }

/* Key audio from another track for ducking (slot 0) and the vocoder (slot 1); NULL clears it. */
void dsfx_key(FxTrack *t, int slot, const double *key, int n) {
    if (slot < 0 || slot > 1) return;
    t->key[slot] = n > 0 ? key : NULL; t->key_n[slot] = n > 0 ? n : 0;
}
/* Project scale for auto-tune: bit k of mask = pitch class root+k is in the scale. */
void dsfx_scale(FxTrack *t, int mask, int root) { t->at_mask = mask & 4095; t->at_root = ((root % 12) + 12) % 12; }
/* Live readouts: out[0] auto-tune heard note (MIDI, 0 = none), out[1] its correction in cents,
 * out[2] ducking gain reduction in dB. */
void dsfx_readout(FxTrack *t, double *out) {
    out[0] = t->at_heard; out[1] = t->at_ratio > 0 ? 1200 * log2(t->at_ratio) : 0;
    out[2] = -20 * log10(fmax(1e-4, 1 - t->dk_red));
}

static void m_stutter(FxTrack *t, double *b, int n, const double *p, double bpm) {
    /* length 1..6: slice = 1/2^(L-1) beats; speed: replay rate 0.5..2; repeats 1..8 */
    int L = (int)clampd(round(p[0]), 1, 6), reps = (int)clampd(round(p[2]), 1, 8);
    double spb = t->rate * 60.0 / bpm;
    int slice = (int)clampd(spb / (double)(1 << (L - 1)), 64, STU_LEN - 1);
    double speed = 0.5 * pow(4.0, clampd(p[1], 0, 1)), mix = p[3];
    if (slice != t->stu_slice) { t->stu_slice = slice; t->stu_pos_in_cycle = 0; }
    int cycle = slice * (reps + 1);
    for (int i = 0; i < n; i++) {
        double x = b[i], y;
        int pos = t->stu_pos_in_cycle;
        if (pos < slice) { t->stu[pos] = (float)x; y = x; t->stu_r = 0; }
        else {
            int j = (int)t->stu_r; double fr = t->stu_r - j;
            int j2 = j + 1 >= slice ? 0 : j + 1;
            y = t->stu[j] * (1 - fr) + t->stu[j2] * fr;
            /* short fades at slice edges avoid clicks */
            int edge = (pos - slice) % slice; double g = 1;
            if (edge < 48) g = edge / 48.0; else if (slice - edge < 48) g = (slice - edge) / 48.0;
            y = y * g + x * (1 - g);
            t->stu_r += speed; while (t->stu_r >= slice) t->stu_r -= slice;
        }
        if (++t->stu_pos_in_cycle >= cycle) t->stu_pos_in_cycle = 0;
        b[i] = x * (1 - mix) + y * mix;
    }
}

static void m_filter(FxTrack *t, double *b, int n, const double *p) {
    int mode = (int)clampd(round(p[0]), 0, 2);
    double fc = 20.0 * pow(1000.0, clampd(p[1], 0, 1));
    if (fc > t->rate * 0.45) fc = t->rate * 0.45;
    double g = tan(PI * fc / t->rate), k = 2.0 - 1.9 * clampd(p[2], 0, 1), mix = p[3];
    double a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    for (int i = 0; i < n; i++) {
        double v0 = b[i], v3 = v0 - t->f_ic2;
        double v1 = a1 * t->f_ic1 + a2 * v3, v2 = t->f_ic2 + a2 * t->f_ic1 + a3 * v3;
        t->f_ic1 = 2 * v1 - t->f_ic1; t->f_ic2 = 2 * v2 - t->f_ic2;
        double y = mode == 0 ? v2 : mode == 1 ? v1 : v0 - k * v1 - v2;
        b[i] = v0 * (1 - mix) + y * mix;
    }
}

static void m_drive(double *b, int n, const double *p) {
    double d = 1 + clampd(p[0], 0, 1) * 24, norm = 1 / tanh(d), mix = p[1];
    for (int i = 0; i < n; i++) b[i] = b[i] * (1 - mix) + soft(b[i] * d) * norm * 0.6 * mix;
}

static void m_bitcrush(FxTrack *t, double *b, int n, const double *p) {
    double hold = 1 + clampd(p[0], 0, 1) * 39, levels = pow(2, clampd(round(p[1]), 2, 16) - 1), mix = p[2];
    for (int i = 0; i < n; i++) {
        t->bc_phase += 1;
        if (t->bc_phase >= hold) { t->bc_phase -= hold; t->bc_hold = round(b[i] * levels) / levels; }
        b[i] = b[i] * (1 - mix) + t->bc_hold * mix;
    }
}

static void m_volume(double *b, int n, const double *p) {
    double g = 1 + (clampd(p[0], 0, 1.5) - 1) * p[1];
    for (int i = 0; i < n; i++) b[i] *= g;
}

static void m_phaser(FxTrack *t, double *b, int n, const double *p) {
    double rate = 0.05 * pow(100.0, clampd(p[0], 0, 1)), depth = clampd(p[1], 0, 1), fb = clampd(p[2], -1, 1) * 0.85, mix = p[3];
    double inc = 2 * PI * rate / t->rate;
    for (int i = 0; i < n; i++) {
        double lfo = 0.5 + 0.5 * sin(t->ph_lfo); t->ph_lfo += inc; if (t->ph_lfo > 2 * PI) t->ph_lfo -= 2 * PI;
        double fc = 200 * pow(16.0, lfo * depth + (1 - depth) * 0.3);
        double tn = tan(PI * fc / t->rate), a = (tn - 1) / (tn + 1);
        double x = b[i] + fb * t->ph_fb, y = x;
        for (int s = 0; s < 4; s++) { double o = a * y + t->ph_z[s]; t->ph_z[s] = y - a * o; y = o; }
        t->ph_fb = y;
        b[i] = b[i] * (1 - mix * 0.5) + y * mix * 0.5;
    }
}

static void m_flanger(FxTrack *t, double *b, int n, const double *p) {
    double rate = 0.05 * pow(80.0, clampd(p[0], 0, 1)), depth = clampd(p[1], 0, 1), fb = clampd(p[2], -1, 1) * 0.9, mix = p[3];
    double inc = 2 * PI * rate / t->rate, base = 0.0008 * t->rate, sweep = 0.006 * t->rate * depth;
    for (int i = 0; i < n; i++) {
        double d = base + sweep * (0.5 + 0.5 * sin(t->flg_lfo)); t->flg_lfo += inc; if (t->flg_lfo > 2 * PI) t->flg_lfo -= 2 * PI;
        double rp = t->flg_w - d; while (rp < 0) rp += FLG_LEN;
        int j = (int)rp; double fr = rp - j; int j2 = (j + 1) % FLG_LEN;
        double del = t->flg[j] * (1 - fr) + t->flg[j2] * fr;
        t->flg[t->flg_w] = (float)clampd(b[i] + fb * del, -4, 4); t->flg_w = (t->flg_w + 1) % FLG_LEN;
        b[i] = b[i] + del * mix * 0.7;
    }
}

static void m_ringmod(FxTrack *t, double *b, int n, const double *p) {
    double f = 20 * pow(100.0, clampd(p[0], 0, 1)), drive = 1 + clampd(p[1], 0, 1) * 6, mix = p[2];
    double inc = 2 * PI * f / t->rate;
    for (int i = 0; i < n; i++) {
        double y = soft(b[i] * drive) / soft(drive) * sin(t->rm_phase);
        t->rm_phase += inc; if (t->rm_phase > 2 * PI) t->rm_phase -= 2 * PI;
        b[i] = b[i] * (1 - mix) + y * mix;
    }
}

static void m_delay(FxTrack *t, double *b, int n, const double *p, double bpm) {
    static const double BEATS[6] = {0.125, 0.25, 0.5, 0.75, 1.0, 2.0};
    int idx = (int)clampd(round(p[0]), 0, 5);
    int d = (int)clampd(BEATS[idx] * t->rate * 60.0 / bpm, 1, DLY_LEN - 1);
    double fb = clampd(p[1], 0, 0.95), mix = p[2];
    for (int i = 0; i < n; i++) {
        int r = t->dly_w - d; if (r < 0) r += DLY_LEN;
        double del = t->dly[r];
        t->dly[t->dly_w] = (float)(b[i] + fb * del); t->dly_w = (t->dly_w + 1) % DLY_LEN;
        b[i] = b[i] + del * mix;
    }
}

static void m_reverb(FxTrack *t, double *b, int n, const double *p) {
    int pd = (int)(clampd(p[0], 0, 1) * (PRE_LEN - 2)) + 1;
    double room = 0.7 + 0.28 * clampd(p[1], 0, 1);
    double hp = 0.995 - 0.15 * clampd(p[2], 0, 1);          /* lo cut on the wet signal */
    double damp = 0.05 + 0.6 * (1 - clampd(p[3], 0, 1));     /* hi cut inside the combs */
    double mix = p[4];
    for (int i = 0; i < n; i++) {
        t->pre[t->pre_w] = (float)b[i];
        int r = t->pre_w - pd; if (r < 0) r += PRE_LEN;
        double in = t->pre[r] * 0.25; t->pre_w = (t->pre_w + 1) % PRE_LEN;
        double acc = 0;
        for (int c = 0; c < 4; c++) {
            float *buf = t->comb[c]; int length=COMB_LEN[c]+(int)(t->stereo_width*9*(c+1)); int w = t->comb_w[c]%length;
            double o = buf[w];
            t->comb_lp[c] = o * (1 - damp) + t->comb_lp[c] * damp;
            buf[w] = (float)(in + t->comb_lp[c] * room);
            t->comb_w[c] = (w + 1) % length;
            acc += o;
        }
        for (int a = 0; a < 2; a++) {
            float *buf = t->ap[a]; int length=AP_LEN[a]+(int)(t->stereo_width*7*(a+1)); int w = t->ap_w[a]%length;
            double bo = buf[w], o = -acc + bo;
            buf[w] = (float)(acc + bo * 0.5);
            t->ap_w[a] = (w + 1) % length;
            acc = o;
        }
        double y = hp * (t->rv_hp_y + acc - t->rv_hp_x); t->rv_hp_x = acc; t->rv_hp_y = y;
        b[i] = b[i] * (1 - mix * 0.5) + y * mix;
    }
}

static void m_time(FxTrack *t, double *b, int n, const double *p) {
    /* two crossfaded read heads moving at `speed` relative to the write head: varispeed/pitch */
    double speed = clampd(p[0], 0.25, 2), mix = p[1];
    const double win = 2048;
    for (int i = 0; i < n; i++) {
        t->tim[t->tim_w] = (float)b[i];
        t->tim_r += 1 - speed; /* distance behind the writer grows/shrinks */
        while (t->tim_r < 0) t->tim_r += win;
        while (t->tim_r >= win) t->tim_r -= win;
        double y = 0;
        for (int h = 0; h < 2; h++) {
            double dist = t->tim_r + h * win / 2;
            if (dist >= win) dist -= win;
            dist += 4;
            double rp = t->tim_w - dist; while (rp < 0) rp += TIM_LEN;
            int j = (int)rp; double fr = rp - j; int j2 = (j + 1) % TIM_LEN;
            double s = t->tim[j] * (1 - fr) + t->tim[j2] * fr;
            y += s * sin(PI * (dist - 4) / win);
        }
        t->tim_w = (t->tim_w + 1) % TIM_LEN;
        b[i] = b[i] * (1 - mix) + y * mix;
    }
}

static void m_chorus(FxTrack *t, double *b, int n, const double *p) {
    /* 1-3 voices of 7-25 ms modulated delay, no feedback: thickens without the flanger's jet sweep */
    double rate = 0.08 * pow(40.0, clampd(p[0], 0, 1)), depth = clampd(p[1], 0, 1), mix = p[3];
    int voices = (int)clampd(round(p[2]), 1, 3);
    double inc = 2 * PI * rate / t->rate, base = 0.007 * t->rate, sweep = 0.009 * t->rate * depth;
    for (int i = 0; i < n; i++) {
        t->cho[t->cho_w] = (float)b[i];
        double wet = 0;
        for (int v = 0; v < voices; v++) {
            double d = base + v * 0.004 * t->rate + sweep * (0.5 + 0.5 * sin(t->cho_lfo + t->stereo_phase + v * 2.0944));
            double rp = t->cho_w - d; while (rp < 0) rp += CHO_LEN;
            int j = (int)rp; double fr = rp - j; int j2 = (j + 1) % CHO_LEN;
            wet += t->cho[j] * (1 - fr) + t->cho[j2] * fr;
        }
        t->cho_lfo += inc; if (t->cho_lfo > 2 * PI) t->cho_lfo -= 2 * PI;
        t->cho_w = (t->cho_w + 1) % CHO_LEN;
        b[i] = b[i] * (1 - mix * 0.5) + wet / voices * mix;
    }
}

static void m_comp(FxTrack *t, double *b, int n, const double *p) {
    /* feed-forward peak compressor. amount: threshold 0..-40 dB; ratio 2:1 4:1 8:1 20:1 */
    static const double RATIO[4] = {2, 4, 8, 20};
    double thr = -40 * clampd(p[0], 0, 1), ratio = RATIO[(int)clampd(round(p[1]), 0, 3)];
    double att = exp(-1.0 / (t->rate * (0.0001 + 0.05 * clampd(p[2], 0, 1))));
    double rel = exp(-1.0 / (t->rate * (0.02 + 0.8 * clampd(p[3], 0, 1))));
    double makeup = pow(10, 18 * clampd(p[4], 0, 1) / 20), mix = p[5];
    for (int i = 0; i < n; i++) {
        double x = fabs(b[i]);
        t->cmp_env = x > t->cmp_env ? att * t->cmp_env + (1 - att) * x : rel * t->cmp_env + (1 - rel) * x;
        double db = 20 * log10(t->cmp_env + 1e-9), over = db - thr;
        double gr = over > 0 ? over * (1 - 1 / ratio) : 0;
        t->cmp_gr = gr;
        double y = b[i] * pow(10, -gr / 20) * makeup;
        b[i] = b[i] * (1 - mix) + y * mix;
    }
}

static void biquad(double c[5], int type, double f, double gain_db, double q, double rate) {
    /* RBJ cookbook: 0 low shelf, 1 peak, 2 high shelf. c = b0 b1 b2 a1 a2 (a0 normalised) */
    double A = pow(10, gain_db / 40), w = 2 * PI * f / rate, cw = cos(w), sw = sin(w), al = sw / (2 * q);
    double b0, b1, b2, a0, a1, a2;
    if (type == 1) { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
    else {
        double sq = 2 * sqrt(A) * al, s = type == 0 ? 1 : -1;
        b0 = A * ((A + 1) - s * (A - 1) * cw + sq); b1 = s * 2 * A * ((A - 1) - s * (A + 1) * cw); b2 = A * ((A + 1) - s * (A - 1) * cw - sq);
        a0 = (A + 1) + s * (A - 1) * cw + sq; a1 = -s * 2 * ((A - 1) + s * (A + 1) * cw); a2 = (A + 1) + s * (A - 1) * cw - sq;
    }
    c[0] = b0 / a0; c[1] = b1 / a0; c[2] = b2 / a0; c[3] = a1 / a0; c[4] = a2 / a0;
}

static void m_eq(FxTrack *t, double *b, int n, const double *p) {
    /* low shelf 200 Hz, a sweepable mid bell 200 Hz-5 kHz, high shelf 4 kHz; each +-15 dB */
    double c[3][5];
    biquad(c[0], 0, 200, 15 * clampd(p[0], -1, 1), 0.707, t->rate);
    biquad(c[1], 1, 200 * pow(25.0, clampd(p[2], 0, 1)), 15 * clampd(p[1], -1, 1), 1.0, t->rate);
    biquad(c[2], 2, 4000, 15 * clampd(p[3], -1, 1), 0.707, t->rate);
    for (int i = 0; i < n; i++) {
        double x = b[i];
        for (int k = 0; k < 3; k++) {
            double y = c[k][0] * x + c[k][1] * t->eq_x[k][0] + c[k][2] * t->eq_x[k][1] - c[k][3] * t->eq_y[k][0] - c[k][4] * t->eq_y[k][1];
            t->eq_x[k][1] = t->eq_x[k][0]; t->eq_x[k][0] = x; t->eq_y[k][1] = t->eq_y[k][0]; t->eq_y[k][0] = y; x = y;
        }
        b[i] = x;
    }
}

static void m_autowah(FxTrack *t, double *b, int n, const double *p) {
    /* the louder you play, the higher a resonant band-pass opens */
    double sens = 2 + 30 * clampd(p[0], 0, 1), base = 150 * pow(8.0, clampd(p[1], 0, 1));
    double range = 1 + 15 * clampd(p[2], 0, 1), k = 2.0 - 1.85 * clampd(p[3], 0, 1), mix = p[4];
    double att = exp(-1.0 / (t->rate * 0.004)), rel = exp(-1.0 / (t->rate * 0.12));
    for (int i = 0; i < n; i++) {
        double x = fabs(b[i]);
        t->aw_env = x > t->aw_env ? att * t->aw_env + (1 - att) * x : rel * t->aw_env + (1 - rel) * x;
        double fc = base * pow(range, clampd(t->aw_env * sens, 0, 1));
        if (fc > t->rate * 0.45) fc = t->rate * 0.45;
        double g = tan(PI * fc / t->rate), a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
        double v0 = b[i], v3 = v0 - t->aw_ic2;
        double v1 = a1 * t->aw_ic1 + a2 * v3, v2 = t->aw_ic2 + a2 * t->aw_ic1 + a3 * v3;
        t->aw_ic1 = 2 * v1 - t->aw_ic1; t->aw_ic2 = 2 * v2 - t->aw_ic2;
        b[i] = v0 * (1 - mix) + v1 * 1.6 * mix;
    }
}

/* The notes the resonator's strings are tuned to (Hz), set by the engine from what the track plays. */
void dsfx_tune(FxTrack *t, const double *freqs, int count) {
    if (count > RES_STR) count = RES_STR;
    for (int i = 0; i < count; i++) t->res_f[i] = freqs[i];
    t->res_n = count < 0 ? 0 : count;
}

static void m_resonator(FxTrack *t, double *b, int n, const double *p) {
    /* decay: ring time 0.2-8 s; tone: string damping; mix. Each string is a fractional-delay comb. */
    double t60 = 0.2 * pow(40.0, clampd(p[0], 0, 1)), tone = clampd(p[1], 0, 1), mix = p[2];
    double damp = 0.75 * (1 - tone);
    int ns = t->res_n;
    double D[RES_STR], g[RES_STR];
    double Dt[RES_STR];
    for (int s = 0; s < ns; s++) {
        double f = clampd(t->res_f[s], 24, 4000);
        Dt[s] = clampd(t->rate / f, 2, RES_LEN - 2);
        if (t->res_d[s] < 2) t->res_d[s] = Dt[s];
        D[s] = t->res_d[s];
        g[s] = pow(10, -3 * Dt[s] / (t60 * t->rate));
    }
    double norm = ns ? 0.35 / sqrt((double)ns) : 0;
    for (int i = 0; i < n; i++) {
        double x = b[i], wet = 0;
        for (int s = 0; s < ns; s++) {
            /* a new note glides the string over ~3 ms instead of jumping, which would click */
            D[s] += (Dt[s] - D[s]) * 0.007;
            double rp = t->res_w - D[s]; while (rp < 0) rp += RES_LEN;
            int j = (int)rp; double fr = rp - j; int j2 = (j + 1) % RES_LEN;
            double o = t->res[s][j] * (1 - fr) + t->res[s][j2] * fr;
            t->res_lp[s] = o * (1 - damp) + t->res_lp[s] * damp;
            t->res[s][t->res_w] = (float)clampd(x * 0.5 + t->res_lp[s] * g[s], -4, 4);
            wet += o;
        }
        t->res_w = (t->res_w + 1) % RES_LEN;
        if (i == n - 1) for (int s2 = 0; s2 < ns; s2++) t->res_d[s2] = D[s2];
        b[i] = x * (1 - mix * 0.5) + soft(wet * norm * 2) * mix;
    }
}

#define CHUNK 16
/* Audio gate: a rhythmic on/off pattern of 4-16 cells that multiplies the track's sound.
 * p: cells (index into GATE_LEN), cell size (index into GATE_DIV), steps (bit k = cell k open),
 * smooth 0..1 (1-30 ms), depth 0..1, pump 0..1 (an open cell fades down towards its end). */
static const int GATE_LEN[6] = {4, 6, 8, 9, 12, 16};
static const double GATE_DIV[5] = {1, .5, .25, 1.0 / 3, 1.0 / 6};
static void m_gate(FxTrack *t, double *b, int n, const double *p, double bpm) {
    int L = GATE_LEN[(int)clampd(round(p[0]), 0, 5)];
    double div = GATE_DIV[(int)clampd(round(p[1]), 0, 4)];
    unsigned mask = (unsigned)clampd(round(p[2]), 0, 65535);
    double coef = 1 - exp(-1 / ((.001 + clampd(p[3], 0, 1) * .029) * t->rate));
    double depth = clampd(p[4], 0, 1), pump = clampd(p[5], 0, 1), bps = bpm / 60.0 / t->rate;
    if (!t->g_init) { t->g_env = 1; t->g_init = 1; }
    for (int i = 0; i < n; i++) {
        if (t->g_extended && !t->g_hold) {
            while (t->g_event_index<t->g_event_count && t->g_events[t->g_event_index]<=t->g_offset+i) {
                t->g_beat=0;t->g_event_index++;
            }
        }
        double cell = t->g_beat / div;
        if (t->g_extended) cell += t->g_phase * L;
        double c = floor(cell);
        long k = ((long)c % L + L) % L;
        double frac=cell-c;
        double open = (mask >> k) & 1 ? 1 - pump * frac : 0;
        if (t->g_extended && t->g_notelen<1) open=frac<t->g_notelen ? ((mask>>k)&1 ? 1-pump*frac/t->g_notelen : 0) : 0;
        t->g_env += (1 - depth * (1 - open) - t->g_env) * coef;
        b[i] *= t->g_env;
        if (!t->g_extended || !t->g_hold) t->g_beat += bps;
    }
}
/* The gate follows the song position while the transport runs; stopped, it keeps its own time. */
void dsfx_set_clock(FxTrack *t, double beat) { if (!t->g_extended || !t->g_hold) t->g_beat = beat; }
void dsfx_gate_controls(FxTrack *t,int enabled,double phase,double notelen,int hold) {
    t->g_extended=enabled;t->g_phase=phase;t->g_notelen=notelen;t->g_hold=hold;
}
void dsfx_gate_reset(FxTrack *t) { if (!t->g_hold) t->g_beat=0; }
double dsfx_gate_beat(FxTrack *t) { return t->g_beat; }
void dsfx_gate_events(FxTrack *t,const int *events,int count) {
    t->g_event_count=count<0?0:count>256?256:count;t->g_event_index=0;
    if (t->g_event_count) memcpy(t->g_events,events,t->g_event_count*sizeof(int));
}

/* DeckSynth Cloud: four fractional diffused taps, pitch-scattered by the sample clock.
 * Feedback is bounded, tone filtered, deterministic and independent of any imported engine. */
static void m_cloud(FxTrack *t,double *b,int n,const double *p) {
    double base=(.04+p[0]*.7)*t->rate,density=clampd(p[1],0,1),scatter=clampd(p[2],0,1);
    double fb=clampd(p[3],0,.88),tone=.015+.7*clampd(p[4],0,1),mix=clampd(p[5],0,1);
    for(int i=0;i<n;i++) {
        double wet=0,total=0;
        for(int k=0;k<4;k++) {
            double gain=k==0?1:density;
            double delay=base*(.52+.16*k)+scatter*t->rate*.003*sin(t->cloud_phase[k]+k*1.97+t->stereo_phase);
            double rp=t->cloud_w-clampd(delay,2,95998);while(rp<0)rp+=96000;
            int j=(int)rp;double f=rp-j;
            wet+=gain*(t->cloud[j]*(1-f)+t->cloud[(j+1)%96000]*f);total+=gain;
            t->cloud_phase[k]+=2*PI*.37*(1+.17*k)/t->rate;if(t->cloud_phase[k]>2*PI)t->cloud_phase[k]-=2*PI;
        }
        wet/=total;t->cloud_lp+=tone*(wet-t->cloud_lp);
        double diff=-.35*t->cloud_lp+t->cloud_diff;t->cloud_diff=t->cloud_lp+.35*diff;
        t->cloud[t->cloud_w]=(float)(b[i]+fb*t->cloud_lp);t->cloud_w=(t->cloud_w+1)%96000;
        b[i]=b[i]*(1-mix)+diff*mix;
    }
}
static void m_pingpong(FxTrack *l,FxTrack *r,double *a,double *b,int n,const double *p,double bpm) {
    static const double beats[6]={.125,.25,.5,.75,1,2};
    int d=(int)clampd(beats[(int)clampd(round(p[0]),0,5)]*l->rate*60/bpm,1,DLY_LEN-1);
    double w=clampd(p[3],0,1),fb=clampd(p[1],0,.95);
    for(int i=0;i<n;i++) {
        int il=(l->dly_w-d+DLY_LEN)%DLY_LEN,ir=(r->dly_w-d+DLY_LEN)%DLY_LEN;
        double x=l->dly[il],y=r->dly[ir];
        l->dly[l->dly_w]=(float)((1+w)*a[i]+fb*((1-w)*x+w*y));
        r->dly[r->dly_w]=(float)((1-w)*b[i]+fb*((1-w)*y+w*x));
        l->dly_w=(l->dly_w+1)%DLY_LEN;r->dly_w=(r->dly_w+1)%DLY_LEN;
        a[i]+=x*p[2];b[i]+=y*p[2];
    }
}
static void m_haas(FxTrack *t,double *b,int n,double delay) {
    double target=clampd(delay,0,.03)*t->rate;
    for(int i=0;i<n;i++) {
        t->haas_delay+=(target-t->haas_delay)*.002;t->haas[t->haas_w]=(float)b[i];
        if(target>0 || t->haas_delay>.001) {
            double rp=t->haas_w-t->haas_delay;while(rp<0)rp+=2048;int j=(int)rp;double f=rp-j;
            b[i]=t->haas[j]*(1-f)+t->haas[(j+1)%2048]*f;
        }
        t->haas_w=(t->haas_w+1)%2048;
    }
}

/* ---- Round 2 effects (16 Nov): Pitch shift, Auto-tune, Ducking, Vocoder ---- */

static double sh_read(const Shifter *s, double dist) {
    double rp = s->w - dist; while (rp < 0) rp += PS_LEN;
    int j = (int)rp; double fr = rp - j;
    return s->buf[j % PS_LEN] * (1 - fr) + s->buf[(j + 1) % PS_LEN] * fr;
}
/* The distance near `target` whose recent past looks most like the past at `from`. */
static double sh_match(const Shifter *s, double from, double target) {
    int a = (int)from; double best = target, bestc = -1e30;
    for (int k = -SH_SEARCH; k <= SH_SEARCH; k += 2) {
        int b = (int)target + k;
        if (b < 8 || b > PS_LEN - SH_CORR - 8) continue;
        double c = 0, e = 1e-9;
        for (int m = 0; m < SH_CORR; m += 2) {
            float x = s->buf[(s->w - a - m + 2 * PS_LEN) % PS_LEN], y = s->buf[(s->w - b - m + 2 * PS_LEN) % PS_LEN];
            c += x * y; e += y * y;
        }
        c /= sqrt(e);
        if (c > bestc) { bestc = c; best = b + (from - a); }
    }
    return best;
}
/* The read head moves at `ratio` against the writer (2 = an octave up). At ratio 1 one head
 * plays a clean copy about 18 ms late, with no splices at all. */
static double shifter(Shifter *s, double x, double ratio) {
    const double lo = 24, hi = 1700, jump = 900;
    s->buf[s->w] = (float)x;
    if (!s->init) { s->init = 1; s->d[0] = s->d[1] = jump; s->act = 0; s->fade = 0; }
    double step = 1 - ratio;
    int a = s->act;
    s->d[0] = clampd(s->d[0] + step, 2, PS_LEN - 4); s->d[1] = clampd(s->d[1] + step, 2, PS_LEN - 4);
    if (!s->fade) {
        double margin = SH_FADE * fabs(step) + 4;
        if ((step < 0 && s->d[a] < lo + margin) || (step > 0 && s->d[a] > hi - margin)) {
            s->d[1 - a] = sh_match(s, s->d[a], step < 0 ? s->d[a] + jump : s->d[a] - jump);
            s->fade = SH_FADE;
        }
    }
    double y;
    if (s->fade) {
        double g = 0.5 - 0.5 * cos(PI * (1 - (double)s->fade / SH_FADE));
        y = sh_read(s, s->d[a]) * (1 - g) + sh_read(s, s->d[1 - a]) * g;
        if (--s->fade == 0) s->act = 1 - a;
    } else y = sh_read(s, s->d[a]);
    s->w = (s->w + 1) % PS_LEN;
    return y;
}

static void m_pitch(FxTrack *t, double *b, int n, const double *p) {
    /* semis -12..12, cents -100..100, mix */
    double ratio = pow(2.0, (clampd(p[0], -12, 12) + clampd(p[1], -100, 100) / 100) / 12), mix = clampd(p[2], 0, 1);
    for (int i = 0; i < n; i++) {
        double y = shifter(&t->psh, b[i], ratio);
        b[i] = b[i] * (1 - mix) + y * mix;
    }
}

/* YIN on the decimated ring: returns the period in decimated samples, 0 when no clear pitch. */
static double yin_period(FxTrack *t) {
    enum { W = 384, LMIN = 15, LMAX = 300, N = W + LMAX };
    float x[N]; double d[LMAX + 1], cum = 0, e = 0;
    for (int i = 0; i < N; i++) x[i] = t->at_an[(t->at_an_w - N + i + 2 * AT_LEN) % AT_LEN];
    for (int i = 0; i < W; i++) e += x[i] * x[i];
    if (e < W * 1e-6) return 0;
    d[0] = 1;
    for (int tau = 1; tau <= LMAX; tau++) {
        double s = 0;
        for (int i = 0; i < W; i++) { double df = x[i] - x[i + tau]; s += df * df; }
        cum += s; d[tau] = cum > 0 ? s * tau / cum : 1;
    }
    for (int tau = LMIN; tau < LMAX; tau++) if (d[tau] < 0.15) {
        while (tau + 1 < LMAX && d[tau + 1] < d[tau]) tau++;
        double a = d[tau - 1], c = d[tau + 1], den = a - 2 * d[tau] + c;
        return tau + (fabs(den) > 1e-12 ? 0.5 * (a - c) / den : 0);
    }
    return 0;
}

static void m_autotune(FxTrack *t, double *b, int n, const double *p) {
    /* speed 0 = instant (hard, robotic) .. 1 = slow and natural; amount: how far notes are pulled; mix */
    double tau = 0.002 + 0.25 * clampd(p[0], 0, 1) * clampd(p[0], 0, 1), amount = clampd(p[1], 0, 1), mix = clampd(p[2], 0, 1);
    double glide = 1 - exp(-1.0 / (t->rate * tau)), drate = t->rate / 4;
    int mask = t->at_mask ? t->at_mask : 4095;
    if (t->at_ratio <= 0) t->at_ratio = t->at_target = 1;
    for (int i = 0; i < n; i++) {
        t->at_dec_acc += b[i];
        if (++t->at_dec_n == 4) {
            t->at_an[t->at_an_w] = (float)(t->at_dec_acc / 4); t->at_an_w = (t->at_an_w + 1) % AT_LEN;
            t->at_dec_acc = 0; t->at_dec_n = 0;
            if (++t->at_new >= 256) {
                t->at_new = 0;
                double per = yin_period(t);
                if (per > 0) {
                    double note = 69 + 12 * log2(drate / per / 440), best = note, gap = 99;
                    int r = (int)lround(note);
                    for (int k = -6; k <= 6; k++) {
                        int cand = r + k, pc = ((cand - t->at_root) % 12 + 12) % 12;
                        if ((mask >> pc) & 1 && fabs(cand - note) < gap) { gap = fabs(cand - note); best = cand; }
                    }
                    t->at_note = best; t->at_heard = note;
                    t->at_target = pow(2.0, (best - note) * amount / 12);
                } else { t->at_target = 1; t->at_heard = 0; }
            }
        }
        t->at_ratio += (t->at_target - t->at_ratio) * glide;
        double y = shifter(&t->ash, b[i], t->at_ratio);
        b[i] = b[i] * (1 - mix) + y * mix;
    }
}

static void m_duck(FxTrack *t, double *b, int n, const double *p) {
    /* p[0] source track (the engine routes its audio here), amount, sensitivity, attack, release */
    double amount = clampd(p[1], 0, 1), sens = pow(10, 36 * clampd(p[2], 0, 1) / 20);
    double att = exp(-1.0 / (t->rate * (0.0002 + 0.03 * clampd(p[3], 0, 1))));
    double rel = exp(-1.0 / (t->rate * (0.02 + 0.8 * clampd(p[4], 0, 1))));
    const double *k = t->key[0]; int kn = t->key_n[0];
    for (int i = 0; i < n; i++) {
        int at = t->g_offset + i;
        double x = k && at < kn ? fabs(k[at]) : 0;
        t->dk_env = x > t->dk_env ? att * t->dk_env + (1 - att) * x : rel * t->dk_env + (1 - rel) * x;
        double g = 1 - amount * clampd(t->dk_env * sens, 0, 1);
        t->dk_red = 1 - g;
        b[i] *= g;
    }
}

static double svf_bp(double s[2], double x, double g, double k) {
    double a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    double v3 = x - s[1], v1 = a1 * s[0] + a2 * v3, v2 = s[1] + a2 * s[0] + a3 * v3;
    s[0] = 2 * v1 - s[0]; s[1] = 2 * v2 - s[1];
    return v1;
}

static void m_vocoder(FxTrack *t, double *b, int n, const double *p) {
    /* this track is the carrier, the source track (key slot 1) the voice that shapes it.
     * p[0] source, response (fast..smooth), formant shift (-1..1 octave), air (the voice's highs), mix */
    const double *key = t->key[1]; int kn = t->key_n[1];
    if (!key) { for (int j = 0; j < VOC_B; j++) t->vc_env[j] *= 0.5; return; }
    double rel = exp(-1.0 / (t->rate * (0.008 + 0.15 * clampd(p[1], 0, 1)))), att = exp(-1.0 / (t->rate * 0.002));
    double shift = pow(2.0, clampd(p[2], -1, 1)), air = clampd(p[3], 0, 1), mix = clampd(p[4], 0, 1);
    double gm[VOC_B], gc[VOC_B], kq = 1 / 5.0, nyq = t->rate * 0.45;
    for (int j = 0; j < VOC_B; j++) {
        double f = 120 * pow(60.0, j / (double)(VOC_B - 1));
        gm[j] = tan(PI * fmin(f, nyq) / t->rate);
        gc[j] = tan(PI * fmin(f * shift, nyq) / t->rate);
    }
    double hp = exp(-2 * PI * 5000 / t->rate);
    for (int i = 0; i < n; i++) {
        int at = t->g_offset + i;
        double m = at < kn ? key[at] : 0, c = b[i], wet = 0;
        for (int j = 0; j < VOC_B; j++) {
            /* the voice is split with two filters per band (steeper), each scaled to unity at its centre */
            double bm = kq * svf_bp(&t->vc_m[j][2], kq * svf_bp(&t->vc_m[j][0], m, gm[j], kq), gm[j], kq);
            double bc = svf_bp(t->vc_c[j], c, gc[j], kq);
            double am = 2.2 * fabs(bm), ac = fabs(bc);
            t->vc_env[j] = am > t->vc_env[j] ? att * t->vc_env[j] + (1 - att) * am : rel * t->vc_env[j] + (1 - rel) * am;
            t->vc_cenv[j] = ac > t->vc_cenv[j] ? att * t->vc_cenv[j] + (1 - att) * ac : rel * t->vc_cenv[j] + (1 - rel) * ac;
            /* each carrier band is levelled, then takes the voice's level in that band */
            wet += bc * t->vc_env[j] / (t->vc_cenv[j] + 0.02);
        }
        /* air: the voice's own highs (s, t, breath) on top, so words stay clear */
        t->vc_hp = hp * (t->vc_hp + m - t->vc_hpx); t->vc_hpx = m;
        wet = wet * 0.9 + air * t->vc_hp;
        b[i] = c * (1 - mix) + wet * mix;
    }
}

/* ---- Ambient effects (25 Nov): Tape, Smear, Shimmer, Space. Stereo in, stereo out (a = left, b = right),
 * state in t (the left channel's FxTrack). No allocation; every feedback path is bounded. ---- */

static inline double amb_rd(const float *buf, int mask, int w, double d) {
    double rp = w - d; double fl = floor(rp); int j = (int)fl; double f = rp - fl;
    double x = buf[j & mask], y = buf[(j + 1) & mask];
    return x + (y - x) * f;
}
static inline double amb_rnd(unsigned *s) { *s = *s * 1664525u + 1013904223u; return (double)(*s >> 8) / 8388608.0 - 1.0; }
/* identity below 2, then bends smoothly towards 3: a loop that would run away stays bounded */
static inline double amb_clip(double v) { double a = fabs(v); return a <= 2 ? v : copysign(2 + tanh(a - 2), v); }
static inline double amb_lpcoef(double fc, double rate) { return exp(-2 * PI * fmin(fc, .45 * rate) / rate); }
/* Fast Walsh-Hadamard transform of 8 values, scaled to keep energy: the feedback matrix of both reverbs. */
static inline void amb_hadamard(double *x) {
    for (int h = 1; h < 8; h <<= 1)
        for (int i = 0; i < 8; i += h << 1)
            for (int j = i; j < i + h; j++) { double u = x[j], v = x[j + h]; x[j] = u + v; x[j + h] = u - v; }
    for (int i = 0; i < 8; i++) x[i] *= 0.35355339059327373;
}
static inline double amb_ap(float *buf, int mask, int w, double d, double g, double x) {
    double o = amb_rd(buf, mask, w, d), s = amb_clip(x + g * o);
    buf[w & mask] = (float)s; return o - g * s;
}

/* Tape: wow (slow drifting pitch), flutter (fast), drive, age (top end rolls off), hiss, through a short
 * modulated delay. Character Fresh / Worn / Broken scales wow, flutter and age by 1, 1.6 and 2.5.
 * p: wow, flutter, drive, age, hiss, mix, character. The dry part of Mix is read at the tape's own delay, so a
 * blend never comb-filters; the whole effect is about 4 ms late. */
static void m_tape(FxTrack *t, double *a, double *b, int n, const double *p) {
    static const double MUL[3] = {1, 1.6, 2.5};
    TapeState *s = &t->tp; const int mask = TP_LEN - 1;
    double mul = MUL[(int)clampd(round(p[6]), 0, 2)], sr = t->rate / 48000.0;
    double wow = clampd(p[0], 0, 1) * mul, flut = clampd(p[1], 0, 1) * mul, drive = clampd(p[2], 0, 1);
    double age = fmin(1, clampd(p[3], 0, 1) * mul), hiss = clampd(p[4], 0, 1) * 0.0137, mix = clampd(p[5], 0, 1);
    double base = fmin(200 * sr, TP_LEN / 2.0);
    if (!s->init) { s->init = 1; s->dprev = base; s->seed = 0x2545f491u; }
    /* the modulation at the end of this chunk; the delay glides there sample by sample */
    double dt = n / t->rate;
    s->ph1 += 2 * PI * .47 * (1 + .3 * s->rnd) * dt; s->ph2 += 2 * PI * 1.31 * dt;
    s->phf += 2 * PI * 8.3 * dt; s->phf2 += 2 * PI * 11.7 * dt;
    if (s->ph1 > 2 * PI) s->ph1 -= 2 * PI; if (s->ph2 > 2 * PI) s->ph2 -= 2 * PI;
    if (s->phf > 2 * PI) s->phf -= 2 * PI; if (s->phf2 > 2 * PI) s->phf2 -= 2 * PI;
    s->rnd_n += n; if (s->rnd_n > .35 * t->rate) { s->rnd_n = 0; s->rnd_t = amb_rnd(&s->seed); }
    s->rnd += (s->rnd_t - s->rnd) * (1 - exp(-dt / .25));
    double wsig = .5 * sin(s->ph1) + .25 * sin(s->ph2) + .25 * s->rnd, fsig = .75 * sin(s->phf) + .25 * sin(s->phf2);
    double d1 = base + 80 * sr * wow * wsig + 1.25 * sr * flut * fsig, d0 = s->dprev; s->dprev = d1;
    double k = 1 + 7 * drive, norm = .316 / tanh(.316 * k);
    double clp = amb_lpcoef(20000 * pow(.2, age), t->rate), chp = exp(-2 * PI * (15 + 85 * age) / t->rate);
    double att = exp(-1 / (.005 * t->rate)), rel = exp(-1 / (.3 * t->rate));
    for (int i = 0; i < n; i++) {
        double d = d0 + (d1 - d0) * (i + 1) / n, in = fmax(fabs(a[i]), fabs(b[i]));
        s->env = in > s->env ? att * s->env + (1 - att) * in : rel * s->env;
        double g = hiss * fmin(1, s->env * 100);
        for (int c = 0; c < 2; c++) {
            double *x = c ? b + i : a + i;
            s->buf[c][s->w] = (float)*x;
            double y = amb_rd(s->buf[c], mask, s->w, d), dry = amb_rd(s->buf[c], mask, s->w, base);
            y = tanh(k * y) * norm + g * amb_rnd(&s->seed);
            s->lp[c][0] += (1 - clp) * (y - s->lp[c][0]); s->lp[c][1] += (1 - clp) * (s->lp[c][0] - s->lp[c][1]);
            y = s->lp[c][1];
            double h = chp * (s->hpy[c] + y - s->hpx[c]); s->hpx[c] = y; s->hpy[c] = h;
            *x = dry * (1 - mix) + h * mix;
        }
        s->w = (s->w + 1) & mask;
    }
}

/* Smear: eight modulated all-pass delays per channel (prime ratios, different left and right) blur the sound in
 * time without colouring it much. p: size (longest delay 3..80 ms), blur (all-pass gain .3-.75), motion (slow
 * drift of every delay), tone (low-pass on the wet), mix. */
static void m_smear(FxTrack *t, double *a, double *b, int n, const double *p) {
    static const double PR[2][SM_N] = {{131, 197, 271, 359, 467, 613, 787, 1009}, {137, 191, 263, 349, 479, 601, 773, 997}};
    SmearState *s = &t->sm; const int mask = SM_LEN - 1;
    double lmax = (3 + 77 * clampd(p[0], 0, 1)) * 1e-3 * t->rate, g = .3 + .45 * clampd(p[1], 0, 1);
    double motion = clampd(p[2], 0, 1), clp = amb_lpcoef(1500 * pow(13.33, clampd(p[3], 0, 1)), t->rate), mix = clampd(p[4], 0, 1);
    double d0[2][SM_N], d1[2][SM_N], dt = n / t->rate;
    for (int c = 0; c < 2; c++) for (int k = 0; k < SM_N; k++) {
        double len = lmax * PR[c][k] / 1009.0, depth = motion * (.006 * len + 3);
        s->ph[c][k] += 2 * PI * (.11 + .037 * k + .013 * c) * dt; if (s->ph[c][k] > 2 * PI) s->ph[c][k] -= 2 * PI;
        double target = clampd(len + depth * sin(s->ph[c][k] + 1.7 * k), 1, SM_LEN - 4);
        d0[c][k] = s->init ? s->d[c][k] : target; d1[c][k] = s->d[c][k] = target;
    }
    s->init = 1;
    for (int i = 0; i < n; i++) {
        double f = (i + 1.0) / n;
        for (int c = 0; c < 2; c++) {
            double *x = c ? b + i : a + i, v = *x;
            for (int k = 0; k < SM_N; k++) v = amb_ap(s->buf[c][k], mask, s->w, d0[c][k] + (d1[c][k] - d0[c][k]) * f, g, v);
            s->lp[c] += (1 - clp) * (v - s->lp[c]);
            *x = *x * (1 - mix) + s->lp[c] * mix;
        }
        s->w = (s->w + 1) & mask;
    }
}

/* Shimmer: an eight-line feedback delay network whose lines are partly pitch-shifted up (Interval) on every
 * pass, so the tail climbs. The shifter is two crossfaded read heads with triangular windows (their gains sum
 * to 1), so no pass can gain level: loop gain <= the decay gain < 1, and a soft clip guards the loop anyway.
 * p: decay 1..20 s, shimmer, tone, width, mix, interval (+12 / +7 / +19 / +24 semitones). */
static void m_shimmer(FxTrack *t, double *a, double *b, int n, const double *p) {
    static const double LEN[FDN] = {1499, 1801, 2111, 2393, 2689, 2969, 3271, 3557};
    static const double DIF[2][2] = {{241, 173}, {229, 181}};
    static const double SEMI[4] = {12, 7, 19, 24};
    ShimmerState *s = &t->shm; const int lm = SHM_LEN - 1, sm = SHF_LEN - 1, dm = DIF_LEN - 1;
    double sr = t->rate / 48000.0, T = clampd(p[0], 1, 20), sh_amt = clampd(p[1], 0, 1), amt = .06 * sh_amt, keep = 1 - amt;
    double clp = amb_lpcoef(2000 * pow(8, clampd(p[2], 0, 1)), t->rate), width = clampd(p[3], 0, 1), mix = clampd(p[4], 0, 1);
    double ratio = pow(2, SEMI[(int)clampd(round(p[5]), 0, 3)] / 12), ing = .5 * fmin(1, sqrt(3 / T));
    int len[FDN]; double gk[FDN];
    for (int k = 0; k < FDN; k++) { len[k] = (int)fmin(LEN[k] * sr, SHM_LEN - 2); gk[k] = pow(10, -3 * len[k] / (T * t->rate)); }
    double dc = exp(-2 * PI * 20 / t->rate);
    for (int i = 0; i < n; i++) {
        double in[2] = {a[i], b[i]};
        for (int c = 0; c < 2; c++) {
            double y = dc * (s->dcy[c] + in[c] - s->dcx[c]); s->dcx[c] = in[c]; s->dcy[c] = y;
            for (int k = 0; k < 2; k++) y = amb_ap(s->dif[c][k], dm, s->w, DIF[c][k] * sr, .6, y);
            in[c] = y * ing;
        }
        double o[FDN], y[FDN], wl = 0, wr = 0;
        for (int k = 0; k < FDN; k++) {
            o[k] = s->line[k][(s->w - len[k]) & lm];
            s->lp[k] += (1 - clp) * (o[k] - s->lp[k]);
            double v = s->lp[k];
            s->sh[k][s->w & sm] = (float)v;
            double d1 = fmod(s->shd + k * SHF_WIN / FDN, SHF_WIN), d2 = fmod(d1 + SHF_WIN / 2, SHF_WIN);
            double g1 = 1 - fabs(2 * d1 / SHF_WIN - 1), sv = g1 * amb_rd(s->sh[k], sm, s->w, d1 + 2) + (1 - g1) * amb_rd(s->sh[k], sm, s->w, d2 + 2);
            y[k] = gk[k] * (v * keep + sv * amt);
            /* the climbing copy is also heard straight, once: that is the shimmer you hear; only a little of it recirculates */
            double hear = o[k] + 2 * sh_amt * sv * gk[k];
            if (k & 1) wr += hear; else wl += hear;
        }
        amb_hadamard(y);
        for (int k = 0; k < FDN; k++) s->line[k][s->w & lm] = (float)amb_clip(y[k] + in[k & 1]);
        s->shd += 1 - ratio; while (s->shd < 0) s->shd += SHF_WIN; while (s->shd >= SHF_WIN) s->shd -= SHF_WIN;
        s->w = (s->w + 1) & lm;  /* the smaller power-of-two buffers wrap with it through their own masks */
        double mid = (wl + wr) * .25, side = (wl - wr) * .25 * width;
        a[i] = a[i] * (1 - mix) + (mid + side) * mix;
        b[i] = b[i] * (1 - mix) + (mid - side) * mix;
    }
}

/* Space: a big modulated hall, an eight-line feedback delay network after pre-delay and input diffusion.
 * Freeze cuts the input to the tank and holds the tail: feedback 1, no damping and no modulation, so the
 * lines are read at whole-sample delays and keep their level indefinitely; the dry sound still passes.
 * p: size, decay 1..60 s, pre-delay 0..200 ms, damp, mod, mix, freeze (0/1). */
static void m_space(FxTrack *t, double *a, double *b, int n, const double *p) {
    static const double LEN[FDN] = {4799, 5381, 5953, 6553, 7151, 7741, 8363, 9001};
    static const double DIF[4] = {142, 107, 379, 277};
    SpaceState *s = &t->sp; const int lm = SP_LEN - 1, pm = SP_PRE - 1, dm = DIF_LEN - 1;
    double sr = t->rate / 48000.0, sc = .25 + .75 * clampd(p[0], 0, 1), T = clampd(p[1], 1, 60);
    double pre = clampd(p[2] * 1e-3 * t->rate, 1, SP_PRE - 4), damp = .05 + .7 * clampd(p[3], 0, 1);
    double mod = clampd(p[4], 0, 1), mix = clampd(p[5], 0, 1), want = p[6] >= .5 ? 1 : 0;
    /* freeze glides in and out over about 50 ms, then snaps exactly to 0 or 1 */
    double fc = 1 - exp(-n / (.05 * t->rate));
    s->frz += (want - s->frz) * fc; if (fabs(want - s->frz) < 1e-3) s->frz = want;
    double frz = s->frz, ing = .45 * fmin(1, sqrt(3 / T)) * (1 - frz), cd = damp * (1 - frz);
    double d0[FDN], d1[FDN], gk[FDN], dt = n / t->rate;
    for (int k = 0; k < FDN; k++) {
        double len = floor(fmin(LEN[k] * sr * sc, SP_LEN - 64) + .5), md = mod * (3 + 10 * sc) * sr * (1 - frz);
        s->ph[k] += 2 * PI * (.13 + .083 * k) * dt; if (s->ph[k] > 2 * PI) s->ph[k] -= 2 * PI;
        double target = md > 0 ? len + md * sin(s->ph[k] + 2.1 * k) : len;
        d0[k] = s->init ? s->d[k] : target; d1[k] = s->d[k] = target;
        double g = pow(10, -3 * len / (T * t->rate)); gk[k] = frz >= 1 ? 1 : g + (1 - g) * frz;
    }
    s->init = 1;
    double dc = exp(-2 * PI * 20 / t->rate), dif = (.5 + .5 * sc) * sr;
    for (int i = 0; i < n; i++) {
        double in[2] = {a[i], b[i]}, f = (i + 1.0) / n;
        for (int c = 0; c < 2; c++) {
            s->pre[c][s->w & pm] = (float)in[c];
            double y = amb_rd(s->pre[c], pm, s->w, pre);
            double h = dc * (s->dcy[c] + y - s->dcx[c]); s->dcx[c] = y; s->dcy[c] = h; y = h;
            for (int k = 0; k < 4; k++) y = amb_ap(s->dif[c][k], dm, s->w, DIF[k] * dif * (c ? 1.07 : 1), .62, y);
            in[c] = y * ing;
        }
        double o[FDN], y[FDN], wl = 0, wr = 0;
        for (int k = 0; k < FDN; k++) {
            double d = d0[k] + (d1[k] - d0[k]) * f;
            o[k] = amb_rd(s->line[k], lm, s->w, d);
            s->lp[k] = o[k] + cd * (s->lp[k] - o[k]);
            y[k] = gk[k] * s->lp[k];
            if (k & 1) wr += o[k]; else wl += o[k];
        }
        amb_hadamard(y);
        for (int k = 0; k < FDN; k++) s->line[k][s->w & lm] = (float)amb_clip(y[k] + in[k & 1]);
        s->w = (s->w + 1) & lm;
        a[i] = a[i] * (1 - mix) + wl * .3 * mix;
        b[i] = b[i] * (1 - mix) + wr * .3 * mix;
    }
}

/* The four ambient effects in the mono chain: run on a copy as left and right and take the average. */
static void ambient_stereo(FxTrack *t, int m, double *a, double *b, int n, const double *p) {
    switch (m) {
        case TAPE: m_tape(t, a, b, n, p); break;
        case SMEAR: m_smear(t, a, b, n, p); break;
        case SHIMMER: m_shimmer(t, a, b, n, p); break;
        case SPACE: m_space(t, a, b, n, p); break;
    }
}
static void ambient_mono(FxTrack *t, int m, double *x, int n, const double *p) {
    double r[CHUNK]; memcpy(r, x, n * sizeof(double));
    ambient_stereo(t, m, x, r, n, p);
    for (int i = 0; i < n; i++) x[i] = .5 * (x[i] + r[i]);
}

static void run_module(FxTrack *t, int m, double *b, int n, const double *p, double bpm) {
    switch (m) {
        case TAPE: case SMEAR: case SHIMMER: case SPACE: ambient_mono(t, m, b, n, p); break;
        case STUTTER: m_stutter(t, b, n, p, bpm); break;
        case FILTER: m_filter(t, b, n, p); break;
        case OVERDRIVE: m_drive(b, n, p); break;
        case BITCRUSH: m_bitcrush(t, b, n, p); break;
        case VOLUME: m_volume(b, n, p); break;
        case PHASER: m_phaser(t, b, n, p); break;
        case FLANGER: m_flanger(t, b, n, p); break;
        case RINGMOD: m_ringmod(t, b, n, p); break;
        case CLOUD: m_cloud(t,b,n,p); break;
        case DELAY: m_delay(t, b, n, p, bpm); break;
        case REVERB: m_reverb(t, b, n, p); break;
        case TIMEFX: m_time(t, b, n, p); break;
        case CHORUS: m_chorus(t, b, n, p); break;
        case COMP: m_comp(t, b, n, p); break;
        case EQ: m_eq(t, b, n, p); break;
        case AUTOWAH: m_autowah(t, b, n, p); break;
        case RESONATOR: m_resonator(t, b, n, p); break;
        case AUDIOGATE: m_gate(t, b, n, p, bpm); break;
        case PITCH: m_pitch(t, b, n, p); break;
        case AUTOTUNE: m_autotune(t, b, n, p); break;
        case DUCK: m_duck(t, b, n, p); break;
        case VOCODER: m_vocoder(t, b, n, p); break;
    }
}

/* Whole-number choices of the ambient effects jump instead of gliding through the values between. */
static const int STEPPED[3] = {TAPE * NPAR + 6, SHIMMER * NPAR + 5, SPACE * NPAR + 6};

/* order: NMOD module ids in chain order; on: NMOD flags (by module id);
 * params: NMOD*NPAR values (by module id).
 * The block runs in 16-sample chunks: parameters glide from last block's values to these, and an effect
 * that is switched on or off crossfades with the dry sound over 10 ms. Jumps in either click. */
void dsfx_process(FxTrack *t, double *b, int n, const int *order, const int *on, const double *params, double bpm) { ds_ftz();
    if (bpm < 20) bpm = 120;
    if (!t->pinit) { memcpy(t->pcur, params, sizeof(t->pcur)); t->pinit = 1;
        for (int m = 0; m < NMOD; m++) t->onamt[m] = 0; }  /* fresh state: every effect fades in */
    double start[NMOD * NPAR]; memcpy(start, t->pcur, sizeof(start));
    double sum[NMOD] = {0}, fade = CHUNK / (t->rate * 0.010);
    int chunks = (n + CHUNK - 1) / CHUNK;
    for (int c = 0; c < chunks; c++) {
        int off = c * CHUNK, len = n - off < CHUNK ? n - off : CHUNK;
        double w = (double)(c + 1) / chunks;
        for (int i = 0; i < NMOD * NPAR; i++) t->pcur[i] = start[i] + (params[i] - start[i]) * w;
        for (int i = 0; i < 3; i++) t->pcur[AUDIOGATE * NPAR + i] = params[AUDIOGATE * NPAR + i];  /* cells and steps: no glide */
        for (int i = 0; i < 3; i++) t->pcur[STEPPED[i]] = params[STEPPED[i]];  /* Character, Interval, Freeze */
        t->g_offset=off;
        double *x = b + off;
        for (int k = 0; k < NMOD; k++) {
            int m = order[k];
            if (m < 0 || m >= NMOD) continue;
            double a0 = t->onamt[m], a1 = on[m] ? fmin(1, a0 + fade) : fmax(0, a0 - fade);
            t->onamt[m] = a1;
            if (a0 <= 0 && a1 <= 0) continue;
            const double *p = t->pcur + m * NPAR;
            if (a0 >= 1 && a1 >= 1) run_module(t, m, x, len, p, bpm);
            else {
                double dry[CHUNK]; memcpy(dry, x, len * sizeof(double));
                run_module(t, m, x, len, p, bpm);
                for (int i = 0; i < len; i++) { double g = a0 + (a1 - a0) * (i + 1) / len; x[i] = dry[i] * (1 - g) + x[i] * g; }
            }
            for (int i = 0; i < len; i++) { if (!isfinite(x[i])) x[i] = 0; sum[m] += x[i] * x[i]; }
        }
    }
    for (int m = 0; m < NMOD; m++) {
        if (t->onamt[m] <= 0 && !on[m]) t->level[m] *= 0.9;
        else t->level[m] = 0.7 * t->level[m] + 0.3 * sqrt(sum[m] / (n > 0 ? n : 1));
    }
}

/* One stereo chain loop: order, parameter smoothing and gate offsets are shared.
 * Each channel owns its histories; ping-pong couples only delay feedback. */
void dsfx_process_stereo(FxTrack *l,FxTrack *r,double *left,double *right,int n,const int *order,const int *on,const double *params,double bpm) { ds_ftz();
    if(bpm<20)bpm=120;
    if(!l->pinit){memcpy(l->pcur,params,sizeof(l->pcur));l->pinit=1;}
    if(!r->pinit){memcpy(r->pcur,params,sizeof(r->pcur));r->pinit=1;}
    double start[NMOD*NPAR];memcpy(start,l->pcur,sizeof(start));
    double sum[NMOD]={0},fade=CHUNK/(l->rate*.010);int chunks=(n+CHUNK-1)/CHUNK;
    for(int c=0;c<chunks;c++) {
        int off=c*CHUNK,len=n-off<CHUNK?n-off:CHUNK;double w=(double)(c+1)/chunks;
        for(int i=0;i<NMOD*NPAR;i++)l->pcur[i]=start[i]+(params[i]-start[i])*w;
        for(int i=0;i<3;i++)l->pcur[AUDIOGATE*NPAR+i]=params[AUDIOGATE*NPAR+i];
        for(int i=0;i<3;i++)l->pcur[STEPPED[i]]=params[STEPPED[i]];
        l->g_offset=r->g_offset=off;double *a=left+off,*b=right+off;
        for(int k=0;k<NMOD;k++) {
            int m=order[k];if(m<0||m>=NMOD)continue;
            double a0=l->onamt[m],a1=on[m]?fmin(1,a0+fade):fmax(0,a0-fade);l->onamt[m]=r->onamt[m]=a1;
            if(a0<=0&&a1<=0)continue;const double *p=l->pcur+m*NPAR;
            double da[CHUNK],db[CHUNK];if(a0<1||a1<1){memcpy(da,a,len*sizeof(double));memcpy(db,b,len*sizeof(double));}
            l->stereo_phase=l->stereo_width=0;r->stereo_phase=r->stereo_width=0;
            if(m==CHORUS)r->stereo_phase=PI*clampd(p[4],0,1);
            if(m==REVERB)r->stereo_width=clampd(p[5],0,1);
            if(m==CLOUD)r->stereo_phase=1.73;
            if(m==DELAY && p[3]>0)m_pingpong(l,r,a,b,len,p,bpm);
            else if(m>=TAPE)ambient_stereo(l,m,a,b,len,p);  /* true stereo: state in l only */
            else {run_module(l,m,a,len,p,bpm);run_module(r,m,b,len,p,bpm);}
            if(m==CHORUS)m_haas(r,b,len,p[5]);
            if(a0<1||a1<1)for(int i=0;i<len;i++){double g=a0+(a1-a0)*(i+1)/len;a[i]=da[i]*(1-g)+a[i]*g;b[i]=db[i]*(1-g)+b[i]*g;}
            for(int i=0;i<len;i++){if(!isfinite(a[i]))a[i]=0;if(!isfinite(b[i]))b[i]=0;sum[m]+=(a[i]*a[i]+b[i]*b[i])*.5;}
        }
    }
    memcpy(r->pcur,l->pcur,sizeof(l->pcur));
    for(int m=0;m<NMOD;m++){if(l->onamt[m]<=0&&!on[m])l->level[m]*=.9;else l->level[m]=.7*l->level[m]+.3*sqrt(sum[m]/(n>0?n:1));r->level[m]=l->level[m];}
}

/* One additive wavetable: out[i] = sum_k w[k] * sin(2*pi*(k+1)*i/size) / norm.
 * Used by the synth when a mod pad or macro moves Brightness or the spectral shape. */
void dsfx_table(const double *w, int count, double norm, double *out, int size) {
    /* For the usual power-of-two size, harmonics are read from one sine table instead of calling sin():
     * (k+1)*i wraps exactly, so the result is the same, about ten times faster. */
    static double sine[4096]; static int sine_size = 0;
    if ((size & (size - 1)) == 0 && size <= 4096) {
        if (sine_size != size) { for (int i = 0; i < size; i++) sine[i] = sin(2 * PI * i / size); sine_size = size; }
        int mask = size - 1;
        for (int i = 0; i < size; i++) {
            double s = 0;
            for (int k = 0; k < count; k++) s += w[k] * sine[((k + 1) * i) & mask];
            out[i] = s / norm;
        }
        return;
    }
    for (int i = 0; i < size; i++) {
        double s = 0, x = 2 * PI * i / size;
        for (int k = 0; k < count; k++) s += w[k] * sin((k + 1) * x);
        out[i] = s / norm;
    }
}

/* One synth voice: 2048-point wavetable oscillator with the ADSR envelope, added into out[].
 * st holds phase, age, release position, release start level, level and table crossfade (0..1).
 * prev is the table being faded out (or NULL). Returns bit 0 when the voice has finished,
 * bit 1 when the crossfade has finished. Same maths as the Python fallback in core.py. */
/* Curved decay and release (the Sound card's Curve knob). The share of a stage done at x of its time is
 * (1 - e^(-k x)) / (1 - e^(-k)), so k 0 is the old straight line (it holds loud and drops at the end) and
 * a bigger k fades evenly to the ear, the same number of dB each moment, like a struck string. u = e^(-k x) is worked out with exp() once a block and then stepped by one
 * factor a sample, so a curved voice costs about the same as a straight one. */
typedef struct { double k, norm, md, mr, u; int stage; } EnvCurve;
static inline void curve_init(EnvCurve *c, double k, double d, double rel) {
    c->k = k; c->stage = -1; c->u = 1; c->norm = 1; c->md = 1; c->mr = 1;
    if (k > 0) { c->norm = 1 - exp(-k); c->md = exp(-k / d); c->mr = exp(-k / rel); }
}
/* The envelope level for one sample; *r moves on while released. Returns -1 when the release has ended. */
static inline double curve_level(EnvCurve *c, int released, double age, double *r, double base,
                                 double a, double d, double sus, double rel) {
    if (released) {
        if (c->stage != 3) { c->stage = 3; c->u = exp(-c->k * *r / rel); }
        double level = *r >= rel ? 0 : base * (c->u - (1 - c->norm)) / c->norm;
        c->u *= c->mr; *r += 1;
        return level <= 0 ? -1 : level;
    }
    if (age < a) return age / a;
    if (age < a + d) {
        if (c->stage != 2) { c->stage = 2; c->u = exp(-c->k * (age - a) / d); }
        double level = 1 - (1 - sus) * (1 - c->u) / c->norm;
        c->u *= c->md;
        return level;
    }
    return sus;
}

static int voice_core(double *out, int n, const double *tab, const double *prev, double *st, int released,
                      double step, double gain, double a, double d, double sus, double rel, double k) {
    double phase = st[0], age = st[1], r = st[2], base = st[3], level = st[4], xf = st[5];
    int result = 0;
    EnvCurve cv; curve_init(&cv, k, d, rel);
    for (int i = 0; i < n; i++) {
        if (k > 0) {
            level = curve_level(&cv, released, age, &r, base, a, d, sus, rel);
            if (level < 0) { level = 0; result |= 1; break; }
        } else if (released) {
            level = base * fmax(0, 1 - r / rel); r += 1;
            if (level <= 0) { result |= 1; break; }
        } else if (age < a) level = age / a;
        else if (age < a + d) level = 1 - (1 - sus) * (age - a) / d;
        else level = sus;
        int j = (int)phase; double fr = phase - j; int j2 = (j + 1) & 2047;
        double smp = tab[j] + (tab[j2] - tab[j]) * fr;
        if (prev) {
            smp = smp * xf + (prev[j] + (prev[j2] - prev[j]) * fr) * (1 - xf);
            xf += 1.0 / 256;
            if (xf >= 1) { xf = 1; prev = NULL; result |= 2; }
        }
        out[i] += smp * level * gain;
        phase += step; if (phase >= 2048) phase = fmod(phase, 2048);
        age += 1;
    }
    st[0] = phase; st[1] = age; st[2] = r; st[3] = base; st[4] = level; st[5] = xf;
    return result;
}
int dsfx_voice(double *out, int n, const double *tab, const double *prev, double *st, int released,
               double step, double gain, double a, double d, double sus, double rel) {
    return voice_core(out, n, tab, prev, st, released, step, gain, a, d, sus, rel, 0);
}
/* dsfx_voice with the curved decay and release (k > 0). */
int dsfx_voice_curve(double *out, int n, const double *tab, const double *prev, double *st, int released,
                     double step, double gain, double a, double d, double sus, double rel, double k) { ds_ftz();
    return voice_core(out, n, tab, prev, st, released, step, gain, a, d, sus, rel, k);
}

/* Voice renderer with the Filter, Unison and Character cards (patch 24).
 * st[0..5] as dsfx_voice; st[6..12] unison phases; st[13..14] filter state; st[15] sub phase;
 * st[16..31] partial weights gliding to their target; st[32..79] partial phases (3 unison x 16). */
typedef struct {
    double step, gain, a, d, sus, rel;
    int released, uni;
    double detune;                 /* semitones from the centre to the outer unison voice */
    int ftype;                     /* 0 off, 1 low-pass, 2 band-pass, 3 high-pass */
    double cutoff, reso, envamt, rate;
    const double *weights;         /* non-NULL: stretched partials instead of the wavetable */
    int npart; double stretch;
    double sub; int suboct;
    double curve;                  /* curved decay and release, 0 straight (added last: older callers pass 0) */
} DsVoice;

static double vsine[2049]; static int vsine_ready = 0;
static inline double vlut(double ph) { int j = (int)ph; double fr = ph - j; return vsine[j] + (vsine[j + 1] - vsine[j]) * fr; }

/* S2 uses st[80..84]: independent envelope level/release base and smoothed morph/cutoff/reso.
 * The old entry point and state size stay valid, including installed legacy libraries. */
typedef struct { double a, d, sus, rel, morph; int independent; } DsFilter;
static int voice_ext(double *out, int n, const double *tab, const double *prev, double *st, const DsVoice *v, const DsFilter *f) {
    if (!vsine_ready) { for (int i = 0; i <= 2048; i++) vsine[i] = sin(2 * PI * i / 2048); vsine_ready = 1; }
    double age = st[1], r = st[2], base = st[3], level = st[4], xf = st[5];
    int result = 0, partial = v->weights != NULL;
    int uni = v->uni < 1 ? 1 : v->uni > 7 ? 7 : v->uni;
    if (partial && uni > 3) uni = 3;
    double ph[7], inc[7], ug = 1 / sqrt((double)uni);
    for (int u = 0; u < uni; u++) {
        ph[u] = uni == 1 ? st[0] : st[6 + u];
        inc[u] = v->step * (uni == 1 ? 1 : pow(2, (2.0 * u / (uni - 1) - 1) * v->detune / 12));
    }
    int np = partial ? (v->npart > 16 ? 16 : v->npart) : 0;
    double pr[16];
    for (int k = 0; k < np; k++) pr[k] = (k + 1) * sqrt(1 + v->stretch * (k + 1) * (k + 1));
    /* partials above 0.45 x the sample rate would alias; pr rises with k, so the rest are skipped */
    double dks[3][16]; int na[3] = {0, 0, 0};
    for (int u = 0; u < (partial ? uni : 0); u++)
        for (int k = 0; k < np && inc[u] * pr[k] < .45 * 2048; k++) { dks[u][k] = inc[u] * pr[k]; na[u] = k + 1; }
    double ic1 = st[13], ic2 = st[14], a1 = 0, a2 = 0, a3 = 0, kk = 2;
    double subph = st[15], substep = v->step / (v->suboct == 2 ? 4 : 2);
    double fl=0, fb=0, morph=0, logcut=0, reso=0, smooth=0, target=0;
    if (f) {
        fl=st[80]; fb=st[81]; morph=st[82]; logcut=st[83]; reso=st[84];
        smooth=1-exp(-1/(.004*v->rate)); target=log2(v->cutoff);
    }
    EnvCurve cv; curve_init(&cv, v->curve, v->d, v->rel);
    for (int i = 0; i < n; i++) {
        if (v->curve > 0) {
            level = curve_level(&cv, v->released, age, &r, base, v->a, v->d, v->sus, v->rel);
            if (level < 0) { level = 0; result |= 1; break; }
        } else if (v->released) {
            level = base * fmax(0, 1 - r / v->rel); r += 1;
            if (level <= 0) { result |= 1; break; }
        } else if (age < v->a) level = age / v->a;
        else if (age < v->a + v->d) level = 1 - (1 - v->sus) * (age - v->a) / v->d;
        else level = v->sus;
        if (f) {
            if (!f->independent) { fl=level; fb=v->released ? base : level; }
            else if (v->released) { if (r==1) fb=fl; fl=fb*fmax(0,1-(r-1)/f->rel); }
            else if (age<f->a) fl=age/f->a;
            else if (age<f->a+f->d) fl=1-(1-f->sus)*(age-f->a)/f->d;
            else fl=f->sus;
            morph+=(f->morph-morph)*smooth; logcut+=(target-logcut)*smooth; reso+=(v->reso-reso)*smooth;
        }
        if (v->ftype && (i & 15) == 0) {
            double fc = (f ? pow(2,logcut) : v->cutoff) * pow(2, v->envamt * (f ? fl : level));
            fc = fc < 20 ? 20 : fc > .45 * v->rate ? .45 * v->rate : fc;
            double g = tan(PI * fc / v->rate); kk = 2 - 1.96 * (f ? reso : v->reso);
            a1 = 1 / (1 + g * (g + kk)); a2 = g * a1; a3 = g * a2;
        }
        double s = 0;
        if (partial) {
            for (int k = 0; k < na[0]; k++) st[16 + k] += (v->weights[k] - st[16 + k]) * .002;
            for (int u = 0; u < uni; u++) {
                double su = 0, *pp = &st[32 + u * 16];
                for (int k = 0; k < na[u]; k++) {
                    double q = pp[k]; int j = (int)q;
                    su += st[16 + k] * (vsine[j] + (vsine[j + 1] - vsine[j]) * (q - j));
                    q += dks[u][k]; pp[k] = q >= 2048 ? q - 2048 : q;   /* dk < 2048, so this equals fmod */
                }
                s += su; ph[u] += inc[u]; if (ph[u] >= 2048) ph[u] = fmod(ph[u], 2048);
            }
        } else {
            for (int u = 0; u < uni; u++) {
                int j = (int)ph[u]; double fr = ph[u] - j; int j2 = (j + 1) & 2047;
                double su = tab[j] + (tab[j2] - tab[j]) * fr;
                if (prev) su = su * xf + (prev[j] + (prev[j2] - prev[j]) * fr) * (1 - xf);
                s += su; ph[u] += inc[u]; if (ph[u] >= 2048) ph[u] = fmod(ph[u], 2048);
            }
            if (prev) { xf += 1.0 / 256; if (xf >= 1) { xf = 1; prev = NULL; result |= 2; } }
        }
        s *= ug;
        if (v->sub > 0) s += v->sub * .7 * vlut(subph);
        subph += substep; if (subph >= 2048) subph = fmod(subph, 2048);
        if (v->ftype) {
            double v3 = s - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
            ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
            if (f) {
                double hp=s-kk*v1-v2;
                s=morph<=.5 ? v2+(v1-v2)*(morph*2) : v1+(hp-v1)*(morph*2-1);
            } else s = v->ftype == 1 ? v2 : v->ftype == 2 ? v1 : s - kk * v1 - v2;
        }
        out[i] += s * level * v->gain;
        age += 1;
    }
    for (int u = 0; u < uni; u++) { if (uni == 1) st[0] = ph[0]; else st[6 + u] = ph[u]; }
    if (uni > 1) st[0] = ph[0];
    st[1] = age; st[2] = r; st[3] = base; st[4] = level; st[5] = xf;
    st[13] = ic1; st[14] = ic2; st[15] = subph;
    if (f) { st[80]=fl; st[81]=fb; st[82]=morph; st[83]=logcut; st[84]=reso; }
    return result;
}

int dsfx_voice2(double *out, int n, const double *tab, const double *prev, double *st, const DsVoice *v) { ds_ftz();
    return voice_ext(out,n,tab,prev,st,v,NULL);
}
int dsfx_voice3(double *out, int n, const double *tab, const double *prev, double *st, const DsVoice *v, const DsFilter *f) { ds_ftz();
    return voice_ext(out,n,tab,prev,st,v,f);
}

/* Pitch envelope in one call (25 Nov). A note that starts away from its pitch and falls (or rises) to it is
 * rendered in SLICE-sample slices, each with its own pitch: the same slices and factors as strike.slices() in
 * Python (2^(amt e^(-(t + n/2)/dec) / 12) for a slice of n samples starting t samples into the note, and one
 * slice once t passes `end`), but without a ctypes call per slice. Returns the voice kernels' bits: bit 0 the
 * voice has finished, bit 1 the table crossfade has finished (in any slice). */
#define PITCH_SLICE 32
typedef struct { double amt, dec, end; } DsPitch;
static inline double pitch_factor(const DsPitch *p, double t, int n) { return pow(2, p->amt * exp(-(t + n / 2.0) / p->dec) / 12); }
/* The next slice from `off` (samples into the block) for a note `age0` samples old at the block start. */
static inline int pitch_slice(const DsPitch *p, double age0, int off, int n, double *fac) {
    double t = age0 + off;
    if (t >= p->end) { *fac = 1; return n - off; }
    int m = n - off < PITCH_SLICE ? n - off : PITCH_SLICE;
    *fac = pitch_factor(p, t, m); return m;
}
static int pitch_core(double *out, int n, const double *tab, const double *prev, double *st, int released,
                      double step, double gain, double a, double d, double sus, double rel, double k, const DsPitch *p) {
    double age0 = st[1]; int res = 0, bits = 0;
    if (age0 >= p->end) return voice_core(out, n, tab, prev, st, released, step, gain, a, d, sus, rel, k);
    for (int off = 0; off < n;) {
        double fac; int m = pitch_slice(p, age0, off, n, &fac);
        res = voice_core(out + off, m, tab, prev, st, released, step * fac, gain, a, d, sus, rel, k);
        if (res & 2) { prev = NULL; bits |= 2; }
        if (res & 1) { bits |= 1; break; }
        off += m;
    }
    return bits;
}
int dsfx_voice_pitch(double *out, int n, const double *tab, const double *prev, double *st, int released,
                     double step, double gain, double a, double d, double sus, double rel, const DsPitch *p) {
    return pitch_core(out, n, tab, prev, st, released, step, gain, a, d, sus, rel, 0, p);
}
int dsfx_voice_curve_pitch(double *out, int n, const double *tab, const double *prev, double *st, int released,
                           double step, double gain, double a, double d, double sus, double rel, double k, const DsPitch *p) { ds_ftz();
    return pitch_core(out, n, tab, prev, st, released, step, gain, a, d, sus, rel, k, p);
}
static int pitch_ext(double *out, int n, const double *tab, const double *prev, double *st, const DsVoice *v, const DsFilter *f, const DsPitch *p) {
    double age0 = st[1]; int res = 0, bits = 0;
    if (age0 >= p->end) return voice_ext(out, n, tab, prev, st, v, f);
    DsVoice w = *v;
    for (int off = 0; off < n;) {
        double fac; int m = pitch_slice(p, age0, off, n, &fac);
        w.step = v->step * fac;
        res = voice_ext(out + off, m, tab, prev, st, &w, f);
        if (res & 2) { prev = NULL; bits |= 2; }
        if (res & 1) { bits |= 1; break; }
        off += m;
    }
    return bits;
}
int dsfx_voice2_pitch(double *out, int n, const double *tab, const double *prev, double *st, const DsVoice *v, const DsPitch *p) { ds_ftz();
    return pitch_ext(out, n, tab, prev, st, v, NULL, p);
}
int dsfx_voice3_pitch(double *out, int n, const double *tab, const double *prev, double *st, const DsVoice *v, const DsFilter *f, const DsPitch *p) { ds_ftz();
    return pitch_ext(out, n, tab, prev, st, v, f, p);
}

/* Strike stage (24 Nov): what a real instrument does in its first moments, after the voice is rendered.
 *   damping: a gentle low-pass (12 dB/oct) that starts wide open and closes towards a few partials above the
 *            note over tau samples, so the upper partials die faster than the fundamental (strings, keys, bells);
 *   noise:   a band-passed noise burst at the start of the note (pick, hammer, breath), its own decay.
 * src is the voice alone (its own scratch buffer); the result is added into out.
 * st[0] age, st[1] noise generator, st[2..3] damping filter, st[4..5] noise filter, st[6..8] damping coefficients. */
typedef struct {
    double f0, rate;
    double tau, lo, hi;              /* damping: tau in samples (0 off), lo and hi in octaves above f0 */
    double noise, ndecay, nfc, gain; /* noise level (0 off), decay in samples, centre in Hz, voice gain */
} DsStrike;
void dsfx_strike(double *out, const double *src, int n, double *st, const DsStrike *e) { ds_ftz();
    double age = st[0]; unsigned int rng = (unsigned int)st[1]; if (!rng) rng = 0x9e3779b9u;
    double l1 = st[2], l2 = st[3], b1 = st[4], b2 = st[5], a1 = st[6], a2 = st[7], a3 = st[8];
    double nyq = .45 * e->rate;
    double ng = 0, na1 = 0, na2 = 0, na3 = 0, nk = 1.2, nd = 0;
    if (e->noise > 0 && e->ndecay > 0) {
        double fc = e->nfc < 20 ? 20 : e->nfc > nyq ? nyq : e->nfc, g = tan(PI * fc / e->rate);
        na1 = 1 / (1 + g * (g + nk)); na2 = g * na1; na3 = g * na2;
        nd = exp(-1 / e->ndecay); ng = e->noise * e->gain * exp(-age / e->ndecay);
        if (age > e->ndecay * 12) ng = 0;
    }
    for (int i = 0; i < n; i++) {
        double s = src[i];
        if (e->tau > 0) {
            if ((i & 15) == 0 || age == 0) {
                double fc = e->f0 * pow(2, e->lo + (e->hi - e->lo) * exp(-age / e->tau));
                fc = fc < 20 ? 20 : fc > nyq ? nyq : fc;
                double g = tan(PI * fc / e->rate);
                a1 = 1 / (1 + g * (g + 1.4142)); a2 = g * a1; a3 = g * a2;
            }
            double v3 = s - l2, v1 = a1 * l1 + a2 * v3, v2 = l2 + a2 * l1 + a3 * v3;
            l1 = 2 * v1 - l1; l2 = 2 * v2 - l2; s = v2;
        }
        if (ng > 1e-7) {
            rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
            double w = (double)rng / 2147483648.0 - 1;
            double v3 = w - b2, v1 = na1 * b1 + na2 * v3, v2 = b2 + na2 * b1 + na3 * v3;
            b1 = 2 * v1 - b1; b2 = 2 * v2 - b2;
            s += ng * nk * v1; ng *= nd;
        }
        out[i] += s; age += 1;
    }
    st[0] = age; st[1] = (double)rng; st[2] = l1; st[3] = l2; st[4] = b1; st[5] = b2; st[6] = a1; st[7] = a2; st[8] = a3;
}

/* ---------------------------------------------------------------- master stage
 * The last step before the sound card, on the stereo mix (replaces the Python limiter loop):
 *   1. trim:   makeup gain (the centre pan law halves every track, so the mix sat 6 dB low)
 *   2. glue:   a soft saturation that only bends the loudest peaks (tanh, slope 1 at zero)
 *   3. polish: 20 Hz high-pass (rumble, DC), a broad -1.2 dB dip at 3.2 kHz where the ear is touchiest,
 *              an 18.5 kHz low-pass for the brittle top (the Luna kit recipe)
 *   4. limit:  a look-ahead peak limiter on the estimated true peak (the point halfway between two
 *              samples is checked too), ceiling -1 dBTP, 1.5 ms look-ahead, about 80 ms release.
 * The look-ahead is a running minimum of the gain each sample needs, then a running average of that
 * minimum over the same window, with the audio delayed by the window less one sample: every gain that
 * reaches a sample is at or below what that sample needs, and the ramp down is smooth (no clicks). */
#define MS_LA 72
typedef struct {
    double rate, trim, drive, ceiling, rel;
    double c[3][5], z[3][2][2];          /* biquads: high-pass, presence dip, low-pass; state per channel */
    double dl[MS_LA], dr[MS_LA]; int w;  /* delay of MS_LA - 1 samples (slot MS_LA-1 unused) */
    double hist[2][3];                   /* the last three samples per channel, for the in-between peak */
    double qv[MS_LA + 1]; long qt_[MS_LA + 1]; int qh, qn; /* running minimum: ring deque */
    double ring[MS_LA]; double sum;      /* running average */
    long t, hot; double g, gr;           /* sample count, samples until rung out, gain, reduction (dB) */
} Master;

static void ms_coefs(Master *m) {
    double r = m->rate, w, cw, sw, al, a0, f;
    w = 2 * PI * 20 / r; cw = cos(w); sw = sin(w); al = sw / (2 * .7071); a0 = 1 + al;
    m->c[0][0] = (1 + cw) / 2 / a0; m->c[0][1] = -(1 + cw) / a0; m->c[0][2] = (1 + cw) / 2 / a0;
    m->c[0][3] = -2 * cw / a0; m->c[0][4] = (1 - al) / a0;
    biquad(m->c[1], 1, 3200, -1.2, .72, r);
    f = 18500 < .45 * r ? 18500 : .45 * r;
    w = 2 * PI * f / r; cw = cos(w); sw = sin(w); al = sw / (2 * .7071); a0 = 1 + al;
    m->c[2][0] = (1 - cw) / 2 / a0; m->c[2][1] = (1 - cw) / a0; m->c[2][2] = (1 - cw) / 2 / a0;
    m->c[2][3] = -2 * cw / a0; m->c[2][4] = (1 - al) / a0;
}

void *dsfx_master_create(double rate) {
    Master *m = calloc(1, sizeof(Master));
    if (!m) return NULL;
    m->rate = rate; m->trim = 2.0; m->drive = .2; m->ceiling = pow(10, -1.0 / 20); m->g = 1;
    m->rel = exp(-1.0 / (.08 * rate));
    for (int i = 0; i < MS_LA; i++) m->ring[i] = 1;
    m->sum = MS_LA;
    ms_coefs(m);
    return m;
}
void dsfx_master_destroy(void *m) { free(m); }
/* trim: linear makeup gain; drive 0..1 (0 = clean); ceiling in dBTP (for example -1) */
void dsfx_master_set(void *p, double trim, double drive, double ceiling_db) {
    Master *m = p; m->trim = trim; m->drive = drive < 0 ? 0 : drive > 1 ? 1 : drive; m->ceiling = pow(10, ceiling_db / 20);
}
double dsfx_master_gr(void *p) { return ((Master *)p)->gr; }

static inline double ms_bq(const double *c, double *z, double x) {
    double y = c[0] * x + z[0]; z[0] = c[1] * x - c[3] * y + z[1]; z[1] = c[2] * x - c[4] * y; return y;
}

static inline double ms_soft(double x) {
    /* tanh's Pade shape, exact enough for a gentle bend and a few times cheaper; flat past +-3 */
    if (x > 3) return 1; if (x < -3) return -1;
    double x2 = x * x; return x * (27 + x2) / (27 + 9 * x2);
}
void dsfx_master(void *p, double *left, double *right, int n) { ds_ftz();
    Master *m = p;
    const int CAP = MS_LA + 1;
    /* Silence in and everything rung out: nothing to do (and the output stays exactly zero). */
    int silent = 1;
    for (int i = 0; i < n && silent; i++) if (left[i] != 0 || right[i] != 0) silent = 0;
    if (silent && m->hot <= 0) { m->gr = 0; return; }
    if (!silent) m->hot = (long)(m->rate * .5); else m->hot -= n;
    if (m->hot <= 0) {
        /* just rung out: clear the filters, the look-ahead and the gain so the next sound starts clean */
        memset(m->z, 0, sizeof m->z); memset(m->dl, 0, sizeof m->dl); memset(m->dr, 0, sizeof m->dr);
        memset(m->hist, 0, sizeof m->hist); m->qh = m->qn = 0;
        for (int j = 0; j < MS_LA; j++) m->ring[j] = 1;
        m->sum = MS_LA; m->g = 1; m->gr = 0;
        for (int i = 0; i < n; i++) left[i] = right[i] = 0;
        return;
    }
    double k = m->drive, ceil_ = m->ceiling, low_g = 1;
    for (int i = 0; i < n; i++) {
        double l = left[i] * m->trim, r = right[i] * m->trim;
        if (k > 0) { l = ms_soft(l * k) / k; r = ms_soft(r * k) / k; }   /* slope 1 at zero; drive .3: -0.3 dB at full scale */
        for (int b = 0; b < 3; b++) { l = ms_bq(m->c[b], m->z[b][0], l); r = ms_bq(m->c[b], m->z[b][1], r); }
        double *hl = m->hist[0], *hr = m->hist[1];
        double ml = (-hl[0] + 9 * hl[1] + 9 * hl[2] - l) / 16, mr = (-hr[0] + 9 * hr[1] + 9 * hr[2] - r) / 16;
        hl[0] = hl[1]; hl[1] = hl[2]; hl[2] = l; hr[0] = hr[1]; hr[1] = hr[2]; hr[2] = r;
        double pk = fmax(fmax(fabs(l), fabs(r)), fmax(fabs(ml), fabs(mr)));
        double need = pk > ceil_ ? ceil_ / pk : 1;
        long t = m->t++;
        /* running minimum over the last MS_LA needs */
        while (m->qn > 0) {
            int last = (m->qh + m->qn - 1) % CAP;
            if (m->qv[last] >= need) m->qn--; else break;
        }
        int at = (m->qh + m->qn) % CAP; m->qv[at] = need; m->qt_[at] = t; m->qn++;
        while (m->qt_[m->qh] <= t - MS_LA) { m->qh = (m->qh + 1) % CAP; m->qn--; }
        double mn = m->qv[m->qh];
        /* running average of the minimum */
        int slot = (int)(t % MS_LA);
        m->sum += mn - m->ring[slot]; m->ring[slot] = mn;
        if ((t & 4095) == 0) { double s2 = 0; for (int j = 0; j < MS_LA; j++) s2 += m->ring[j]; m->sum = s2; }
        double s = m->sum / MS_LA; if (s > 1) s = 1;
        m->g = s < m->g ? s : m->g + (s - m->g) * (1 - m->rel);
        if (m->g < low_g) low_g = m->g;
        /* the sample from MS_LA - 1 samples ago comes out with the gain */
        int w = m->w; double ol = m->dl[w] * m->g, orr = m->dr[w] * m->g;
        m->dl[w] = l; m->dr[w] = r; m->w = (w + 1) % (MS_LA - 1);
        /* below -180 dB is silence: filter tails never leave a dust of tiny numbers behind */
        if (fabs(ol) < 1e-9) ol = 0; if (fabs(orr) < 1e-9) orr = 0;
        left[i] = ol > ceil_ ? ceil_ : ol < -ceil_ ? -ceil_ : ol;
        right[i] = orr > ceil_ ? ceil_ : orr < -ceil_ ? -ceil_ : orr;
    }
    m->gr = -20 * log10(low_g > 1e-9 ? low_g : 1e-9);
}
/* dsfx_master, then the two channels interleaved into out[2n] (what the audio queue takes). */
void dsfx_master_i(void *p, double *left, double *right, double *out, int n) {
    dsfx_master(p, left, right, n);
    for (int i = 0; i < n; i++) { out[2 * i] = left[i]; out[2 * i + 1] = right[i]; }
}

/* ---- Track buffers and the mix bus ------------------------------------------------------------------
 * The engine keeps each track's audio in fixed C buffers for the whole block; Python only hands these
 * routines pointers. The arithmetic below follows the Python mix it replaces term for term (same order,
 * no fused multiply-add), so a render comes out bit for bit the same. */

/* dst[i] += src[i] * g */
void dsfx_buf_add(double *dst, const double *src, int n, double g) {
    for (int i = 0; i < n; i++) dst[i] += src[i] * g;
}
/* dst[i] = (a[i] + b[i]) * .5 (dst may be a) */
void dsfx_buf_avg(double *dst, const double *a, const double *b, int n) {
    for (int i = 0; i < n; i++) dst[i] = (a[i] + b[i]) * .5;
}
/* Returns 1 when any sample is not zero (NaN counts, as in Python's any()), 0 for silence.
 * out[0] = 1 when every sample is finite, out[1] = the largest absolute value. */
int dsfx_buf_scan(const double *x, int n, double *out) {
    int any = 0, finite = 1; double peak = 0;
    for (int i = 0; i < n; i++) {
        double v = x[i];
        if (v != 0) any = 1;
        if (!isfinite(v)) finite = 0;
        double a = fabs(v); if (a > peak) peak = a;
    }
    if (out) { out[0] = finite; out[1] = peak; }
    return any;
}
/* One track into the mix and the two send buses: volume, pan (with a 5 ms glide toward its target),
 * and per-bus send amounts. *pan_state is the glide's current pan, updated in place. A send bus with
 * an amount of 0 (or a NULL buffer) is not fed. A silent block adds nothing and lets the pan settle. */
void dsfx_mix_track(const double *l, const double *r, int n, double vol, double pan, double *pan_state, double step,
                    double *ml, double *mr, double *s0l, double *s0r, double a0, double *s1l, double *s1r, double a1) {
    double cur = *pan_state;
    int f0 = s0l && a0 > 0, f1 = s1l && a1 > 0, any = 0;
    for (int i = 0; i < n && !any; i++) if (l[i] != 0 || r[i] != 0) any = 1;
    if (!any) { *pan_state = pan; return; }
    if (cur == pan) {
        double gl = vol * (1 - cur) * .5, gr = vol * (1 + cur) * .5;
        for (int i = 0; i < n; i++) {
            double x = l[i] * gl, y = r[i] * gr;
            ml[i] += x; mr[i] += y;
            if (f0) { s0l[i] += x * a0; s0r[i] += y * a0; }
            if (f1) { s1l[i] += x * a1; s1r[i] += y * a1; }
        }
    } else {
        for (int i = 0; i < n; i++) {
            double d = pan - cur; d = d > step ? step : d < -step ? -step : d; cur += d;
            double gl = vol * (1 - cur) * .5, gr = vol * (1 + cur) * .5;
            double x = l[i] * gl, y = r[i] * gr;
            ml[i] += x; mr[i] += y;
            if (f0) { s0l[i] += x * a0; s0r[i] += y * a0; }
            if (f1) { s1l[i] += x * a1; s1r[i] += y * a1; }
        }
    }
    *pan_state = cur;
}
/* A send bus's wet return into the mix: mix += (out - dry * in) * g, per channel. */
void dsfx_add_return(double *ml, double *mr, const double *ol, const double *or_, const double *il, const double *ir,
                     int n, double dry, double g) {
    for (int i = 0; i < n; i++) {
        ml[i] += (ol[i] - dry * il[i]) * g;
        if (mr) mr[i] += (or_[i] - dry * ir[i]) * g;
    }
}
