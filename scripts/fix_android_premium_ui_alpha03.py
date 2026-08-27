#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
styles = root / "android" / "app" / "src" / "main" / "res" / "values" / "styles.xml"
text = styles.read_text(encoding="utf-8")
invalid = '        <item name="android:windowLightNavigationBar">false</item>\n'
if invalid in text:
    text = text.replace(invalid, "", 1)
elif "android:windowLightNavigationBar" in text:
    raise RuntimeError("Unexpected windowLightNavigationBar declaration")
styles.write_text(text, encoding="utf-8")
print("Removed the API 27-only navigation-bar theme attribute for minSdk 26")
