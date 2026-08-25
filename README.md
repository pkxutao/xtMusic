# XT Music Native

XT Music 是面向 Windows 与 Ubuntu 的飞牛音乐桌面客户端。当前主线 `v0.3.0` 使用 **Rust + egui/eframe + rodio/cpal**，不使用 Electron、Tauri 或 WebView 作为桌面运行时。

旧 Electron 版本保留在 GitHub Release `v0.2.5`，用于回退和历史参考。

## 核心特性

- 飞牛地址或 FN ID 登录，支持 FN Connect 内网、IPv6、IPv4、`fnos.net` 与中继链路
- 飞牛音乐应用内账号登录和访问安全码
- 歌曲、专辑、歌手、风格、收藏、最近播放、搜索与歌单
- 原生音频输出、播放队列、随机播放、单曲循环、列表循环、进度和音量控制
- LRC 歌词解析、同步高亮和点击跳转
- 大型歌曲列表虚拟化，避免一次绘制全部行
- Windows x64 安装程序
- Ubuntu amd64 DEB 与 x86_64 便携压缩包

## 原生架构

```text
Rust application
├── egui / eframe       原生 GPU 桌面界面
├── rodio / cpal        系统音频输出
├── reqwest             FN Connect 与飞牛音乐 API
├── keyring             Credential Manager / Secret Service
├── native/src/api.rs   协议、登录、音乐库与安全重定向
├── native/src/audio.rs 播放控制
├── native/src/app.rs   界面与状态管理
└── native/src/lrc.rs   歌词解析和同步
```

原生安装包不会捆绑 Chromium、Node.js、Electron、Tauri 或 WebView 前端资源。

## 安全设计

1. 原始密码仅存在于本次登录请求中，不写入配置文件。
2. 登录按飞牛音乐协议提交密码 SHA-256 摘要。
3. Token 和访问安全码使用系统 Keyring/Credential Manager 保存；安全存储不可用时仅保存在内存。
4. HTTPS 默认验证证书，自签名证书仅在用户针对当前服务器明确允许时使用。
5. 跨域重定向会移除 Cookie、Authorization 和访问安全码；仅官方 FNOS 中继链保留必要路由信息。
6. HTTP 必须由用户显式允许，建议仅在可信局域网使用。
7. 项目不包含分析、广告或远程遥测 SDK。

## 下载与安装

正式安装包位于 GitHub Releases。

### Windows

```text
XT-Music-Native-0.3.0-Windows-x64-Setup.exe
```

### Ubuntu

安装 DEB：

```bash
sudo apt install ./XT-Music-Native-0.3.0-Ubuntu-amd64.deb
```

便携版：

```bash
tar -xzf XT-Music-Native-0.3.0-Ubuntu-x86_64.tar.gz
chmod +x xtmusic
./xtmusic
```

## 本地构建

要求 Rust `1.88`，依赖版本由 `native/Cargo.lock` 固定。

```bash
cargo fmt --manifest-path native/Cargo.toml -- --check
cargo test --locked --manifest-path native/Cargo.toml
cargo build --release --locked --manifest-path native/Cargo.toml
```

Ubuntu 还需要 GTK3、ALSA、Wayland/X11 和 OpenGL 开发包；具体依赖参考 `.github/workflows/native-ubuntu-build.yml`。

## 自动构建

原生流水线：

- `native-validation.yml`：格式、编译检查和测试
- `native-windows-build.yml`：Windows 安装程序
- `native-ubuntu-build.yml`：Ubuntu DEB 与便携包
- `native-release.yml`：生成正式 Release、构建信息和 SHA-256

## 目录

```text
native/
├── Cargo.toml
├── Cargo.lock
├── src/
├── tests/
└── installer/
releases/
└── v0.3.0.md
```

根目录中保留的旧 JavaScript 文件只用于历史兼容，不会进入 `v0.3.0` 原生安装包；后续功能开发以 `native/` 为准。

## 验证边界

CI 已完成 Rust 锁定依赖测试、Windows release 编译与安装器打包、Ubuntu release 编译、DEB/便携包封装和 SHA-256 校验。由于飞牛音乐 API 不是公开稳定协议，连接不同 FNOS 版本时仍应以脱敏错误信息进行兼容调整，不要提交密码、Token 或访问安全码。

MIT License。
