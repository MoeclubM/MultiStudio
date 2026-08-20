use anyhow::Result;
use reqwest::Client;
use serde::Deserialize;

use super::{auth, base_trimmed, validate_base_url};

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct TranscriptionSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
struct VerboseTranscription {
    text: String,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    segments: Option<Vec<TranscriptionSegment>>,
    #[serde(default)]
    duration: Option<f64>,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct AsrResult {
    pub text: String,
    pub language: Option<String>,
    pub segments: Vec<TranscriptionSegment>,
}

pub struct AsrClient {
    client: Client,
    base_url: String,
    api_key: Option<String>,
    model: String,
}

impl AsrClient {
    pub fn new(base_url: String, api_key: Option<String>, model: String) -> Self {
        Self {
            client: Client::new(),
            base_url: base_trimmed(&base_url),
            api_key,
            model,
        }
    }

    pub fn url(&self) -> String {
        format!("{}/audio/transcriptions", self.base_url)
    }

    pub async fn transcribe(
        &self,
        wav_bytes: Vec<u8>,
        language: Option<String>,
        prompt: Option<String>,
    ) -> Result<AsrResult> {
        validate_base_url(&self.base_url)?;
        if wav_bytes.is_empty() {
            anyhow::bail!("empty audio");
        }
        let part = reqwest::multipart::Part::bytes(wav_bytes)
            .file_name("chunk.wav")
            .mime_str("audio/wav")?;

        let mut form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("model", self.model.clone())
            .text("response_format", "verbose_json".to_string())
            .text("temperature", "0".to_string());

        if let Some(lang) = language {
            if !lang.is_empty() && lang != "auto" {
                form = form.text("language", lang);
            }
        }
        if let Some(p) = prompt {
            let t = p.trim().to_string();
            if !t.is_empty() {
                form = form.text("prompt", t);
            }
        }

        let req = auth(self.client.post(self.url()).multipart(form), &self.api_key);
        let resp = req.send().await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("ASR {status}: {body}");
        }

        if let Ok(v) = serde_json::from_str::<VerboseTranscription>(&body) {
            return Ok(AsrResult {
                text: v.text.trim().to_string(),
                language: v.language,
                segments: v.segments.unwrap_or_default(),
            });
        }
        let simple: serde_json::Value = serde_json::from_str(&body)?;
        let text = simple
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        Ok(AsrResult {
            text,
            language: None,
            segments: Vec::new(),
        })
    }

    pub async fn check(&self) -> Result<()> {
        validate_base_url(&self.base_url)?;
        let req = auth(self.client.get(format!("{}/models", self.base_url)), &self.api_key);
        let resp = req.send().await?;
        if !resp.status().is_success() {
            let s = resp.status();
            let b = resp.text().await.unwrap_or_default();
            anyhow::bail!("models check {s}: {b}");
        }
        Ok(())
    }
}
