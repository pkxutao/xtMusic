'use strict';

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

function registerIpc({
  runtime,
  sessionService,
  accountStore,
  settingsStore,
  hlsRegistry,
  mediaServer,
  getMainWindow
}) {
  handle('app:bootstrap', async () => ({
    ...(await sessionService.bootstrap()),
    settings: settingsStore.all(),
    platform: process.platform,
    version: require('../../package.json').version,
    mediaBaseUrl: mediaServer?.baseUrl || null
  }));

  handle('auth:connect', async (event, payload) => {
    const sender = event.sender;
    return sessionService.connect(payload, (progress) => {
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

  ipcMain.on('player:state', (_event, state) => {
    runtime.playerState = sanitizePlayerState(state);
    rebuildTrayMenu(runtime);
  });
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (error) {
      return { ok: false, error: normalizeError(error) };
    }
  });
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

module.exports = { registerIpc, MUSIC_METHODS, sanitizeArgs };
