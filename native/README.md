# XT Music Native 0.3.0

XT Music Native 是不依赖 Electron、Tauri 或 WebView 的桌面客户端。

## 技术栈

- Rust 1.85+
- egui / eframe 原生即时模式 GUI
- rodio / cpal 系统音频输出
- reqwest + rustls 网络层
- 系统 Keyring / Credential Manager 保存会话
- Windows x64、Ubuntu x86_64

## 当前功能

- FN ID、`fnos.net`、内网 HTTP/HTTPS 登录
- 飞牛音乐应用内账号和访问安全码
- 首页、歌曲、专辑、歌手、风格、收藏、历史、歌单
- 全局搜索
- 大型歌曲列表虚拟化
- 原生播放队列、播放/暂停、上下曲、跳转、音量、循环、随机
- LRC 歌词解析、同步定位和点击跳转
- 系统密钥环安全会话
- 本地音频缓存，避免 WebView 媒体管线开销

## 安全边界

- 原始密码只在一次登录线程内存在，不写入 JSON、日志或 Keyring。
- Token 与访问安全码仅保存到系统密钥环；密钥环不可用时退化为内存会话。
- HTTP 必须由用户明确允许。
- 自签名证书仅对当前账号连接生效。
- 非官方跨域重定向会删除 Cookie、Authorization 与访问安全码。
- 只有 `fnos.net` / `5ddd.com` 官方 HTTPS 中继跳转可以保留中继凭据。

## 本地构建

```bash
cargo test --manifest-path native/Cargo.toml
cargo run --release --manifest-path native/Cargo.toml
```

Ubuntu 构建依赖：

```bash
sudo apt install pkg-config libgtk-3-dev libasound2-dev \
  libxkbcommon-dev libxkbcommon-x11-dev libwayland-dev \
  libx11-xcb-dev libgl1-mesa-dev fonts-noto-cjk
```

## 与 Electron 版的关系

`v0.2.5` Electron 版本继续保留作为回退版本。原生版使用独立源码目录与独立构建流程，验证完成后发布为 `v0.3.0`。
