# XT Music

XT Music 是一个面向 Windows 的飞牛私有云（FNOS）音乐桌面客户端。项目采用独立实现，不复制 Feishin 的源码或素材；界面信息架构参考现代桌面音乐客户端：左侧音乐库导航、中间内容区、右侧播放队列和常驻底部播放器。

项目目标是解决原 Flutter 客户端在 Windows 上启动慢、列表滚动卡顿、桌面交互不自然和凭据保护不足的问题。

## 已实现

- 飞牛地址或 FNID 登录，支持 FN Connect 内网、IPv6、IPv4 和中继链路探测
- 飞牛访问安全码
- 多账号管理；密码不落盘，登录 Token 和访问安全码使用 Windows DPAPI 加密
- 歌曲、专辑、歌手、风格、收藏、最近播放和歌单
- 全局搜索
- 专辑、歌手、风格和歌单详情
- 收藏、创建歌单、编辑歌单、添加歌曲
- 虚拟化歌曲表格，可流畅展示大型音乐库
- 播放队列、随机、单曲循环、列表循环、进度和音量
- LRC 歌词解析与同步滚动
- Windows 系统媒体控制、媒体键、任务栏媒体信息
- 系统托盘和关闭到托盘
- 常见格式直接播放；DSF/DFF 或浏览器解码失败时请求飞牛服务端转码并通过 HLS 播放
- NSIS 安装包和绿色便携版构建
- GitHub Actions Windows 自动构建

## 性能设计

XT Music 没有引入 React、Vue 或大型 UI 框架。渲染层使用原生 DOM、CSS 和小型状态控制器；歌曲表格只渲染可视区域附近的行。媒体文件不会完整读入内存，而是由主进程受控协议代理并保留 HTTP Range 请求。

播放器、网络协议、账号加密和窗口生命周期位于独立模块中，避免页面重绘影响播放。

## 安全设计

原 FeiNiuMusic 会把原始密码写入 SharedPreferences，并且默认允许 HTTP、忽略证书错误。XT Music 改为：

1. 原始密码只存在于登录表单和本次登录调用中，不保存到磁盘。
2. 登录请求按照飞牛协议发送 `SHA-256(password)`。
3. Token 和访问安全码只保存在 Electron 主进程；Windows 上通过 Electron `safeStorage` 使用 DPAPI 加密。
4. 渲染层只得到非敏感账号概要，看不到 `music-token`。
5. 音频、封面和 HLS 转码流通过 `xtmusic://` 受控协议代理。
6. HTTPS 默认严格验证证书。自签名证书只在用户针对当前账号明确启用时放行，不做全局证书绕过。
7. 跨 Origin 重定向会移除 Cookie、访问安全码和 Authorization。仅 HTTPS 的 `*.5ddd.com` 中继链被视为可信重定向。
8. HTTP 必须由用户明确允许。建议只在可信局域网使用。

> 飞牛音乐服务的默认 5666 端口通常是 HTTP。使用 HTTP 时，同一网络中的攻击者仍可能截获会话凭据。条件允许时应启用 NAS HTTPS。

## 当前验证状态

在源码交付环境中已经执行并通过：

```bash
node scripts/check.js
node scripts/syntax-check.js
node --test tests/*.test.js
```

这覆盖凭据隔离、Electron 安全配置、FNID 签名、密码哈希、HTTP 明确授权、HLS 地址重写和源代码语法。Windows 安装包仍应由仓库中的 `windows-build.yml` 在 `windows-latest` 上构建验证；由于飞牛音乐 API 不是公开稳定协议，首次连接具体 FNOS 版本时还需要以该 NAS 的脱敏响应确认字段兼容性。

## 开发

要求：

- Node.js 22+
- npm
- Windows 10/11 用于最终安装包验证

```bash
npm install
npm run dev
```

执行检查与测试：

```bash
npm run build
```

构建 Windows 安装包和便携版：

```bash
npm run dist:win
```

产物位于 `release/`。

## 当前验证状态

当前源码已经完成以下本地验证：

- 26 个 JavaScript 源文件语法检查通过；
- 10 个协议与安全单元测试通过；
- 仓库静态安全检查通过。

当前执行环境无法访问 npm/GitHub 网络，也不是 Windows，因此尚未在本环境完成
依赖安装、Electron 启动和 Windows 安装包构建。仓库内的 GitHub Actions 会在代码
真正推送后，于 `windows-latest` 环境执行完整安装、测试和打包。不要在工作流成功
之前把安装包视为已经验证。

## 目录

```text
src/main/
  protocol/          飞牛协议、FNID 探测、HTTP 安全传输
  services/          会话、HLS 注册表和运行状态
  storage/           DPAPI 账号存储与设置
  media-protocol.js  封面、音频与 HLS 受控代理
  ipc.js             最小化 IPC 白名单
src/renderer/
  app.js             桌面应用控制器
  player.js          播放器、队列、HLS、Media Session
  virtual-table.js   虚拟化歌曲表
  views.js           页面模板
  styles.css         Windows 桌面视觉系统
docs/
  PROTOCOL.md
  ARCHITECTURE.md
```

## 协议与兼容性

协议分析记录见 [docs/PROTOCOL.md](docs/PROTOCOL.md)。

当前验证边界和仍需进行的 Windows/FNOS 实机测试见 [docs/VALIDATION.md](docs/VALIDATION.md)。在 GitHub Actions 实际成功前，不要把安装包或 Release 视为已经生成。

飞牛音乐接口不是公开稳定 API，不同 FNOS 版本可能存在字段或路径变化。所有返回模型都保留服务端原始字段，并在界面层做兼容读取。遇到不兼容版本时，请附上脱敏后的接口响应和 FNOS 版本提交 Issue；不要提交密码、Token、访问安全码或完整公网地址。

## 版权

XT Music 是独立项目，未包含 Feishin、FeiNiuMusic 或飞牛官方客户端的源代码、图标和品牌素材。Feishin 仅作为桌面信息架构和交互体验参考。

MIT License。
