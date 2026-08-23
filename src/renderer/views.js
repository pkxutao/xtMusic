import {
  artistsText,
  attr,
  coverUrl,
  escapeHtml,
  formatCount,
  formatDuration,
  icon,
  imageHtml,
  initials,
  trackDuration
} from './utils.js';

export function loginView({ accounts = [], encryptionAvailable = true, error = null } = {}) {
  const accountRows = accounts.map((account) => `
    <button class="saved-account-card" data-login-account="${attr(account.id)}" type="button">
      <span class="account-avatar">${escapeHtml(initials(account.name || account.username))}</span>
      <span class="saved-account-copy">
        <strong>${escapeHtml(account.name || account.username)}</strong>
        <small>${escapeHtml(account.username)} · ${escapeHtml(account.fnId || account.serverUrl)}</small>
      </span>
      <span class="saved-account-state">${account.hasSession ? '快速进入' : '需重新登录'}</span>
      ${icon('chevronRight', 18)}
    </button>
  `).join('');

  return `
    <section class="login-screen">
      <div class="login-background">
        <div class="login-orb login-orb-a"></div>
        <div class="login-orb login-orb-b"></div>
      </div>
      <div class="login-shell">
        <div class="login-brand-panel">
          <div class="brand-mark large">${icon('music', 34)}</div>
          <p class="eyebrow">XT MUSIC FOR FNOS</p>
          <h1>你的飞牛音乐库，<br>以桌面级速度重新呈现。</h1>
          <p class="login-lead">专为 Windows 重写的轻量客户端。原生窗口交互、虚拟化歌曲表格、系统媒体控制与安全凭据存储。</p>
          <div class="feature-pills">
            <span>${icon('server', 15)} FNID / 地址登录</span>
            <span>${icon('lock', 15)} DPAPI 加密会话</span>
            <span>${icon('music', 15)} 无损与服务端转码</span>
          </div>
          <div class="security-note">
            ${icon('lock', 18)}
            <div>
              <strong>密码不会保存</strong>
              <span>${encryptionAvailable ? '登录令牌仅使用 Windows DPAPI 加密后落盘。' : '当前环境不可用安全加密，登录令牌仅保留到本次运行。'}</span>
            </div>
          </div>
        </div>

        <div class="login-card">
          <div class="login-card-header">
            <div>
              <p class="eyebrow">连接音乐服务</p>
              <h2>登录飞牛账号</h2>
            </div>
            <span class="version-chip">v${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0'}</span>
          </div>

          ${accountRows ? `
            <div class="saved-account-section">
              <div class="section-caption">已保存账号</div>
              <div class="saved-account-list">${accountRows}</div>
              <div class="login-divider"><span>或使用新账号</span></div>
            </div>
          ` : ''}

          <form id="login-form" class="login-form" autocomplete="on">
            <label class="field">
              <span>服务器地址或 FNID</span>
              <div class="field-control">
                ${icon('server', 18)}
                <input name="serverInput" id="login-server" required placeholder="例如 abcdef 或 https://192.168.1.10:5667" spellcheck="false">
              </div>
            </label>
            <div class="field-grid">
              <label class="field">
                <span>用户名</span>
                <div class="field-control">
                  ${icon('user', 18)}
                  <input name="username" id="login-username" required autocomplete="username" placeholder="飞牛账号">
                </div>
              </label>
              <label class="field">
                <span>密码</span>
                <div class="field-control">
                  ${icon('lock', 18)}
                  <input name="password" id="login-password" type="password" required autocomplete="current-password" placeholder="不会保存">
                  <button type="button" class="field-action" data-action="toggle-password" aria-label="显示密码">${icon('eye', 18)}</button>
                </div>
              </label>
            </div>
            <div class="field-grid">
              <label class="field">
                <span>访问安全码 <em>可选</em></span>
                <div class="field-control">
                  ${icon('lock', 18)}
                  <input name="accessCode" id="login-access-code" type="password" autocomplete="off" placeholder="服务器启用时填写">
                </div>
              </label>
              <label class="field">
                <span>账号备注 <em>可选</em></span>
                <div class="field-control">
                  ${icon('pin', 18)}
                  <input name="name" id="login-name" placeholder="例如：家中 NAS">
                </div>
              </label>
            </div>

            <details class="advanced-login">
              <summary>${icon('settings', 16)} 连接兼容选项</summary>
              <div class="advanced-login-body">
                <label class="check-row">
                  <input type="checkbox" name="allowHttp" checked>
                  <span><strong>允许 HTTP 直连</strong><small>兼容飞牛默认 5666 端口；只应在可信局域网使用。</small></span>
                </label>
                <label class="check-row">
                  <input type="checkbox" name="allowSelfSigned">
                  <span><strong>信任该 NAS 的自签名证书</strong><small>仅影响此账号的飞牛地址，不会全局关闭证书校验。</small></span>
                </label>
                <label class="check-row">
                  <input type="checkbox" name="rememberSession" checked>
                  <span><strong>记住登录状态</strong><small>保存加密令牌，不保存原始密码。</small></span>
                </label>
              </div>
            </details>

            <div id="login-progress" class="login-progress is-hidden">
              <span class="spinner"></span>
              <span id="login-progress-text">正在连接…</span>
            </div>
            <div id="login-error" class="form-error ${error ? '' : 'is-hidden'}">
              ${icon('warning', 17)}
              <span>${escapeHtml(error || '')}</span>
            </div>
            <button id="login-submit" class="primary-button login-submit" type="submit">
              <span>连接音乐库</span>${icon('chevronRight', 19)}
            </button>
          </form>
        </div>
      </div>
    </section>
  `;
}

export function sidebarView(state) {
  const session = state.session || {};
  const nav = [
    ['home', 'home', '首页'],
    ['tracks', 'music', '歌曲'],
    ['albums', 'album', '专辑'],
    ['artists', 'artist', '歌手'],
    ['genres', 'genre', '风格'],
    ['favorites', 'heart', '我喜欢的音乐'],
    ['history', 'history', '最近播放']
  ];
  const current = state.route?.name || 'home';
  return `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <span class="brand-mark">${icon('music', 22)}</span>
        <div><strong>XT Music</strong><small>FNOS Desktop</small></div>
      </div>
      <nav class="nav-section">
        <span class="nav-caption">音乐馆</span>
        ${nav.map(([route, iconName, label]) => `
          <button class="nav-item ${current === route ? 'is-active' : ''}" data-route="${route}">
            ${icon(iconName, 19)}<span>${label}</span>
          </button>
        `).join('')}
      </nav>
      <nav class="nav-section playlist-nav">
        <div class="nav-caption-row">
          <span class="nav-caption">我的歌单</span>
          <button class="icon-button tiny" data-action="create-playlist" title="新建歌单">${icon('plus', 15)}</button>
        </div>
        <div class="playlist-nav-list">
          ${(state.playlists || []).map((playlist) => `
            <button class="nav-item nav-playlist ${current === 'playlist' && state.route.params?.guid === playlist.guid ? 'is-active' : ''}"
                    data-open-kind="playlist"
                    data-open-id="${attr(playlist.guid)}">
              ${icon('playlist', 18)}
              <span title="${attr(playlist.name)}">${escapeHtml(playlist.name)}</span>
            </button>
          `).join('') || '<div class="nav-empty">还没有歌单</div>'}
        </div>
      </nav>
      <div class="sidebar-spacer"></div>
      <button class="account-summary" data-action="accounts">
        <span class="account-avatar small">${escapeHtml(initials(session.name || session.username))}</span>
        <span class="account-summary-copy">
          <strong>${escapeHtml(session.name || session.username || '未登录')}</strong>
          <small>${escapeHtml(session.relayMode ? 'FN Connect 中继' : '飞牛音乐已连接')}</small>
        </span>
        ${icon('more', 18)}
      </button>
      <button class="nav-item sidebar-settings ${current === 'settings' ? 'is-active' : ''}" data-route="settings">
        ${icon('settings', 19)}<span>设置</span>
      </button>
    </aside>
  `;
}

export function homeView(data, session) {
  const greeting = hourGreeting();
  return `
    <div class="page home-page">
      <section class="home-hero">
        <div class="hero-copy">
          <p class="eyebrow">${greeting}</p>
          <h1>${escapeHtml(session?.name || session?.username || '欢迎回来')}</h1>
          <p>从你的飞牛私有音乐库继续播放。所有数据直接来自 NAS。</p>
          <div class="hero-actions">
            <button class="primary-button" data-action="play-section" data-section="history">${icon('play', 17)}继续播放</button>
            <button class="secondary-button" data-route="tracks">${icon('music', 17)}浏览全部歌曲</button>
          </div>
        </div>
        <div class="hero-art">
          ${collage(data?.albums?.list || [])}
        </div>
      </section>
      ${horizontalSection('最近播放', 'history', data?.history?.list || [], 'track')}
      ${horizontalSection('最近加入的专辑', 'albums', data?.albums?.list || [], 'album')}
      ${horizontalSection('常听歌手', 'artists', data?.artists?.list || [], 'artist')}
      ${horizontalSection('我的歌单', 'playlists', data?.playlists?.list || [], 'playlist')}
      ${(data?.favorites?.list || []).length ? horizontalSection('我喜欢的音乐', 'favorites', data.favorites.list, 'track') : ''}
    </div>
  `;
}

export function gridPageView({ title, subtitle, items, kind, total = 0, iconName = 'album' }) {
  return `
    <div class="page library-page">
      <div class="page-heading">
        <div>
          <p class="eyebrow">音乐库</p>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle || `${formatCount(total || items.length)} 项`)}</p>
        </div>
        <div class="page-heading-actions">
          <button class="secondary-button compact" data-action="refresh">${icon('refresh', 16)}刷新</button>
        </div>
      </div>
      <div class="media-grid ${kind === 'artist' ? 'artist-grid' : ''}">
        ${items.map((item) => mediaCard(item, kind)).join('') || emptyState(iconName, `没有${title}`)}
      </div>
    </div>
  `;
}

export function trackPageView({ title, subtitle, tracks, kind = 'tracks', actionLabel = null }) {
  return `
    <div class="page tracks-page">
      <div class="page-heading track-page-heading">
        <div>
          <p class="eyebrow">音乐库</p>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle || `${formatCount(tracks.length)} 首歌曲`)}</p>
        </div>
        <div class="page-heading-actions">
          ${tracks.length ? `
            <button class="primary-button compact" data-action="play-all">${icon('play', 16)}${escapeHtml(actionLabel || '播放全部')}</button>
            <button class="secondary-button compact" data-action="shuffle-all">${icon('shuffle', 16)}随机播放</button>
          ` : ''}
          <button class="secondary-button compact" data-action="refresh">${icon('refresh', 16)}刷新</button>
        </div>
      </div>
      ${tracks.length ? '<div id="track-table-host" class="track-table-host"></div>' : emptyState('music', '这里还没有歌曲')}
    </div>
  `;
}

export function detailView({ kind, item, tracks }) {
  const title = item.name || item.title || '未知';
  const coverId = item.coverId || tracks?.[0]?.coverId || tracks?.[0]?.album?.coverId;
  const meta = detailMeta(kind, item, tracks);
  return `
    <div class="page detail-page">
      <section class="detail-hero">
        <div class="detail-backdrop" style="${coverId ? `background-image:url('${attr(coverUrl(coverId, 800))}')` : ''}"></div>
        <div class="detail-hero-content">
          ${imageHtml(coverId, title, `detail-cover ${kind === 'artist' ? 'round' : ''}`, 900)}
          <div class="detail-copy">
            <p class="eyebrow">${detailKindLabel(kind)}</p>
            <h1>${escapeHtml(title)}</h1>
            <p class="detail-meta">${escapeHtml(meta)}</p>
            <div class="detail-actions">
              <button class="primary-button" data-action="play-all">${icon('play', 17)}播放</button>
              <button class="secondary-button" data-action="shuffle-all">${icon('shuffle', 17)}随机播放</button>
              ${kind === 'playlist' ? `<button class="icon-button outlined" data-action="edit-playlist" title="编辑歌单">${icon('settings', 18)}</button>` : ''}
              <button class="icon-button outlined" data-action="detail-more" title="更多">${icon('more', 19)}</button>
            </div>
          </div>
        </div>
      </section>
      <section class="detail-tracks">
        <div class="section-title-row">
          <div><h2>歌曲</h2><span>${tracks.length} 首</span></div>
        </div>
        ${tracks.length ? '<div id="track-table-host" class="track-table-host detail-table"></div>' : emptyState('music', '没有可播放的歌曲')}
      </section>
    </div>
  `;
}

export function searchView(query, data) {
  const tracks = data?.tracks?.list || [];
  const albums = data?.albums?.list || [];
  const artists = data?.artists?.list || [];
  const hasAny = tracks.length || albums.length || artists.length;
  return `
    <div class="page search-page">
      <div class="page-heading">
        <div>
          <p class="eyebrow">搜索</p>
          <h1>“${escapeHtml(query)}”</h1>
          <p>${hasAny ? `找到 ${tracks.length + albums.length + artists.length} 项结果` : '没有找到匹配内容'}</p>
        </div>
      </div>
      ${tracks.length ? `
        <section class="search-section">
          <div class="section-title-row"><div><h2>歌曲</h2><span>${tracks.length} 首</span></div></div>
          <div id="track-table-host" class="track-table-host search-track-table"></div>
        </section>
      ` : ''}
      ${albums.length ? `<section class="search-section">${sectionHeading('专辑')}<div class="media-grid compact-grid">${albums.map((item) => mediaCard(item, 'album')).join('')}</div></section>` : ''}
      ${artists.length ? `<section class="search-section">${sectionHeading('歌手')}<div class="media-grid compact-grid artist-grid">${artists.map((item) => mediaCard(item, 'artist')).join('')}</div></section>` : ''}
      ${!hasAny ? emptyState('search', '换一个关键词再试试') : ''}
    </div>
  `;
}

export function lyricsView(playerState) {
  const track = playerState.track;
  if (!track) return `<div class="page">${emptyState('lyrics', '播放歌曲后显示歌词')}</div>`;
  const lines = playerState.lyrics?.lines || [];
  const coverId = track.coverId || track.album?.coverId;
  return `
    <div class="page lyrics-page">
      <div class="lyrics-backdrop" style="${coverId ? `background-image:url('${attr(coverUrl(coverId, 1000))}')` : ''}"></div>
      <div class="lyrics-layout">
        <div class="lyrics-cover-column">
          ${imageHtml(coverId, track.title, 'lyrics-cover', 1000)}
          <div class="lyrics-track-copy">
            <h1>${escapeHtml(track.title)}</h1>
            <p>${escapeHtml(artistsText(track))}</p>
            <span>${escapeHtml(track.album?.name || '未知专辑')}</span>
          </div>
        </div>
        <div id="lyrics-scroll" class="lyrics-scroll">
          ${lines.length ? lines.map((line, index) => `
            <button class="lyric-line ${index === playerState.activeLyric ? 'is-active' : ''}"
                    data-lyric-index="${index}"
                    data-lyric-time="${line.time}">
              ${escapeHtml(line.text)}
            </button>
          `).join('') : '<div class="lyrics-empty">这首歌暂时没有歌词</div>'}
        </div>
      </div>
    </div>
  `;
}

export function settingsView(state, encryptionAvailable) {
  const session = state.session || {};
  const settings = state.settings || {};
  return `
    <div class="page settings-page">
      <div class="page-heading">
        <div><p class="eyebrow">XT MUSIC</p><h1>设置</h1><p>桌面体验、账号与安全选项</p></div>
      </div>
      <div class="settings-layout">
        <section class="settings-card">
          <div class="settings-card-title">${icon('user', 20)}<div><h2>当前账号</h2><p>飞牛音乐连接信息</p></div></div>
          <div class="account-detail-row">
            <span class="account-avatar">${escapeHtml(initials(session.name || session.username))}</span>
            <div><strong>${escapeHtml(session.name || session.username || '')}</strong><small>${escapeHtml(session.username || '')}</small></div>
          </div>
          <dl class="info-list">
            <div><dt>服务器</dt><dd>${escapeHtml(session.serverUrl || '—')}</dd></div>
            <div><dt>FNID</dt><dd>${escapeHtml(session.fnId || '直接地址')}</dd></div>
            <div><dt>链路</dt><dd>${session.relayMode ? 'FN Connect 中继' : '直连'}</dd></div>
            <div><dt>会话保护</dt><dd>${encryptionAvailable ? 'Windows DPAPI' : '仅本次运行'}</dd></div>
          </dl>
          <div class="settings-actions">
            <button class="secondary-button compact" data-action="accounts">${icon('user', 16)}切换账号</button>
            <button class="danger-button compact" data-action="logout">${icon('logout', 16)}退出登录</button>
          </div>
        </section>

        <section class="settings-card">
          <div class="settings-card-title">${icon('settings', 20)}<div><h2>外观与窗口</h2><p>适配 Windows 桌面使用习惯</p></div></div>
          <label class="setting-row">
            <span><strong>主题</strong><small>跟随系统或固定深浅色</small></span>
            <select data-setting="theme">
              <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>深色</option>
              <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>浅色</option>
              <option value="system" ${settings.theme === 'system' ? 'selected' : ''}>跟随系统</option>
            </select>
          </label>
          <label class="setting-row">
            <span><strong>关闭到系统托盘</strong><small>点击关闭按钮时继续在后台播放</small></span>
            <input type="checkbox" data-setting="closeToTray" ${settings.closeToTray ? 'checked' : ''}>
          </label>
          <button class="secondary-button compact align-start" data-action="clear-cache">${icon('trash', 16)}清理图片与网络缓存</button>
        </section>

        <section class="settings-card">
          <div class="settings-card-title">${icon('lock', 20)}<div><h2>安全说明</h2><p>此客户端如何处理你的凭据</p></div></div>
          <ul class="security-list">
            <li>${icon('check', 17)}原始密码只用于本次 SHA-256 登录请求，不写入磁盘。</li>
            <li>${icon('check', 17)}音乐 Token 与访问安全码保留在主进程，并使用 DPAPI 加密。</li>
            <li>${icon('check', 17)}媒体流通过受控本地协议转发，网页渲染层看不到 Token。</li>
            <li>${icon('check', 17)}跨域重定向默认移除 Cookie；只对白名单内的 5ddd.com 中继链保留。</li>
          </ul>
        </section>
      </div>
    </div>
  `;
}

export function loadingView(label = '正在加载音乐库…') {
  return `<div class="page-loading"><span class="spinner large"></span><strong>${escapeHtml(label)}</strong></div>`;
}

export function errorView(message) {
  return `<div class="page-error">${icon('warning', 34)}<h2>加载失败</h2><p>${escapeHtml(message)}</p><button class="primary-button compact" data-action="refresh">${icon('refresh', 16)}重试</button></div>`;
}

export function accountModal(accounts, activeId) {
  return `
    <div class="modal-backdrop" data-modal-backdrop="true">
      <section class="modal account-modal" role="dialog" aria-modal="true">
        <header class="modal-header"><div><p class="eyebrow">账号管理</p><h2>飞牛账号</h2></div><button class="icon-button" data-action="close-modal">${icon('close', 19)}</button></header>
        <div class="modal-body account-list-modal">
          ${accounts.map((account) => `
            <div class="account-manage-row ${account.id === activeId ? 'is-active' : ''}">
              <span class="account-avatar">${escapeHtml(initials(account.name || account.username))}</span>
              <div class="account-manage-copy">
                <strong>${escapeHtml(account.name || account.username)}</strong>
                <small>${escapeHtml(account.username)} · ${escapeHtml(account.fnId || account.serverUrl)}</small>
                <span>${account.hasSession ? '已保存加密会话' : '下次需要重新输入密码'}</span>
              </div>
              <div class="account-manage-actions">
                ${account.id !== activeId ? `<button class="secondary-button compact" data-action="switch-account" data-id="${attr(account.id)}">切换</button>` : '<span class="active-chip">当前</span>'}
                <button class="icon-button danger" data-action="remove-account" data-id="${attr(account.id)}" title="删除账号">${icon('trash', 17)}</button>
              </div>
            </div>
          `).join('') || '<div class="modal-empty">没有保存的账号</div>'}
        </div>
        <footer class="modal-footer"><button class="primary-button compact" data-action="add-account">${icon('plus', 16)}添加账号</button></footer>
      </section>
    </div>
  `;
}

export function playlistModal(playlists, tracks) {
  return `
    <div class="modal-backdrop" data-modal-backdrop="true">
      <section class="modal small-modal" role="dialog" aria-modal="true">
        <header class="modal-header"><div><p class="eyebrow">添加到歌单</p><h2>${tracks.length} 首歌曲</h2></div><button class="icon-button" data-action="close-modal">${icon('close', 19)}</button></header>
        <div class="modal-body selectable-list">
          ${playlists.map((playlist) => `
            <button class="selectable-row" data-action="confirm-add-playlist" data-id="${attr(playlist.guid)}">
              ${imageHtml(playlist.coverId, playlist.name, 'selectable-cover', 128)}
              <span><strong>${escapeHtml(playlist.name)}</strong><small>${playlist.trackCount || 0} 首歌曲</small></span>
              ${icon('chevronRight', 18)}
            </button>
          `).join('') || '<div class="modal-empty">还没有歌单，请先创建一个。</div>'}
        </div>
        <footer class="modal-footer"><button class="secondary-button compact" data-action="create-playlist">${icon('plus', 16)}新建歌单</button></footer>
      </section>
    </div>
  `;
}

export function promptModal({ title, label, value = '', action, danger = false, description = '' }) {
  return `
    <div class="modal-backdrop" data-modal-backdrop="true">
      <section class="modal small-modal" role="dialog" aria-modal="true">
        <header class="modal-header"><div><p class="eyebrow">XT MUSIC</p><h2>${escapeHtml(title)}</h2></div><button class="icon-button" data-action="close-modal">${icon('close', 19)}</button></header>
        <form id="prompt-form" class="modal-body prompt-form" data-submit-action="${attr(action)}">
          ${description ? `<p>${escapeHtml(description)}</p>` : ''}
          <label class="field"><span>${escapeHtml(label)}</span><div class="field-control"><input name="value" value="${attr(value)}" required autofocus></div></label>
          <button class="${danger ? 'danger-button' : 'primary-button'}" type="submit">确认</button>
        </form>
      </section>
    </div>
  `;
}

function horizontalSection(title, route, items, kind) {
  if (!items.length) return '';
  return `
    <section class="home-section">
      <div class="section-title-row">
        <div><h2>${escapeHtml(title)}</h2><span>${items.length} 项</span></div>
        <button class="text-button" data-route="${route}">查看全部 ${icon('chevronRight', 16)}</button>
      </div>
      <div class="horizontal-media-row">
        ${items.slice(0, 14).map((item) => mediaCard(item, kind)).join('')}
      </div>
    </section>
  `;
}

function mediaCard(item, kind) {
  if (kind === 'track') {
    const coverId = item.coverId || item.album?.coverId;
    return `
      <article class="media-card track-card" data-play-guid="${attr(item.guid)}">
        <div class="media-card-art">
          ${imageHtml(coverId, item.title, 'media-card-cover', 480)}
          <button class="card-play" data-play-guid="${attr(item.guid)}" aria-label="播放">${icon('play', 20)}</button>
        </div>
        <strong title="${attr(item.title)}">${escapeHtml(item.title || '未知标题')}</strong>
        <span title="${attr(artistsText(item))}">${escapeHtml(artistsText(item))}</span>
      </article>
    `;
  }
  const name = item.name || item.title || '未知';
  const coverClass = kind === 'artist' ? 'media-card-cover round' : 'media-card-cover';
  const sub = kind === 'album'
    ? `${item.trackCount || 0} 首歌曲`
    : kind === 'artist'
      ? `${item.trackCount || 0} 首歌曲`
      : kind === 'genre'
        ? `${item.trackCount || 0} 首歌曲`
        : `${item.trackCount || 0} 首歌曲`;
  return `
    <article class="media-card ${kind}-card" data-open-kind="${kind}" data-open-id="${attr(item.guid)}">
      <div class="media-card-art">
        ${imageHtml(item.coverId, name, coverClass, 480)}
        <button class="card-play" data-open-kind="${kind}" data-open-id="${attr(item.guid)}" data-autoplay="true" aria-label="打开并播放">${icon('play', 20)}</button>
      </div>
      <strong title="${attr(name)}">${escapeHtml(name)}</strong>
      <span>${escapeHtml(sub)}</span>
    </article>
  `;
}

function collage(albums) {
  const chosen = albums.slice(0, 4);
  if (!chosen.length) return `<div class="hero-disc">${icon('music', 72)}</div>`;
  return `<div class="hero-collage">${chosen.map((album, index) => `
    <div class="hero-collage-item item-${index}">
      ${imageHtml(album.coverId, album.name, 'hero-collage-cover', 640)}
    </div>
  `).join('')}</div>`;
}

function detailKindLabel(kind) {
  return ({ album: '专辑', artist: '歌手', genre: '音乐风格', playlist: '歌单' })[kind] || '音乐';
}

function detailMeta(kind, item, tracks) {
  if (kind === 'artist') return `${tracks.length} 首歌曲 · ${item.albumCount || 0} 张专辑`;
  if (kind === 'album') {
    const artists = tracks[0] ? artistsText(tracks[0]) : '';
    return `${artists}${artists ? ' · ' : ''}${tracks.length} 首歌曲`;
  }
  return `${tracks.length} 首歌曲`;
}

function sectionHeading(title) {
  return `<div class="section-title-row"><div><h2>${escapeHtml(title)}</h2></div></div>`;
}

function emptyState(iconName, text) {
  return `<div class="empty-state">${icon(iconName, 38)}<strong>${escapeHtml(text)}</strong><span>你的飞牛音乐库内容会显示在这里</span></div>`;
}

function hourGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了，听点舒缓的';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}
