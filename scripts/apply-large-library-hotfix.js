'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content.replace(/\r?\n/g, '\n'), 'utf8');
}

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`Missing patch anchor: ${label}`);
  const second = source.indexOf(search, index + search.length);
  if (second >= 0) throw new Error(`Patch anchor is not unique: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

function replaceRegex(source, pattern, replacement, label) {
  const matches = source.match(pattern);
  if (!matches) throw new Error(`Missing regex patch anchor: ${label}`);
  return source.replace(pattern, replacement);
}

function patchPackage() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.version = '0.3.5';
  pkg.description = 'Large-library performance hotfix with bounded pagination, stale-route disposal, and lazy cover loading.';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);
}

function patchApp() {
  const rel = 'src/renderer/app.js';
  let source = read(rel);

  source = replaceOnce(
    source,
    `const INITIAL_PLAYLIST_LIMIT = 120;
const INITIAL_PLAYLIST_TIMEOUT_MS = 8000;
const MAX_QUEUE_ROWS = 160;`,
    `const INITIAL_PLAYLIST_LIMIT = 120;
const INITIAL_PLAYLIST_TIMEOUT_MS = 8000;
const MAX_QUEUE_ROWS = 160;
const GRID_PAGE_SIZE = 72;
const TRACK_PAGE_SIZE = 400;
const DETAIL_TRACK_PAGE_SIZE = 400;`,
    'renderer constants'
  );

  source = replaceOnce(
    source,
    `  #showLogin(error = null, prefill = null) {
    this.requestSerial += 1;
    this.playlistLoadSerial += 1;
    this.sidebarSignature = '';
    const state = this.store.get();`,
    `  #showLogin(error = null, prefill = null) {
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
    const state = this.store.get();`,
    'login DOM disposal'
  );

  source = replaceRegex(
    source,
    /  async #fetchRouteData\(route\) \{[\s\S]*?\n  async #detailData\(kind, params\) \{[\s\S]*?\n  async #fetchAll\(/,
    `  async #fetchRouteData(route) {
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

  async #fetchAll(`,
    'bounded route fetching'
  );

  source = replaceOnce(
    source,
    `      case 'tracks':
        this.#renderTrackRoute('所有歌曲', \`${data.list.length} 首来自飞牛音乐库的歌曲\`, data.list);
        break;
      case 'favorites':
        this.#renderTrackRoute('我喜欢的音乐', \`${data.list.length} 首已收藏歌曲\`, data.list);
        break;
      case 'history':
        this.#renderTrackRoute('最近播放', \`${data.list.length} 条播放记录\`, data.list);
        break;`,
    `      case 'tracks':
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
        break;`,
    'track route rendering'
  );

  source = replaceOnce(
    source,
    `      case 'albums':
        this.currentItems = data.list;
        this.els.content.innerHTML = gridPageView({
          title: '专辑',
          subtitle: \`${data.list.length} 张专辑\`,
          items: data.list,
          kind: 'album',
          total: data.list.length
        });
        break;
      case 'artists':
        this.currentItems = data.list;
        this.els.content.innerHTML = gridPageView({
          title: '歌手',
          subtitle: \`${data.list.length} 位歌手\`,
          items: data.list,
          kind: 'artist',
          total: data.list.length,
          iconName: 'artist'
        });
        break;
      case 'genres':
        this.currentItems = data.list;
        this.els.content.innerHTML = gridPageView({
          title: '风格',
          subtitle: \`${data.list.length} 个音乐风格\`,
          items: data.list,
          kind: 'genre',
          total: data.list.length,
          iconName: 'genre'
        });
        break;`,
    `      case 'albums':
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
        break;`,
    'grid route rendering'
  );

  source = replaceOnce(
    source,
    `        this.els.content.innerHTML = detailView({
          kind: route.name,
          item: data.item,
          tracks: data.tracks
        });`,
    `        this.els.content.innerHTML = detailView({
          kind: route.name,
          item: data.item,
          tracks: data.tracks,
          pagination: data.pagination
        });`,
    'detail pagination rendering'
  );

  source = replaceOnce(
    source,
    `  #renderTrackRoute(title, subtitle, tracks) {
    this.currentTracks = tracks;
    this.els.content.innerHTML = trackPageView({ title, subtitle, tracks });
    this.#mountTrackTable(tracks);
  }`,
    `  #renderTrackRoute(title, subtitle, tracks, pagination = null, actionLabel = null) {
    this.currentTracks = tracks;
    this.els.content.innerHTML = trackPageView({
      title,
      subtitle,
      tracks,
      pagination,
      actionLabel
    });
    this.#mountTrackTable(tracks);
  }`,
    'track route pagination rendering'
  );

  source = replaceOnce(
    source,
    `  #navigate(name, params = {}) {`,
    `  async #changeLibraryPage(rawPage) {
    const current = this.store.get().route;
    const page = normalizePage(rawPage);
    if (page === normalizePage(current.params?.page)) return;
    this.store.navigate(current.name, { ...current.params, page }, { replace: true });
    this.#renderChrome();
    await this.#loadRoute(this.store.get().route);
  }

  #navigate(name, params = {}) {`,
    'page navigation method'
  );

  source = replaceOnce(
    source,
    `      case 'refresh':
        this.cache.delete(routeKey(this.store.get().route));
        await this.#loadRoute(this.store.get().route, { force: true });
        break;`,
    `      case 'refresh':
        this.cache.delete(routeKey(this.store.get().route));
        await this.#loadRoute(this.store.get().route, { force: true });
        break;
      case 'library-page':
        await this.#changeLibraryPage(target.dataset.page);
        break;`,
    'pagination click action'
  );

  source = replaceOnce(
    source,
    `function routeKey(route) {`,
    `function normalizePage(value) {
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
  if (!page.total) return \`0 ${unit}\`;
  return \`第 ${page.start}–${page.end} ${unit}，共 ${page.total} ${unit}\`;
}

function routeKey(route) {`,
    'pagination helpers'
  );

  write(rel, source);
}

function patchViews() {
  const rel = 'src/renderer/views.js';
  let source = read(rel);

  source = replaceRegex(
    source,
    /export function gridPageView\([\s\S]*?\n\}\n\nexport function trackPageView\([\s\S]*?\n\}\n\nexport function detailView\(\{ kind, item, tracks \}\) \{/,
    `export function gridPageView({
  title,
  subtitle,
  items,
  kind,
  total = 0,
  pagination = null,
  iconName = 'album'
}) {
  return \`
    <div class="page library-page">
      <div class="page-heading">
        <div>
          <p class="eyebrow">音乐库</p>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle || \`${formatCount(total || items.length)} 项\`)}</p>
        </div>
        <div class="page-heading-actions">
          <button class="secondary-button compact" data-action="refresh">${icon('refresh', 16)}刷新</button>
        </div>
      </div>
      <div class="media-grid ${kind === 'artist' ? 'artist-grid' : ''}">
        ${items.map((item) => mediaCard(item, kind)).join('') || emptyState(iconName, \`没有${title}\`)}
      </div>
      ${paginationView(pagination)}
    </div>
  \`;
}

export function trackPageView({
  title,
  subtitle,
  tracks,
  kind = 'tracks',
  actionLabel = null,
  pagination = null
}) {
  return \`
    <div class="page tracks-page">
      <div class="page-heading track-page-heading">
        <div>
          <p class="eyebrow">音乐库</p>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle || \`${formatCount(tracks.length)} 首歌曲\`)}</p>
        </div>
        <div class="page-heading-actions">
          ${tracks.length ? \`
            <button class="primary-button compact" data-action="play-all">${icon('play', 16)}${escapeHtml(actionLabel || '播放全部')}</button>
            <button class="secondary-button compact" data-action="shuffle-all">${icon('shuffle', 16)}随机播放</button>
          \` : ''}
          <button class="secondary-button compact" data-action="refresh">${icon('refresh', 16)}刷新</button>
        </div>
      </div>
      ${tracks.length ? '<div id="track-table-host" class="track-table-host"></div>' : emptyState('music', '这里还没有歌曲')}
      ${paginationView(pagination)}
    </div>
  \`;
}

export function detailView({ kind, item, tracks, pagination = null }) {`,
    'paged grid/track/detail view signatures'
  );

  source = replaceOnce(
    source,
    `        ${tracks.length ? '<div id="track-table-host" class="track-table-host detail-table"></div>' : emptyState('music', '没有可播放的歌曲')}
      </section>`,
    `        ${tracks.length ? '<div id="track-table-host" class="track-table-host detail-table"></div>' : emptyState('music', '没有可播放的歌曲')}
        ${paginationView(pagination)}
      </section>`,
    'detail pagination markup'
  );

  source = replaceOnce(
    source,
    `function horizontalSection(title, route, items, kind) {`,
    `function paginationView(pagination) {
  if (!pagination || Number(pagination.pages || 1) <= 1) return '';
  const page = Math.max(1, Number(pagination.page || 1));
  const pages = Math.max(1, Number(pagination.pages || 1));
  const previous = Math.max(1, page - 1);
  const next = Math.min(pages, page + 1);
  return \`
    <nav class="library-pagination" aria-label="音乐库分页">
      <span>第 ${pagination.start || 0}–${pagination.end || 0} 项，共 ${pagination.total || 0} 项</span>
      <div class="library-pagination-actions">
        <button class="secondary-button compact" data-action="library-page" data-page="1" ${page <= 1 ? 'disabled' : ''}>${icon('chevronLeft', 15)}首页</button>
        <button class="secondary-button compact" data-action="library-page" data-page="${previous}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        <strong>${page} / ${pages}</strong>
        <button class="secondary-button compact" data-action="library-page" data-page="${next}" ${page >= pages ? 'disabled' : ''}>下一页</button>
        <button class="secondary-button compact" data-action="library-page" data-page="${pages}" ${page >= pages ? 'disabled' : ''}>末页${icon('chevronRight', 15)}</button>
      </div>
    </nav>
  \`;
}

function horizontalSection(title, route, items, kind) {`,
    'pagination view helper'
  );

  write(rel, source);
}

function patchStyles() {
  const rel = 'src/renderer/styles.css';
  let source = read(rel);
  const marker = `
.library-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin: 26px 0 8px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--panel) 90%, transparent);
}

.library-pagination > span {
  color: var(--muted);
  font-size: 13px;
}

.library-pagination-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.library-pagination-actions strong {
  min-width: 72px;
  text-align: center;
  color: var(--text);
  font-size: 13px;
}

.library-pagination button:disabled {
  opacity: 0.38;
  pointer-events: none;
}

@media (max-width: 900px) {
  .library-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .library-pagination-actions {
    width: 100%;
    flex-wrap: wrap;
  }
}
`;
  if (!source.includes('.library-pagination {')) source += marker;
  write(rel, source);
}

function patchDiagnosticsTest() {
  const rel = 'tests/large-library-pagination.test.js';
  const content = `'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const viewsSource = fs.readFileSync(path.join(root, 'src/renderer/views.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');

test('large top-level libraries fetch only the requested bounded page', () => {
  assert.match(appSource, /GRID_PAGE_SIZE = 72/);
  assert.match(appSource, /TRACK_PAGE_SIZE = 400/);
  assert.match(appSource, /getAlbums', \\{ page, size: GRID_PAGE_SIZE \\}/);
  assert.match(appSource, /getTracks', \\{ page, size: TRACK_PAGE_SIZE \\}/);
  assert.doesNotMatch(appSource, /case 'albums':[\\s\\S]{0,180}#fetchAll/);
  assert.doesNotMatch(appSource, /case 'tracks':[\\s\\S]{0,180}#fetchAll/);
});

test('route pagination and hidden-library disposal are wired', () => {
  assert.match(appSource, /case 'library-page'/);
  assert.match(appSource, /#changeLibraryPage/);
  assert.match(appSource, /this\\.els\\.content\\.replaceChildren\\(\\)/);
  assert.match(viewsSource, /function paginationView/);
  assert.match(viewsSource, /data-action="library-page"/);
  assert.match(stylesSource, /\\.library-pagination/);
});
`;
  write(rel, content);
}

function patchLargeLibrarySmoke() {
  write('scripts/windows-large-library-preload.js', `'use strict';

const { contextBridge } = require('electron');

const albums = Array.from({ length: 1595 }, (_value, index) => ({
  guid: \`album-\${index + 1}\`,
  name: \`专辑 \${index + 1}\`,
  coverId: null,
  trackCount: 10 + (index % 15)
}));
const artists = Array.from({ length: 1005 }, (_value, index) => ({
  guid: \`artist-\${index + 1}\`,
  name: \`歌手 \${index + 1}\`,
  coverId: null,
  trackCount: 20 + (index % 30)
}));
const tracks = Array.from({ length: 4219 }, (_value, index) => ({
  guid: \`track-\${index + 1}\`,
  title: \`歌曲 \${index + 1}\`,
  artists: [{ name: \`歌手 \${(index % 100) + 1}\` }],
  album: { name: \`专辑 \${(index % 200) + 1}\`, coverId: null },
  duration: 180,
  isFavorite: false
}));

const calls = [];
const noOpSubscription = () => () => {};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pageResult = (items, args = {}) => {
  const page = Math.max(1, Number(args.page || 1));
  const size = Math.max(1, Number(args.size || 100));
  const start = (page - 1) * size;
  return { list: items.slice(start, start + size), total: items.length };
};

contextBridge.exposeInMainWorld('xtMusicTest', Object.freeze({
  calls: () => calls.map((item) => ({ ...item }))
}));

contextBridge.exposeInMainWorld('xtMusic', Object.freeze({
  environment: Object.freeze({
    platform: 'win32',
    isLinux: false,
    isWayland: false,
    sessionType: '',
    mediaBaseUrl: null
  }),
  bootstrap: async () => ({
    session: {
      id: 'large-library-session',
      username: 'large-library-user',
      name: '大曲库测试',
      serverUrl: 'https://nas.invalid',
      relayMode: true
    },
    accounts: [],
    settings: {
      volume: 0.2,
      repeatMode: 'off',
      theme: 'dark',
      lastRoute: 'home',
      queuePanelOpen: false
    },
    encryptionAvailable: true,
    sessionError: null,
    mediaBaseUrl: null,
    version: '0.3.5'
  }),
  auth: Object.freeze({
    connect: async () => { throw new Error('not used'); },
    switchAccount: async () => { throw new Error('not used'); },
    logout: async () => ({ accounts: [] }),
    removeAccount: async () => ({ accounts: [] }),
    listAccounts: async () => []
  }),
  music: Object.freeze({
    call: async (method, args = {}) => {
      calls.push({
        method,
        page: Number(args.page || 0),
        size: Number(args.size || 0),
        at: Date.now()
      });
      if (method === 'getHome') {
        return {
          history: { list: tracks.slice(0, 18), total: 106 },
          albums: { list: albums.slice(0, 18), total: albums.length },
          artists: { list: artists.slice(0, 14), total: artists.length },
          playlists: { list: [], total: 0 },
          favorites: { list: [], total: 0 }
        };
      }
      if (method === 'getPlaylists') return { list: [], total: 0 };
      if (method === 'getAlbums') return pageResult(albums, args);
      if (method === 'getArtists') return pageResult(artists, args);
      if (method === 'getGenres') return { list: [], total: 0 };
      if (method === 'getTracks') {
        await delay(350);
        return pageResult(tracks, args);
      }
      if (method === 'getFavorites' || method === 'getHistory') {
        return pageResult(tracks.slice(0, 900), args);
      }
      if (method === 'getLyrics') return { text: '' };
      if (['reportPlay', 'favorite', 'unfavorite', 'quitTranscode'].includes(method)) return true;
      return { list: [], total: 0 };
    }
  }),
  settings: Object.freeze({
    get: async () => ({}),
    set: async (key, value) => ({ key, value })
  }),
  cache: Object.freeze({ clear: async () => true }),
  window: Object.freeze({
    minimize: async () => true,
    toggleMaximize: async () => false,
    close: async () => true,
    isMaximized: async () => false
  }),
  player: Object.freeze({
    publishState: () => {},
    diagnostics: async () => ({ running: false, recentErrors: [] })
  }),
  diagnostics: Object.freeze({
    log: () => {},
    copy: async () => true,
    openFolder: async () => true,
    snapshot: async () => true,
    info: async () => ({})
  }),
  events: Object.freeze({
    onAuthProgress: noOpSubscription,
    onPlayerCommand: noOpSubscription,
    onWindowMaximized: noOpSubscription,
    onSystemTheme: noOpSubscription
  })
}));
`);

  write('scripts/windows-large-library-smoke.js', `'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('disable-gpu');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'dist', 'renderer');
const proofDir = path.join(root, 'ui-proof');
let window;

app.whenReady().then(async () => {
  fs.mkdirSync(proofDir, { recursive: true });
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: path.join(root, 'scripts', 'windows-large-library-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      webSecurity: true
    }
  });

  await window.loadFile(path.join(rendererDir, 'index.html'));
  await waitFor(() => evaluate("Boolean(document.querySelector('.home-page'))"), 5000, 'home page');

  await evaluate("document.querySelector('[data-route=\\\"albums\\\"]')?.click()");
  await waitFor(() => evaluate("document.querySelectorAll('.library-page .media-card').length === 72"), 5000, 'bounded album page');

  const albumPageOne = await pageMetrics();
  assert(albumPageOne.cards === 72, \`Expected 72 album cards, got \${albumPageOne.cards}\`);
  assert(albumPageOne.nodes < 1800, \`Album DOM is too large: \${albumPageOne.nodes}\`);
  assert(albumPageOne.images <= 72, \`Album image count is too large: \${albumPageOne.images}\`);
  assert(albumPageOne.pager.includes('1 / 23'), \`Unexpected album pager: \${albumPageOne.pager}\`);

  let calls = await evaluate('window.xtMusicTest.calls()');
  assertCalls(calls, 'getAlbums', [1]);

  await evaluate("document.querySelector('[data-action=\\\"library-page\\\"][data-page=\\\"2\\\"]')?.click()");
  await waitFor(() => evaluate("document.querySelector('.library-pagination-actions strong')?.textContent.includes('2 / 23')"), 5000, 'second album page');
  const albumPageTwo = await pageMetrics();
  assert(albumPageTwo.cards === 72, \`Expected 72 cards on page 2, got \${albumPageTwo.cards}\`);
  assert(albumPageTwo.nodes < 1800, \`Second album page DOM is too large: \${albumPageTwo.nodes}\`);
  calls = await evaluate('window.xtMusicTest.calls()');
  assertCalls(calls, 'getAlbums', [1, 2]);

  await evaluate("document.querySelector('[data-route=\\\"tracks\\\"]')?.click()");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await evaluate("document.querySelector('[data-route=\\\"home\\\"]')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.home-page'))"), 5000, 'home after stale track request');
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert(await evaluate("Boolean(document.querySelector('.home-page'))"), 'Stale track response replaced the current route');

  calls = await evaluate('window.xtMusicTest.calls()');
  assertCalls(calls, 'getTracks', [1]);

  await evaluate("document.querySelector('[data-route=\\\"albums\\\"]')?.click()");
  await waitFor(() => evaluate("document.querySelectorAll('.library-page .media-card').length === 72"), 5000, 'cached bounded album page');
  await evaluate("document.querySelector('.account-summary')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('[data-action=\\\"add-account\\\"]'))"), 3000, 'account modal');
  await evaluate("document.querySelector('[data-action=\\\"add-account\\\"]')?.click()");
  await waitFor(() => evaluate("!document.querySelector('#login-root')?.classList.contains('is-hidden')"), 3000, 'add account login');

  const disposed = await evaluate(\`(() => ({
    nodes: document.querySelectorAll('*').length,
    contentChildren: document.querySelector('#content-root')?.childElementCount || 0,
    sidebarChildren: document.querySelector('#sidebar-root')?.childElementCount || 0,
    queueChildren: document.querySelector('#queue-panel')?.childElementCount || 0,
    images: document.images.length
  }))()\`);
  assert(disposed.contentChildren === 0, \`Hidden content was retained: \${disposed.contentChildren}\`);
  assert(disposed.sidebarChildren === 0, \`Hidden sidebar was retained: \${disposed.sidebarChildren}\`);
  assert(disposed.queueChildren === 0, \`Hidden queue was retained: \${disposed.queueChildren}\`);
  assert(disposed.nodes < 500, \`Login retained the large library DOM: \${disposed.nodes}\`);

  const eventLoopLagMs = await evaluate(\`new Promise((resolve) => {
    const start = performance.now();
    setTimeout(() => resolve(performance.now() - start), 0);
  })\`);
  assert(eventLoopLagMs < 250, \`Renderer event-loop lag is too high: \${eventLoopLagMs}ms\`);

  const proof = {
    verifiedAt: new Date().toISOString(),
    totals: { tracks: 4219, albums: 1595, artists: 1005 },
    albumPageOne,
    albumPageTwo,
    disposed,
    getAlbumPages: calls.filter((item) => item.method === 'getAlbums').map((item) => item.page),
    getTrackPages: calls.filter((item) => item.method === 'getTracks').map((item) => item.page),
    eventLoopLagMs
  };
  fs.writeFileSync(
    path.join(proofDir, 'windows-large-library-smoke.json'),
    \`\${JSON.stringify(proof, null, 2)}\\n\`,
    'utf8'
  );
  await shutdown(0);
}).catch(async (error) => {
  console.error(error);
  await shutdown(1);
});

async function pageMetrics() {
  return evaluate(\`(() => ({
    cards: document.querySelectorAll('.library-page .media-card').length,
    nodes: document.querySelectorAll('*').length,
    images: document.images.length,
    pager: document.querySelector('.library-pagination-actions strong')?.textContent.trim() || ''
  }))()\`);
}

function assertCalls(calls, method, expectedPages) {
  const pages = calls.filter((item) => item.method === method).map((item) => item.page);
  assert(
    JSON.stringify(pages) === JSON.stringify(expectedPages),
    \`\${method} pages were \${JSON.stringify(pages)}, expected \${JSON.stringify(expectedPages)}\`
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function evaluate(source) {
  return window.webContents.executeJavaScript(source);
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(\`Timed out waiting for \${label}\`);
}

async function shutdown(code) {
  try {
    if (window && !window.isDestroyed()) window.destroy();
    await app.whenReady();
  } finally {
    app.exit(code);
  }
}
`);

  const workflowRel = '.github/workflows/windows-playback-regression.yml';
  let workflow = read(workflowRel);
  workflow = replaceOnce(
    workflow,
    `      - name: Exercise delayed login, 5000 playlists and 2000-song queue
        run: npx electron scripts/windows-post-login-smoke.js

      - name: Build Windows installer and portable package`,
    `      - name: Exercise delayed login, 5000 playlists and 2000-song queue
        run: npx electron scripts/windows-post-login-smoke.js

      - name: Exercise bounded 4219-track and 1595-album libraries
        run: npx electron scripts/windows-large-library-smoke.js

      - name: Build Windows installer and portable package`,
    'large-library smoke workflow step'
  );
  workflow = replaceOnce(
    workflow,
    `          if (-not (Test-Path 'ui-proof/windows-post-login-smoke.json')) { throw 'Missing post-login responsiveness proof' }`,
    `          if (-not (Test-Path 'ui-proof/windows-post-login-smoke.json')) { throw 'Missing post-login responsiveness proof' }
          if (-not (Test-Path 'ui-proof/windows-large-library-smoke.json')) { throw 'Missing large-library proof' }`,
    'large-library proof verification'
  );
  workflow = replaceOnce(
    workflow,
    `            ui-proof/windows-post-login-smoke.json`,
    `            ui-proof/windows-post-login-smoke.json
            ui-proof/windows-large-library-smoke.json`,
    'large-library artifact upload'
  );
  write(workflowRel, workflow);
}


patchPackage();
patchApp();
patchViews();
patchStyles();
patchDiagnosticsTest();
patchLargeLibrarySmoke();

console.log('Applied XT Music 0.3.5 large-library pagination hotfix.');
