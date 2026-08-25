use crate::api::AppError;
use crate::backend::{Backend, BackendMessage};
use crate::lrc::{active_line, line_progress};
use crate::model::{
    Album, Artist, ConnectedSession, LibraryPage, LoginRequest, Lyrics, NavPage, Playlist,
    SavedProfile, Settings, Track,
};
use crate::player::{NativePlayer, PlayerCommand, PlayerEvent, PlayerState};
use eframe::egui::{
    self, Align, Align2, Color32, FontData, FontDefinitions, FontFamily, FontId, Frame,
    Layout, RichText, ScrollArea, Sense, Stroke, TextureHandle, TextureOptions, Vec2,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::Arc;
use std::time::{Duration, Instant};

const ACCENT: Color32 = Color32::from_rgb(113, 150, 255);
const BG_DARK: Color32 = Color32::from_rgb(12, 14, 20);
const PANEL_DARK: Color32 = Color32::from_rgb(20, 23, 31);
const SOFT_DARK: Color32 = Color32::from_rgb(29, 33, 44);
const TEXT_MUTED: Color32 = Color32::from_rgb(145, 153, 173);

#[derive(Default)]
struct LoginForm {
    profile_id: Option<String>,
    server: String,
    username: String,
    password: String,
    access_code: String,
    display_name: String,
    allow_http: bool,
    allow_self_signed: bool,
    remember_session: bool,
}

#[derive(Clone)]
struct Toast {
    text: String,
    error: bool,
    created: Instant,
}

#[derive(Debug, Clone)]
enum TrackAction {
    Play(usize),
    Favorite(usize),
    AddQueue(usize),
}

pub struct XtMusicApp {
    backend: Backend,
    player: NativePlayer,
    player_state: PlayerState,
    settings: Settings,
    session: Option<ConnectedSession>,
    profiles: Vec<SavedProfile>,
    login: LoginForm,
    login_busy: bool,
    login_progress: String,
    login_error: Option<String>,
    page: NavPage,
    previous_page: NavPage,
    pages: HashMap<NavPage, LibraryPage>,
    loading: HashSet<NavPage>,
    search_query: String,
    search_result: Option<LibraryPage>,
    search_active: bool,
    queue: Vec<Track>,
    queue_index: Option<usize>,
    shuffle: bool,
    repeat_mode: String,
    lyrics: Lyrics,
    lyrics_guid: Option<String>,
    covers: HashMap<String, TextureHandle>,
    cover_pending: HashSet<String>,
    show_accounts: bool,
    show_create_playlist: bool,
    new_playlist_name: String,
    add_playlist_track: Option<Track>,
    toasts: Vec<Toast>,
    fatal_error: Option<String>,
}

impl XtMusicApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        install_fonts(&cc.egui_ctx);
        configure_style(&cc.egui_ctx);
        let backend = match Backend::new() {
            Ok(value) => value,
            Err(error) => {
                return Self::failed(cc, error.message);
            }
        };
        let settings = backend.settings();
        let player = NativePlayer::new(settings.volume);
        let mut app = Self {
            backend,
            player,
            player_state: PlayerState {
                volume: settings.volume,
                ..Default::default()
            },
            settings: settings.clone(),
            session: None,
            profiles: Vec::new(),
            login: LoginForm {
                allow_http: true,
                remember_session: settings.remember_session,
                ..Default::default()
            },
            login_busy: false,
            login_progress: String::new(),
            login_error: None,
            page: settings.last_page,
            previous_page: NavPage::Home,
            pages: HashMap::new(),
            loading: HashSet::new(),
            search_query: String::new(),
            search_result: None,
            search_active: false,
            queue: Vec::new(),
            queue_index: None,
            shuffle: false,
            repeat_mode: settings.repeat_mode.clone(),
            lyrics: Lyrics::default(),
            lyrics_guid: None,
            covers: HashMap::new(),
            cover_pending: HashSet::new(),
            show_accounts: false,
            show_create_playlist: false,
            new_playlist_name: String::new(),
            add_playlist_track: None,
            toasts: Vec::new(),
            fatal_error: None,
        };
        app.backend.restore_session();
        app
    }

    fn failed(cc: &eframe::CreationContext<'_>, message: String) -> Self {
        install_fonts(&cc.egui_ctx);
        let backend = Backend::new().unwrap_or_else(|_| panic!("{message}"));
        Self {
            backend,
            player: NativePlayer::new(0.8),
            player_state: PlayerState::default(),
            settings: Settings::default(),
            session: None,
            profiles: Vec::new(),
            login: LoginForm::default(),
            login_busy: false,
            login_progress: String::new(),
            login_error: None,
            page: NavPage::Home,
            previous_page: NavPage::Home,
            pages: HashMap::new(),
            loading: HashSet::new(),
            search_query: String::new(),
            search_result: None,
            search_active: false,
            queue: Vec::new(),
            queue_index: None,
            shuffle: false,
            repeat_mode: "off".into(),
            lyrics: Lyrics::default(),
            lyrics_guid: None,
            covers: HashMap::new(),
            cover_pending: HashSet::new(),
            show_accounts: false,
            show_create_playlist: false,
            new_playlist_name: String::new(),
            add_playlist_track: None,
            toasts: Vec::new(),
            fatal_error: Some(message),
        }
    }

    fn handle_messages(&mut self, ctx: &egui::Context) {
        let messages = self.backend.poll().collect::<Vec<_>>();
        for message in messages {
            match message {
                BackendMessage::Profiles(profiles) => self.profiles = profiles,
                BackendMessage::LoginProgress(message) => {
                    self.login_progress = message;
                    self.login_busy = true;
                }
                BackendMessage::Connected(Ok(session)) => {
                    let memory_only = !session.keyring_secure && self.login.remember_session;
                    self.session = Some(session);
                    self.login_busy = false;
                    self.login_error = None;
                    self.login.password.clear();
                    self.search_active = false;
                    self.pages.clear();
                    self.navigate(self.page);
                    self.load_page(NavPage::Playlists);
                    if memory_only {
                        self.toast(
                            "系统密钥环不可用，会话只保留到本次运行",
                            false,
                        );
                    }
                }
                BackendMessage::Connected(Err(error)) => {
                    self.login_busy = false;
                    self.login_error = Some(format_error(&error));
                    self.session = None;
                }
                BackendMessage::PageLoaded(page, result) => {
                    self.loading.remove(&page);
                    match result {
                        Ok(data) => {
                            self.pages.insert(page, data);
                        }
                        Err(error) => self.toast(format_error(&error), true),
                    }
                }
                BackendMessage::SearchLoaded(query, result) => {
                    if query == self.search_query.trim() {
                        match result {
                            Ok(data) => {
                                self.search_result = Some(data);
                                self.search_active = true;
                            }
                            Err(error) => self.toast(format_error(&error), true),
                        }
                    }
                }
                BackendMessage::TrackReady(track, result) => match result {
                    Ok(path) => {
                        self.player.send(PlayerCommand::Load {
                            track: track.clone(),
                            path,
                            autoplay: true,
                        });
                        self.backend.load_lyrics(track.guid.clone());
                    }
                    Err(error) => self.toast(format_error(&error), true),
                },
                BackendMessage::CoverReady(id, result) => {
                    self.cover_pending.remove(&id);
                    if let Ok(bytes) = result {
                        if let Ok(image) = decode_color_image(&bytes) {
                            let texture = ctx.load_texture(
                                format!("cover-{id}"),
                                image,
                                TextureOptions::LINEAR,
                            );
                            self.covers.insert(id, texture);
                        }
                    }
                }
                BackendMessage::LyricsReady(guid, result) => {
                    if self.player_state.track.as_ref().map(|item| item.guid.as_str())
                        == Some(guid.as_str())
                    {
                        self.lyrics_guid = Some(guid);
                        self.lyrics = result.unwrap_or_default();
                    }
                }
                BackendMessage::FavoriteChanged(guid, result) => match result {
                    Ok(favorite) => {
                        self.update_favorite(&guid, favorite);
                        self.toast(
                            if favorite { "已添加到喜欢" } else { "已取消喜欢" },
                            false,
                        );
                    }
                    Err(error) => self.toast(format_error(&error), true),
                },
                BackendMessage::PlaylistsChanged(result) => match result {
                    Ok(data) => {
                        self.pages.insert(NavPage::Playlists, data);
                        self.show_create_playlist = false;
                        self.add_playlist_track = None;
                        self.toast("歌单已更新", false);
                    }
                    Err(error) => self.toast(format_error(&error), true),
                },
                BackendMessage::LoggedOut => {
                    self.session = None;
                    self.pages.clear();
                    self.queue.clear();
                    self.queue_index = None;
                    self.player.send(PlayerCommand::Stop);
                }
            }
        }

        let events = self.player.try_events().collect::<Vec<_>>();
        for event in events {
            match event {
                PlayerEvent::State(state) => self.player_state = state,
                PlayerEvent::Ended(_) => self.next_track(true),
                PlayerEvent::Error(message) => self.toast(message, true),
            }
        }
        ctx.request_repaint_after(Duration::from_millis(60));
    }

    fn navigate(&mut self, page: NavPage) {
        if page != NavPage::Lyrics {
            self.previous_page = page;
        }
        self.page = page;
        self.search_active = false;
        self.settings.last_page = page;
        let _ = self.backend.save_settings(self.settings.clone());
        if !matches!(page, NavPage::Lyrics | NavPage::Settings) {
            self.load_page(page);
        }
    }

    fn load_page(&mut self, page: NavPage) {
        if self.session.is_none() || self.loading.contains(&page) {
            return;
        }
        self.loading.insert(page);
        self.backend.load_page(page);
    }

    fn play_track(&mut self, track: Track, context: &[Track]) {
        let mut queue = if context.is_empty() {
            vec![track.clone()]
        } else {
            context.to_vec()
        };
        let index = queue
            .iter()
            .position(|item| item.guid == track.guid)
            .unwrap_or_else(|| {
                queue.insert(0, track.clone());
                0
            });
        self.queue = queue;
        self.queue_index = Some(index);
        self.prepare_current();
    }

    fn prepare_current(&mut self) {
        let Some(index) = self.queue_index else { return };
        let Some(track) = self.queue.get(index).cloned() else { return };
        self.player_state.loading = true;
        self.player_state.track = Some(track.clone());
        self.lyrics = Lyrics::default();
        self.lyrics_guid = None;
        self.backend.prepare_track(track);
    }

    fn next_track(&mut self, automatic: bool) {
        if self.queue.is_empty() {
            return;
        }
        if automatic && self.repeat_mode == "one" {
            self.player.send(PlayerCommand::Seek(0.0));
            self.player.send(PlayerCommand::Play);
            return;
        }
        let current = self.queue_index.unwrap_or(0);
        let next = if self.shuffle && self.queue.len() > 1 {
            let mut candidate = current;
            while candidate == current {
                candidate = rand::random::<u64>() as usize % self.queue.len();
            }
            candidate
        } else if current + 1 < self.queue.len() {
            current + 1
        } else if self.repeat_mode == "all" {
            0
        } else {
            self.player.send(PlayerCommand::Pause);
            return;
        };
        self.queue_index = Some(next);
        self.prepare_current();
    }

    fn previous_track(&mut self) {
        if self.player_state.position > 4.0 {
            self.player.send(PlayerCommand::Seek(0.0));
            return;
        }
        if self.queue.is_empty() {
            return;
        }
        let current = self.queue_index.unwrap_or(0);
        self.queue_index = Some(if current > 0 {
            current - 1
        } else if self.repeat_mode == "all" {
            self.queue.len() - 1
        } else {
            0
        });
        self.prepare_current();
    }

    fn toggle_current_favorite(&mut self) {
        let Some(track) = self.player_state.track.clone() else { return };
        self.backend
            .set_favorite(track.guid, !track.is_favorite);
    }

    fn update_favorite(&mut self, guid: &str, favorite: bool) {
        for page in self.pages.values_mut() {
            for track in &mut page.tracks {
                if track.guid == guid {
                    track.is_favorite = favorite;
                }
            }
        }
        for track in &mut self.queue {
            if track.guid == guid {
                track.is_favorite = favorite;
            }
        }
        if let Some(track) = self.player_state.track.as_mut() {
            if track.guid == guid {
                track.is_favorite = favorite;
            }
        }
    }

    fn toast(&mut self, text: impl Into<String>, error: bool) {
        self.toasts.push(Toast {
            text: text.into(),
            error,
            created: Instant::now(),
        });
        if self.toasts.len() > 5 {
            self.toasts.remove(0);
        }
    }

    fn request_cover(&mut self, cover_id: &str, size: usize) {
        if self.covers.contains_key(cover_id) || self.cover_pending.contains(cover_id) {
            return;
        }
        self.cover_pending.insert(cover_id.to_owned());
        self.backend.load_cover(cover_id.to_owned(), size);
    }

    fn cover(&mut self, ui: &mut egui::Ui, cover_id: Option<&str>, size: f32) {
        if let Some(id) = cover_id {
            if let Some(texture) = self.covers.get(id) {
                ui.add(egui::Image::new((texture.id(), Vec2::splat(size))).corner_radius(8.0));
                return;
            }
            self.request_cover(id, size.max(64.0) as usize * 2);
        }
        let (rect, _) = ui.allocate_exact_size(Vec2::splat(size), Sense::hover());
        ui.painter().rect_filled(rect, 8.0, SOFT_DARK);
        ui.painter().text(
            rect.center(),
            Align2::CENTER_CENTER,
            "♫",
            FontId::proportional(size * 0.34),
            TEXT_MUTED,
        );
    }

    fn render_login(&mut self, ctx: &egui::Context) {
        egui::CentralPanel::default()
            .frame(Frame::default().fill(BG_DARK).inner_margin(32))
            .show(ctx, |ui| {
                ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
                    ui.allocate_ui_with_layout(
                        Vec2::new((ui.available_width() * 0.46).max(360.0), ui.available_height()),
                        Layout::top_down(Align::Min).with_main_justify(true),
                        |ui| {
                            ui.add_space(70.0);
                            ui.label(RichText::new("XT MUSIC · NATIVE").color(ACCENT).strong());
                            ui.add_space(12.0);
                            ui.label(
                                RichText::new("你的飞牛音乐库，\n现在由 Rust 原生驱动。")
                                    .size(38.0)
                                    .strong()
                                    .color(Color32::WHITE),
                            );
                            ui.add_space(18.0);
                            ui.label(
                                RichText::new(
                                    "不使用 Electron，不使用 WebView。原生 GPU 界面、系统音频输出、虚拟化列表与安全密钥环。",
                                )
                                .size(16.0)
                                .color(TEXT_MUTED),
                            );
                            ui.add_space(28.0);
                            for text in [
                                "✓ FN ID / FNOS 地址登录",
                                "✓ 飞牛音乐应用内账号",
                                "✓ 原始密码永不落盘",
                                "✓ Windows 与 Ubuntu 原生渲染",
                            ] {
                                ui.label(RichText::new(text).size(15.0).color(Color32::LIGHT_GRAY));
                                ui.add_space(8.0);
                            }
                        },
                    );
                    ui.add_space(24.0);
                    Frame::default()
                        .fill(PANEL_DARK)
                        .stroke(Stroke::new(1.0, Color32::from_gray(48)))
                        .corner_radius(14.0)
                        .inner_margin(24)
                        .show(ui, |ui| {
                            ui.set_width(430.0);
                            ui.heading("连接飞牛音乐");
                            ui.label(RichText::new("v0.3.0 · Rust Native").color(TEXT_MUTED));
                            ui.add_space(16.0);

                            if !self.profiles.is_empty() {
                                ui.label(RichText::new("已保存账号").strong());
                                let profiles = self.profiles.clone();
                                for profile in profiles.into_iter().take(4) {
                                    let label = format!(
                                        "{}\n{} · {}",
                                        profile.name, profile.username, profile.server_url
                                    );
                                    if ui
                                        .add_sized(
                                            [ui.available_width(), 54.0],
                                            egui::Button::new(label).fill(SOFT_DARK),
                                        )
                                        .clicked()
                                    {
                                        if profile.has_session {
                                            self.login_busy = true;
                                            self.login_progress = "正在恢复安全会话…".into();
                                            self.backend.switch_profile(profile.id);
                                        } else {
                                            self.login.profile_id = Some(profile.id);
                                            self.login.server = profile.server_url;
                                            self.login.username = profile.username;
                                            self.login.display_name = profile.name;
                                            self.login.allow_http = profile.allow_http;
                                            self.login.allow_self_signed = profile.allow_self_signed;
                                        }
                                    }
                                    ui.add_space(6.0);
                                }
                                ui.separator();
                            }

                            field(ui, "服务器地址或 FN ID", &mut self.login.server, false);
                            field(ui, "飞牛音乐用户名", &mut self.login.username, false);
                            field(ui, "密码", &mut self.login.password, true);
                            field(ui, "访问安全码（可选）", &mut self.login.access_code, true);
                            field(ui, "账号备注（可选）", &mut self.login.display_name, false);
                            ui.checkbox(&mut self.login.allow_http, "允许可信局域网 HTTP");
                            ui.checkbox(
                                &mut self.login.allow_self_signed,
                                "信任此 NAS 的自签名证书",
                            );
                            ui.checkbox(&mut self.login.remember_session, "使用系统密钥环记住会话");

                            if let Some(error) = &self.login_error {
                                ui.add_space(8.0);
                                Frame::default()
                                    .fill(Color32::from_rgb(56, 27, 32))
                                    .corner_radius(8.0)
                                    .inner_margin(10)
                                    .show(ui, |ui| {
                                        ui.colored_label(Color32::from_rgb(255, 150, 160), error);
                                    });
                            }
                            if self.login_busy {
                                ui.add_space(8.0);
                                ui.horizontal(|ui| {
                                    ui.spinner();
                                    ui.label(if self.login_progress.is_empty() {
                                        "正在连接…"
                                    } else {
                                        &self.login_progress
                                    });
                                });
                            }
                            ui.add_space(12.0);
                            let enabled = !self.login_busy
                                && !self.login.server.trim().is_empty()
                                && !self.login.username.trim().is_empty()
                                && !self.login.password.is_empty();
                            if ui
                                .add_enabled(
                                    enabled,
                                    egui::Button::new(
                                        RichText::new("连接音乐库").size(16.0).strong(),
                                    )
                                    .fill(ACCENT)
                                    .min_size(Vec2::new(ui.available_width(), 44.0)),
                                )
                                .clicked()
                            {
                                self.submit_login();
                            }
                        });
                });
            });
    }

    fn submit_login(&mut self) {
        self.login_busy = true;
        self.login_error = None;
        self.login_progress = "正在准备安全连接…".into();
        self.settings.remember_session = self.login.remember_session;
        let _ = self.backend.save_settings(self.settings.clone());
        self.backend.login(LoginRequest {
            profile_id: self.login.profile_id.clone(),
            server_input: self.login.server.trim().to_owned(),
            username: self.login.username.trim().to_owned(),
            password: std::mem::take(&mut self.login.password),
            access_code: self.login.access_code.clone(),
            display_name: self.login.display_name.clone(),
            allow_http: self.login.allow_http,
            allow_self_signed: self.login.allow_self_signed,
            remember_session: self.login.remember_session,
        });
    }

    fn render_main(&mut self, ctx: &egui::Context) {
        let immersive = self.page == NavPage::Lyrics;
        if !immersive {
            egui::TopBottomPanel::top("topbar")
                .exact_height(58.0)
                .frame(Frame::default().fill(PANEL_DARK).inner_margin(10))
                .show(ctx, |ui| self.topbar(ui));
            egui::SidePanel::left("sidebar")
                .exact_width(230.0)
                .frame(Frame::default().fill(PANEL_DARK).inner_margin(12))
                .show(ctx, |ui| self.sidebar(ui));
            if self.settings.queue_open {
                egui::SidePanel::right("queue")
                    .default_width(320.0)
                    .min_width(260.0)
                    .max_width(420.0)
                    .frame(Frame::default().fill(PANEL_DARK).inner_margin(12))
                    .show(ctx, |ui| self.queue_panel(ui));
            }
        }
        egui::TopBottomPanel::bottom("player")
            .exact_height(102.0)
            .frame(Frame::default().fill(PANEL_DARK).inner_margin(10))
            .show(ctx, |ui| self.player_bar(ui));
        egui::CentralPanel::default()
            .frame(Frame::default().fill(BG_DARK).inner_margin(if immersive { 0 } else { 18 }))
            .show(ctx, |ui| {
                if immersive {
                    self.lyrics_page(ui);
                } else if self.search_active {
                    self.search_page(ui);
                } else {
                    self.page_content(ui);
                }
            });
        self.render_dialogs(ctx);
    }

    fn topbar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.label(RichText::new("XT Music").size(20.0).strong());
            ui.label(RichText::new("NATIVE").size(10.0).color(ACCENT).strong());
            ui.add_space(22.0);
            let response = ui.add_sized(
                [420.0, 36.0],
                egui::TextEdit::singleline(&mut self.search_query)
                    .hint_text("搜索歌曲、专辑或歌手…"),
            );
            let enter = response.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter));
            if enter && !self.search_query.trim().is_empty() {
                self.backend.search(self.search_query.trim().to_owned());
            }
            if self.search_active && ui.button("返回").clicked() {
                self.search_active = false;
            }
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                let name = self
                    .session
                    .as_ref()
                    .map(|item| item.profile.name.as_str())
                    .unwrap_or("账号");
                if ui.button(name).clicked() {
                    self.show_accounts = true;
                }
                if ui
                    .selectable_label(self.settings.queue_open, "播放队列")
                    .clicked()
                {
                    self.settings.queue_open = !self.settings.queue_open;
                    let _ = self.backend.save_settings(self.settings.clone());
                }
            });
        });
    }

    fn sidebar(&mut self, ui: &mut egui::Ui) {
        ui.add_space(6.0);
        ui.label(RichText::new("音乐馆").size(11.0).color(TEXT_MUTED));
        ui.add_space(6.0);
        for page in NavPage::LIBRARY {
            let selected = self.page == page && !self.search_active;
            if ui
                .add_sized(
                    [ui.available_width(), 38.0],
                    egui::Button::new(RichText::new(page.label()).size(14.0))
                        .selected(selected),
                )
                .clicked()
            {
                self.navigate(page);
            }
        }
        ui.add_space(12.0);
        ui.separator();
        ui.add_space(8.0);
        if ui
            .add_sized(
                [ui.available_width(), 38.0],
                egui::Button::new("新建歌单"),
            )
            .clicked()
        {
            self.show_create_playlist = true;
        }
        ui.with_layout(Layout::bottom_up(Align::Min), |ui| {
            if ui
                .add_sized(
                    [ui.available_width(), 38.0],
                    egui::Button::new("设置").selected(self.page == NavPage::Settings),
                )
                .clicked()
            {
                self.navigate(NavPage::Settings);
            }
        });
    }

    fn page_content(&mut self, ui: &mut egui::Ui) {
        if self.page == NavPage::Settings {
            self.settings_page(ui);
            return;
        }
        if self.loading.contains(&self.page) && !self.pages.contains_key(&self.page) {
            centered_loading(ui, "正在加载音乐库…");
            return;
        }
        let data = self.pages.get(&self.page).cloned().unwrap_or_default();
        match self.page {
            NavPage::Home => self.home_page(ui, data),
            NavPage::Tracks | NavPage::Favorites | NavPage::History => {
                self.tracks_page(ui, self.page.label(), data.tracks)
            }
            NavPage::Albums => self.albums_page(ui, data.albums),
            NavPage::Artists => self.artists_page(ui, data.artists),
            NavPage::Genres => self.genres_page(ui, data),
            NavPage::Playlists => self.playlists_page(ui, data.playlists),
            _ => {}
        }
    }

    fn home_page(&mut self, ui: &mut egui::Ui, data: LibraryPage) {
        ui.label(RichText::new("欢迎回来").size(12.0).color(ACCENT).strong());
        let name = self
            .session
            .as_ref()
            .map(|item| item.profile.name.as_str())
            .unwrap_or("XT Music");
        ui.label(RichText::new(name).size(34.0).strong());
        ui.label(RichText::new("从你的飞牛私有音乐库继续播放").color(TEXT_MUTED));
        ui.add_space(20.0);
        if !data.tracks.is_empty() {
            section_title(ui, "最近与喜欢");
            let tracks = data.tracks.clone();
            let actions = track_table(ui, &tracks, self.player_state.track.as_ref());
            self.apply_track_actions(actions, &tracks);
        }
        if !data.albums.is_empty() {
            ui.add_space(22.0);
            section_title(ui, "最近专辑");
            self.album_cards(ui, &data.albums[..data.albums.len().min(12)]);
        }
    }

    fn tracks_page(&mut self, ui: &mut egui::Ui, title: &str, tracks: Vec<Track>) {
        page_heading(ui, title, &format!("{} 首歌曲", tracks.len()));
        ui.horizontal(|ui| {
            if ui.button("▶ 播放全部").clicked() && !tracks.is_empty() {
                self.play_track(tracks[0].clone(), &tracks);
            }
            if ui.button("⤨ 随机播放").clicked() && !tracks.is_empty() {
                self.queue = tracks.clone();
                self.shuffle = true;
                self.queue_index = Some(rand::random::<u64>() as usize % self.queue.len());
                self.prepare_current();
            }
            if ui.button("刷新").clicked() {
                self.load_page(self.page);
            }
        });
        ui.add_space(10.0);
        let actions = track_table(ui, &tracks, self.player_state.track.as_ref());
        self.apply_track_actions(actions, &tracks);
    }

    fn apply_track_actions(&mut self, actions: Vec<TrackAction>, tracks: &[Track]) {
        for action in actions {
            match action {
                TrackAction::Play(index) => {
                    if let Some(track) = tracks.get(index) {
                        self.play_track(track.clone(), tracks);
                    }
                }
                TrackAction::Favorite(index) => {
                    if let Some(track) = tracks.get(index) {
                        self.backend
                            .set_favorite(track.guid.clone(), !track.is_favorite);
                    }
                }
                TrackAction::AddQueue(index) => {
                    if let Some(track) = tracks.get(index) {
                        if !self.queue.iter().any(|item| item.guid == track.guid) {
                            self.queue.push(track.clone());
                            self.toast("已加入播放队列", false);
                        }
                    }
                }
            }
        }
    }

    fn albums_page(&mut self, ui: &mut egui::Ui, albums: Vec<Album>) {
        page_heading(ui, "专辑", &format!("{} 张专辑", albums.len()));
        self.album_cards(ui, &albums);
    }

    fn album_cards(&mut self, ui: &mut egui::Ui, albums: &[Album]) {
        let columns = ((ui.available_width() / 180.0).floor() as usize).max(2);
        ScrollArea::vertical().show(ui, |ui| {
            for chunk in albums.chunks(columns) {
                ui.horizontal(|ui| {
                    for album in chunk {
                        Frame::default()
                            .fill(PANEL_DARK)
                            .corner_radius(10.0)
                            .inner_margin(10)
                            .show(ui, |ui| {
                                ui.set_width(150.0);
                                self.cover(ui, album.cover_id.as_deref(), 145.0);
                                ui.add_space(7.0);
                                ui.label(RichText::new(&album.name).strong());
                                ui.label(
                                    RichText::new(if album.artist.is_empty() {
                                        "未知歌手"
                                    } else {
                                        &album.artist
                                    })
                                    .size(12.0)
                                    .color(TEXT_MUTED),
                                );
                            });
                    }
                });
                ui.add_space(10.0);
            }
        });
    }

    fn artists_page(&mut self, ui: &mut egui::Ui, artists: Vec<Artist>) {
        page_heading(ui, "歌手", &format!("{} 位歌手", artists.len()));
        ScrollArea::vertical().show_rows(ui, 54.0, artists.len(), |ui, range| {
            for index in range {
                let artist = &artists[index];
                ui.horizontal(|ui| {
                    let (rect, _) = ui.allocate_exact_size(Vec2::splat(40.0), Sense::hover());
                    ui.painter().circle_filled(rect.center(), 20.0, SOFT_DARK);
                    ui.painter().text(
                        rect.center(),
                        Align2::CENTER_CENTER,
                        artist.name.chars().next().unwrap_or('歌'),
                        FontId::proportional(18.0),
                        Color32::WHITE,
                    );
                    ui.vertical(|ui| {
                        ui.label(RichText::new(&artist.name).strong());
                        ui.label(
                            RichText::new(format!("{} 首歌曲", artist.track_count))
                                .size(12.0)
                                .color(TEXT_MUTED),
                        );
                    });
                });
                ui.separator();
            }
        });
    }

    fn genres_page(&mut self, ui: &mut egui::Ui, data: LibraryPage) {
        page_heading(ui, "风格", &format!("{} 种风格", data.genres.len()));
        ScrollArea::vertical().show(ui, |ui| {
            ui.horizontal_wrapped(|ui| {
                for genre in data.genres {
                    ui.add_sized(
                        [180.0, 68.0],
                        egui::Button::new(format!(
                            "{}\n{} 首歌曲",
                            genre.name, genre.track_count
                        ))
                        .fill(PANEL_DARK),
                    );
                }
            });
        });
    }

    fn playlists_page(&mut self, ui: &mut egui::Ui, playlists: Vec<Playlist>) {
        page_heading(ui, "歌单", &format!("{} 个歌单", playlists.len()));
        ui.horizontal(|ui| {
            if ui.button("＋ 新建歌单").clicked() {
                self.show_create_playlist = true;
            }
            if ui.button("刷新").clicked() {
                self.load_page(NavPage::Playlists);
            }
        });
        ui.add_space(12.0);
        ScrollArea::vertical().show(ui, |ui| {
            for playlist in playlists {
                Frame::default()
                    .fill(PANEL_DARK)
                    .corner_radius(9.0)
                    .inner_margin(10)
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            self.cover(ui, playlist.cover_id.as_deref(), 54.0);
                            ui.vertical(|ui| {
                                ui.label(RichText::new(&playlist.name).size(16.0).strong());
                                ui.label(
                                    RichText::new(format!("{} 首歌曲", playlist.track_count))
                                        .color(TEXT_MUTED),
                                );
                            });
                            if let Some(track) = self.add_playlist_track.as_ref() {
                                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                    if ui.button("添加到此歌单").clicked() {
                                        self.backend.add_to_playlist(
                                            playlist.guid.clone(),
                                            track.guid.clone(),
                                        );
                                    }
                                });
                            }
                        });
                    });
                ui.add_space(8.0);
            }
        });
    }

    fn search_page(&mut self, ui: &mut egui::Ui) {
        let data = self.search_result.clone().unwrap_or_default();
        page_heading(ui, "搜索结果", self.search_query.trim());
        if !data.tracks.is_empty() {
            section_title(ui, "歌曲");
            let actions = track_table(ui, &data.tracks, self.player_state.track.as_ref());
            self.apply_track_actions(actions, &data.tracks);
        }
        if !data.albums.is_empty() {
            ui.add_space(18.0);
            section_title(ui, "专辑");
            self.album_cards(ui, &data.albums);
        }
        if !data.artists.is_empty() {
            ui.add_space(18.0);
            section_title(ui, "歌手");
            self.artists_page(ui, data.artists);
        }
        if data.total == 0 {
            centered_loading(ui, "没有找到匹配内容");
        }
    }

    fn settings_page(&mut self, ui: &mut egui::Ui) {
        page_heading(ui, "设置", "XT Music Native 0.3.0");
        Frame::default()
            .fill(PANEL_DARK)
            .corner_radius(10.0)
            .inner_margin(16)
            .show(ui, |ui| {
                ui.heading("播放");
                let mut volume = self.settings.volume;
                if ui
                    .add(egui::Slider::new(&mut volume, 0.0..=1.0).text("默认音量"))
                    .changed()
                {
                    self.settings.volume = volume;
                    self.player.send(PlayerCommand::Volume(volume));
                    let _ = self.backend.save_settings(self.settings.clone());
                }
                if ui
                    .checkbox(&mut self.settings.queue_open, "默认显示播放队列")
                    .changed()
                {
                    let _ = self.backend.save_settings(self.settings.clone());
                }
            });
        ui.add_space(12.0);
        Frame::default()
            .fill(PANEL_DARK)
            .corner_radius(10.0)
            .inner_margin(16)
            .show(ui, |ui| {
                ui.heading("隐私与安全");
                ui.label("• 原始飞牛音乐密码永不写入磁盘");
                ui.label("• Token 与访问安全码保存在系统密钥环");
                ui.label("• 密钥环不可用时只保存于当前进程内存");
                ui.label("• 非官方跨域重定向会删除全部凭据头");
            });
        ui.add_space(12.0);
        Frame::default()
            .fill(PANEL_DARK)
            .corner_radius(10.0)
            .inner_margin(16)
            .show(ui, |ui| {
                ui.heading("运行时");
                ui.label(format!("操作系统：{}", std::env::consts::OS));
                ui.label(format!("架构：{}", std::env::consts::ARCH));
                ui.label("渲染：egui / OpenGL（无 WebView）");
                ui.label("音频：rodio / 系统原生输出");
            });
    }

    fn queue_panel(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.heading("播放队列");
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if ui.button("清空").clicked() {
                    self.queue.clear();
                    self.queue_index = None;
                    self.player.send(PlayerCommand::Stop);
                }
            });
        });
        ui.label(RichText::new(format!("{} 首歌曲", self.queue.len())).color(TEXT_MUTED));
        ui.separator();
        let mut jump = None;
        let mut remove = None;
        ScrollArea::vertical().show_rows(ui, 52.0, self.queue.len(), |ui, range| {
            for index in range {
                let track = &self.queue[index];
                let active = self.queue_index == Some(index);
                let response = ui
                    .horizontal(|ui| {
                        ui.label(if active { "▶" } else { "  " });
                        ui.vertical(|ui| {
                            ui.label(
                                RichText::new(&track.title)
                                    .strong()
                                    .color(if active { ACCENT } else { Color32::WHITE }),
                            );
                            ui.label(
                                RichText::new(track.artist_text())
                                    .size(11.0)
                                    .color(TEXT_MUTED),
                            );
                        });
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            if ui.small_button("×").clicked() {
                                remove = Some(index);
                            }
                        });
                    })
                    .response
                    .interact(Sense::click());
                if response.double_clicked() {
                    jump = Some(index);
                }
                ui.separator();
            }
        });
        if let Some(index) = remove {
            self.queue.remove(index);
            if let Some(current) = self.queue_index {
                if self.queue.is_empty() {
                    self.queue_index = None;
                    self.player.send(PlayerCommand::Stop);
                } else if index < current {
                    self.queue_index = Some(current - 1);
                } else if index == current {
                    self.queue_index = Some(current.min(self.queue.len() - 1));
                    self.prepare_current();
                }
            }
        }
        if let Some(index) = jump {
            self.queue_index = Some(index);
            self.prepare_current();
        }
    }

    fn player_bar(&mut self, ui: &mut egui::Ui) {
        let track = self.player_state.track.clone();
        ui.horizontal(|ui| {
            ui.allocate_ui(Vec2::new(310.0, ui.available_height()), |ui| {
                ui.horizontal(|ui| {
                    self.cover(ui, track.as_ref().and_then(|item| item.cover_id.as_deref()), 68.0);
                    ui.vertical(|ui| {
                        ui.add_space(8.0);
                        ui.label(
                            RichText::new(
                                track
                                    .as_ref()
                                    .map(|item| item.title.as_str())
                                    .unwrap_or("选择一首歌曲"),
                            )
                            .strong(),
                        );
                        ui.label(
                            RichText::new(
                                track
                                    .as_ref()
                                    .map(Track::artist_text)
                                    .unwrap_or_else(|| "XT Music Native".into()),
                            )
                            .size(12.0)
                            .color(TEXT_MUTED),
                        );
                        if track.is_some() && ui.small_button(if track.as_ref().is_some_and(|item| item.is_favorite) { "♥" } else { "♡" }).clicked() {
                            self.toggle_current_favorite();
                        }
                    });
                });
            });
            ui.allocate_ui_with_layout(
                Vec2::new((ui.available_width() - 220.0).max(360.0), ui.available_height()),
                Layout::top_down(Align::Center),
                |ui| {
                    ui.horizontal(|ui| {
                        ui.selectable_value(&mut self.shuffle, !self.shuffle, "随机");
                        if ui.button("⏮").clicked() {
                            self.previous_track();
                        }
                        if ui
                            .add_sized(
                                [48.0, 36.0],
                                egui::Button::new(if self.player_state.loading {
                                    "…"
                                } else if self.player_state.playing {
                                    "⏸"
                                } else {
                                    "▶"
                                })
                                .fill(ACCENT),
                            )
                            .clicked()
                        {
                            self.player.send(PlayerCommand::Toggle);
                        }
                        if ui.button("⏭").clicked() {
                            self.next_track(false);
                        }
                        if ui.button(repeat_label(&self.repeat_mode)).clicked() {
                            self.repeat_mode = next_repeat(&self.repeat_mode).into();
                            self.settings.repeat_mode = self.repeat_mode.clone();
                            let _ = self.backend.save_settings(self.settings.clone());
                        }
                    });
                    ui.horizontal(|ui| {
                        ui.label(format_time(self.player_state.position));
                        let mut position = self.player_state.position;
                        let duration = self.player_state.duration.max(0.01);
                        let response = ui.add_sized(
                            [ui.available_width() - 100.0, 18.0],
                            egui::Slider::new(&mut position, 0.0..=duration).show_value(false),
                        );
                        if response.drag_stopped() {
                            self.player.send(PlayerCommand::Seek(position));
                        }
                        ui.label(format_time(self.player_state.duration));
                    });
                },
            );
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if ui.button("队列").clicked() {
                    self.settings.queue_open = !self.settings.queue_open;
                    let _ = self.backend.save_settings(self.settings.clone());
                }
                if ui.button("歌词").clicked() && track.is_some() {
                    if self.page == NavPage::Lyrics {
                        self.navigate(self.previous_page);
                    } else {
                        self.page = NavPage::Lyrics;
                    }
                }
                let mut volume = self.player_state.volume;
                if ui
                    .add_sized(
                        [90.0, 18.0],
                        egui::Slider::new(&mut volume, 0.0..=1.0).show_value(false),
                    )
                    .changed()
                {
                    self.player.send(PlayerCommand::Volume(volume));
                    self.settings.volume = volume;
                }
            });
        });
    }

    fn lyrics_page(&mut self, ui: &mut egui::Ui) {
        let track = self.player_state.track.clone();
        ui.painter().rect_filled(ui.max_rect(), 0.0, BG_DARK);
        ui.horizontal(|ui| {
            if ui.button("← 返回").clicked() {
                self.navigate(self.previous_page);
            }
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.label(RichText::new("沉浸式歌词").color(TEXT_MUTED));
            });
        });
        ui.add_space(10.0);
        ui.columns(2, |columns| {
            columns[0].with_layout(Layout::top_down(Align::Center), |ui| {
                ui.add_space(55.0);
                self.cover(ui, track.as_ref().and_then(|item| item.cover_id.as_deref()), 330.0);
                ui.add_space(24.0);
                ui.label(
                    RichText::new(
                        track
                            .as_ref()
                            .map(|item| item.title.as_str())
                            .unwrap_or("未播放歌曲"),
                    )
                    .size(28.0)
                    .strong(),
                );
                ui.label(
                    RichText::new(
                        track
                            .as_ref()
                            .map(Track::artist_text)
                            .unwrap_or_else(|| "XT Music Native".into()),
                    )
                    .size(17.0)
                    .color(TEXT_MUTED),
                );
            });
            columns[1].add_space(10.0);
            let active = active_line(&self.lyrics.lines, self.player_state.position);
            if self.lyrics.lines.is_empty() {
                columns[1].with_layout(Layout::top_down(Align::Center), |ui| {
                    ui.add_space(200.0);
                    ui.label(RichText::new("暂无同步歌词").size(24.0).color(TEXT_MUTED));
                });
            } else {
                ScrollArea::vertical()
                    .auto_shrink([false, false])
                    .show(&mut columns[1], |ui| {
                        ui.add_space(240.0);
                        for (index, line) in self.lyrics.lines.iter().enumerate() {
                            let distance = active
                                .map(|current| current.abs_diff(index))
                                .unwrap_or(10);
                            let is_active = active == Some(index);
                            let alpha = match distance {
                                0 => 255,
                                1 => 190,
                                2 => 135,
                                _ => 85,
                            };
                            let progress = if is_active {
                                line_progress(
                                    &self.lyrics.lines,
                                    index,
                                    self.player_state.position,
                                    self.player_state.duration,
                                )
                            } else {
                                0.0
                            };
                            let color = if is_active {
                                blend(TEXT_MUTED, Color32::WHITE, progress)
                            } else {
                                Color32::from_rgba_unmultiplied(220, 225, 235, alpha)
                            };
                            let response = ui.add_sized(
                                [ui.available_width() - 24.0, if is_active { 72.0 } else { 58.0 }],
                                egui::Label::new(
                                    RichText::new(if line.text.is_empty() { "♪" } else { &line.text })
                                        .size(if is_active { 28.0 } else { 21.0 })
                                        .strong()
                                        .color(color),
                                )
                                .sense(Sense::click()),
                            );
                            if is_active {
                                response.scroll_to_me(Some(Align::Center));
                            }
                            if response.clicked() {
                                self.player.send(PlayerCommand::Seek(line.time));
                            }
                        }
                        ui.add_space(260.0);
                    });
            }
        });
    }

    fn render_dialogs(&mut self, ctx: &egui::Context) {
        if self.show_accounts {
            let profiles = self.profiles.clone();
            let mut open = true;
            egui::Window::new("账号管理")
                .open(&mut open)
                .collapsible(false)
                .resizable(false)
                .anchor(Align2::CENTER_CENTER, Vec2::ZERO)
                .show(ctx, |ui| {
                    ui.set_width(440.0);
                    for profile in profiles {
                        Frame::default()
                            .fill(SOFT_DARK)
                            .corner_radius(8.0)
                            .inner_margin(10)
                            .show(ui, |ui| {
                                ui.horizontal(|ui| {
                                    ui.vertical(|ui| {
                                        ui.label(RichText::new(&profile.name).strong());
                                        ui.label(
                                            RichText::new(format!(
                                                "{} · {}",
                                                profile.username, profile.server_url
                                            ))
                                            .size(11.0)
                                            .color(TEXT_MUTED),
                                        );
                                    });
                                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                        if ui.button("删除").clicked() {
                                            self.backend.remove_profile(profile.id.clone());
                                        }
                                        if ui.button("切换").clicked() {
                                            if profile.has_session {
                                                self.backend.switch_profile(profile.id.clone());
                                                self.login_busy = true;
                                            } else {
                                                self.login.profile_id = Some(profile.id.clone());
                                                self.login.server = profile.server_url.clone();
                                                self.login.username = profile.username.clone();
                                                self.login.display_name = profile.name.clone();
                                                self.session = None;
                                            }
                                        }
                                    });
                                });
                            });
                        ui.add_space(7.0);
                    }
                    ui.separator();
                    if ui.button("退出当前账号并清除 Token").clicked() {
                        self.backend.logout(true);
                        self.show_accounts = false;
                    }
                });
            self.show_accounts = open;
        }

        if self.show_create_playlist {
            let mut open = true;
            egui::Window::new("新建歌单")
                .open(&mut open)
                .collapsible(false)
                .resizable(false)
                .anchor(Align2::CENTER_CENTER, Vec2::ZERO)
                .show(ctx, |ui| {
                    ui.set_width(360.0);
                    ui.text_edit_singleline(&mut self.new_playlist_name);
                    if ui
                        .add_enabled(
                            !self.new_playlist_name.trim().is_empty(),
                            egui::Button::new("创建"),
                        )
                        .clicked()
                    {
                        self.backend
                            .create_playlist(self.new_playlist_name.trim().to_owned());
                        self.new_playlist_name.clear();
                    }
                });
            self.show_create_playlist = open;
        }

        if let Some(track) = self.add_playlist_track.clone() {
            egui::Window::new(format!("添加“{}”到歌单", track.title))
                .collapsible(false)
                .resizable(false)
                .anchor(Align2::CENTER_CENTER, Vec2::ZERO)
                .show(ctx, |ui| {
                    if let Some(data) = self.pages.get(&NavPage::Playlists).cloned() {
                        for playlist in data.playlists {
                            if ui.button(&playlist.name).clicked() {
                                self.backend
                                    .add_to_playlist(playlist.guid, track.guid.clone());
                            }
                        }
                    } else {
                        ui.spinner();
                    }
                    if ui.button("取消").clicked() {
                        self.add_playlist_track = None;
                    }
                });
        }

        self.toasts.retain(|toast| toast.created.elapsed() < Duration::from_secs(4));
        for (index, toast) in self.toasts.iter().enumerate() {
            egui::Area::new(egui::Id::new(("toast", index)))
                .anchor(Align2::RIGHT_TOP, Vec2::new(-18.0, 72.0 + index as f32 * 54.0))
                .show(ctx, |ui| {
                    Frame::default()
                        .fill(if toast.error {
                            Color32::from_rgb(76, 31, 38)
                        } else {
                            Color32::from_rgb(31, 55, 48)
                        })
                        .corner_radius(8.0)
                        .inner_margin(12)
                        .show(ui, |ui| {
                            ui.label(&toast.text);
                        });
                });
        }
    }
}

impl eframe::App for XtMusicApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.handle_messages(ctx);
        if let Some(error) = self.fatal_error.clone() {
            egui::CentralPanel::default().show(ctx, |ui| {
                centered_loading(ui, &format!("XT Music 无法启动：{error}"));
            });
            return;
        }
        if self.session.is_none() {
            self.render_login(ctx);
        } else {
            self.render_main(ctx);
        }
    }

    fn save(&mut self, _storage: &mut dyn eframe::Storage) {
        let _ = self.backend.save_settings(self.settings.clone());
    }
}

fn field(ui: &mut egui::Ui, label: &str, value: &mut String, password: bool) {
    ui.add_space(8.0);
    ui.label(RichText::new(label).size(12.0).strong());
    let edit = egui::TextEdit::singleline(value).desired_width(ui.available_width());
    ui.add(if password { edit.password(true) } else { edit });
}

fn page_heading(ui: &mut egui::Ui, title: &str, subtitle: &str) {
    ui.label(RichText::new("音乐库").size(11.0).color(ACCENT).strong());
    ui.label(RichText::new(title).size(30.0).strong());
    ui.label(RichText::new(subtitle).color(TEXT_MUTED));
    ui.add_space(14.0);
}

fn section_title(ui: &mut egui::Ui, title: &str) {
    ui.label(RichText::new(title).size(20.0).strong());
    ui.add_space(8.0);
}

fn centered_loading(ui: &mut egui::Ui, text: &str) {
    ui.with_layout(Layout::top_down(Align::Center).with_main_justify(true), |ui| {
        ui.spinner();
        ui.add_space(12.0);
        ui.label(RichText::new(text).color(TEXT_MUTED));
    });
}

fn track_table(ui: &mut egui::Ui, tracks: &[Track], active: Option<&Track>) -> Vec<TrackAction> {
    let mut actions = Vec::new();
    let active_guid = active.map(|item| item.guid.as_str());
    ui.horizontal(|ui| {
        ui.add_sized([36.0, 22.0], egui::Label::new("#"));
        ui.add_sized([ui.available_width() * 0.42, 22.0], egui::Label::new("标题"));
        ui.add_sized([ui.available_width() * 0.28, 22.0], egui::Label::new("专辑"));
        ui.label("时长");
    });
    ui.separator();
    ScrollArea::vertical().show_rows(ui, 38.0, tracks.len(), |ui, range| {
        for index in range {
            let track = &tracks[index];
            let is_active = active_guid == Some(track.guid.as_str());
            let response = ui
                .horizontal(|ui| {
                    ui.add_sized(
                        [36.0, 28.0],
                        egui::Label::new(if is_active {
                            RichText::new("▶").color(ACCENT)
                        } else {
                            RichText::new(format!("{}", index + 1)).color(TEXT_MUTED)
                        }),
                    );
                    ui.allocate_ui_with_layout(
                        Vec2::new(ui.available_width() * 0.40, 30.0),
                        Layout::top_down(Align::Min),
                        |ui| {
                            ui.label(
                                RichText::new(&track.title)
                                    .strong()
                                    .color(if is_active { ACCENT } else { Color32::WHITE }),
                            );
                            ui.label(
                                RichText::new(track.artist_text())
                                    .size(10.5)
                                    .color(TEXT_MUTED),
                            );
                        },
                    );
                    ui.add_sized(
                        [ui.available_width() * 0.30, 28.0],
                        egui::Label::new(
                            RichText::new(track.album_text()).size(12.0).color(TEXT_MUTED),
                        ),
                    );
                    ui.label(
                        RichText::new(format_time(track.duration))
                            .size(12.0)
                            .color(TEXT_MUTED),
                    );
                    if ui.small_button(if track.is_favorite { "♥" } else { "♡" }).clicked() {
                        actions.push(TrackAction::Favorite(index));
                    }
                    if ui.small_button("＋").clicked() {
                        actions.push(TrackAction::AddQueue(index));
                    }
                })
                .response
                .interact(Sense::click());
            if response.double_clicked() {
                actions.push(TrackAction::Play(index));
            }
            ui.separator();
        }
    });
    actions
}

fn repeat_label(mode: &str) -> &'static str {
    match mode {
        "one" => "单曲",
        "all" => "循环",
        _ => "顺序",
    }
}

fn next_repeat(mode: &str) -> &'static str {
    match mode {
        "off" => "all",
        "all" => "one",
        _ => "off",
    }
}

fn format_time(value: f64) -> String {
    let seconds = value.max(0.0).round() as u64;
    let minutes = seconds / 60;
    let rest = seconds % 60;
    format!("{minutes}:{rest:02}")
}

fn format_error(error: &AppError) -> String {
    if error.code.is_empty() {
        error.message.clone()
    } else {
        format!("{}（{}）", error.message, error.code)
    }
}

fn decode_color_image(bytes: &[u8]) -> Result<egui::ColorImage, String> {
    let image = image::load_from_memory(bytes)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let size = [image.width() as usize, image.height() as usize];
    Ok(egui::ColorImage::from_rgba_unmultiplied(size, image.as_raw()))
}

fn blend(from: Color32, to: Color32, amount: f32) -> Color32 {
    let amount = amount.clamp(0.0, 1.0);
    let lerp = |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * amount).round() as u8;
    Color32::from_rgb(
        lerp(from.r(), to.r()),
        lerp(from.g(), to.g()),
        lerp(from.b(), to.b()),
    )
}

fn configure_style(ctx: &egui::Context) {
    let mut visuals = egui::Visuals::dark();
    visuals.panel_fill = BG_DARK;
    visuals.window_fill = PANEL_DARK;
    visuals.extreme_bg_color = SOFT_DARK;
    visuals.selection.bg_fill = ACCENT;
    visuals.widgets.inactive.bg_fill = SOFT_DARK;
    visuals.widgets.hovered.bg_fill = Color32::from_rgb(42, 48, 64);
    visuals.widgets.active.bg_fill = ACCENT;
    ctx.set_visuals(visuals);
    let mut style = (*ctx.style()).clone();
    style.spacing.item_spacing = Vec2::new(8.0, 8.0);
    style.spacing.button_padding = Vec2::new(12.0, 7.0);
    ctx.set_style(style);
}

fn install_fonts(ctx: &egui::Context) {
    let candidates = if cfg!(target_os = "windows") {
        vec![
            r"C:\Windows\Fonts\msyh.ttc".to_owned(),
            r"C:\Windows\Fonts\msyhbd.ttc".to_owned(),
            r"C:\Windows\Fonts\simhei.ttf".to_owned(),
        ]
    } else {
        vec![
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc".to_owned(),
            "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf".to_owned(),
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc".to_owned(),
        ]
    };
    let Some(bytes) = candidates.iter().find_map(|path| fs::read(path).ok()) else {
        return;
    };
    let mut fonts = FontDefinitions::default();
    fonts
        .font_data
        .insert("system-cjk".into(), Arc::new(FontData::from_owned(bytes)));
    for family in [FontFamily::Proportional, FontFamily::Monospace] {
        fonts
            .families
            .entry(family)
            .or_default()
            .insert(0, "system-cjk".into());
    }
    ctx.set_fonts(fonts);
}
