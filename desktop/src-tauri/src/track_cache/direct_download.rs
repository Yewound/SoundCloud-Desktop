//! GET `/download/:urn` → JSON-список кандидатов SoundCloud. Тянем выбранного
//! напрямую с SC, наш сервер только резолвит ссылки.
//!
//! Кандидатов берём один раз, дальше по уровню: для uq/hq только этот уровень
//! и выше, лучшие первыми; для sq всё, sq первыми. Внутри уровня —
//! progressive → hls → encrypted-hls.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use base64::Engine as _;
use bytes::Bytes;
use futures_util::future::select_all;
use wreq::Client;

use crate::app::diagnostics;

use super::api_download::{http_failure, refused_by_both, refused_for};
use super::sc_anon::hls::{download_hls_full, download_progressive};
use super::state::{DownloadError, Miss, PlaybackQuality};

#[derive(serde::Deserialize)]
pub struct DownloadResponse {
    pub candidates: Vec<Candidate>,
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Candidate {
    Progressive {
        #[serde(default = "default_sq")]
        quality: String,
        #[serde(default)]
        preset: String,
        url: String,
    },
    Hls {
        #[serde(default = "default_sq")]
        quality: String,
        #[serde(default)]
        preset: String,
        manifest_url: String,
    },
    EncryptedHls {
        #[serde(default = "default_sq")]
        quality: String,
        #[serde(default)]
        preset: String,
        init_base64: String,
        segments: Vec<String>,
        key_base64: String,
    },
}

fn default_sq() -> String {
    "sq".to_string()
}

impl Candidate {
    fn quality(&self) -> &str {
        match self {
            Candidate::Progressive { quality, .. } => quality,
            Candidate::Hls { quality, .. } => quality,
            Candidate::EncryptedHls { quality, .. } => quality,
        }
    }

    fn preset(&self) -> &str {
        match self {
            Candidate::Progressive { preset, .. } => preset,
            Candidate::Hls { preset, .. } => preset,
            Candidate::EncryptedHls { preset, .. } => preset,
        }
    }

    fn kind_label(&self) -> &'static str {
        match self {
            Candidate::Progressive { .. } => "progressive",
            Candidate::Hls { .. } => "hls",
            Candidate::EncryptedHls { .. } => "encrypted-hls",
        }
    }

    fn kind_score(&self) -> u32 {
        match self {
            Candidate::Progressive { .. } => 0,
            Candidate::Hls { .. } => 1,
            Candidate::EncryptedHls { .. } => 2,
        }
    }

    fn playback_quality(&self) -> PlaybackQuality {
        PlaybackQuality::parse(self.quality()).unwrap_or(PlaybackQuality::Sq)
    }
}

pub struct DirectResult {
    pub data: Bytes,
    pub quality: PlaybackQuality,
}

type CandidatesFut = Pin<Box<dyn Future<Output = Result<Vec<Candidate>, String>> + Send>>;

pub async fn fetch_candidates(
    client: &Client,
    download_urls: &[String],
    session_id: Option<&str>,
) -> Result<Vec<Candidate>, Miss> {
    let mut futures: Vec<CandidatesFut> = download_urls
        .iter()
        .map(|url| {
            let client = client.clone();
            let endpoint = url.clone();
            let session_id = session_id.map(str::to_string);
            Box::pin(async move { fetch_usable(&client, &endpoint, session_id.as_deref()).await })
                as CandidatesFut
        })
        .collect();

    let mut last_err = String::from("no /download URLs");
    let mut refused = Some(Duration::ZERO);
    while !futures.is_empty() {
        let (result, _idx, remaining) = select_all(futures).await;
        match result {
            Ok(candidates) => return Ok(candidates),
            Err(err) => {
                refused = refused_by_both(refused, refused_for(&err));
                last_err = err;
            }
        }
        futures = remaining;
    }
    Err(Miss {
        err: last_err,
        refused,
    })
}

async fn fetch_usable(
    client: &Client,
    endpoint: &str,
    session_id: Option<&str>,
) -> Result<Vec<Candidate>, String> {
    let resp = match fetch_download(client, endpoint, session_id).await {
        Ok(r) => r,
        Err(e) => {
            diagnostics::warn(format!("[direct] {endpoint} failed: {e}"));
            return Err(e);
        }
    };
    let usable: Vec<Candidate> = resp
        .candidates
        .into_iter()
        .filter(|c| c.quality() != "lq")
        .collect();
    if usable.is_empty() {
        println!("[direct] {endpoint} returned no usable candidates");
        return Err("no usable candidates".into());
    }
    let listing = usable
        .iter()
        .map(|c| format!("{}/{}/{}", c.kind_label(), c.quality(), c.preset()))
        .collect::<Vec<_>>()
        .join(", ");
    println!("[direct] {endpoint} candidates: [{listing}]");
    Ok(usable)
}

pub async fn consume_at(
    client: &Client,
    candidates: &[Candidate],
    tier: PlaybackQuality,
    receiving: &AtomicBool,
    progress: &(dyn Fn(f64) + Send + Sync),
) -> Option<DirectResult> {
    let picked = pick_for(candidates, tier);
    if picked.is_empty() {
        return None;
    }
    receiving.store(true, Ordering::Relaxed);
    for cand in picked {
        match consume(client, cand, progress).await {
            Ok(data) => {
                println!(
                    "[direct] hit {} ({} {})",
                    cand.kind_label(),
                    cand.quality(),
                    cand.preset()
                );
                return Some(DirectResult {
                    data,
                    quality: cand.playback_quality(),
                });
            }
            Err(e) => {
                diagnostics::warn(format!(
                    "[direct] {} {} {} failed: {e}",
                    cand.kind_label(),
                    cand.quality(),
                    cand.preset()
                ));
            }
        }
    }
    None
}

async fn fetch_download(
    client: &Client,
    endpoint: &str,
    session_id: Option<&str>,
) -> Result<DownloadResponse, String> {
    let (resp, hop) = crate::network::audio_route::get_in_order(client, endpoint, session_id)
        .await
        .map_err(|e| format!("request: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let (DownloadError::Fatal(err) | DownloadError::Retryable(err)) =
            http_failure(status, resp).await;
        return Err(err);
    }
    println!("[direct] endpoint via {}", hop.tier_label());
    resp.json::<DownloadResponse>()
        .await
        .map_err(|e| format!("decode: {e}"))
}

fn pick_for(candidates: &[Candidate], tier: PlaybackQuality) -> Vec<&Candidate> {
    let mut picked: Vec<&Candidate> = candidates
        .iter()
        .filter(|c| c.playback_quality().rank() >= tier.rank())
        .collect();
    picked.sort_by_key(|c| {
        let rank = c.playback_quality().rank();
        let order = if tier.rank() > PlaybackQuality::Sq.rank() {
            u8::MAX - rank
        } else {
            rank
        };
        (order, c.kind_score())
    });
    picked
}

async fn consume(
    client: &Client,
    cand: &Candidate,
    progress: &(dyn Fn(f64) + Send + Sync),
) -> Result<Bytes, String> {
    match cand {
        Candidate::Progressive { url, .. } => download_progressive(client, url, progress).await,
        Candidate::Hls { manifest_url, .. } => {
            download_hls_full(client, manifest_url, progress).await
        }
        Candidate::EncryptedHls {
            init_base64,
            segments,
            key_base64,
            ..
        } => consume_encrypted(client, init_base64, segments, key_base64, progress).await,
    }
}

async fn consume_encrypted(
    client: &Client,
    init_b64: &str,
    segments: &[String],
    key_b64: &str,
    progress: &(dyn Fn(f64) + Send + Sync),
) -> Result<Bytes, String> {
    let b64 = base64::engine::general_purpose::STANDARD;
    let init = b64.decode(init_b64).map_err(|e| format!("init: {e}"))?;
    let key_bytes = b64.decode(key_b64).map_err(|e| format!("key: {e}"))?;
    if key_bytes.len() != 16 {
        return Err(format!("key length {}", key_bytes.len()));
    }
    let mut key = [0u8; 16];
    key.copy_from_slice(&key_bytes);

    let mut buf = Vec::with_capacity(init.len());
    buf.extend_from_slice(&init);

    for (fetched, url) in segments.iter().enumerate() {
        let resp = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("seg request: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("seg HTTP {}", resp.status()));
        }
        let bytes = resp.bytes().await.map_err(|e| format!("seg body: {e}"))?;
        let plain = decrypt_client::decrypt_segment(&bytes, &key).map_err(|e| format!("{e}"))?;
        buf.extend_from_slice(&plain);
        progress((fetched + 1) as f64 / segments.len() as f64);
    }
    Ok(Bytes::from(buf))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(quality: &str, preset: &str) -> Candidate {
        Candidate::Hls {
            quality: quality.into(),
            preset: preset.into(),
            manifest_url: format!("https://cf-hls-media.sndcdn.com/{preset}.m3u8"),
        }
    }

    fn presets(picked: Vec<&Candidate>) -> Vec<&str> {
        picked.into_iter().map(Candidate::preset).collect()
    }

    fn download_answering(status: warp::http::StatusCode) -> String {
        use warp::Filter;
        let route = warp::path("download").map(move || {
            let reply = warp::reply::with_status("free hq busy", status);
            warp::reply::with_header(reply, "retry-after", "30")
        });
        let (addr, server) = warp::serve(route).bind_ephemeral(([127, 0, 0, 1], 0));
        tokio::spawn(server);
        format!("http://{addr}/download")
    }

    #[tokio::test]
    async fn a_busy_download_refuses_the_tier_only_when_every_endpoint_is_busy() {
        use warp::http::StatusCode;
        let client = Client::new();
        let busy = [
            download_answering(StatusCode::TOO_MANY_REQUESTS),
            download_answering(StatusCode::TOO_MANY_REQUESTS),
        ];
        let refused = fetch_candidates(&client, &busy, None).await.err();
        assert_eq!(
            refused.and_then(|miss| miss.refused),
            Some(Duration::from_secs(30))
        );

        let mixed = [
            download_answering(StatusCode::TOO_MANY_REQUESTS),
            download_answering(StatusCode::BAD_GATEWAY),
        ];
        let failed = fetch_candidates(&client, &mixed, None).await.err();
        assert!(failed.is_some_and(|miss| miss.refused.is_none()));
    }

    #[test]
    fn a_tier_takes_only_itself_and_better_best_first() {
        let all = [
            candidate("sq", "mp3_1_0"),
            candidate("hq", "aac_160k"),
            candidate("uq", "aac_256k"),
        ];
        assert_eq!(presets(pick_for(&all, PlaybackQuality::Uq)), ["aac_256k"]);
        assert_eq!(
            presets(pick_for(&all, PlaybackQuality::Hq)),
            ["aac_256k", "aac_160k"]
        );
        assert_eq!(
            presets(pick_for(&all, PlaybackQuality::Sq)),
            ["mp3_1_0", "aac_160k", "aac_256k"]
        );
    }
}
