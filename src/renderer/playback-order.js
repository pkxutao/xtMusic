// A shuffle round is a permutation, not repeated random draws. History is
// independent of the pending deck so Previous/Next can retrace actual playback.
export function shuffled(values, random = Math.random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export class PlaybackOrder {
  constructor(count = 0, { shuffle = false, start = 0, random = Math.random } = {}) {
    this.random = random;
    this.count = count;
    this.shuffle = shuffle;
    this.cycle = 1;
    this.order = Array.from({ length: count }, (_, i) => i);
    if (shuffle) this.order = shuffled(this.order, random);
    if (start != null && count) {
      if (shuffle) {
        const position = this.order.indexOf(start);
        [this.order[0], this.order[position]] = [this.order[position], this.order[0]];
      } else this.order = this.order.slice(start);
    }
    this.cursor = 0;
    this.visited = new Set();
    this.history = [];
    this.historyCursor = -1;
  }

  get current() { return this.history[this.historyCursor] ?? -1; }
  get canPrevious() { return this.historyCursor > 0; }
  get canNext() {
    if (this.historyCursor < this.history.length - 1) return true;
    for (let i = this.cursor; i < this.order.length; i += 1) {
      if (!this.visited.has(this.order[i])) return true;
    }
    return false;
  }

  record(index) {
    this.visited.add(index);
    this.history.length = this.historyCursor + 1;
    this.history.push(index);
    // Retain two complete rounds (at least 2,000 manual/history entries).
    const limit = Math.max(this.count * 2, 2000);
    if (this.history.length > limit) this.history.splice(0, this.history.length - limit);
    this.historyCursor = this.history.length - 1;
    return index;
  }

  next(repeat = false) {
    if (!this.count) return null;
    if (this.historyCursor < this.history.length - 1) return this.history[++this.historyCursor];
    while (this.cursor < this.order.length) {
      const index = this.order[this.cursor++];
      if (!this.visited.has(index)) return this.record(index);
    }
    if (!repeat) return null;
    const previous = this.current;
    this.order = Array.from({ length: this.count }, (_, i) => i);
    if (this.shuffle) {
      this.order = shuffled(this.order, this.random);
      if (this.count > 1 && this.order[0] === previous) {
        const other = 1 + Math.floor(this.random() * (this.count - 1));
        [this.order[0], this.order[other]] = [this.order[other], this.order[0]];
      }
    }
    this.cursor = 0;
    this.visited.clear();
    this.cycle += 1;
    return this.next(false);
  }

  previous() {
    return this.canPrevious ? this.history[--this.historyCursor] : null;
  }

  jump(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return null;
    if (!this.shuffle) {
      this.order = Array.from({ length: this.count - index - 1 }, (_, i) => index + 1 + i);
      this.cursor = 0;
      this.visited.clear();
    }
    return this.record(index);
  }

  setShuffle(value) {
    this.shuffle = Boolean(value);
    const pending = Array.from({ length: this.count }, (_, i) => i)
      .filter((i) => !this.visited.has(i) && (this.shuffle || i > this.current));
    this.order = this.shuffle ? shuffled(pending, this.random) : pending;
    this.cursor = 0;
  }

  // Remap by GUID when queue items are inserted/removed; never reset the round.
  reconcile(oldTracks, tracks, { next = false } = {}) {
    const positions = new Map(tracks.map((track, i) => [track.guid, i]));
    const convert = (index) => positions.get(oldTracks[index]?.guid);
    const oldIds = new Set(oldTracks.map((track) => track.guid));
    const added = tracks.map((track, index) => oldIds.has(track.guid) ? null : index).filter((i) => i != null);
    const past = this.history.slice(0, this.historyCursor + 1).map(convert).filter((i) => i != null);
    const future = this.history.slice(this.historyCursor + 1).map(convert).filter((i) => i != null);
    this.history = [...past, ...future];
    this.historyCursor = past.length - 1;
    this.order = this.order.slice(this.cursor).map(convert).filter((i) => i != null);
    this.visited = new Set([...this.visited].map(convert).filter((i) => i != null));
    if (next) this.order.unshift(...added);
    else this.order.push(...added);
    this.cursor = 0;
    this.count = tracks.length;
  }

  window(limit = 160) {
    const previous = this.history.slice(Math.max(0, this.historyCursor - 30), this.historyCursor + 1);
    const upcoming = this.history.slice(this.historyCursor + 1, this.historyCursor + 1 + limit);
    for (let i = this.cursor; i < this.order.length && previous.length + upcoming.length < limit; i += 1) {
      if (!this.visited.has(this.order[i])) upcoming.push(this.order[i]);
    }
    return [...previous, ...upcoming].slice(0, limit);
  }

  snapshot() {
    return { count: this.count, shuffle: this.shuffle, cycle: this.cycle,
      order: this.order, cursor: this.cursor, visited: [...this.visited],
      history: this.history, historyCursor: this.historyCursor };
  }

  static restore(saved, count) {
    const validIndex = (i) => Number.isInteger(i) && i >= 0 && i < count;
    if (!saved || saved.count !== count || !['order', 'visited', 'history'].every((key) =>
      Array.isArray(saved[key]) && saved[key].every(validIndex)) ||
      new Set(saved.order).size !== saved.order.length ||
      !Number.isInteger(saved.cursor) || saved.cursor < 0 || saved.cursor > saved.order.length ||
      !Number.isInteger(saved.historyCursor) || saved.historyCursor < -1 || saved.historyCursor >= saved.history.length) {
      throw new Error('播放顺序缓存不完整，请重新开始随机播放');
    }
    const restored = new PlaybackOrder(count);
    Object.assign(restored, saved, { visited: new Set(saved.visited), shuffle: Boolean(saved.shuffle) });
    return restored;
  }
}
