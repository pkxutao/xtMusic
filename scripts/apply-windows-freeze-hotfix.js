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

function ensureIncludes(source, value, label) {
  if (!source.includes(value)) throw new Error(`Missing ${label}`);
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
    "export function coverUrl(coverId, size = 480) {\n  if (!coverId) return '';\n  // Covers keep the stable custom-protocol URL so Chromium can reuse its disk\n  // cache across launches. The random loopback base is reserved for audio/HLS,\n  // where byte-range semantics are required for reliable playback.\n  return `xtmusic://cover/${encodeURIComponent(String(coverId))}?size=${Math.round(size)}`;\n}",
    'stable cover URL'
  );
  source = replaceOnce(
    source,
    "  return `<img class=\"${className}\" src=\"${attr(coverUrl(coverId, size))}\" alt=\"${attr(alt)}\" loading=\"lazy\" decoding=\"async\" draggable=\"false\">`;",
    "  return `<img class=\"${className}\" src=\"${attr(coverUrl(coverId, size))}\" alt=\"${attr(alt)}\" loading=\"lazy\" decoding=\"async\" fetchpriority=\"low\" draggable=\"false\">`;",
    'low-priority lazy cover loading'
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
    "export function playlistModal(playlists, tracks) {\n  const allPlaylists = Array.isArray(playlists) ? playlists : [];\n  const visiblePlaylists = allPlaylists.slice(0, MAX_PLAYLIST_PICKER_ITEMS);\n  const hiddenCount = Math.max(0, allPlaylists.length - visiblePlaylists.length);\n  return `",
    'bounded playlist picker state'
  );
  source = replaceOnce(
    source,
    "          ${playlists.map((playlist) => `\n            <button class=\"selectable-row\" data-action=\"confirm-add-playlist\" data-id=\"${attr(playlist.guid)}\">",
    "          ${visiblePlaylists.map((playlist) => `\n            <button class=\"selectable-row\" data-action=\"confirm-add-playlist\" data-id=\"${attr(playlist.guid)}\">",
    'bounded playlist picker map'
  );
  source = replaceOnce(
    source,
    "          `).join('') || '<div class=\"modal-empty\">还没有歌单，请先创建一个。</div>'}\n        </div>",
    "          `).join('') || '<div class=\"modal-empty\">还没有歌单，请先创建一个。</div>'}\n          ${hiddenCount ? `<div class=\"modal-empty compact\">歌单较多，为保持流畅仅显示前 ${MAX_PLAYLIST_PICKER_ITEMS} 个。</div>` : ''}\n        </div>",
    'playlist picker overflow note'
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
    "  async #enterSession(session) {\n    const playlistSerial = ++this.playlistLoadSerial;\n    this.sidebarSignature = '';\n    this.store.set({ session, error: null, playlists: [], playlistTotal: 0 }, 'session');\n    this.els.loginRoot.classList.add('is-hidden');\n    this.els.shell.classList.remove('is-hidden');\n    this.#renderPlayer();\n    this.#renderQueue();\n\n    const last = this.store.get().settings.lastRoute || 'home';\n    const safeRoute = ['home', 'tracks', 'albums', 'artists', 'genres', 'favorites', 'history', 'settings'].includes(last)\n      ? last\n      : 'home';\n    this.store.navigate(safeRoute, {}, { replace: false, silent: true });\n    this.#renderChrome();\n\n    // The page is the critical path. Do not wait for a potentially slow or very\n    // large playlist collection before showing the first usable screen.\n    await this.#loadRoute(this.store.get().route);\n    void this.#loadInitialPlaylists(session, playlistSerial);\n  }\n\n  async #loadInitialPlaylists(session, serial) {\n    try {\n      const result = await withTimeout(\n        api.music('getPlaylists', { page: 1, size: INITIAL_PLAYLIST_LIMIT }),\n        INITIAL_PLAYLIST_TIMEOUT_MS,\n        '歌单加载超时'\n      );\n      if (serial !== this.playlistLoadSerial) return;\n      if (sessionKey(this.store.get().session) !== sessionKey(session)) return;\n      const list = Array.isArray(result?.list) ? result.list.slice(0, INITIAL_PLAYLIST_LIMIT) : [];\n      const total = Math.max(Number(result?.total || 0), list.length);\n      this.store.set({ playlists: list, playlistTotal: total }, 'playlists');\n      this.#renderChrome();\n    } catch {\n      // Playlists are secondary navigation. A slow endpoint must never block or\n      // replace the already usable home/library page.\n    }\n  }",
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
  source += `\n\n/* v0.3.3 responsiveness guards */\n.queue-window-note {\n  padding: 10px 12px 14px;\n  color: var(--text-muted);\n  font-size: 12px;\n  line-height: 1.5;\n  text-align: center;\n}\n.playlist-overflow-note {\n  padding: 8px 12px;\n  line-height: 1.45;\n}\n@supports (content-visibility: auto) {\n  .home-section,\n  .media-card {\n    content-visibility: auto;\n  }\n  .home-section {\n    contain-intrinsic-size: 420px;\n  }\n  .media-card {\n    contain-intrinsic-size: 220px 180px;\n  }\n}\n`;
  write(path, source);
}

function writeTests() {
  write('tests/startup-performance.test.js', `'use strict';\n\nconst test = require('node:test');\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\n\nconst root = path.join(__dirname, '..');\nconst read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');\nconst app = read('src/renderer/app.js');\nconst views = read('src/renderer/views.js');\nconst utils = read('src/renderer/utils.js');\nconst player = read('src/renderer/player.js');\n\ntest('post-login route is rendered before secondary playlist loading', () => {\n  const start = app.indexOf('async #enterSession');\n  const end = app.indexOf('async #loadInitialPlaylists', start);\n  assert.ok(start >= 0 && end > start);\n  const body = app.slice(start, end);\n  assert.ok(body.indexOf('await this.#loadRoute') >= 0);\n  assert.ok(body.indexOf('void this.#loadInitialPlaylists') > body.indexOf('await this.#loadRoute'));\n  assert.doesNotMatch(body, /await this\\.#fetchAll\\('getPlaylists'/);\n});\n\ntest('closed and long queues cannot create an unbounded hidden DOM', () => {\n  assert.match(app, /if \\(!this\\.store\\.get\\(\\)\\.queueOpen\\)/);\n  assert.match(app, /queueRenderWindow\\(state\\.queue, state\\.index, MAX_QUEUE_ROWS\\)/);\n  assert.match(app, /const MAX_QUEUE_ROWS = 160/);\n  assert.match(player, /const MAX_PERSISTED_QUEUE = 500/);\n  assert.match(player, /persistentQueueSnapshot/);\n});\n\ntest('frequent progress events update only progress controls', () => {\n  assert.match(app, /addEventListener\\('progress', \\(\\) => this\\.#renderPlayerProgress\\(\\)\\)/);\n  assert.doesNotMatch(app, /\\['state', 'track', 'queue', 'progress'\\]/);\n});\n\ntest('sidebar and picker cap synchronous playlist markup', () => {\n  assert.match(views, /const MAX_SIDEBAR_PLAYLISTS = 120/);\n  assert.match(views, /visiblePlaylists = playlists\\.slice\\(0, MAX_SIDEBAR_PLAYLISTS\\)/);\n  assert.match(views, /const MAX_PLAYLIST_PICKER_ITEMS = 500/);\n});\n\ntest('cover URLs remain stable while audio keeps the loopback proxy', () => {\n  assert.match(utils, /xtmusic:\\/\\/cover\\//);\n  assert.match(utils, /return mediaResourceUrl\\('stream', guid\\)/);\n});\n`);
}

function writePostLoginPreload() {
  write('scripts/windows-post-login-preload.js', `'use strict';\n\nconst { contextBridge } = require('electron');\n\nconst playlistDelayMs = 3000;\nconst tracks = Array.from({ length: 2000 }, (_value, index) => ({\n  guid: \\`stress-track-\\${index + 1}\\`,\n  title: \\`曲目 \\${index + 1}\\`,\n  artists: [{ name: '性能测试歌手' }],\n  album: { name: '性能测试专辑' },\n  duration: 2,\n  audioSpec: { format: 'wav', codec: 'pcm', duration: 2 },\n  isFavorite: false\n}));\nconst playlists = Array.from({ length: 5000 }, (_value, index) => ({\n  guid: \\`stress-playlist-\\${index + 1}\\`,\n  name: \\`压力歌单 \\${index + 1}\\`,\n  trackCount: index % 40\n}));\nconst albums = Array.from({ length: 14 }, (_value, index) => ({\n  guid: \\`stress-album-\\${index + 1}\\`,\n  name: \\`专辑 \\${index + 1}\\`,\n  trackCount: 20\n}));\nconst artists = Array.from({ length: 14 }, (_value, index) => ({\n  guid: \\`stress-artist-\\${index + 1}\\`,\n  name: \\`歌手 \\${index + 1}\\`,\n  trackCount: 40\n}));\n\nconst mediaBaseUrl = String(process.env.XT_MUSIC_POST_LOGIN_MEDIA_BASE_URL || '');\nconst noOpSubscription = () => () => {};\nconst delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));\n\ncontextBridge.exposeInMainWorld('xtMusic', Object.freeze({\n  environment: Object.freeze({\n    platform: 'win32',\n    isLinux: false,\n    isWayland: false,\n    sessionType: '',\n    mediaBaseUrl\n  }),\n  bootstrap: async () => ({\n    session: {\n      id: 'stress-session',\n      username: 'stress-user',\n      name: '登录性能测试',\n      serverUrl: 'https://nas.invalid',\n      relayMode: true\n    },\n    accounts: [],\n    settings: { volume: 0.25, repeatMode: 'off', theme: 'dark', lastRoute: 'home' },\n    encryptionAvailable: true,\n    sessionError: null,\n    mediaBaseUrl,\n    version: '0.3.3'\n  }),\n  auth: Object.freeze({\n    connect: async () => { throw new Error('not used'); },\n    switchAccount: async () => { throw new Error('not used'); },\n    logout: async () => ({ accounts: [] }),\n    removeAccount: async () => ({ accounts: [] }),\n    listAccounts: async () => []\n  }),\n  music: Object.freeze({\n    call: async (method) => {\n      if (method === 'getHome') {\n        return {\n          history: { list: tracks.slice(0, 14), total: 14 },\n          albums: { list: albums, total: albums.length },\n          artists: { list: artists, total: artists.length },\n          playlists: { list: playlists.slice(0, 14), total: playlists.length },\n          favorites: { list: tracks.slice(14, 28), total: 14 }\n        };\n      }\n      if (method === 'getPlaylists') {\n        await delay(playlistDelayMs);\n        return { list: playlists, total: playlists.length };\n      }\n      if (method === 'getTracks') return { list: tracks, total: tracks.length };\n      if (method === 'getLyrics') return { text: '' };\n      if (['reportPlay', 'favorite', 'unfavorite', 'quitTranscode'].includes(method)) return true;\n      if (method === 'startTranscode') throw new Error('transcode should not be used');\n      return { list: [], total: 0 };\n    }\n  }),\n  settings: Object.freeze({\n    get: async () => ({}),\n    set: async (key, value) => ({ key, value })\n  }),\n  cache: Object.freeze({ clear: async () => true }),\n  window: Object.freeze({\n    minimize: async () => true,\n    toggleMaximize: async () => false,\n    close: async () => true,\n    isMaximized: async () => false\n  }),\n  player: Object.freeze({\n    publishState: () => {},\n    diagnostics: async () => ({ running: true, recentErrors: [] })\n  }),\n  events: Object.freeze({\n    onAuthProgress: noOpSubscription,\n    onPlayerCommand: noOpSubscription,\n    onWindowMaximized: noOpSubscription,\n    onSystemTheme: noOpSubscription\n  })\n}));\n`);
}

function writePostLoginSmoke() {
  write('scripts/windows-post-login-smoke.js', `'use strict';\n\nconst fs = require('node:fs');\nconst http = require('node:http');\nconst path = require('node:path');\nconst { app, BrowserWindow } = require('electron');\n\napp.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');\napp.commandLine.appendSwitch('disable-gpu');\n\nconst root = path.resolve(__dirname, '..');\nconst rendererDir = path.join(root, 'dist', 'renderer');\nconst proofDir = path.join(root, 'ui-proof');\nlet window;\nlet server;\n\napp.whenReady().then(async () => {\n  fs.mkdirSync(proofDir, { recursive: true });\n  const audio = createWavBuffer(22050, 2);\n  const media = await startMediaServer(audio);\n  server = media.server;\n  process.env.XT_MUSIC_POST_LOGIN_MEDIA_BASE_URL = media.baseUrl;\n\n  window = new BrowserWindow({\n    width: 1440,\n    height: 900,\n    show: false,\n    backgroundColor: '#0a0c10',\n    webPreferences: {\n      preload: path.join(root, 'scripts', 'windows-post-login-preload.js'),\n      contextIsolation: true,\n      nodeIntegration: false,\n      sandbox: true,\n      backgroundThrottling: false,\n      webSecurity: true\n    }\n  });\n\n  const started = Date.now();\n  await window.loadFile(path.join(rendererDir, 'index.html'));\n  await waitFor(() => window.webContents.executeJavaScript(\n    \\"Boolean(document.querySelector('.home-page'))\\"\n  ), 5000, 'home page');\n  const homeReadyMs = Date.now() - started;\n  if (homeReadyMs >= 2500) {\n    throw new Error(\\`Home waited for secondary playlists: \\${homeReadyMs}ms\\`);\n  }\n\n  await waitFor(() => window.webContents.executeJavaScript(\n    \\"document.querySelectorAll('.nav-playlist').length > 0\\"\n  ), 7000, 'background playlists');\n  const sidebarPlaylistRows = await window.webContents.executeJavaScript(\n    \\"document.querySelectorAll('.nav-playlist').length\\"\n  );\n  if (sidebarPlaylistRows > 120) {\n    throw new Error(\\`Sidebar rendered \\${sidebarPlaylistRows} playlist rows\\`);\n  }\n\n  await window.webContents.executeJavaScript(\n    \\"document.querySelector('[data-route=\\\"tracks\\\"]')?.click()\\"\n  );\n  await waitFor(() => window.webContents.executeJavaScript(\n    \\"Boolean(document.querySelector('.tracks-page [data-action=\\\"play-all\\\"]'))\\"\n  ), 5000, 'tracks page');\n  await window.webContents.executeJavaScript(\n    \\"document.querySelector('.tracks-page [data-action=\\\"play-all\\\"]')?.click()\\"\n  );\n  await waitFor(() => window.webContents.executeJavaScript(\n    \\"document.querySelector('#player-title')?.textContent === '曲目 1'\\"\n  ), 5000, 'large queue activation');\n\n  const queueClosedRows = await window.webContents.executeJavaScript(\n    \\"document.querySelectorAll('#queue-panel .queue-row').length\\"\n  );\n  if (queueClosedRows !== 0) {\n    throw new Error(\\`Closed queue rendered \\${queueClosedRows} hidden rows\\`);\n  }\n\n  await window.webContents.executeJavaScript(\n    \\"document.querySelector('#player-queue')?.click()\\"\n  );\n  await waitFor(() => window.webContents.executeJavaScript(\n    \\"document.querySelectorAll('#queue-panel .queue-row').length > 0\\"\n  ), 3000, 'windowed queue');\n  const queueMetrics = await window.webContents.executeJavaScript(\\`(() => ({\n    rows: document.querySelectorAll('#queue-panel .queue-row').length,\n    header: document.querySelector('#queue-panel .queue-header')?.innerText || '',\n    overflowNote: document.querySelector('#queue-panel .queue-window-note')?.innerText || ''\n  }))()\\`);\n  if (queueMetrics.rows > 160) {\n    throw new Error(\\`Open queue rendered \\${queueMetrics.rows} rows\\`);\n  }\n  if (!queueMetrics.header.includes('2000')) {\n    throw new Error(\\`Queue header lost the total: \\${queueMetrics.header}\\`);\n  }\n\n  const eventLoopLagMs = await window.webContents.executeJavaScript(\\`new Promise((resolve) => {\n    const start = performance.now();\n    setTimeout(() => resolve(performance.now() - start), 0);\n  })\\`);\n  if (eventLoopLagMs > 250) {\n    throw new Error(\\`Renderer event-loop lag is too high: \\${eventLoopLagMs}ms\\`);\n  }\n\n  await window.webContents.executeJavaScript(\n    \\"document.querySelector('[data-route=\\\"home\\\"]')?.click()\\"\n  );\n  await waitFor(() => window.webContents.executeJavaScript(\n    \\"Boolean(document.querySelector('.home-page'))\\"\n  ), 3000, 'responsive navigation after queue stress');\n\n  const proof = {\n    verifiedAt: new Date().toISOString(),\n    homeReadyMs,\n    delayedPlaylistEndpointMs: 3000,\n    sidebarPlaylistRows,\n    queueClosedRows,\n    queueOpenRows: queueMetrics.rows,\n    queueHeader: queueMetrics.header,\n    queueOverflowNote: queueMetrics.overflowNote,\n    eventLoopLagMs\n  };\n  fs.writeFileSync(\n    path.join(proofDir, 'windows-post-login-smoke.json'),\n    \\`\\${JSON.stringify(proof, null, 2)}\\n\\`,\n    'utf8'\n  );\n  await shutdown(0);\n}).catch(async (error) => {\n  console.error(error);\n  await shutdown(1);\n});\n\nasync function waitFor(check, timeoutMs, label) {\n  const deadline = Date.now() + timeoutMs;\n  while (Date.now() < deadline) {\n    if (await check()) return;\n    await new Promise((resolve) => setTimeout(resolve, 50));\n  }\n  throw new Error(\\`Timed out waiting for \\${label}\\`);\n}\n\nasync function startMediaServer(bytes) {\n  const secret = 'postLoginStressSecret_0123456789abcdef';\n  const server = http.createServer((request, response) => {\n    response.setHeader('Access-Control-Allow-Origin', '*');\n    response.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Content-Range, Accept-Ranges');\n    if (!String(request.url || '').startsWith(\\`/\\${secret}/stream/\\`)) {\n      response.statusCode = 404;\n      response.end();\n      return;\n    }\n    const range = /^bytes=(\\d+)-(\\d*)$/i.exec(String(request.headers.range || ''));\n    if (!range) {\n      response.statusCode = 200;\n      response.setHeader('Content-Type', 'audio/wav');\n      response.setHeader('Content-Length', String(bytes.length));\n      response.setHeader('Accept-Ranges', 'bytes');\n      if (request.method === 'HEAD') response.end();\n      else response.end(bytes);\n      return;\n    }\n    const start = Number(range[1]);\n    const end = Math.min(range[2] ? Number(range[2]) : bytes.length - 1, bytes.length - 1);\n    if (start >= bytes.length || end < start) {\n      response.statusCode = 416;\n      response.setHeader('Content-Range', \\`bytes */\\${bytes.length}\\`);\n      response.end();\n      return;\n    }\n    const body = bytes.subarray(start, end + 1);\n    response.statusCode = 206;\n    response.setHeader('Content-Type', 'audio/wav');\n    response.setHeader('Content-Length', String(body.length));\n    response.setHeader('Content-Range', \\`bytes \\${start}-\\${end}/\\${bytes.length}\\`);\n    response.setHeader('Accept-Ranges', 'bytes');\n    if (request.method === 'HEAD') response.end();\n    else response.end(body);\n  });\n  await new Promise((resolve, reject) => {\n    server.once('error', reject);\n    server.listen(0, '127.0.0.1', resolve);\n  });\n  const address = server.address();\n  return { server, baseUrl: \\`http://127.0.0.1:\\${address.port}/\\${secret}\\` };\n}\n\nfunction createWavBuffer(sampleRate, durationSeconds) {\n  const channels = 1;\n  const bitsPerSample = 16;\n  const sampleCount = sampleRate * durationSeconds;\n  const dataSize = sampleCount * channels * (bitsPerSample / 8);\n  const buffer = Buffer.alloc(44 + dataSize);\n  buffer.write('RIFF', 0);\n  buffer.writeUInt32LE(36 + dataSize, 4);\n  buffer.write('WAVE', 8);\n  buffer.write('fmt ', 12);\n  buffer.writeUInt32LE(16, 16);\n  buffer.writeUInt16LE(1, 20);\n  buffer.writeUInt16LE(channels, 22);\n  buffer.writeUInt32LE(sampleRate, 24);\n  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);\n  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);\n  buffer.writeUInt16LE(bitsPerSample, 34);\n  buffer.write('data', 36);\n  buffer.writeUInt32LE(dataSize, 40);\n  for (let index = 0; index < sampleCount; index += 1) {\n    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.15 * 32767);\n    buffer.writeInt16LE(sample, 44 + index * 2);\n  }\n  return buffer;\n}\n\nasync function shutdown(code) {\n  try {\n    window?.destroy();\n    if (server) await new Promise((resolve) => server.close(resolve));\n  } finally {\n    app.exit(code);\n  }\n}\n`);
}

function writeReleaseNotes() {
  fs.mkdirSync('releases', { recursive: true });
  write('releases/v0.3.3.md', `# XT Music v0.3.3 — Windows 登录后卡死修复\n\n此版本针对 v0.3.2 中“登录成功后首页卡住、窗口响应迟缓”的回归问题。\n\n## 修复\n\n- 首页和上次访问页面优先加载，不再等待最多 5000 个歌单全部返回。\n- 歌单改为后台、限量加载；侧边栏最多同步渲染 120 行。\n- 播放队列关闭时不再生成任何隐藏 DOM。\n- 长队列打开时只渲染当前播放项附近最多 160 行。\n- 启动恢复的队列快照从 2000 首降至 500 首，并围绕当前曲目保存。\n- 播放进度更新只刷新时间和进度条，不再反复重建封面和全部控制按钮。\n- 封面恢复稳定的 xtmusic:// 地址，重新获得跨启动磁盘缓存；随机本机 HTTP 代理只用于音频和 HLS。\n- 图片使用延迟加载、异步解码和低请求优先级。\n\n## 新增回归验证\n\nWindows Electron 会模拟：\n\n- 歌单接口延迟 3 秒；\n- 5000 个歌单；\n- 2000 首播放队列；\n- 登录后首页必须先于歌单接口显示；\n- 关闭队列必须为 0 个隐藏行；\n- 打开队列最多 160 行；\n- 压力后仍可立即切回首页。\n`);
}

patchPackage();
patchStore();
patchUtils();
patchViews();
patchPlayer();
patchApp();
patchStyles();
writeTests();
writePostLoginPreload();
writePostLoginSmoke();
writeReleaseNotes();

ensureIncludes(read('src/renderer/app.js'), 'void this.#loadInitialPlaylists(session, playlistSerial);', 'background playlist loading');
ensureIncludes(read('src/renderer/app.js'), 'if (!this.store.get().queueOpen)', 'closed queue guard');
ensureIncludes(read('src/renderer/utils.js'), 'xtmusic://cover/', 'stable cover protocol');

fs.rmSync(__filename, { force: true });
console.log('Windows login freeze hotfix applied.');
