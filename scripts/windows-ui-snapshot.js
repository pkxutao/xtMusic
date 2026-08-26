'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'dist', 'renderer');
const proofDir = path.join(root, 'ui-proof');
const sourceIndex = path.join(rendererDir, 'index.html');
const smokeIndex = path.join(rendererDir, '__ui-smoke.html');

function stripRuntimeScripts(html) {
  return html.replace(/\s*<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

function mockMarkup() {
  const sidebarHtml = `
    <aside class="sidebar">
      <div class="sidebar-brand"><span class="brand-mark">♫</span><div><strong>XT Music</strong><small>FNOS Desktop</small></div></div>
      <nav class="nav-section"><span class="nav-caption">音乐馆</span>
        <button class="nav-item is-active"><span class="icon">⌂</span><span>首页</span></button>
        <button class="nav-item"><span class="icon">♪</span><span>歌曲</span></button>
        <button class="nav-item"><span class="icon">▣</span><span>专辑</span></button>
        <button class="nav-item"><span class="icon">◉</span><span>歌手</span></button>
        <button class="nav-item"><span class="icon">♡</span><span>我喜欢的音乐</span></button>
      </nav>
      <div class="sidebar-spacer"></div>
      <button class="account-summary"><span class="account-avatar small">XT</span><span class="account-summary-copy"><strong>Windows UI</strong><small>样式校验模式</small></span></button>
    </aside>`;
  const contentHtml = `
    <div class="page home-page">
      <section class="home-hero"><div class="hero-copy"><p class="eyebrow">WINDOWS UI HOTFIX</p><h1>欢迎回来</h1><p>完整桌面布局、颜色、间距和字体资源已经加载。</p><div class="hero-actions"><button class="primary-button">▶ 继续播放</button><button class="secondary-button">浏览全部歌曲</button></div></div><div class="hero-art"><div class="hero-disc"></div></div></section>
      <section class="home-section"><div class="section-title-row"><div><h2>最近播放</h2><span>安装态视觉快照</span></div></div><div class="media-grid">
        <article class="media-card"><div class="media-cover cover-placeholder">♫</div><strong>样式验证曲目</strong><span>XT Music</span></article>
        <article class="media-card"><div class="media-cover cover-placeholder">♫</div><strong>Windows 桌面版</strong><span>FNOS Music</span></article>
        <article class="media-card"><div class="media-cover cover-placeholder">♫</div><strong>完整 CSS 已加载</strong><span>v0.3.1</span></article>
      </div></section>
    </div>`;

  return `
    document.documentElement.dataset.platform = 'win32';
    document.documentElement.dataset.runtime = 'electron';
    document.getElementById('splash')?.classList.add('is-hidden');
    document.getElementById('login-root')?.classList.add('is-hidden');
    const shell = document.getElementById('app-shell');
    shell?.classList.remove('is-hidden');
    document.getElementById('titlebar-account').innerHTML = '<span class="account-avatar">XT</span>';
    document.getElementById('sidebar-root').innerHTML = ${JSON.stringify(sidebarHtml)};
    document.getElementById('content-root').innerHTML = ${JSON.stringify(contentHtml)};
    document.getElementById('queue-panel').innerHTML = '';
    document.getElementById('player-title').textContent = '样式校验曲目';
    document.getElementById('player-artist').textContent = 'XT Music';
    document.getElementById('player-toggle').textContent = '▶';
    document.getElementById('player-previous').textContent = '◀';
    document.getElementById('player-next').textContent = '▶';
    document.getElementById('player-volume-icon').textContent = '♫';
    document.getElementById('player-queue').textContent = '☰';
  `;
}

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  fs.mkdirSync(proofDir, { recursive: true });
  const html = stripRuntimeScripts(fs.readFileSync(sourceIndex, 'utf8'));
  fs.writeFileSync(smokeIndex, html, 'utf8');

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0a0c10',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  await window.loadFile(smokeIndex);
  await window.webContents.executeJavaScript(mockMarkup());
  await new Promise((resolve) => setTimeout(resolve, 500));

  const metrics = await window.webContents.executeJavaScript(`(() => {
    const root = getComputedStyle(document.documentElement);
    const shell = getComputedStyle(document.querySelector('.app-shell'));
    const sidebar = getComputedStyle(document.querySelector('.sidebar'));
    const player = getComputedStyle(document.querySelector('.player-bar'));
    return {
      stylesheetCount: document.styleSheets.length,
      accent: root.getPropertyValue('--accent').trim(),
      shellDisplay: shell.display,
      sidebarWidth: sidebar.width,
      playerHeight: player.height,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      titlebarHeight: getComputedStyle(document.querySelector('.titlebar')).height
    };
  })()`);

  if (metrics.stylesheetCount < 3) throw new Error(`Only ${metrics.stylesheetCount} stylesheets loaded`);
  if (metrics.shellDisplay === 'none') throw new Error('Application shell is still hidden');
  if (!metrics.accent) throw new Error('Theme variables were not loaded');
  if (parseFloat(metrics.sidebarWidth) < 180) throw new Error(`Invalid sidebar width: ${metrics.sidebarWidth}`);
  if (parseFloat(metrics.playerHeight) < 70) throw new Error(`Invalid player height: ${metrics.playerHeight}`);

  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(proofDir, 'windows-ui-snapshot.png'), image.toPNG());
  fs.writeFileSync(
    path.join(proofDir, 'windows-ui-metrics.json'),
    `${JSON.stringify({ verifiedAt: new Date().toISOString(), ...metrics }, null, 2)}\n`,
    'utf8'
  );
  fs.rmSync(smokeIndex, { force: true });
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
