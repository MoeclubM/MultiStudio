mod asr;
mod llm;

pub use asr::AsrClient;
pub use llm::{LlmClient, LlmStreamEvent, TranslateRequest};

use anyhow::Result;

fn auth(req: reqwest::RequestBuilder, api_key: &Option<String>) -> reqwest::RequestBuilder {
    match api_key {
        Some(k) if !k.trim().is_empty() => req.bearer_auth(k.trim()),
        _ => req,
    }
}

fn base_trimmed(base: &str) -> String {
    base.trim().trim_end_matches('/').to_string()
}

pub fn validate_base_url(base: &str) -> Result<()> {
    let b = base.trim();
    if b.is_empty() {
        anyhow::bail!("base_url is empty");
    }
    if !b.starts_with("http://") && !b.starts_with("https://") {
        anyhow::bail!("base_url must start with http(s):// — got {b}");
    }
    Ok(())
}
