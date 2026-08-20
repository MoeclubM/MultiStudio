use anyhow::Result;
use futures::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use tokio::sync::mpsc;

use super::{auth, base_trimmed, validate_base_url};

#[derive(Debug, Clone)]
pub struct TranslateRequest {
    pub text: String,
    pub source_lang: String,
    pub target_lang: String,
    pub extra_prompt: String,
    pub temperature: f32,
}

#[derive(Debug, Clone)]
pub enum LlmStreamEvent {
    Delta(String),
    Done,
    Error(String),
}

pub struct LlmClient {
    client: Client,
    base_url: String,
    api_key: Option<String>,
    model: String,
}

impl LlmClient {
    pub fn new(base_url: String, api_key: Option<String>, model: String) -> Self {
        Self {
            client: Client::new(),
            base_url: base_trimmed(&base_url),
            api_key,
            model,
        }
    }

    pub fn url(&self) -> String {
        format!("{}/chat/completions", self.base_url)
    }

    fn system_prompt(&self, req: &TranslateRequest) -> String {
        let src = if req.source_lang == "auto" {
            "auto-detected language"
        } else {
            &req.source_lang
        };
        let mut p = format!(
            "You are a professional simultaneous interpreter. Translate the following text from {src} to {}. Rules: Output ONLY the translation, no explanations, no romanization, keep numbers/names intact. If the input is already in the target language, return it as-is.",
            req.target_lang
        );
        let extra = req.extra_prompt.trim();
        if !extra.is_empty() {
            p.push_str("\nAdditional instructions: ");
            p.push_str(extra);
        }
        p
    }

    pub async fn translate(&self, req: TranslateRequest) -> Result<String> {
        validate_base_url(&self.base_url)?;
        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                {"role": "system", "content": self.system_prompt(&req)},
                {"role": "user", "content": req.text}
            ],
            "temperature": req.temperature,
            "stream": false
        });
        let http = auth(
            self.client.post(self.url()).json(&body),
            &self.api_key,
        )
        .send()
        .await?;
        let status = http.status();
        let text = http.text().await?;
        if !status.is_success() {
            anyhow::bail!("LLM {status}: {text}");
        }
        let v: serde_json::Value = serde_json::from_str(&text)?;
        let out = v
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        Ok(out)
    }

    pub async fn translate_stream(
        &self,
        req: TranslateRequest,
    ) -> Result<mpsc::UnboundedReceiver<LlmStreamEvent>> {
        validate_base_url(&self.base_url)?;
        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                {"role": "system", "content": self.system_prompt(&req)},
                {"role": "user", "content": req.text}
            ],
            "temperature": req.temperature,
            "stream": true
        });
        let http = auth(
            self.client.post(self.url()).json(&body),
            &self.api_key,
        )
        .send()
        .await?
        .error_for_status()?;

        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            let mut stream = http.bytes_stream();
            let mut buf = String::new();
            while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(b) => b,
                    Err(e) => {
                        let _ = tx.send(LlmStreamEvent::Error(e.to_string()));
                        return;
                    }
                };
                buf.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(idx) = buf.find('\n') {
                    let line = buf[..idx].trim().to_string();
                    buf = buf[idx + 1..].to_string();
                    if line.is_empty() || !line.starts_with("data:") {
                        continue;
                    }
                    let data = line.trim_start_matches("data:").trim();
                    if data == "[DONE]" {
                        let _ = tx.send(LlmStreamEvent::Done);
                        return;
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(delta) = v
                            .get("choices")
                            .and_then(|c| c.get(0))
                            .and_then(|c| c.get("delta"))
                            .and_then(|d| d.get("content"))
                            .and_then(|c| c.as_str())
                        {
                            if !delta.is_empty() {
                                let _ = tx.send(LlmStreamEvent::Delta(delta.to_string()));
                            }
                        }
                    }
                }
            }
            let _ = tx.send(LlmStreamEvent::Done);
        });
        Ok(rx)
    }

    pub async fn check(&self) -> Result<()> {
        validate_base_url(&self.base_url)?;
        let req = auth(
            self.client.get(format!("{}/models", self.base_url)),
            &self.api_key,
        );
        let resp = req.send().await?;
        if !resp.status().is_success() {
            let s = resp.status();
            let b = resp.text().await.unwrap_or_default();
            anyhow::bail!("models check {s}: {b}");
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ChatChunk {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ChatChoice {
    delta: ChatDelta,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ChatDelta {
    content: Option<String>,
}
