#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import html
import http.cookiejar
import ipaddress
import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from pathlib import Path
from typing import Iterable

FN_ID = "pkxutao"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "probe-results"
OUT.mkdir(exist_ok=True)
RESULT = OUT / "fnos-delete-api-probe-v3.txt"
MAX_REQUESTS = 72
TIMEOUT_SECONDS = 8
MAX_BYTES = 24 * 1024 * 1024

SSL_CONTEXT = ssl.create_default_context()
SSL_CONTEXT.check_hostname = False
SSL_CONTEXT.verify_mode = ssl.CERT_NONE

lines: list[str] = []


def emit(*values: object) -> None:
    text = " ".join(str(value) for value in values)
    lines.append(text)
    print(text, flush=True)


def request(
    opener: urllib.request.OpenerDirector,
    url: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[str, int, dict[str, str], bytes]:
    merged = {
        "User-Agent": "Mozilla/5.0 XT-Music-CI-ReadOnly-Probe/6.0",
        "Accept": "text/html,application/javascript,text/javascript,application/json,*/*;q=0.8",
    }
    if headers:
        merged.update(headers)
    req = urllib.request.Request(url, data=data, headers=merged, method=method)
    try:
        with opener.open(req, timeout=TIMEOUT_SECONDS) as response:
            return (
                response.geturl(),
                int(response.status),
                {key.lower(): value for key, value in response.headers.items()},
                response.read(MAX_BYTES),
            )
    except urllib.error.HTTPError as error:
        return (
            error.geturl(),
            int(error.code),
            {key.lower(): value for key, value in error.headers.items()},
            error.read(MAX_BYTES),
        )


def sign(timestamp_ms: int) -> str:
    raw = f"trim_connect`{FN_ID}`{timestamp_ms}`anna"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def flatten_strings(value: object) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from flatten_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from flatten_strings(child)


def normalize_origin(raw: str) -> str | None:
    value = str(raw or "").strip().strip("/,")
    if not value or len(value) > 300:
        return None
    if value.startswith("[") and "]" in value and not value.startswith(("http://", "https://")):
        value = "https://" + value
    elif not value.startswith(("http://", "https://")):
        if not re.fullmatch(r"[A-Za-z0-9_.:-]+", value):
            return None
        value = "https://" + value
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return None
    host = parsed.hostname
    if not host:
        return None
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_unspecified:
            return None
    except ValueError:
        lower = host.lower()
        if not (
            lower.endswith(".fnos.net")
            or lower.endswith(".5ddd.com")
            or lower.endswith(".fnnas.com")
            or lower == "fnos.net"
        ):
            return None
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", "")).rstrip("/")


def make_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
        urllib.request.HTTPSHandler(context=SSL_CONTEXT),
    )


def resolve_origins() -> set[str]:
    opener = make_opener()
    timestamp = int(time.time() * 1000)
    body = json.dumps({"fnId": FN_ID}, separators=(",", ":")).encode()
    final, status, headers, response = request(
        opener,
        "https://fnos.net/api/v1/fn/con",
        method="POST",
        data=body,
        headers={
            "Content-Type": "application/json",
            "fn-sign": sign(timestamp),
            "fn-time": str(timestamp),
            "Origin": "https://fnos.net",
            "Referer": f"https://fnos.net/{FN_ID}/music/",
        },
    )
    text = response.decode("utf-8", "ignore")
    emit("RESOLVER", final, "status", status, "bytes", len(response))
    emit("RESOLVER_HEADERS", json.dumps(headers, ensure_ascii=False, sort_keys=True))
    emit("RESOLVER_BODY", text[:30000])
    origins = {f"https://{FN_ID}.fnos.net"}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return origins
    data = parsed.get("data") if isinstance(parsed, dict) else None
    for value in flatten_strings(data):
        candidate = normalize_origin(value)
        if candidate:
            origins.add(candidate)
    return origins


def crawl(origins: set[str]) -> list[tuple[str, str]]:
    opener = make_opener()
    queue: deque[str] = deque()
    seen: set[str] = set()
    documents: list[tuple[str, str]] = []
    for origin in sorted(origins):
        for path in ("/trimcon", "/music/", "/music/index.html", "/music/remoteEntry.js", "/music/assets/remoteEntry.js"):
            queue.append(origin + path)
    queue.append(f"https://fnos.net/{FN_ID}/music/")

    allowed_hosts = {
        (urllib.parse.urlsplit(origin).hostname or "").lower() for origin in origins
    } | {"fnos.net", "static2.fnnas.com", "static.fnnas.com"}

    asset_pattern = re.compile(
        r"(?:src|href)\s*=\s*[\"']([^\"']+)[\"']|"
        r"[\"']((?:https?:)?//[^\"']+\.(?:js|mjs)(?:\?[^\"']*)?)[\"']|"
        r"[\"']([^\"']+\.(?:js|mjs)(?:\?[^\"']*)?)[\"']|"
        r"\bimport\s*\([^)]*[\"']([^\"']+)[\"']",
        re.I,
    )

    while queue and len(seen) < MAX_REQUESTS:
        url = queue.popleft()
        if url in seen:
            continue
        seen.add(url)
        parsed_request = urllib.parse.urlsplit(url)
        origin_header = urllib.parse.urlunsplit((parsed_request.scheme, parsed_request.netloc, "", "", ""))
        try:
            final, status, response_headers, body = request(
                opener,
                url,
                headers={
                    "Cookie": "mode=relay",
                    "Origin": origin_header,
                    "Referer": f"https://fnos.net/{FN_ID}/music/",
                },
            )
        except Exception as error:
            emit("FETCH_ERROR", url, type(error).__name__, str(error))
            continue
        content_type = response_headers.get("content-type", "")
        emit("FETCH", url, "->", final, "status", status, "type", content_type, "bytes", len(body))
        if not body:
            continue
        is_text = (
            "text" in content_type
            or "json" in content_type
            or "javascript" in content_type
            or urllib.parse.urlsplit(final).path.endswith((".js", ".mjs", ".html", "/"))
        )
        if not is_text:
            continue
        text = body.decode("utf-8", "ignore")
        documents.append((final, text))
        for match in asset_pattern.finditer(text):
            raw = next((item for item in match.groups() if item), "")
            raw = html.unescape(raw.strip().strip('"\''))
            if not raw or raw.startswith(("data:", "blob:", "javascript:")) or "${" in raw:
                continue
            candidate = urllib.parse.urljoin(final, raw)
            parsed = urllib.parse.urlsplit(candidate)
            host = (parsed.hostname or "").lower()
            if parsed.scheme not in {"http", "https"} or host not in allowed_hosts:
                continue
            if not (parsed.path.endswith((".js", ".mjs")) or "remoteEntry" in parsed.path):
                continue
            clean = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
            if clean not in seen and clean not in queue:
                queue.append(clean)
    emit("CRAWL_SUMMARY", "origins", len(origins), "requests", len(seen), "documents", len(documents))
    return documents


def extract(documents: list[tuple[str, str]]) -> None:
    target = re.compile(
        r"delete|remove|unlink|trash|recycle|audioFileDeleted|isAudioFileDeleted|"
        r"trackGUIDs?|filePaths?|rmFile|deleteFile|removeFile|physical|permanent|"
        r"/music/api/v\d+|/api/v\d+/(?:file|track|audio)",
        re.I,
    )
    route_pattern = re.compile(
        r"/(?:music/)?api/v\d+/(?:[A-Za-z0-9_.{}$-]+/)*[A-Za-z0-9_.{}$-]+|"
        r"/(?:track|file|files|audio|library|scan|folder|recycle|trash)(?:/[A-Za-z0-9_.{}$~-]+)+",
        re.I,
    )
    routes: set[str] = set()
    contexts: set[str] = set()
    strings: set[str] = set()
    literal = re.compile(r"(?P<q>[\"'`])(?P<body>(?:\\.|(?!\1).){1,1200})(?P=q)", re.S)
    for source, text in documents:
        routes.update(match.group(0) for match in route_pattern.finditer(text))
        for match in literal.finditer(text):
            value = match.group("body")
            if target.search(value):
                strings.add(value[:1200])
        for match in target.finditer(text):
            start = max(0, match.start() - 650)
            end = min(len(text), match.end() + 1050)
            snippet = re.sub(r"\s+", " ", text[start:end]).strip()
            if snippet:
                contexts.add(f"SOURCE {source}\n{snippet[:1800]}")
    emit("\n=== ROUTES ===")
    for value in sorted(routes, key=str.lower):
        emit(value)
    emit("\n=== STRINGS ===")
    for value in sorted(strings, key=str.lower):
        emit(value)
    emit("\n=== CONTEXTS ===")
    for value in sorted(contexts)[:800]:
        emit(value)
    emit("SUMMARY", json.dumps({"documents": len(documents), "routes": len(routes), "strings": len(strings), "contexts": len(contexts)}, ensure_ascii=False))


def main() -> None:
    origins = resolve_origins()
    emit("ORIGINS", json.dumps(sorted(origins), ensure_ascii=False))
    extract(crawl(origins))
    RESULT.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
