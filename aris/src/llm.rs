use reqwest::Client;
use serde_json::{json, Value};
use std::env;

/// Queries the Google Gemini API with the extracted graph context.
/// Configured for Gemini 1.5 Flash for low-latency demo performance.
pub async fn query_llm(context: &str, question: &str) -> Result<String, String> {
    let raw_key = env::var("GEMINI_API_KEY")
        .map_err(|_| "GEMINI_API_KEY not set in environment".to_string())?;
        
    let clean_key = raw_key.trim().trim_matches('"').trim_matches('\'');

    let client = Client::new();
    let prompt = format!("{}\n\nBased on the above code structure, answer this question:\n{}", context, question);

    // 2. Target the Gemini 1.5 Flash model endpoint
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={}",
        clean_key
    );

    // 3. Send the structured payload
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&json!({
            "contents": [{
                "parts": [{"text": prompt}]
            }]
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("API Error {}: {}", status, error_body));
    }

    let body: Value = response.json().await.map_err(|e| format!("Failed to parse JSON: {}", e))?;

    // 4. Parse the Gemini response tree
    let text = body["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .ok_or_else(|| "Failed to parse Gemini response structure".to_string())?;

    Ok(text.to_string())
}
