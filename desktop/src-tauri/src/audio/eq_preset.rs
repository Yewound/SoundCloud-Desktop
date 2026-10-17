use biquad::{Coefficients, Q_BUTTERWORTH_F64, Type};

use crate::audio::eq_curve::{self, CURVE_RATE, design, magnitude_db, response_db, round_tenth};
use crate::audio::types::{EQ_BANDS, EQ_FREQS, EQ_PREAMP_MAX_DB, EQ_PREAMP_MIN_DB, EQ_Q};

const GRAPHIC_STEP: f64 = 1.0563;
const SKIPPED_CHARS: usize = 60;

#[derive(serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum EqFormat {
    Apo,
    Graphic,
}

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EqImport {
    pub gains: [f64; EQ_BANDS],
    pub preamp: Option<f64>,
    pub used: usize,
    pub skipped: Vec<String>,
    pub deviation: f64,
}

enum Line {
    Filter(Coefficients<f64>),
    Off,
    Unsupported,
}

pub fn decode(bytes: &[u8]) -> String {
    match bytes {
        [0xFF, 0xFE, rest @ ..] => {
            let units: Vec<u16> = rest
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            String::from_utf16_lossy(&units)
        }
        [0xEF, 0xBB, 0xBF, rest @ ..] => String::from_utf8_lossy(rest).into_owned(),
        _ => String::from_utf8_lossy(bytes).into_owned(),
    }
}

pub fn import(text: &str) -> Result<EqImport, String> {
    let mut filters = Vec::new();
    let mut graphics: Vec<Vec<(f64, f64)>> = Vec::new();
    let mut preamp: Option<f64> = None;
    let mut skipped = Vec::new();
    let mut first_channel = true;

    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let is_eq = key == "preamp" || key == "graphiceq" || key.starts_with("filter");
        if key == "channel" {
            first_channel = value
                .split_whitespace()
                .any(|channel| matches!(channel.to_ascii_lowercase().as_str(), "all" | "l" | "1"));
            continue;
        }
        if !is_eq {
            continue;
        }
        if !first_channel {
            if key != "preamp" {
                skipped.push(line.chars().take(SKIPPED_CHARS).collect());
            }
            continue;
        }
        if key == "preamp" {
            let gain = value
                .split_whitespace()
                .next()
                .and_then(number)
                .ok_or("bad preamp")?;
            preamp = Some(preamp.unwrap_or(0.0) + gain);
        } else if key == "graphiceq" {
            graphics.push(graphic_points(value));
        } else {
            match filter(value) {
                Line::Filter(coefficients) => filters.push(coefficients),
                Line::Off => {}
                Line::Unsupported => skipped.push(line.chars().take(SKIPPED_CHARS).collect()),
            }
        }
    }

    graphics.retain(|points| !points.is_empty());
    if filters.is_empty() && graphics.is_empty() {
        return Err("no filters".into());
    }

    let target: Vec<f64> = eq_curve::grid()
        .into_iter()
        .map(|frequency| {
            let parametric: f64 = filters
                .iter()
                .map(|filter| magnitude_db(filter, frequency))
                .sum();
            let graphic: f64 = graphics
                .iter()
                .map(|points| interpolate(points, frequency))
                .sum();
            parametric + graphic
        })
        .collect();
    let level = if graphics.is_empty() {
        0.0
    } else {
        round_tenth(median(&target))
    };
    let shape: Vec<f64> = target.iter().map(|value| value - level).collect();
    let fit = eq_curve::fit(&shape);
    let preamp = match preamp {
        Some(gain) => Some(gain + level),
        None => (level < 0.0).then_some(level),
    }
    .map(|gain| round_tenth(gain.clamp(EQ_PREAMP_MIN_DB, EQ_PREAMP_MAX_DB)));

    Ok(EqImport {
        gains: fit.gains,
        preamp,
        used: filters.len() + graphics.len(),
        skipped,
        deviation: fit.deviation,
    })
}

pub fn export(gains: &[f64; EQ_BANDS], preamp: f64, format: EqFormat) -> String {
    match format {
        EqFormat::Apo => {
            let mut text = format!("Preamp: {preamp:.1} dB\n");
            for band in 0..EQ_BANDS {
                let (kind, q) = if band == 0 {
                    ("LSC", Q_BUTTERWORTH_F64)
                } else if band == EQ_BANDS - 1 {
                    ("HSC", Q_BUTTERWORTH_F64)
                } else {
                    ("PK", EQ_Q)
                };
                text.push_str(&format!(
                    "Filter {}: ON {kind} Fc {} Hz Gain {:.1} dB Q {q:.2}\n",
                    band + 1,
                    EQ_FREQS[band],
                    gains[band],
                ));
            }
            text
        }
        EqFormat::Graphic => {
            let points: Vec<String> = graphic_frequencies()
                .into_iter()
                .map(|frequency| {
                    let gain = round_tenth(response_db(gains, frequency) + preamp);
                    format!("{frequency} {gain:.1}")
                })
                .collect();
            format!("GraphicEQ: {}\n", points.join("; "))
        }
    }
}

fn graphic_frequencies() -> Vec<f64> {
    let mut frequencies: Vec<f64> = (0..)
        .map(|step| (20.0 * GRAPHIC_STEP.powi(step)).round())
        .take_while(|&frequency| frequency <= 20_000.0)
        .collect();
    frequencies.dedup();
    frequencies
}

fn number(token: &str) -> Option<f64> {
    token
        .replace(',', ".")
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
}

fn filter(value: &str) -> Line {
    let tokens: Vec<&str> = value.split_whitespace().collect();
    if tokens.first().map(|state| state.eq_ignore_ascii_case("on")) != Some(true) {
        return Line::Off;
    }
    let Some(kind) = tokens.get(1).map(|kind| kind.to_ascii_uppercase()) else {
        return Line::Off;
    };

    let mut frequency = None;
    let mut gain = 0.0;
    let mut q = None;
    let mut index = 2;
    while index < tokens.len() {
        let key = tokens[index].to_ascii_lowercase();
        let next = tokens.get(index + 1).copied().and_then(number);
        match key.as_str() {
            "fc" => {
                let scale = match tokens.get(index + 2) {
                    Some(unit) if unit.eq_ignore_ascii_case("khz") => 1000.0,
                    _ => 1.0,
                };
                frequency = next.map(|value| value * scale);
            }
            "gain" => gain = next.unwrap_or(0.0),
            "q" => q = next,
            "bw" => {
                let octaves = tokens.get(index + 2).copied().and_then(number);
                q = octaves.map(|octaves| {
                    let width = 2f64.powf(octaves);
                    width.sqrt() / (width - 1.0)
                });
            }
            _ => {}
        }
        index += 1;
    }

    let Some(frequency) = frequency.filter(|&frequency| frequency > 0.0) else {
        return Line::Unsupported;
    };
    let shape = match kind.as_str() {
        "PK" | "PEQ" => Type::PeakingEQ(gain),
        "LS" | "LSC" | "LSQ" => Type::LowShelf(gain),
        "HS" | "HSC" | "HSQ" => Type::HighShelf(gain),
        _ => return Line::Unsupported,
    };
    let q = q
        .filter(|&q| q > 0.0)
        .unwrap_or(if matches!(shape, Type::PeakingEQ(_)) {
            EQ_Q
        } else {
            Q_BUTTERWORTH_F64
        });
    match design(shape, frequency, q, CURVE_RATE) {
        Some(coefficients) => Line::Filter(coefficients),
        None => Line::Unsupported,
    }
}

fn graphic_points(value: &str) -> Vec<(f64, f64)> {
    let mut points: Vec<(f64, f64)> = value
        .split(';')
        .filter_map(|pair| {
            let mut parts = pair.split_whitespace();
            let frequency = parts.next().and_then(number)?;
            let gain = parts.next().and_then(number)?;
            (frequency > 0.0).then_some((frequency, gain))
        })
        .collect();
    points.sort_by(|a, b| a.0.total_cmp(&b.0));
    points
}

fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    sorted[sorted.len() / 2]
}

fn interpolate(points: &[(f64, f64)], frequency: f64) -> f64 {
    let after = points.partition_point(|&(at, _)| at < frequency);
    if after == 0 {
        return points[0].1;
    }
    if after == points.len() {
        return points[points.len() - 1].1;
    }
    let (low_frequency, low_gain) = points[after - 1];
    let (high_frequency, high_gain) = points[after];
    let position = (frequency / low_frequency).ln() / (high_frequency / low_frequency).ln();
    low_gain + (high_gain - low_gain) * position
}

#[cfg(test)]
mod tests {
    use super::*;

    const GAINS: [f64; EQ_BANDS] = [5.0, 3.0, 0.0, -2.0, -1.5, 0.0, 2.0, 4.0, -3.0, 1.0];

    fn close(a: &[f64; EQ_BANDS], b: &[f64; EQ_BANDS], tolerance: f64) -> bool {
        a.iter().zip(b).all(|(a, b)| (a - b).abs() <= tolerance)
    }

    #[test]
    fn apo_export_imports_back() {
        let text = export(&GAINS, -5.5, EqFormat::Apo);
        assert!(
            text.starts_with("Preamp: -5.5 dB\nFilter 1: ON LSC Fc 32 Hz Gain 5.0 dB Q 0.71\n")
        );
        let imported = import(&text).unwrap();
        assert!(close(&imported.gains, &GAINS, 0.15), "{:?}", imported.gains);
        assert_eq!(imported.preamp, Some(-5.5));
        assert_eq!(imported.used, EQ_BANDS);
        assert!(imported.skipped.is_empty());
        assert!(imported.deviation <= 0.2, "{}", imported.deviation);
    }

    #[test]
    fn graphic_export_imports_back() {
        let preamp = eq_curve::auto_preamp(&GAINS);
        let text = export(&GAINS, preamp, EqFormat::Graphic);
        assert!(text.starts_with("GraphicEQ: 20 "));
        assert_eq!(text.matches(';').count() + 1, graphic_frequencies().len());
        let imported = import(&text).unwrap();
        let restored = imported.preamp.unwrap_or(0.0);
        for frequency in eq_curve::grid() {
            let original = response_db(&GAINS, frequency) + preamp;
            let back = response_db(&imported.gains, frequency) + restored;
            assert!(
                (original - back).abs() < 0.6,
                "{frequency}: {original} {back}"
            );
        }
    }

    #[test]
    fn reads_peace_and_apo_variants() {
        let text = "\
# headphone correction
Device: Speakers
Preamp: -6.2 dB
Filter1: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.70
Filter 2: ON PK Fc 2,2 kHz Gain -3 dB BW Oct 1.0
Filter 3: OFF PK Fc 500 Hz Gain 9 dB Q 1
Filter 4: ON HP Fc 20 Hz
Filter 5: ON HSC Fc 10000 Hz Gain -2.5 dB Q 0.7
Channel: R
Filter 6: ON PK Fc 1000 Hz Gain 6 dB Q 1
Channel: all
Filter 7: ON PK Fc 6000 Hz Gain 2 dB Q 3
";
        let imported = import(text).unwrap();
        assert_eq!(imported.used, 4);
        assert_eq!(
            imported.skipped,
            vec![
                "Filter 4: ON HP Fc 20 Hz",
                "Filter 6: ON PK Fc 1000 Hz Gain 6 dB Q 1"
            ]
        );
        assert_eq!(imported.preamp, Some(-6.2));
        assert!(imported.gains[1] > 2.0, "{:?}", imported.gains);
        assert!(imported.gains[6] < -2.0, "{:?}", imported.gains);
        assert!(imported.deviation > 0.0);
    }

    #[test]
    fn autoeq_graphic_line_keeps_its_level_as_preamp() {
        let text = "GraphicEQ: 20 -1.0; 60 -1.0; 200 -7.0; 20000 -7.0";
        let imported = import(text).unwrap();
        assert_eq!(imported.preamp, Some(-7.0));
        assert!(imported.gains[0] > 3.0, "{:?}", imported.gains);
    }

    #[test]
    fn rejects_text_without_filters() {
        assert!(import("hello\nPreamp: -3 dB").is_err());
        assert!(import("").is_err());
    }

    #[test]
    fn decodes_utf16_and_bom() {
        let mut utf16 = vec![0xFF, 0xFE];
        utf16.extend("Preamp: -1 dB".encode_utf16().flat_map(u16::to_le_bytes));
        assert_eq!(decode(&utf16), "Preamp: -1 dB");
        assert_eq!(decode(b"\xEF\xBB\xBFPreamp"), "Preamp");
    }
}
