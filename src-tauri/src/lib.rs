use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

mod audio;
mod config;
mod pipeline;
mod providers;
mod vad;

use audio::AudioDeviceInfo;
use config::AppConfig;
use pipeline::{new_shared, PipelineInner, SharedPipeline};

#[derive(Debug, serde::Serialize)]
struct CommandError {
    message: String,
}

impl From<anyhow::Error> for CommandError {
    fn from(value: anyhow::Error) -> Self {
        Self { message: value.to_string() }
    }
}

impl From<String> for CommandError {
    fn from(value: String) -> Self {
        Self { message: value }
    }
}

struct AppDataDir(PathBuf);
struct SharedPipelineState(pub SharedPipeline);

#[tauri::command]
async fn get_config(state: State<'_, SharedPipelineState>) -> Result<AppConfig, CommandError> {
    Ok(state.0.lock().await.config.clone())
}

#[tauri::command]
async fn set_config(
    app: AppHandle,
    state: State<'_, SharedPipelineState>,
    config: AppConfig,
) -> Result<AppConfig, CommandError> {
    {
        let mut g = state.0.lock().await;
        g.reconfigure(config.clone());
    }
    let dir = app
        .try_state::<AppDataDir>()
        .map(|d| d.0.clone())
        .unwrap_or_else(|| PathBuf::from(".live-translator-data"));
    let path = config::config_path(&dir);
    config::save_config(&path, &config)
        .await
        .map_err(|e| CommandError { message: e.to_string() })?;
    Ok(config)
}

#[tauri::command]
async fn list_audio_devices() -> Result<Vec<AudioDeviceInfo>, CommandError> {
    audio::list_devices().map_err(|e| CommandError { message: e.to_string() })
}

#[tauri::command]
async fn pipeline_start(state: State<'_, SharedPipelineState>, app: AppHandle) -> Result<(), CommandError> {
    {
        let mut g = state.0.lock().await;
        g.running = true;
        g.status = "running".into();
        g.segmenter = vad::VadSegmenter::new(vad::VadConfig {
            enabled: g.config.audio.vad_enabled,
            threshold: g.config.audio.vad_threshold,
            silence_ms: g.config.audio.silence_ms,
            min_segment_ms: g.config.audio.min_segment_ms,
            max_segment_ms: g.config.audio.max_segment_ms,
            sample_rate: 16000,
        });
        g.prev_tail.clear();
    }
    let _ = app.emit(
        "pipeline-event",
        pipeline::PipelineEvent::Status { status: "running".into(), message: None },
    );
    Ok(())
}

#[tauri::command]
async fn pipeline_stop(state: State<'_, SharedPipelineState>, app: AppHandle) -> Result<(), CommandError> {
    {
        let mut g = state.0.lock().await;
        g.running = false;
        g.status = "idle".into();
    }
    let shared = state.0.clone();
    pipeline::flush_pipeline(app.clone(), shared).await;
    let _ = app.emit(
        "pipeline-event",
        pipeline::PipelineEvent::Status { status: "idle".into(), message: None },
    );
    Ok(())
}

#[tauri::command]
async fn pipeline_status(state: State<'_, SharedPipelineState>) -> Result<String, CommandError> {
    Ok(state.0.lock().await.status.clone())
}

#[tauri::command]
async fn push_audio_chunk(
    app: AppHandle,
    state: State<'_, SharedPipelineState>,
    samples: Vec<f32>,
    sample_rate: u32,
    channels: u32,
) -> Result<(), CommandError> {
    let shared = state.0.clone();
    pipeline::ingest_pcm(app, shared, samples, sample_rate, channels).await;
    Ok(())
}

#[tauri::command]
async fn test_asr(state: State<'_, SharedPipelineState>) -> Result<String, CommandError> {
    let (base, key, model) = {
        let g = state.0.lock().await;
        (g.config.asr.base_url.clone(), g.config.asr.api_key.clone(), g.config.asr.asr_model.clone())
    };
    let c = providers::AsrClient::new(base, key, model);
    c.check().await.map_err(|e| CommandError { message: e.to_string() })?;
    Ok("ASR OK".into())
}

#[tauri::command]
async fn test_llm(state: State<'_, SharedPipelineState>) -> Result<String, CommandError> {
    let (base, key, model) = {
        let g = state.0.lock().await;
        (g.config.llm.base_url.clone(), g.config.llm.api_key.clone(), g.config.llm.llm_model.clone())
    };
    let c = providers::LlmClient::new(base, key, model);
    c.check().await.map_err(|e| CommandError { message: e.to_string() })?;
    Ok("LLM OK".into())
}

#[tauri::command]
async fn translate_text(
    state: State<'_, SharedPipelineState>,
    app: AppHandle,
    text: String,
) -> Result<String, CommandError> {
    let (base, key, model, t_cfg) = {
        let g = state.0.lock().await;
        (g.config.llm.base_url.clone(), g.config.llm.api_key.clone(), g.config.llm.llm_model.clone(), g.config.translation.clone())
    };
    let c = providers::LlmClient::new(base, key, model);
    let req = providers::TranslateRequest {
        text,
        source_lang: t_cfg.source_lang,
        target_lang: t_cfg.target_lang,
        extra_prompt: t_cfg.extra_prompt,
        temperature: t_cfg.llm_temperature,
    };
    if t_cfg.stream_translation {
        let mut rx = c.translate_stream(req).await.map_err(|e| CommandError { message: e.to_string() })?;
        let mut acc = String::new();
        let stream_id = uuid::Uuid::now_v7().to_string();
        while let Some(ev) = rx.recv().await {
            match ev {
                providers::LlmStreamEvent::Delta(d) => {
                    acc.push_str(&d);
                    let _ = app.emit("pipeline-event", pipeline::PipelineEvent::TranslationDelta { id: stream_id.clone(), delta: d });
                }
                providers::LlmStreamEvent::Done => break,
                providers::LlmStreamEvent::Error(e) => return Err(CommandError { message: e }),
            }
        }
        let _ = app.emit("pipeline-event", pipeline::PipelineEvent::TranslationDone { id: stream_id, text: acc.clone(), latency_ms: 0 });
        Ok(acc)
    } else {
        let out = c.translate(req).await.map_err(|e| CommandError { message: e.to_string() })?;
        Ok(out)
    }
}

#[tauri::command]
async fn get_history(state: State<'_, SharedPipelineState>) -> Result<Vec<pipeline::HistoryEntry>, CommandError> {
    Ok(state.0.lock().await.history.clone())
}

#[tauri::command]
async fn clear_history(state: State<'_, SharedPipelineState>) -> Result<(), CommandError> {
    state.0.lock().await.history.clear();
    Ok(())
}

#[tauri::command]
async fn export_history(state: State<'_, SharedPipelineState>) -> Result<String, CommandError> {
    let h = state.0.lock().await.history.clone();
    serde_json::to_string_pretty(&h).map_err(|e| CommandError { message: e.to_string() })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(".live-translator-data"));
            let cfg_path = config::config_path(&dir);
            let cfg = tauri::async_runtime::block_on(config::load_config(&cfg_path));
            app.manage(AppDataDir(dir));
            app.manage(SharedPipelineState(new_shared(cfg)));

            #[cfg(desktop)]
            {
                let quit_i = tauri::menu::MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let show_i = tauri::menu::MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
                let menu = tauri::menu::Menu::with_items(app, &[&show_i, &quit_i])?;
                let _tray = tauri::tray::TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "quit" => app.exit(0),
                        "show" => {
                            if let Some(w) = app.webview_windows().values().next() {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                            let app = tray.app_handle();
                            if let Some(w) = app.webview_windows().values().next() {
                                if w.is_visible().unwrap_or(false) { let _ = w.hide(); } else { let _ = w.show(); let _ = w.set_focus(); }
                            }
                        }
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            list_audio_devices,
            pipeline_start,
            pipeline_stop,
            pipeline_status,
            push_audio_chunk,
            test_asr,
            test_llm,
            translate_text,
            get_history,
            clear_history,
            export_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running LiveTranslator");
}
