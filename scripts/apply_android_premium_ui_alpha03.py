#!/usr/bin/env python3
from __future__ import annotations
import base64
import io
from pathlib import Path, PurePosixPath
import tarfile

root = Path(__file__).resolve().parents[1]
payload_dir = root / "scripts" / "android-premium-ui-alpha03"
encoded = "".join(path.read_text(encoding="ascii").strip() for path in sorted(payload_dir.glob("payload.*")))
archive_bytes = base64.b64decode(encoded)
with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as archive:
    members = archive.getmembers()
    for member in members:
        target = PurePosixPath(member.name)
        if target.is_absolute() or ".." in target.parts or not target.parts or target.parts[0] != "android":
            raise RuntimeError(f"Unsafe payload path: {member.name}")
    archive.extractall(root, members=members)
print(f"Applied XT Music Android premium UI alpha03 ({len(members)} files)")
