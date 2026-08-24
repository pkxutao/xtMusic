export function parseLrc(text) {
  const lines = [];
  const metadata = {};
  const source = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '');

  let offsetMs = 0;
  for (const rawLine of source.split('\n')) {
    const raw = rawLine.trimEnd();
    const meta = raw.match(/^\[([a-zA-Z][\w-]*):([^\]]*)\]$/);
    if (meta) {
      const key = meta[1].toLowerCase();
      const value = meta[2].trim();
      metadata[key] = value;
      if (key === 'offset') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) offsetMs = parsed;
      }
      continue;
    }

    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;

    const content = raw
      .replace(/\[(?:\d{1,3}):(\d{1,2})(?:[.:]\d{1,3})?\]/g, '')
      .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '')
      .trim();

    for (const stamp of stamps) {
      const time = timestampToSeconds(stamp[1], stamp[2], stamp[3]);
      if (!Number.isFinite(time)) continue;
      lines.push({
        time,
        text: content || '\u00A0'
      });
    }
  }

  const offsetSeconds = offsetMs / 1000;
  for (const line of lines) line.time = Math.max(0, line.time + offsetSeconds);
  lines.sort((a, b) => a.time - b.time);

  return {
    lines: dedupe(lines),
    metadata: {
      ...metadata,
      offsetMs
    }
  };
}

export function activeLyricIndex(lines, time) {
  if (!lines.length) return -1;
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= time + 0.04) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

function timestampToSeconds(minutesRaw, secondsRaw, fractionRaw = '0') {
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return NaN;
  const fractionText = String(fractionRaw || '0');
  const fraction = Number(fractionText) / (10 ** fractionText.length);
  return minutes * 60 + seconds + fraction;
}

function dedupe(lines) {
  const result = [];
  for (const line of lines) {
    const last = result[result.length - 1];
    if (last && Math.abs(last.time - line.time) < 0.005 && last.text === line.text) continue;
    result.push(line);
  }
  return result;
}
