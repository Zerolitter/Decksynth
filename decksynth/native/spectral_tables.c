/* DeckSynth-original bounded table preparation. No allocation or audio scheduling. */
#include <math.h>

double spectral_bound_table(double *table, int size) {
    if (!table || size < 1 || size > 4096) return 1.0;
    double peak = 1.0;
    for (int i = 0; i < size; ++i) {
        double value = fabs(table[i]);
        if (value > peak) peak = value;
    }
    if (peak > 1.0)
        for (int i = 0; i < size; ++i) table[i] /= peak;
    return peak;
}
