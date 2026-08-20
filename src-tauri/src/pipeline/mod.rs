use std::sync::Arc;
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::audio::{compute_level, downmix_to_mono, encode_wav_mono_16k, resample_linear};
use crate::config::{AppConfig, TranslationConfig};
use crate::providers::{AsrClient, LlmClient, LlmStreamEvent, TranslateRequest};
use crate::vad::{VadConfig, VadSegmenter};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PipelineEvent {
    Status { status: String, message: Option<String> },
    Level { rms: f32, peak: f32 },
    Transcript { id: String, text: String, is_final: bool, lang: Option<String> },
    TranslationDelta { id: String, delta: String },
    TranslationDone { id: String, text: String, latency_ms: u64 },
    Error { message: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryEntry {
    pub id: String,
    pub started_at: String,
    pub transcript: String,
    pub translation: String,
    pub source_lang: String,
    pub target_lang: String,
    pub duration_ms: u64,
}

pub struct PipelineInner {
    pub config: AppConfig,
    pub status: String,
    pub segmenter: VadSegmenter,
    pub prev_tail: String,
    pub history: Vec<HistoryEntry>,
    pub running: bool,
}

impl PipelineInner {
    fn vad_cfg(cfg: &AppConfig) -> VadConfig {
        VadConfig {
            enabled: cfg.audio.vad_enabled,
            threshold: cfg.audio.vad_threshold,
            silence_ms: cfg.audio.silence_ms,
            min_segment_ms: cfg.audio.min_segment_ms,
            max_segment_ms: cfg.audio.max_segment_ms,
            sample_rate: 16000,
        }
    }

    pub fn new(cfg: AppConfig) -> Self {
        let vad = Self::vad_cfg(&cfg);
        Self {
            config: cfg,
            status: "idle".into(),
            segmenter: VadSegmenter::new(vad),
            prev_tail: String::new(),
            history: Vec::new(),
            running: false,
        }
    }

    pub fn reconfigure(&mut self, cfg: AppConfig) {
        self.config = cfg;
        let vad = Self::vad_cfg(&self.config);
        self.segmenter = VadSegmenter::new(vad);
        self.prev_tail.clear();
    }
}

pub type SharedPipeline = Arc<Mutex<PipelineInner>>;

pub fn new_shared(cfg: AppConfig) -> SharedPipeline {
    Arc::new(Mutex::new(PipelineInner::new(cfg)))
}

fn emit(app: &AppHandle, ev: PipelineEvent) {
    let _ = app.emit("pipeline-event", &ev);
}

fn lang_param(code: &str) -> Option<String> {
    if code == "auto" || code.is_empty() {
        None
    } else {
        Some(code.to_string())
    }
}

async fn push_history(
    state: &SharedPipeline,
    id: String,
    transcript: String,
    translation: String,
    cfg: &TranslationConfig,
    latency_ms: u64,
) {
    let mut g = state.lock().await;
    g.history.push(HistoryEntry {
        id,
        started_at: chrono::Utc::now().to_rfc3339(),
        transcript,
        translation,
        source_lang: cfg.source_lang.clone(),
        target_lang: cfg.target_lang.clone(),
        duration_ms: latency_ms,
    });
    if g.history.len() > 500 {
        let drain = g.history.len() - 500;
        g.history.drain(0..drain);
    }
}

async fn do_translate(
    app: AppHandle,
    state: SharedPipeline,
    t_cfg: TranslationConfig,
    asr_text: String,
    seg_id: String,
) {
    let llm_base = {
        let g = state.lock().await;
        g.config.llm.base_url.clone()
    };
    let llm_key = {
        let g = state.lock().await;
        g.config.llm.api_key.clone()
    };
    let llm_model = {
        let g = state.lock().await;
        g.config.llm.llm_model.clone()
    };
    let llm = LlmClient::new(llm_base, llm_key, llm_model);

    let req = TranslateRequest {
        text: asr_text.clone(),
        source_lang: t_cfg.source_lang.clone(),
        target_lang: t_cfg.target_lang.clone(),
        extra_prompt: t_cfg.extra_prompt.clone(),
        temperature: t_cfg.llm_temperature,
    };

    if t_cfg.stream_translation {
        let start = Instant::now();
        match llm.translate_stream(req).await {
            Ok(mut rx) => {
                let mut acc = String::new();
                while let Some(ev) = rx.recv().await {
                    match ev {
                        LlmStreamEvent::Delta(d) => {
                            acc.push_str(&d);
                            emit(
                                &app,
                                PipelineEvent::TranslationDelta {
                                    id: seg_id.clone(),
                                    delta: d,
                                },
                            );
                        }
                        LlmStreamEvent::Done => break,
                        LlmStreamEvent::Error(e) => {
                            emit(&app, PipelineEvent::Error { message: e });
                            break;
                        }
                    }
                }
                let latency = start.elapsed().as_millis() as u64;
                emit(
                    &app,
                    PipelineEvent::TranslationDone {
                        id: seg_id.clone(),
                        text: acc.clone(),
                        latency_ms: latency,
                    },
                );
                push_history(&state, seg_id, asr_text, acc, &t_cfg, latency).await;
            }
            Err(e) => {
                emit(&app, PipelineEvent::Error { message: e.to_string() });
            }
        }
    } else {
        let start = Instant::now();
        match llm.translate(req).await {
            Ok(t) => {
                let latency = start.elapsed().as_millis() as u64;
                emit(
                    &app,
                    PipelineEvent::TranslationDone {
                        id: seg_id.clone(),
                        text: t.clone(),
                        latency_ms: latency,
                    },
                );
                push_history(&state, seg_id, asr_text, t, &t_cfg, latency).await;
            }
            Err(e) => emit(&app, PipelineEvent::Error { message: e.to_string() }),
        }
    }
}

pub async fn ingest_pcm(
    app: AppHandle,
    state: SharedPipeline,
    pcm_f32: Vec<f32>,
    in_rate: u32,
    channels: u32,
) {
    let (level_rms, level_peak) = compute_level(&pcm_f32);
    emit(&app, PipelineEvent::Level { rms: level_rms, peak: level_peak });

    let mono = downmix_to_mono(&pcm_f32, channels as usize);
    let resampled = resample_linear(&mono, in_rate, 16000);
    let i16s: Vec<i16> = resampled.iter().map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16).collect();
    if i16s.is_empty() {
        return;
    }

    let segments = {
        let mut g = state.lock().await;
        if !g.running {
            return;
        }
        g.segmenter.push(&i16s)
    };

    for seg in segments {
        let wav = encode_wav_mono_16k(&seg.samples, 16000);
        let seg_id = uuid::Uuid::now_v7().to_string();
        let app2 = app.clone();
        let state2 = state.clone();
        tokio::spawn(async move {
            let (asr_base, asr_key, asr_model, src_lang, prev_tail, t_cfg) = {
                let g = state2.lock().await;
                (
                    g.config.asr.base_url.clone(),
                    g.config.asr.api_key.clone(),
                    g.config.asr.asr_model.clone(),
                    g.config.translation.source_lang.clone(),
                    g.prev_tail.clone(),
                    g.config.translation.clone(),
                )
            };
            let asr = AsrClient::new(asr_base, asr_key, asr_model);
            let prompt = if prev_tail.is_empty() { None } else { Some(prev_tail) };
            match asr.transcribe(wav, lang_param(&src_lang), prompt).await {
                Ok(r) => {
                    let text = r.text.trim().to_string();
                    if text.is_empty() {
                        return;
                    }
                    {
                        let mut g = state2.lock().await;
                        let tail: String = text.chars().rev().take(80).collect::<String>().chars().rev().collect();
                        g.prev_tail = tail;
                    }
                    emit(
                        &app2,
                        PipelineEvent::Transcript {
                            id: seg_id.clone(),
                            text: text.clone(),
                            is_final: true,
                            lang: r.language.clone(),
                        },
                    );
                    do_translate(app2.clone(), state2.clone(), t_cfg, text, seg_id).await;
                }
                Err(e) => {
                    emit(&app2, PipelineEvent::Error { message: format!("ASR: {e}") });
                }
            }
        });
    }
}

pub async fn flush_pipeline(app: AppHandle, state: SharedPipeline) {
    let seg = {
        let mut g = state.lock().await;
        g.segmenter.flush()
    };
    if let Some(seg) = seg {
        let wav = encode_wav_mono_16k(&seg.samples, 16000);
        let seg_id = uuid::Uuid::now_v7().to_string();
        let (asr_base, asr_key, asr_model, src_lang, t_cfg) = {
            let g = state.lock().await;
            (
                g.config.asr.base_url.clone(),
                g.config.asr.api_key.clone(),
                g.config.asr.asr_model.clone(),
                g.config.translation.source_lang.clone(),
                g.config.translation.clone(),
            )
        };
        let asr = AsrClient::new(asr_base, asr_key, asr_model);
        if let Ok(r) = asr.transcribe(wav, lang_param(&src_lang), None).await {
            let text = r.text.trim().to_string();
            if !text.is_empty() {
                emit(
                    &app,
                    PipelineEvent::Transcript {
                        id: seg_id.clone(),
                        text: text.clone(),
                        is_final: true,
                        lang: r.language,
                    },
                );
                do_translate(app, state, t_cfg, text, seg_id).await;
            }
        }
    }
}
