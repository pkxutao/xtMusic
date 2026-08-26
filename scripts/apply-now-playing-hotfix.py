#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, content: str) -> None:
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def replace_once(relative: str, old: str, new: str, label: str) -> None:
    source = read(relative)
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match in {relative}, found {count}")
    write(relative, source.replace(old, new, 1))


def append_once(relative: str, marker: str, content: str) -> None:
    source = read(relative)
    if marker in source:
        return
    write(relative, source.rstrip() + "\n\n" + content.strip() + "\n")


# Keep one and only one navigation path for all now-playing entry points.
replace_once(
    "src/renderer/app.js",
    """    this.els.playerVolumeIcon.addEventListener('click', () => this.player.toggleMute());
    this.els.playerQueue.addEventListener('click', () => this.#toggleQueue());
    this.els.playerLyrics.addEventListener('click', () => this.#navigate('lyrics'));
    this.els.playerTitle.addEventListener('click', () => this.#navigate('lyrics'));
    this.els.playerFavorite.addEventListener('click', () => this.#toggleFavorite(this.player.currentTrack));
""",
    """    this.els.playerVolumeIcon.addEventListener('click', () => this.player.toggleMute());
    this.els.playerQueue.addEventListener('click', () => this.#toggleQueue());
    const openNowPlaying = () => this.#openNowPlaying();
    this.els.playerCover.addEventListener('click', openNowPlaying);
    this.els.playerCover.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openNowPlaying();
    });
    this.els.playerLyrics.addEventListener('click', openNowPlaying);
    this.els.playerTitle.addEventListener('click', openNowPlaying);
    this.els.playerFavorite.addEventListener('click', () => this.#toggleFavorite(this.player.currentTrack));
""",
    "now-playing event bindings",
)

replace_once(
    "src/renderer/app.js",
    """  #navigate(name, params = {}) {
    if (name === 'lyrics' && !this.player.currentTrack) {
      this.toast('请先播放一首歌曲', 'warning');
      return;
    }
    this.store.navigate(name, params);
    this.#renderChrome();
    this.#loadRoute(this.store.get().route);
  }
""",
    """  #openNowPlaying() {
    if (!this.player.currentTrack) {
      this.toast('请先播放一首歌曲', 'warning');
      return;
    }
    if (this.store.get().route.name === 'lyrics') {
      this.#syncLyrics(true);
      return;
    }
    this.#navigate('lyrics');
  }

  #navigate(name, params = {}) {
    if (name === 'lyrics' && !this.player.currentTrack) {
      this.toast('请先播放一首歌曲', 'warning');
      return;
    }
    this.store.navigate(name, params);
    this.#renderChrome();
    this.#loadRoute(this.store.get().route);
  }
""",
    "deduplicated now-playing navigation",
)

replace_once(
    "src/renderer/app.js",
    """      case 'open-lyrics':
        this.#navigate('lyrics');
        break;
""",
    """      case 'open-lyrics':
        this.#openNowPlaying();
        break;
""",
    "delegated lyrics action",
)

replace_once(
    "src/renderer/app.js",
    """    this.els.playerCover.innerHTML = coverId
      ? `<img src="${attr(coverUrl(coverId, 256))}" alt="">`
      : icon('music', 23);
    this.els.playerCover.classList.toggle('cover-placeholder', !coverId);
    this.els.playerTitle.textContent = track?.title || '选择一首歌曲';
    this.els.playerArtist.textContent = track ? artistsText(track) : 'XT Music';
""",
    """    const coverMarkup = coverId
      ? `<img src="${attr(coverUrl(coverId, 256))}" alt="">`
      : icon('music', 23);
    this.els.playerCover.innerHTML = `${coverMarkup}<span class="now-playing-equalizer" aria-hidden="true"><i></i><i></i><i></i></span>`;
    this.els.playerCover.classList.toggle('cover-placeholder', !coverId);
    this.els.playerCover.classList.toggle('is-clickable', Boolean(track));
    this.els.playerCover.classList.toggle('is-playing', Boolean(track && state.playing));
    this.els.playerCover.tabIndex = track ? 0 : -1;
    this.els.playerCover.setAttribute('aria-disabled', String(!track));
    this.els.playerCover.title = track ? '打开正在播放和歌词' : '播放歌曲后可打开歌词';
    this.els.playerTitle.textContent = track?.title || '选择一首歌曲';
    this.els.playerTitle.disabled = !track;
    this.els.playerTitle.title = track ? '打开正在播放和歌词' : '';
    this.els.playerArtist.textContent = track ? artistsText(track) : 'XT Music';
""",
    "player cover and title state",
)

replace_once(
    "src/renderer/app.js",
    """    this.els.playerLyrics.innerHTML = icon('lyrics', 18);
    this.els.playerLyrics.classList.toggle('is-active', this.store.get().route.name === 'lyrics');
""",
    """    this.els.playerLyrics.innerHTML = `${icon('lyrics', 18)}<span>歌词</span>`;
    this.els.playerLyrics.classList.toggle('is-active', this.store.get().route.name === 'lyrics');
    this.els.playerLyrics.disabled = !track;
    this.els.playerLyrics.title = track ? '打开正在播放和歌词' : '请先播放一首歌曲';
    document.querySelector('#player-bar')?.classList.toggle('is-playing', Boolean(track && state.playing));
""",
    "visible lyrics button and playing state",
)

# Remove the delegated data-action from the title so its direct click handler is not run twice.
replace_once(
    "src/renderer/index.html",
    """        <div id="player-cover" class="player-cover cover-placeholder">
""",
    """        <div id="player-cover" class="player-cover cover-placeholder" role="button" tabindex="-1" aria-label="打开正在播放和歌词" aria-disabled="true" title="播放歌曲后可打开歌词">
""",
    "accessible player cover",
)
replace_once(
    "src/renderer/index.html",
    """          <button id="player-title" class="now-playing-title" data-action="open-lyrics">选择一首歌曲</button>
""",
    """          <button id="player-title" class="now-playing-title" type="button" title="打开正在播放和歌词">选择一首歌曲</button>
""",
    "single title click path",
)
replace_once(
    "src/renderer/index.html",
    """        <button id="player-lyrics" class="icon-button subtle" aria-label="歌词"></button>
""",
    """        <button id="player-lyrics" class="icon-button subtle player-lyrics-button" aria-label="打开歌词" title="打开正在播放和歌词"></button>
""",
    "visible lyrics entry",
)

# Break the MutationObserver feedback loop that starved the renderer after opening lyrics.
replace_once(
    "src/renderer/lyrics-experience.js",
    """    observer.observe(contentRoot, { childList: true, subtree: true });
""",
    """    // Only watch direct route replacements. Observing the full lyrics subtree
    // caused toolbar text updates to recursively retrigger enhancement forever.
    observer.observe(contentRoot, { childList: true });
""",
    "bounded content observer",
)
replace_once(
    "src/renderer/lyrics-experience.js",
    """    if (page === activePage) {
      if (page) enhancePage(page);
      return;
    }
""",
    """    if (page === activePage) return;
""",
    "idempotent page inspection",
)
replace_once(
    "src/renderer/lyrics-experience.js",
    """    const lineObserver = new MutationObserver((records) => {
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
""",
    """    const lineObserver = new MutationObserver((records) => {
      const needsRefresh = records.some((record) => {
        if (record.type === 'childList') return true;
        if (record.type !== 'attributes' || record.attributeName !== 'class') return false;
        const before = String(record.oldValue || '').split(/\\s+/).includes('is-active');
        const after = record.target.classList.contains('is-active');
        return before !== after;
      });
      if (!needsRefresh) return;
      refreshLineMetadata(page);
      updateLineStates(page);
    });
    lineObserver.observe(scroll || page, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
      childList: true,
      subtree: true
    });
""",
    "non-recursive lyric line observer",
)
replace_once(
    "src/renderer/lyrics-experience.js",
    """      line.setAttribute('aria-label', `${line.textContent?.trim() || '空白歌词'}，${formatTime(seconds)}`);
""",
    """      const ariaLabel = `${line.textContent?.trim() || '空白歌词'}，${formatTime(seconds)}`;
      if (line.getAttribute('aria-label') !== ariaLabel) line.setAttribute('aria-label', ariaLabel);
""",
    "idempotent lyric aria metadata",
)
replace_once(
    "src/renderer/lyrics-experience.js",
    """    const counter = page.querySelector('#lyrics-line-counter');
    if (counter) {
      counter.textContent = activeIndex >= 0
        ? `${String(activeIndex + 1).padStart(2, '0')} / ${String(lines.length).padStart(2, '0')}`
        : `-- / ${String(lines.length).padStart(2, '0')}`;
    }
""",
    """    const counter = page.querySelector('#lyrics-line-counter');
    if (counter) {
      const nextText = activeIndex >= 0
        ? `${String(activeIndex + 1).padStart(2, '0')} / ${String(lines.length).padStart(2, '0')}`
        : `-- / ${String(lines.length).padStart(2, '0')}`;
      if (counter.textContent !== nextText) counter.textContent = nextText;
    }
""",
    "idempotent lyric counter",
)
replace_once(
    "src/renderer/lyrics-experience.js",
    """    const time = page.querySelector('#lyrics-toolbar-time');
    if (time) time.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
""",
    """    const time = page.querySelector('#lyrics-toolbar-time');
    if (time) {
      const nextText = `${formatTime(current)} / ${formatTime(duration)}`;
      if (time.textContent !== nextText) time.textContent = nextText;
    }
""",
    "idempotent lyric clock",
)
replace_once(
    "src/renderer/lyrics-experience.js",
    """      state.lineObserver?.disconnect();
      for (const cleanup of state.cleanup) cleanup();
""",
    """      state.lineObserver?.disconnect();
      const animation = state.scroll ? scrollAnimations.get(state.scroll) : null;
      if (animation) cancelAnimationFrame(animation.raf);
      if (state.scroll) scrollAnimations.delete(state.scroll);
      for (const cleanup of state.cleanup) cleanup();
""",
    "lyrics animation teardown",
)

append_once(
    "src/renderer/styles.css",
    "XT Music now-playing and lyrics entry 0.3.6",
    r"""
/* XT Music now-playing and lyrics entry 0.3.6 */
.player-cover {
  position: relative;
  overflow: hidden;
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
}

.player-cover.is-clickable {
  cursor: pointer;
}

.player-cover.is-clickable:hover {
  transform: translateY(-1px) scale(1.025);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.26), 0 0 0 1px rgba(229, 255, 79, 0.32);
}

.player-cover.is-clickable:focus-visible,
.now-playing-title:focus-visible,
.player-lyrics-button:focus-visible {
  outline: 2px solid var(--accent, #e5ff4f);
  outline-offset: 3px;
}

.now-playing-equalizer {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 21px;
  height: 17px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  padding: 3px;
  border-radius: 6px;
  background: rgba(8, 10, 13, 0.78);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  opacity: 0;
  transform: translateY(4px) scale(0.9);
  transition: opacity 150ms ease, transform 150ms ease;
  pointer-events: none;
}

.player-cover.is-playing .now-playing-equalizer {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.now-playing-equalizer i {
  display: block;
  width: 2px;
  min-height: 3px;
  border-radius: 999px;
  background: var(--accent, #e5ff4f);
  animation: xt-now-playing-bar 760ms ease-in-out infinite alternate;
}

.now-playing-equalizer i:nth-child(1) { height: 45%; animation-delay: -180ms; }
.now-playing-equalizer i:nth-child(2) { height: 95%; animation-delay: -420ms; }
.now-playing-equalizer i:nth-child(3) { height: 66%; animation-delay: -80ms; }

.player-bar.is-playing .progress-range::-webkit-slider-thumb {
  box-shadow: 0 0 0 4px rgba(229, 255, 79, 0.12);
}

.player-lyrics-button {
  width: auto !important;
  min-width: 62px;
  padding: 0 10px !important;
  gap: 6px;
  border-radius: 10px !important;
}

.player-lyrics-button span {
  display: inline-block;
  font-size: 12px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.now-playing-title:not(:disabled) {
  cursor: pointer;
}

@keyframes xt-now-playing-bar {
  from { transform: scaleY(0.35); }
  to { transform: scaleY(1); }
}

@media (prefers-reduced-motion: reduce) {
  .now-playing-equalizer i { animation: none; }
  .player-cover { transition: none; }
}

@media (max-width: 980px) {
  .player-lyrics-button {
    min-width: 36px;
    width: 36px !important;
    padding: 0 !important;
  }
  .player-lyrics-button span { display: none; }
}
""",
)

# Give the Windows smoke environment real synchronized lyrics.
replace_once(
    "scripts/windows-post-login-preload.js",
    """      if (method === 'getLyrics') return { text: '' };
""",
    """      if (method === 'getLyrics') {
        return { text: '[00:00.00]第一行歌词\\n[00:00.80]第二行歌词\\n[00:01.60]第三行歌词' };
      }
""",
    "smoke-test lyrics fixture",
)

# Add source-level regression assertions for the two root causes.
write(
    "tests/now-playing-lyrics-regression.test.js",
    """'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const lyrics = fs.readFileSync(path.join(root, 'src/renderer/lyrics-experience.js'), 'utf8');

 test('now-playing cover, title and visible lyrics button share one entry path', () => {
  assert.match(appSource, /playerCover\.addEventListener\('click', openNowPlaying\)/);
  assert.match(appSource, /playerTitle\.addEventListener\('click', openNowPlaying\)/);
  assert.match(appSource, /playerLyrics\.addEventListener\('click', openNowPlaying\)/);
  assert.match(appSource, /now-playing-equalizer/);
  assert.match(appSource, /<span>歌词<\/span>/);
  assert.doesNotMatch(html, /id="player-title"[^>]*data-action=/);
  assert.match(html, /id="player-cover"[^>]*role="button"/);
});

 test('lyrics observers cannot recursively react to toolbar text updates', () => {
  assert.match(lyrics, /observer\.observe\(contentRoot, \{ childList: true \}\)/);
  assert.doesNotMatch(lyrics, /observer\.observe\(contentRoot, \{ childList: true, subtree: true \}\)/);
  assert.match(lyrics, /if \(page === activePage\) return;/);
  assert.match(lyrics, /lineObserver\.observe\(scroll \|\| page/);
  assert.match(lyrics, /attributeOldValue: true/);
  assert.match(lyrics, /if \(counter\.textContent !== nextText\)/);
  assert.match(lyrics, /if \(time\.textContent !== nextText\)/);
});
""",
)

# Version the test package independently from the previous large-library build.
package_path = ROOT / "package.json"
package_data = json.loads(package_path.read_text(encoding="utf-8"))
package_data["version"] = "0.3.6"
package_data["description"] = "Responsive large-library build with restored now-playing entry, visible playback feedback, and deadlock-free synchronized lyrics."
package_data.setdefault("build", {}).setdefault("nsis", {})["shortcutName"] = "XT Music"
package_path.write_text(json.dumps(package_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

lock_path = ROOT / "package-lock.json"
lock_data = json.loads(lock_path.read_text(encoding="utf-8"))
lock_data["version"] = "0.3.6"
if isinstance(lock_data.get("packages"), dict) and isinstance(lock_data["packages"].get(""), dict):
    lock_data["packages"][""]["version"] = "0.3.6"
lock_path.write_text(json.dumps(lock_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("Applied XT Music 0.3.6 now-playing and lyrics hotfix")
