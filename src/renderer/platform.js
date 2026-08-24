'use strict';

const environment = window.xtMusic?.environment || {
  platform: 'unknown',
  isLinux: false,
  isWayland: false,
  sessionType: ''
};

document.documentElement.dataset.platform = environment.platform;
document.documentElement.dataset.sessionType = environment.isWayland ? 'wayland' : environment.sessionType || '';

const linuxReplacements = [
  ['专为 Windows 重写的轻量客户端。', '面向 Windows 与 Ubuntu 优化的轻量客户端。'],
  ['DPAPI 加密会话', '系统密钥环加密会话'],
  ['登录令牌仅使用 Windows DPAPI 加密后落盘。', '登录令牌仅使用系统密钥环加密后落盘。'],
  ['Windows DPAPI', '系统密钥环'],
  ['适配 Windows 桌面使用习惯', '适配 Ubuntu 与 Linux 桌面使用习惯'],
  ['音乐 Token 与访问安全码保留在主进程，并使用 DPAPI 加密。', '音乐 Token 与访问安全码保留在主进程，并使用系统密钥环加密。']
];

function adaptTree(root) {
  if (!(root instanceof Node)) return;
  if (environment.isLinux) replaceText(root, linuxReplacements);
  enforceSessionStorageSafety(root);
}

function replaceText(root, replacements) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    let text = node.nodeValue || '';
    let changed = false;
    for (const [from, to] of replacements) {
      if (!text.includes(from)) continue;
      text = text.split(from).join(to);
      changed = true;
    }
    if (changed) node.nodeValue = text;
  }
}

function enforceSessionStorageSafety(root) {
  const scope = root instanceof Element ? root : document;
  const warning = scope.querySelector?.('.security-note span') || document.querySelector('.security-note span');
  if (!warning?.textContent?.includes('当前环境不可用安全加密')) return;

  const remember = document.querySelector('input[name="rememberSession"]');
  if (!remember) return;
  remember.checked = false;
  remember.disabled = true;
  const description = remember.closest('.check-row')?.querySelector('small');
  if (description) description.textContent = '系统安全存储不可用，本次会话只保留在内存中。';
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) adaptTree(node);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  adaptTree(document.body);
  observer.observe(document.body, { childList: true, subtree: true });
});
