use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    pub asr_model: String,
    pub llm_model: String,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            id: "default".into(),
            name: "Default".into(),
            base_url: "https://api.openai.com/v1".into(),
            api_key: None,
            asr_model: "whisper-1".into(),
            llm_model: "gpt-4o-mini".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioConfig {
    pub source_kind: String,
    pub input_device_id: Option<String>,
    pub sample_rate: u32,
    pub vad_enabled: bool,
    pub vad_threshold: f32,
    pub silence_ms: u32,
    pub min_segment_ms: u32,
    pub max_segment_ms: u32,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            source_kind: "microphone".into(),
            input_device_id: None,
            sample_rate: 16000,
            vad_enabled: true,
            vad_threshold: 0.5,
            silence_ms: 500,
            min_segment_ms: 800,
            max_segment_ms: 8000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationConfig {
    pub source_lang: String,
    pub target_lang: String,
    pub source_lang_label: String,
    pub target_lang_label: String,
    pub extra_prompt: String,
    pub llm_temperature: f32,
    pub stream_translation: bool,
}

impl Default for TranslationConfig {
    fn default() -> Self {
        Self {
            source_lang: "auto".into(),
            target_lang: "zh".into(),
            source_lang_label: "自动检测".into(),
            target_lang_label: "中文".into(),
            extra_prompt: String::new(),
            llm_temperature: 0.3,
            stream_translation: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    #[serde(default)]
    pub asr: ProviderConfig,
    #[serde(default)]
    pub llm: ProviderConfig,
    #[serde(default)]
    pub audio: AudioConfig,
    #[serde(default)]
    pub translation: TranslationConfig,
}

impl AppConfig {
    pub fn asr_base(&self) -> String {
        self.asr.base_url.trim_end_matches('/').to_string()
    }
    pub fn llm_base(&self) -> String {
        self.llm.base_url.trim_end_matches('/').to_string()
    }
}

pub fn config_path(app_data_dir: &std::path::Path) -> std::path::PathBuf {
    app_data_dir.join("live-translator.json")
}

pub async fn load_config(path: &std::path::Path) -> AppConfig {
    match tokio::fs::read_to_string(path).await {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

pub async fn save_config(path: &std::path::Path, cfg: &AppConfig) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let json = serde_json::to_string_pretty(cfg)?;
    tokio::fs::write(path, json).await?;
    Ok(())
}
