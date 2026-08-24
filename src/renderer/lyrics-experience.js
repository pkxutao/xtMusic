'use strict';

(() => {
  const PAGE_SELECTOR = '.lyrics-page';
  const LINE_SELECTOR = '.lyrics-scroll .lyric-line';
  const MANUAL_SCROLL_TIMEOUT = 3200;
  const AUTO_SCROLL_DURATION = 680;
  const pageStates = new WeakMap();
  const scrollAnimations = new WeakMap();
  let activePage = null;
  let progressRaf = 0;
  let lastProgressRead = 0;
  const playbackClock = {
    currentTime: 0,
    duration: 0,
    paused: true,
    playbackRate: 1,
    updatedAt: 0,
    ready: false
  };

  installScopedScrollIntoView();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  function start() {
    const contentRoot = document.querySelector('#content-root');
    if (!contentRoot) return;

    const observer = new MutationObserver(() => inspectContent(contentRoot));
    observer.observe(contentRoot, { childList: true, subtree: true });
    inspectContent(contentRoot);

    document.addEventListener('keydown', handleGlobalKeydown, true);
    for (const eventName of [
      'loadedmetadata',
      'durationchange',
      'timeupdate',
      'seeking',
      'seeked',
      'play',
      'pause',
      'ratechange',
      'emptied'
    ]) {
      document.addEventListener(eventName, syncPlaybackClock, true);
    }
    progressRaf = requestAnimationFrame(updateProgressLoop);
  }

  function inspectContent(contentRoot) {
    const page = contentRoot.querySelector(PAGE_SELECTOR);
    if (page === activePage) {
      if (page) enhancePage(page);
      return;
    }

    if (activePage) teardownPage(activePage);
    activePage = page || null;

    if (activePage) enhancePage(activePage);
  }

  function enhancePage(page) {
    if (page.dataset.lyricsEnhanced === 'true') {
      refreshLineMetadata(page);
      updateLineStates(page);
      return;
    }

    page.dataset.lyricsEnhanced = 'true';
    page.dataset.lyricsManualScroll = 'false';
    page.classList.add('lyrics-enhanced');
    document.documentElement.classList.add('lyrics-experience-active');
    document.querySelector('#app-shell')?.classList.add('lyrics-experience-active');

    const scroll = page.querySelector('.lyrics-scroll');
    const coverColumn = page.querySelector('.lyrics-cover-column');
    const cover = page.querySelector('.lyrics-cover');
    const trackCopy = page.querySelector('.lyrics-track-copy');

    installAtmosphere(page);
    installToolbar(page);
    installFollowButton(page);
    installCoverDetails(coverColumn, cover, trackCopy);
    refreshLineMetadata(page);
    updateLineStates(page);

    const state = {
      cleanup: [],
      lineObserver: null,
      manualTimer: 0,
      pointerRaf: 0,
      latestPointer: null,
      scroll
    };
    pageStates.set(page, state);

    if (scroll) {
      const markManual = () => setManualScroll(page, true);
      const onPointerDown = (event) => {
        if (event.target.closest('.lyric-line')) return;
        markManual();
      };
      const onLineClick = (event) => {
        if (!event.target.closest('.lyric-line')) return;
        setManualScroll(page, false, { recenter: false });
        requestAnimationFrame(() => centerActiveLine(page, AUTO_SCROLL_DURATION));
      };

      scroll.addEventListener('wheel', markManual, { passive: true });
      scroll.addEventListener('touchstart', markManual, { passive: true });
      scroll.addEventListener('pointerdown', onPointerDown, { passive: true });
      scroll.addEventListener('click', onLineClick);
      state.cleanup.push(() => scroll.removeEventListener('wheel', markManual));
      state.cleanup.push(() => scroll.removeEventListener('touchstart', markManual));
      state.cleanup.push(() => scroll.removeEventListener('pointerdown', onPointerDown));
      state.cleanup.push(() => scroll.removeEventListener('click', onLineClick));
    }

    const lineObserver = new MutationObserver((records) => {
      if (!records.some((record) => record.type === 'attributes' || record.type === 'childList')) return;
      refreshLineMetadata(page);
      updateLineStates(page);
    });
    lineObserver.observe(page, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true
    });
    state.lineObserver = lineObserver;

    const onPointerMove = (event) => {
      state.latestPointer = event;
      if (state.pointerRaf) return;
      state.pointerRaf = requestAnimationFrame(() => {
        state.pointerRaf = 0;
        const current = state.latestPointer;
        if (!current || !page.isConnected) return;
        const rect = page.getBoundingClientRect();
        const x = ((current.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
        const y = ((current.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
        page.style.setProperty('--lyrics-pointer-x', x.toFixed(3));
        page.style.setProperty('--lyrics-pointer-y', y.toFixed(3));
      });
    };
    const resetPointer = () => {
      page.style.setProperty('--lyrics-pointer-x', '0');
      page.style.setProperty('--lyrics-pointer-y', '0');
    };
    page.addEventListener('pointermove', onPointerMove, { passive: true });
    page.addEventListener('pointerleave', resetPointer, { passive: true });
    state.cleanup.push(() => page.removeEventListener('pointermove', onPointerMove));
    state.cleanup.push(() => page.removeEventListener('pointerleave', resetPointer));

    if (cover) {
      const togglePlayback = () => document.querySelector('#player-toggle')?.click();
      cover.addEventListener('dblclick', togglePlayback);
      state.cleanup.push(() => cover.removeEventListener('dblclick', togglePlayback));
      cover.setAttribute('title', '双击播放或暂停');
    }

    requestAnimationFrame(() => {
      page.classList.add('is-ready');
      centerActiveLine(page, 0);
    });
  }

  function teardownPage(page) {
    const state = pageStates.get(page);
    if (state) {
      clearTimeout(state.manualTimer);
      if (state.pointerRaf) cancelAnimationFrame(state.pointerRaf);
      state.lineObserver?.disconnect();
      for (const cleanup of state.cleanup) cleanup();
      pageStates.delete(page);
    }

    document.documentElement.classList.remove('lyrics-experience-active');
    document.querySelector('#app-shell')?.classList.remove('lyrics-experience-active');
  }

  function installAtmosphere(page) {
    if (page.querySelector(':scope > .lyrics-atmosphere')) return;
    const atmosphere = document.createElement('div');
    atmosphere.className = 'lyrics-atmosphere';
    atmosphere.setAttribute('aria-hidden', 'true');
    atmosphere.innerHTML = `
      <span class="lyrics-ambient-orb lyrics-ambient-orb-a"></span>
      <span class="lyrics-ambient-orb lyrics-ambient-orb-b"></span>
      <span class="lyrics-grain"></span>
    `;
    const backdrop = page.querySelector(':scope > .lyrics-backdrop');
    backdrop?.after(atmosphere);
  }

  function installToolbar(page) {
    if (page.querySelector(':scope > .lyrics-toolbar')) return;
    const toolbar = document.createElement('div');
    toolbar.className = 'lyrics-toolbar';
    toolbar.innerHTML = `
      <div class="lyrics-toolbar-status">
        <span class="lyrics-live-dot" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="lyrics-toolbar-copy">
          <strong>同步歌词</strong>
          <small>点击任意歌词可跳转播放</small>
        </span>
      </div>
      <div class="lyrics-toolbar-actions">
        <span id="lyrics-line-counter" class="lyrics-line-counter">-- / --</span>
        <span id="lyrics-toolbar-time" class="lyrics-toolbar-time">0:00 / 0:00</span>
        <button class="lyrics-toolbar-button" type="button" data-lyrics-recenter title="回到当前歌词" aria-label="回到当前歌词">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path>
          </svg>
        </button>
        <span class="lyrics-escape-hint"><kbd>Esc</kbd> 返回</span>
      </div>
    `;
    page.prepend(toolbar);
    toolbar.querySelector('[data-lyrics-recenter]')?.addEventListener('click', () => {
      setManualScroll(page, false, { recenter: true });
    });
  }

  function installFollowButton(page) {
    if (page.querySelector(':scope > .lyrics-follow-button')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lyrics-follow-button';
    button.setAttribute('data-lyrics-follow', '');
    button.innerHTML = `
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path>
      </svg>
      <span>回到当前歌词</span>
    `;
    button.addEventListener('click', () => setManualScroll(page, false, { recenter: true }));
    page.append(button);
  }

  function installCoverDetails(column, cover, trackCopy) {
    if (!column || column.dataset.lyricsCoverEnhanced === 'true') return;
    column.dataset.lyricsCoverEnhanced = 'true';

    if (cover) {
      const aura = document.createElement('div');
      aura.className = 'lyrics-cover-aura';
      aura.setAttribute('aria-hidden', 'true');
      cover.before(aura);
    }

    if (trackCopy) {
      const meta = document.createElement('div');
      meta.className = 'lyrics-track-meta';
      meta.innerHTML = `
        <span class="lyrics-equalizer" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span>正在播放</span>
      `;
      trackCopy.prepend(meta);
    }
  }

  function refreshLineMetadata(page) {
    const lines = [...page.querySelectorAll(LINE_SELECTOR)];
    for (const line of lines) {
      const seconds = Number(line.dataset.lyricTime);
      if (Number.isFinite(seconds)) line.dataset.timeLabel = formatTime(seconds);
      line.setAttribute('aria-label', `${line.textContent?.trim() || '空白歌词'}，${formatTime(seconds)}`);
    }
  }

  function updateLineStates(page) {
    const lines = [...page.querySelectorAll(LINE_SELECTOR)];
    if (!lines.length) return;

    let activeIndex = lines.findIndex((line) => line.classList.contains('is-active'));
    if (activeIndex < 0) {
      const declared = Number(lines[0]?.closest('.lyrics-scroll')?.dataset.activeIndex);
      if (Number.isInteger(declared)) activeIndex = declared;
    }

    lines.forEach((line, index) => {
      const distance = activeIndex < 0 ? 99 : Math.abs(index - activeIndex);
      line.classList.toggle('is-before-active', activeIndex >= 0 && index < activeIndex);
      line.classList.toggle('is-after-active', activeIndex >= 0 && index > activeIndex);
      for (let value = 1; value <= 3; value += 1) {
        line.classList.toggle(`lyrics-distance-${value}`, distance === value);
      }
      line.classList.toggle('lyrics-distance-far', distance > 3);
      if (!line.classList.contains('is-active')) {
        line.style.removeProperty('--lyric-progress');
      }
    });

    const counter = page.querySelector('#lyrics-line-counter');
    if (counter) {
      counter.textContent = activeIndex >= 0
        ? `${String(activeIndex + 1).padStart(2, '0')} / ${String(lines.length).padStart(2, '0')}`
        : `-- / ${String(lines.length).padStart(2, '0')}`;
    }
  }

  function setManualScroll(page, manual, { recenter = false } = {}) {
    const state = pageStates.get(page);
    if (!state) return;

    clearTimeout(state.manualTimer);
    page.dataset.lyricsManualScroll = manual ? 'true' : 'false';
    page.classList.toggle('is-manual-scroll', manual);

    if (manual) {
      state.manualTimer = window.setTimeout(() => {
        if (!page.isConnected) return;
        setManualScroll(page, false, { recenter: true });
      }, MANUAL_SCROLL_TIMEOUT);
      return;
    }

    if (recenter) centerActiveLine(page, AUTO_SCROLL_DURATION);
  }

  function centerActiveLine(page, duration = AUTO_SCROLL_DURATION) {
    const active = page.querySelector(`${LINE_SELECTOR}.is-active`);
    const scroll = page.querySelector('.lyrics-scroll');
    if (!active || !scroll) return;
    smoothCenter(scroll, active, duration);
  }

  function installScopedScrollIntoView() {
    const prototype = Element.prototype;
    if (prototype.scrollIntoView.__xtMusicLyricsPatched) return;

    const nativeScrollIntoView = prototype.scrollIntoView;
    const patched = function patchedScrollIntoView(options) {
      if (!this.matches?.(LINE_SELECTOR)) {
        return nativeScrollIntoView.call(this, options);
      }

      const page = this.closest(PAGE_SELECTOR);
      const scroll = this.closest('.lyrics-scroll');
      if (!page || !scroll) return nativeScrollIntoView.call(this, options);
      if (page.dataset.lyricsManualScroll === 'true' && options?.behavior !== 'auto') return undefined;

      const instant = options?.behavior === 'auto' || matchMedia('(prefers-reduced-motion: reduce)').matches;
      smoothCenter(scroll, this, instant ? 0 : AUTO_SCROLL_DURATION);
      return undefined;
    };
    Object.defineProperty(patched, '__xtMusicLyricsPatched', { value: true });
    prototype.scrollIntoView = patched;
  }

  function smoothCenter(container, line, duration) {
    const previous = scrollAnimations.get(container);
    if (previous) cancelAnimationFrame(previous.raf);

    const max = Math.max(0, container.scrollHeight - container.clientHeight);
    const target = clamp(
      line.offsetTop - ((container.clientHeight - line.offsetHeight) / 2),
      0,
      max
    );
    const start = container.scrollTop;
    const distance = target - start;

    if (duration <= 0 || Math.abs(distance) < 1) {
      container.scrollTop = target;
      scrollAnimations.delete(container);
      return;
    }

    const startedAt = performance.now();
    const animation = { raf: 0 };
    const step = (now) => {
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      container.scrollTop = start + distance * eased;
      if (progress < 1) {
        animation.raf = requestAnimationFrame(step);
      } else {
        scrollAnimations.delete(container);
      }
    };
    animation.raf = requestAnimationFrame(step);
    scrollAnimations.set(container, animation);
  }

  function updateProgressLoop(now) {
    if (activePage?.isConnected && now - lastProgressRead >= 80) {
      lastProgressRead = now;
      updateActiveLineProgress(activePage);
    }
    progressRaf = requestAnimationFrame(updateProgressLoop);
  }

  function updateActiveLineProgress(page) {
    const active = page.querySelector(`${LINE_SELECTOR}.is-active`);
    const progressInput = document.querySelector('#player-progress');
    const durationText = document.querySelector('#player-duration')?.textContent || '';
    const fallbackDuration = parseTime(durationText);
    const duration = playbackClock.ready && Number.isFinite(playbackClock.duration)
      ? playbackClock.duration
      : fallbackDuration;
    if (!active || !Number.isFinite(duration) || duration <= 0) return;

    const fallbackCurrent = progressInput
      ? (Number(progressInput.value || 0) / 1000) * duration
      : 0;
    const current = playbackClock.ready
      ? currentClockTime(performance.now(), duration)
      : fallbackCurrent;
    const lines = [...page.querySelectorAll(LINE_SELECTOR)];
    const index = lines.indexOf(active);
    const start = Number(active.dataset.lyricTime || 0);
    const next = Number(lines[index + 1]?.dataset.lyricTime ?? duration);
    const span = Math.max(0.35, next - start);
    const lineProgress = clamp((current - start) / span, 0, 1);

    active.style.setProperty('--lyric-progress', `${(lineProgress * 100).toFixed(2)}%`);
    page.style.setProperty('--lyrics-track-progress', `${clamp((current / duration) * 100, 0, 100).toFixed(2)}%`);

    const time = page.querySelector('#lyrics-toolbar-time');
    if (time) time.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
  }

  function syncPlaybackClock(event) {
    const media = event.target;
    if (!(media instanceof HTMLMediaElement) || media.tagName !== 'AUDIO') return;

    const duration = Number(media.duration);
    playbackClock.currentTime = Number.isFinite(media.currentTime) ? media.currentTime : 0;
    playbackClock.duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    playbackClock.paused = media.paused || event.type === 'pause' || event.type === 'emptied';
    playbackClock.playbackRate = Number.isFinite(media.playbackRate) ? media.playbackRate : 1;
    playbackClock.updatedAt = performance.now();
    playbackClock.ready = event.type !== 'emptied';
  }

  function currentClockTime(now, duration) {
    const elapsed = playbackClock.paused
      ? 0
      : Math.max(0, now - playbackClock.updatedAt) / 1000 * playbackClock.playbackRate;
    return clamp(playbackClock.currentTime + elapsed, 0, duration);
  }

  function handleGlobalKeydown(event) {
    if (event.key !== 'Escape' || !activePage?.isConnected) return;
    if (document.querySelector('#modal-root > *') || document.querySelector('#context-menu-root > *')) return;
    const back = document.querySelector('#history-back');
    if (!back || back.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    back.click();
  }

  function formatTime(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
      : `${minutes}:${String(rest).padStart(2, '0')}`;
  }

  function parseTime(value) {
    const parts = String(value || '')
      .trim()
      .split(':')
      .map((part) => Number(part));
    if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
})();
