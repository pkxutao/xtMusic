mod player;

use iced::widget::{
    Space, button, center, checkbox, column, container, row, scrollable, slider,
    text, text_input,
};
use iced::{Center, Element, Fill, Length, Subscription, Task, Theme, time};
use player::MpvController;
use std::time::Duration;
use xtmusic_core::{
    CoreError, DiscoveryOptions, FnDiscovery, FnMusicClient, LyricLine, Session,
    Track, active_lyric_index, parse_lrc,
};

const ROW_HEIGHT: f32 = 58.0;
const OVERSCAN: usize = 8;

pub fn main() -> iced::Result {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "xtmusic_native=info".into()),
        )
        .init();

    iced::application(App::new, App::update, App::view)
        .title(App::title)
        .theme(|_| Theme::Dark)
        .subscription(App::subscription)
        .window_size((1440.0, 900.0))
        .centered()
        .run()
}

struct App {
    screen: Screen,
    server_input: String,
    username: String,
    password: String,
    access_code: String,
    allow_http: bool,
    allow_self_signed: bool,
    loading: bool,
    status: String,
    error: Option<String>,
    client: Option<FnMusicClient>,
    session: Option<Session>,
    tracks: Vec<Track>,
    search: String,
    scroll_y: f32,
    viewport_height: f32,
    now_playing: Option<usize>,
    player: Option<MpvController>,
    volume: f32,
    paused: bool,
    current_position: f64,
    position_query_inflight: bool,
    lyrics: Vec<LyricLine>,
    lyrics_loading: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Screen {
    Login,
    Library,
    Lyrics,
    Settings,
}

#[derive(Debug, Clone)]
enum Message {
    ServerChanged(String),
    UsernameChanged(String),
    PasswordChanged(String),
    AccessCodeChanged(String),
    AllowHttpChanged(bool),
    AllowSelfSignedChanged(bool),
    LoginPressed,
    LoginFinished(Result<LoginBundle, CoreError>),
    SearchChanged(String),
    Navigate(Screen),
    Scrolled(scrollable::Viewport),
    PlayTrack(usize),
    PlayerStarted(Result<MpvController, String>, usize),
    LyricsLoaded(Result<String, CoreError>),
    TogglePause,
    PauseToggled(Result<(), String>),
    PreviousTrack,
    NextTrack,
    VolumeChanged(f32),
    VolumeApplied(Result<(), String>),
    SeekChanged(f32),
    SeekApplied(Result<(), String>),
    PositionUpdated(Result<f64, String>),
    Logout,
    Tick,
}

#[derive(Debug, Clone)]
struct LoginBundle {
    client: FnMusicClient,
    session: Session,
    tracks: Vec<Track>,
}

impl App {
    fn new() -> (Self, Task<Message>) {
        (
            Self {
                screen: Screen::Login,
                server_input: String::new(),
                username: String::new(),
                password: String::new(),
                access_code: String::new(),
                allow_http: true,
                allow_self_signed: false,
                loading: false,
                status: String::new(),
                error: None,
                client: None,
                session: None,
                tracks: Vec::new(),
                search: String::new(),
                scroll_y: 0.0,
                viewport_height: 700.0,
                now_playing: None,
                player: None,
                volume: 0.82,
                paused: false,
                current_position: 0.0,
                position_query_inflight: false,
                lyrics: Vec::new(),
                lyrics_loading: false,
            },
            Task::none(),
        )
    }

    fn title(&self) -> String {
        format!("XT Music Native {}", env!("CARGO_PKG_VERSION"))
    }

    fn subscription(&self) -> Subscription<Message> {
        time::every(Duration::from_millis(200)).map(|_| Message::Tick)
    }

    fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::ServerChanged(value) => self.server_input = value,
            Message::UsernameChanged(value) => self.username = value,
            Message::PasswordChanged(value) => self.password = value,
            Message::AccessCodeChanged(value) => self.access_code = value,
            Message::AllowHttpChanged(value) => self.allow_http = value,
            Message::AllowSelfSignedChanged(value) => self.allow_self_signed = value,
            Message::LoginPressed => {
                if self.loading {
                    return Task::none();
                }
                if self.server_input.trim().is_empty()
                    || self.username.trim().is_empty()
                    || self.password.is_empty()
                {
                    self.error =
                        Some("请完整填写服务器、飞牛音乐账号和密码".to_owned());
                    return Task::none();
                }
                self.loading = true;
                self.error = None;
                self.status = "正在连接飞牛音乐服务并加载曲库…".to_owned();
                let request = LoginRequest {
                    server_input: self.server_input.clone(),
                    username: self.username.clone(),
                    password: self.password.clone(),
                    access_code: self.access_code.clone(),
                    allow_http: self.allow_http,
                    allow_self_signed: self.allow_self_signed,
                };
                return Task::perform(connect_and_load(request), Message::LoginFinished);
            }
            Message::LoginFinished(Ok(bundle)) => {
                self.loading = false;
                self.status.clear();
                self.password.clear();
                self.client = Some(bundle.client);
                self.session = Some(bundle.session);
                self.tracks = bundle.tracks;
                self.screen = Screen::Library;
                self.scroll_y = 0.0;
            }
            Message::LoginFinished(Err(error)) => {
                self.loading = false;
                self.status.clear();
                self.error = Some(error.to_string());
            }
            Message::SearchChanged(value) => {
                self.search = value;
                self.scroll_y = 0.0;
            }
            Message::Navigate(screen) => self.screen = screen,
            Message::Scrolled(viewport) => {
                self.scroll_y = viewport.absolute_offset().y;
                self.viewport_height = viewport.bounds().height;
            }
            Message::PlayTrack(index) => return self.play_track(index),
            Message::PlayerStarted(Ok(player), index) => {
                self.player = Some(player);
                self.now_playing = Some(index);
                self.paused = false;
                self.current_position = 0.0;
                self.error = None;
                self.lyrics.clear();
                self.lyrics_loading = true;
                let Some(client) = self.client.clone() else {
                    return Task::none();
                };
                let guid = self.tracks[index].guid.clone();
                return Task::perform(
                    async move { client.lyrics_text(&guid).await },
                    Message::LyricsLoaded,
                );
            }
            Message::PlayerStarted(Err(error), _) => self.error = Some(error),
            Message::LyricsLoaded(Ok(text)) => {
                self.lyrics_loading = false;
                self.lyrics = parse_lrc(&text);
            }
            Message::LyricsLoaded(Err(error)) => {
                self.lyrics_loading = false;
                self.error = Some(error.to_string());
            }
            Message::TogglePause => {
                let Some(player) = self.player.clone() else {
                    return Task::none();
                };
                return Task::perform(
                    async move {
                        tokio::task::spawn_blocking(move || player.toggle_pause())
                            .await
                            .map_err(|error| error.to_string())?
                    },
                    Message::PauseToggled,
                );
            }
            Message::PauseToggled(Ok(())) => self.paused = !self.paused,
            Message::PauseToggled(Err(error)) => self.error = Some(error),
            Message::PreviousTrack => {
                if self.tracks.is_empty() {
                    return Task::none();
                }
                let index = self.now_playing.unwrap_or_default().saturating_sub(1);
                return self.play_track(index);
            }
            Message::NextTrack => {
                if self.tracks.is_empty() {
                    return Task::none();
                }
                let index = self
                    .now_playing
                    .map(|index| (index + 1) % self.tracks.len())
                    .unwrap_or_default();
                return self.play_track(index);
            }
            Message::VolumeChanged(value) => {
                self.volume = value;
                if let Some(player) = self.player.clone() {
                    return Task::perform(
                        async move {
                            tokio::task::spawn_blocking(move || player.set_volume(value))
                                .await
                                .map_err(|error| error.to_string())?
                        },
                        Message::VolumeApplied,
                    );
                }
            }
            Message::VolumeApplied(Err(error)) => self.error = Some(error),
            Message::VolumeApplied(Ok(())) => {}
            Message::SeekChanged(value) => {
                self.current_position = f64::from(value);
                if let Some(player) = self.player.clone() {
                    return Task::perform(
                        async move {
                            tokio::task::spawn_blocking(move || {
                                player.seek(f64::from(value))
                            })
                            .await
                            .map_err(|error| error.to_string())?
                        },
                        Message::SeekApplied,
                    );
                }
            }
            Message::SeekApplied(Err(error)) => self.error = Some(error),
            Message::SeekApplied(Ok(())) => {}
            Message::PositionUpdated(result) => {
                self.position_query_inflight = false;
                match result {
                    Ok(position) => self.current_position = position.max(0.0),
                    Err(error) => tracing::debug!(%error, "mpv position query failed"),
                }
            }
            Message::Logout => {
                if let Some(player) = self.player.take() {
                    let _ = player.stop();
                }
                self.client = None;
                self.session = None;
                self.tracks.clear();
                self.screen = Screen::Login;
                self.now_playing = None;
                self.lyrics.clear();
                self.current_position = 0.0;
            }
            Message::Tick => {
                if self.position_query_inflight || self.paused {
                    return Task::none();
                }
                let Some(player) = self.player.clone() else {
                    return Task::none();
                };
                self.position_query_inflight = true;
                return Task::perform(
                    async move {
                        tokio::task::spawn_blocking(move || player.position())
                            .await
                            .map_err(|error| error.to_string())?
                    },
                    Message::PositionUpdated,
                );
            }
        }
        Task::none()
    }

    fn view(&self) -> Element<'_, Message> {
        match self.screen {
            Screen::Login => self.view_login(),
            Screen::Library | Screen::Lyrics | Screen::Settings => self.view_shell(),
        }
    }

    fn view_login(&self) -> Element<'_, Message> {
        let brand = container(
            column![
                text("XT MUSIC").size(18),
                Space::new(Length::Fixed(1.0), Length::Fixed(20.0)),
                text("飞牛音乐库，\n以真正的原生速度呈现。").size(42),
                text("Rust + Iced + wgpu。没有 Chromium、DOM、CSS 或 WebView。")
                    .size(16),
                Space::new(Length::Fixed(1.0), Length::Fixed(24.0)),
                text(
                    "• Windows：DirectX 12\n• Ubuntu：Vulkan / Wayland / X11\n• mpv 原生音频后端"
                )
                .size(15),
            ]
            .spacing(12),
        )
        .width(Length::FillPortion(6))
        .height(Fill)
        .padding(56)
        .align_y(Center)
        .style(container::dark);

        let mut form = column![
            text("连接飞牛音乐服务").size(30),
            text(format!(
                "Native Preview v{}",
                env!("CARGO_PKG_VERSION")
            ))
            .size(13),
            text("服务器地址或 FN ID").size(13),
            text_input(
                "pkxutao 或 https://pkxutao.fnos.net",
                &self.server_input
            )
            .on_input(Message::ServerChanged)
            .padding(13),
            row![
                column![
                    text("飞牛音乐账号").size(13),
                    text_input("音乐应用内用户名", &self.username)
                        .on_input(Message::UsernameChanged)
                        .padding(13),
                ]
                .spacing(6)
                .width(Fill),
                column![
                    text("密码").size(13),
                    text_input("不会持久化", &self.password)
                        .secure(true)
                        .on_input(Message::PasswordChanged)
                        .on_submit(Message::LoginPressed)
                        .padding(13),
                ]
                .spacing(6)
                .width(Fill),
            ]
            .spacing(12),
            text("访问安全码（可选）").size(13),
            text_input("服务器开启时填写", &self.access_code)
                .secure(true)
                .on_input(Message::AccessCodeChanged)
                .padding(13),
            checkbox(self.allow_http)
                .label("允许可信局域网 HTTP 直连")
                .on_toggle(Message::AllowHttpChanged),
            checkbox(self.allow_self_signed)
                .label("信任此 NAS 的自签名证书")
                .on_toggle(Message::AllowSelfSignedChanged),
        ]
        .spacing(11);

        if self.loading {
            form = form.push(
                container(text(if self.status.is_empty() {
                    "正在连接…"
                } else {
                    &self.status
                }))
                .padding(12)
                .width(Fill)
                .style(container::secondary),
            );
        }
        if let Some(error) = &self.error {
            form = form.push(
                container(text(error))
                    .padding(12)
                    .width(Fill)
                    .style(container::danger),
            );
        }
        let submit = if self.loading {
            button("正在连接…").padding(14).width(Fill)
        } else {
            button("连接音乐库")
                .on_press(Message::LoginPressed)
                .padding(14)
                .width(Fill)
                .style(button::primary)
        };
        form = form.push(submit);

        let card = container(form)
            .max_width(620)
            .padding(34)
            .style(container::rounded_box);
        let card_area = center(card)
            .width(Length::FillPortion(5))
            .height(Fill)
            .padding(38);

        row![brand, card_area].width(Fill).height(Fill).into()
    }

    fn view_shell(&self) -> Element<'_, Message> {
        let sidebar = self.view_sidebar();
        let content = match self.screen {
            Screen::Library => self.view_library(),
            Screen::Lyrics => self.view_lyrics(),
            Screen::Settings => self.view_settings(),
            Screen::Login => unreachable!(),
        };
        let body = row![sidebar, content].height(Fill);
        column![body, self.view_player_bar()].height(Fill).into()
    }

    fn view_sidebar(&self) -> Element<'_, Message> {
        let nav_button = |label: &'static str, screen, selected| {
            let nav = button(label).width(Fill).padding([10, 14]);
            if selected {
                nav.style(button::primary)
            } else {
                nav.on_press(Message::Navigate(screen)).style(button::text)
            }
        };
        let account = self
            .session
            .as_ref()
            .map(|session| session.display_name.as_str())
            .unwrap_or("未登录");
        container(
            column![
                text("XT Music").size(24),
                text("Native Desktop").size(12),
                Space::new(Length::Fixed(1.0), Length::Fixed(24.0)),
                nav_button(
                    "音乐库",
                    Screen::Library,
                    self.screen == Screen::Library
                ),
                nav_button(
                    "沉浸歌词",
                    Screen::Lyrics,
                    self.screen == Screen::Lyrics
                ),
                nav_button(
                    "设置",
                    Screen::Settings,
                    self.screen == Screen::Settings
                ),
                Space::new(Length::Fixed(1.0), Fill),
                container(
                    column![text(account).size(15), text("飞牛音乐已连接").size(11)]
                        .spacing(4)
                )
                .padding(12)
                .width(Fill)
                .style(container::secondary),
                button("退出账号")
                    .on_press(Message::Logout)
                    .width(Fill)
                    .padding(10)
                    .style(button::text),
            ]
            .spacing(6),
        )
        .width(230)
        .height(Fill)
        .padding(18)
        .style(container::dark)
        .into()
    }

    fn view_library(&self) -> Element<'_, Message> {
        let filtered = self.filtered_indices();
        let total = filtered.len();
        let viewport_rows = (self.viewport_height / ROW_HEIGHT).ceil() as usize;
        let raw_start =
            ((self.scroll_y / ROW_HEIGHT).floor() as usize).saturating_sub(OVERSCAN);
        let start = raw_start.min(total);
        let end = (start + viewport_rows + OVERSCAN * 2).min(total);
        let mut rows = column![];
        if start > 0 {
            rows = rows.push(Space::new(Fill, start as f32 * ROW_HEIGHT));
        }
        for (visible_index, original_index) in filtered[start..end].iter().enumerate() {
            let display_index = start + visible_index;
            let track = &self.tracks[*original_index];
            let active = self.now_playing == Some(*original_index);
            let title = if track.title.is_empty() {
                "未命名歌曲"
            } else {
                &track.title
            };
            let row_content = row![
                text(format!("{:02}", display_index + 1)).size(12).width(42),
                column![text(title).size(15), text(track.artist_text()).size(12)]
                    .spacing(3)
                    .width(Length::FillPortion(5)),
                text(track.album_text())
                    .size(12)
                    .width(Length::FillPortion(3)),
                text(format_duration(track.duration_seconds()))
                    .size(12)
                    .width(72),
            ]
            .align_y(Center)
            .spacing(10);
            let track_button = button(row_content)
                .width(Fill)
                .height(ROW_HEIGHT)
                .padding([8, 10])
                .on_press(Message::PlayTrack(*original_index));
            rows = rows.push(if active {
                track_button.style(button::primary)
            } else {
                track_button.style(button::text)
            });
        }
        if end < total {
            rows = rows.push(Space::new(Fill, (total - end) as f32 * ROW_HEIGHT));
        }

        let list = scrollable(rows)
            .height(Fill)
            .width(Fill)
            .on_scroll(Message::Scrolled);
        let header = row![
            column![
                text("歌曲").size(34),
                text(format!("{} 首 · 原生虚拟化列表", total)).size(13),
            ]
            .spacing(4)
            .width(Fill),
            text_input("搜索歌曲、歌手或专辑", &self.search)
                .on_input(Message::SearchChanged)
                .padding(11)
                .width(360),
        ]
        .align_y(Center)
        .spacing(20);

        container(column![header, list].spacing(18))
            .width(Fill)
            .height(Fill)
            .padding(24)
            .into()
    }

    fn view_lyrics(&self) -> Element<'_, Message> {
        let current = self.now_playing.and_then(|index| self.tracks.get(index));
        let title = current
            .map(|track| track.title.as_str())
            .unwrap_or("尚未播放");
        let artist = current
            .map(Track::artist_text)
            .unwrap_or_else(|| "选择一首歌曲后显示歌词".to_owned());
        let active = active_lyric_index(
            &self.lyrics,
            (self.current_position.max(0.0) * 1_000.0) as u64,
        );

        let mut lyric_rows = column![].spacing(8).align_x(Center);
        if self.lyrics_loading {
            lyric_rows = lyric_rows.push(text("正在加载歌词…").size(18));
        } else if self.lyrics.is_empty() {
            lyric_rows = lyric_rows.push(text("当前歌曲没有可用的 LRC 歌词").size(18));
        } else {
            let center_index = active.unwrap_or_default();
            let start = center_index.saturating_sub(5);
            let end = (center_index + 7).min(self.lyrics.len());
            for (index, line) in self.lyrics[start..end].iter().enumerate() {
                let absolute_index = start + index;
                let line_text = if line.text.is_empty() { "…" } else { &line.text };
                let item = container(text(line_text).size(if Some(absolute_index) == active {
                    30
                } else {
                    21
                }))
                .padding([7, 16]);
                lyric_rows = lyric_rows.push(if Some(absolute_index) == active {
                    item.style(container::primary)
                } else {
                    item
                });
            }
        }

        row![
            container(
                column![
                    Space::new(Fill, Length::FillPortion(2)),
                    text("♪").size(120),
                    Space::new(Fill, Length::FillPortion(1)),
                    text(title).size(30),
                    text(artist).size(16),
                    text(format_time(self.current_position)).size(13),
                    Space::new(Fill, Length::FillPortion(2)),
                ]
                .align_x(Center),
            )
            .width(Length::FillPortion(5))
            .height(Fill)
            .style(container::dark),
            center(lyric_rows)
                .padding(52)
                .width(Length::FillPortion(7))
                .height(Fill),
        ]
        .height(Fill)
        .into()
    }

    fn view_settings(&self) -> Element<'_, Message> {
        let session = self.session.as_ref();
        container(
            column![
                text("设置").size(34),
                container(
                    column![
                        text("渲染后端").size(14),
                        text("Iced 0.14 / wgpu").size(20),
                        text("Windows 使用 DX12，Ubuntu 优先 Vulkan；无 WebView。")
                            .size(13),
                    ]
                    .spacing(6),
                )
                .padding(18)
                .width(Fill)
                .style(container::rounded_box),
                container(
                    column![
                        text("连接").size(14),
                        text(session.map(|value| value.server_url.as_str()).unwrap_or("未连接"))
                            .size(18),
                        text(if session.is_some_and(|value| value.relay_mode) {
                            "FN Connect 中继"
                        } else {
                            "直连"
                        })
                        .size(13),
                    ]
                    .spacing(6),
                )
                .padding(18)
                .width(Fill)
                .style(container::rounded_box),
                container(
                    column![
                        text("播放器").size(14),
                        text("mpv 原生进程 + JSON IPC").size(18),
                        text("Ubuntu 安装 mpv；Windows 可将 mpv 放入 runtime/mpv。")
                            .size(13),
                    ]
                    .spacing(6),
                )
                .padding(18)
                .width(Fill)
                .style(container::rounded_box),
            ]
            .spacing(16),
        )
        .padding(28)
        .width(Fill)
        .height(Fill)
        .into()
    }

    fn view_player_bar(&self) -> Element<'_, Message> {
        let current = self.now_playing.and_then(|index| self.tracks.get(index));
        let title = current
            .map(|track| track.title.as_str())
            .unwrap_or("选择一首歌曲");
        let artist = current
            .map(Track::artist_text)
            .unwrap_or_else(|| "XT Music Native".to_owned());
        let duration = current
            .map(Track::duration_seconds)
            .unwrap_or_default() as f32;
        let pause_button = if self.player.is_some() {
            button(if self.paused { "播放" } else { "暂停" })
                .on_press(Message::TogglePause)
                .padding([9, 20])
                .style(button::primary)
        } else {
            button("播放").padding([9, 20])
        };

        container(
            row![
                column![text(title).size(15), text(artist).size(11)]
                    .spacing(3)
                    .width(Length::FillPortion(3)),
                button("上一首")
                    .on_press(Message::PreviousTrack)
                    .padding([8, 12])
                    .style(button::text),
                pause_button,
                button("下一首")
                    .on_press(Message::NextTrack)
                    .padding([8, 12])
                    .style(button::text),
                text(format_time(self.current_position)).size(11),
                slider(
                    0.0..=duration.max(1.0),
                    self.current_position.clamp(0.0, f64::from(duration.max(1.0))) as f32,
                    Message::SeekChanged,
                )
                .step(0.5)
                .width(Length::FillPortion(4)),
                text(format_duration(duration as u64)).size(11),
                slider(0.0..=1.0, self.volume, Message::VolumeChanged)
                    .step(0.01)
                    .width(150),
            ]
            .align_y(Center)
            .spacing(12),
        )
        .height(82)
        .width(Fill)
        .padding([14, 24])
        .style(container::dark)
        .into()
    }

    fn filtered_indices(&self) -> Vec<usize> {
        let query = self.search.trim().to_ascii_lowercase();
        self.tracks
            .iter()
            .enumerate()
            .filter_map(|(index, track)| {
                let matches = query.is_empty()
                    || track.title.to_ascii_lowercase().contains(&query)
                    || track.artist_text().to_ascii_lowercase().contains(&query)
                    || track.album_text().to_ascii_lowercase().contains(&query);
                matches.then_some(index)
            })
            .collect()
    }

    fn play_track(&self, index: usize) -> Task<Message> {
        let Some(client) = self.client.clone() else {
            return Task::none();
        };
        let Some(track) = self.tracks.get(index).cloned() else {
            return Task::none();
        };
        let existing = self.player.clone();
        let volume = self.volume;
        Task::perform(
            async move {
                tokio::task::spawn_blocking(move || {
                    let player = match existing {
                        Some(player) => player,
                        None => MpvController::spawn(client.media_headers())?,
                    };
                    player.set_volume(volume)?;
                    let stream_url = client
                        .stream_url(&track.guid)
                        .map_err(|error| error.to_string())?;
                    player.play(&stream_url)?;
                    Ok(player)
                })
                .await
                .map_err(|error| error.to_string())?
            },
            move |result| Message::PlayerStarted(result, index),
        )
    }
}

#[derive(Clone)]
struct LoginRequest {
    server_input: String,
    username: String,
    password: String,
    access_code: String,
    allow_http: bool,
    allow_self_signed: bool,
}

async fn connect_and_load(request: LoginRequest) -> Result<LoginBundle, CoreError> {
    let discovery = FnDiscovery::new(request.allow_self_signed)?;
    let connection = discovery
        .resolve(
            &request.server_input,
            DiscoveryOptions {
                allow_http: request.allow_http,
                allow_public_http: false,
            },
        )
        .await?;

    let client = FnMusicClient::new(
        connection.server_url,
        connection.relay_mode,
        request.access_code,
        request.allow_http,
        request.allow_self_signed,
    )?;
    if client.requires_access_code().await? {
        if client.session().access_code.is_empty() {
            return Err(CoreError::AccessCodeRequired);
        }
        if !client.verify_access_code().await? {
            return Err(CoreError::InvalidAccessCode);
        }
    }
    let client = client.login(&request.username, &request.password).await?;
    let mut tracks = Vec::new();
    let first = client.tracks(1, 500).await?;
    let total = first.total.min(30_000);
    tracks.extend(first.list);
    let pages = total.div_ceil(500) as u32;
    for page in 2..=pages {
        let result = client.tracks(page, 500).await?;
        if result.list.is_empty() {
            break;
        }
        tracks.extend(result.list);
        if tracks.len() >= 30_000 {
            tracks.truncate(30_000);
            break;
        }
    }
    Ok(LoginBundle {
        session: client.session().clone(),
        client,
        tracks,
    })
}

fn format_duration(seconds: u64) -> String {
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

fn format_time(seconds: f64) -> String {
    format_duration(seconds.max(0.0).round() as u64)
}
