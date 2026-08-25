use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum NavPage {
    Home,
    Tracks,
    Albums,
    Artists,
    Genres,
    Favorites,
    History,
    Playlists,
    Lyrics,
    Settings,
}

impl NavPage {
    pub const LIBRARY: [Self; 8] = [
        Self::Home,
        Self::Tracks,
        Self::Albums,
        Self::Artists,
        Self::Genres,
        Self::Favorites,
        Self::History,
        Self::Playlists,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::Home => "首页",
            Self::Tracks => "歌曲",
            Self::Albums => "专辑",
            Self::Artists => "歌手",
            Self::Genres => "风格",
            Self::Favorites => "我喜欢的音乐",
            Self::History => "最近播放",
            Self::Playlists => "歌单",
            Self::Lyrics => "歌词",
            Self::Settings => "设置",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artist {
    pub guid: String,
    pub name: String,
    pub cover_id: Option<String>,
    pub track_count: usize,
}

impl Artist {
    pub fn from_value(value: &Value) -> Self {
        Self {
            guid: string_any(value, &["guid", "artistGUID", "id"]),
            name: string_any(value, &["name", "title", "artistName"]),
            cover_id: option_string_any(value, &["coverId", "coverID", "avatar"]),
            track_count: number_any(value, &["trackCount", "count", "total"]) as usize,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    pub guid: String,
    pub name: String,
    pub cover_id: Option<String>,
    pub artist: String,
    pub year: Option<i64>,
    pub track_count: usize,
}

impl Album {
    pub fn from_value(value: &Value) -> Self {
        let artist = value
            .get("artist")
            .map(|item| string_any(item, &["name", "title"]))
            .filter(|item| !item.is_empty())
            .unwrap_or_else(|| string_any(value, &["artistName", "artist"]));
        let raw_year = number_any(value, &["year", "publishYear"]);
        Self {
            guid: string_any(value, &["guid", "albumGUID", "id"]),
            name: string_any(value, &["name", "title", "albumName"]),
            cover_id: option_string_any(value, &["coverId", "coverID"]),
            artist,
            year: (raw_year > 0).then_some(raw_year),
            track_count: number_any(value, &["trackCount", "count", "total"]) as usize,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Genre {
    pub guid: String,
    pub name: String,
    pub track_count: usize,
}

impl Genre {
    pub fn from_value(value: &Value) -> Self {
        Self {
            guid: string_any(value, &["guid", "genreGUID", "id"]),
            name: string_any(value, &["name", "title"]),
            track_count: number_any(value, &["trackCount", "count", "total"]) as usize,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub guid: String,
    pub name: String,
    pub cover_id: Option<String>,
    pub track_count: usize,
}

impl Playlist {
    pub fn from_value(value: &Value) -> Self {
        Self {
            guid: string_any(value, &["guid", "playlistGUID", "id"]),
            name: string_any(value, &["name", "title"]),
            cover_id: option_string_any(value, &["coverId", "coverID"]),
            track_count: number_any(value, &["trackCount", "count", "total"]) as usize,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub guid: String,
    pub title: String,
    pub artists: Vec<Artist>,
    pub album: Option<Album>,
    pub cover_id: Option<String>,
    pub duration: f64,
    pub format: String,
    pub sample_rate: Option<u64>,
    pub bit_depth: Option<u64>,
    pub is_favorite: bool,
}

impl Track {
    pub fn from_value(value: &Value) -> Self {
        let artists = value
            .get("artists")
            .and_then(Value::as_array)
            .map(|items| items.iter().map(Artist::from_value).collect::<Vec<_>>())
            .filter(|items| !items.is_empty())
            .unwrap_or_else(|| {
                let name = string_any(value, &["artistName", "artist"]);
                (!name.is_empty())
                    .then(|| {
                        vec![Artist {
                            name,
                            ..Default::default()
                        }]
                    })
                    .unwrap_or_default()
            });
        let album = value.get("album").and_then(|item| {
            if item.is_object() {
                Some(Album::from_value(item))
            } else {
                None
            }
        });
        let audio = value.get("audioSpec").unwrap_or(&Value::Null);
        let mut duration = number_f64_any(value, &["duration", "length"]);
        if duration <= 0.0 {
            duration = number_f64_any(audio, &["duration", "length"]);
        }
        if duration > 100_000.0 {
            duration /= 1000.0;
        }
        Self {
            guid: string_any(value, &["guid", "trackGUID", "id"]),
            title: non_empty(
                string_any(value, &["title", "name", "trackName"]),
                "未知标题",
            ),
            artists,
            cover_id: option_string_any(value, &["coverId", "coverID"])
                .or_else(|| album.as_ref().and_then(|item| item.cover_id.clone())),
            album,
            duration,
            format: string_any(audio, &["format", "codec", "container"]),
            sample_rate: positive_u64(audio, &["sampleRate", "samplingRate"]),
            bit_depth: positive_u64(audio, &["bitDepth", "bitsPerSample"]),
            is_favorite: bool_any(value, &["isFavorite", "favorite", "liked"]),
        }
    }

    pub fn artist_text(&self) -> String {
        let text = self
            .artists
            .iter()
            .map(|item| item.name.trim())
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>()
            .join("、");
        non_empty(text, "未知歌手")
    }

    pub fn album_text(&self) -> String {
        self.album
            .as_ref()
            .map(|item| item.name.clone())
            .filter(|item| !item.is_empty())
            .unwrap_or_else(|| "未知专辑".into())
    }
}

#[derive(Debug, Clone, Default)]
pub struct LibraryPage {
    pub tracks: Vec<Track>,
    pub albums: Vec<Album>,
    pub artists: Vec<Artist>,
    pub genres: Vec<Genre>,
    pub playlists: Vec<Playlist>,
    pub total: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedProfile {
    pub id: String,
    pub name: String,
    pub username: String,
    pub server_url: String,
    pub fn_id: Option<String>,
    pub relay_mode: bool,
    pub allow_self_signed: bool,
    pub allow_http: bool,
    pub device_id: String,
    pub last_used_at: i64,
    #[serde(skip)]
    pub has_session: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretRecord {
    pub token: String,
    pub access_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub volume: f32,
    pub repeat_mode: String,
    pub queue_open: bool,
    pub last_page: NavPage,
    pub remember_session: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            volume: 0.82,
            repeat_mode: "off".into(),
            queue_open: true,
            last_page: NavPage::Home,
            remember_session: true,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct LyricLine {
    pub time: f64,
    pub text: String,
}

#[derive(Debug, Clone, Default)]
pub struct Lyrics {
    pub lines: Vec<LyricLine>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub offset_ms: i64,
}

#[derive(Debug, Clone)]
pub struct LoginRequest {
    pub profile_id: Option<String>,
    pub server_input: String,
    pub username: String,
    pub password: String,
    pub access_code: String,
    pub display_name: String,
    pub allow_http: bool,
    pub allow_self_signed: bool,
    pub remember_session: bool,
}

#[derive(Debug, Clone)]
pub struct ConnectedSession {
    pub profile: SavedProfile,
    pub keyring_secure: bool,
}

pub fn parse_list(value: &Value) -> Vec<Value> {
    value
        .get("data")
        .and_then(|data| data.get("list"))
        .or_else(|| value.get("list"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

pub fn parse_total(value: &Value) -> usize {
    value
        .get("data")
        .and_then(|data| data.get("total"))
        .or_else(|| value.get("total"))
        .and_then(Value::as_u64)
        .unwrap_or_else(|| parse_list(value).len() as u64) as usize
}

fn string_any(value: &Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(item) = value.get(*key) {
            if let Some(text) = item.as_str() {
                return text.to_owned();
            }
            if item.is_number() {
                return item.to_string();
            }
        }
    }
    String::new()
}

fn option_string_any(value: &Value, keys: &[&str]) -> Option<String> {
    let text = string_any(value, keys);
    (!text.trim().is_empty()).then_some(text)
}

fn number_any(value: &Value, keys: &[&str]) -> i64 {
    for key in keys {
        if let Some(item) = value.get(*key) {
            if let Some(number) = item.as_i64() {
                return number;
            }
            if let Some(number) = item.as_u64() {
                return number.min(i64::MAX as u64) as i64;
            }
            if let Some(text) = item.as_str() {
                if let Ok(number) = text.parse::<i64>() {
                    return number;
                }
            }
        }
    }
    0
}

fn number_f64_any(value: &Value, keys: &[&str]) -> f64 {
    for key in keys {
        if let Some(item) = value.get(*key) {
            if let Some(number) = item.as_f64() {
                return number;
            }
            if let Some(text) = item.as_str() {
                if let Ok(number) = text.parse::<f64>() {
                    return number;
                }
            }
        }
    }
    0.0
}

fn positive_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    let value = number_any(value, keys);
    (value > 0).then_some(value as u64)
}

fn bool_any(value: &Value, keys: &[&str]) -> bool {
    for key in keys {
        if let Some(item) = value.get(*key) {
            if let Some(value) = item.as_bool() {
                return value;
            }
            if let Some(value) = item.as_i64() {
                return value != 0;
            }
        }
    }
    false
}

fn non_empty(value: String, fallback: &str) -> String {
    if value.trim().is_empty() {
        fallback.to_owned()
    } else {
        value
    }
}
