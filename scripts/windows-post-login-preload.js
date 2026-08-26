'use strict';

const { contextBridge } = require('electron');

const playlistDelayMs = 3000;
const tracks = Array.from({ length: 2000 }, (_value, index) => ({
  guid: `stress-track-${index + 1}`,
  title: `曲目 ${index + 1}`,
  artists: [{ name: '性能测试歌手' }],
  album: { name: '性能测试专辑' },
  duration: 2,
  audioSpec: { format: 'wav', codec: 'pcm', duration: 2 },
  isFavorite: false
}));
const playlists = Array.from({ length: 5000 }, (_value, index) => ({
  guid: `stress-playlist-${index + 1}`,
  name: `压力歌单 ${index + 1}`,
  trackCount: index % 40
}));
const albums = Array.from({ length: 14 }, (_value, index) => ({
  guid: `stress-album-${index + 1}`,
  name: `专辑 ${index + 1}`,
  trackCount: 20
}));
const artists = Array.from({ length: 14 }, (_value, index) => ({
  guid: `stress-artist-${index + 1}`,
  name: `歌手 ${index + 1}`,
  trackCount: 40
}));

const mediaBaseUrl = String(process.env.XT_MUSIC_POST_LOGIN_MEDIA_BASE_URL || '');
const noOpSubscription = () => () => {};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

contextBridge.exposeInMainWorld('xtMusic', Object.freeze({
  environment: Object.freeze({
    platform: 'win32',
    isLinux: false,
    isWayland: false,
    sessionType: '',
    mediaBaseUrl
  }),
  bootstrap: async () => ({
    session: {
      id: 'stress-session',
      username: 'stress-user',
      name: '登录性能测试',
      serverUrl: 'https://nas.invalid',
      relayMode: true
    },
    accounts: [],
    settings: { volume: 0.25, repeatMode: 'off', theme: 'dark', lastRoute: 'home' },
    encryptionAvailable: true,
    sessionError: null,
    mediaBaseUrl,
    version: '0.3.3'
  }),
  auth: Object.freeze({
    connect: async () => { throw new Error('not used'); },
    switchAccount: async () => { throw new Error('not used'); },
    logout: async () => ({ accounts: [] }),
    removeAccount: async () => ({ accounts: [] }),
    listAccounts: async () => []
  }),
  music: Object.freeze({
    call: async (method) => {
      if (method === 'getHome') {
        return {
          history: { list: tracks.slice(0, 14), total: 14 },
          albums: { list: albums, total: albums.length },
          artists: { list: artists, total: artists.length },
          playlists: { list: playlists.slice(0, 14), total: playlists.length },
          favorites: { list: tracks.slice(14, 28), total: 14 }
        };
      }
      if (method === 'getPlaylists') {
        await delay(playlistDelayMs);
        return { list: playlists, total: playlists.length };
      }
      if (method === 'getTracks') return { list: tracks, total: tracks.length };
      if (method === 'getLyrics') {
        return { text: '[00:00.00]第一行歌词\n[00:00.80]第二行歌词\n[00:01.60]第三行歌词' };
      }
      if (['reportPlay', 'favorite', 'unfavorite', 'quitTranscode'].includes(method)) return true;
      if (method === 'startTranscode') throw new Error('transcode should not be used');
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
    diagnostics: async () => ({ running: true, recentErrors: [] })
  }),
  events: Object.freeze({
    onAuthProgress: noOpSubscription,
    onPlayerCommand: noOpSubscription,
    onWindowMaximized: noOpSubscription,
    onSystemTheme: noOpSubscription
  })
}));
