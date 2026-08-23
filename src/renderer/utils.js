export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function attr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

export function formatDuration(value) {
  let seconds = Number(value || 0);
  if (seconds > 100000) seconds /= 1000;
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function formatCount(value) {
  const number = Number(value || 0);
  if (number >= 100000000) return `${(number / 100000000).toFixed(1)}亿`;
  if (number >= 10000) return `${(number / 10000).toFixed(1)}万`;
  return String(number);
}

export function formatDate(value) {
  let number = Number(value || 0);
  if (!number) return '—';
  if (number < 100000000000) number *= 1000;
  const date = new Date(number);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function artistsText(track) {
  const artists = Array.isArray(track?.artists) ? track.artists : [];
  return artists.map((item) => item?.name).filter(Boolean).join('、') || '未知歌手';
}

export function albumText(track) {
  return track?.album?.name || '未知专辑';
}

export function trackDuration(track) {
  return track?.duration ?? track?.audioSpec?.duration ?? 0;
}

export function coverUrl(coverId, size = 480) {
  return coverId
    ? `xtmusic://cover/${encodeURIComponent(coverId)}?size=${Math.round(size)}`
    : '';
}

export function streamUrl(guid) {
  return `xtmusic://stream/${encodeURIComponent(guid)}`;
}

export function initials(value) {
  const text = String(value || 'XT').trim();
  return [...text].slice(0, 2).join('').toUpperCase();
}

export function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function throttle(fn, delay = 100) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remaining = delay - (now - last);
    if (remaining <= 0) {
      clearTimeout(timer);
      timer = null;
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...args);
      }, remaining);
    }
  };
}

export function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function trackKey(track) {
  return String(track?.guid || '');
}

export function imageHtml(coverId, alt, className = 'cover-image', size = 480) {
  if (!coverId) {
    return `<div class="${className} cover-placeholder">${icon('music', 34)}</div>`;
  }
  return `<img class="${className}" src="${attr(coverUrl(coverId, size))}" alt="${attr(alt)}" loading="lazy" decoding="async" draggable="false">`;
}

export function icon(name, size = 20, className = '') {
  const paths = ICONS[name] || ICONS.circle;
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const ICONS = {
  circle: '<circle cx="12" cy="12" r="9"/>',
  home: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-7h6v7"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  album: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3a9 9 0 0 1 9 9"/>',
  artist: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  playlist: '<path d="M4 6h10M4 10h10M4 14h7"/><path d="M17 13v7"/><circle cx="15" cy="20" r="2"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  heartFill: '<path fill="currentColor" stroke="none" d="M12 21 4.2 13.5C-.7 8.8 2.8 1 8.9 3.1c1.2.4 2.2 1.2 3.1 2.2.9-1 1.9-1.8 3.1-2.2 6.1-2.1 9.6 5.7 4.7 10.4L12 21z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  genre: '<path d="M20.6 13.5 11 3.9A2 2 0 0 0 9.6 3H4a1 1 0 0 0-1 1v5.6a2 2 0 0 0 .6 1.4l9.6 9.6a2 2 0 0 0 2.8 0l4.6-4.3a2 2 0 0 0 0-2.8z"/><circle cx="7.5" cy="7.5" r="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
  play: '<path fill="currentColor" stroke="none" d="m8 5 11 7-11 7V5z"/>',
  pause: '<path fill="currentColor" stroke="none" d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  next: '<path fill="currentColor" stroke="none" d="m6 5 9 7-9 7V5zM16 5h2v14h-2z"/>',
  previous: '<path fill="currentColor" stroke="none" d="m18 5-9 7 9 7V5zM6 5h2v14H6z"/>',
  shuffle: '<path d="M16 3h5v5"/><path d="m4 20 5.5-5.5M21 3l-7.5 7.5M4 4l5.5 5.5M13.5 14.5 21 22"/><path d="M16 22h5v-5"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  repeatOne: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/><path d="M11 10h1v5"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a8 8 0 0 1 0 12"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m16 9 5 5M21 9l-5 5"/>',
  queue: '<path d="M4 6h12M4 10h12M4 14h8"/><path d="m17 14 4 3-4 3v-6z"/>',
  lyrics: '<path d="M5 4h14v12H9l-4 4V4z"/><path d="M8 8h8M8 12h5"/>',
  more: '<circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  restore: '<path d="M8 8h11v11H8z"/><path d="M5 16V5h11"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  warning: '<path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
  refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18 9a7 7 0 0 0-12-2L4 11M6 15a7 7 0 0 0 12 2l2-4"/>',
  pin: '<path d="m14 4 6 6-3 1-4 4 1 3-1 1-8-8 1-1 3 1 4-4 1-3z"/><path d="m5 19 4-4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>'
};
