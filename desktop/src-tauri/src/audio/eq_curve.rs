use std::f64::consts::TAU;

use biquad::{Coefficients, Q_BUTTERWORTH_F64, Type};

use crate::audio::types::{
    EQ_BANDS, EQ_FREQS, EQ_MAX_GAIN_DB, EQ_PREAMP_MAX_DB, EQ_PREAMP_MIN_DB, EQ_Q,
};

pub const CURVE_RATE: f64 = 48_000.0;
const GRID_POINTS: usize = 121;
const FIT_ROUNDS: usize = 12;
const FIT_STEP_DB: f64 = 0.5;
const FIT_SMOOTHING: f64 = 0.02;

const FLAT: Coefficients<f64> = Coefficients {
    a1: 0.0,
    a2: 0.0,
    b0: 1.0,
    b1: 0.0,
    b2: 0.0,
};

pub fn design(
    shape: Type<f64>,
    frequency: f64,
    q: f64,
    sample_rate: f64,
) -> Option<Coefficients<f64>> {
    Coefficients::<f64>::from_normalized_params(shape, 2.0 * frequency / sample_rate, q).ok()
}

pub fn band_coefficients(band: usize, gain: f64, sample_rate: f64) -> Coefficients<f64> {
    let (filter, q) = if band == 0 {
        (Type::LowShelf(gain), Q_BUTTERWORTH_F64)
    } else if band == EQ_BANDS - 1 {
        (Type::HighShelf(gain), Q_BUTTERWORTH_F64)
    } else {
        (Type::PeakingEQ(gain), EQ_Q)
    };
    design(filter, EQ_FREQS[band], q, sample_rate).unwrap_or(FLAT)
}

pub fn magnitude_db(filter: &Coefficients<f64>, frequency: f64) -> f64 {
    let w = TAU * frequency / CURVE_RATE;
    let (sin1, cos1) = w.sin_cos();
    let (sin2, cos2) = (2.0 * w).sin_cos();
    let num_re = filter.b0 + filter.b1 * cos1 + filter.b2 * cos2;
    let num_im = filter.b1 * sin1 + filter.b2 * sin2;
    let den_re = 1.0 + filter.a1 * cos1 + filter.a2 * cos2;
    let den_im = filter.a1 * sin1 + filter.a2 * sin2;
    10.0 * ((num_re * num_re + num_im * num_im) / (den_re * den_re + den_im * den_im)).log10()
}

pub fn grid() -> Vec<f64> {
    (0..GRID_POINTS)
        .map(|i| 20.0 * 1000f64.powf(i as f64 / (GRID_POINTS - 1) as f64))
        .collect()
}

pub fn band_gains(gains: &[f64]) -> [f64; EQ_BANDS] {
    std::array::from_fn(|band| {
        gains
            .get(band)
            .copied()
            .filter(|gain| gain.is_finite())
            .unwrap_or(0.0)
            .clamp(-EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB)
    })
}

pub fn response_db(gains: &[f64; EQ_BANDS], frequency: f64) -> f64 {
    (0..EQ_BANDS)
        .map(|band| magnitude_db(&band_coefficients(band, gains[band], CURVE_RATE), frequency))
        .sum()
}

pub fn auto_preamp(gains: &[f64; EQ_BANDS]) -> f64 {
    let peak = grid()
        .into_iter()
        .map(|frequency| response_db(gains, frequency))
        .fold(0.0, f64::max);
    round_tenth(-peak)
}

pub fn resolve_preamp(gains: &[f64; EQ_BANDS], preamp: Option<f64>) -> f64 {
    preamp
        .filter(|value| value.is_finite())
        .unwrap_or_else(|| auto_preamp(gains))
        .clamp(EQ_PREAMP_MIN_DB, EQ_PREAMP_MAX_DB)
}

pub fn round_tenth(value: f64) -> f64 {
    let rounded = (value * 10.0).round() / 10.0;
    if rounded == 0.0 { 0.0 } else { rounded }
}

pub struct Fit {
    pub gains: [f64; EQ_BANDS],
    pub deviation: f64,
}

pub fn fit(target: &[f64]) -> Fit {
    let grid = grid();
    let mut gains = [0.0; EQ_BANDS];
    for _ in 0..FIT_ROUNDS {
        let curves = band_curves(&grid, &gains, 0.0);
        let raised = band_curves(&grid, &gains, FIT_STEP_DB);
        let slopes: Vec<Vec<f64>> = curves
            .iter()
            .zip(&raised)
            .map(|(curve, raised)| {
                curve
                    .iter()
                    .zip(raised)
                    .map(|(low, high)| (high - low) / FIT_STEP_DB)
                    .collect()
            })
            .collect();
        let residual: Vec<f64> = (0..grid.len())
            .map(|point| target[point] - curves.iter().map(|curve| curve[point]).sum::<f64>())
            .collect();

        let mut matrix = [[0.0; EQ_BANDS]; EQ_BANDS];
        let mut vector = [0.0; EQ_BANDS];
        for row in 0..EQ_BANDS {
            for column in 0..EQ_BANDS {
                matrix[row][column] = dot(&slopes[row], &slopes[column]);
            }
            matrix[row][row] += FIT_SMOOTHING;
            vector[row] = dot(&slopes[row], &residual) - FIT_SMOOTHING * gains[row];
        }
        let step = solve(matrix, vector);
        for band in 0..EQ_BANDS {
            gains[band] = (gains[band] + step[band]).clamp(-EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB);
        }
    }

    let gains = gains.map(round_tenth);
    let deviation = grid
        .iter()
        .zip(target)
        .map(|(&frequency, &wanted)| (wanted - response_db(&gains, frequency)).abs())
        .fold(0.0, f64::max);
    Fit {
        gains,
        deviation: round_tenth(deviation),
    }
}

fn band_curves(grid: &[f64], gains: &[f64; EQ_BANDS], extra: f64) -> Vec<Vec<f64>> {
    (0..EQ_BANDS)
        .map(|band| {
            let filter = band_coefficients(band, gains[band] + extra, CURVE_RATE);
            grid.iter()
                .map(|&frequency| magnitude_db(&filter, frequency))
                .collect()
        })
        .collect()
}

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}

fn solve(mut matrix: [[f64; EQ_BANDS]; EQ_BANDS], mut vector: [f64; EQ_BANDS]) -> [f64; EQ_BANDS] {
    for column in 0..EQ_BANDS {
        let pivot = (column..EQ_BANDS)
            .max_by(|&a, &b| matrix[a][column].abs().total_cmp(&matrix[b][column].abs()))
            .unwrap_or(column);
        matrix.swap(column, pivot);
        vector.swap(column, pivot);
        let lead = matrix[column][column];
        if lead.abs() < 1e-12 {
            continue;
        }
        for row in column + 1..EQ_BANDS {
            let factor = matrix[row][column] / lead;
            for k in column..EQ_BANDS {
                matrix[row][k] -= factor * matrix[column][k];
            }
            vector[row] -= factor * vector[column];
        }
    }
    let mut result = [0.0; EQ_BANDS];
    for row in (0..EQ_BANDS).rev() {
        let known: f64 = (row + 1..EQ_BANDS)
            .map(|k| matrix[row][k] * result[k])
            .sum();
        let lead = matrix[row][row];
        result[row] = if lead.abs() < 1e-12 {
            0.0
        } else {
            (vector[row] - known) / lead
        };
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASS_DESTROYER: [f64; EQ_BANDS] =
        [12.0, 12.0, 10.0, 7.0, 3.0, 0.0, -2.0, -4.0, -4.0, -5.0];

    #[test]
    fn auto_preamp_leaves_headroom_for_overlapping_boosts() {
        let preamp = auto_preamp(&BASS_DESTROYER);
        assert!(preamp < -12.0, "{preamp}");
        let peak = grid()
            .into_iter()
            .map(|frequency| response_db(&BASS_DESTROYER, frequency) + preamp)
            .fold(f64::MIN, f64::max);
        assert!(peak <= 0.06, "{peak}");
    }

    #[test]
    fn auto_preamp_is_zero_for_cuts() {
        assert_eq!(auto_preamp(&[-3.0; EQ_BANDS]), 0.0);
        assert_eq!(auto_preamp(&[0.0; EQ_BANDS]), 0.0);
    }

    #[test]
    fn manual_preamp_wins_and_is_clamped() {
        assert_eq!(resolve_preamp(&BASS_DESTROYER, Some(-3.0)), -3.0);
        assert_eq!(
            resolve_preamp(&BASS_DESTROYER, Some(-90.0)),
            EQ_PREAMP_MIN_DB
        );
    }

    #[test]
    fn fit_recovers_band_gains() {
        let gains = [4.0, -2.0, 3.0, 0.0, -5.0, 2.5, 0.0, 6.0, -1.0, 3.0];
        let target: Vec<f64> = grid()
            .into_iter()
            .map(|frequency| response_db(&gains, frequency))
            .collect();
        let fit = fit(&target);
        for band in 0..EQ_BANDS {
            assert!(
                (fit.gains[band] - gains[band]).abs() < 0.3,
                "{band}: {:?}",
                fit.gains
            );
        }
        assert!(fit.deviation < 0.3, "{}", fit.deviation);
    }

    #[test]
    fn fit_reports_what_it_cannot_follow() {
        let notch = design(Type::PeakingEQ(-15.0), 3000.0, 8.0, CURVE_RATE).unwrap();
        let target: Vec<f64> = grid()
            .into_iter()
            .map(|frequency| magnitude_db(&notch, frequency))
            .collect();
        let fit = fit(&target);
        assert!(fit.deviation > 5.0, "{}", fit.deviation);
        assert!(fit.gains.iter().all(|gain| gain.abs() <= EQ_MAX_GAIN_DB));
    }
}
