use crate::models::{Album, Artist, LoginRequest, Page, SessionInfo, Track};
use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use md5::{Digest as Md5Digest, Md5};
use rand::Rng;
use reqwest::blocking::{Client, RequestBuilder, Response};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, COOKIE, LOCATION};
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use sha2::Sha256;
use std::collections::HashSet;
use std::io::{Read, Write};
use std::net::IpAddr;
use std::path::Path;
use std::time::{Duration, Instant};
use url::Url;
use uuid::Uuid;
use zeroize::Zeroize;

const API_PREFIX: &str = "/music/api/v1";
const FN_API_PATH: &str = "/api/v1/fn/con";
const FN_API_URL: &str = "https://5ddd.com/api/v1/fn/con";
const AUTHX_PREFIX: &str = "NDzZTVxnRKP8Z0jXg1VAMonaG8akvh";
const API_KEY: &str = "zIGtkc3dqZnJpd29qZXJqa2w7c";
const USER_AGENT: &str = "XT-Music-Native/0.3.0";

#[derive(Debug, Clone)]
struct Candidate {
    url: String,
    probe_url: String,
    relay_mode: bool,
    priority: i32,
    label: String,
}

#[derive(Debug, Clone)]
pub struct DiscoveryResult {
    pub server_url: String,
    pub relay_mode: bool,
    pub method: String,
}

#[derive(Clone)]
pub struct HttpTransport {
    client: Client,
    allow_http: bool,
}

impl HttpTransport {
    pub fn new(allow_http: bool, allow_self_signed: bool) -> Result<Self> {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(30))
            .danger_accept_invalid_certs(allow_self_signed)
            .build()
            .context("无法初始化网络客户端")?;
        Ok(Self { client, allow_http })
    }

    fn send_json(
        &self,
        method: Method,
        url: &str,
        headers: HeaderMap,
        body: Option<Value>,
        timeout: Duration,
    ) -> Result<(StatusCode, Value)> {
        let response = self.send(method, url, headers, body, timeout, 5)?;
        let status = response.status();
        let bytes = response.bytes().context("读取服务器响应失败")?;
        if bytes.len() > 32 * 1024 * 1024 {
            bail!("服务器响应过大");
        }
        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).with_context(|| {
                let preview = String::from_utf8_lossy(&bytes[..bytes.len().min(300)]);
                format!("服务器返回的不是有效 JSON：{preview}")
            })?
        };
        Ok((status, value))
    }

    fn send(
        &self,
        mut method: Method,
        url: &str,
        mut headers: HeaderMap,
        mut body: Option<Value>,
        timeout: Duration,
        max_redirects: usize,
    ) -> Result<Response> {
        let mut current = Url::parse(url).context("服务器地址格式不正确")?;
        self.validate_scheme(&current)?;
        for redirect_index in 0..=max_redirects {
            let request = self.request(
                method.clone(),
                current.as_str(),
                headers.clone(),
                body.clone(),
                timeout,
            );
            let response = request
                .send()
                .with_context(|| format!("无法连接 {}", current))?;
            if !response.status().is_redirection() {
                return Ok(response);
            }
            if redirect_index == max_redirects {
                bail!("服务器重定向次数过多");
            }
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| anyhow!("服务器重定向没有 Location 地址"))?;
            let next = current.join(location).context("服务器重定向地址无效")?;
            self.validate_scheme(&next)?;
            if current.scheme() == "https" && next.scheme() == "http" {
                bail!("已拒绝 HTTPS 降级到 HTTP 的重定向");
            }
            if origin(&current) != origin(&next) && !official_relay_transition(&current, &next) {
                remove_sensitive_headers(&mut headers);
            }
            if matches!(response.status(), StatusCode::SEE_OTHER)
                || (matches!(
                    response.status(),
                    StatusCode::MOVED_PERMANENTLY | StatusCode::FOUND
                ) && method == Method::POST)
            {
                method = Method::GET;
                body = None;
            }
            current = next;
        }
        unreachable!()
    }

    fn request(
        &self,
        method: Method,
        url: &str,
        headers: HeaderMap,
        body: Option<Value>,
        timeout: Duration,
    ) -> RequestBuilder {
        let mut builder = self
            .client
            .request(method, url)
            .headers(headers)
            .timeout(timeout);
        if let Some(value) = body {
            builder = builder.json(&value);
        }
        builder
    }

    fn validate_scheme(&self, url: &Url) -> Result<()> {
        match url.scheme() {
            "https" => Ok(()),
            "http" if self.allow_http => Ok(()),
            "http" => bail!("HTTP 连接未启用；只应在可信局域网中显式允许"),
            _ => bail!("仅支持 HTTP/HTTPS 地址"),
        }
    }

    fn download_to(&self, url: &str, headers: HeaderMap, path: &Path) -> Result<()> {
        let mut response = self.send(
            Method::GET,
            url,
            headers,
            None,
            Duration::from_secs(180),
            5,
        )?;
        if !response.status().is_success() {
            bail!("音频下载失败（HTTP {}）", response.status());
        }
        let temporary = path.with_extension("part");
        let mut file = std::fs::File::create(&temporary)
            .context("无法创建音频缓存文件")?;
        let mut buffer = [0u8; 128 * 1024];
        let mut total = 0u64;
        loop {
            let count = response.read(&mut buffer).context("读取音频流失败")?;
            if count == 0 {
                break;
            }
            total += count as u64;
            if total > 2 * 1024 * 1024 * 1024 {
                let _ = std::fs::remove_file(&temporary);
                bail!("音频文件超过 2 GiB 安全限制");
            }
            file.write_all(&buffer[..count])
                .context("写入音频缓存失败")?;
        }
        file.flush()?;
        std::fs::rename(&temporary, path).context("无法完成音频缓存")?;
        Ok(())
    }
}

pub fn discover(
    input: &str,
    allow_http: bool,
    allow_self_signed: bool,
) -> Result<DiscoveryResult> {
    let value = input.trim();
    if value.is_empty() {
        bail!("请输入服务器地址或 FN ID");
    }
    let mut candidates = if value.starts_with("http://") || value.starts_with("https://") {
        direct_candidates(value, allow_http)?
    } else {
        fn_id_candidates(value, allow_http)?
    };
    candidates.sort_by_key(|item| item.priority);
    let transport = HttpTransport::new(allow_http, allow_self_signed)?;
    let mut errors = Vec::new();
    for candidate in candidates {
        let started = Instant::now();
        let mut headers = HeaderMap::new();
        if candidate.relay_mode {
            headers.insert(COOKIE, HeaderValue::from_static("mode=relay"));
        }
        match transport.send(
            Method::GET,
            &candidate.probe_url,
            headers,
            None,
            Duration::from_secs(10),
            2,
        ) {
            Ok(response) if response.status().as_u16() < 500 => {
                return Ok(DiscoveryResult {
                    server_url: normalize_service_url(&candidate.url)?,
                    relay_mode: candidate.relay_mode,
                    method: candidate.label,
                });
            }
            Ok(response) => errors.push(format!(
                "{}: HTTP {}",
                candidate.label,
                response.status()
            )),
            Err(error) => errors.push(format!(
                "{}: {}（{}ms）",
                candidate.label,
                error,
                started.elapsed().as_millis()
            )),
        }
    }
    bail!(
        "没有找到可连接的飞牛音乐服务：{}",
        errors
            .into_iter()
            .take(5)
            .collect::<Vec<_>>()
            .join("；")
    )
}

fn direct_candidates(input: &str, allow_http: bool) -> Result<Vec<Candidate>> {
    let parsed = Url::parse(input)
        .context("服务器地址应以 http:// 或 https:// 开头")?;
    if !matches!(parsed.scheme(), "http" | "https") {
        bail!("仅支持 HTTP/HTTPS 地址");
    }
    if parsed.scheme() == "http" && !allow_http {
        bail!("请先勾选允许 HTTP 直连");
    }
    let base = normalize_service_url(input)?;
    let relay = is_fn_connect_host(parsed.host_str().unwrap_or_default());
    let mut rows = vec![Candidate {
        url: base.clone(),
        probe_url: format!("{base}/music/"),
        relay_mode: relay,
        priority: 0,
        label: format!(
            "指定地址 · {}",
            parsed.host_str().unwrap_or("server")
        ),
    }];
    if parsed.port().is_none()
        && !relay
        && parsed.path().trim_matches('/').is_empty()
    {
        let host = parsed.host_str().unwrap_or_default();
        if parsed.scheme() == "https" {
            rows.push(Candidate {
                url: format!("https://{host}:5667"),
                probe_url: format!("https://{host}:5667/music/"),
                relay_mode: false,
                priority: 1,
                label: "HTTPS 默认端口 5667".into(),
            });
        } else if allow_http {
            rows.push(Candidate {
                url: format!("http://{host}:5666"),
                probe_url: format!("http://{host}:5666/music/"),
                relay_mode: false,
                priority: 1,
                label: "HTTP 默认端口 5666".into(),
            });
        }
    }
    Ok(dedupe_candidates(rows))
}

fn fn_id_candidates(input: &str, allow_http: bool) -> Result<Vec<Candidate>> {
    let id = normalize_fn_id(input);
    if !valid_fn_id(&id) {
        bail!("FN ID 格式不正确");
    }
    let mut rows = vec![
        Candidate {
            url: format!("https://{id}.fnos.net"),
            probe_url: format!("https://{id}.fnos.net/music/"),
            relay_mode: true,
            priority: 35,
            label: format!("FNOS 域名 · {id}.fnos.net"),
        },
        Candidate {
            url: format!("https://fnos.net/{id}"),
            probe_url: format!("https://fnos.net/{id}/music/"),
            relay_mode: true,
            priority: 36,
            label: format!("FNOS 路径 · fnos.net/{id}"),
        },
    ];
    let strict = HttpTransport::new(false, false)?;
    let payload = json!({"fnId": id});
    let mut headers = HeaderMap::new();
    headers.insert(
        HeaderName::from_static("authx"),
        HeaderValue::from_str(&compute_authx(FN_API_PATH, &payload))?,
    );
    if let Ok((status, response)) = strict.send_json(
        Method::POST,
        FN_API_URL,
        headers,
        Some(payload),
        Duration::from_secs(10),
    ) {
        if status.is_success()
            && response.get("code").and_then(Value::as_i64) == Some(0)
        {
            if let Some(data) = response.get("data") {
                let https_port = data
                    .pointer("/port/httpsPort")
                    .and_then(Value::as_u64)
                    .unwrap_or(5667);
                let http_port = data
                    .pointer("/port/httpPort")
                    .and_then(Value::as_u64)
                    .unwrap_or(5666);
                for ip in string_array(data.get("ipv4")) {
                    rows.push(ip_candidate(
                        &ip,
                        https_port,
                        false,
                        10,
                        "内网 HTTPS",
                    ));
                    if allow_http {
                        rows.push(ip_candidate(
                            &ip,
                            http_port,
                            true,
                            11,
                            "内网 HTTP",
                        ));
                    }
                }
                for ip in string_array(data.get("publicIpv6")) {
                    rows.push(ip_candidate(
                        &ip,
                        https_port,
                        false,
                        20,
                        "公网 IPv6",
                    ));
                }
                for ip in string_array(data.get("publicIpv4")) {
                    rows.push(ip_candidate(
                        &ip,
                        https_port,
                        false,
                        30,
                        "公网 IPv4",
                    ));
                }
                for relay in string_array(data.get("fn")) {
                    if let Ok(url) = normalize_relay_url(&relay) {
                        rows.push(Candidate {
                            probe_url: format!("{url}/music/"),
                            url: url.clone(),
                            relay_mode: true,
                            priority: 40,
                            label: format!("FN Connect 中继 · {url}"),
                        });
                    }
                }
            }
        }
    }
    Ok(dedupe_candidates(rows))
}

fn ip_candidate(
    ip: &str,
    port: u64,
    http: bool,
    priority: i32,
    label: &str,
) -> Candidate {
    let host = if ip.contains(':') {
        format!("[{ip}]")
    } else {
        ip.to_owned()
    };
    let scheme = if http { "http" } else { "https" };
    let url = format!("{scheme}://{host}:{port}");
    Candidate {
        probe_url: format!("{url}/music/"),
        url,
        relay_mode: false,
        priority,
        label: format!("{label} · {ip}:{port}"),
    }
}

#[derive(Clone)]
pub struct FeiniuClient {
    transport: HttpTransport,
    base_url: String,
    token: String,
    access_code: String,
    relay_mode: bool,
    device_id: String,
}

impl FeiniuClient {
    pub fn login(mut request: LoginRequest) -> Result<(Self, SessionInfo)> {
        let discovery = discover(
            &request.server_input,
            request.allow_http,
            request.allow_self_signed,
        )?;
        let transport = HttpTransport::new(
            request.allow_http,
            request.allow_self_signed,
        )?;
        let mut client = Self {
            transport,
            base_url: discovery.server_url.clone(),
            token: String::new(),
            access_code: request.access_code.clone(),
            relay_mode: discovery.relay_mode,
            device_id: Uuid::new_v4().simple().to_string(),
        };
        let password_hash = sha256_hex(&request.password);
        request.password.zeroize();
        let login_username = request.username.clone();
        let payload = client.api(
            Method::POST,
            "/user/password-login",
            None,
            Some(json!({
                "username": login_username,
                "password": password_hash,
                "deviceId": client.device_id,
            })),
            false,
        )?;
        let data = success_data(payload, "登录失败")?;
        let token = data
            .get("userToken")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("登录响应中没有 music-token"))?;
        client.token = token.to_owned();
        let username = data
            .pointer("/user/name")
            .and_then(Value::as_str)
            .unwrap_or(&request.username)
            .to_owned();
        Ok((
            client,
            SessionInfo {
                username,
                server_url: discovery.server_url,
                relay_mode: discovery.relay_mode,
                method: discovery.method,
            },
        ))
    }

    pub fn tracks(&self, page: usize, size: usize) -> Result<Page<Track>> {
        self.page("/track/list", page, size)
    }

    pub fn albums(&self, page: usize, size: usize) -> Result<Page<Album>> {
        self.page("/album/list", page, size)
    }

    pub fn artists(&self, page: usize, size: usize) -> Result<Page<Artist>> {
        self.page("/artist/list", page, size)
    }

    pub fn favorites(&self, page: usize, size: usize) -> Result<Page<Track>> {
        self.page("/favorite-track/list", page, size)
    }

    pub fn history(&self, page: usize, size: usize) -> Result<Page<Track>> {
        self.page("/play-history/list", page, size)
    }

    pub fn lyrics(&self, guid: &str) -> Result<String> {
        let query = [("trackGUID", guid.to_owned())];
        let payload = self.api(
            Method::GET,
            "/lyric/list",
            Some(&query),
            None,
            true,
        )?;
        let data = success_data(payload, "获取歌词失败")?;
        let list = data
            .get("list")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let preferred = data.get("preferred").and_then(Value::as_str);
        let row = preferred
            .and_then(|guid| {
                list.iter().find(|item| {
                    item.get("guid").and_then(Value::as_str) == Some(guid)
                })
            })
            .or_else(|| list.first());
        Ok(row
            .and_then(|item| item.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned())
    }

    pub fn set_favorite(&self, track: &Track, value: bool) -> Result<()> {
        let path = if value {
            "/favorite-track/create"
        } else {
            "/favorite-track/delete"
        };
        let payload = self.api(
            Method::POST,
            path,
            None,
            Some(json!({"trackGUID": track.guid})),
            true,
        )?;
        let _ = success_data(payload, "修改收藏失败")?;
        Ok(())
    }

    pub fn download_track(&self, track: &Track, path: &Path) -> Result<()> {
        let query = [("guid", track.guid.clone())];
        let url = self.url_with_query("/track/stream", &query)?;
        self.transport
            .download_to(&url, self.auth_headers()?, path)
    }

    fn page<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        page: usize,
        size: usize,
    ) -> Result<Page<T>> {
        let query = [
            ("page", page.to_string()),
            ("size", size.to_string()),
        ];
        let payload = self.api(Method::GET, path, Some(&query), None, true)?;
        let data = success_data(payload, "加载音乐库失败")?;
        let list = serde_json::from_value::<Vec<T>>(
            data.get("list")
                .cloned()
                .unwrap_or_else(|| json!([])),
        )
        .context("音乐库数据格式不兼容")?;
        let total = data
            .get("total")
            .and_then(Value::as_u64)
            .unwrap_or(list.len() as u64) as usize;
        Ok(Page { list, total })
    }

    fn api(
        &self,
        method: Method,
        path: &str,
        query: Option<&[(&str, String)]>,
        body: Option<Value>,
        authenticated: bool,
    ) -> Result<Value> {
        let url = self.url_with_query(path, query.unwrap_or_default())?;
        let headers = if authenticated {
            self.auth_headers()?
        } else {
            self.pre_auth_headers()?
        };
        let (status, payload) = self.transport.send_json(
            method,
            &url,
            headers,
            body,
            Duration::from_secs(25),
        )?;
        if status == StatusCode::UNAUTHORIZED {
            bail!("登录状态已失效，请重新登录");
        }
        if status.is_server_error() {
            bail!("飞牛音乐服务暂时不可用（HTTP {status}）");
        }
        Ok(payload)
    }

    fn url_with_query(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<String> {
        let mut url = Url::parse(&format!(
            "{}{}{}",
            self.base_url, API_PREFIX, path
        ))?;
        for (key, value) in query {
            url.query_pairs_mut().append_pair(key, value);
        }
        Ok(url.to_string())
    }

    fn pre_auth_headers(&self) -> Result<HeaderMap> {
        let mut headers = HeaderMap::new();
        if self.relay_mode {
            headers.insert(COOKIE, HeaderValue::from_static("mode=relay"));
        }
        self.add_access_headers(&mut headers)?;
        Ok(headers)
    }

    fn auth_headers(&self) -> Result<HeaderMap> {
        let mut headers = HeaderMap::new();
        let mut cookies = Vec::new();
        if !self.token.is_empty() {
            cookies.push(format!("music-token={}", self.token));
        }
        if self.relay_mode {
            cookies.push("mode=relay".into());
        }
        if !cookies.is_empty() {
            headers.insert(
                COOKIE,
                HeaderValue::from_str(&cookies.join("; "))?,
            );
        }
        self.add_access_headers(&mut headers)?;
        Ok(headers)
    }

    fn add_access_headers(&self, headers: &mut HeaderMap) -> Result<()> {
        if self.access_code.is_empty() {
            return Ok(());
        }
        headers.insert(
            HeaderName::from_static("x-access-code"),
            HeaderValue::from_str(
                &STANDARD.encode(self.access_code.as_bytes()),
            )?,
        );
        headers.insert(
            HeaderName::from_static("x-access-source"),
            HeaderValue::from_static("app"),
        );
        Ok(())
    }
}

fn success_data(payload: Value, fallback: &str) -> Result<Value> {
    let code = payload
        .get("code")
        .and_then(Value::as_i64)
        .unwrap_or(-1);
    if code != 0 {
        let message = payload
            .get("msg")
            .and_then(Value::as_str)
            .unwrap_or(fallback);
        if code == 120001 {
            bail!("用户名或密码错误，请重试");
        }
        bail!("{message}（业务码 {code}）");
    }
    Ok(payload.get("data").cloned().unwrap_or(Value::Null))
}

fn sha256_hex(value: &str) -> String {
    use sha2::Digest;
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn compute_authx(path: &str, body: &Value) -> String {
    let nonce = rand::thread_rng()
        .gen_range(100000..=999999)
        .to_string();
    let timestamp = unix_millis().to_string();
    let serialized = serde_json::to_string(body)
        .unwrap_or_else(|_| "{}".into());
    let body_md5 = md5_hex(&serialized);
    let raw = [
        AUTHX_PREFIX,
        path,
        &nonce,
        &timestamp,
        &body_md5,
        API_KEY,
    ]
    .join("_");
    format!(
        "nonce={nonce}&timestamp={timestamp}&sign={}",
        md5_hex(&raw)
    )
}

fn md5_hex(value: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn unix_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn normalize_service_url(value: &str) -> Result<String> {
    let mut url = Url::parse(value)
        .context("服务器地址格式不正确")?;
    if !matches!(url.scheme(), "http" | "https") {
        bail!("仅支持 HTTP/HTTPS 地址");
    }
    url.set_query(None);
    url.set_fragment(None);
    let mut path = url.path().replace("//", "/");
    let lower = path.to_ascii_lowercase();
    if let Some(index) = lower.find("/music/api/v1") {
        path.truncate(index);
    } else if lower.ends_with("/music/") {
        path.truncate(path.len() - 7);
    } else if lower.ends_with("/music") {
        path.truncate(path.len() - 6);
    }
    path = path.trim_end_matches('/').to_owned();
    url.set_path(if path.is_empty() { "/" } else { &path });
    Ok(url.to_string().trim_end_matches('/').to_owned())
}

fn normalize_fn_id(value: &str) -> String {
    value.trim().trim_end_matches('/').to_ascii_lowercase()
}

fn valid_fn_id(value: &str) -> bool {
    if value.is_empty() || value.len() > 63 {
        return false;
    }
    let bytes = value.as_bytes();
    if !bytes[0].is_ascii_alphanumeric()
        || !bytes[bytes.len() - 1].is_ascii_alphanumeric()
    {
        return false;
    }
    bytes
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
}

fn normalize_relay_url(value: &str) -> Result<String> {
    let input = if value.starts_with("http://")
        || value.starts_with("https://")
    {
        value.to_owned()
    } else {
        format!("https://{value}")
    };
    let mut url = Url::parse(&input)?;
    url.set_scheme("https")
        .map_err(|_| anyhow!("中继地址无效"))?;
    url.set_username("")
        .map_err(|_| anyhow!("中继地址无效"))?;
    url.set_password(None)
        .map_err(|_| anyhow!("中继地址无效"))?;
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string().trim_end_matches('/').to_owned())
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn dedupe_candidates(rows: Vec<Candidate>) -> Vec<Candidate> {
    let mut seen = HashSet::new();
    rows.into_iter()
        .filter(|item| {
            seen.insert(format!("{}|{}", item.url, item.probe_url))
        })
        .collect()
}

fn is_fn_connect_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "5ddd.com"
        || host.ends_with(".5ddd.com")
        || host == "fnos.net"
        || host.ends_with(".fnos.net")
}

fn official_relay_transition(from: &Url, to: &Url) -> bool {
    from.scheme() == "https"
        && to.scheme() == "https"
        && is_fn_connect_host(from.host_str().unwrap_or_default())
        && is_fn_connect_host(to.host_str().unwrap_or_default())
}

fn origin(url: &Url) -> (String, String, Option<u16>) {
    (
        url.scheme().to_owned(),
        url.host_str()
            .unwrap_or_default()
            .to_ascii_lowercase(),
        url.port_or_known_default(),
    )
}

fn remove_sensitive_headers(headers: &mut HeaderMap) {
    headers.remove(COOKIE);
    headers.remove(AUTHORIZATION);
    for name in ["x-access-code", "x-access-source"] {
        headers.remove(name);
    }
}

#[allow(dead_code)]
fn is_private_host(host: &str) -> bool {
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            ip.is_private() || ip.is_loopback() || ip.is_link_local()
        }
        Ok(IpAddr::V6(ip)) => {
            ip.is_loopback()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
        }
        Err(_) => host.eq_ignore_ascii_case("localhost"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_hash_matches_sha256() {
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn explicit_fnos_url_stays_explicit() {
        let rows = direct_candidates(
            "https://pkxutao.fnos.net/music/",
            false,
        )
        .unwrap();
        assert_eq!(rows[0].url, "https://pkxutao.fnos.net");
        assert!(rows[0].relay_mode);
    }

    #[test]
    fn cross_domain_policy_is_narrow() {
        let a = Url::parse("https://pkxutao.fnos.net/music").unwrap();
        let b = Url::parse("https://pkxutao.5ddd.com/music").unwrap();
        let evil = Url::parse("https://example.com/").unwrap();
        assert!(official_relay_transition(&a, &b));
        assert!(!official_relay_transition(&a, &evil));
    }
}
