use crate::authx::sha256_hex;
use crate::discovery::is_official_relay_host;
use crate::{
    ApiEnvelope, CoreError, LoginResult, MediaHeaders, Page, Session, Track,
};
use base64::Engine;
use reqwest::header::{
    ACCEPT, CONTENT_TYPE, COOKIE, HeaderMap, HeaderName, HeaderValue, LOCATION,
};
use reqwest::{Method, Response, StatusCode};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::time::Duration;
use url::Url;
use uuid::Uuid;

const API_PREFIX: &str = "/music/api/v1";

#[derive(Clone)]
pub struct FnMusicClient {
    http: reqwest::Client,
    session: Session,
}

impl std::fmt::Debug for FnMusicClient {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FnMusicClient")
            .field("server_url", &self.session.server_url)
            .field("relay_mode", &self.session.relay_mode)
            .field("username", &self.session.username)
            .finish_non_exhaustive()
    }
}

impl FnMusicClient {
    pub fn new(
        server_url: String,
        relay_mode: bool,
        access_code: String,
        allow_http: bool,
        allow_self_signed: bool,
    ) -> Result<Self, CoreError> {
        let parsed = Url::parse(&server_url)?;
        if parsed.scheme() == "http" && !allow_http {
            return Err(CoreError::HttpNotAllowed);
        }
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .danger_accept_invalid_certs(allow_self_signed)
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        let device_id = Uuid::new_v4().simple().to_string();
        Ok(Self {
            http,
            session: Session {
                server_url,
                relay_mode,
                token: String::new(),
                username: String::new(),
                display_name: String::new(),
                device_id,
                access_code,
                allow_http,
                allow_self_signed,
            },
        })
    }

    pub fn session(&self) -> &Session {
        &self.session
    }

    pub async fn requires_access_code(&self) -> Result<bool, CoreError> {
        let url = Url::parse(&format!(
            "{}/access_code_verify",
            self.session.server_url
        ))?;
        let response = self
            .send_with_redirects(Method::GET, url, None, false)
            .await?;
        Ok(matches!(
            response.status(),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS
        ))
    }

    pub async fn verify_access_code(&self) -> Result<bool, CoreError> {
        if self.session.access_code.is_empty() {
            return Ok(false);
        }
        let url = Url::parse(&format!(
            "{}/access_code_verify",
            self.session.server_url
        ))?;
        let response = self
            .send_with_redirects(Method::GET, url, None, false)
            .await?;
        Ok(response.status().is_success())
    }

    pub async fn login(mut self, username: &str, password: &str) -> Result<Self, CoreError> {
        let body = json!({
            "username": username.trim(),
            "password": sha256_hex(password),
            "deviceId": self.session.device_id.clone(),
        });
        let envelope: ApiEnvelope<LoginResult> = self
            .request_json(Method::POST, "/user/password-login", Some(body), false)
            .await?;
        if envelope.code == 120001 {
            return Err(CoreError::InvalidCredentials);
        }
        if envelope.code != 0 {
            return Err(CoreError::Server(if envelope.msg.is_empty() {
                format!("业务码 {}", envelope.code)
            } else {
                envelope.msg
            }));
        }
        let result = envelope
            .data
            .ok_or_else(|| CoreError::InvalidResponse("登录响应缺少 data".to_owned()))?;
        if result.user_token.is_empty() {
            return Err(CoreError::InvalidResponse(
                "登录响应缺少 userToken".to_owned(),
            ));
        }
        self.session.token = result.user_token;
        self.session.username = username.trim().to_owned();
        self.session.display_name = if result.user.name.is_empty() {
            username.trim().to_owned()
        } else {
            result.user.name
        };
        Ok(self)
    }

    pub async fn tracks(&self, page: u32, size: u32) -> Result<Page<Track>, CoreError> {
        let path = format!("/track/list?page={page}&size={size}");
        let envelope: ApiEnvelope<Page<Track>> = self
            .request_json(Method::GET, &path, None, true)
            .await?;
        self.unwrap_envelope(envelope, "加载歌曲失败")
    }

    pub async fn search_tracks(
        &self,
        query: &str,
        page: u32,
        size: u32,
    ) -> Result<Page<Track>, CoreError> {
        let mut url = Url::parse(&format!(
            "{}{API_PREFIX}/search/track",
            self.session.server_url
        ))?;
        url.query_pairs_mut()
            .append_pair("q", query)
            .append_pair("keyword", query)
            .append_pair("page", &page.to_string())
            .append_pair("size", &size.to_string());
        let envelope: ApiEnvelope<Page<Track>> = self
            .request_absolute_json(Method::GET, url, None, true)
            .await?;
        self.unwrap_envelope(envelope, "搜索歌曲失败")
    }

    pub async fn lyrics_text(&self, track_guid: &str) -> Result<String, CoreError> {
        let mut url = Url::parse(&format!(
            "{}{API_PREFIX}/lyric/list",
            self.session.server_url
        ))?;
        url.query_pairs_mut()
            .append_pair("trackGUID", track_guid);
        let envelope: ApiEnvelope<LyricsData> = self
            .request_absolute_json(Method::GET, url, None, true)
            .await?;
        let data = self.unwrap_envelope(envelope, "获取歌词失败")?;
        if let Some(preferred) = data.preferred.as_deref() {
            if let Some(item) = data.list.iter().find(|item| item.guid == preferred) {
                return Ok(item.content.clone());
            }
        }
        Ok(data
            .list
            .first()
            .map(|item| item.content.clone())
            .unwrap_or_default())
    }

    pub fn stream_url(&self, guid: &str) -> Result<String, CoreError> {
        if guid.trim().is_empty() {
            return Err(CoreError::InvalidResponse("歌曲 guid 为空".to_owned()));
        }
        let mut url = Url::parse(&format!(
            "{}{API_PREFIX}/track/stream",
            self.session.server_url
        ))?;
        url.query_pairs_mut().append_pair("guid", guid);
        Ok(url.to_string())
    }

    pub fn cover_url(&self, cover_id: &str, size: u32) -> Result<String, CoreError> {
        let mut url = Url::parse(&format!(
            "{}{API_PREFIX}/static/cover",
            self.session.server_url
        ))?;
        url.query_pairs_mut()
            .append_pair("coverId", cover_id)
            .append_pair("size", &size.clamp(48, 1600).to_string());
        Ok(url.to_string())
    }

    pub fn media_headers(&self) -> MediaHeaders {
        let mut headers = MediaHeaders::default();
        let mut cookies = Vec::new();
        if !self.session.token.is_empty() {
            cookies.push(format!("music-token={}", self.session.token));
        }
        if self.session.relay_mode {
            cookies.push("mode=relay".to_owned());
        }
        if !cookies.is_empty() {
            headers.push("Cookie", cookies.join("; "));
        }
        if !self.session.access_code.is_empty() {
            headers.push(
                "x-access-code",
                base64::engine::general_purpose::STANDARD
                    .encode(self.session.access_code.as_bytes()),
            );
            headers.push("x-access-source", "app");
        }
        headers
    }

    async fn request_json<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        authenticated: bool,
    ) -> Result<T, CoreError> {
        let path = if path.starts_with('/') {
            path.to_owned()
        } else {
            format!("/{path}")
        };
        let url = Url::parse(&format!(
            "{}{}{}",
            self.session.server_url, API_PREFIX, path
        ))?;
        self.request_absolute_json(method, url, body, authenticated)
            .await
    }

    async fn request_absolute_json<T: DeserializeOwned>(
        &self,
        method: Method,
        url: Url,
        body: Option<Value>,
        authenticated: bool,
    ) -> Result<T, CoreError> {
        let response = self
            .send_with_redirects(method, url, body, authenticated)
            .await?;
        let status = response.status();
        let text = response.text().await?;
        if status == StatusCode::UNAUTHORIZED && authenticated {
            return Err(CoreError::SessionExpired);
        }
        if status.is_server_error() {
            return Err(CoreError::Server(format!("HTTP {}", status.as_u16())));
        }
        serde_json::from_str(&text)
            .map_err(|_| CoreError::InvalidResponse(text.chars().take(320).collect()))
    }

    async fn send_with_redirects(
        &self,
        mut method: Method,
        mut url: Url,
        mut body: Option<Value>,
        authenticated: bool,
    ) -> Result<Response, CoreError> {
        for _ in 0..=5 {
            let mut request = self
                .http
                .request(method.clone(), url.clone())
                .headers(self.headers(authenticated)?);
            if let Some(value) = &body {
                request = request.json(value);
            }
            let response = request.send().await?;
            if !response.status().is_redirection() {
                return Ok(response);
            }

            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| {
                    CoreError::InvalidResponse("重定向缺少 Location".to_owned())
                })?;
            let next = url.join(location)?;
            if url.scheme() == "https" && next.scheme() == "http" {
                return Err(CoreError::UnsafeRedirect(format!(
                    "{} → {}",
                    url, next
                )));
            }
            if !trusted_redirect(&url, &next) {
                return Err(CoreError::UnsafeRedirect(format!(
                    "{} → {}",
                    url, next
                )));
            }
            if response.status() == StatusCode::SEE_OTHER {
                method = Method::GET;
                body = None;
            }
            url = next;
        }
        Err(CoreError::UnsafeRedirect("重定向次数过多".to_owned()))
    }

    fn headers(&self, authenticated: bool) -> Result<HeaderMap, CoreError> {
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("application/json, */*"));
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/json; charset=utf-8"),
        );
        let mut cookies = Vec::new();
        if authenticated && !self.session.token.is_empty() {
            cookies.push(format!("music-token={}", self.session.token));
        }
        if self.session.relay_mode {
            cookies.push("mode=relay".to_owned());
        }
        if !cookies.is_empty() {
            headers.insert(
                COOKIE,
                HeaderValue::from_str(&cookies.join("; "))
                    .map_err(|error| CoreError::InvalidResponse(error.to_string()))?,
            );
        }
        if !self.session.access_code.is_empty() {
            let encoded = base64::engine::general_purpose::STANDARD
                .encode(self.session.access_code.as_bytes());
            headers.insert(
                HeaderName::from_static("x-access-code"),
                HeaderValue::from_str(&encoded)
                    .map_err(|error| CoreError::InvalidResponse(error.to_string()))?,
            );
            headers.insert(
                HeaderName::from_static("x-access-source"),
                HeaderValue::from_static("app"),
            );
        }
        Ok(headers)
    }

    fn unwrap_envelope<T>(
        &self,
        envelope: ApiEnvelope<T>,
        fallback: &str,
    ) -> Result<T, CoreError> {
        if envelope.code == 401
            || envelope
                .msg
                .to_ascii_lowercase()
                .contains("invalid token")
        {
            return Err(CoreError::SessionExpired);
        }
        if envelope.code != 0 {
            return Err(CoreError::Server(if envelope.msg.is_empty() {
                format!("{fallback}（业务码 {}）", envelope.code)
            } else {
                envelope.msg
            }));
        }
        envelope
            .data
            .ok_or_else(|| CoreError::InvalidResponse(format!("{fallback}：响应缺少 data")))
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
struct LyricsData {
    #[serde(default)]
    list: Vec<LyricItem>,
    #[serde(default)]
    preferred: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct LyricItem {
    #[serde(default)]
    guid: String,
    #[serde(default)]
    content: String,
}

fn trusted_redirect(from: &Url, to: &Url) -> bool {
    if from.origin() == to.origin() {
        return true;
    }
    from.scheme() == "https"
        && to.scheme() == "https"
        && is_official_relay_host(from.host_str().unwrap_or_default())
        && is_official_relay_host(to.host_str().unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_relay_redirect_is_trusted() {
        let a = Url::parse(
            "https://demo.fnos.net/music/api/v1/user/password-login",
        )
        .unwrap();
        let b = Url::parse(
            "https://demo.5ddd.com/music/api/v1/user/password-login",
        )
        .unwrap();
        assert!(trusted_redirect(&a, &b));
    }

    #[test]
    fn arbitrary_redirect_is_not_trusted() {
        let a = Url::parse(
            "https://demo.fnos.net/music/api/v1/user/password-login",
        )
        .unwrap();
        let b = Url::parse("https://evil.example/collect").unwrap();
        assert!(!trusted_redirect(&a, &b));
    }
}
