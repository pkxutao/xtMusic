'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/platform.js'), 'utf8');
const MEMORY_NOTICE = '系统安全存储不可用，本次会话只保留在内存中。';

// A small mutation-aware DOM harness: textContent replacement generates a new
// childList mutation, even when the assigned string equals the existing text.
function harness() {
  let observing = false;
  let unsafe = false;
  let callback;
  let ready;
  let writes = 0;
  let text = '记住本次登录';
  const queue = [];
  class Node {}
  class Element extends Node {
    querySelector(selector) {
      if (selector === '.security-note span') return unsafe ? warning : null;
      if (selector === 'small') return description;
      return null;
    }
  }
  const warning = { textContent: '当前环境不可用安全加密，会话不会保存到磁盘。' };
  const description = {
    get textContent() { return text; },
    set textContent(value) {
      text = value;
      writes += 1;
      if (observing) queue.push({ addedNodes: [new Node()] });
    }
  };
  const row = new Element();
  const remember = { checked: true, disabled: false, closest: () => row };
  const body = new Element();
  const document = {
    body,
    documentElement: { dataset: {} },
    createTreeWalker: () => ({ nextNode: () => false }),
    querySelector(selector) {
      if (selector === 'input[name="rememberSession"]') return remember;
      return body.querySelector(selector);
    }
  };
  const window = {
    xtMusic: { environment: { platform: 'linux', isLinux: true, isWayland: false, sessionType: 'x11' } },
    addEventListener(event, listener) { if (event === 'DOMContentLoaded') ready = listener; }
  };
  class MutationObserver {
    constructor(listener) { callback = listener; }
    observe() { observing = true; }
  }
  vm.runInNewContext(source, { Node, Element, NodeFilter: { SHOW_TEXT: 4 }, document, window, MutationObserver });
  ready();
  return {
    remember,
    setUnsafe(value) { unsafe = value; },
    addContent() { queue.push({ addedNodes: [new Element()] }); },
    drain() {
      let delivered = 0;
      while (queue.length) {
        assert.ok(delivered++ < 20, 'platform adaptation must not generate an unbounded mutation loop');
        callback(queue.splice(0));
      }
      return delivered;
    },
    get writes() { return writes; },
    get text() { return text; }
  };
}

test('first login without a keyring settles instead of recursively rewriting its own notice', () => {
  const dom = harness();
  dom.setUnsafe(true);
  dom.addContent();
  assert.ok(dom.drain() <= 2);
  assert.equal(dom.text, MEMORY_NOTICE);
  assert.equal(dom.writes, 1);
  assert.equal(dom.remember.checked, false);
  assert.equal(dom.remember.disabled, true);
});

test('unrelated later DOM additions do not rewrite the memory-only notice', () => {
  const dom = harness();
  dom.setUnsafe(true);
  dom.addContent();
  dom.drain();
  for (let i = 0; i < 10; i += 1) {
    dom.addContent();
    dom.drain();
  }
  assert.equal(dom.writes, 1);
  assert.equal(dom.remember.disabled, true);
});

test('secure-storage availability leaves the remember-session choice unchanged', () => {
  const dom = harness();
  dom.addContent();
  assert.equal(dom.drain(), 1);
  assert.equal(dom.writes, 0);
  assert.equal(dom.text, '记住本次登录');
  assert.equal(dom.remember.checked, true);
  assert.equal(dom.remember.disabled, false);
});
