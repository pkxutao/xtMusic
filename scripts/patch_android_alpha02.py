#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "android/app/src/main/java/com/pkxutao/xtmusic/android/MainActivity.kt"
text = path.read_text(encoding="utf-8")
old = "            hintTextColors = android.content.res.ColorStateList.valueOf(XtColors.muted)\n"
new = "            setHintTextColor(XtColors.muted)\n"
if old not in text:
    if new in text:
        print("Android hint color patch already applied")
    else:
        raise RuntimeError("Expected EditText hint color anchor was not found")
else:
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("Applied Android EditText hint color patch")
