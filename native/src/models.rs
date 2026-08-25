use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Artist {
    #[serde(default)]
    pub guid: String,
    #[serde(default, alias = "title")]
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    #[serde(default)]
    pub guid: String,
    #[serde(default, alias = "title")]
    pub name: String,
    #[serde(default)]
    pub cover_id: Option<String>,
    #[serde(default)]
    pub track_count: Option<u64>,
    #[serde(default)]
    pub artists: Vec<Artist>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioSpec {
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub codec: Option<String>,
    #[serde(default)]
    pub bitrate: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    #[serde(default)]
    pub guid: String,
    #[serde(default, alias = "name")]
    pub title: String,
    #[serde(default)]
    pub artists: Vec<Artist>,
    #[serde(default)]
    pub album: Option<Album>,
    #[serde(default)]
    pub cover_id: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub audio_spec: Option<AudioSpec>,
    #[serde(default, alias = "favorite")]
    pub is_favorite: bool,
}

impl Track {
    pub fn artist_text(&self) -> String {
        let value = self
            .artists
            .iter()
            .map(|item| item.name.trim())
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>()
            .join("、");
        if value.is_empty() { "未知歌手".into() } else { value }
    }

    pub fn album_text(&self) -> String {
        self.album
            .as_ref()
            .map(|item| item.name.trim())
            .filter(|item| !item.is_empty())
            .unwrap_or("未知专辑")
            .to_owned()
    }

    pub fn duration_seconds(&self) -> f64 {
        let mut value = self
            .duration
            .or_else(|| self.audio_spec.as_ref().and_then(|item| item.duration))
            .unwrap_or(0.0);
        if value > 100_000.0 {
            value /= 1000.0;
        }
        if value.is_finite() && value > 0.0 { value } else { 0.0 }
    }
}

#[derive(Debug, Clone, Default)]
pub struct Page<T> {
    pub list: Vec<T>,
    pub total: usize,
}

#[derive(Debug, Clone, Default)]
pub struct MusicLibrary {
    pub tracks: Vec<Track>,
    pub albums: Vec<Album>,
    pub artists: Vec<Artist>,
    pub favorites: Vec<Track>,
    pub history: Vec<Track>,
}

#[derive(Debug, Clone, Default)]
pub struct SessionInfo {
    pub username: String,
    pub server_url: String,
    pub relay_mode: bool,
    pub method: String,
}

#[derive(Debug, Clone)]
pub struct LoginRequest {
    pub server_input: String,
    pub username: String,
    pub password: String,
    pub access_code: String,
    pub allow_http: bool,
    pub allow_self_signed: bool,
}
