#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import html
import http.cookiejar
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

SSL_CONTEXT = ssl.create_default_context()
SSL_CONTEXT.check_hostname = False
SSL_CONTEXT.verify_mode = ssl.CERT_NONE

lines: list[str] = []


def emit(*values: object) -> None:
    text = " ".join(str(value) for value in values)
    lines.append(text)
    print(text)


def request(
    opener: urllib.request.OpenerDirector,
    url: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    max_bytes: int = 40 * 1024 * 1024,
) -> tuple[str, int, dict[str, str], bytes]:
    merged_headers = {
        "User-Agent": "Mozilla/5.0 XT-Music-CI-ReadOnly-Probe/5.0",
        "Accept": "text/html,application/javascript,text/javascript,application/json,*/*;q=0.8",
    }
    if headers:
        merged_headers.update(headers)
    req = urllib.request.Request(url, data=data, headers=merged_headers, method=method)
    try:
        with opener.open(req, timeout=30) as response:
            return (
                response.geturl(),
                int(response.status),
                {key.lower(): value for key, value in response.headers.items()},
                response.read(max_bytes),
            )
    except urllib.error.HTTPError as error:
        return (
            error.geturl(),
            int(error.code),
            {key.lower(): value for key, value in error.headers.items()},
            error.read(max_bytes),
        )


def text_body(body: bytes) -> str:
    return body.decode("utf-8", "ignore")


def sign(fn_id: str, timestamp_ms: int) -> str:
    raw = f"trim_connect`{fn_id}`{timestamp_ms}`anna"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def normalize_origin(value: str) -> str | None:
    value = str(value or "").strip()
    if not value:
        return None
    if not value.startswith(("http://", "https://")):
        value = "https://" + value
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return None
    if not parsed.hostname:
        return None
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", "")).rstrip("/")


def flatten_strings(value: object) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from flatten_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from flatten_strings(child)


def resolve_fn() -> dict[str, object]:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar),
        urllib.request.HTTPSHandler(context=SSL_CONTEXT),
    )
    timestamp_ms = int(time.time() * 1000)
    payload = json.dumps({"fnId": FN_ID}, separators=(",", ":")).encode("utf-8")
    url = "https://fnos.net/api/v1/fn/con"
    final_url, status, headers, body = request(
        opener,
        url,
        method="POST",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "fn-sign": sign(FN_ID, timestamp_ms),
            "Origin": "https://fnos.net",
            "Referer": f"https://fnos.net/{FN_ID}/music/",
        },
    )
    emit("RESOLVER", url, "->", final_url, "status", status, "bytes", len(body))
    emit("RESOLVER_HEADERS", json.dumps(headers, ensure_ascii=False, sort_keys=True))
    emit("RESOLVER_BODY", text_body(body)[:20000])
    try:
        parsed = json.loads(text_body(body))
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return parsed


def crawl_frontend(origins: set[str]) -> list[tuple[str, str]]:
    documents: list[tuple[str, str]] = []
    queue: deque[str] = deque()
    seen: set[str] = set()

    seed_paths = (
        "/trimcon",
        "/music/",
        "/music/index.html",
        "/music/manifest.json",
        "/music/remoteEntry.js",
        "/music/assets/remoteEntry.js",
        "/music/api/v1/health",
    )
    for origin in sorted(origins):
        for path in seed_paths:
            queue.append(origin.rstrip("/") + path)
    queue.append(f"https://fnos.net/{FN_ID}/music/")

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar),
        urllib.request.HTTPSHandler(context=SSL_CONTEXT),
    )

    asset_pattern = re.compile(
        r"(?:src|href)\s*=\s*[\"']([^\"']+)[\"']|"
        r"[\"']((?:https?:)?//[^\"']+\.(?:js|mjs|map)(?:\?[^\"']*)?)[\"']|"
        r"[\"']([^\"']+\.(?:js|mjs|map)(?:\?[^\"']*)?)[\"']|"
        r"sourceMappingURL=([^\s*]+)",
        re.I,
    )

    allowed_hosts = {
        urllib.parse.urlsplit(origin).hostname.lower()
        for origin in origins
        if urllib.parse.urlsplit(origin).hostname
    }
    allowed_hosts.update({"fnos.net", "static2.fnnas.com", "static.fnnas.com"})

    while queue and len(seen) < 220:
        url = queue.popleft()
        if url in seen:
            continue
        seen.add(url)
        headers = {
            "Cookie": "mode=relay",
            "Origin": urllib.parse.urlunsplit((*urllib.parse.urlsplit(url)[:2], "", "", "")),
            "Referer": f"https://fnos.net/{FN_ID}/music/",
        }
        try:
            final_url, status, response_headers, body = request(opener, url, headers=headers)
        except Exception as error:
            emit("FETCH_EXCEPTION", url, type(error).__name__, str(error))
            continue
        content_type = response_headers.get("content-type", "")
        location = response_headers.get("location", "")
        emit(
            "FETCH",
            url,
            "->",
            final_url,
            "status",
            status,
            "type",
            content_type,
            "bytes",
            len(body),
            "location",
            location,
        )
        if not body:
            continue
        if not (
            "text" in content_type
            or "json" in content_type
            or "javascript" in content_type
            or final_url.endswith((".js", ".mjs", ".map", ".html", "/"))
        ):
            continue
        text = text_body(body)
        documents.append((final_url, text))
        for match in asset_pattern.finditer(text):
            raw = next((group for group in match.groups() if group), "")
            raw = html.unescape(raw.strip().strip('"\''))
            if not raw or raw.startswith(("data:", "blob:", "javascript:")):
                continue
            candidate = urllib.parse.urljoin(final_url, raw)
            parsed = urllib.parse.urlsplit(candidate)
            host = (parsed.hostname or "").lower()
            if parsed.scheme not in {"http", "https"} or host not in allowed_hosts:
                continue
            if not (
                parsed.path.endswith((".js", ".mjs", ".map"))
                or "/assets/" in parsed.path
                or "remoteEntry" in parsed.path
            ):
                continue
            clean = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
            if clean not in seen:
                queue.append(clean)
    emit("CRAWL_SUMMARY", "origins", len(origins), "requests", len(seen), "documents", len(documents))
    return documents


def extract_clues(documents: list[tuple[str, str]]) -> None:
    target_terms = re.compile(
        r"delete|remove|unlink|trash|recycle|audioFileDeleted|isAudioFileDeleted|"
        r"trackGUIDs?|filePaths?|rmFile|deleteFile|removeFile|physical|permanent|"
        r"/music/api/v\d+|remoteEntry|music(?:/|\\/)",
        re.I,
    )
    route_pattern = re.compile(
        r"/(?:music/)?api/v\d+/(?:[A-Za-z0-9_.{}$-]+/)*[A-Za-z0-9_.{}$-]+|"
        r"/(?:track|file|files|audio|library|scan|folder|recycle|trash)(?:/[A-Za-z0-9_.{}$~-]+)+",
        re.I,
    )
    literal_pattern = re.compile(r"(?P<q>[\"'`])(?P<body>(?:\\.|(?!\1).){1,1600})(?P=q)", re.S)
    urls: set[str] = set()
    routes: set[str] = set()
    literals: set[str] = set()
    contexts: set[str] = set()

    for source_url, text in documents:
        routes.update(match.group(0) for match in route_pattern.finditer(text))
        urls.update(match.group(0) for match in re.finditer(r"https?://[^\"'`\s<>]+", text, re.I))
        for match in literal_pattern.finditer(text):
            value = match.group("body")
            if target_terms.search(value):
                literals.add(value[:1600])
        for match in target_terms.finditer(text):
            start = max(0, match.start() - 850)
            end = min(len(text), match.end() + 1350)
            snippet = re.sub(r"\s+", " ", text[start:end]).strip()
            if snippet:
                contexts.add(f"SOURCE {source_url}\n{snippet[:2300]}")

    emit("\n=== ROUTE CANDIDATES ===")
    for route in sorted(routes, key=str.lower):
        emit(route)
    emit("\n=== MATCHING STRING LITERALS ===")
    for value in sorted(literals, key=str.lower):
        emit(value)
    emit("\n=== RELEVANT URLS ===")
    for url in sorted(urls, key=str.lower):
        if target_terms.search(url) or any(token in url.lower() for token in ("api", "music", "remote")):
            emit(url)
    emit("\n=== TARGETED CONTEXTS ===")
    for snippet in sorted(contexts)[:1800]:
        emit(snippet)
    emit(
        "CLUE_SUMMARY",
        json.dumps(
            {
                "documents": len(documents),
                "routes": len(routes),
                "literals": len(literals),
                "urls": len(urls),
                "contexts": len(contexts),
            },
            ensure_ascii=False,
        ),
    )


def main() -> None:
    resolver = resolve_fn()
    data = resolver.get("data") if isinstance(resolver, dict) else None
    origins: set[str] = {f"https://{FN_ID}.fnos.net"}
    if data is not None:
        for value in flatten_strings(data):
            normalized = normalize_origin(value)
            if normalized:
                host = urllib.parse.urlsplit(normalized).hostname or ""
                if (
                    host.endswith(".fnos.net")
                    or host.endswith(".5ddd.com")
                    or host.endswith(".fnnas.com")
                ):
                    origins.add(normalized)
    emit("ORIGINS", json.dumps(sorted(origins), ensure_ascii=False))
    documents = crawl_frontend(origins)
    extract_clues(documents)
    RESULT.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
