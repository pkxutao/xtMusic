// Only small, credential-free playback metadata is kept. No audio or covers are
// fetched while indexing; rendering continues to use bounded, paginated rows.
export function compactTrack(track) {
  const text = (value) => String(value || '').slice(0, 2000);
  if (!track?.guid) throw new Error('曲库返回了缺少标识的歌曲，索引未完成');
  const entity = (value) => value ? {
    guid: text(value.guid), name: text(value.name), coverId: text(value.coverId)
  } : null;
  return {
    guid: text(track.guid), title: text(track.title),
    artists: (Array.isArray(track.artists) ? track.artists : []).map(entity).filter(Boolean),
    album: entity(track.album), coverId: text(track.coverId),
    duration: Number(track.duration ?? track.audioSpec?.duration) || 0,
    audioSpec: { format: text(track.audioSpec?.format), codec: text(track.audioSpec?.codec),
      duration: Number(track.audioSpec?.duration) || 0 },
    isFavorite: Boolean(track.isFavorite)
  };
}

export function accountScope(session) {
  if (!session) return '';
  // Do not key by the volatile authentication token, or by username alone.
  return JSON.stringify([String(session.serverUrl || session.fnId || ''),
    String(session.username || session.user?.guid || session.id || '')]);
}

export function librarySource(route) {
  const sources = {
    tracks: ['getTracks', '全部歌曲'], favorites: ['getFavorites', '全部收藏'],
    album: ['getAlbumTracks', '专辑全部歌曲', 'albumGUID'],
    playlist: ['getPlaylistTracks', '歌单全部歌曲', 'playlistGUID'],
    genre: ['getGenreTracks', '风格全部歌曲', 'genreGUID']
  };
  const spec = sources[route?.name];
  if (!spec) return null;
  const id = route.params?.guid;
  if (spec[2] && !id) return null;
  return { kind: route.name, method: spec[0], label: spec[1],
    args: spec[2] ? { [spec[2]]: id } : {}, key: `${route.name}:${id || ''}` };
}

export function checkAborted(signal) {
  if (signal?.aborted) throw new DOMException('已取消曲库准备', 'AbortError');
}

export function abortable(promise, signal) {
  checkAborted(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('已取消曲库准备', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function knownTotal(result) {
  if (result?.totalKnown === false || result?.total == null) return null;
  const total = Number(result.total);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

export function pageFingerprint(result) {
  return (result?.list || []).map((track) => String(track.guid)).join('\n');
}

// Sequential bounded requests avoid hammering a NAS/relay. There is no silent
// 400/500/30,000-track cap; failures or repeated pages never become "complete".
export async function collectLibrary(call, source, { signal, onProgress = () => {}, first = null } = {}) {
  let page = 1;
  let size = 400;
  let total = null;
  const tracks = [];
  const seen = new Set();
  const firstResult = first || await abortable(call(source.method, { ...source.args, page, size }), signal);
  checkAborted(signal);
  const fingerprint = pageFingerprint(firstResult);
  let result = firstResult;
  while (true) {
    checkAborted(signal);
    if (!Array.isArray(result?.list)) throw new Error('曲库分页响应无效，请重试');
    const reported = knownTotal(result);
    if (page === 1) total = reported;
    else if (reported != null && total != null && reported !== total) {
      throw new Error('扫描期间曲库数量发生变化，请重新扫描');
    }
    if (page === 1 && result.list.length && result.list.length < size) size = result.list.length;
    if (!result.list.length) {
      if (total != null && tracks.length !== total) throw new Error('曲库提前返回空页，索引未完成，请重试');
      break;
    }
    for (const raw of result.list) {
      const track = compactTrack(raw);
      if (seen.has(track.guid)) throw new Error('曲库分页出现重复歌曲，请刷新曲库后重试（未使用不完整索引）');
      seen.add(track.guid);
      tracks.push(track);
    }
    if (total != null && tracks.length > total) throw new Error('曲库总数与返回歌曲不一致，请重新扫描');
    onProgress({ loaded: tracks.length, total, page });
    if (total != null && tracks.length === total) break;
    page += 1;
    result = await abortable(call(source.method, { ...source.args, page, size }), signal);
  }
  checkAborted(signal);
  return { tracks, total: tracks.length, complete: true, fingerprint, savedAt: Date.now() };
}
