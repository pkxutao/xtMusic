'use strict';

const { performance } = require('node:perf_hooks');
const { ipcMain, session } = require('electron');
const { normalizeError, XtMusicError } = require('./protocol/errors');

const MUSIC_METHODS = new Set([
  'getHome',
  'getTracks',
  'getAlbums',
  'getArtists',
  'getGenres',
  'getPlaylists',
  'getFavorites',
  'getHistory',
  'getAlbumTracks',
  'getArtistTracks',
  'getArtistAlbums',
  'getGenreTracks',
  'getPlaylistTracks',
  'getTrackMetadata',
  'search',
  'getLyrics',
  'favorite',
  'unfavorite',
  'deleteHistory',
  'createPlaylist',
  'editPlaylist',
  'deletePlaylist',
  'addToPlaylist',
  'removeFromPlaylist',
  'reportPlay',
  'startTranscode',
  'quitTranscode'
]);

let activeDiagnostics = null;

function registerIpc({
  runtime,
  sessionService,
  accountStore,
  settingsStore,
  hlsRegistry,
  mediaServer,
  diagnostics,
  getMainWindow
}) {
  activeDiagnostics = diagnostics || null;

  handle('app:bootstrap', async () => ({
    ...(await sessionService.bootstrap()),
    settings: settingsStore.all(),
    platform: process.platform,
    version: require('../../package.json').version,
    mediaBaseUrl: mediaServer?.baseUrl || null,
    diagnostics: diagnostics?.info?.() || null
  }));

  handle('auth:connect', async (event, payload) => {
    const sender = event.sender;
    return sessionService.connect(payload, (progress) => {
      diagnostics?.log('auth', 'auth:progress', {
        stage: progress?.stage,
        message: progress?.message
      }, 'debug');
      if (!sender.isDestroyed()) sender.send('auth:progress', progress);
    });
  });
  handle('auth:switch', async (_event, id) => sessionService.switchAccount(id));
  handle('auth:logout', async (_event, options) => sessionService.logout(options || {}));
  handle('auth:remove', async (_event, id) => sessionService.removeAccount(id));
  handle('auth:list', async () => sessionService.listAccounts());

  handle('music:call', async (_event, request) => {
    const method = String(request?.method || '');
    if (!MUSIC_METHODS.has(method)) {
      throw new XtMusicError('METHOD_NOT_ALLOWED', `不允许调用音乐方法 ${method}`);
    }
    const client = runtime.requireClient();
    const args = sanitizeArgs(request?.args);

    if (method === 'startTranscode') {
      const result = await client.startTranscode(args);
      const key = hlsRegistry.register(args.guid, result.sourceUrl);
      return {
        url: mediaServer?.hlsUrl(key) || `xtmusic://hls/${key}/index.m3u8`,
        codec: result.codec
      };
    }
    if (method === 'quitTranscode') {
      hlsRegistry.removeByGuid(args.guid);
    }
    return client[method](args);
  });

  handle('settings:get', async () => settingsStore.all());
  handle('settings:set', async (_event, { key, value } = {}) => ({
    key,
    value: settingsStore.set(String(key || ''), value)
  }));

  handle('player:diagnostics', async () => mediaServer?.diagnostics() || {
    running: false,
    origin: null,
    recentErrors: []
  });

  handle('diagnostics:info', async () => diagnostics?.info?.() || null);
  handle('diagnostics:copy', async () => diagnostics?.copyToClipboard?.() || {
    copied: false,
    reason: 'diagnostics unavailable'
  });
  handle('diagnostics:open-folder', async () => diagnostics?.openFolder?.() || {
    opened: false,
    reason: 'diagnostics unavailable'
  });
  handle('diagnostics:snapshot', async (_event, reason) => diagnostics?.snapshot?.({
    runtime,
    mediaServer,
    window: getMainWindow(),
    reason: String(reason || 'renderer-request').slice(0, 120)
  }) || null);

  handle('cache:clear', async () => {
    await session.defaultSession.clearCache();
    return true;
  });

  handle('window:minimize', async () => {
    getMainWindow()?.minimize();
    return true;
  });
  handle('window:toggleMaximize', async () => {
    const win = getMainWindow();
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  handle('window:close', async () => {
    getMainWindow()?.close();
    return true;
  });
  handle('window:isMaximized', async () => getMainWindow()?.isMaximized() || false);

  ipcMain.on('diagnostics:renderer-log', (event, payload) => {
    diagnostics?.rendererLog?.(payload, event.sender?.id || null);
  });

  ipcMain.on('player:state', (_event, state) => {
    const previous = runtime.playerState || {};
    runtime.playerState = sanitizePlayerState(state);
    if (
      previous.playing !== runtime.playerState.playing ||
      previous.title !== runtime.playerState.title
    ) {
      diagnostics?.log('player', 'player:state', {
        playing: runtime.playerState.playing,
        hasTitle: Boolean(runtime.playerState.title),
        canNext: runtime.playerState.canNext,
        canPrevious: runtime.playerState.canPrevious
      }, 'debug');
    }
    rebuildTrayMenu(runtime);
  });
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (...args) => {
    const started = performance.now();
    const details = describeIpcCall(channel, args[1]);
    activeDiagnostics?.log('ipc', `${channel}:start`, details, 'debug');
    try {
      const data = await fn(...args);
      activeDiagnostics?.log('ipc', `${channel}:success`, {
        ...details,
        durationMs: round(performance.now() - started),
        result: summarizeResult(channel, data)
      }, 'debug');
      return { ok: true, data };
    } catch (error) {
      activeDiagnostics?.log('ipc', `${channel}:error`, {
        ...details,
        durationMs: round(performance.now() - started),
        error: {
          name: error?.name,
          code: error?.code,
          message: error?.message,
          details: error?.details
        }
      }, 'error');
      return { ok: false, error: normalizeError(error) };
    }
  });
}

function describeIpcCall(channel, payload) {
  if (channel === 'auth:connect') {
    return {
      serverKind: /^https?:\/\//i.test(String(payload?.serverInput || '')) ? 'url' : 'fnid',
      serverInputLength: String(payload?.serverInput || '').length,
      usernameLength: String(payload?.username || '').length,
      hasAccessCode: Boolean(payload?.accessCode),
      allowHttp: Boolean(payload?.allowHttp),
      allowSelfSigned: Boolean(payload?.allowSelfSigned),
      rememberSession: Boolean(payload?.rememberSession)
    };
  }
  if (channel === 'music:call') {
    const args = payload?.args || {};
    return {
      method: String(payload?.method || ''),
      page: finiteNumber(args.page),
      size: finiteNumber(args.size),
      queryLength: String(args.query || '').length,
      guidCount: Array.isArray(args.trackGUIDs) ? args.trackGUIDs.length : undefined,
      hasGuid: Boolean(args.guid || args.trackGUID || args.albumGUID || args.artistGUID || args.genreGUID || args.playlistGUID)
    };
  }
  if (channel === 'settings:set') return { key: String(payload?.key || '').slice(0, 100) };
  if (channel === 'auth:switch' || channel === 'auth:remove') return { hasId: Boolean(payload) };
  if (channel.startsWith('diagnostics:')) return {};
  return payload == null ? {} : { payloadType: Array.isArray(payload) ? 'array' : typeof payload };
}

function summarizeResult(channel, data) {
  if (channel === 'app:bootstrap') {
    return {
      hasSession: Boolean(data?.session),
      accountCount: Array.isArray(data?.accounts) ? data.accounts.length : 0,
      hasMediaBaseUrl: Boolean(data?.mediaBaseUrl),
      version: data?.version
    };
  }
  if (channel.startsWith('auth:')) {
    return {
      hasSession: Boolean(data?.session),
      accountCount: Array.isArray(data?.accounts) ? data.accounts.length : undefined,
      hasConnection: Boolean(data?.connection)
    };
  }
  if (channel === 'music:call') {
    return summarizeCollection(data);
  }
  return summarizeCollection(data);
}

function summarizeCollection(value) {
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (!value || typeof value !== 'object') return { type: typeof value };
  const result = { type: 'object' };
  if (Array.isArray(value.list)) result.listLength = value.list.length;
  if (Number.isFinite(Number(value.total))) result.total = Number(value.total);
  for (const key of ['history', 'favorites', 'albums', 'artists', 'playlists', 'tracks']) {
    if (Array.isArray(value[key]?.list)) result[`${key}Length`] = value[key].list.length;
    if (Number.isFinite(Number(value[key]?.total))) result[`${key}Total`] = Number(value[key].total);
  }
  if (value.text != null) result.textLength = String(value.text).length;
  if (value.url != null) result.hasUrl = true;
  return result;
}

function sanitizeArgs(args) {
  if (args == null) return {};
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new XtMusicError('INVALID_ARGUMENT', '接口参数格式不正确');
  }
  const serialized = JSON.stringify(args);
  if (serialized.length > 1024 * 1024) {
    throw new XtMusicError('ARGUMENT_TOO_LARGE', '接口参数过大');
  }
  return JSON.parse(serialized);
}

function sanitizePlayerState(state) {
  return {
    playing: Boolean(state?.playing),
    title: String(state?.title || '').slice(0, 300),
    artist: String(state?.artist || '').slice(0, 300),
    canNext: Boolean(state?.canNext),
    canPrevious: Boolean(state?.canPrevious)
  };
}

function rebuildTrayMenu(runtime) {
  if (typeof runtime.rebuildTrayMenu === 'function') runtime.rebuildTrayMenu();
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

module.exports = {
  registerIpc,
  MUSIC_METHODS,
  sanitizeArgs,
  describeIpcCall,
  summarizeResult
};
