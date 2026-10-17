use std::sync::{Arc, RwLock};
use std::time::Duration;

use biquad::{Biquad, DirectForm1};
use rodio::source::SeekError;
use rodio::Source;

use crate::audio::eq_curve::band_coefficients;
use crate::audio::types::{ChannelCount, EqParams, SampleRate, EQ_BANDS};

pub struct GainSource<S: Source<Item = f32>> {
    source: S,
    gain: f32,
}

impl<S: Source<Item = f32>> GainSource<S> {
    pub fn new(source: S, gain: f32) -> Self {
        Self { source, gain }
    }
}

impl<S: Source<Item = f32>> Iterator for GainSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        self.source
            .next()
            .map(|sample| (sample * self.gain).clamp(-1.0, 1.0))
    }
}

impl<S: Source<Item = f32>> Source for GainSource<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.source.current_span_len()
    }

    fn channels(&self) -> ChannelCount {
        self.source.channels()
    }

    fn sample_rate(&self) -> SampleRate {
        self.source.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.source.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.source.try_seek(pos)
    }
}

pub struct EqSource<S: Source<Item = f32>> {
    source: S,
    params: Arc<RwLock<EqParams>>,
    filters_l: [DirectForm1<f64>; EQ_BANDS],
    filters_r: [DirectForm1<f64>; EQ_BANDS],
    channels: ChannelCount,
    sample_rate: SampleRate,
    current_channel: u16,
    cached_gains: [f64; EQ_BANDS],
    cached_preamp: f64,
    preamp_gain: f64,
    cached_enabled: bool,
}

impl<S: Source<Item = f32>> EqSource<S> {
    pub fn new(source: S, params: Arc<RwLock<EqParams>>) -> Self {
        let sample_rate = source.sample_rate();
        let channels = source.channels();
        let make_filters = || {
            std::array::from_fn(|band| {
                DirectForm1::<f64>::new(band_coefficients(band, 0.0, sample_rate.get() as f64))
            })
        };

        Self {
            source,
            params,
            filters_l: make_filters(),
            filters_r: make_filters(),
            channels,
            sample_rate,
            current_channel: 0,
            cached_gains: [0.0; EQ_BANDS],
            cached_preamp: 0.0,
            preamp_gain: 1.0,
            cached_enabled: false,
        }
    }

    fn update_coefficients(&mut self, gains: &[f64; EQ_BANDS], preamp: f64) {
        let sample_rate = self.sample_rate.get() as f64;
        for band in 0..EQ_BANDS {
            if (gains[band] - self.cached_gains[band]).abs() < 0.01 {
                continue;
            }
            let coefficients = band_coefficients(band, gains[band], sample_rate);
            self.filters_l[band].update_coefficients(coefficients);
            self.filters_r[band].update_coefficients(coefficients);
        }
        self.cached_gains = *gains;
        self.cached_preamp = preamp;
        self.preamp_gain = 10f64.powf(preamp / 20.0);
    }
}

impl<S: Source<Item = f32>> Iterator for EqSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let sample = self.source.next()?;
        let ch = self.current_channel;
        self.current_channel = (ch + 1) % self.channels.get();

        let snapshot = self
            .params
            .try_read()
            .ok()
            .map(|p| (p.enabled, p.gains, p.preamp));
        if let Some((enabled, gains, preamp)) = snapshot
            && (enabled != self.cached_enabled
                || gains != self.cached_gains
                || preamp != self.cached_preamp)
        {
            if enabled {
                self.update_coefficients(&gains, preamp);
            }
            self.cached_enabled = enabled;
        }

        if !self.cached_enabled {
            return Some(sample);
        }

        let mut out = sample as f64 * self.preamp_gain;
        let filters = if ch == 0 {
            &mut self.filters_l
        } else {
            &mut self.filters_r
        };
        for filter in filters.iter_mut() {
            out = Biquad::run(filter, out);
        }

        Some(out.clamp(-1.0, 1.0) as f32)
    }
}

impl<S: Source<Item = f32>> Source for EqSource<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.source.current_span_len()
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
        for filter in self.filters_l.iter_mut().chain(self.filters_r.iter_mut()) {
            filter.reset_state();
        }
        Ok(())
    }
}
