import {
  albumText,
  artistsText,
  escapeHtml,
  formatDate,
  formatDuration,
  icon,
  imageHtml,
  trackDuration
} from './utils.js';

export class VirtualTrackTable {
  constructor(host, tracks, options = {}) {
    this.host = host;
    this.tracks = Array.isArray(tracks) ? tracks : [];
    this.options = options;
    this.rowHeight = options.rowHeight || 58;
    this.overscan = options.overscan || 8;
    this.selected = new Set();
    this.renderedRange = '';
    this.#mount();
  }

  #mount() {
    this.host.classList.add('virtual-track-table');
    this.host.innerHTML = `
      <div class="track-table-head">
        <div class="track-col-index">#</div>
        <div class="track-col-title">标题</div>
        <div class="track-col-album">专辑</div>
        <div class="track-col-date">添加时间</div>
        <div class="track-col-actions"></div>
        <div class="track-col-duration">${icon('history', 15)}</div>
      </div>
      <div class="track-table-viewport" tabindex="0">
        <div class="track-table-spacer"></div>
        <div class="track-table-rows"></div>
      </div>
    `;
    this.viewport = this.host.querySelector('.track-table-viewport');
    this.spacer = this.host.querySelector('.track-table-spacer');
    this.rows = this.host.querySelector('.track-table-rows');
    this.spacer.style.height = `${this.tracks.length * this.rowHeight}px`;
    this.viewport.addEventListener('scroll', () => this.render());
    this.viewport.addEventListener('dblclick', (event) => {
      const row = event.target.closest('[data-track-index]');
      if (!row) return;
      this.options.onActivate?.(Number(row.dataset.trackIndex), this.tracks[Number(row.dataset.trackIndex)]);
    });
    this.viewport.addEventListener('click', (event) => this.#handleClick(event));
    this.viewport.addEventListener('contextmenu', (event) => {
      const row = event.target.closest('[data-track-index]');
      if (!row) return;
      event.preventDefault();
      const index = Number(row.dataset.trackIndex);
      this.options.onContext?.(event, index, this.tracks[index]);
    });
    this.render();
  }

  #handleClick(event) {
    const row = event.target.closest('[data-track-index]');
    if (!row) return;
    const index = Number(row.dataset.trackIndex);
    const track = this.tracks[index];
    const action = event.target.closest('[data-track-action]')?.dataset.trackAction;
    if (action) {
      event.stopPropagation();
      this.options.onAction?.(action, index, track, event);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (this.selected.has(index)) this.selected.delete(index);
      else this.selected.add(index);
    } else if (event.shiftKey && this.lastSelected != null) {
      const [start, end] = [this.lastSelected, index].sort((a, b) => a - b);
      for (let i = start; i <= end; i += 1) this.selected.add(i);
    } else {
      this.selected.clear();
      this.selected.add(index);
    }
    this.lastSelected = index;
    this.renderedRange = '';
    this.render();
    this.options.onSelection?.([...this.selected].map((i) => this.tracks[i]));
  }

  render() {
    const height = this.viewport.clientHeight || 500;
    const start = Math.max(0, Math.floor(this.viewport.scrollTop / this.rowHeight) - this.overscan);
    const end = Math.min(
      this.tracks.length,
      Math.ceil((this.viewport.scrollTop + height) / this.rowHeight) + this.overscan
    );
    const key = `${start}:${end}:${[...this.selected].join(',')}:${this.options.activeGuid || ''}`;
    if (key === this.renderedRange) return;
    this.renderedRange = key;
    const html = [];
    for (let index = start; index < end; index += 1) {
      const track = this.tracks[index];
      const active = this.options.activeGuid && this.options.activeGuid === track.guid;
      const selected = this.selected.has(index);
      html.push(this.#row(track, index, active, selected));
    }
    this.rows.innerHTML = html.join('');
  }

  #row(track, index, active, selected) {
    const coverId = track.coverId || track.album?.coverId;
    const artists = artistsText(track);
    return `
      <div class="track-table-row ${active ? 'is-active' : ''} ${selected ? 'is-selected' : ''}"
           data-track-index="${index}"
           style="transform:translateY(${index * this.rowHeight}px);height:${this.rowHeight}px">
        <div class="track-col-index">
          <span class="track-row-number">${active ? icon('volume', 16) : index + 1}</span>
          <button class="row-play-button" data-track-action="play" aria-label="播放">${icon('play', 15)}</button>
        </div>
        <div class="track-col-title">
          ${imageHtml(coverId, track.title, 'track-row-cover', 128)}
          <div class="track-row-title-wrap">
            <div class="track-row-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title || '未知标题')}</div>
            <div class="track-row-subtitle" title="${escapeHtml(artists)}">${escapeHtml(artists)}</div>
          </div>
        </div>
        <div class="track-col-album" title="${escapeHtml(albumText(track))}">${escapeHtml(albumText(track))}</div>
        <div class="track-col-date">${formatDate(track.createdAt)}</div>
        <div class="track-col-actions">
          <button class="icon-button subtle ${track.isFavorite ? 'is-favorite' : ''}"
                  data-track-action="${track.isFavorite ? 'unfavorite' : 'favorite'}"
                  aria-label="${track.isFavorite ? '取消收藏' : '收藏'}">
            ${icon(track.isFavorite ? 'heartFill' : 'heart', 17)}
          </button>
          <button class="icon-button subtle" data-track-action="more" aria-label="更多">${icon('more', 18)}</button>
        </div>
        <div class="track-col-duration">${formatDuration(trackDuration(track))}</div>
      </div>
    `;
  }

  setTracks(tracks) {
    this.tracks = Array.isArray(tracks) ? tracks : [];
    this.selected.clear();
    this.spacer.style.height = `${this.tracks.length * this.rowHeight}px`;
    this.renderedRange = '';
    this.viewport.scrollTop = 0;
    this.render();
  }

  setActiveGuid(guid) {
    this.options.activeGuid = guid;
    this.renderedRange = '';
    this.render();
  }

  scrollToIndex(index, align = 'center') {
    if (index < 0 || index >= this.tracks.length) return;
    const target = index * this.rowHeight;
    this.viewport.scrollTo({
      top: align === 'center' ? Math.max(0, target - this.viewport.clientHeight / 2) : target,
      behavior: 'smooth'
    });
  }

  destroy() {
    this.host.innerHTML = '';
  }
}
