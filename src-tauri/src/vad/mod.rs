/// Lightweight energy-based VAD + segmentation.
/// Keeps the pipeline real-time without ONNX dependency. Can be upgraded to Silero later.
#[derive(Debug, Clone)]
pub struct VadConfig {
    pub enabled: bool,
    pub threshold: f32,
    pub silence_ms: u32,
    pub min_segment_ms: u32,
    pub max_segment_ms: u32,
    pub sample_rate: u32,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            threshold: 0.5,
            silence_ms: 500,
            min_segment_ms: 800,
            max_segment_ms: 8000,
            sample_rate: 16000,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SegmentReason {
    Silence,
    MaxLen,
    Flush,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct Segment {
    pub samples: Vec<i16>,
    pub reason: SegmentReason,
}

pub struct VadSegmenter {
    cfg: VadConfig,
    buf: Vec<i16>,
    silence_samples: usize,
    speech_samples: usize,
    silence_run: usize,
    energy_threshold: f32,
}

#[allow(dead_code)]
impl VadSegmenter {
    pub fn new(cfg: VadConfig) -> Self {
        let silence_samples = (cfg.sample_rate as usize * cfg.silence_ms as usize) / 1000;
        Self {
            energy_threshold: cfg.threshold * 0.02,
            silence_samples,
            cfg,
            buf: Vec::new(),
            speech_samples: 0,
            silence_run: 0,
        }
    }

    pub fn reset(&mut self) {
        self.buf.clear();
        self.speech_samples = 0;
        self.silence_run = 0;
    }

    fn is_speech_frame(&self, frame: &[i16]) -> bool {
        if !self.cfg.enabled {
            return true;
        }
        if frame.is_empty() {
            return false;
        }
        let rms = (frame.iter().map(|&s| (s as f32 / 32768.0).powi(2)).sum::<f32>()
            / frame.len() as f32)
            .sqrt();
        rms > self.energy_threshold
    }

    /// Push 16k mono i16 samples. Returns 0..N completed segments.
    pub fn push(&mut self, samples: &[i16]) -> Vec<Segment> {
        const FRAME_MS: usize = 30;
        let frame_len = (self.cfg.sample_rate as usize * FRAME_MS) / 1000;
        let mut out = Vec::new();
        let mut offset = 0;
        while offset < samples.len() {
            let end = (offset + frame_len).min(samples.len());
            let frame = &samples[offset..end];
            offset = end;

            let speech = self.is_speech_frame(frame);
            self.buf.extend_from_slice(frame);
            if speech {
                self.speech_samples += frame.len();
                self.silence_run = 0;
            } else {
                self.silence_run += frame.len();
            }

            let total_ms =
                (self.buf.len() as u64 * 1000) / self.cfg.sample_rate as u64;
            let max_samples =
                (self.cfg.sample_rate as usize * self.cfg.max_segment_ms as usize) / 1000;
            let min_samples =
                (self.cfg.sample_rate as usize * self.cfg.min_segment_ms as usize) / 1000;

            if self.buf.len() >= max_samples {
                let seg = std::mem::take(&mut self.buf);
                self.speech_samples = 0;
                self.silence_run = 0;
                out.push(Segment {
                    samples: seg,
                    reason: SegmentReason::MaxLen,
                });
                continue;
            }

            if self.cfg.enabled
                && self.silence_run >= self.silence_samples
                && self.buf.len() >= min_samples
                && self.speech_samples > 0
            {
                let seg = std::mem::take(&mut self.buf);
                self.speech_samples = 0;
                self.silence_run = 0;
                if seg.len() >= min_samples {
                    out.push(Segment {
                        samples: seg,
                        reason: SegmentReason::Silence,
                    });
                }
                let _ = total_ms;
            }
        }

        if !self.cfg.enabled {
            let min_samples =
                (self.cfg.sample_rate as usize * self.cfg.min_segment_ms as usize) / 1000;
            let max_samples =
                (self.cfg.sample_rate as usize * self.cfg.max_segment_ms as usize) / 1000;
            while self.buf.len() >= max_samples {
                let seg = self.buf.drain(0..max_samples).collect::<Vec<_>>();
                self.speech_samples = seg.len();
                out.push(Segment {
                    samples: seg,
                    reason: SegmentReason::MaxLen,
                });
            }
            if out.is_empty() && self.buf.len() >= min_samples {
                // fixed window with overlap handled by caller; emit on threshold
            }
        }
        out
    }

    pub fn flush(&mut self) -> Option<Segment> {
        if self.buf.is_empty() {
            return None;
        }
        let min_samples =
            (self.cfg.sample_rate as usize * self.cfg.min_segment_ms as usize) / 1000;
        if self.buf.len() < min_samples {
            return None;
        }
        let seg = std::mem::take(&mut self.buf);
        self.speech_samples = 0;
        self.silence_run = 0;
        Some(Segment {
            samples: seg,
            reason: SegmentReason::Flush,
        })
    }
}
