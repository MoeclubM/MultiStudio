use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub is_default: bool,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub enum AudioSourceKind {
    Microphone,
    Loopback,
    Combined,
}

#[allow(dead_code)]
impl AudioSourceKind {
    pub fn from_str(s: &str) -> Self {
        match s {
            "loopback" => Self::Loopback,
            "microphone+loopback" => Self::Combined,
            _ => Self::Microphone,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Microphone => "microphone",
            Self::Loopback => "loopback",
            Self::Combined => "microphone+loopback",
        }
    }
}

#[cfg(feature = "audio-cpal")]
mod cpal_impl {
    use super::AudioDeviceInfo;
    use anyhow::Result;

    pub fn list_devices() -> Result<Vec<AudioDeviceInfo>> {
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        let mut out = Vec::new();

        if let Ok(devices) = host.input_devices() {
            let default_name = host
                .default_input_device()
                .and_then(|d| d.name().ok())
                .unwrap_or_default();
            for dev in devices {
                let name = dev.name().unwrap_or_else(|_| "Unknown".into());
                let id = name.clone();
                out.push(AudioDeviceInfo {
                    id,
                    name: name.clone(),
                    kind: "input".into(),
                    is_default: name == default_name,
                });
            }
        }
        if out.is_empty() {
            out.push(AudioDeviceInfo {
                id: "default".into(),
                name: "Default Microphone".into(),
                kind: "input".into(),
                is_default: true,
            });
        }

        if let Ok(devices) = host.output_devices() {
            for dev in devices {
                let name = dev.name().unwrap_or_else(|_| "Unknown".into());
                out.push(AudioDeviceInfo {
                    id: format!("output:{name}"),
                    name: format!("{name} (loopback)"),
                    kind: "output".into(),
                    is_default: false,
                });
            }
        }
        Ok(out)
    }
}

#[cfg(feature = "audio-cpal")]
pub use cpal_impl::list_devices;

#[cfg(not(feature = "audio-cpal"))]
pub fn list_devices() -> anyhow::Result<Vec<AudioDeviceInfo>> {
    Ok(vec![AudioDeviceInfo {
        id: "default".into(),
        name: "Default Microphone".into(),
        kind: "input".into(),
        is_default: true,
    }])
}

#[allow(dead_code)]
pub fn normalize_samples_i16(samples: &[f32]) -> Vec<i16> {
    samples
        .iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect()
}

pub fn compute_level(samples: &[f32]) -> (f32, f32) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let peak = samples.iter().fold(0.0_f32, |a, &b| a.max(b.abs()));
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    (rms, peak)
}

pub fn resample_linear(input: &[f32], in_rate: u32, out_rate: u32) -> Vec<f32> {
    if in_rate == out_rate || input.is_empty() {
        return input.to_vec();
    }
    let ratio = in_rate as f64 / out_rate as f64;
    let out_len = ((input.len() as f64) / ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let idx = pos.floor() as usize;
        let frac = (pos - idx as f64) as f32;
        let a = input.get(idx).copied().unwrap_or(0.0);
        let b = input.get(idx + 1).copied().unwrap_or(a);
        out.push(a * (1.0 - frac) + b * frac);
    }
    out
}

pub fn downmix_to_mono(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }
    samples
        .chunks(channels)
        .map(|ch| ch.iter().sum::<f32>() / ch.len() as f32)
        .collect()
}

pub fn encode_wav_mono_16k(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    let mut buf = Vec::new();
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    {
        let mut writer = hound::WavWriter::new(std::io::Cursor::new(&mut buf), spec)
            .expect("wav writer");
        for &s in samples {
            writer.write_sample(s).expect("write sample");
        }
        writer.finalize().expect("finalize wav");
    }
    buf
}
