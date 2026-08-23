export function parseLrc(text) {
  const lines = [];
  const metadata = {};
  const source = String(text || '').replace(/\r/g, '');
  for (const raw of source.split('\n')) {
    const meta = raw.match(/^\[([a-zA-Z]+):([^\]]*)\]$/);
    if (meta && !/^\d/.test(meta[1])) {
      metadata[meta[1].toLowerCase()] = meta[2].trim();
      continue;
    }

    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const content = raw.replace(/\[[^\]]+\]/g, '').trim();
    for (const stamp of stamps) {
      const minutes = Number(stamp[1]);
      const seconds = Number(stamp[2]);
      const fractionRaw = stamp[3] || '0';
      const fraction = fractionRaw.length === 3
        ? Number(fractionRaw) / 1000
        : Number(fractionRaw) / (10 ** fractionRaw.length);
      lines.push({
        time: minutes * 60 + seconds + fraction,
        text: content || '♪'
      });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return { lines: dedupe(lines), metadata };
}

export function activeLyricIndex(lines, time) {
  if (!lines.length) return -1;
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= time + 0.05) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
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
