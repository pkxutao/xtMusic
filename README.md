# XT Music

XT Music 是一个面向 Windows 与 Ubuntu 的飞牛私有云（FNOS）音乐桌面客户端。项目采用独立实现，不复制 Feishin 的源码或素材；界面信息架构参考现代桌面音乐客户端：左侧音乐库导航、中间内容区、右侧播放队列和常驻底部播放器。

项目目标是解决原 Flutter 客户端在桌面端启动慢、列表滚动卡顿、交互不自然和凭据保护不足的问题。Windows 与 Ubuntu 共用同一套飞牛协议、音乐库、播放器和界面代码，只在窗口、托盘、密钥环与安装包层做平台适配。

## 已实现

- 飞牛地址或 FNID 登录，支持 FN Connect 内网、IPv6、IPv4 和中继链路探测
- 飞牛访问安全码
- 多账号管理；原始密码不落盘
- Windows 使用 DPAPI、Ubuntu 使用 GNOME Keyring/libsecret 或 KWallet 加密保存 Token
- Linux 检测到 `basic_text` 或未知密钥环后端时拒绝持久化 Token，仅保留当前运行会话
- 歌曲、专辑、歌手、风格、收藏、最近播放和歌单
- 全局搜索
- 专辑、歌手、风格和歌单详情
- 收藏、创建歌单、编辑歌单、添加歌曲
- 虚拟化歌曲表格，可流畅展示大型音乐库
- 播放队列、随机、单曲循环、列表循环、进度和音量
- LRC 歌词解析与同步滚动
- 系统媒体控制、媒体键和媒体信息
- 系统托盘和关闭到托盘
- 常见格式直接播放；DSF/DFF 或浏览器解码失败时请求飞牛服务端转码并通过 HLS 播放
- Windows NSIS 安装包和绿色便携版
- Ubuntu `.deb` 和 `.AppImage`
- Windows 与 Ubuntu GitHub Actions 自动构建

## 性能设计

XT Music 没有引入 React、Vue 或大型 UI 框架。渲染层使用原生 DOM、CSS 和小型状态控制器；歌曲表格只渲染可视区域附近的行。媒体文件不会完整读入内存，而是由主进程受控协议代理并保留 HTTP Range 请求。

播放器、网络协议、账号加密和窗口生命周期位于独立模块中，避免页面重绘影响播放。

## 安全设计

原 FeiNiuMusic 会把原始密码写入 SharedPreferences，并且默认允许 HTTP、忽略证书错误。XT Music 改为：

1. 原始密码只存在于登录表单和本次登录调用中，不保存到磁盘。
2. 登录请求按照飞牛协议发送 `SHA-256(password)`。
3. Token 和访问安全码只保存在 Electron 主进程。
4. Windows 通过 Electron `safeStorage` 使用 DPAPI；Linux 仅接受 GNOME Keyring/libsecret 或 KWallet 等安全后端。
5. Linux 的 `basic_text` 后端不被视为安全加密，不允许持久化会话。
6. 渲染层只得到非敏感账号概要，看不到 `music-token`。
7. 音频、封面和 HLS 转码流通过 `xtmusic://` 受控协议代理。
8. HTTPS 默认严格验证证书。自签名证书只在用户针对当前账号明确启用时放行，不做全局证书绕过。
9. 跨 Origin 重定向会移除 Cookie、访问安全码和 Authorization。仅 HTTPS 的 `*.5ddd.com` 中继链被视为可信重定向。
10. HTTP 必须由用户明确允许。建议只在可信局域网使用。

> 飞牛音乐服务的默认 5666 端口通常是 HTTP。使用 HTTP 时，同一网络中的攻击者仍可能截获会话凭据。条件允许时应启用 NAS HTTPS。

## 开发

要求：

- Node.js 22+
- npm 10+
- Windows 10/11 或 Ubuntu 22.04/24.04 用于平台实机验证

```bash
npm install
npm run dev
```

执行静态检查、语法检查、Renderer 构建和单元测试：

```bash
npm run build
```

## Windows 构建

```bash
npm run dist:win
```

生成：

- NSIS 安装包
- Portable 便携版

## Ubuntu 构建

x86_64：

```bash
npm run dist:ubuntu
```

ARM64：

```bash
npm run dist:ubuntu:arm64
```

生成：

- `.deb`：适合 Ubuntu、Debian、Linux Mint
- `.AppImage`：单文件运行，不需要安装

详细说明见 [docs/UBUNTU.md](docs/UBUNTU.md)。

所有产物位于 `release/`。

## Ubuntu 安装

安装 deb：

```bash
sudo apt install ./XT-Music-*.deb
```

运行 AppImage：

```bash
chmod +x XT-Music-*.AppImage
./XT-Music-*.AppImage
```

推荐安装并启用系统密钥环：

```bash
sudo apt install gnome-keyring libsecret-1-0
```

Ubuntu 默认使用系统原生窗口边框。Wayland 下只恢复窗口宽高，不尝试恢复绝对坐标；X11 下继续恢复窗口位置。

## 验证

仓库测试覆盖：

- 凭据隔离与 Electron 安全配置
- FNID `authx` 签名
- 飞牛密码 SHA-256
- HTTP 明确授权
- 安全重定向
- HLS 地址重写
- Linux `basic_text` 密钥后端拒绝策略
- GNOME libsecret 接受策略
- Wayland/X11 窗口边界处理
- JavaScript 源代码语法

GitHub Actions：

- `.github/workflows/windows-build.yml`
- `.github/workflows/ubuntu-build.yml`
- `.github/workflows/release.yml`

飞牛音乐 API 不是公开稳定协议。首次连接具体 FNOS 版本时，仍需要以该 NAS 的脱敏响应确认字段兼容性。

## 目录

```text
src/main/
  platform.js        Windows、Ubuntu、Wayland、托盘与密钥环适配
  protocol/          飞牛协议、FNID 探测、HTTP 安全传输
  services/          会话、HLS 注册表和运行状态
  storage/           安全账号存储与设置
  media-protocol.js  封面、音频与 HLS 受控代理
  ipc.js             最小化 IPC 白名单
src/renderer/
  app.js             桌面应用控制器
  player.js          播放器、队列、HLS、Media Session
  virtual-table.js   虚拟化歌曲表
  views.js           页面模板
  styles.css         共用桌面视觉系统
  platform.js        Linux 文案与安全状态适配
  platform.css       Ubuntu 字体和系统窗口适配
docs/
  PROTOCOL.md
  ARCHITECTURE.md
  UBUNTU.md
  VALIDATION.md
```

## 协议与兼容性

协议分析记录见 [docs/PROTOCOL.md](docs/PROTOCOL.md)。

当前验证边界见 [docs/VALIDATION.md](docs/VALIDATION.md)。遇到不兼容版本时，请附上脱敏后的接口响应和 FNOS 版本提交 Issue；不要提交密码、Token、访问安全码或完整公网地址。

## 版权

XT Music 是独立项目，未包含 Feishin、FeiNiuMusic 或飞牛官方客户端的源代码、图标和品牌素材。Feishin 仅作为桌面信息架构和交互体验参考。

MIT License。
