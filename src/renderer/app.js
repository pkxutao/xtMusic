import { api, bridge } from './api.js';
import { Player } from './player.js';
import { Store } from './store.js';
import { VirtualTrackTable } from './virtual-table.js';
import {
  accountModal,
  detailView,
  errorView,
  gridPageView,
  homeView,
  loadingView,
  loginView,
  lyricsView,
  playlistModal,
  promptModal,
  searchView,
  settingsView,
  sidebarView,
  trackPageView
} from './views.js';
import {
  artistsText,
  attr,
  configureMediaBaseUrl,
  coverUrl,
  debounce,
  escapeHtml,
  formatDuration,
  icon,
  imageHtml,
  initials,
  trackDuration
} from './utils.js';

const INITIAL_PLAYLIST_LIMIT = 120;
const INITIAL_PLAYLIST_TIMEOUT_MS = 8000;
const MAX_QUEUE_ROWS = 160;
const GRID_PAGE_SIZE = 72;
const TRACK_PAGE_SIZE = 400;
const DETAIL_TRACK_PAGE_SIZE = 400;

class XtMusicApp {
  constructor() {
    this.store = new Store();
    this.cache = new Map();
    this.requestSerial = 0;
    this.playlistLoadSerial = 0;
    this.sidebarSignature = '';
    this.currentTracks = [];
    this.currentItems = [];
    this.currentDetail = null;
    this.currentTable = null;
    this.contextTrack = null;
    this.pendingPlaylistTracks = [];
    this.systemDark = matchMedia('(prefers-color-scheme: dark)').matches;

    this.els = {
      splash: document.querySelector('#splash'),
      loginRoot: document.querySelector('#login-root'),
      shell: document.querySelector('#app-shell'),
      sidebar: document.querySelector('#sidebar-root'),
      content: document.querySelector('#content-root'),
      queue: document.querySelector('#queue-panel'),
      modal: document.querySelector('#modal-root'),
      context: document.querySelector('#context-menu-root'),
      toasts: document.querySelector('#toast-root'),
      search: document.querySelector('#global-search'),
      back: document.querySelector('#history-back'),
      forward: document.querySelector('#history-forward'),
      titleAccount: document.querySelector('#titlebar-account'),
      playerCover: document.querySelector('#player-cover'),
      playerTitle: document.querySelector('#player-title'),
      playerArtist: document.querySelector('#player-artist'),
      playerFavorite: document.querySelector('#player-favorite'),
      playerToggle: document.querySelector('#player-toggle'),
      playerPrevious: document.querySelector('#player-previous'),
      playerNext: document.querySelector('#player-next'),
      playerShuffle: document.querySelector('#player-shuffle'),
      playerRepeat: document.querySelector('#player-repeat'),
      playerProgress: document.querySelector('#player-progress'),
      playerCurrent: document.querySelector('#player-current-time'),
      playerDuration: document.querySelector('#player-duration'),
      playerLyrics: document.querySelector('#player-lyrics'),
      playerVolumeIcon: document.querySelector('#player-volume-icon'),
      playerVolume: document.querySelector('#player-volume'),
      playerQueue: document.querySelector('#player-queue')
    };

    this.player = new Player({
      musicCall: (method, args) => api.music(method, args),
      publishState: (state) => bridge.player.publishState(state),
      diagnostics: () => bridge.player.diagnostics(),
      onVolumeChange: debounce((volume) => {
        api.setSetting('volume', volume).catch(() => {});
        this.store.update((state) => ({
          settings: { ...state.settings, volume }
        }), 'volume');
      }, 300)
    });
  }

  async init() {
    this.#bindGlobalEvents();
    bridge.events.onAuthProgress((progress) => this.#renderLoginProgress(progress));
    bridge.events.onPlayerCommand((command) => {
      if (command === 'toggle') this.player.toggle();
      if (command === 'next') this.player.next();
      if (command === 'previous') this.player.previous();
    });
    bridge.events.onWindowMaximized((maximized) => this.#setMaximizeIcon(maximized));
    bridge.events.onSystemTheme((dark) => {
      this.systemDark = Boolean(dark);
      this.#applyTheme(this.store.get().settings.theme);
    });

    try {
      const bootstrap = await api.bootstrap();
      configureMediaBaseUrl(bootstrap.mediaBaseUrl);
      this.store.set({
        bootstrapping: false,
        session: bootstrap.session,
        accounts: bootstrap.accounts || [],
        settings: bootstrap.settings || {},
        encryptionAvailable: bootstrap.encryptionAvailable,
        sessionError: bootstrap.sessionError,
        version: bootstrap.version
      }, 'bootstrap');
      this.player.setInitialOptions({
        volume: bootstrap.settings?.volume,
        repeatMode: bootstrap.settings?.repeatMode
      });
      this.#applyTheme(bootstrap.settings?.theme || 'dark');
      this.#finishSplash();
      if (bootstrap.session) {
        await this.#enterSession(bootstrap.session);
      } else {
        this.#showLogin(bootstrap.sessionError?.message || null);
      }
    } catch (error) {
      this.#finishSplash();
      this.#showLogin(error.message);
    }
  }

  #bindGlobalEvents() {
    document.addEventListener('click', (event) => this.#handleClick(event));
    document.addEventListener('submit', (event) => this.#handleSubmit(event));
    document.addEventListener('change', (event) => this.#handleChange(event));
    document.addEventListener('keydown', (event) => this.#handleKeydown(event));
    document.addEventListener('contextmenu', (event) => {
      if (!event.target.closest('[data-track-index], [data-play-guid], .queue-row')) {
        this.#hideContextMenu();
      }
    });

    this.els.back.addEventListener('click', () => {
      const route = this.store.back();
      if (route) this.#loadRoute(route);
      this.#renderChrome();
    });
    this.els.forward.addEventListener('click', () => {
      const route = this.store.forward();
      if (route) this.#loadRoute(route);
      this.#renderChrome();
    });

    const runSearch = debounce((query) => {
      const text = query.trim();
      if (!text) return;
      const current = this.store.get().route;
      this.store.navigate('search', { query: text }, {
        replace: current.name === 'search'
      });
      this.#renderChrome();
      this.#loadRoute(this.store.get().route);
    }, 320);
    this.els.search.addEventListener('input', () => runSearch(this.els.search.value));
    this.els.search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.els.search.value = '';
        this.els.search.blur();
      }
    });

    document.querySelector('#window-minimize').addEventListener('click', () => bridge.window.minimize());
    document.querySelector('#window-maximize').addEventListener('click', () => bridge.window.toggleMaximize());
    document.querySelector('#window-close').addEventListener('click', () => bridge.window.close());
    bridge.window.isMaximized().then((value) => this.#setMaximizeIcon(value));

    this.els.playerToggle.addEventListener('click', () => this.player.toggle());
    this.els.playerPrevious.addEventListener('click', () => this.player.previous());
    this.els.playerNext.addEventListener('click', () => this.player.next());
    this.els.playerShuffle.addEventListener('click', () => this.player.toggleShuffle());
    this.els.playerRepeat.addEventListener('click', () => {
      this.player.cycleRepeat();
      api.setSetting('repeatMode', this.player.repeatMode).catch(() => {});
    });
    this.els.playerProgress.addEventListener('input', () => {
      const duration = this.player.state.duration;
      this.player.seek((Number(this.els.playerProgress.value) / 1000) * duration);
    });
    this.els.playerVolume.addEventListener('input', () => {
      this.player.setVolume(Number(this.els.playerVolume.value) / 100);
    });
    this.els.playerVolumeIcon.addEventListener('click', () => this.player.toggleMute());
    this.els.playerQueue.addEventListener('click', () => this.#toggleQueue());
    this.els.playerLyrics.addEventListener('click', () => this.#navigate('lyrics'));
    this.els.playerTitle.addEventListener('click', () => this.#navigate('lyrics'));
    this.els.playerFavorite.addEventListener('click', () => this.#toggleFavorite(this.player.currentTrack));

    for (const eventName of ['state', 'track', 'queue']) {
      this.player.addEventListener(eventName, () => this.#renderPlayer());
    }
    this.player.addEventListener('progress', () => this.#renderPlayerProgress());
    this.player.addEventListener('track', () => {
      this.#renderQueue();
      if (this.currentTable) this.currentTable.setActiveGuid(this.player.currentTrack?.guid);
      if (this.store.get().route.name === 'lyrics') this.#renderLyricsPage();
    });
    this.player.addEventListener('queue', () => this.#renderQueue());
    this.player.addEventListener('lyrics', () => {
      if (this.store.get().route.name === 'lyrics') this.#renderLyricsPage();
    });
    this.player.addEventListener('lyric-line', () => this.#syncLyrics());
    this.player.addEventListener('error', (event) => this.toast(event.detail, 'error'));

    this.store.addEventListener('change', (event) => {
      if (['navigate', 'history'].includes(event.detail.source)) this.#renderChrome();
    });
  }

  #finishSplash() {
    this.els.splash.classList.add('is-leaving');
    setTimeout(() => this.els.splash.classList.add('is-hidden'), 230);
  }

  #showLogin(error = null, prefill = null) {
    this.requestSerial += 1;
    this.playlistLoadSerial += 1;
    this.sidebarSignature = '';
    this.currentTable?.destroy();
    this.currentTable = null;
    this.currentTracks = [];
    this.currentItems = [];
    this.currentDetail = null;
    this.els.content.replaceChildren();
    this.els.sidebar.replaceChildren();
    this.els.queue.replaceChildren();
    const state = this.store.get();
    this.els.shell.classList.add('is-hidden');
    this.els.loginRoot.classList.remove('is-hidden');
    this.els.loginRoot.innerHTML = loginView({
      accounts: state.accounts,
      encryptionAvailable: state.encryptionAvailable,
      error
    });
    if (prefill) {
      const form = document.querySelector('#login-form');
      if (form) {
        form.elements.serverInput.value = prefill.fnId || prefill.serverUrl || '';
        form.elements.username.value = prefill.username || '';
        form.elements.name.value = prefill.name || '';
        form.elements.allowHttp.checked = Boolean(prefill.allowHttp);
        form.elements.allowSelfSigned.checked = Boolean(prefill.allowSelfSigned);
        form.dataset.accountId = prefill.id || '';
        setTimeout(() => form.elements.password.focus(), 0);
      }
    } else {
      setTimeout(() => document.querySelector('#login-server')?.focus(), 0);
    }
  }

  async #enterSession(session) {
    const playlistSerial = ++this.playlistLoadSerial;
    this.sidebarSignature = '';
    this.store.set({ session, error: null, playlists: [], playlistTotal: 0 }, 'session');
    this.els.loginRoot.classList.add('is-hidden');
    this.els.shell.classList.remove('is-hidden');
    this.#renderPlayer();
    this.#renderQueue();

    const last = this.store.get().settings.lastRoute || 'home';
    const safeRoute = ['home', 'tracks', 'albums', 'artists', 'genres', 'favorites', 'history', 'settings'].includes(last)
      ? last
      : 'home';
    this.store.navigate(safeRoute, {}, { replace: false, silent: true });
    this.#renderChrome();

    // The first usable page is the critical path. Secondary playlist data is
    // loaded only after that page has rendered.
    await this.#loadRoute(this.store.get().route);
    void this.#loadInitialPlaylists(session, playlistSerial);
  }

  async #loadInitialPlaylists(session, serial) {
    try {
      const result = await withTimeout(
        api.music('getPlaylists', { page: 1, size: INITIAL_PLAYLIST_LIMIT }),
        INITIAL_PLAYLIST_TIMEOUT_MS,
        '歌单加载超时'
      );
      if (serial !== this.playlistLoadSerial) return;
      if (sessionKey(this.store.get().session) !== sessionKey(session)) return;
      const list = Array.isArray(result?.list) ? result.list.slice(0, INITIAL_PLAYLIST_LIMIT) : [];
      const total = Math.max(Number(result?.total || 0), list.length);
      this.store.set({ playlists: list, playlistTotal: total }, 'playlists');
      this.#renderChrome();
    } catch {
      // Playlist navigation is optional; failure must not replace the usable page.
    }
  }

  #renderChrome() {
    const state = this.store.get();
    if (!state.session) return;
    const visiblePlaylists = (state.playlists || []).slice(0, INITIAL_PLAYLIST_LIMIT);
    const playlistSignature = visiblePlaylists
      .map((item) => `${item.guid || ''}:${item.name || ''}`)
      .join('\u001f');
    const signature = [
      sessionKey(state.session),
      state.route?.name || 'home',
      state.route?.params?.guid || '',
      state.playlistTotal || visiblePlaylists.length,
      playlistSignature
    ].join('\u001e');
    if (signature !== this.sidebarSignature) {
      this.els.sidebar.innerHTML = sidebarView(state);
      this.sidebarSignature = signature;
    }
    this.els.titleAccount.innerHTML = `<span class="account-avatar">${escapeHtml(initials(state.session.name || state.session.username))}</span>`;
    this.els.back.disabled = state.historyIndex <= 0;
    this.els.forward.disabled = state.historyIndex >= state.history.length - 1;
    this.els.shell.classList.toggle('queue-open', Boolean(state.queueOpen));
  }

  async #loadRoute(route, { force = false } = {}) {
    if (!this.store.get().session) return;
    const serial = ++this.requestSerial;
    const cacheKey = routeKey(route);
    this.currentTable?.destroy();
    this.currentTable = null;
    this.currentTracks = [];
    this.currentItems = [];
    this.currentDetail = null;

    if (route.name === 'lyrics') {
      this.#renderLyricsPage();
      return;
    }
    if (route.name === 'settings') {
      this.els.content.innerHTML = settingsView(this.store.get(), this.store.get().encryptionAvailable);
      return;
    }

    if (!force && this.cache.has(cacheKey)) {
      this.#applyRouteData(route, this.cache.get(cacheKey));
      return;
    }

    this.els.content.innerHTML = loadingView(routeLoadingLabel(route.name));
    try {
      const data = await this.#fetchRouteData(route);
      if (serial !== this.requestSerial) return;
      this.cache.set(cacheKey, data);
      this.#applyRouteData(route, data);
    } catch (error) {
      if (serial !== this.requestSerial) return;
      if (error.code === 'SESSION_EXPIRED') {
        this.toast('登录状态已失效，请重新登录', 'error');
        this.#showLogin(error.message, this.store.get().session);
        return;
      }
      this.els.content.innerHTML = errorView(error.message);
    }
  }

  async #fetchRouteData(route) {
    const page = normalizePage(route.params?.page);
    switch (route.name) {
      case 'home':
        return api.music('getHome');
      case 'tracks':
        return normalizePageResult(
          await api.music('getTracks', { page, size: TRACK_PAGE_SIZE }),
          page,
          TRACK_PAGE_SIZE
        );
      case 'albums':
        return normalizePageResult(
          await api.music('getAlbums', { page, size: GRID_PAGE_SIZE }),
          page,
          GRID_PAGE_SIZE
        );
      case 'artists':
        return normalizePageResult(
          await api.music('getArtists', { page, size: GRID_PAGE_SIZE }),
          page,
          GRID_PAGE_SIZE
        );
      case 'genres':
        return normalizePageResult(
          await api.music('getGenres', { page, size: GRID_PAGE_SIZE }),
          page,
          GRID_PAGE_SIZE
        );
      case 'favorites':
        return normalizePageResult(
          await api.music('getFavorites', { page, size: TRACK_PAGE_SIZE }),
          page,
          TRACK_PAGE_SIZE
        );
      case 'history':
        return normalizePageResult(
          await api.music('getHistory', { page, size: TRACK_PAGE_SIZE }),
          page,
          TRACK_PAGE_SIZE
        );
      case 'search':
        return api.music('search', { query: route.params.query, page: 1, size: 100 });
      case 'album':
        return this.#detailData('album', route.params, page);
      case 'artist':
        return this.#detailData('artist', route.params, page);
      case 'genre':
        return this.#detailData('genre', route.params, page);
      case 'playlist':
        return this.#detailData('playlist', route.params, page);
      default:
        return api.music('getHome');
    }
  }

  async #detailData(kind, params, page = 1) {
    const item = params.item || this.#findKnownItem(kind, params.guid) || {
      guid: params.guid,
      name: params.name || detailFallback(kind)
    };
    const method = {
      album: 'getAlbumTracks',
      artist: 'getArtistTracks',
      genre: 'getGenreTracks',
      playlist: 'getPlaylistTracks'
    }[kind];
    const key = {
      album: 'albumGUID',
      artist: 'artistGUID',
      genre: 'genreGUID',
      playlist: 'playlistGUID'
    }[kind];
    const result = await api.music(method, {
      [key]: params.guid,
      page,
      size: DETAIL_TRACK_PAGE_SIZE
    });
    const paged = normalizePageResult(result, page, DETAIL_TRACK_PAGE_SIZE);
    return {
      item,
      tracks: paged.list,
      pagination: paged.pagination
    };
  }

  async #fetchAll(method, args = {}, pageSize = 500, hardLimit = 30000) {
    const first = await api.music(method, { ...args, page: 1, size: pageSize });
    const list = [...(first.list || [])];
    const total = Math.min(Number(first.total || list.length), hardLimit);
    if (list.length >= total || list.length < pageSize) return list;
    const pages = Math.ceil(total / pageSize);
    for (let start = 2; start <= pages; start += 4) {
      const batch = [];
      for (let page = start; page < Math.min(start + 4, pages + 1); page += 1) {
        batch.push(api.music(method, { ...args, page, size: pageSize }));
      }
      const results = await Promise.all(batch);
      for (const result of results) list.push(...(result.list || []));
      if (list.length >= hardLimit) break;
    }
    return list.slice(0, hardLimit);
  }

  #applyRouteData(route, data) {
    switch (route.name) {
      case 'home':
        this.currentItems = flattenHomeTracks(data);
        this.els.content.innerHTML = homeView(data, this.store.get().session);
        break;
      case 'tracks':
        this.#renderTrackRoute(
          '所有歌曲',
          pageSummary(data.pagination, '首歌曲'),
          data.list,
          data.pagination,
          '播放本页'
        );
        break;
      case 'favorites':
        this.#renderTrackRoute(
          '我喜欢的音乐',
          pageSummary(data.pagination, '首收藏'),
          data.list,
          data.pagination,
          '播放本页'
        );
        break;
      case 'history':
        this.#renderTrackRoute(
          '最近播放',
          pageSummary(data.pagination, '条记录'),
          data.list,
          data.pagination,
          '播放本页'
        );
        break;
      case 'albums':
        this.currentItems = data.list;
        this.els.content.innerHTML = gridPageView({
          title: '专辑',
          subtitle: pageSummary(data.pagination, '张专辑'),
          items: data.list,
          kind: 'album',
          total: data.pagination.total,
          pagination: data.pagination
        });
        break;
      case 'artists':
        this.currentItems = data.list;
        this.els.content.innerHTML = gridPageView({
          title: '歌手',
          subtitle: pageSummary(data.pagination, '位歌手'),
          items: data.list,
          kind: 'artist',
          total: data.pagination.total,
          pagination: data.pagination,
          iconName: 'artist'
        });
        break;
      case 'genres':
        this.currentItems = data.list;
        this.els.content.innerHTML = gridPageView({
          title: '风格',
          subtitle: pageSummary(data.pagination, '个音乐风格'),
          items: data.list,
          kind: 'genre',
          total: data.pagination.total,
          pagination: data.pagination,
          iconName: 'genre'
        });
        break;
      case 'search':
        this.currentTracks = data.tracks?.list || [];
        this.currentItems = [...(data.albums?.list || []), ...(data.artists?.list || [])];
        this.els.content.innerHTML = searchView(route.params.query, data);
        this.#mountTrackTable(this.currentTracks);
        break;
      case 'album':
      case 'artist':
      case 'genre':
      case 'playlist':
        this.currentDetail = { kind: route.name, item: data.item };
        this.currentTracks = data.tracks;
        this.els.content.innerHTML = detailView({
          kind: route.name,
          item: data.item,
          tracks: data.tracks,
          pagination: data.pagination
        });
        this.#mountTrackTable(data.tracks);
        break;
      default:
        this.els.content.innerHTML = homeView(data, this.store.get().session);
    }
    this.els.content.scrollTop = 0;
  }

  #renderTrackRoute(title, subtitle, tracks, pagination = null, actionLabel = null) {
    this.currentTracks = tracks;
    this.els.content.innerHTML = trackPageView({
      title,
      subtitle,
      tracks,
      pagination,
      actionLabel
    });
    this.#mountTrackTable(tracks);
  }

  #mountTrackTable(tracks) {
    const host = this.els.content.querySelector('#track-table-host');
    if (!host || !tracks.length) return;
    this.currentTable = new VirtualTrackTable(host, tracks, {
      activeGuid: this.player.currentTrack?.guid,
      onActivate: (index) => this.player.setQueue(tracks, index),
      onAction: (action, index, track, event) => this.#handleTrackAction(action, track, tracks, index, event),
      onContext: (event, index, track) => this.#showTrackContext(event, track, tracks, index)
    });
  }

  async #changeLibraryPage(rawPage) {
    const current = this.store.get().route;
    const page = normalizePage(rawPage);
    if (page === normalizePage(current.params?.page)) return;
    this.store.navigate(current.name, { ...current.params, page }, { replace: true });
    this.#renderChrome();
    await this.#loadRoute(this.store.get().route);
  }

  #navigate(name, params = {}) {
    if (name === 'lyrics' && !this.player.currentTrack) {
      this.toast('请先播放一首歌曲', 'warning');
      return;
    }
    this.store.navigate(name, params);
    this.#renderChrome();
    this.#loadRoute(this.store.get().route);
  }

  async #handleClick(event) {
    if (event.target.matches?.('[data-modal-backdrop]')) {
      this.#closeModal();
      return;
    }
    const target = event.target.closest('button, [data-route], [data-open-kind], [data-play-guid], [data-action], [data-login-account], [data-queue-index], [data-lyric-time]');
    if (!target) {
      this.#hideContextMenu();
      return;
    }

    const route = target.dataset.route;
    if (route) {
      this.#navigate(route);
      return;
    }

    if (target.dataset.loginAccount) {
      await this.#selectSavedAccount(target.dataset.loginAccount);
      return;
    }

    if (target.dataset.openKind && target.dataset.openId) {
      const kind = target.dataset.openKind;
      const item = this.#findKnownItem(kind, target.dataset.openId);
      this.#navigate(kind, { guid: target.dataset.openId, item });
      return;
    }

    if (target.dataset.playGuid) {
      const track = this.#findTrack(target.dataset.playGuid);
      if (track) {
        const context = this.#currentPlayableContext(track);
        await this.player.playTrack(track, context);
      }
      return;
    }

    if (target.dataset.queueIndex != null) {
      await this.player.jumpTo(Number(target.dataset.queueIndex));
      return;
    }

    if (target.dataset.lyricTime != null) {
      this.player.seek(Number(target.dataset.lyricTime));
      return;
    }

    const action = target.dataset.action;
    if (!action) return;
    switch (action) {
      case 'toggle-password': {
        const input = document.querySelector('#login-password');
        if (input) input.type = input.type === 'password' ? 'text' : 'password';
        break;
      }
      case 'play-all':
        if (this.currentTracks.length) await this.player.setQueue(this.currentTracks, 0);
        break;
      case 'shuffle-all':
        if (this.currentTracks.length) {
          const shuffled = [...this.currentTracks].sort(() => Math.random() - 0.5);
          await this.player.setQueue(shuffled, 0);
        }
        break;
      case 'play-section': {
        const home = this.cache.get('home:{}');
        const list = home?.[target.dataset.section]?.list || [];
        if (list.length) await this.player.setQueue(list, 0);
        break;
      }
      case 'refresh':
        this.cache.delete(routeKey(this.store.get().route));
        await this.#loadRoute(this.store.get().route, { force: true });
        break;
      case 'library-page':
        await this.#changeLibraryPage(target.dataset.page);
        break;
      case 'accounts':
        this.#showAccounts();
        break;
      case 'close-modal':
        this.#closeModal();
        break;
      case 'switch-account':
        await this.#switchAccount(target.dataset.id);
        break;
      case 'remove-account':
        await this.#removeAccount(target.dataset.id);
        break;
      case 'add-account':
        this.#closeModal();
        this.#showLogin(null);
        break;
      case 'logout':
        await this.#logout();
        break;
      case 'create-playlist':
        this.#showCreatePlaylist();
        break;
      case 'edit-playlist':
        if (this.currentDetail?.kind === 'playlist') this.#showEditPlaylist(this.currentDetail.item);
        break;
      case 'clear-cache':
        await api.clearCache();
        this.toast('缓存已清理', 'success');
        break;
      case 'open-lyrics':
        this.#navigate('lyrics');
        break;
      case 'remove-queue':
        this.player.removeFromQueue(Number(target.dataset.index));
        break;
      case 'clear-queue':
        this.player.clearQueue();
        break;
      case 'context-play':
        if (this.contextTrack) await this.player.playTrack(this.contextTrack, this.#currentPlayableContext(this.contextTrack));
        this.#hideContextMenu();
        break;
      case 'context-next':
        if (this.contextTrack) this.player.addToQueue(this.contextTrack, { next: true });
        this.#hideContextMenu();
        this.toast('已加入下一首播放', 'success');
        break;
      case 'context-queue':
        if (this.contextTrack) this.player.addToQueue(this.contextTrack);
        this.#hideContextMenu();
        this.toast('已加入播放队列', 'success');
        break;
      case 'context-favorite':
        await this.#toggleFavorite(this.contextTrack);
        this.#hideContextMenu();
        break;
      case 'context-playlist':
        this.#hideContextMenu();
        this.#showPlaylistPicker([this.contextTrack]);
        break;
      case 'confirm-add-playlist':
        await this.#addPendingToPlaylist(target.dataset.id);
        break;
      default:
        break;
    }
  }

  async #handleSubmit(event) {
    if (event.target.id === 'login-form') {
      event.preventDefault();
      await this.#submitLogin(event.target);
      return;
    }
    if (event.target.id === 'prompt-form') {
      event.preventDefault();
      const value = event.target.elements.value.value.trim();
      const action = event.target.dataset.submitAction;
      if (action === 'create-playlist-submit') await this.#createPlaylist(value);
      if (action === 'edit-playlist-submit') await this.#editPlaylist(value);
    }
  }

  async #handleChange(event) {
    const key = event.target.dataset.setting;
    if (!key) return;
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    try {
      const result = await api.setSetting(key, value);
      const state = this.store.get();
      this.store.set({
        settings: { ...state.settings, [key]: result.value }
      }, 'setting');
      if (key === 'theme') this.#applyTheme(result.value);
      this.toast('设置已保存', 'success');
    } catch (error) {
      this.toast(error.message, 'error');
    }
  }

  #handleKeydown(event) {
    const editable = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if ((event.ctrlKey || event.metaKey) && ['k', 'f'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      this.els.search.focus();
      this.els.search.select();
      return;
    }
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      this.els.back.click();
      return;
    }
    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      this.els.forward.click();
      return;
    }
    if (event.key === 'F5') {
      event.preventDefault();
      this.cache.delete(routeKey(this.store.get().route));
      this.#loadRoute(this.store.get().route, { force: true });
      return;
    }
    if (event.key === 'Escape') {
      this.#closeModal();
      this.#hideContextMenu();
      return;
    }
    if (!editable && event.code === 'Space') {
      event.preventDefault();
      this.player.toggle();
    }
    if (!editable && event.ctrlKey && event.key === 'ArrowRight') this.player.next();
    if (!editable && event.ctrlKey && event.key === 'ArrowLeft') this.player.previous();
  }

  async #submitLogin(form) {
    const submit = document.querySelector('#login-submit');
    const errorBox = document.querySelector('#login-error');
    const progress = document.querySelector('#login-progress');
    submit.disabled = true;
    progress?.classList.remove('is-hidden');
    errorBox?.classList.add('is-hidden');

    const payload = {
      accountId: form.dataset.accountId || null,
      serverInput: form.elements.serverInput.value.trim(),
      username: form.elements.username.value.trim(),
      password: form.elements.password.value,
      accessCode: form.elements.accessCode.value,
      name: form.elements.name.value.trim(),
      allowHttp: form.elements.allowHttp.checked,
      allowSelfSigned: form.elements.allowSelfSigned.checked,
      rememberSession: form.elements.rememberSession.checked
    };

    try {
      const result = await api.connect(payload);
      this.store.set({
        session: result.session,
        accounts: result.accounts,
        connectionDiagnostics: result.connection?.diagnostics || []
      }, 'login');
      this.cache.clear();
      form.elements.password.value = '';
      await this.#enterSession(result.session);
    } catch (error) {
      if (error.code === 'ACCESS_CODE_REQUIRED') {
        form.elements.accessCode.focus();
      }
      if (errorBox) {
        errorBox.classList.remove('is-hidden');
        errorBox.querySelector('span').textContent = error.message;
      }
    } finally {
      submit.disabled = false;
      progress?.classList.add('is-hidden');
    }
  }

  #renderLoginProgress(progress) {
    const text = document.querySelector('#login-progress-text');
    if (text) text.textContent = progress?.message || '正在连接…';
  }

  async #selectSavedAccount(id) {
    const account = this.store.get().accounts.find((item) => item.id === id);
    if (!account) return;
    if (!account.hasSession) {
      this.#showLogin(null, account);
      return;
    }
    this.#renderLoginProgress({ message: '正在恢复加密会话…' });
    document.querySelector('#login-progress')?.classList.remove('is-hidden');
    try {
      const result = await api.switchAccount(id);
      this.store.set({ session: result.session, accounts: result.accounts }, 'switch');
      this.cache.clear();
      this.player.clearQueue();
      await this.#enterSession(result.session);
    } catch (error) {
      this.#showLogin(error.message, account);
    }
  }

  #showAccounts() {
    this.els.modal.innerHTML = accountModal(
      this.store.get().accounts,
      this.store.get().session?.id
    );
  }

  async #switchAccount(id) {
    this.#closeModal();
    try {
      this.els.content.innerHTML = loadingView('正在切换账号…');
      const result = await api.switchAccount(id);
      this.store.set({ session: result.session, accounts: result.accounts }, 'switch');
      this.cache.clear();
      this.player.clearQueue();
      await this.#enterSession(result.session);
    } catch (error) {
      const account = this.store.get().accounts.find((item) => item.id === id);
      this.#showLogin(error.message, account);
    }
  }

  async #removeAccount(id) {
    const account = this.store.get().accounts.find((item) => item.id === id);
    if (!account) return;
    if (!window.confirm(`确定删除账号“${account.name || account.username}”吗？`)) return;
    const result = await api.removeAccount(id);
    this.store.set({ accounts: result.accounts, session: result.session }, 'remove-account');
    if (!result.session) {
      this.#closeModal();
      this.player.clearQueue();
      this.#showLogin();
    } else {
      this.#showAccounts();
    }
  }

  async #logout() {
    if (!window.confirm('退出后将清除此账号保存的登录令牌，确定继续吗？')) return;
    const result = await api.logout({ clearSession: true });
    this.store.set({ session: null, accounts: result.accounts }, 'logout');
    this.cache.clear();
    this.player.clearQueue();
    this.#showLogin();
  }

  #renderPlayer() {
    const state = this.player.state;
    const track = state.track;
    const coverId = track?.coverId || track?.album?.coverId;
    this.els.playerCover.innerHTML = coverId
      ? `<img src="${attr(coverUrl(coverId, 256))}" alt="">`
      : icon('music', 23);
    this.els.playerCover.classList.toggle('cover-placeholder', !coverId);
    this.els.playerTitle.textContent = track?.title || '选择一首歌曲';
    this.els.playerArtist.textContent = track ? artistsText(track) : 'XT Music';
    this.els.playerFavorite.innerHTML = icon(track?.isFavorite ? 'heartFill' : 'heart', 17);
    this.els.playerFavorite.classList.toggle('is-favorite', Boolean(track?.isFavorite));
    this.els.playerFavorite.disabled = !track;
    this.els.playerToggle.innerHTML = state.loading
      ? '<span class="spinner"></span>'
      : icon(state.playing ? 'pause' : 'play', 19);
    this.els.playerPrevious.innerHTML = icon('previous', 19);
    this.els.playerNext.innerHTML = icon('next', 19);
    this.els.playerShuffle.innerHTML = icon('shuffle', 17);
    this.els.playerShuffle.classList.toggle('is-active', state.shuffle);
    this.els.playerRepeat.innerHTML = icon(state.repeatMode === 'one' ? 'repeatOne' : 'repeat', 17);
    this.els.playerRepeat.classList.toggle('is-active', state.repeatMode !== 'off');
    this.els.playerLyrics.innerHTML = icon('lyrics', 18);
    this.els.playerLyrics.classList.toggle('is-active', this.store.get().route.name === 'lyrics');
    this.els.playerVolumeIcon.innerHTML = icon(state.muted || state.volume === 0 ? 'mute' : 'volume', 18);
    this.els.playerQueue.innerHTML = icon('queue', 19);
    this.els.playerQueue.classList.toggle('is-active', this.store.get().queueOpen);
    this.els.playerVolume.value = Math.round((state.muted ? 0 : state.volume) * 100);
    this.#setRangeProgress(this.els.playerVolume, Number(this.els.playerVolume.value));

    this.#renderPlayerProgress();
  }

  #renderPlayerProgress() {
    const state = this.player.state;
    const duration = Number(state.duration || trackDuration(state.track) || 0);
    const current = Math.min(Number(state.currentTime || 0), duration || Infinity);
    this.els.playerCurrent.textContent = formatDuration(current);
    this.els.playerDuration.textContent = formatDuration(duration);
    this.els.playerProgress.value = duration > 0 ? Math.round((current / duration) * 1000) : 0;
    this.#setRangeProgress(this.els.playerProgress, Number(this.els.playerProgress.value) / 10);
  }

  #toggleQueue() {
    const open = !this.store.get().queueOpen;
    this.store.set({ queueOpen: open }, 'queue-panel');
    this.els.shell.classList.toggle('queue-open', open);
    this.#renderQueue();
    api.setSetting('queuePanelOpen', open).catch(() => {});
    this.#renderPlayer();
  }

  #renderQueue() {
    if (!this.store.get().queueOpen) {
      if (this.els.queue.childElementCount) this.els.queue.replaceChildren();
      return;
    }
    const state = this.player.state;
    const windowed = queueRenderWindow(state.queue, state.index, MAX_QUEUE_ROWS);
    this.els.queue.innerHTML = `
      <div class="queue-inner">
        <div class="queue-header">
          <div><h2>播放队列</h2><span>${state.queue.length} 首歌曲</span></div>
          ${state.queue.length ? `<button class="text-button" data-action="clear-queue">清空</button>` : ''}
        </div>
        <div class="queue-list">
          ${windowed.items.map(({ track, index }) => {
            const coverId = track.coverId || track.album?.coverId;
            return `
              <div class="queue-row ${index === state.index ? 'is-active' : ''}" data-queue-index="${index}">
                ${imageHtml(coverId, track.title, 'queue-row-cover', 128)}
                <div class="queue-row-copy">
                  <div class="queue-row-title">${escapeHtml(track.title || '未知标题')}</div>
                  <div class="queue-row-artist">${escapeHtml(artistsText(track))}</div>
                </div>
                <button class="icon-button subtle" data-action="remove-queue" data-index="${index}" aria-label="移除">${icon('close', 15)}</button>
              </div>
            `;
          }).join('') || '<div class="empty-state"><strong>队列是空的</strong><span>双击歌曲开始播放</span></div>'}
          ${windowed.omitted ? `<div class="queue-window-note">队列较长，仅显示第 ${windowed.start + 1}–${windowed.end} 首；当前播放项始终保留在窗口内。</div>` : ''}
        </div>
      </div>
    `;
  }

  #renderLyricsPage() {
    this.els.content.innerHTML = lyricsView(this.player.state);
    this.#syncLyrics(true);
  }

  #syncLyrics(force = false) {
    if (this.store.get().route.name !== 'lyrics') return;
    const index = this.player.state.activeLyric;
    const active = this.els.content.querySelector('.lyric-line.is-active');
    if (active && Number(active.dataset.lyricIndex) !== index) active.classList.remove('is-active');
    const next = this.els.content.querySelector(`[data-lyric-index="${index}"]`);
    if (next) {
      next.classList.add('is-active');
      if (force || !isElementCentered(next)) {
        next.scrollIntoView({ behavior: force ? 'auto' : 'smooth', block: 'center' });
      }
    }
  }

  #handleTrackAction(action, track, context, index, event) {
    if (action === 'play') this.player.setQueue(context, index);
    if (action === 'favorite' || action === 'unfavorite') this.#toggleFavorite(track);
    if (action === 'more') this.#showTrackContext(event, track, context, index);
  }

  #showTrackContext(event, track, context, index) {
    this.contextTrack = track;
    this.contextContext = context;
    this.contextIndex = index;
    const favoriteLabel = track.isFavorite ? '取消收藏' : '收藏';
    this.els.context.innerHTML = `
      <div class="context-menu" style="left:${Math.min(event.clientX, innerWidth - 210)}px;top:${Math.min(event.clientY, innerHeight - 215)}px">
        <button data-action="context-play">${icon('play', 16)}播放</button>
        <button data-action="context-next">${icon('next', 16)}下一首播放</button>
        <button data-action="context-queue">${icon('queue', 16)}加入播放队列</button>
        <hr>
        <button data-action="context-favorite">${icon(track.isFavorite ? 'heartFill' : 'heart', 16)}${favoriteLabel}</button>
        <button data-action="context-playlist">${icon('playlist', 16)}添加到歌单</button>
      </div>
    `;
  }

  #hideContextMenu() {
    this.els.context.innerHTML = '';
  }

  async #toggleFavorite(track) {
    if (!track?.guid) return;
    try {
      if (track.isFavorite) {
        await api.music('unfavorite', { trackGUID: track.guid });
        track.isFavorite = false;
        this.toast('已取消收藏', 'success');
      } else {
        await api.music('favorite', { trackGUID: track.guid });
        track.isFavorite = true;
        this.toast('已加入我喜欢的音乐', 'success');
      }
      this.currentTable?.render();
      this.#renderPlayer();
      this.cache.delete('favorites:{}');
    } catch (error) {
      this.toast(error.message, 'error');
    }
  }

  #showPlaylistPicker(tracks) {
    this.pendingPlaylistTracks = tracks.filter(Boolean);
    this.els.modal.innerHTML = playlistModal(this.store.get().playlists, this.pendingPlaylistTracks);
  }

  async #addPendingToPlaylist(playlistGUID) {
    try {
      await api.music('addToPlaylist', {
        playlistGUID,
        trackGUIDs: this.pendingPlaylistTracks.map((track) => track.guid)
      });
      this.#closeModal();
      this.toast('已添加到歌单', 'success');
      this.cache.delete(`playlist:{"guid":"${playlistGUID}"}`);
    } catch (error) {
      this.toast(error.message, 'error');
    }
  }

  #showCreatePlaylist() {
    this.els.modal.innerHTML = promptModal({
      title: '新建歌单',
      label: '歌单名称',
      action: 'create-playlist-submit',
      description: '歌单将直接创建在你的飞牛音乐服务中。'
    });
    setTimeout(() => this.els.modal.querySelector('input')?.focus(), 0);
  }

  async #createPlaylist(name) {
    try {
      const pendingTracks = [...this.pendingPlaylistTracks];
      const created = await api.music('createPlaylist', { name });
      const playlists = await this.#fetchAll('getPlaylists', {}, 200, 5000);
      this.store.set({ playlists }, 'playlists');
      this.#closeModal();
      this.#renderChrome();
      this.toast('歌单已创建', 'success');
      if (pendingTracks.length && created?.guid) {
        this.pendingPlaylistTracks = pendingTracks;
        await this.#addPendingToPlaylist(created.guid);
      }
    } catch (error) {
      this.toast(error.message, 'error');
    }
  }

  #showEditPlaylist(item) {
    this.editingPlaylist = item;
    this.els.modal.innerHTML = promptModal({
      title: '编辑歌单',
      label: '歌单名称',
      value: item.name || '',
      action: 'edit-playlist-submit'
    });
    setTimeout(() => this.els.modal.querySelector('input')?.focus(), 0);
  }

  async #editPlaylist(name) {
    if (!this.editingPlaylist?.guid) return;
    try {
      await api.music('editPlaylist', { guid: this.editingPlaylist.guid, name });
      this.editingPlaylist.name = name;
      const playlists = await this.#fetchAll('getPlaylists', {}, 200, 5000);
      this.store.set({ playlists }, 'playlists');
      this.cache.delete(routeKey(this.store.get().route));
      this.#closeModal();
      this.#renderChrome();
      await this.#loadRoute(this.store.get().route, { force: true });
      this.toast('歌单已更新', 'success');
    } catch (error) {
      this.toast(error.message, 'error');
    }
  }

  #closeModal() {
    this.els.modal.innerHTML = '';
    this.pendingPlaylistTracks = [];
  }

  #findKnownItem(kind, guid) {
    if (kind === 'playlist') {
      return this.store.get().playlists.find((item) => item.guid === guid) || null;
    }
    const direct = this.currentItems.find((item) => item.guid === guid);
    if (direct) return direct;
    for (const value of this.cache.values()) {
      const lists = [
        value?.list,
        value?.albums?.list,
        value?.artists?.list,
        value?.playlists?.list
      ];
      for (const list of lists) {
        const found = list?.find((item) => item.guid === guid);
        if (found) return found;
      }
    }
    return null;
  }

  #findTrack(guid) {
    const direct = this.currentTracks.find((track) => track.guid === guid);
    if (direct) return direct;
    for (const value of this.cache.values()) {
      const lists = [
        value?.list,
        value?.tracks,
        value?.tracks?.list,
        value?.history?.list,
        value?.favorites?.list
      ];
      for (const list of lists) {
        const found = list?.find((track) => track.guid === guid);
        if (found) return found;
      }
    }
    return this.player.queue.find((track) => track.guid === guid) || null;
  }

  #currentPlayableContext(track) {
    if (this.currentTracks.some((item) => item.guid === track.guid)) return this.currentTracks;
    const home = this.cache.get('home:{}');
    for (const key of ['history', 'favorites']) {
      const list = home?.[key]?.list || [];
      if (list.some((item) => item.guid === track.guid)) return list;
    }
    return [track];
  }

  #applyTheme(theme) {
    const resolved = theme === 'system' ? (this.systemDark ? 'dark' : 'light') : theme;
    document.documentElement.dataset.theme = resolved || 'dark';
  }

  #setMaximizeIcon(maximized) {
    const iconRoot = document.querySelector('#maximize-icon');
    if (!iconRoot) return;
    iconRoot.innerHTML = maximized
      ? '<path d="M3.5 1.5h7v7M1.5 3.5h7v7h-7z" fill="none" stroke="currentColor"></path>'
      : '<rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor"></rect>';
  }

  #setRangeProgress(element, percent) {
    element.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, percent))}%`);
  }

  toast(message, type = 'success', title = null) {
    const row = document.createElement('div');
    row.className = `toast ${type}`;
    row.innerHTML = `
      ${icon(type === 'error' ? 'warning' : type === 'warning' ? 'warning' : 'check', 18)}
      <div><strong>${escapeHtml(title || (type === 'error' ? '操作失败' : type === 'warning' ? '提示' : '完成'))}</strong><span>${escapeHtml(message)}</span></div>
    `;
    this.els.toasts.appendChild(row);
    setTimeout(() => {
      row.style.opacity = '0';
      row.style.transform = 'translateX(12px)';
      row.style.transition = '160ms ease';
      setTimeout(() => row.remove(), 170);
    }, 3200);
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sessionKey(session) {
  if (!session) return '';
  return String(session.id || `${session.username || ''}@${session.serverUrl || session.fnId || ''}`);
}

function queueRenderWindow(queue, currentIndex, limit) {
  const list = Array.isArray(queue) ? queue : [];
  const size = Math.max(1, Number(limit || MAX_QUEUE_ROWS));
  if (list.length <= size) {
    return {
      start: 0,
      end: list.length,
      omitted: false,
      items: list.map((track, index) => ({ track, index }))
    };
  }
  const safeIndex = Math.max(0, Math.min(list.length - 1, Number(currentIndex || 0)));
  let start = Math.max(0, safeIndex - Math.floor(size / 2));
  start = Math.min(start, list.length - size);
  const end = Math.min(list.length, start + size);
  return {
    start,
    end,
    omitted: true,
    items: list.slice(start, end).map((track, offset) => ({ track, index: start + offset }))
  };
}

function normalizePage(value) {
  const page = Number.parseInt(String(value || 1), 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function normalizePageResult(result, requestedPage, pageSize) {
  const list = Array.isArray(result?.list) ? result.list : [];
  const total = Math.max(0, Number(result?.total || list.length));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(normalizePage(requestedPage), pages);
  return {
    list,
    pagination: {
      page,
      pageSize,
      total,
      pages,
      start: total ? (page - 1) * pageSize + 1 : 0,
      end: total ? Math.min(total, (page - 1) * pageSize + list.length) : 0
    }
  };
}

function pageSummary(pagination, unit) {
  const page = pagination || {};
  if (!page.total) return `0 ${unit}`;
  return `第 ${page.start}–${page.end} ${unit}，共 ${page.total} ${unit}`;
}

function routeKey(route) {
  return `${route.name}:${JSON.stringify(stripObjects(route.params || {}))}`;
}

function stripObjects(params) {
  const result = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === 'item') continue;
    result[key] = value;
  }
  return result;
}

function flattenHomeTracks(data) {
  const result = [];
  const seen = new Set();
  for (const list of [data?.history?.list, data?.favorites?.list]) {
    for (const track of list || []) {
      if (!track?.guid || seen.has(track.guid)) continue;
      seen.add(track.guid);
      result.push(track);
    }
  }
  return result;
}

function routeLoadingLabel(name) {
  return ({
    home: '正在准备首页…',
    tracks: '正在加载全部歌曲…',
    albums: '正在加载专辑…',
    artists: '正在加载歌手…',
    genres: '正在加载风格…',
    favorites: '正在加载收藏…',
    history: '正在加载播放记录…',
    search: '正在搜索音乐库…',
    playlist: '正在打开歌单…',
    album: '正在打开专辑…',
    artist: '正在打开歌手…',
    genre: '正在打开风格…'
  })[name] || '正在加载音乐库…';
}

function detailFallback(kind) {
  return ({ album: '未知专辑', artist: '未知歌手', genre: '未知风格', playlist: '未知歌单' })[kind] || '未知';
}

function isElementCentered(element) {
  const rect = element.getBoundingClientRect();
  return rect.top > innerHeight * 0.25 && rect.bottom < innerHeight * 0.75;
}

const app = new XtMusicApp();
app.init();
