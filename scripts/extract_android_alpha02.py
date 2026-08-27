#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARTS = ROOT / "scripts" / "android-alpha02-payload"
DESTINATION = ROOT / "android"
EXPECTED_SHA256 = "44b329b8a0581b8e494f5dc5e5ab506d7cf80362ab0553723b91c9c12d922fb9"

encoded = "".join(
    path.read_text(encoding="ascii").strip()
    for path in sorted(PARTS.glob("part*.b64"))
)
if not encoded:
    raise RuntimeError("Android source payload is empty")

payload = base64.b64decode(encoded, validate=True)
actual = hashlib.sha256(payload).hexdigest()
if actual != EXPECTED_SHA256:
    raise RuntimeError(f"Android payload SHA-256 mismatch: {actual}")

archive_path = ROOT / ".android-alpha02-source.zip"
archive_path.write_bytes(payload)
if DESTINATION.exists():
    shutil.rmtree(DESTINATION)
DESTINATION.mkdir(parents=True)

with zipfile.ZipFile(archive_path) as archive:
    for member in archive.infolist():
        target = (DESTINATION / member.filename).resolve()
        if DESTINATION.resolve() not in target.parents and target != DESTINATION.resolve():
            raise RuntimeError(f"Unsafe Android payload path: {member.filename}")
    archive.extractall(DESTINATION)
    bad = archive.testzip()
    if bad:
        raise RuntimeError(f"Corrupt Android payload entry: {bad}")

archive_path.unlink()
print(f"Extracted {len(list(DESTINATION.rglob('*')))} Android project entries")
