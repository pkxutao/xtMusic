'use strict';

const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function write(path, content) {
  fs.writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Unable to locate ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Expected a single occurrence of ${label}`);
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function patchPackage() {
  const path = 'package.json';
  const value = JSON.parse(read(path));
  value.version = '0.3.3';
  value.description = 'Windows responsiveness hotfix that removes post-login blocking, bounds hidden queue rendering, and restores stable cover caching.';
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function patchStore() {
  const path = 'src/renderer/store.js';
  let source = read(path);
  source = replaceOnce(
    source,
    "      playlists: [],\n      searchQuery: '',",
    "      playlists: [],\n      playlistTotal: 0,\n      searchQuery: '',",
    'playlistTotal store state'
  );
  write(path, source);
}

function patchUtils() {
  const path = 'src/renderer/utils.js';
  let source = read(path);
  source = replaceOnce(
    source,
    "export function coverUrl(coverId, size = 480) {\n  return coverId\n    ? mediaResourceUrl('cover', coverId, `?size=${Math.round(size)}`)\n    : '';\n}",
    "export function coverUrl(coverId, size = 480) {\n  if (!coverId) return '';\n  // Keep cover URLs stable so Chromium can reuse its disk cache across app\n  // launches. The random loopback base remains reserved for audio and HLS.\n  return `xtmusic://cover/${encodeURIComponent(String(coverId))}?size=${Math.round(size)}`;\n}",
    'stable cover URL'
  );
  source = replaceOnce(
    source,
    "  return `<img class=\"${className}\" src=\"${attr(coverUrl(coverId, size))}\" alt=\"${attr(alt)}\" loading=\"lazy\" decoding=\"async\" draggable=\"false\">`;",
    "  return `<img class=\"${className}\" src=\"${attr(coverUrl(coverId, size))}\" alt=\"${attr(alt)}\" loading=\"lazy\" decoding=\"async\" fetchpriority=\"low\" draggable=\"false\">`;",
    'low-priority cover loading'
  );
  write(path, source);
}

function patchViews() {
  const path = 'src/renderer/views.js';
  let source = read(path);
  source = replaceOnce(
    source,
    "} from './utils.js';\n\nexport function loginView",
    "} from './utils.js';\n\nconst MAX_SIDEBAR_PLAYLISTS = 120;\nconst MAX_PLAYLIST_PICKER_ITEMS = 500;\n\nexport function loginView",
    'playlist render limits'
  );
  source = replaceOnce(
    source,
    "export function sidebarView(state) {\n  const session = state.session || {};\n  const nav = [",
    "export function sidebarView(state) {\n  const session = state.session || {};\n  const playlists = Array.isArray(state.playlists) ? state.playlists : [];\n  const visiblePlaylists = playlists.slice(0, MAX_SIDEBAR_PLAYLISTS);\n  const playlistTotal = Math.max(Number(state.playlistTotal || 0), playlists.length);\n  const hiddenPlaylistCount = Math.max(0, playlistTotal - visiblePlaylists.length);\n  const nav = [",
    'bounded sidebar playlist state'
  );
  source = replaceOnce(
    source,
    "          ${(state.playlists || []).map((playlist) => `\n            <button class=\"nav-item nav-playlist ${current === 'playlist' && state.route.params?.guid === playlist.guid ? 'is-active' : ''}\"\n                    data-open-kind=\"playlist\"\n                    data-open-id=\"${attr(playlist.guid)}\">\n              ${icon('playlist', 18)}\n              <span title=\"${attr(playlist.name)}\">${escapeHtml(playlist.name)}</span>\n            </button>\n          `).join('') || '<div class=\"nav-empty\">还没有歌单</div>'}",
    "          ${visiblePlaylists.map((playlist) => `\n            <button class=\"nav-item nav-playlist ${current === 'playlist' && state.route.params?.guid === playlist.guid ? 'is-active' : ''}\"\n                    data-open-kind=\"playlist\"\n                    data-open-id=\"${attr(playlist.guid)}\">\n              ${icon('playlist', 18)}\n              <span title=\"${attr(playlist.name)}\">${escapeHtml(playlist.name)}</span>\n            </button>\n          `).join('') || '<div class=\"nav-empty\">还没有歌单</div>'}\n          ${hiddenPlaylistCount ? `<div class=\"nav-empty playlist-overflow-note\">另有 ${hiddenPlaylistCount} 个歌单按需加载</div>` : ''}",
    'bounded sidebar playlist markup'
  );
  source = replaceOnce(
    source,
    "export function playlistModal(playlists, tracks) {\n  return `",
    "export function playlistModal(playlists, tracks) {\n  const visiblePlaylists = (Array.isArray(playlists) ? playlists : []).slice(0, MAX_PLAYLIST_PICKER_ITEMS);\n  return `",
    'bounded playlist picker state'
  );
  source = replaceOnce(
    source,
    "          ${playlists.map((playlist) => `\n            <button class=\"selectable-row\" data-action=\"confirm-add-playlist\" data-id=\"${attr(playlist.guid)}\">",
    "          ${visiblePlaylists.map((playlist) => `\n            <button class=\"selectable-row\" data-action=\"confirm-add-playlist\" data-id=\"${attr(playlist.guid)}\">",
    'bounded playlist picker map'
  );
  write(path, source);
}

function patchPlayer() {
  const path = 'src/renderer/player.js';
  let source = read(path);
  source = replaceOnce(
    source,
    "const QUEUE_STORAGE_KEY = 'xtmusic.player.queue.v1';",
    "const QUEUE_STORAGE_KEY = 'xtmusic.player.queue.v1';\nconst MAX_PERSISTED_QUEUE = 500;",
    'persisted queue limit'
  );
  source = replaceOnce(
    source,
    "  #persist() {\n    const payload = {\n      queue: this.queue.slice(0, 2000),\n      index: this.index,\n      repeatMode: this.repeatMode,\n      shuffle: this.shuffle\n    };",
    "  #persist() {\n    const snapshot = persistentQueueSnapshot(this.queue, this.index);\n    const payload = {\n      queue: snapshot.queue,\n      index: snapshot.index,\n      repeatMode: this.repeatMode,\n      shuffle: this.shuffle\n    };",
    'windowed queue persistence'
  );
  source = replaceOnce(
    source,
    "    this.queue = uniqueTracks(saved.queue).slice(0, 2000);",
    "    this.queue = uniqueTracks(saved.queue).slice(0, MAX_PERSISTED_QUEUE);",
    'bounded queue restore'
  );
  source = replaceOnce(
    source,
    "function uniqueTracks(tracks) {",
    "function persistentQueueSnapshot(queue, index) {\n  const list = Array.isArray(queue) ? queue : [];\n  if (list.length <= MAX_PERSISTED_QUEUE) {\n    return { queue: list, index: list.length ? clamp(Number(index || 0), 0, list.length - 1) : -1 };\n  }\n  const safeIndex = clamp(Number(index || 0), 0, list.length - 1);\n  let start = Math.max(0, safeIndex - Math.floor(MAX_PERSISTED_QUEUE / 2));\n  start = Math.min(start, list.length - MAX_PERSISTED_QUEUE);\n  return {\n    queue: list.slice(start, start + MAX_PERSISTED_QUEUE),\n    index: safeIndex - start\n  };\n}\n\nfunction uniqueTracks(tracks) {",
    'persistent queue snapshot helper'
  );
  write(path, source);
}

function patchApp() {
  const path = 'src/renderer/app.js';
  let source = read(path);
  source = replaceOnce(
    source,
    "} from './utils.js';\n\nclass XtMusicApp {",
    "} from './utils.js';\n\nconst INITIAL_PLAYLIST_LIMIT = 120;\nconst INITIAL_PLAYLIST_TIMEOUT_MS = 8000;\nconst MAX_QUEUE_ROWS = 160;\n\nclass XtMusicApp {",
    'startup performance constants'
  );
  source = replaceOnce(
    source,
    "    this.requestSerial = 0;\n    this.currentTracks = [];",
    "    this.requestSerial = 0;\n    this.playlistLoadSerial = 0;\n    this.sidebarSignature = '';\n    this.currentTracks = [];",
    'startup render state'
  );
  source = replaceOnce(
    source,
    "      publishState: (state) => bridge.player.publishState(state),\n      onVolumeChange:",
    "      publishState: (state) => bridge.player.publishState(state),\n      diagnostics: () => bridge.player.diagnostics(),\n      onVolumeChange:",
    'player diagnostics bridge'
  );
  source = replaceOnce(
    source,
    "    for (const eventName of ['state', 'track', 'queue', 'progress']) {\n      this.player.addEventListener(eventName, () => this.#renderPlayer());\n    }",
    "    for (const eventName of ['state', 'track', 'queue']) {\n      this.player.addEventListener(eventName, () => this.#renderPlayer());\n    }\n    this.player.addEventListener('progress', () => this.#renderPlayerProgress());",
    'lightweight progress rendering'
  );
  source = replaceOnce(
    source,
    "  #showLogin(error = null, prefill = null) {\n    const state = this.store.get();",
    "  #showLogin(error = null, prefill = null) {\n    this.requestSerial += 1;\n    this.playlistLoadSerial += 1;\n    this.sidebarSignature = '';\n    const state = this.store.get();",
    'login load cancellation'
  );
  source = replaceOnce(
    source,
    "  async #enterSession(session) {\n    this.store.set({ session, error: null }, 'session');\n    this.els.loginRoot.classList.add('is-hidden');\n    this.els.shell.classList.remove('is-hidden');\n    this.#renderChrome();\n    this.#renderPlayer();\n    this.#renderQueue();\n    try {\n      const playlists = await this.#fetchAll('getPlaylists', {}, 200, 5000);\n      this.store.set({ playlists }, 'playlists');\n    } catch {\n      this.store.set({ playlists: [] }, 'playlists');\n    }\n    const last = this.store.get().settings.lastRoute || 'home';\n    const safeRoute = ['home', 'tracks', 'albums', 'artists', 'genres', 'favorites', 'history', 'settings'].includes(last)\n      ? last\n      : 'home';\n    this.store.navigate(safeRoute, {}, { replace: false, silent: true });\n    this.#renderChrome();\n    await this.#loadRoute(this.store.get().route);\n  }",
    "  async #enterSession(session) {\n    const playlistSerial = ++this.playlistLoadSerial;\n    this.sidebarSignature = '';\n    this.store.set({ session, error: null, playlists: [], playlistTotal: 0 }, 'session');\n    this.els.loginRoot.classList.add('is-hidden');\n    this.els.shell.classList.remove('is-hidden');\n    this.#renderPlayer();\n    this.#renderQueue();\n\n    const last = this.store.get().settings.lastRoute || 'home';\n    const safeRoute = ['home', 'tracks', 'albums', 'artists', 'genres', 'favorites', 'history', 'settings'].includes(last)\n      ? last\n      : 'home';\n    this.store.navigate(safeRoute, {}, { replace: false, silent: true });\n    this.#renderChrome();\n\n    // The first usable page is the critical path. Secondary playlist data is\n    // loaded only after that page has rendered.\n    await this.#loadRoute(this.store.get().route);\n    void this.#loadInitialPlaylists(session, playlistSerial);\n  }\n\n  async #loadInitialPlaylists(session, serial) {\n    try {\n      const result = await withTimeout(\n        api.music('getPlaylists', { page: 1, size: INITIAL_PLAYLIST_LIMIT }),\n        INITIAL_PLAYLIST_TIMEOUT_MS,\n        '歌单加载超时'\n      );\n      if (serial !== this.playlistLoadSerial) return;\n      if (sessionKey(this.store.get().session) !== sessionKey(session)) return;\n      const list = Array.isArray(result?.list) ? result.list.slice(0, INITIAL_PLAYLIST_LIMIT) : [];\n      const total = Math.max(Number(result?.total || 0), list.length);\n      this.store.set({ playlists: list, playlistTotal: total }, 'playlists');\n      this.#renderChrome();\n    } catch {\n      // Playlist navigation is optional; failure must not replace the usable page.\n    }\n  }",
    'non-blocking session entry'
  );
  source = replaceOnce(
    source,
    "  #renderChrome() {\n    const state = this.store.get();\n    if (!state.session) return;\n    this.els.sidebar.innerHTML = sidebarView(state);\n    this.els.titleAccount.innerHTML = `<span class=\"account-avatar\">${escapeHtml(initials(state.session.name || state.session.username))}</span>`;\n    this.els.back.disabled = state.historyIndex <= 0;\n    this.els.forward.disabled = state.historyIndex >= state.history.length - 1;\n    this.els.shell.classList.toggle('queue-open', Boolean(state.queueOpen));\n  }",
    "  #renderChrome() {\n    const state = this.store.get();\n    if (!state.session) return;\n    const visiblePlaylists = (state.playlists || []).slice(0, INITIAL_PLAYLIST_LIMIT);\n    const playlistSignature = visiblePlaylists\n      .map((item) => `${item.guid || ''}:${item.name || ''}`)\n      .join('\\u001f');\n    const signature = [\n      sessionKey(state.session),\n      state.route?.name || 'home',\n      state.route?.params?.guid || '',\n      state.playlistTotal || visiblePlaylists.length,\n      playlistSignature\n    ].join('\\u001e');\n    if (signature !== this.sidebarSignature) {\n      this.els.sidebar.innerHTML = sidebarView(state);\n      this.sidebarSignature = signature;\n    }\n    this.els.titleAccount.innerHTML = `<span class=\"account-avatar\">${escapeHtml(initials(state.session.name || state.session.username))}</span>`;\n    this.els.back.disabled = state.historyIndex <= 0;\n    this.els.forward.disabled = state.historyIndex >= state.history.length - 1;\n    this.els.shell.classList.toggle('queue-open', Boolean(state.queueOpen));\n  }",
    'memoized chrome rendering'
  );
  source = replaceOnce(
    source,
    "    const duration = Number(state.duration || trackDuration(track) || 0);\n    const current = Math.min(Number(state.currentTime || 0), duration || Infinity);\n    this.els.playerCurrent.textContent = formatDuration(current);\n    this.els.playerDuration.textContent = formatDuration(duration);\n    this.els.playerProgress.value = duration > 0 ? Math.round((current / duration) * 1000) : 0;\n    this.#setRangeProgress(this.els.playerProgress, Number(this.els.playerProgress.value) / 10);\n  }\n\n  #toggleQueue()",
    "    this.#renderPlayerProgress();\n  }\n\n  #renderPlayerProgress() {\n    const state = this.player.state;\n    const duration = Number(state.duration || trackDuration(state.track) || 0);\n    const current = Math.min(Number(state.currentTime || 0), duration || Infinity);\n    this.els.playerCurrent.textContent = formatDuration(current);\n    this.els.playerDuration.textContent = formatDuration(duration);\n    this.els.playerProgress.value = duration > 0 ? Math.round((current / duration) * 1000) : 0;\n    this.#setRangeProgress(this.els.playerProgress, Number(this.els.playerProgress.value) / 10);\n  }\n\n  #toggleQueue()",
    'separate progress renderer'
  );
  source = replaceOnce(
    source,
    "  #renderQueue() {\n    const state = this.player.state;\n    this.els.queue.innerHTML = `\n      <div class=\"queue-inner\">\n        <div class=\"queue-header\">\n          <div><h2>播放队列</h2><span>${state.queue.length} 首歌曲</span></div>\n          ${state.queue.length ? `<button class=\"text-button\" data-action=\"clear-queue\">清空</button>` : ''}\n        </div>\n        <div class=\"queue-list\">\n          ${state.queue.map((track, index) => {\n            const coverId = track.coverId || track.album?.coverId;\n            return `\n              <div class=\"queue-row ${index === state.index ? 'is-active' : ''}\" data-queue-index=\"${index}\">\n                ${imageHtml(coverId, track.title, 'queue-row-cover', 128)}\n                <div class=\"queue-row-copy\">\n                  <div class=\"queue-row-title\">${escapeHtml(track.title || '未知标题')}</div>\n                  <div class=\"queue-row-artist\">${escapeHtml(artistsText(track))}</div>\n                </div>\n                <button class=\"icon-button subtle\" data-action=\"remove-queue\" data-index=\"${index}\" aria-label=\"移除\">${icon('close', 15)}</button>\n              </div>\n            `;\n          }).join('') || '<div class=\"empty-state\"><strong>队列是空的</strong><span>双击歌曲开始播放</span></div>'}\n        </div>\n      </div>\n    `;\n  }",
    "  #renderQueue() {\n    if (!this.store.get().queueOpen) {\n      if (this.els.queue.childElementCount) this.els.queue.replaceChildren();\n      return;\n    }\n    const state = this.player.state;\n    const windowed = queueRenderWindow(state.queue, state.index, MAX_QUEUE_ROWS);\n    this.els.queue.innerHTML = `\n      <div class=\"queue-inner\">\n        <div class=\"queue-header\">\n          <div><h2>播放队列</h2><span>${state.queue.length} 首歌曲</span></div>\n          ${state.queue.length ? `<button class=\"text-button\" data-action=\"clear-queue\">清空</button>` : ''}\n        </div>\n        <div class=\"queue-list\">\n          ${windowed.items.map(({ track, index }) => {\n            const coverId = track.coverId || track.album?.coverId;\n            return `\n              <div class=\"queue-row ${index === state.index ? 'is-active' : ''}\" data-queue-index=\"${index}\">\n                ${imageHtml(coverId, track.title, 'queue-row-cover', 128)}\n                <div class=\"queue-row-copy\">\n                  <div class=\"queue-row-title\">${escapeHtml(track.title || '未知标题')}</div>\n                  <div class=\"queue-row-artist\">${escapeHtml(artistsText(track))}</div>\n                </div>\n                <button class=\"icon-button subtle\" data-action=\"remove-queue\" data-index=\"${index}\" aria-label=\"移除\">${icon('close', 15)}</button>\n              </div>\n            `;\n          }).join('') || '<div class=\"empty-state\"><strong>队列是空的</strong><span>双击歌曲开始播放</span></div>'}\n          ${windowed.omitted ? `<div class=\"queue-window-note\">队列较长，仅显示第 ${windowed.start + 1}–${windowed.end} 首；当前播放项始终保留在窗口内。</div>` : ''}\n        </div>\n      </div>\n    `;\n  }",
    'windowed queue renderer'
  );
  source = replaceOnce(
    source,
    "function routeKey(route) {",
    "function withTimeout(promise, timeoutMs, message) {\n  let timer;\n  const timeout = new Promise((_resolve, reject) => {\n    timer = setTimeout(() => reject(new Error(message)), timeoutMs);\n  });\n  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));\n}\n\nfunction sessionKey(session) {\n  if (!session) return '';\n  return String(session.id || `${session.username || ''}@${session.serverUrl || session.fnId || ''}`);\n}\n\nfunction queueRenderWindow(queue, currentIndex, limit) {\n  const list = Array.isArray(queue) ? queue : [];\n  const size = Math.max(1, Number(limit || MAX_QUEUE_ROWS));\n  if (list.length <= size) {\n    return {\n      start: 0,\n      end: list.length,\n      omitted: false,\n      items: list.map((track, index) => ({ track, index }))\n    };\n  }\n  const safeIndex = Math.max(0, Math.min(list.length - 1, Number(currentIndex || 0)));\n  let start = Math.max(0, safeIndex - Math.floor(size / 2));\n  start = Math.min(start, list.length - size);\n  const end = Math.min(list.length, start + size);\n  return {\n    start,\n    end,\n    omitted: true,\n    items: list.slice(start, end).map((track, offset) => ({ track, index: start + offset }))\n  };\n}\n\nfunction routeKey(route) {",
    'startup and queue helpers'
  );
  write(path, source);
}

function patchStyles() {
  const path = 'src/renderer/styles.css';
  let source = read(path);
  source += "\n\n/* v0.3.3 responsiveness guards */\n.queue-window-note {\n  padding: 10px 12px 14px;\n  color: var(--text-muted);\n  font-size: 12px;\n  line-height: 1.5;\n  text-align: center;\n}\n.playlist-overflow-note {\n  padding: 8px 12px;\n  line-height: 1.45;\n}\n@supports (content-visibility: auto) {\n  .home-section,\n  .media-card {\n    content-visibility: auto;\n  }\n  .home-section {\n    contain-intrinsic-size: 420px;\n  }\n  .media-card {\n    contain-intrinsic-size: 220px 180px;\n  }\n}\n";
  write(path, source);
}

patchPackage();
patchStore();
patchUtils();
patchViews();
patchPlayer();
patchApp();
patchStyles();

fs.rmSync('scripts/apply-windows-freeze-hotfix.js', { force: true });
fs.rmSync(__filename, { force: true });
console.log('Windows login freeze hotfix applied.');
