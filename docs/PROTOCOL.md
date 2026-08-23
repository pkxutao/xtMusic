# 飞牛音乐协议分析

本文记录 XT Music 使用的飞牛音乐客户端协议。路径来自对 `kuilei0926/FeiNiuMusic` 主分支的静态分析，并在代码中封装为可测试模块。

## 1. 基础地址

音乐 API 前缀：

```text
{server}/music/api/v1
```

飞牛常见服务端口：

- HTTP：5666
- HTTPS：5667

中继地址通常位于：

```text
https://{fnId}.5ddd.com
```

中继请求 Cookie 需要追加：

```http
Cookie: mode=relay
```

## 2. FNID 地址发现

请求：

```http
POST https://5ddd.com/api/v1/fn/con
Content-Type: application/json
authx: nonce={nonce}&timestamp={timestamp}&sign={sign}

{"fnId":"..."}
```

签名算法：

```text
body = JSON.stringify(data)
bodyMd5 = MD5(body)
raw = prefix + "_" + path + "_" + nonce + "_" + timestamp + "_" + bodyMd5 + "_" + apiKey
sign = MD5(raw)
```

常量与原客户端一致：

```text
prefix = NDzZTVxnRKP8Z0jXg1VAMonaG8akvh
apiKey = zIGtkc3dqZnJpd29qZXJqa2w7c
path = /api/v1/fn/con
```

返回内容包含内网 IPv4、公网 IPv4、IPv6、HTTP/HTTPS 端口和中继地址。XT Music 按以下顺序探测：

1. 内网 HTTPS
2. 用户允许时的内网 HTTP
3. 公网 IPv6 HTTPS
4. 公网 IPv4 HTTPS
5. FN Connect HTTPS 中继

同一优先级链路并行探测，组与组之间顺序执行，减少登录等待。

## 3. 访问安全码

探测：

```http
GET {server}/access_code_verify
```

- HTTP 204：没有启用访问安全码
- HTTP 401：需要访问安全码

验证请求头：

```http
x-access-code: Base64(UTF8(accessCode))
x-access-source: app
```

中继模式同时携带 `mode=relay`。

## 4. 账号登录

```http
POST {server}/music/api/v1/user/password-login
Content-Type: application/json

{
  "username": "用户名",
  "password": "SHA-256(原始密码)",
  "deviceId": "32位随机十六进制设备ID"
}
```

成功响应：

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "userToken": "..."
  }
}
```

后续认证：

```http
Cookie: music-token={userToken}
```

中继模式：

```http
Cookie: music-token={userToken}; mode=relay
```

## 5. 读取接口

分页接口使用 `page` 和 `size`。

| 功能 | 方法与路径 |
|---|---|
| 歌曲 | `GET /track/list` |
| 专辑 | `GET /album/list` |
| 歌手 | `GET /artist/list` |
| 风格 | `GET /genre/list` |
| 收藏 | `GET /favorite-track/list` |
| 最近播放 | `GET /play-history/list` |
| 歌单 | `GET /playlist/list` |
| 专辑歌曲 | `GET /track/album-detail/list?albumGUID=...` |
| 歌手歌曲 | `GET /track/artist-detail/list?artistGUID=...` |
| 风格歌曲 | `GET /track/genre-detail/list?genreGUID=...` |
| 歌单歌曲 | `GET /track/playlist-detail/list?playlistGUID=...` |
| 歌曲元数据 | `GET /track/metadata?guid=...` |
| 歌词 | `GET /lyric/list?trackGUID=...` |
| 搜索歌曲 | `GET /search/track?q=...` |
| 搜索专辑 | `GET /search/album?q=...` |
| 搜索歌手 | `GET /search/artist?q=...` |

标准业务响应：

```json
{
  "code": 0,
  "msg": "success",
  "data": {}
}
```

分页数据通常为：

```json
{
  "list": [],
  "total": 0,
  "sort": null
}
```

## 6. 媒体资源

封面：

```text
GET /music/api/v1/static/cover?coverId={coverId}&size={size}
```

音频流：

```text
GET /music/api/v1/track/stream?guid={trackGuid}
```

播放器会转发浏览器发出的 `Range` 请求，并保留：

- `Content-Type`
- `Content-Length`
- `Content-Range`
- `Accept-Ranges`
- `ETag`
- `Last-Modified`

渲染层使用：

```text
xtmusic://cover/{coverId}
xtmusic://stream/{trackGuid}
```

真实 Cookie 只在主进程添加。

## 7. 转码

启动：

```http
POST /music/api/v1/track/transcode

{
  "guid": "...",
  "output": {
    "codec": "mp3",
    "channel": 2
  }
}
```

服务端返回 HLS URL。XT Music 把 m3u8 内的媒体片段、子播放列表和密钥 URI 重写为 `xtmusic://hls/...`，避免 Token 或服务端地址暴露给渲染层。

停止：

```http
POST /music/api/v1/track/transcode/quit
{"guid":"..."}
```

## 8. 写入接口

| 功能 | 方法与路径 |
|---|---|
| 收藏 | `POST /favorite-track/create` |
| 取消收藏 | `POST /favorite-track/delete` |
| 删除播放历史 | `POST /play-history/delete` |
| 创建歌单 | `POST /playlist/create` |
| 编辑歌单 | `POST /playlist/edit` |
| 删除歌单 | `POST /playlist/delete` |
| 添加歌曲到歌单 | `POST /playlist/add-track` |
| 从歌单移除歌曲 | `POST /playlist/remove-track` |
| 播放事件 | `POST /event/report` |

## 9. 安全边界

- 原始密码不得写入账号配置、日志、备份或 localStorage。
- 渲染层不得得到 Token 和访问安全码。
- HTTP 由账号级设置明确允许。
- 自签名证书放行仅作用于主进程对该账号服务器的连接。
- 302/307/308 跨域时清除敏感头。
- 只有源和目标均为 HTTPS 且均属于 `*.5ddd.com` 时，才允许中继重定向保留凭据。
- m3u8 中的绝对地址必须重写，避免 HLS.js 绕开主进程代理。
