use crate::models::{Album, Artist, LoginRequest, Page, SessionInfo, Track};
use crate::protocol::FeiniuClient;
use crossbeam_channel::{unbounded, Receiver, Sender};
use directories::ProjectDirs;
use std::path::PathBuf;

#[derive(Debug)]
pub enum Request {
    Login(LoginRequest),
    Tracks,
    Albums,
    Artists,
    Favorites,
    History,
    Lyrics(String),
    Audio(Track),
    Favorite(Track, bool),
}

#[derive(Debug)]
pub enum Event {
    Busy(String),
    LoggedIn(SessionInfo),
    Tracks(Page<Track>),
    Albums(Page<Album>),
    Artists(Page<Artist>),
    Favorites(Page<Track>),
    History(Page<Track>),
    Lyrics(String, String),
    AudioReady(Track, PathBuf),
    FavoriteChanged(String, bool),
    Error(String),
}

pub struct Worker {
    pub sender: Sender<Request>,
    pub receiver: Receiver<Event>,
}

impl Worker {
    pub fn spawn() -> Self {
        let (request_tx, request_rx) = unbounded();
        let (event_tx, event_rx) = unbounded();
        std::thread::Builder::new()
            .name("xtmusic-network".into())
            .spawn(move || run(request_rx, event_tx))
            .expect("failed to start worker");
        Self { sender: request_tx, receiver: event_rx }
    }
}

fn run(receiver: Receiver<Request>, sender: Sender<Event>) {
    let mut client: Option<FeiniuClient> = None;
    for request in receiver {
        let result = match request {
            Request::Login(payload) => {
                let _ = sender.send(Event::Busy("正在发现飞牛音乐服务并登录…".into()));
                FeiniuClient::login(payload).map(|(next, session)| {
                    client = Some(next);
                    Event::LoggedIn(session)
                })
            }
            Request::Tracks => with_client(&client, |c| c.tracks(1, 30_000).map(Event::Tracks)),
            Request::Albums => with_client(&client, |c| c.albums(1, 10_000).map(Event::Albums)),
            Request::Artists => with_client(&client, |c| c.artists(1, 10_000).map(Event::Artists)),
            Request::Favorites => with_client(&client, |c| c.favorites(1, 30_000).map(Event::Favorites)),
            Request::History => with_client(&client, |c| c.history(1, 10_000).map(Event::History)),
            Request::Lyrics(guid) => with_client(&client, |c| {
                c.lyrics(&guid).map(|text| Event::Lyrics(guid, text))
            }),
            Request::Audio(track) => with_client(&client, |c| {
                let _ = sender.send(Event::Busy(format!("正在缓存：{}", track.title)));
                let path = cache_path(&track);
                if !path.exists() || path.metadata().map(|m| m.len()).unwrap_or(0) == 0 {
                    c.download_track(&track, &path)?;
                }
                Ok(Event::AudioReady(track, path))
            }),
            Request::Favorite(track, value) => with_client(&client, |c| {
                c.set_favorite(&track, value)?;
                Ok(Event::FavoriteChanged(track.guid, value))
            }),
        };
        match result {
            Ok(event) => { let _ = sender.send(event); }
            Err(error) => { let _ = sender.send(Event::Error(format!("{error:#}"))); }
        }
    }
}

fn with_client<T>(
    client: &Option<FeiniuClient>,
    action: impl FnOnce(&FeiniuClient) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    action(client.as_ref().ok_or_else(|| anyhow::anyhow!("请先登录飞牛音乐"))?)
}

fn cache_path(track: &Track) -> PathBuf {
    let root = ProjectDirs::from("com", "pkxutao", "XT Music")
        .map(|dirs| dirs.cache_dir().to_path_buf())
        .unwrap_or_else(|| std::env::temp_dir().join("xtmusic"));
    let audio = root.join("audio");
    let _ = std::fs::create_dir_all(&audio);
    let format = track.audio_spec.as_ref()
        .and_then(|item| item.format.as_deref().or(item.codec.as_deref()))
        .unwrap_or("audio")
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(10)
        .collect::<String>();
    let extension = if format.is_empty() { "audio" } else { format.as_str() };
    audio.join(format!("{}.{}", track.guid, extension))
}
