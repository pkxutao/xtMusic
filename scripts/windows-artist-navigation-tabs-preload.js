'use strict';

const { contextBridge } = require('electron');

const artist = {
  guid: 'artist-1',
  name: '歌手导航测试艺人',
  trackCount: 6,
  albumCount: 3,
  coverId: null
};

const secondArtist = {
  guid: 'artist-2',
  name: '合作歌手',
  trackCount: 1,
  albumCount: 1,
  coverId: null
};

const albums = [
  { guid: 'album-a', name: '晨光', trackCount: 2, releaseDate: 1760000000 },
  { guid: 'album-b', name: '远山', trackCount: 2, releaseDate: 1750000000 },
  { guid: 'album-c', name: '夜航', trackCount: 2, releaseDate: 1740000000 }
];

const tracks = albums.flatMap((album, albumIndex) => Array.from({ length: 2 }, (_value, trackIndex) => ({
  guid: `track-${albumIndex + 1}-${trackIndex + 1}`,
  title: `${album.name} · 曲目 ${trackIndex + 1}`,
  album,
  artists: trackIndex === 1 && albumIndex === 0 ? [artist, secondArtist] : [artist],
  duration: 5,
  audioSpec: { format: 'wav', codec: 'pcm', duration: 5 },
  createdAt: 1760000000 + albumIndex * 10 + trackIndex,
  isFavorite: false
})));

const calls = [];
const mediaBaseUrl = String(process.env.XT_MUSIC_ARTIST_TABS_MEDIA_BASE_URL || '');
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
      id: 'artist-tabs-session',
      username: 'artist-tabs-user',
      name: '歌手导航验证',
      serverUrl: 'https://nas.invalid',
      relayMode: false
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
          artists: { list: [artist, secondArtist], total: 2 },
          playlists: { list: [], total: 0 },
          favorites: { list: [], total: 0 }
        };
      }
      if (method === 'getArtists') return page([artist, secondArtist], args.page, args.size);
      if (method === 'getArtistTracks') {
        const source = args.artistGUID === secondArtist.guid ? tracks.slice(1, 2) : tracks;
        return page(source, args.page, args.size);
      }
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
