use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Deserialize)]
pub struct ApiEnvelope<T> {
    #[serde(default)]
    pub code: i64,
    #[serde(default, alias = "message")]
    pub msg: String,
    pub data: Option<T>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    #[serde(default)]
    pub user_token: String,
    #[serde(default)]
    pub user: LoginUser,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct LoginUser {
    #[serde(default)]
    pub guid: String,
    #[serde(default, alias = "username")]
    pub name: String,
    #[serde(default)]
    pub role: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Page<T> {
    #[serde(default)]
    pub list: Vec<T>,
    #[serde(default, deserialize_with = "de_u64")]
    pub total: u64,
    #[serde(default)]
    pub sort: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    #[serde(default)]
    pub guid: String,
    #[serde(default, alias = "name")]
    pub title: String,
    #[serde(default)]
    pub cover_id: Option<String>,
    #[serde(default, deserialize_with = "de_opt_u64")]
    pub duration: Option<u64>,
    #[serde(default)]
    pub artists: Vec<ArtistRef>,
    #[serde(default)]
    pub album: Option<AlbumRef>,
    #[serde(default, alias = "favorite")]
    pub is_favorite: bool,
    #[serde(default)]
    pub audio_spec: Option<AudioSpec>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl Track {
    pub fn artist_text(&self) -> String {
        let names = self
            .artists
            .iter()
            .filter_map(|artist| (!artist.name.is_empty()).then_some(artist.name.as_str()))
            .collect::<Vec<_>>();
        if names.is_empty() {
            "未知歌手".to_owned()
        } else {
            names.join(" / ")
        }
    }

    pub fn album_text(&self) -> &str {
        self.album
            .as_ref()
            .and_then(|album| (!album.name.is_empty()).then_some(album.name.as_str()))
            .unwrap_or("未知专辑")
    }

    pub fn duration_seconds(&self) -> u64 {
        let value = self.duration.unwrap_or_default();
        if value > 86_400 { value / 1_000 } else { value }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct ArtistRef {
    #[serde(default)]
    pub guid: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumRef {
    #[serde(default)]
    pub guid: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub cover_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSpec {
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub codec: Option<String>,
    #[serde(default, deserialize_with = "de_opt_u64")]
    pub sample_rate: Option<u64>,
    #[serde(default, deserialize_with = "de_opt_u64")]
    pub bit_depth: Option<u64>,
    #[serde(default, deserialize_with = "de_opt_u64")]
    pub bitrate: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct ConnectionCandidate {
    pub base_url: String,
    pub probe_url: String,
    pub relay_mode: bool,
    pub label: String,
    pub priority: u16,
}

#[derive(Debug, Clone)]
pub struct ConnectionResult {
    pub server_url: String,
    pub relay_mode: bool,
    pub method: String,
    pub fn_id: Option<String>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Session {
    pub server_url: String,
    pub relay_mode: bool,
    pub token: String,
    pub username: String,
    pub display_name: String,
    pub device_id: String,
    pub access_code: String,
    pub allow_http: bool,
    pub allow_self_signed: bool,
}

#[derive(Debug, Clone, Default)]
pub struct MediaHeaders {
    pub values: Vec<(String, String)>,
}

impl MediaHeaders {
    pub fn push(&mut self, name: impl Into<String>, value: impl Into<String>) {
        self.values.push((name.into(), value.into()));
    }
}

fn de_u64<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(de_number(deserializer)?.unwrap_or(0))
}

fn de_opt_u64<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    de_number(deserializer)
}

fn de_number<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(match value {
        serde_json::Value::Null => None,
        serde_json::Value::Number(number) => number.as_u64(),
        serde_json::Value::String(text) => text.trim().parse::<u64>().ok(),
        _ => None,
    })
}
