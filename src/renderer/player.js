import Hls from 'hls.js';
import { activeLyricIndex, parseLrc } from './lrc.js';
import {
  artistsText,
  coverUrl,
  safeJsonParse,
  streamUrl,
  trackDuration
} from './utils.js';

const QUEUE_STORAGE_KEY = 'xtmusic.player.queue.v1';

export class Player extends EventTarget {
  constructor({ musicCall, publishState, onVolumeChange }) {
    super();
    this.musicCall = musicCall;
    this.publishState = publishState;
    this.onVolumeChange = onVolumeChange;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.autoplay = false;
    this.audio.crossOrigin = 'anonymous';
    this.queue = [];
    this.index = -1;
    this.repeatMode = 'off';
    this.shuffle = false;
    this.hls = null;
    this.transcodeGuid = null;
    this.fallbackAttempted = new Set();
    this.lyrics = { lines: [], metadata: {}, raw: '' };
    this.activeLyric = -1;
    this.loading = false;
    this.error = null;
    this.#restore();
    this.#bind();
    this.#setupMediaSession();
  }

  get currentTrack() {
    return this.queue[this.index] || null;
  }

  get state() {
    return {
      queue: this.queue,
      index: this.index,
      track: this.currentTrack,
      playing: !this.audio.paused,
      loading: this.loading,
      currentTime: Number(this.audio.currentTime || 0),
      duration: Number(this.audio.duration || trackDuration(this.currentTrack) || 0),
      volume: this.audio.volume,
      muted: this.audio.muted,
      repeatMode: this.repeatMode,
      shuffle: this.shuffle,
      activeLyric: this.activeLyric,
      lyrics: this.lyrics,
      error: this.error
    };
  }

  async setQueue(tracks, startIndex = 0, { autoplay = true } = {}) {
    const normalized = uniqueTracks(tracks);
    if (!normalized.length) return;
    this.queue = normalized;
    this.index = clamp(startIndex, 0, normalized.length - 1);
    this.#persist();
    this.#emit('queue');
    await this.#loadCurrent({ autoplay });
  }

  async playTrack(track, context = [], { autoplay = true } = {}) {
    const list = uniqueTracks(context?.length ? context : [track]);
    let index = list.findIndex((item) => item.guid === track.guid);
    if (index < 0) {
      list.unshift(track);
      index = 0;
    }
    return this.setQueue(list, index, { autoplay });
  }

  addToQueue(tracks, { next = false } = {}) {
    const additions = uniqueTracks(Array.isArray(tracks) ? tracks : [tracks])
      .filter((track) => !this.queue.some((item) => item.guid === track.guid));
    if (!additions.length) return;
    if (next && this.index >= 0) {
      this.queue.splice(this.index + 1, 0, ...additions);
    } else {
      this.queue.push(...additions);
    }
    this.#persist();
    this.#emit('queue');
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    const removingCurrent = index === this.index;
    this.queue.splice(index, 1);
    if (!this.queue.length) {
      this.stop();
      this.index = -1;
    } else if (index < this.index) {
      this.index -= 1;
    } else if (removingCurrent) {
      this.index = Math.min(index, this.queue.length - 1);
      this.#loadCurrent({ autoplay: true });
    }
    this.#persist();
    this.#emit('queue');
  }

  clearQueue() {
    this.stop();
    this.queue = [];
    this.index = -1;
    this.#persist();
    this.#emit('queue');
    this.#emit('state');
  }

  async toggle() {
    if (!this.currentTrack && this.queue.length) {
      this.index = Math.max(0, this.index);
      await this.#loadCurrent({ autoplay: true });
      return;
    }
    if (!this.currentTrack) return;
    if (this.audio.paused) await this.play();
    else this.pause();
  }

  async play() {
    if (!this.currentTrack) return;
    try {
      await this.audio.play();
      this.error = null;
    } catch (error) {
      this.#setError(`无法开始播放：${error.message}`);
    }
  }

  pause() {
    this.audio.pause();
  }

  stop() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.#destroyHls();
    this.#quitTranscode();
  }

  async next({ automatic = false } = {}) {
    if (!this.queue.length) return;
    if (this.repeatMode === 'one' && automatic) {
      this.seek(0);
      await this.play();
      return;
    }
    let nextIndex;
    if (this.shuffle && this.queue.length > 1) {
      do {
        nextIndex = Math.floor(Math.random() * this.queue.length);
      } while (nextIndex === this.index);
    } else {
      nextIndex = this.index + 1;
      if (nextIndex >= this.queue.length) {
        if (this.repeatMode === 'all') nextIndex = 0;
        else {
          this.pause();
          this.seek(0);
          return;
        }
      }
    }
    this.index = nextIndex;
    this.#persist();
    await this.#loadCurrent({ autoplay: true });
    this.#emit('queue');
  }

  async previous() {
    if (!this.queue.length) return;
    if (this.audio.currentTime > 4) {
      this.seek(0);
      return;
    }
    let previousIndex = this.index - 1;
    if (previousIndex < 0) previousIndex = this.repeatMode === 'all' ? this.queue.length - 1 : 0;
    this.index = previousIndex;
    this.#persist();
    await this.#loadCurrent({ autoplay: true });
    this.#emit('queue');
  }

  async jumpTo(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.index = index;
    this.#persist();
    await this.#loadCurrent({ autoplay: true });
    this.#emit('queue');
  }

  seek(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value)) return;
    this.audio.currentTime = clamp(value, 0, Number(this.audio.duration || value));
    this.#updateLyric();
    this.#emit('progress');
  }

  setVolume(value) {
    const volume = clamp(Number(value), 0, 1);
    this.audio.volume = volume;
    this.audio.muted = volume === 0;
    this.onVolumeChange?.(volume);
    this.#emit('state');
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    this.#emit('state');
  }

  setRepeatMode(mode) {
    this.repeatMode = ['off', 'all', 'one'].includes(mode) ? mode : 'off';
    this.#persist();
    this.#emit('state');
  }

  cycleRepeat() {
    const modes = ['off', 'all', 'one'];
    this.setRepeatMode(modes[(modes.indexOf(this.repeatMode) + 1) % modes.length]);
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    this.#persist();
    this.#emit('state');
  }

  setInitialOptions({ volume = 0.82, repeatMode = 'off' } = {}) {
    this.audio.volume = clamp(Number(volume), 0, 1);
    this.repeatMode = ['off', 'all', 'one'].includes(repeatMode) ? repeatMode : 'off';
    this.#emit('state');
  }

  async #loadCurrent({ autoplay }) {
    const track = this.currentTrack;
    if (!track) return;
    this.loading = true;
    this.error = null;
    this.lyrics = { lines: [], metadata: {}, raw: '' };
    this.activeLyric = -1;
    this.#emit('track');
    this.#emit('state');
    this.#destroyHls();
    await this.#quitTranscode();

    const format = String(track.audioSpec?.format || track.audioSpec?.codec || '').toLowerCase();
    const shouldTranscode = ['dsf', 'dff', 'sacd'].some((item) => format.includes(item));
    try {
      if (shouldTranscode) {
        await this.#loadTranscode(track);
      } else {
        this.audio.src = streamUrl(track.guid);
        this.audio.load();
      }
      this.#loadLyrics(track);
      this.#updateMediaMetadata(track);
      this.#prefetchNextCover();
      if (autoplay) await this.audio.play();
    } catch (error) {
      if (!shouldTranscode && !this.fallbackAttempted.has(track.guid)) {
        this.fallbackAttempted.add(track.guid);
        try {
          await this.#loadTranscode(track);
          if (autoplay) await this.audio.play();
          return;
        } catch (fallbackError) {
          this.#setError(`播放失败：${fallbackError.message}`);
        }
      } else {
        this.#setError(`播放失败：${error.message}`);
      }
    } finally {
      this.loading = false;
      this.#emit('state');
    }
  }

  async #loadTranscode(track) {
    this.#destroyHls();
    const result = await this.musicCall('startTranscode', {
      guid: track.guid,
      codec: 'mp3',
      channel: 2
    });
    this.transcodeGuid = track.guid;
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        manifestLoadingTimeOut: 20000,
        fragLoadingTimeOut: 30000
      });
      this.hls = hls;
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          hls.off(Hls.Events.MANIFEST_PARSED, onReady);
          hls.off(Hls.Events.ERROR, onError);
        };
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = (_event, data) => {
          if (!data.fatal) return;
          cleanup();
          reject(new Error(data.details || 'HLS 转码流加载失败'));
        };
        hls.on(Hls.Events.MANIFEST_PARSED, onReady);
        hls.on(Hls.Events.ERROR, onError);
        hls.loadSource(result.url);
        hls.attachMedia(this.audio);
      });
    } else if (this.audio.canPlayType('application/vnd.apple.mpegurl')) {
      this.audio.src = result.url;
      this.audio.load();
    } else {
      throw new Error('当前播放器不支持服务器转码流');
    }
  }

  async #loadLyrics(track) {
    try {
      const response = await this.musicCall('getLyrics', { trackGUID: track.guid });
      if (this.currentTrack?.guid !== track.guid) return;
      const parsed = parseLrc(response.text || '');
      this.lyrics = {
        ...parsed,
        raw: response.text || ''
      };
      this.activeLyric = activeLyricIndex(parsed.lines, this.audio.currentTime);
      this.#emit('lyrics');
    } catch {
      if (this.currentTrack?.guid !== track.guid) return;
      this.lyrics = { lines: [], metadata: {}, raw: '' };
      this.#emit('lyrics');
    }
  }

  async #quitTranscode() {
    const guid = this.transcodeGuid;
    this.transcodeGuid = null;
    if (!guid) return;
    try {
      await this.musicCall('quitTranscode', { guid });
    } catch {
      // Best effort.
    }
  }

  #destroyHls() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  #bind() {
    this.audio.addEventListener('play', () => {
      this.loading = false;
      this.#emit('state');
      this.#publish();
      const track = this.currentTrack;
      if (track) this.musicCall('reportPlay', { trackGUID: track.guid }).catch(() => {});
    });
    this.audio.addEventListener('pause', () => {
      this.#emit('state');
      this.#publish();
    });
    this.audio.addEventListener('waiting', () => {
      this.loading = true;
      this.#emit('state');
    });
    this.audio.addEventListener('playing', () => {
      this.loading = false;
      this.#emit('state');
    });
    this.audio.addEventListener('loadedmetadata', () => {
      this.loading = false;
      this.#emit('state');
      this.#updatePositionState();
    });
    this.audio.addEventListener('timeupdate', () => {
      this.#updateLyric();
      this.#emit('progress');
      this.#updatePositionState();
    });
    this.audio.addEventListener('durationchange', () => this.#emit('progress'));
    this.audio.addEventListener('volumechange', () => this.#emit('state'));
    this.audio.addEventListener('ended', () => this.next({ automatic: true }));
    this.audio.addEventListener('error', async () => {
      const track = this.currentTrack;
      if (!track || this.hls || this.fallbackAttempted.has(track.guid)) return;
      this.fallbackAttempted.add(track.guid);
      try {
        await this.#loadTranscode(track);
        await this.audio.play();
      } catch (error) {
        this.#setError(`无法解码这首歌曲：${error.message}`);
      }
    });
  }

  #updateLyric() {
    const next = activeLyricIndex(this.lyrics.lines, this.audio.currentTime);
    if (next === this.activeLyric) return;
    this.activeLyric = next;
    this.#emit('lyric-line');
  }

  #setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const actions = {
      play: () => this.play(),
      pause: () => this.pause(),
      previoustrack: () => this.previous(),
      nexttrack: () => this.next(),
      seekbackward: (details) => this.seek(this.audio.currentTime - (details.seekOffset || 10)),
      seekforward: (details) => this.seek(this.audio.currentTime + (details.seekOffset || 10)),
      seekto: (details) => this.seek(details.seekTime || 0),
      stop: () => this.pause()
    };
    for (const [name, handler] of Object.entries(actions)) {
      try {
        navigator.mediaSession.setActionHandler(name, handler);
      } catch {
        // Action may not be supported by this Chromium build.
      }
    }
  }

  #updateMediaMetadata(track) {
    if (!('mediaSession' in navigator) || !('MediaMetadata' in window)) return;
    const coverId = track.coverId || track.album?.coverId;
    const artwork = coverId
      ? [
          { src: coverUrl(coverId, 256), sizes: '256x256' },
          { src: coverUrl(coverId, 512), sizes: '512x512' }
        ]
      : [];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || '未知标题',
        artist: artistsText(track),
        album: track.album?.name || '',
        artwork
      });
    } catch {
      // Custom protocol artwork may be rejected on older Chromium builds.
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || '未知标题',
        artist: artistsText(track),
        album: track.album?.name || ''
      });
    }
  }

  #updatePositionState() {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
    const duration = Number(this.audio.duration);
    const position = Number(this.audio.currentTime);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.audio.playbackRate || 1,
        position: clamp(position, 0, duration)
      });
    } catch {
      // Ignore transient invalid position while sources switch.
    }
  }

  #prefetchNextCover() {
    const next = this.queue[this.index + 1];
    const coverId = next?.coverId || next?.album?.coverId;
    if (!coverId) return;
    const image = new Image();
    image.src = coverUrl(coverId, 256);
  }

  #setError(message) {
    this.loading = false;
    this.error = message;
    this.#emit('error', message);
    this.#emit('state');
  }

  #emit(type, detail = this.state) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    if (['state', 'track', 'queue'].includes(type)) this.#publish();
  }

  #publish() {
    const track = this.currentTrack;
    this.publishState?.({
      playing: !this.audio.paused,
      title: track?.title || '',
      artist: track ? artistsText(track) : '',
      canPrevious: this.queue.length > 0 && (this.index > 0 || this.repeatMode === 'all'),
      canNext: this.queue.length > 0 && (this.index < this.queue.length - 1 || this.repeatMode === 'all')
    });
  }

  #persist() {
    const payload = {
      queue: this.queue.slice(0, 2000),
      index: this.index,
      repeatMode: this.repeatMode,
      shuffle: this.shuffle
    };
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Queue persistence is non-critical.
    }
  }

  #restore() {
    const saved = safeJsonParse(localStorage.getItem(QUEUE_STORAGE_KEY), null);
    if (!saved || !Array.isArray(saved.queue)) return;
    this.queue = uniqueTracks(saved.queue).slice(0, 2000);
    this.index = this.queue.length ? clamp(Number(saved.index || 0), 0, this.queue.length - 1) : -1;
    this.repeatMode = ['off', 'all', 'one'].includes(saved.repeatMode) ? saved.repeatMode : 'off';
    this.shuffle = Boolean(saved.shuffle);
  }
}

function uniqueTracks(tracks) {
  const result = [];
  const seen = new Set();
  for (const track of Array.isArray(tracks) ? tracks : []) {
    if (!track?.guid || seen.has(track.guid)) continue;
    seen.add(track.guid);
    result.push(track);
  }
  return result;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
