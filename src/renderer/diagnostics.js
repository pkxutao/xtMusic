(() => {
  'use strict';

  const diagnostics = window.xtMusic?.diagnostics;
  if (!diagnostics?.log) return;

  const startedAt = performance.now();
  let lastDomSignature = '';
  let lastSampleAt = 0;
  let mutationTimer = null;
  let frameCount = 0;
  let frameWindowStarted = performance.now();
  let expectedHeartbeat = performance.now() + 500;

  const log = (event, details = {}, level = 'info') => {
    try {
      diagnostics.log(`renderer:${event}`, {
        elapsedMs: round(performance.now() - startedAt),
        ...details
      }, level);
    } catch {
      // Diagnostics must remain side-effect free.
    }
  };

  log('script-start', {
    readyState: document.readyState,
    visibility: document.visibilityState,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGB: navigator.deviceMemory || null,
    language: navigator.language,
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      devicePixelRatio: window.devicePixelRatio
    }
  });

  window.addEventListener('error', (event) => {
    log('window-error', {
      message: event.message,
      file: basename(event.filename),
      line: event.lineno,
      column: event.colno,
      error: errorDetails(event.error)
    }, 'error');
  });

  window.addEventListener('unhandledrejection', (event) => {
    log('unhandled-rejection', {
      error: errorDetails(event.reason)
    }, 'error');
  });

  document.addEventListener('DOMContentLoaded', () => {
    log('dom-content-loaded', navigationTimings());
    installDomObservers();
    sampleDom('dom-content-loaded', true);
  }, { once: true });

  window.addEventListener('load', () => {
    log('window-load', navigationTimings());
    sampleDom('window-load', true);
  }, { once: true });

  window.addEventListener('beforeunload', () => {
    sampleDom('beforeunload', true);
    log('beforeunload');
  });

  document.addEventListener('visibilitychange', () => {
    log('visibility-change', { visibility: document.visibilityState });
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    log('form-submit', {
      id: form?.id || '',
      isLogin: form?.id === 'login-form'
    });
    setTimeout(() => sampleDom('after-form-submit', true), 0);
  }, true);

  document.addEventListener('click', (event) => {
    const target = event.target?.closest?.('[data-route], [data-action], [data-play-guid], [data-open-kind], #player-queue');
    if (!target) return;
    log('ui-click', {
      route: target.dataset?.route || null,
      action: target.dataset?.action || null,
      hasPlayGuid: Boolean(target.dataset?.playGuid),
      openKind: target.dataset?.openKind || null,
      isQueueToggle: target.id === 'player-queue'
    }, 'debug');
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
    if (event.code === 'KeyL') {
      event.preventDefault();
      log('copy-shortcut');
      diagnostics.copy().catch((error) => log('copy-shortcut-error', errorDetails(error), 'error'));
    }
    if (event.code === 'KeyO') {
      event.preventDefault();
      log('open-folder-shortcut');
      diagnostics.openFolder().catch((error) => log('open-folder-shortcut-error', errorDetails(error), 'error'));
    }
  }, true);

  if ('PerformanceObserver' in window) {
    try {
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < 80) continue;
          log('long-task', {
            durationMs: round(entry.duration),
            startTimeMs: round(entry.startTime),
            name: entry.name
          }, entry.duration >= 1000 ? 'error' : 'warning');
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch (error) {
      log('long-task-observer-unavailable', errorDetails(error), 'debug');
    }

    try {
      const resourceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < 1500) continue;
          log('slow-resource', {
            durationMs: round(entry.duration),
            initiatorType: entry.initiatorType,
            resource: resourceLabel(entry.name),
            transferSize: entry.transferSize || 0,
            decodedBodySize: entry.decodedBodySize || 0
          }, 'warning');
        }
      });
      resourceObserver.observe({ entryTypes: ['resource'] });
    } catch (error) {
      log('resource-observer-unavailable', errorDetails(error), 'debug');
    }
  }

  const heartbeat = setInterval(() => {
    const now = performance.now();
    const lagMs = Math.max(0, now - expectedHeartbeat);
    expectedHeartbeat = now + 500;
    if (lagMs >= 120) {
      log('event-loop-lag', {
        lagMs: round(lagMs),
        dom: domSummary()
      }, lagMs >= 1000 ? 'error' : 'warning');
    }
    if (now - lastSampleAt >= 5000) sampleDom('interval');
  }, 500);

  const frame = (now) => {
    frameCount += 1;
    const elapsed = now - frameWindowStarted;
    if (elapsed >= 5000) {
      const fps = document.visibilityState === 'visible'
        ? round((frameCount * 1000) / elapsed)
        : null;
      if (fps != null && fps < 20) {
        log('low-frame-rate', { fps, windowMs: round(elapsed), dom: domSummary() }, 'warning');
      }
      frameCount = 0;
      frameWindowStarted = now;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.addEventListener('pagehide', () => clearInterval(heartbeat), { once: true });

  function installDomObservers() {
    const roots = [
      document.querySelector('#login-root'),
      document.querySelector('#app-shell'),
      document.querySelector('#content-root'),
      document.querySelector('#sidebar-root'),
      document.querySelector('#queue-panel'),
      document.querySelector('#toast-root')
    ].filter(Boolean);
    if (!roots.length || !('MutationObserver' in window)) return;
    const observer = new MutationObserver((mutations) => {
      const significant = mutations.some((mutation) =>
        mutation.type === 'childList' || mutation.attributeName === 'class'
      );
      if (!significant) return;
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => sampleDom('mutation'), 250);
    });
    for (const root of roots) {
      observer.observe(root, {
        childList: true,
        subtree: false,
        attributes: true,
        attributeFilter: ['class']
      });
    }
  }

  function sampleDom(reason, force = false) {
    lastSampleAt = performance.now();
    const summary = domSummary();
    const signature = JSON.stringify(summary);
    if (!force && signature === lastDomSignature && reason !== 'interval') return;
    lastDomSignature = signature;
    log('dom-sample', { reason, ...summary }, 'debug');
  }

  function domSummary() {
    const page = document.querySelector('#content-root > .page, #content-root .page');
    const memory = performance.memory;
    return {
      readyState: document.readyState,
      visibility: document.visibilityState,
      loginVisible: isVisible(document.querySelector('#login-root')),
      shellVisible: isVisible(document.querySelector('#app-shell')),
      splashVisible: isVisible(document.querySelector('#splash')),
      pageClass: page?.className || null,
      contentChildren: document.querySelector('#content-root')?.childElementCount || 0,
      totalNodes: document.querySelectorAll('*').length,
      imageCount: document.images.length,
      incompleteImages: [...document.images].filter((image) => !image.complete).length,
      playlistRows: document.querySelectorAll('.nav-playlist').length,
      queueRows: document.querySelectorAll('#queue-panel .queue-row').length,
      trackRows: document.querySelectorAll('.track-table-row').length,
      toastCount: document.querySelectorAll('.toast').length,
      activeElement: elementLabel(document.activeElement),
      heapUsedMB: memory ? bytesToMB(memory.usedJSHeapSize) : null,
      heapTotalMB: memory ? bytesToMB(memory.totalJSHeapSize) : null,
      heapLimitMB: memory ? bytesToMB(memory.jsHeapSizeLimit) : null
    };
  }

  function navigationTimings() {
    const entry = performance.getEntriesByType('navigation')[0];
    if (!entry) return {};
    return {
      domInteractiveMs: round(entry.domInteractive),
      domContentLoadedMs: round(entry.domContentLoadedEventEnd),
      loadEventMs: round(entry.loadEventEnd),
      responseEndMs: round(entry.responseEnd)
    };
  }

  function isVisible(element) {
    if (!element) return false;
    return !element.classList.contains('is-hidden') && getComputedStyle(element).display !== 'none';
  }

  function elementLabel(element) {
    if (!element) return null;
    return {
      tag: element.tagName || null,
      id: element.id || null,
      className: typeof element.className === 'string' ? element.className.slice(0, 180) : null
    };
  }

  function resourceLabel(raw) {
    try {
      const url = new URL(String(raw));
      const parts = url.pathname.split('/').filter(Boolean);
      return {
        protocol: url.protocol,
        host: url.hostname,
        port: url.port || null,
        firstPathSegment: parts[0] && parts[0].length <= 24 ? parts[0] : '<redacted>',
        extension: parts.at(-1)?.includes('.') ? parts.at(-1).split('.').pop()?.slice(0, 12) : null
      };
    } catch {
      return { value: String(raw || '').slice(0, 160) };
    }
  }

  function errorDetails(error) {
    if (!error) return null;
    return {
      name: error.name || 'Error',
      code: error.code || null,
      message: String(error.message || error).slice(0, 1000),
      stack: error.stack ? String(error.stack).split('\n').slice(0, 12).join('\n') : null
    };
  }

  function basename(value) {
    return String(value || '').split(/[\\/]/).pop()?.slice(0, 200) || '';
  }

  function bytesToMB(value) {
    return round(Number(value || 0) / 1024 / 1024);
  }

  function round(value) {
    return Math.round(Number(value || 0) * 10) / 10;
  }
})();
