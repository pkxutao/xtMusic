'use strict';

const { contextBridge } = require('electron');

const albums = Array.from({ length: 1595 }, (_value, index) => ({
  guid: `album-${index + 1}`,
  name: `专辑 ${index + 1}`,
  coverId: null,
  trackCount: 10 + (index % 15)
}));
const artists = Array.from({ length: 1005 }, (_value, index) => ({
  guid: `artist-${index + 1}`,
  name: `歌手 ${index + 1}`,
  coverId: null,
  trackCount: 20 + (index % 30)
}));
const tracks = Array.from({ length: 4219 }, (_value, index) => ({
  guid: `track-${index + 1}`,
  title: `歌曲 ${index + 1}`,
  artists: [{ name: `歌手 ${(index % 100) + 1}` }],
  album: { name: `专辑 ${(index % 200) + 1}`, coverId: null },
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
