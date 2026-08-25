use crate::model::{
    parse_list, parse_total, Album, Artist, Genre, LibraryPage, Lyrics, Playlist, Track,
};
use base64::Engine;
use chrono::Utc;
use md5::{Digest as Md5Digest, Md5};
use reqwest::blocking::{Client, Response};
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE, COOKIE, LOCATION,
};
use reqwest::{Method, StatusCode};
use serde_json::{json, Map, Value};
use sha2::Sha256;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};
use thiserror::Error;
use url::Url;

const API_PREFIX: &str = "/music/api/v1";
const AUTHX_PREFIX: &str = "NDzZTVxnRKP8Z0jXg1VAMonaG8akvh";
const FN_API_KEY: &str = "zIGtkc3dqZnJpd29qZXJqa2w7c";
const FN_API_PATH: &str = "/api/v1/fn/con";
const FN_API_URL: &str = "https://5ddd.com/api/v1/fn/con";

#[derive(Debug, Error, Clone)]
#[error("{message}")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub details: Option<Value>,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn details(mut self, value: Value) -> Self {
        self.details = Some(value);
        self
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[derive(Clone)]
pub struct Transport {
    strict: Client,
    insecure: Client,
}

#[derive(Debug, Clone, Default)]
pub struct RequestOptions {
    pub allow_http: bool,
    pub allow_self_signed: bool,
    pub timeout: Duration,
}

impl Transport {
    pub fn new() -> AppResult<Self> {
        Ok(Self {
            strict: build_http_client(false)?,
            insecure: build_http_client(true)?,
        })
    }

    fn send(
        &self,
        method: Method,
        url: &str,
        mut headers: HeaderMap,
        body: Option<Vec<u8>>,
        options: RequestOptions,
    ) -> AppResult<Response> {
        let mut current_url = Url::parse(url)
            .map_err(|_| AppError::new("INVALID_URL", "服务器地址格式不正确"))?;
        let mut current_method = method;
        let mut current_body = body;

        for _ in 0..=5 {
            if current_url.scheme() == "http" && !options.allow_http {
                return Err(AppError::new(
                    "HTTP_NOT_ALLOWED",
                    "当前连接使用 HTTP，请先明确启用“允许 HTTP”",
                ));
            }
            if current_url.scheme() != "http" && current_url.scheme() != "https" {
                return Err(AppError::new(
                    "INVALID_URL",
                    "服务器地址仅支持 HTTP 或 HTTPS",
                ));
            }

            let client = if options.allow_self_signed {
                &self.insecure
            } else {
                &self.strict
            };
            let mut request = client
                .request(current_method.clone(), current_url.clone())
                .headers(headers.clone())
                .timeout(if options.timeout.is_zero() {
                    Duration::from_secs(20)
                } else {
                    options.timeout
                });
            if let Some(bytes) = current_body.as_ref() {
                request = request.body(bytes.clone());
            }
            let response = request.send().map_err(map_network_error)?;
            if !response.status().is_redirection() {
                return Ok(response);
            }

            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| AppError::new("BAD_REDIRECT", "服务器重定向缺少 Location"))?;
            let next = current_url
                .join(location)
                .map_err(|_| AppError::new("BAD_REDIRECT", "服务器返回了无效重定向地址"))?;
            let same_origin = origin(&current_url) == origin(&next);
            let trusted_relay = is_official_relay_transition(&current_url, &next);
            if !same_origin && !trusted_relay {
                strip_sensitive_headers(&mut headers);
            }
            if current_url.scheme() == "https" && next.scheme() == "http" {
                strip_sensitive_headers(&mut headers);
                if !options.allow_http {
                    return Err(AppError::new(
                        "HTTPS_DOWNGRADE_BLOCKED",
                        "已阻止从 HTTPS 降级到 HTTP 的重定向",
                    ));
                }
            }

            let status = response.status();
            if status == StatusCode::SEE_OTHER
                || ((status == StatusCode::MOVED_PERMANENTLY
                    || status == StatusCode::FOUND)
                    && current_method == Method::POST)
            {
                current_method = Method::GET;
                current_body = None;
                headers.remove(CONTENT_TYPE);
            }
            current_url = next;
        }
        Err(AppError::new(
            "TOO_MANY_REDIRECTS",
            "服务器重定向次数过多",
        ))
    }

    pub fn json(
        &self,
        method: Method,
        url: &str,
        mut headers: HeaderMap,
        body: Option<Value>,
        options: RequestOptions,
    ) -> AppResult<(StatusCode, Value)> {
        let encoded = if let Some(value) = body {
            headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            Some(
                serde_json::to_vec(&value)
                    .map_err(|error| AppError::new("INVALID_JSON", error.to_string()))?,
            )
        } else {
            None
        };
        let response = self.send(method, url, headers, encoded, options)?;
        let status = response.status();
        let bytes = response
            .bytes()
            .map_err(|error| AppError::new("READ_FAILED", error.to_string()))?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err(AppError::new("RESPONSE_TOO_LARGE", "服务器响应过大"));
        }
        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).map_err(|error| {
                AppError::new(
                    "INVALID_SERVER_RESPONSE",
                    format!("服务器返回的不是有效 JSON：{error}"),
                )
            })?
        };
        Ok((status, value))
    }

    pub fn bytes(
        &self,
        method: Method,
        url: &str,
        headers: HeaderMap,
        options: RequestOptions,
    ) -> AppResult<(StatusCode, Vec<u8>, HeaderMap)> {
        let response = self.send(method, url, headers, None, options)?;
        let status = response.status();
        let response_headers = response.headers().clone();
        let bytes = response
            .bytes()
            .map_err(|error| AppError::new("READ_FAILED", error.to_string()))?
            .to_vec();
        Ok((status, bytes, response_headers))
    }

    pub fn download(
        &self,
        url: &str,
        headers: HeaderMap,
        options: RequestOptions,
        path: &Path,
    ) -> AppResult<u64> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| AppError::new("CACHE_FAILED", error.to_string()))?;
        }
        let mut response = self.send(Method::GET, url, headers, None, options)?;
        if !response.status().is_success() {
            return Err(AppError::new(
                "DOWNLOAD_FAILED",
                format!("音频下载失败（HTTP {}）", response.status()),
            ));
        }
        let temporary = path.with_extension("part");
        let mut file = File::create(&temporary)
            .map_err(|error| AppError::new("CACHE_FAILED", error.to_string()))?;
        let copied = std::io::copy(&mut response, &mut file)
            .map_err(|error| AppError::new("DOWNLOAD_FAILED", error.to_string()))?;
        file.flush()
            .map_err(|error| AppError::new("CACHE_FAILED", error.to_string()))?;
        fs::rename(&temporary, path)
            .map_err(|error| AppError::new("CACHE_FAILED", error.to_string()))?;
        Ok(copied)
    }
}

#[derive(Debug, Clone, Default)]
pub struct ConnectionOptions {
    pub allow_http: bool,
    pub allow_public_http: bool,
    pub allow_self_signed: bool,
}

#[derive(Debug, Clone)]
pub struct Candidate {
    pub url: String,
    pub probe_url: String,
    pub relay_mode: bool,
    pub label: String,
    pub priority: i32,
}

#[derive(Debug, Clone)]
pub struct ConnectionResult {
    pub server_url: String,
    pub relay_mode: bool,
    pub method: String,
    pub fn_id: Option<String>,
    pub diagnostics: Vec<String>,
}

#[derive(Clone)]
pub struct Discovery {
    transport: Transport,
}

impl Discovery {
    pub fn new(transport: Transport) -> Self {
        Self { transport }
    }

    pub fn resolve<F>(
        &self,
        input: &str,
        options: &ConnectionOptions,
        mut progress: F,
    ) -> AppResult<ConnectionResult>
    where
        F: FnMut(String),
    {
        let value = input.trim();
        if value.is_empty() {
            return Err(AppError::new("SERVER_REQUIRED", "请输入服务器地址或 FN ID"));
        }
        let (fn_id, mut candidates) = if is_valid_fn_id(value) && !value.contains("://") {
            progress("正在查询 FN Connect 地址…".into());
            let mut candidates = self.lookup_fn(value, options).unwrap_or_default();
            candidates.extend(fn_fallback_candidates(value));
            (Some(value.to_ascii_lowercase()), candidates)
        } else {
            (None, direct_candidates(value, options)?)
        };
        candidates.sort_by_key(|item| item.priority);
        dedupe_candidates(&mut candidates);
        if candidates.is_empty() {
            return Err(AppError::new("NO_CANDIDATES", "没有可探测的飞牛音乐地址"));
        }

        let mut diagnostics = Vec::new();
        for candidate in candidates {
            progress(format!("正在探测：{}", candidate.label));
            let started = Instant::now();
            let mut headers = HeaderMap::new();
            if candidate.relay_mode {
                headers.insert(COOKIE, HeaderValue::from_static("mode=relay"));
            }
            let result = self.transport.bytes(
                Method::GET,
                &candidate.probe_url,
                headers,
                RequestOptions {
                    allow_http: options.allow_http,
                    allow_self_signed: options.allow_self_signed,
                    timeout: Duration::from_secs(if candidate.relay_mode { 10 } else { 4 }),
                },
            );
            match result {
                Ok((status, _, _)) if status.as_u16() < 500 => {
                    let server_url = normalize_service_url(&candidate.url)?;
                    progress(format!("已连接：{}", candidate.label));
                    return Ok(ConnectionResult {
                        server_url,
                        relay_mode: candidate.relay_mode,
                        method: candidate.label,
                        fn_id,
                        diagnostics,
                    });
                }
                Ok((status, _, _)) => diagnostics.push(format!(
                    "{}：HTTP {}（{} ms）",
                    candidate.label,
                    status,
                    started.elapsed().as_millis()
                )),
                Err(error) => diagnostics.push(format!(
                    "{}：{}（{} ms）",
                    candidate.label,
                    error.message,
                    started.elapsed().as_millis()
                )),
            }
        }
        Err(AppError::new("NO_REACHABLE_SERVER", "没有找到可连接的飞牛音乐服务")
            .details(json!({ "diagnostics": diagnostics })))
    }

    fn lookup_fn(
        &self,
        fn_id: &str,
        options: &ConnectionOptions,
    ) -> AppResult<Vec<Candidate>> {
        let data = json!({ "fnId": fn_id.to_ascii_lowercase() });
        let body = serde_json::to_string(&data)
            .map_err(|error| AppError::new("INVALID_JSON", error.to_string()))?;
        let nonce = 100_000 + rand::random::<u32>() % 900_000;
        let timestamp = Utc::now().timestamp_millis().to_string();
        let body_md5 = md5_hex(body.as_bytes());
        let signature = md5_hex(
            format!(
                "{AUTHX_PREFIX}_{FN_API_PATH}_{nonce}_{timestamp}_{body_md5}_{FN_API_KEY}"
            )
            .as_bytes(),
        );
        let authx = format!("nonce={nonce}&timestamp={timestamp}&sign={signature}");
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("authx"),
            HeaderValue::from_str(&authx)
                .map_err(|_| AppError::new("INVALID_HEADER", "FN Connect 签名格式错误"))?,
        );
        let (_, payload) = self.transport.json(
            Method::POST,
            FN_API_URL,
            headers,
            Some(data),
            RequestOptions {
                allow_http: false,
                allow_self_signed: false,
                timeout: Duration::from_secs(10),
            },
        )?;
        if payload.get("code").and_then(Value::as_i64).unwrap_or(-1) != 0 {
            return Err(AppError::new(
                "FNID_LOOKUP_FAILED",
                payload
                    .get("msg")
                    .and_then(Value::as_str)
                    .unwrap_or("FN ID 查询失败"),
            ));
        }
        let data = payload.get("data").cloned().unwrap_or_default();
        let http_port = nested_u64(&data, "port", "httpPort").unwrap_or(5666);
        let https_port = nested_u64(&data, "port", "httpsPort").unwrap_or(5667);
        let mut rows = Vec::new();
        for ip in string_array(data.get("ipv4")) {
            rows.push(candidate(
                format!("https://{ip}:{https_port}"),
                false,
                format!("内网 HTTPS · {ip}:{https_port}"),
                10,
            ));
            if options.allow_http {
                rows.push(candidate(
                    format!("http://{ip}:{http_port}"),
                    false,
                    format!("内网 HTTP · {ip}:{http_port}"),
                    11,
                ));
            }
        }
        for ip in string_array(data.get("publicIpv6")) {
            rows.push(candidate(
                format!("https://[{ip}]:{https_port}"),
                false,
                format!("公网 IPv6 · {ip}"),
                20,
            ));
        }
        for ip in string_array(data.get("publicIpv4")) {
            rows.push(candidate(
                format!("https://{ip}:{https_port}"),
                false,
                format!("公网 IPv4 HTTPS · {ip}"),
                30,
            ));
            if options.allow_http && options.allow_public_http {
                rows.push(candidate(
                    format!("http://{ip}:{http_port}"),
                    false,
                    format!("公网 IPv4 HTTP · {ip}"),
                    31,
                ));
            }
        }
        let relays = string_array(data.get("fn"));
        for relay in if relays.is_empty() {
            vec![format!("{}.5ddd.com", fn_id.to_ascii_lowercase())]
        } else {
            relays
        } {
            let url = if relay.starts_with("http://") || relay.starts_with("https://") {
                relay
            } else {
                format!("https://{relay}")
            };
            rows.push(candidate(url.clone(), true, format!("FN Connect 中继 · {url}"), 40));
        }
        Ok(rows)
    }
}

#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub server_url: String,
    pub token: String,
    pub relay_mode: bool,
    pub access_code: String,
    pub allow_http: bool,
    pub allow_self_signed: bool,
    pub device_id: String,
}

#[derive(Clone)]
pub struct MusicClient {
    transport: Transport,
    pub config: ClientConfig,
}

impl MusicClient {
    pub fn new(transport: Transport, config: ClientConfig) -> Self {
        Self { transport, config }
    }

    pub fn login(&mut self, username: &str, password: &str) -> AppResult<(String, String)> {
        let password_hash = hex::encode(Sha256::digest(password.as_bytes()));
        let data = self.api(
            Method::POST,
            "/user/password-login",
            None,
            Some(json!({
                "username": username,
                "password": password_hash,
                "deviceId": self.config.device_id,
            })),
            false,
        )?;
        let token = data
            .get("userToken")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if token.is_empty() {
            return Err(AppError::new(
                "LOGIN_INVALID_RESPONSE",
                "登录响应中没有会话令牌",
            ));
        }
        let display_name = data
            .get("user")
            .and_then(|user| user.get("name"))
            .and_then(Value::as_str)
            .unwrap_or(username)
            .to_owned();
        self.config.token = token.clone();
        Ok((token, display_name))
    }

    pub fn validate(&self) -> AppResult<()> {
        self.tracks(1, 1).map(|_| ())
    }

    pub fn tracks(&self, page: usize, size: usize) -> AppResult<LibraryPage> {
        let value = self.page("/track/list", json!({ "page": page, "size": size }))?;
        Ok(LibraryPage {
            tracks: parse_list(&value).iter().map(Track::from_value).collect(),
            total: parse_total(&value),
            ..Default::default()
        })
    }

    pub fn albums(&self, page: usize, size: usize) -> AppResult<LibraryPage> {
        let value = self.page("/album/list", json!({ "page": page, "size": size }))?;
        Ok(LibraryPage {
            albums: parse_list(&value).iter().map(Album::from_value).collect(),
            total: parse_total(&value),
            ..Default::default()
        })
    }

    pub fn artists(&self, page: usize, size: usize) -> AppResult<LibraryPage> {
        let value = self.page("/artist/list", json!({ "page": page, "size": size }))?;
        Ok(LibraryPage {
            artists: parse_list(&value).iter().map(Artist::from_value).collect(),
            total: parse_total(&value),
            ..Default::default()
        })
    }

    pub fn genres(&self, page: usize, size: usize) -> AppResult<LibraryPage> {
        let value = self.page("/genre/list", json!({ "page": page, "size": size }))?;
        Ok(LibraryPage {
            genres: parse_list(&value).iter().map(Genre::from_value).collect(),
            total: parse_total(&value),
            ..Default::default()
        })
    }

    pub fn playlists(&self, page: usize, size: usize) -> AppResult<LibraryPage> {
        let value = self.page("/playlist/list", json!({ "page": page, "size": size }))?;
        Ok(LibraryPage {
            playlists: parse_list(&value).iter().map(Playlist::from_value).collect(),
            total: parse_total(&value),
            ..Default::default()
        })
    }

    pub fn favorites(&self, page: usize, size: usize) -> AppResult<LibraryPage> {
        let value = self.page(
            "/favorite-track/list",
            json!({ "page": page, "size": size }),
        )?;
        Ok(LibraryPage {
            tracks: parse_list(&value).iter().map(Track::from_value).collect(),
            total: parse_total(&value),
            ..Default::default()
        })
    }

    pub fn history(&self, page: usize, size: usize) -> AppResult<LibraryPage> {
        let value = self.page(
            "/play-history/list",
            json!({ "page": page, "size": size }),
        )?;
        Ok(LibraryPage {
            tracks: parse_list(&value).iter().map(Track::from_value).collect(),
            total: parse_total(&value),
            ..Default::default()
        })
    }

    pub fn search(&self, query: &str) -> AppResult<LibraryPage> {
        let mut result = LibraryPage::default();
        let query_value = json!({ "q": query, "keyword": query, "page": 1, "size": 100 });
        if let Ok(value) = self.page("/search/track", query_value.clone()) {
            result.tracks = parse_list(&value).iter().map(Track::from_value).collect();
        }
        if let Ok(value) = self.page("/search/album", query_value.clone()) {
            result.albums = parse_list(&value).iter().map(Album::from_value).collect();
        }
        if let Ok(value) = self.page("/search/artist", query_value) {
            result.artists = parse_list(&value).iter().map(Artist::from_value).collect();
        }
        result.total = result.tracks.len() + result.albums.len() + result.artists.len();
        Ok(result)
    }

    pub fn lyrics(&self, track_guid: &str) -> AppResult<Lyrics> {
        let value = self.api(
            Method::GET,
            "/lyric/list",
            Some(json!({ "trackGUID": track_guid })),
            None,
            true,
        )?;
        let list = value.get("list").and_then(Value::as_array).cloned().unwrap_or_default();
        let preferred = value.get("preferred").and_then(Value::as_str);
        let item = preferred
            .and_then(|guid| {
                list.iter()
                    .find(|row| row.get("guid").and_then(Value::as_str) == Some(guid))
            })
            .or_else(|| list.first());
        let text = item
            .and_then(|row| row.get("content"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        Ok(crate::lrc::parse_lrc(text))
    }

    pub fn set_favorite(&self, track_guid: &str, favorite: bool) -> AppResult<()> {
        let path = if favorite {
            "/favorite-track/create"
        } else {
            "/favorite-track/delete"
        };
        self.api(
            Method::POST,
            path,
            None,
            Some(json!({ "trackGUID": track_guid })),
            true,
        )?;
        Ok(())
    }

    pub fn create_playlist(&self, name: &str) -> AppResult<()> {
        self.api(
            Method::POST,
            "/playlist/create",
            None,
            Some(json!({ "name": name })),
            true,
        )?;
        Ok(())
    }

    pub fn add_to_playlist(&self, playlist_guid: &str, track_guid: &str) -> AppResult<()> {
        self.api(
            Method::POST,
            "/playlist/add-track",
            None,
            Some(json!({
                "guid": playlist_guid,
                "playlistGUID": playlist_guid,
                "trackGUIDs": [track_guid],
            })),
            true,
        )?;
        Ok(())
    }

    pub fn cover_bytes(&self, cover_id: &str, size: usize) -> AppResult<Vec<u8>> {
        let url = format!(
            "{}{API_PREFIX}/static/cover?coverId={}&size={}",
            self.config.server_url,
            percent_encode(cover_id),
            size.clamp(48, 1600)
        );
        let (status, bytes, _) = self.transport.bytes(
            Method::GET,
            &url,
            self.auth_headers()?,
            self.request_options(Duration::from_secs(30)),
        )?;
        if !status.is_success() {
            return Err(AppError::new(
                "COVER_FAILED",
                format!("封面加载失败（HTTP {status}）"),
            ));
        }
        Ok(bytes)
    }

    pub fn download_track(&self, guid: &str, path: &Path) -> AppResult<u64> {
        let url = format!(
            "{}{API_PREFIX}/track/stream?guid={}",
            self.config.server_url,
            percent_encode(guid)
        );
        self.transport.download(
            &url,
            self.auth_headers()?,
            self.request_options(Duration::from_secs(300)),
            path,
        )
    }

    fn page(&self, path: &str, query: Value) -> AppResult<Value> {
        let data = self.api(Method::GET, path, Some(query), None, true)?;
        Ok(json!({ "data": data }))
    }

    fn api(
        &self,
        method: Method,
        path: &str,
        query: Option<Value>,
        body: Option<Value>,
        authenticated: bool,
    ) -> AppResult<Value> {
        let mut url = Url::parse(&format!("{}{}{}", self.config.server_url, API_PREFIX, path))
            .map_err(|_| AppError::new("INVALID_URL", "飞牛音乐接口地址无效"))?;
        if let Some(Value::Object(values)) = query {
            for (key, value) in values {
                if value.is_null() {
                    continue;
                }
                let text = value
                    .as_str()
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| value.to_string());
                url.query_pairs_mut().append_pair(&key, &text);
            }
        }
        let headers = if authenticated {
            self.auth_headers()?
        } else {
            self.pre_auth_headers()?
        };
        let (status, payload) = self.transport.json(
            method,
            url.as_str(),
            headers,
            body,
            self.request_options(Duration::from_secs(30)),
        )?;
        if status == StatusCode::UNAUTHORIZED {
            return Err(AppError::new(
                "SESSION_EXPIRED",
                "登录状态已失效，请重新登录",
            ));
        }
        if status.is_server_error() {
            return Err(AppError::new(
                "SERVER_ERROR",
                format!("飞牛音乐服务暂时不可用（HTTP {status}）"),
            ));
        }
        let code = payload.get("code").and_then(Value::as_i64).unwrap_or(-1);
        if code != 0 {
            let message = payload
                .get("msg")
                .and_then(Value::as_str)
                .unwrap_or("飞牛音乐接口返回错误");
            if code == 120001 {
                return Err(AppError::new(
                    "INVALID_CREDENTIALS",
                    "飞牛音乐用户名或密码错误",
                ));
            }
            if code == 401 || message.to_ascii_lowercase().contains("invalid token") {
                return Err(AppError::new(
                    "SESSION_EXPIRED",
                    "登录状态已失效，请重新登录",
                ));
            }
            return Err(AppError::new("API_ERROR", message).details(json!({
                "businessCode": code
            })));
        }
        Ok(payload.get("data").cloned().unwrap_or(Value::Null))
    }

    fn request_options(&self, timeout: Duration) -> RequestOptions {
        RequestOptions {
            allow_http: self.config.allow_http,
            allow_self_signed: self.config.allow_self_signed,
            timeout,
        }
    }

    fn pre_auth_headers(&self) -> AppResult<HeaderMap> {
        self.headers(false)
    }

    fn auth_headers(&self) -> AppResult<HeaderMap> {
        self.headers(true)
    }

    fn headers(&self, with_token: bool) -> AppResult<HeaderMap> {
        let mut headers = HeaderMap::new();
        let mut cookies = Vec::new();
        if with_token && !self.config.token.is_empty() {
            cookies.push(format!("music-token={}", self.config.token));
        }
        if self.config.relay_mode {
            cookies.push("mode=relay".into());
        }
        if !cookies.is_empty() {
            headers.insert(
                COOKIE,
                HeaderValue::from_str(&cookies.join("; "))
                    .map_err(|_| AppError::new("INVALID_HEADER", "会话令牌格式错误"))?,
            );
        }
        if !self.config.access_code.is_empty() {
            let encoded = base64::engine::general_purpose::STANDARD
                .encode(self.config.access_code.as_bytes());
            headers.insert(
                HeaderName::from_static("x-access-code"),
                HeaderValue::from_str(&encoded)
                    .map_err(|_| AppError::new("INVALID_HEADER", "访问安全码格式错误"))?,
            );
            headers.insert(
                HeaderName::from_static("x-access-source"),
                HeaderValue::from_static("app"),
            );
        }
        Ok(headers)
    }
}

fn build_http_client(allow_invalid_certificate: bool) -> AppResult<Client> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_keepalive(Duration::from_secs(30))
        .danger_accept_invalid_certs(allow_invalid_certificate)
        .user_agent("XT-Music-Native/0.3.0")
        .build()
        .map_err(|error| AppError::new("HTTP_CLIENT_FAILED", error.to_string()))
}

fn map_network_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::new("NETWORK_TIMEOUT", "连接服务器超时")
    } else if error.is_connect() {
        AppError::new("CONNECT_FAILED", format!("无法连接服务器：{error}"))
    } else {
        AppError::new("NETWORK_ERROR", error.to_string())
    }
}

fn direct_candidates(input: &str, options: &ConnectionOptions) -> AppResult<Vec<Candidate>> {
    let url = Url::parse(input).map_err(|_| {
        AppError::new(
            "INVALID_URL",
            "服务器地址应以 http:// 或 https:// 开头；也可以直接输入 FN ID",
        )
    })?;
    if url.scheme() == "http" && !options.allow_http {
        return Err(AppError::new(
            "HTTP_NOT_ALLOWED",
            "请先启用“允许 HTTP”再使用该地址",
        ));
    }
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(AppError::new("INVALID_URL", "服务器仅支持 HTTP/HTTPS"));
    }
    let normalized = normalize_service_url(input)?;
    let relay = is_fn_connect_host(url.host_str().unwrap_or_default());
    let probe = format!("{normalized}/music/");
    Ok(vec![Candidate {
        url: normalized,
        probe_url: probe,
        relay_mode: relay,
        label: format!("指定地址 · {}", url.host_str().unwrap_or("server")),
        priority: 0,
    }])
}

fn fn_fallback_candidates(fn_id: &str) -> Vec<Candidate> {
    let id = fn_id.to_ascii_lowercase();
    vec![
        Candidate {
            url: format!("https://{id}.fnos.net"),
            probe_url: format!("https://{id}.fnos.net/music/"),
            relay_mode: true,
            label: format!("FNOS 域名 · {id}.fnos.net"),
            priority: 35,
        },
        Candidate {
            url: format!("https://fnos.net/{id}"),
            probe_url: format!("https://fnos.net/{id}/music/"),
            relay_mode: true,
            label: format!("FNOS 路径 · fnos.net/{id}"),
            priority: 36,
        },
    ]
}

fn candidate(url: String, relay_mode: bool, label: String, priority: i32) -> Candidate {
    Candidate {
        probe_url: format!("{}/", url.trim_end_matches('/')),
        url: url.trim_end_matches('/').to_owned(),
        relay_mode,
        label,
        priority,
    }
}

fn dedupe_candidates(rows: &mut Vec<Candidate>) {
    let mut seen = HashSet::new();
    rows.retain(|item| seen.insert(format!("{}|{}", item.url, item.probe_url)));
}

pub fn normalize_service_url(value: &str) -> AppResult<String> {
    let mut url = Url::parse(value)
        .map_err(|_| AppError::new("INVALID_URL", "服务器地址格式不正确"))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(AppError::new("INVALID_URL", "服务器仅支持 HTTP/HTTPS"));
    }
    let mut path = url.path().replace("//", "/");
    let lower = path.to_ascii_lowercase();
    if let Some(index) = lower.find("/music/api/v1") {
        path.truncate(index);
    } else if lower.ends_with("/music/") {
        path.truncate(path.len().saturating_sub(7));
    } else if lower.ends_with("/music") {
        path.truncate(path.len().saturating_sub(6));
    }
    let path = path.trim_end_matches('/');
    url.set_path(if path.is_empty() { "/" } else { path });
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

fn is_valid_fn_id(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 63
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        && value.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
        && value.as_bytes().last().is_some_and(u8::is_ascii_alphanumeric)
}

fn is_fn_connect_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "fnos.net"
        || host.ends_with(".fnos.net")
        || host == "5ddd.com"
        || host.ends_with(".5ddd.com")
}

fn is_official_relay_transition(from: &Url, to: &Url) -> bool {
    from.scheme() == "https"
        && to.scheme() == "https"
        && is_fn_connect_host(from.host_str().unwrap_or_default())
        && is_fn_connect_host(to.host_str().unwrap_or_default())
}

fn origin(url: &Url) -> (String, String, Option<u16>) {
    (
        url.scheme().to_owned(),
        url.host_str().unwrap_or_default().to_ascii_lowercase(),
        url.port_or_known_default(),
    )
}

fn strip_sensitive_headers(headers: &mut HeaderMap) {
    headers.remove(COOKIE);
    headers.remove(AUTHORIZATION);
    headers.remove(HeaderName::from_static("x-access-code"));
    headers.remove(HeaderName::from_static("x-access-source"));
}

fn md5_hex(value: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(value);
    hex::encode(hasher.finalize())
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn nested_u64(value: &Value, parent: &str, child: &str) -> Option<u64> {
    value.get(parent)?.get(child)?.as_u64()
}

fn percent_encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_music_paths() {
        assert_eq!(
            normalize_service_url("https://demo.fnos.net/music/").unwrap(),
            "https://demo.fnos.net"
        );
        assert_eq!(
            normalize_service_url("https://demo.fnos.net/music/api/v1/").unwrap(),
            "https://demo.fnos.net"
        );
    }

    #[test]
    fn recognizes_fn_ids_but_not_urls() {
        assert!(is_valid_fn_id("pkxutao"));
        assert!(!is_valid_fn_id("https://pkxutao.fnos.net"));
    }

    #[test]
    fn password_hash_is_sha256() {
        assert_eq!(
            hex::encode(Sha256::digest(b"password")),
            "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
        );
    }
}
