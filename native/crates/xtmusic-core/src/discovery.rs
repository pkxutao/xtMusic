use crate::authx::{compute_authx_with_timestamp, compute_fn_sign, now_millis};
use crate::{ApiEnvelope, ConnectionCandidate, ConnectionResult, CoreError};
use reqwest::header::{ACCEPT, CONTENT_TYPE, COOKIE};
use serde::Deserialize;
use serde_json::json;
use std::net::IpAddr;
use std::str::FromStr;
use std::time::Duration;
use url::Url;

const FN_API_PATH: &str = "/api/v1/fn/con";
const FN_API_URL: &str = "https://5ddd.com/api/v1/fn/con";

#[derive(Clone)]
pub struct FnDiscovery {
    client: reqwest::Client,
}

impl std::fmt::Debug for FnDiscovery {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("FnDiscovery").finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Default)]
pub struct DiscoveryOptions {
    pub allow_http: bool,
    pub allow_public_http: bool,
}

impl FnDiscovery {
    pub fn new(allow_self_signed: bool) -> Result<Self, CoreError> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(12))
            .danger_accept_invalid_certs(allow_self_signed)
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self { client })
    }

    pub async fn resolve(
        &self,
        input: &str,
        options: DiscoveryOptions,
    ) -> Result<ConnectionResult, CoreError> {
        let input = input.trim();
        if input.is_empty() {
            return Err(CoreError::ServerRequired);
        }

        let (fn_id, mut candidates) = if is_plain_fn_id(input) {
            let fn_id = input.to_ascii_lowercase();
            let mut rows = self
                .fetch_candidates(&fn_id, &options)
                .await
                .unwrap_or_default();
            rows.extend(fallback_candidates(&fn_id));
            (Some(fn_id), dedupe(rows))
        } else {
            (None, direct_candidates(input, &options)?)
        };

        candidates.sort_by_key(|candidate| candidate.priority);
        let mut diagnostics = Vec::new();
        for candidate in candidates {
            match self.probe(&candidate).await {
                Ok(status) => {
                    diagnostics.push(format!("{} → HTTP {}", candidate.label, status));
                    return Ok(ConnectionResult {
                        server_url: candidate.base_url,
                        relay_mode: candidate.relay_mode,
                        method: candidate.label,
                        fn_id,
                        diagnostics,
                    });
                }
                Err(error) => diagnostics.push(format!("{} → {}", candidate.label, error)),
            }
        }

        Err(CoreError::NoReachableServer(diagnostics.join("；")))
    }

    async fn fetch_candidates(
        &self,
        fn_id: &str,
        options: &DiscoveryOptions,
    ) -> Result<Vec<ConnectionCandidate>, CoreError> {
        let body = json!({ "fnId": fn_id });
        let timestamp = now_millis();
        let authx = compute_authx_with_timestamp("POST", FN_API_PATH, &body, timestamp);
        let response = self
            .client
            .post(FN_API_URL)
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .header("authx", authx)
            .header("fn-sign", compute_fn_sign(fn_id, timestamp))
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            return Err(CoreError::FnLookup(format!("HTTP {}", status.as_u16())));
        }
        let envelope: ApiEnvelope<FnConnectData> = serde_json::from_str(&text)
            .map_err(|_| CoreError::InvalidResponse(text.chars().take(240).collect()))?;
        if envelope.code != 0 {
            return Err(CoreError::FnLookup(if envelope.msg.is_empty() {
                format!("业务码 {}", envelope.code)
            } else {
                envelope.msg
            }));
        }
        let data = envelope
            .data
            .ok_or_else(|| CoreError::FnLookup("响应缺少 data".to_owned()))?;
        Ok(build_candidates(fn_id, data, options))
    }

    async fn probe(&self, candidate: &ConnectionCandidate) -> Result<u16, CoreError> {
        let mut request = self
            .client
            .get(&candidate.probe_url)
            .header(ACCEPT, "application/json,text/plain,*/*");
        if candidate.relay_mode {
            request = request.header(COOKIE, "mode=relay");
        }
        let response = request.send().await?;
        let status = response.status().as_u16();
        if status >= 500 {
            return Err(CoreError::Server(format!("HTTP {status}")));
        }
        Ok(status)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FnConnectData {
    #[serde(default)]
    ipv4: Vec<String>,
    #[serde(default)]
    public_ipv4: Vec<String>,
    #[serde(default)]
    public_ipv6: Vec<String>,
    #[serde(default)]
    r#fn: Vec<String>,
    #[serde(default)]
    port: FnPort,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FnPort {
    #[serde(default = "default_http_port")]
    http_port: u16,
    #[serde(default = "default_https_port")]
    https_port: u16,
}

fn build_candidates(
    fn_id: &str,
    data: FnConnectData,
    options: &DiscoveryOptions,
) -> Vec<ConnectionCandidate> {
    let mut rows = Vec::new();
    for ip in data.ipv4 {
        if options.allow_http {
            rows.push(ip_candidate(
                &ip,
                data.port.http_port,
                false,
                false,
                "内网 HTTP",
                10,
            ));
        }
        rows.push(ip_candidate(
            &ip,
            data.port.https_port,
            true,
            false,
            "内网 HTTPS",
            11,
        ));
    }
    for ip in data.public_ipv6 {
        rows.push(ip_candidate(
            &ip,
            data.port.https_port,
            true,
            true,
            "公网 IPv6",
            20,
        ));
        if options.allow_http && options.allow_public_http {
            rows.push(ip_candidate(
                &ip,
                data.port.http_port,
                false,
                true,
                "公网 IPv6 HTTP",
                21,
            ));
        }
    }
    for ip in data.public_ipv4 {
        rows.push(ip_candidate(
            &ip,
            data.port.https_port,
            true,
            false,
            "公网 IPv4",
            30,
        ));
        if options.allow_http && options.allow_public_http {
            rows.push(ip_candidate(
                &ip,
                data.port.http_port,
                false,
                false,
                "公网 IPv4 HTTP",
                31,
            ));
        }
    }
    let relay = if data.r#fn.is_empty() {
        vec![format!("{fn_id}.5ddd.com")]
    } else {
        data.r#fn
    };
    for raw in relay {
        if let Ok(url) = normalize_relay_url(&raw) {
            rows.push(ConnectionCandidate {
                probe_url: format!("{url}/license/v1/device/baseInfo"),
                base_url: url.clone(),
                relay_mode: true,
                label: format!("FN Connect 中继 · {url}"),
                priority: 40,
            });
        }
    }
    rows
}

fn fallback_candidates(fn_id: &str) -> Vec<ConnectionCandidate> {
    [
        (format!("https://{fn_id}.5ddd.com"), 42u16),
        (format!("https://{fn_id}.fnos.net"), 43u16),
    ]
    .into_iter()
    .map(|(base_url, priority)| ConnectionCandidate {
        probe_url: format!("{base_url}/license/v1/device/baseInfo"),
        relay_mode: true,
        label: format!("FN Connect 域名 · {base_url}"),
        base_url,
        priority,
    })
    .collect()
}

fn direct_candidates(
    input: &str,
    options: &DiscoveryOptions,
) -> Result<Vec<ConnectionCandidate>, CoreError> {
    let base_url = normalize_service_url(input)?;
    let parsed = Url::parse(&base_url)?;
    if parsed.scheme() == "http" && !options.allow_http {
        return Err(CoreError::HttpNotAllowed);
    }
    let relay_mode = is_official_relay_host(parsed.host_str().unwrap_or_default());
    let mut rows = vec![ConnectionCandidate {
        probe_url: format!("{base_url}/license/v1/device/baseInfo"),
        relay_mode,
        label: format!("指定地址 · {}", parsed.host_str().unwrap_or_default()),
        base_url: base_url.clone(),
        priority: 0,
    }];

    if parsed.port().is_none() && !relay_mode && parsed.path() == "/" {
        let host = parsed.host_str().unwrap_or_default();
        let host = if host.contains(':') {
            format!("[{host}]")
        } else {
            host.to_owned()
        };
        if parsed.scheme() == "https" {
            let fallback = format!("https://{host}:5667");
            rows.push(ConnectionCandidate {
                probe_url: format!("{fallback}/license/v1/device/baseInfo"),
                relay_mode: false,
                label: "HTTPS 默认端口 · 5667".to_owned(),
                base_url: fallback,
                priority: 1,
            });
        } else if options.allow_http {
            let fallback = format!("http://{host}:5666");
            rows.push(ConnectionCandidate {
                probe_url: format!("{fallback}/license/v1/device/baseInfo"),
                relay_mode: false,
                label: "HTTP 默认端口 · 5666".to_owned(),
                base_url: fallback,
                priority: 1,
            });
        }
    }

    Ok(dedupe(rows))
}

fn ip_candidate(
    ip: &str,
    port: u16,
    https: bool,
    force_ipv6: bool,
    label: &str,
    priority: u16,
) -> ConnectionCandidate {
    let is_ipv6 = force_ipv6 || IpAddr::from_str(ip).is_ok_and(|addr| addr.is_ipv6());
    let host = if is_ipv6 {
        format!("[{ip}]")
    } else {
        ip.to_owned()
    };
    let scheme = if https { "https" } else { "http" };
    let base_url = format!("{scheme}://{host}:{port}");
    ConnectionCandidate {
        probe_url: format!("{base_url}/license/v1/device/baseInfo"),
        relay_mode: false,
        label: format!("{label} · {ip}:{port}"),
        base_url,
        priority,
    }
}

fn normalize_relay_url(input: &str) -> Result<String, CoreError> {
    let input = input.trim();
    let value = if input.starts_with("http://") || input.starts_with("https://") {
        input.to_owned()
    } else {
        format!("https://{input}")
    };
    let mut url = Url::parse(&value)?;
    url.set_scheme("https")
        .map_err(|_| CoreError::InvalidUrl(value.clone()))?;
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    let path = url.path().trim_end_matches('/').to_owned();
    url.set_path(&path);
    Ok(url.to_string().trim_end_matches('/').to_owned())
}

pub fn normalize_service_url(input: &str) -> Result<String, CoreError> {
    let mut url = Url::parse(input.trim())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(CoreError::InvalidUrl(input.to_owned()));
    }
    url.set_query(None);
    url.set_fragment(None);
    let mut path = url.path().replace("//", "/");
    path = path.trim_end_matches('/').to_owned();
    for suffix in ["/music/api/v1", "/music"] {
        if path.to_ascii_lowercase().ends_with(suffix) {
            let keep = path.len().saturating_sub(suffix.len());
            path.truncate(keep);
            break;
        }
    }
    path = path.trim_end_matches('/').to_owned();
    url.set_path(if path.is_empty() { "/" } else { &path });
    Ok(url.to_string().trim_end_matches('/').to_owned())
}

pub(crate) fn is_official_relay_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "fnos.net"
        || host.ends_with(".fnos.net")
        || host == "5ddd.com"
        || host.ends_with(".5ddd.com")
}

fn is_plain_fn_id(value: &str) -> bool {
    if value.starts_with("http://") || value.starts_with("https://") {
        return false;
    }
    let len = value.len();
    len > 0
        && len <= 63
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn dedupe(rows: Vec<ConnectionCandidate>) -> Vec<ConnectionCandidate> {
    let mut seen = std::collections::HashSet::new();
    rows.into_iter()
        .filter(|row| seen.insert(row.base_url.clone()))
        .collect()
}

const fn default_http_port() -> u16 {
    5666
}

const fn default_https_port() -> u16 {
    5667
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_explicit_fnos_address_as_url() {
        let options = DiscoveryOptions {
            allow_http: true,
            ..DiscoveryOptions::default()
        };
        let candidates = direct_candidates("https://pkxutao.fnos.net/music/", &options).unwrap();
        assert_eq!(candidates[0].base_url, "https://pkxutao.fnos.net");
        assert!(candidates[0].relay_mode);
        assert_eq!(candidates.len(), 1);
    }

    #[test]
    fn preserves_path_form() {
        assert_eq!(
            normalize_service_url("https://fnos.net/pkxutao/music/api/v1/").unwrap(),
            "https://fnos.net/pkxutao"
        );
    }

    #[test]
    fn adds_default_port_for_direct_nas_host() {
        let candidates = direct_candidates(
            "https://192.168.1.20",
            &DiscoveryOptions::default(),
        )
        .unwrap();
        assert_eq!(candidates[0].base_url, "https://192.168.1.20");
        assert_eq!(candidates[1].base_url, "https://192.168.1.20:5667");
    }
}
