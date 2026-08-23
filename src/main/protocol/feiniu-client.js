'use strict';

const crypto = require('node:crypto');
const { HttpTransport } = require('./http-transport');
const { XtMusicError } = require('./errors');

const API_PREFIX = '/music/api/v1';

class FeiNiuClient {
  constructor(session, transport = new HttpTransport()) {
    this.transport = transport;
    this.configure(session);
  }

  configure(session) {
    this.baseUrl = normalizeBaseUrl(session.serverUrl);
    this.token = String(session.token || '');
    this.relayMode = Boolean(session.relayMode);
    this.accessCode = String(session.accessCode || '');
    this.allowSelfSigned = Boolean(session.allowSelfSigned);
    this.allowHttp = Boolean(session.allowHttp || this.baseUrl.startsWith('http://'));
    this.deviceId = session.deviceId || crypto.randomBytes(16).toString('hex');
  }

  sessionSnapshot() {
    return {
      serverUrl: this.baseUrl,
      token: this.token,
      relayMode: this.relayMode,
      accessCode: this.accessCode,
      allowSelfSigned: this.allowSelfSigned,
      allowHttp: this.allowHttp,
      deviceId: this.deviceId
    };
  }

  static hashPassword(password) {
    return crypto.createHash('sha256').update(String(password), 'utf8').digest('hex');
  }

  static generateDeviceId() {
    return crypto.randomBytes(16).toString('hex');
  }

  async requiresAccessCode() {
    const response = await this.transport.requestBuffer(`${this.baseUrl}/access_code_verify`, {
      method: 'GET',
      headers: this.relayMode ? { Cookie: 'mode=relay' } : {},
      timeoutMs: 10000,
      allowHttp: this.allowHttp,
      allowSelfSigned: this.allowSelfSigned,
      maxBytes: 256 * 1024
    });
    return response.statusCode === 401;
  }

  async verifyAccessCode(code = this.accessCode) {
    if (!code) return false;
    const response = await this.transport.requestBuffer(`${this.baseUrl}/access_code_verify`, {
      method: 'GET',
      headers: {
        ...(this.relayMode ? { Cookie: 'mode=relay' } : {}),
        'x-access-code': Buffer.from(String(code), 'utf8').toString('base64'),
        'x-access-source': 'app'
      },
      timeoutMs: 10000,
      allowHttp: this.allowHttp,
      allowSelfSigned: this.allowSelfSigned,
      maxBytes: 256 * 1024
    });
    return response.statusCode >= 200 && response.statusCode < 300;
  }

  async login(username, password) {
    const payload = await this.#api('/user/password-login', {
      method: 'POST',
      auth: false,
      body: {
        username: String(username),
        password: FeiNiuClient.hashPassword(password),
        deviceId: this.deviceId
      }
    });
    const data = assertSuccess(payload, '登录失败');
    const token = String(data.userToken || '');
    if (!token) {
      throw new XtMusicError('LOGIN_INVALID_RESPONSE', '登录成功响应中没有会话令牌');
    }
    this.token = token;
    const user = data.user || {};
    return {
      token,
      user: {
        username: String(user.name || username),
        guid: user.guid ? String(user.guid) : null,
        role: user.role ? String(user.role) : null
      }
    };
  }

  async validateSession() {
    if (!this.token) return false;
    try {
      await this.getTracks({ page: 1, size: 1 });
      return true;
    } catch (error) {
      if (error.code === 'SESSION_EXPIRED') return false;
      throw error;
    }
  }

  async getHome() {
    const [history, favorites, albums, playlists, artists] = await Promise.all([
      safe(() => this.getHistory({ page: 1, size: 18 }), emptyPage()),
      safe(() => this.getFavorites({ page: 1, size: 18 }), emptyPage()),
      safe(() => this.getAlbums({ page: 1, size: 18 }), emptyPage()),
      safe(() => this.getPlaylists({ page: 1, size: 12 }), emptyPage()),
      safe(() => this.getArtists({ page: 1, size: 14 }), emptyPage())
    ]);
    return { history, favorites, albums, playlists, artists };
  }

  getTracks({ page = 1, size = 200, sort = null } = {}) {
    return this.#page('/track/list', { page, size, ...(sort ? { sort } : {}) });
  }

  getAlbums({ page = 1, size = 100, sort = null } = {}) {
    return this.#page('/album/list', { page, size, ...(sort ? { sort } : {}) });
  }

  getArtists({ page = 1, size = 100 } = {}) {
    return this.#page('/artist/list', { page, size });
  }

  getGenres({ page = 1, size = 200, sort = null } = {}) {
    return this.#page('/genre/list', { page, size, ...(sort ? { sort } : {}) });
  }

  getPlaylists({ page = 1, size = 100 } = {}) {
    return this.#page('/playlist/list', { page, size });
  }

  getFavorites({ page = 1, size = 200, sort = null } = {}) {
    return this.#page('/favorite-track/list', {
      page,
      size,
      ...(sort ? { sort } : {})
    });
  }

  getHistory({ page = 1, size = 100 } = {}) {
    return this.#page('/play-history/list', { page, size });
  }

  getAlbumTracks({ albumGUID, page = 1, size = 500 }) {
    requireId(albumGUID, 'albumGUID');
    return this.#page('/track/album-detail/list', { albumGUID, page, size });
  }

  getArtistTracks({ artistGUID, page = 1, size = 500, sort = null }) {
    requireId(artistGUID, 'artistGUID');
    return this.#page('/track/artist-detail/list', {
      artistGUID,
      page,
      size,
      ...(sort ? { sort } : {})
    });
  }

  getGenreTracks({ genreGUID, page = 1, size = 500, sort = null }) {
    requireId(genreGUID, 'genreGUID');
    return this.#page('/track/genre-detail/list', {
      genreGUID,
      page,
      size,
      ...(sort ? { sort } : {})
    });
  }

  getPlaylistTracks({ playlistGUID, page = 1, size = 1000 }) {
    requireId(playlistGUID, 'playlistGUID');
    return this.#page('/track/playlist-detail/list', { playlistGUID, page, size });
  }

  async getTrackMetadata({ guid }) {
    requireId(guid, 'guid');
    const payload = await this.#api('/track/metadata', { query: { guid } });
    return assertSuccess(payload, '获取歌曲信息失败');
  }

  async search({ query, page = 1, size = 50 }) {
    const q = String(query || '').trim();
    if (!q) return { tracks: emptyPage(), albums: emptyPage(), artists: emptyPage() };
    const [tracks, albums, artists] = await Promise.all([
      safe(() => this.#page('/search/track', { q, keyword: q, page, size }), emptyPage()),
      safe(() => this.#page('/search/album', { q, keyword: q, page, size: Math.min(size, 50) }), emptyPage()),
      safe(() => this.#page('/search/artist', { q, keyword: q, page, size: Math.min(size, 50) }), emptyPage())
    ]);
    return { tracks, albums, artists };
  }

  async getLyrics({ trackGUID }) {
    requireId(trackGUID, 'trackGUID');
    const payload = await this.#api('/lyric/list', { query: { trackGUID } });
    const data = assertSuccess(payload, '获取歌词失败') || {};
    const list = Array.isArray(data.list) ? data.list : [];
    let preferred = null;
    if (data.preferred) {
      preferred = list.find((item) => item?.guid === data.preferred) || null;
    }
    return {
      list,
      preferred: preferred || list[0] || null,
      text: String((preferred || list[0] || {}).content || '')
    };
  }

  async favorite({ trackGUID }) {
    requireId(trackGUID, 'trackGUID');
    await this.#mutation('/favorite-track/create', { trackGUID }, '收藏失败');
    return true;
  }

  async unfavorite({ trackGUID }) {
    requireId(trackGUID, 'trackGUID');
    await this.#mutation('/favorite-track/delete', { trackGUID }, '取消收藏失败');
    return true;
  }

  async deleteHistory({ trackGUIDs }) {
    const ids = normalizeIds(trackGUIDs);
    if (!ids.length) return true;
    await this.#mutation('/play-history/delete', { trackGUIDs: ids }, '移出最近播放失败');
    return true;
  }

  async createPlaylist({ name, coverId = null }) {
    const playlistName = String(name || '').trim();
    if (!playlistName) throw new XtMusicError('NAME_REQUIRED', '请输入歌单名称');
    const payload = await this.#api('/playlist/create', {
      method: 'POST',
      body: { name: playlistName, ...(coverId ? { coverId } : {}) }
    });
    return assertSuccess(payload, '创建歌单失败');
  }

  async editPlaylist({ guid, name = null, coverId = null }) {
    requireId(guid, 'guid');
    const body = { guid };
    if (name != null) body.name = String(name).trim();
    if (coverId != null) body.coverId = coverId;
    await this.#mutation('/playlist/edit', body, '编辑歌单失败');
    return true;
  }

  async deletePlaylist({ guid }) {
    requireId(guid, 'guid');
    await this.#mutation('/playlist/delete', { guid }, '删除歌单失败');
    return true;
  }

  async addToPlaylist({ playlistGUID, trackGUIDs }) {
    requireId(playlistGUID, 'playlistGUID');
    const ids = normalizeIds(trackGUIDs);
    if (!ids.length) return true;
    await this.#mutation(
      '/playlist/add-track',
      { guid: playlistGUID, playlistGUID, trackGUIDs: ids },
      '添加歌曲失败'
    );
    return true;
  }

  async removeFromPlaylist({ playlistGUID, trackGUIDs }) {
    requireId(playlistGUID, 'playlistGUID');
    const ids = normalizeIds(trackGUIDs);
    if (!ids.length) return true;
    await this.#mutation(
      '/playlist/remove-track',
      { guid: playlistGUID, playlistGUID, trackGUIDs: ids },
      '移除歌曲失败'
    );
    return true;
  }

  async reportPlay({ trackGUID }) {
    requireId(trackGUID, 'trackGUID');
    try {
      await this.#api('/event/report', {
        method: 'POST',
        body: {
          events: [{
            eventType: 'track_play',
            occurredAt: Date.now(),
            payload: { trackGUID }
          }]
        }
      });
    } catch {
      // Playback telemetry is best-effort and goes only to the user's NAS.
    }
    return true;
  }

  async startTranscode({ guid, codec = 'mp3', channel = 2, bitrate = null }) {
    requireId(guid, 'guid');
    const output = { codec: String(codec || 'mp3'), channel: Number(channel) || 2 };
    if (bitrate && Number(bitrate) > 0) output.bitrate = Number(bitrate);
    const payload = await this.#api('/track/transcode', {
      method: 'POST',
      body: { guid, output }
    });
    const data = assertSuccess(payload, '启动服务器转码失败') || {};
    if (!data.url) throw new XtMusicError('TRANSCODE_URL_MISSING', '服务器没有返回转码地址');
    return {
      sourceUrl: new URL(String(data.url), `${this.baseUrl}/`).toString(),
      codec: output.codec
    };
  }

  async quitTranscode({ guid }) {
    requireId(guid, 'guid');
    try {
      await this.#api('/track/transcode/quit', {
        method: 'POST',
        body: { guid }
      });
    } catch {
      // Best effort.
    }
    return true;
  }

  streamUrl(guid) {
    requireId(guid, 'guid');
    return this.#url(`/track/stream?guid=${encodeURIComponent(guid)}`);
  }

  coverUrl(coverId, size = 800) {
    requireId(coverId, 'coverId');
    const normalizedSize = Math.max(48, Math.min(1600, Number(size) || 800));
    return this.#url(
      `/static/cover?coverId=${encodeURIComponent(coverId)}&size=${normalizedSize}`
    );
  }

  resourceHeaders(extra = {}) {
    return { ...this.#authHeaders(), ...extra };
  }

  resourceRequestOptions(extra = {}) {
    return {
      headers: this.resourceHeaders(extra.headers || {}),
      timeoutMs: extra.timeoutMs ?? 30000,
      allowHttp: this.allowHttp,
      allowSelfSigned: this.allowSelfSigned,
      maxRedirects: extra.maxRedirects ?? 5
    };
  }

  async #page(path, query) {
    const payload = await this.#api(path, { query });
    const data = assertSuccess(payload, '加载数据失败') || {};
    const list = Array.isArray(data.list) ? data.list : [];
    return {
      list,
      total: Number(data.total ?? list.length) || 0,
      sort: data.sort ?? null,
      page: Number(query.page || 1),
      size: Number(query.size || list.length)
    };
  }

  async #mutation(path, body, fallback) {
    const payload = await this.#api(path, { method: 'POST', body });
    assertSuccess(payload, fallback);
  }

  async #api(path, options = {}) {
    const method = options.method || 'GET';
    const url = new URL(this.#url(path));
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value == null) continue;
      url.searchParams.set(key, String(value));
    }
    const headers = options.auth === false
      ? this.#preAuthHeaders()
      : this.#authHeaders();
    const response = await this.transport.requestJson(url.toString(), {
      method,
      headers,
      body: options.body,
      timeoutMs: options.timeoutMs ?? 20000,
      allowHttp: this.allowHttp,
      allowSelfSigned: this.allowSelfSigned,
      maxRedirects: 5
    });
    const payload = response.data || {};
    if (response.statusCode === 401 || isSessionExpiredPayload(payload)) {
      throw new XtMusicError('SESSION_EXPIRED', '登录状态已失效，请重新登录');
    }
    if (response.statusCode >= 500) {
      throw new XtMusicError(
        'SERVER_ERROR',
        `飞牛音乐服务暂时不可用（HTTP ${response.statusCode}）`
      );
    }
    return payload;
  }

  #url(path) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${API_PREFIX}${cleanPath}`;
  }

  #preAuthHeaders() {
    return {
      ...(this.relayMode ? { Cookie: 'mode=relay' } : {}),
      ...this.#accessCodeHeaders()
    };
  }

  #authHeaders() {
    const cookies = [];
    if (this.token) cookies.push(`music-token=${this.token}`);
    if (this.relayMode) cookies.push('mode=relay');
    return {
      ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
      ...this.#accessCodeHeaders()
    };
  }

  #accessCodeHeaders() {
    if (!this.accessCode) return {};
    return {
      'x-access-code': Buffer.from(this.accessCode, 'utf8').toString('base64'),
      'x-access-source': 'app'
    };
  }
}

function assertSuccess(payload, fallback) {
  const code = Number(payload?.code ?? -1);
  if (code !== 0) {
    if (code === 120001) {
      throw new XtMusicError('INVALID_CREDENTIALS', '用户名或密码错误，请重试');
    }
    if (code === 401 || /invalid token/i.test(String(payload?.msg || ''))) {
      throw new XtMusicError('SESSION_EXPIRED', '登录状态已失效，请重新登录');
    }
    throw new XtMusicError(
      'API_ERROR',
      String(payload?.msg || fallback || '飞牛音乐接口返回错误'),
      { businessCode: code }
    );
  }
  return payload.data;
}

function isSessionExpiredPayload(payload) {
  return (
    Number(payload?.code) === 401 ||
    /invalid token/i.test(String(payload?.msg || ''))
  );
}

function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new XtMusicError('INVALID_URL', '服务器地址格式不正确');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new XtMusicError('INVALID_URL', '服务器地址仅支持 HTTP/HTTPS');
  }
  parsed.pathname = parsed.pathname.replace(/\/music\/api\/v1\/?$/i, '').replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

function requireId(value, name) {
  const text = String(value || '').trim();
  if (!text || text.length > 300) {
    throw new XtMusicError('INVALID_ARGUMENT', `${name} 参数不正确`);
  }
  return text;
}

function normalizeIds(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 5000)
    : [];
}

function emptyPage() {
  return { list: [], total: 0, page: 1, size: 0, sort: null };
}

async function safe(action, fallback) {
  try {
    return await action();
  } catch {
    return fallback;
  }
}

module.exports = {
  FeiNiuClient,
  assertSuccess,
  normalizeBaseUrl,
  emptyPage,
  API_PREFIX
};
