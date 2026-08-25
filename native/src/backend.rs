use crate::api::{
    AppError, ClientConfig, ConnectionOptions, Discovery, MusicClient, Transport,
};
use crate::model::{
    ConnectedSession, LibraryPage, LoginRequest, Lyrics, NavPage, SavedProfile, SecretRecord,
    Settings, Track,
};
use crate::storage::Storage;
use crossbeam_channel::{unbounded, Receiver, Sender};
use parking_lot::RwLock;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub enum BackendMessage {
    Profiles(Vec<SavedProfile>),
    LoginProgress(String),
    Connected(Result<ConnectedSession, AppError>),
    PageLoaded(NavPage, Result<LibraryPage, AppError>),
    SearchLoaded(String, Result<LibraryPage, AppError>),
    TrackReady(Track, Result<PathBuf, AppError>),
    CoverReady(String, Result<Vec<u8>, AppError>),
    LyricsReady(String, Result<Lyrics, AppError>),
    FavoriteChanged(String, Result<bool, AppError>),
    PlaylistsChanged(Result<LibraryPage, AppError>),
    LoggedOut,
}

#[derive(Clone)]
pub struct Backend {
    storage: Arc<Storage>,
    transport: Transport,
    discovery: Discovery,
    client: Arc<RwLock<Option<MusicClient>>>,
    sender: Sender<BackendMessage>,
    receiver: Receiver<BackendMessage>,
}

impl Backend {
    pub fn new() -> Result<Self, AppError> {
        let storage = Arc::new(Storage::new()?);
        let transport = Transport::new()?;
        let discovery = Discovery::new(transport.clone());
        let (sender, receiver) = unbounded();
        Ok(Self {
            storage,
            transport,
            discovery,
            client: Arc::new(RwLock::new(None)),
            sender,
            receiver,
        })
    }

    pub fn settings(&self) -> Settings {
        self.storage.settings()
    }

    pub fn save_settings(&self, settings: Settings) -> Result<(), AppError> {
        self.storage.save_settings(settings)
    }

    pub fn profiles(&self) -> Vec<SavedProfile> {
        self.storage.profiles()
    }

    pub fn poll(&self) -> impl Iterator<Item = BackendMessage> + '_ {
        self.receiver.try_iter()
    }

    pub fn restore_session(&self) {
        let storage = self.storage.clone();
        let client_slot = self.client.clone();
        let transport = self.transport.clone();
        let sender = self.sender.clone();
        thread::spawn(move || {
            let profiles = storage.profiles();
            let _ = sender.send(BackendMessage::Profiles(profiles));
            let Some(profile) = storage.active_profile() else {
                return;
            };
            let Some(secret) = storage.secret(&profile.id) else {
                return;
            };
            let client = MusicClient::new(
                transport,
                client_config(&profile, &secret),
            );
            match client.validate() {
                Ok(()) => {
                    *client_slot.write() = Some(client);
                    let _ = storage.touch(&profile.id);
                    let _ = sender.send(BackendMessage::Connected(Ok(ConnectedSession {
                        profile,
                        keyring_secure: true,
                    })));
                }
                Err(error) => {
                    storage.clear_session(&profile.id);
                    let _ = sender.send(BackendMessage::Connected(Err(error)));
                }
            }
        });
    }

    pub fn login(&self, request: LoginRequest) {
        let storage = self.storage.clone();
        let client_slot = self.client.clone();
        let transport = self.transport.clone();
        let discovery = self.discovery.clone();
        let sender = self.sender.clone();
        thread::spawn(move || {
            let options = ConnectionOptions {
                allow_http: request.allow_http,
                allow_public_http: false,
                allow_self_signed: request.allow_self_signed,
            };
            let connection = match discovery.resolve(&request.server_input, &options, |message| {
                let _ = sender.send(BackendMessage::LoginProgress(message));
            }) {
                Ok(value) => value,
                Err(error) => {
                    let _ = sender.send(BackendMessage::Connected(Err(error)));
                    return;
                }
            };
            let device_id = request
                .profile_id
                .as_deref()
                .and_then(|id| storage.profile(id))
                .map(|profile| profile.device_id)
                .or_else(|| None)
                .unwrap_or_else(|| Uuid::new_v4().simple().to_string());
            let mut client = MusicClient::new(
                transport,
                ClientConfig {
                    server_url: connection.server_url.clone(),
                    token: String::new(),
                    relay_mode: connection.relay_mode,
                    access_code: request.access_code.clone(),
                    allow_http: request.allow_http,
                    allow_self_signed: request.allow_self_signed,
                    device_id: device_id.clone(),
                },
            );
            let (token, server_name) = match client.login(&request.username, &request.password) {
                Ok(value) => value,
                Err(error) => {
                    let _ = sender.send(BackendMessage::Connected(Err(error)));
                    return;
                }
            };
            let profile = SavedProfile {
                id: request.profile_id.unwrap_or_default(),
                name: if request.display_name.trim().is_empty() {
                    server_name
                } else {
                    request.display_name.trim().to_owned()
                },
                username: request.username.trim().to_owned(),
                server_url: connection.server_url,
                fn_id: connection.fn_id,
                relay_mode: connection.relay_mode,
                allow_self_signed: request.allow_self_signed,
                allow_http: request.allow_http,
                device_id,
                last_used_at: chrono::Utc::now().timestamp_millis(),
                has_session: true,
            };
            let saved = storage.save_profile(
                profile,
                SecretRecord {
                    token,
                    access_code: request.access_code,
                },
                request.remember_session,
            );
            match saved {
                Ok((profile, keyring_secure)) => {
                    *client_slot.write() = Some(client);
                    let _ = sender.send(BackendMessage::Profiles(storage.profiles()));
                    let _ = sender.send(BackendMessage::Connected(Ok(ConnectedSession {
                        profile,
                        keyring_secure,
                    })));
                }
                Err(error) => {
                    let _ = sender.send(BackendMessage::Connected(Err(error)));
                }
            }
        });
    }

    pub fn switch_profile(&self, id: String) {
        let storage = self.storage.clone();
        let client_slot = self.client.clone();
        let transport = self.transport.clone();
        let sender = self.sender.clone();
        thread::spawn(move || {
            let result = (|| {
                let profile = storage
                    .profile(&id)
                    .ok_or_else(|| AppError::new("ACCOUNT_NOT_FOUND", "账号不存在"))?;
                let secret = storage
                    .secret(&id)
                    .ok_or_else(|| AppError::new("LOGIN_REQUIRED", "该账号需要重新输入密码"))?;
                let client = MusicClient::new(transport, client_config(&profile, &secret));
                client.validate()?;
                storage.touch(&id)?;
                *client_slot.write() = Some(client);
                Ok(ConnectedSession {
                    profile,
                    keyring_secure: true,
                })
            })();
            let _ = sender.send(BackendMessage::Connected(result));
        });
    }

    pub fn logout(&self, remove_token: bool) {
        if let Some(profile) = self.storage.active_profile() {
            if remove_token {
                self.storage.clear_session(&profile.id);
            }
        }
        let _ = self.storage.clear_active();
        *self.client.write() = None;
        let _ = self.sender.send(BackendMessage::LoggedOut);
        let _ = self
            .sender
            .send(BackendMessage::Profiles(self.storage.profiles()));
    }

    pub fn remove_profile(&self, id: String) {
        let _ = self.storage.remove_profile(&id);
        let _ = self
            .sender
            .send(BackendMessage::Profiles(self.storage.profiles()));
    }

    pub fn load_page(&self, page: NavPage) {
        let client_slot = self.client.clone();
        let sender = self.sender.clone();
        thread::spawn(move || {
            let result = with_client(&client_slot, |client| match page {
                NavPage::Home => load_home(client),
                NavPage::Tracks => fetch_all_tracks(client, |page, size| client.tracks(page, size)),
                NavPage::Albums => fetch_all_media(client, |page, size| client.albums(page, size)),
                NavPage::Artists => fetch_all_media(client, |page, size| client.artists(page, size)),
                NavPage::Genres => fetch_all_media(client, |page, size| client.genres(page, size)),
                NavPage::Favorites => {
                    fetch_all_tracks(client, |page, size| client.favorites(page, size))
                }
                NavPage::History => {
                    fetch_all_tracks(client, |page, size| client.history(page, size))
                }
                NavPage::Playlists => client.playlists(1, 500),
                _ => Ok(LibraryPage::default()),
            });
            let _ = sender.send(BackendMessage::PageLoaded(page, result));
        });
    }

    pub fn search(&self, query: String) {
        let client_slot = self.client.clone();
        let sender = self.sender.clone();
        thread::spawn(move || {
            let result = with_client(&client_slot, |client| client.search(&query));
            let _ = sender.send(BackendMessage::SearchLoaded(query, result));
        });
    }

    pub fn prepare_track(&self, track: Track) {
        let client_slot = self.client.clone();
        let storage = self.storage.clone();
        let sender = self.sender.clone();
        thread::spawn(move || {
            let result = with_client(&client_slot, |client| {
                let extension = safe_extension(&track.format);
                let path = storage
                    .cache_dir()
                    .join("audio")
                    .join(format!("{}.{}", track.guid, extension));
                if path.exists() && path.metadata().map(|meta| meta.len() > 1024).unwrap_or(false) {
                    return Ok(path);
                }
                client.download_track(&track.guid, &path)?;
                Ok(path)
            });
            let _ = sender.send(BackendMessage::TrackReady(track, result));
        });
    }

    pub fn load_cover(&self, cover_id: String, size: usize) {
        let client_slot = self.client.clone();
        let sender = self.sender.clone();
        thread::spawn(move || {
            let result = with_client(&client_slot, |client| client.cover_bytes(&cover_id, size));
            let _ = sender.send(BackendMessage::CoverReady(cover_id, result));
        });
    }

    pub fn load_lyrics(&self, track_guid: String) {
        let client_slot = self.client.clone();
        let sender = self.sender.clone();
        thread::spawn(move || {
            let result = with_client(&client_slot, |client| client.lyrics(&track_guid));
            let _ = sender.send(BackendMessage::LyricsReady(track_guid, result));
        });
    }

    pub fn set_favorite(&self, track_guid: String, favorite: bool) {
        let client_slot = self.client.clone();
        let sender = self.sender.clone();
        thread::spawn(move || {
            let result = with_client(&client_slot, |client| {
                client.set_favorite(&track_guid, favorite)?;
                Ok(favorite)
            });
            let _ = sender.send(BackendMessage::FavoriteChanged(track_guid, result));
        });
    }

    pub fn create_playlist(&self, name: String) {
        let client_slot = self.client.clone();
        let sender = self.sender.clone();
        thread::spawn(move || {
            let result = with_client(&client_slot, |client| {
                client.create_playlist(&name)?;
                client.playlists(1, 500)
            });
            let _ = sender.send(BackendMessage::PlaylistsChanged(result));
        });
    }

    pub fn add_to_playlist(&self, playlist_guid: String, track_guid: String) {
        let client_slot = self.client.clone();
        let sender = self.sender.clone();
        thread::spawn(move || {
            let result = with_client(&client_slot, |client| {
                client.add_to_playlist(&playlist_guid, &track_guid)?;
                client.playlists(1, 500)
            });
            let _ = sender.send(BackendMessage::PlaylistsChanged(result));
        });
    }
}

fn with_client<T>(
    slot: &Arc<RwLock<Option<MusicClient>>>,
    action: impl FnOnce(&MusicClient) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let client = slot
        .read()
        .clone()
        .ok_or_else(|| AppError::new("NOT_AUTHENTICATED", "请先登录飞牛音乐"))?;
    action(&client)
}

fn client_config(profile: &SavedProfile, secret: &SecretRecord) -> ClientConfig {
    ClientConfig {
        server_url: profile.server_url.clone(),
        token: secret.token.clone(),
        relay_mode: profile.relay_mode,
        access_code: secret.access_code.clone(),
        allow_http: profile.allow_http,
        allow_self_signed: profile.allow_self_signed,
        device_id: profile.device_id.clone(),
    }
}

fn load_home(client: &MusicClient) -> Result<LibraryPage, AppError> {
    let history = client.history(1, 18).unwrap_or_default();
    let favorites = client.favorites(1, 18).unwrap_or_default();
    let albums = client.albums(1, 18).unwrap_or_default();
    let artists = client.artists(1, 14).unwrap_or_default();
    let playlists = client.playlists(1, 12).unwrap_or_default();
    let mut tracks = history.tracks;
    for track in favorites.tracks {
        if !tracks.iter().any(|item| item.guid == track.guid) {
            tracks.push(track);
        }
    }
    Ok(LibraryPage {
        total: tracks.len(),
        tracks,
        albums: albums.albums,
        artists: artists.artists,
        playlists: playlists.playlists,
        ..Default::default()
    })
}

fn fetch_all_tracks(
    client: &MusicClient,
    fetch: impl Fn(usize, usize) -> Result<LibraryPage, AppError>,
) -> Result<LibraryPage, AppError> {
    let first = fetch(1, 500)?;
    let total = first.total.min(30_000);
    let mut tracks = first.tracks;
    let mut page = 2;
    while tracks.len() < total {
        let next = fetch(page, 500)?;
        if next.tracks.is_empty() {
            break;
        }
        tracks.extend(next.tracks);
        page += 1;
    }
    Ok(LibraryPage {
        total,
        tracks,
        ..Default::default()
    })
}

fn fetch_all_media(
    _client: &MusicClient,
    fetch: impl Fn(usize, usize) -> Result<LibraryPage, AppError>,
) -> Result<LibraryPage, AppError> {
    let first = fetch(1, 300)?;
    let total = first.total.min(15_000);
    let mut result = first;
    let mut page = 2;
    loop {
        let current_len = result.albums.len() + result.artists.len() + result.genres.len();
        if current_len >= total || page > 50 {
            break;
        }
        let next = fetch(page, 300)?;
        if next.albums.is_empty() && next.artists.is_empty() && next.genres.is_empty() {
            break;
        }
        result.albums.extend(next.albums);
        result.artists.extend(next.artists);
        result.genres.extend(next.genres);
        page += 1;
    }
    result.total = total;
    Ok(result)
}

fn safe_extension(format: &str) -> &'static str {
    match format.trim().to_ascii_lowercase().as_str() {
        "mp3" | "mpeg" => "mp3",
        "flac" => "flac",
        "wav" | "wave" => "wav",
        "ogg" | "vorbis" => "ogg",
        "m4a" | "aac" | "alac" => "m4a",
        _ => "audio",
    }
}
