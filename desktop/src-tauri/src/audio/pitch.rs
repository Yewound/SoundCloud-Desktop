use std::collections::VecDeque;
use std::f32::consts::FRAC_PI_2;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use rodio::Source;
use rodio::source::SeekError;
use signalsmith_stretch::Stretch;

use crate::audio::types::{ChannelCount, SampleRate, frames_in};

const BLOCK: Duration = Duration::from_millis(10);
const FADE: Duration = Duration::from_millis(40);
const TONALITY_LIMIT_HZ: f32 = 8000.0;

fn block_frames(sample_rate: SampleRate) -> usize {
    frames_in(BLOCK, sample_rate).max(64)
}

fn is_unity(ratio: f32) -> bool {
    (ratio - 1.0).abs() < 1e-3
}

pub struct PitchSource<S: Source<Item = f32>> {
    source: S,
    ratio: Arc<AtomicU32>,
    channels: ChannelCount,
    sample_rate: SampleRate,
    span_len: usize,
    channel: usize,
    started: bool,
    shifter: Option<Shifter>,
}

impl<S: Source<Item = f32>> PitchSource<S> {
    pub fn new(source: S, ratio: Arc<AtomicU32>) -> Self {
        let channels = source.channels();
        let sample_rate = source.sample_rate();
        Self {
            source,
            ratio,
            channels,
            sample_rate,
            span_len: block_frames(sample_rate) * channels.get() as usize,
            channel: 0,
            started: false,
            shifter: None,
        }
    }

    fn ratio(&self) -> f32 {
        f32::from_bits(self.ratio.load(Ordering::Relaxed))
    }

    fn switch_mode(&mut self, ratio: f32) {
        if self.shifter.as_ref().is_some_and(Shifter::done) {
            self.shifter = None;
        }
        if self.shifter.is_none() && !is_unity(ratio) {
            let mix = if self.started { 0.0 } else { 1.0 };
            self.shifter = Some(Shifter::new(self.channels, self.sample_rate, mix));
        }
    }
}

impl<S: Source<Item = f32>> Iterator for PitchSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let ratio = self.ratio();
        if self.channel == 0 {
            self.switch_mode(ratio);
        }
        let sample = match self.shifter.as_mut() {
            Some(shifter) => shifter.next(&mut self.source, ratio)?,
            None => self.source.next()?,
        };
        self.channel = (self.channel + 1) % self.channels.get() as usize;
        self.started = true;
        Some(sample)
    }
}

impl<S: Source<Item = f32>> Source for PitchSource<S> {
    fn current_span_len(&self) -> Option<usize> {
        Some(self.span_len)
    }

    fn channels(&self) -> ChannelCount {
        self.channels
    }

    fn sample_rate(&self) -> SampleRate {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        self.source.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.source.try_seek(pos)?;
        let ratio = self.ratio();
        match self.shifter.as_mut() {
            Some(shifter) if !shifter.draining => {
                shifter.restart();
                for _ in 0..self.channel {
                    shifter.next(&mut self.source, ratio);
                }
            }
            Some(_) => {
                self.shifter = None;
                for _ in 0..self.channel {
                    self.source.next();
                }
            }
            None => {}
        }
        Ok(())
    }
}

struct Shifter {
    stretch: Stretch,
    channels: usize,
    block: usize,
    fade_step: f32,
    tonality_limit: f32,
    factor: f32,
    input: Vec<f32>,
    processed: Vec<f32>,
    raw: VecDeque<f32>,
    out: Vec<f32>,
    out_pos: usize,
    mix: f32,
    primed: bool,
    source_done: bool,
    draining: bool,
}

impl Shifter {
    fn new(channels: ChannelCount, sample_rate: SampleRate, mix: f32) -> Self {
        let count = channels.get() as usize;
        Self {
            stretch: Stretch::preset_default(count as u32, sample_rate.get()),
            channels: count,
            block: block_frames(sample_rate),
            fade_step: 1.0 / frames_in(FADE, sample_rate).max(1) as f32,
            tonality_limit: TONALITY_LIMIT_HZ / sample_rate.get() as f32,
            factor: 1.0,
            input: Vec::new(),
            processed: Vec::new(),
            raw: VecDeque::new(),
            out: Vec::new(),
            out_pos: 0,
            mix,
            primed: false,
            source_done: false,
            draining: false,
        }
    }

    fn done(&self) -> bool {
        self.draining && self.raw.is_empty() && self.out_pos == self.out.len()
    }

    fn restart(&mut self) {
        self.stretch.reset();
        self.raw.clear();
        self.out.clear();
        self.out_pos = 0;
        self.primed = false;
        self.source_done = false;
    }

    fn next<S: Source<Item = f32>>(&mut self, source: &mut S, ratio: f32) -> Option<f32> {
        if self.out_pos == self.out.len() {
            self.render(source, ratio);
            if self.out.is_empty() {
                return None;
            }
        }
        let sample = self.out[self.out_pos];
        self.out_pos += 1;
        Some(sample)
    }

    fn read<S: Source<Item = f32>>(&mut self, source: &mut S, frames: usize) {
        self.input.clear();
        for _ in 0..frames {
            let frame_start = self.raw.len();
            for _ in 0..self.channels {
                let sample = if self.source_done {
                    None
                } else {
                    source.next()
                };
                match sample {
                    Some(sample) => {
                        self.input.push(sample);
                        self.raw.push_back(sample);
                    }
                    None => {
                        self.source_done = true;
                        self.input.push(0.0);
                    }
                }
            }
            if self.source_done {
                self.raw.truncate(frame_start);
            }
        }
        self.processed.resize(self.input.len(), 0.0);
        self.stretch.process(&self.input, &mut self.processed);
    }

    fn render<S: Source<Item = f32>>(&mut self, source: &mut S, ratio: f32) {
        self.out.clear();
        self.out_pos = 0;
        if self.draining {
            let take = (self.block * self.channels).min(self.raw.len());
            self.out.extend(self.raw.drain(..take));
            return;
        }

        if ratio != self.factor {
            self.stretch
                .set_transpose_factor(ratio, Some(self.tonality_limit));
            self.factor = ratio;
        }
        if !self.primed {
            let delay = self.stretch.input_latency() + self.stretch.output_latency();
            self.read(source, delay);
            self.primed = true;
        }
        self.read(source, self.block);

        let channels = self.channels;
        let target = if is_unity(ratio) { 0.0 } else { 1.0 };
        let frames = self.block.min(self.raw.len() / channels);
        for frame in 0..frames {
            self.mix = if target > self.mix {
                (self.mix + self.fade_step).min(1.0)
            } else {
                (self.mix - self.fade_step).max(0.0)
            };
            let wet = (self.mix * FRAC_PI_2).sin().powi(2);
            for channel in 0..channels {
                let index = frame * channels + channel;
                let dry = self.raw[index];
                self.out.push(dry + (self.processed[index] - dry) * wet);
            }
        }
        self.raw.drain(..frames * channels);
        self.draining = target == 0.0 && self.mix == 0.0;
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZero;

    use rodio::Player;
    use rodio::buffer::SamplesBuffer;
    use rustfft::FftPlanner;
    use rustfft::num_complex::Complex;

    use super::*;

    const RATE: u32 = 48_000;

    fn sine(frequency: f32, seconds: f32) -> SamplesBuffer {
        let frames = (RATE as f32 * seconds) as usize;
        let samples = (0..frames)
            .flat_map(|i| {
                let value =
                    (i as f32 / RATE as f32 * frequency * std::f32::consts::TAU).sin() * 0.5;
                [value, value]
            })
            .collect::<Vec<_>>();
        SamplesBuffer::new(
            NonZero::new(2).unwrap(),
            NonZero::new(RATE).unwrap(),
            samples,
        )
    }

    fn noise(seconds: f32) -> SamplesBuffer {
        let mut state = 0x1234_5678u32;
        let samples = (0..(RATE as f32 * seconds) as usize)
            .flat_map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let value = ((state >> 8) as f32 / (1 << 24) as f32 - 0.5) * 0.5;
                [value, value]
            })
            .collect::<Vec<_>>();
        SamplesBuffer::new(
            NonZero::new(2).unwrap(),
            NonZero::new(RATE).unwrap(),
            samples,
        )
    }

    fn shifted(ratio: f32) -> Vec<f32> {
        let ratio = Arc::new(AtomicU32::new(ratio.to_bits()));
        PitchSource::new(sine(440.0, 2.0), ratio).collect()
    }

    fn left(samples: &[f32]) -> Vec<f32> {
        samples.iter().step_by(2).copied().collect()
    }

    fn frequency(samples: &[f32]) -> f32 {
        let left = left(samples);
        let middle = &left[left.len() / 4..left.len() * 3 / 4];
        let crossings = middle
            .windows(2)
            .filter(|pair| pair[0] < 0.0 && pair[1] >= 0.0)
            .count();
        crossings as f32 / (middle.len() as f32 / RATE as f32)
    }

    fn power_spectrum(samples: &[f32], size: usize) -> Vec<f32> {
        let left = left(samples);
        let start = (left.len() - size) / 2;
        let mut buffer = left[start..start + size]
            .iter()
            .enumerate()
            .map(|(i, &sample)| {
                let window = 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / size as f32).cos();
                Complex::new(sample * window, 0.0)
            })
            .collect::<Vec<_>>();
        FftPlanner::new()
            .plan_fft_forward(size)
            .process(&mut buffer);
        buffer[..size / 2]
            .iter()
            .map(|bin| bin.norm_sqr())
            .collect()
    }

    fn level_spread(samples: &[f32]) -> f32 {
        let left = left(samples);
        let levels = left
            .chunks(RATE as usize / 100)
            .map(|chunk| {
                chunk.iter().map(|sample| sample * sample).sum::<f32>() / chunk.len() as f32
            })
            .collect::<Vec<_>>();
        let middle = &levels[levels.len() / 4..levels.len() * 3 / 4];
        let mean = middle.iter().sum::<f32>() / middle.len() as f32;
        let variance = middle
            .iter()
            .map(|level| (level - mean).powi(2))
            .sum::<f32>()
            / middle.len() as f32;
        variance.sqrt() / mean
    }

    fn largest_step(samples: &[f32]) -> f32 {
        left(samples)
            .windows(2)
            .map(|pair| (pair[1] - pair[0]).abs())
            .fold(0.0, f32::max)
    }

    fn close_to(measured: f32, expected: f32) -> bool {
        (measured / expected - 1.0).abs() < 0.03
    }

    #[test]
    fn unity_ratio_passes_samples_through() {
        let expected = sine(440.0, 2.0).collect::<Vec<_>>();
        assert_eq!(shifted(1.0), expected);
    }

    #[test]
    fn shifts_pitch_and_keeps_length() {
        for ratio in [0.25f32, 0.5, 0.8, 1.5, 2.0, 4.0] {
            let output = shifted(ratio);
            assert_eq!(output.len(), 4 * RATE as usize, "{ratio}");
            let measured = frequency(&output);
            assert!(
                (measured / (440.0 * ratio) - 1.0).abs() < 0.03,
                "{ratio}: {measured}"
            );
        }
    }

    #[test]
    fn starts_shifted_from_the_first_sample() {
        let head = left(&shifted(1.5))[..RATE as usize / 25].to_vec();
        let window =
            |i: usize| 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / head.len() as f32).cos();
        let power = |frequency: f32| -> f32 {
            let mut re = 0.0;
            let mut im = 0.0;
            for (i, sample) in head.iter().enumerate() {
                let phase = std::f32::consts::TAU * frequency * i as f32 / RATE as f32;
                re += sample * window(i) * phase.cos();
                im -= sample * window(i) * phase.sin();
            }
            re * re + im * im
        };
        assert!(
            power(440.0) < power(660.0) * 0.01,
            "{} {}",
            power(440.0),
            power(660.0)
        );
    }

    #[test]
    fn switching_on_mid_track_fades_in() {
        let ratio = Arc::new(AtomicU32::new(1.0f32.to_bits()));
        let mut source = PitchSource::new(sine(440.0, 2.0), ratio.clone());
        let mut output = source.by_ref().take(RATE as usize).collect::<Vec<_>>();
        ratio.store(1.5f32.to_bits(), Ordering::Relaxed);
        output.extend(source.take(RATE as usize));
        assert!(largest_step(&output) < 0.06, "{}", largest_step(&output));
        let shifted = &output[RATE as usize * 6 / 5..];
        assert!(
            close_to(frequency(shifted), 660.0),
            "{}",
            frequency(shifted)
        );
    }

    #[test]
    fn shifted_tone_has_no_side_bands() {
        const SIZE: usize = 32_768;
        let bin_hz = RATE as f32 / SIZE as f32;
        for semitones in [2.0f32, 5.0, 7.0, 12.0] {
            let ratio = 2f32.powf(semitones / 12.0);
            let spectrum = power_spectrum(&shifted(ratio), SIZE);
            let peak = (0..spectrum.len())
                .max_by(|&a, &b| spectrum[a].total_cmp(&spectrum[b]))
                .unwrap();
            let expected = 440.0 * ratio;
            assert!(
                (peak as f32 * bin_hz / expected - 1.0).abs() < 0.005,
                "{semitones}: {peak}"
            );

            let around = (8.0 / bin_hz) as usize;
            let total = spectrum.iter().sum::<f32>();
            let tone = spectrum[peak - around..=peak + around].iter().sum::<f32>();
            let side_db = 10.0 * ((total - tone) / total).log10();
            assert!(side_db < -40.0, "{semitones}: {side_db} dB");
        }
    }

    #[test]
    fn shifted_noise_keeps_its_level_and_highs() {
        const SIZE: usize = 65_536;
        let bin_hz = RATE as f32 / SIZE as f32;
        let highs = |samples: &[f32]| -> f32 {
            let band = (6000.0 / bin_hz) as usize..(10_000.0 / bin_hz) as usize;
            power_spectrum(samples, SIZE)[band].iter().sum()
        };
        let input = noise(4.0).collect::<Vec<_>>();
        let (input_spread, input_highs) = (level_spread(&input), highs(&input));
        for semitones in [1.0f32, 3.0, 7.0, -5.0] {
            let ratio = Arc::new(AtomicU32::new(2f32.powf(semitones / 12.0).to_bits()));
            let output = PitchSource::new(noise(4.0), ratio).collect::<Vec<_>>();
            let spread = level_spread(&output);
            assert!(
                spread < input_spread * 2.0,
                "{semitones}: {spread} vs {input_spread}"
            );
            let highs_db = 10.0 * (highs(&output) / input_highs).log10();
            assert!(highs_db > -4.0, "{semitones}: {highs_db} dB");
        }
    }

    #[test]
    fn output_stays_aligned_with_input() {
        let input = (0..RATE as usize * 2)
            .map(|i| {
                let t = i as f32 / RATE as f32;
                let burst = if (0.5..0.7).contains(&t) { 0.5 } else { 0.0 };
                (std::f32::consts::TAU * 440.0 * t).sin() * burst
            })
            .flat_map(|value| [value, value])
            .collect::<Vec<_>>();
        let buffer = SamplesBuffer::new(
            NonZero::new(2).unwrap(),
            NonZero::new(RATE).unwrap(),
            input.clone(),
        );
        let ratio = Arc::new(AtomicU32::new(1.5f32.to_bits()));
        let output = PitchSource::new(buffer, ratio).collect::<Vec<_>>();

        let centre = |samples: &[f32]| -> f32 {
            let left = left(samples);
            let energy = left.iter().map(|sample| sample * sample).sum::<f32>();
            let moment = left
                .iter()
                .enumerate()
                .map(|(i, sample)| i as f32 * sample * sample)
                .sum::<f32>();
            moment / energy / RATE as f32
        };
        let shift = centre(&output) - centre(&input);
        assert!(shift.abs() < 0.003, "{shift}");
    }

    #[test]
    fn seek_keeps_channel_order() {
        let ratio = Arc::new(AtomicU32::new(1.5f32.to_bits()));
        let samples = sine(440.0, 2.0)
            .enumerate()
            .map(|(i, sample)| if i % 2 == 0 { sample } else { 0.0 })
            .collect::<Vec<_>>();
        let buffer = SamplesBuffer::new(
            NonZero::new(2).unwrap(),
            NonZero::new(RATE).unwrap(),
            samples,
        );
        let mut source = PitchSource::new(buffer, ratio);
        source.by_ref().take(RATE as usize + 1).for_each(drop);
        source.try_seek(Duration::from_millis(200)).unwrap();
        let after = source.take(RATE as usize).collect::<Vec<_>>();
        let energy = |offset: usize| -> f32 {
            after
                .iter()
                .skip(offset)
                .step_by(2)
                .map(|sample| sample * sample)
                .sum()
        };
        assert!(energy(0) < energy(1) * 1e-3, "{} {}", energy(0), energy(1));
    }

    #[test]
    fn speed_changes_reach_the_mixer_while_shifting() {
        let (mixer, mut output) =
            rodio::mixer::mixer(NonZero::new(2).unwrap(), NonZero::new(RATE).unwrap());
        let player = Player::connect_new(&mixer);
        let ratio = Arc::new(AtomicU32::new(1.5f32.to_bits()));
        player.append(PitchSource::new(sine(440.0, 20.0), ratio.clone()));

        let before = output.by_ref().take(RATE as usize * 2).collect::<Vec<_>>();
        let position_before = player.get_pos().as_secs_f32();
        player.set_speed(2.0);
        output.by_ref().take(RATE as usize / 5).for_each(drop);
        let after = output.by_ref().take(RATE as usize * 2).collect::<Vec<_>>();
        let position_after = player.get_pos().as_secs_f32();
        assert!(
            close_to(frequency(&before), 660.0),
            "{}",
            frequency(&before)
        );
        assert!(close_to(frequency(&after), 1320.0), "{}", frequency(&after));
        assert!((position_after - position_before - 1.1).abs() < 0.03);

        ratio.store(1.0f32.to_bits(), Ordering::Relaxed);
        output.by_ref().take(RATE as usize / 2).for_each(drop);
        let back = output.by_ref().take(RATE as usize * 2).collect::<Vec<_>>();
        assert!(close_to(frequency(&back), 880.0), "{}", frequency(&back));
    }

    #[test]
    fn returns_to_pass_through_without_skipping() {
        let input = sine(440.0, 2.0).collect::<Vec<_>>();
        let ratio = Arc::new(AtomicU32::new(1.5f32.to_bits()));
        let mut source = PitchSource::new(sine(440.0, 2.0), ratio.clone());
        let mut output = source.by_ref().take(RATE as usize).collect::<Vec<_>>();
        ratio.store(1.0f32.to_bits(), Ordering::Relaxed);
        output.extend(source.by_ref().take(RATE as usize / 2));
        assert!(source.shifter.is_none());
        output.extend(source);

        let tail = RATE as usize;
        assert_eq!(output[output.len() - tail..], input[input.len() - tail..]);
        assert_eq!(output.len(), input.len());
        assert!(largest_step(&output) < 0.1, "{}", largest_step(&output));
    }
}
