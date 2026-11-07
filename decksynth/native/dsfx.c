/* DeckSynth FX chain: 16 mono effect modules processed in blocks.
 * Written for DeckSynth; module set follows the user's PrismFX reference,
 * all DSP here is original and generic (SVF, Schroeder/Freeverb-style reverb, etc.).
 * Build: gcc -O2 -fPIC -shared -o libdsfx.so dsfx.c -lm
 */
#include <math.h>
#include <stdlib.h>
#include <string.h>

#define NMOD 17
#define NPAR 6
#define PI 3.14159265358979323846

enum { STUTTER, FILTER, OVERDRIVE, BITCRUSH, VOLUME, PHASER, FLANGER, RINGMOD, DELAY, REVERB, TIMEFX,
       CHORUS, COMP, EQ, AUTOWAH, RESONATOR, AUDIOGATE };

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

typedef struct {
    double rate;
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
} FxTrack;

FxTrack *dsfx_create(double rate) {
    FxTrack *t = calloc(1, sizeof(FxTrack));
    if (t) t->rate = rate;
    return t;
}
void dsfx_destroy(FxTrack *t) { free(t); }
void dsfx_reset(FxTrack *t) { double r = t->rate; memset(t, 0, sizeof(FxTrack)); t->rate = r; }
void dsfx_levels(FxTrack *t, double *out) { memcpy(out, t->level, sizeof(t->level)); }
/* Gain reduction of the compressor in dB, for its meter. */
double dsfx_comp_gr(FxTrack *t) { return t->cmp_gr; }

static double clampd(double x, double lo, double hi) { return x < lo ? lo : x > hi ? hi : x; }
static double soft(double x) { return tanh(x); }

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
            float *buf = t->comb[c]; int w = t->comb_w[c];
            double o = buf[w];
            t->comb_lp[c] = o * (1 - damp) + t->comb_lp[c] * damp;
            buf[w] = (float)(in + t->comb_lp[c] * room);
            t->comb_w[c] = (w + 1) % COMB_LEN[c];
            acc += o;
        }
        for (int a = 0; a < 2; a++) {
            float *buf = t->ap[a]; int w = t->ap_w[a];
            double bo = buf[w], o = -acc + bo;
            buf[w] = (float)(acc + bo * 0.5);
            t->ap_w[a] = (w + 1) % AP_LEN[a];
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
            double d = base + v * 0.004 * t->rate + sweep * (0.5 + 0.5 * sin(t->cho_lfo + v * 2.0944));
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

static void run_module(FxTrack *t, int m, double *b, int n, const double *p, double bpm) {
    switch (m) {
        case STUTTER: m_stutter(t, b, n, p, bpm); break;
        case FILTER: m_filter(t, b, n, p); break;
        case OVERDRIVE: m_drive(b, n, p); break;
        case BITCRUSH: m_bitcrush(t, b, n, p); break;
        case VOLUME: m_volume(b, n, p); break;
        case PHASER: m_phaser(t, b, n, p); break;
        case FLANGER: m_flanger(t, b, n, p); break;
        case RINGMOD: m_ringmod(t, b, n, p); break;
        case DELAY: m_delay(t, b, n, p, bpm); break;
        case REVERB: m_reverb(t, b, n, p); break;
        case TIMEFX: m_time(t, b, n, p); break;
        case CHORUS: m_chorus(t, b, n, p); break;
        case COMP: m_comp(t, b, n, p); break;
        case EQ: m_eq(t, b, n, p); break;
        case AUTOWAH: m_autowah(t, b, n, p); break;
        case RESONATOR: m_resonator(t, b, n, p); break;
        case AUDIOGATE: m_gate(t, b, n, p, bpm); break;
    }
}

/* order: NMOD module ids in chain order; on: NMOD flags (by module id);
 * params: NMOD*NPAR values (by module id).
 * The block runs in 16-sample chunks: parameters glide from last block's values to these, and an effect
 * that is switched on or off crossfades with the dry sound over 10 ms. Jumps in either click. */
void dsfx_process(FxTrack *t, double *b, int n, const int *order, const int *on, const double *params, double bpm) {
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
int dsfx_voice(double *out, int n, const double *tab, const double *prev, double *st, int released,
               double step, double gain, double a, double d, double sus, double rel) {
    double phase = st[0], age = st[1], r = st[2], base = st[3], level = st[4], xf = st[5];
    int result = 0;
    for (int i = 0; i < n; i++) {
        if (released) {
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
    for (int i = 0; i < n; i++) {
        if (v->released) {
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

int dsfx_voice2(double *out, int n, const double *tab, const double *prev, double *st, const DsVoice *v) {
    return voice_ext(out,n,tab,prev,st,v,NULL);
}
int dsfx_voice3(double *out, int n, const double *tab, const double *prev, double *st, const DsVoice *v, const DsFilter *f) {
    return voice_ext(out,n,tab,prev,st,v,f);
}
