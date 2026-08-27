'use strict';

const { contextBridge } = require('electron');

const artist = {
  guid: 'artist-1',
  name: '专辑导航测试歌手',
  trackCount: 6,
  albumCount: 3
};

const albums = [
  { guid: 'album-a', name: '晨光', trackCount: 2 },
  { guid: 'album-b', name: '远山', trackCount: 2 },
  { guid: 'album-c', name: '夜航', trackCount: 2 }
];

const tracks = albums.flatMap((album, albumIndex) => Array.from({ length: 2 }, (_value, trackIndex) => ({
  guid: `track-${albumIndex + 1}-${trackIndex + 1}`,
  title: `${album.name} · 曲目 ${trackIndex + 1}`,
  album,
  artists: [artist],
  duration: 4,
  audioSpec: { format: 'wav', codec: 'pcm', duration: 4 },
  createdAt: 1720000000 + albumIndex * 10 + trackIndex,
  isFavorite: false
})));

const calls = [];
const mediaBaseUrl = String(process.env.XT_MUSIC_ALBUM_NAV_MEDIA_BASE_URL || '');
const noOpSubscription = () => () => {};
const page = (list, pageNumber = 1, size = 72) => {
  const safePage = Math.max(1, Number(pageNumber || 1));
  const safeSize = Math.max(1, Number(size || 72));
  const start = (safePage - 1) * safeSize;
  return { list: list.slice(start, start + safeSize), total: list.length };
};

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
      id: 'album-nav-session',
      username: 'album-nav-user',
      name: '专辑导航验证',
      serverUrl: 'https://nas.invalid',
      relayMode: false
    },
    accounts: [],
    settings: {
      volume: 0.25,
      repeatMode: 'off',
      theme: 'dark',
      lastRoute: 'home',
      queuePanelOpen: false
    },
    encryptionAvailable: true,
    sessionError: null,
    mediaBaseUrl,
    version: '0.3.7'
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
      calls.push({ method, args: { ...args } });
      if (method === 'getHome') {
        return {
          history: { list: tracks.slice(0, 4), total: 4 },
          albums: { list: albums, total: albums.length },
          artists: { list: [artist], total: 1 },
          playlists: { list: [], total: 0 },
          favorites: { list: [], total: 0 }
        };
      }
      if (method === 'getArtists') return page([artist], args.page, args.size);
      if (method === 'getArtistAlbums') return page(albums, args.page, args.size);
      if (method === 'getAlbums') return page(albums, args.page, args.size);
      if (method === 'getAlbumTracks') {
        return page(tracks.filter((track) => track.album.guid === args.albumGUID), args.page, args.size);
      }
      if (method === 'getTracks') return page(tracks, args.page, args.size);
      if (method === 'getPlaylists') return { list: [], total: 0 };
      if (method === 'getGenres') return { list: [], total: 0 };
      if (method === 'getFavorites') return { list: [], total: 0 };
      if (method === 'getHistory') return { list: tracks.slice(0, 4), total: 4 };
      if (method === 'getLyrics') {
        return { text: '[00:00.00]第一句歌词\n[00:01.20]第二句歌词\n[00:02.40]第三句歌词' };
      }
      if (['reportPlay', 'favorite', 'unfavorite', 'quitTranscode'].includes(method)) return true;
      if (method === 'startTranscode') throw new Error('transcode should not be used');
      if (method === 'search') {
        return {
          tracks: { list: tracks.slice(0, 3), total: 3 },
          albums: { list: albums.slice(0, 2), total: 2 },
          artists: { list: [artist], total: 1 }
        };
      }
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
  diagnostics: Object.freeze({
    info: async () => null,
    copy: async () => ({ copied: false }),
    openFolder: async () => ({ opened: false }),
    snapshot: async () => null,
    log: () => {}
  }),
  events: Object.freeze({
    onAuthProgress: noOpSubscription,
    onPlayerCommand: noOpSubscription,
    onWindowMaximized: noOpSubscription,
    onSystemTheme: noOpSubscription
  }),
  test: Object.freeze({
    getCalls: () => calls.map((entry) => ({ method: entry.method, args: { ...entry.args } }))
  })
}));
