#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
android_main = root / "android" / "app" / "src" / "main"


def write_if_changed(path: Path, text: str) -> None:
    current = path.read_text(encoding="utf-8")
    if current != text:
        path.write_text(text, encoding="utf-8")


def replace_once(path: Path, before: str, after: str, description: str) -> None:
    text = path.read_text(encoding="utf-8")
    if after in text:
        print(f"{description}: already applied")
        return
    if before not in text:
        raise RuntimeError(f"Unable to apply {description}: expected source block was not found in {path}")
    write_if_changed(path, text.replace(before, after, 1))
    print(f"{description}: applied")


# Keep the theme compatible with the API 26 minimum supported version.
styles = android_main / "res" / "values" / "styles.xml"
styles_text = styles.read_text(encoding="utf-8")
invalid = '        <item name="android:windowLightNavigationBar">false</item>\n'
if invalid in styles_text:
    styles_text = styles_text.replace(invalid, "", 1)
elif "android:windowLightNavigationBar" in styles_text:
    raise RuntimeError("Unexpected windowLightNavigationBar declaration")
write_if_changed(styles, styles_text)
print("Removed the API 27-only navigation-bar theme attribute for minSdk 26")


# Add one reusable system-bar inset handler. Android 15 enforces edge-to-edge for
# targetSdk 35, so every interactive screen must move its content out of the
# status bar, navigation bar, gesture area and display cutout.
ui = android_main / "java" / "com" / "pkxutao" / "xtmusic" / "android" / "Ui.kt"
ui_text = ui.read_text(encoding="utf-8")
if "fun View.applySystemBarInsets()" not in ui_text:
    if "import android.os.Build\n" not in ui_text:
        ui_text = ui_text.replace(
            "import android.graphics.drawable.GradientDrawable\n",
            "import android.graphics.drawable.GradientDrawable\nimport android.os.Build\n",
            1,
        )
    if "import android.view.WindowInsets\n" not in ui_text:
        ui_text = ui_text.replace(
            "import android.view.ViewOutlineProvider\n",
            "import android.view.ViewOutlineProvider\nimport android.view.WindowInsets\n",
            1,
        )

    marker = "\nfun ImageView.tint(color: Int) {"
    if marker not in ui_text:
        raise RuntimeError("Unable to add system-bar inset helper: Ui.kt marker was not found")
    helper = r'''

@Suppress("DEPRECATION")
fun View.applySystemBarInsets() {
    val initialLeft = paddingLeft
    val initialTop = paddingTop
    val initialRight = paddingRight
    val initialBottom = paddingBottom

    setOnApplyWindowInsetsListener { view, insets ->
        val left: Int
        val top: Int
        val right: Int
        val bottom: Int
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val safeInsets = insets.getInsets(
                WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout()
            )
            left = safeInsets.left
            top = safeInsets.top
            right = safeInsets.right
            bottom = safeInsets.bottom
        } else {
            left = insets.systemWindowInsetLeft
            top = insets.systemWindowInsetTop
            right = insets.systemWindowInsetRight
            bottom = insets.systemWindowInsetBottom
        }
        view.setPadding(
            initialLeft + left,
            initialTop + top,
            initialRight + right,
            initialBottom + bottom
        )
        insets
    }

    if (isAttachedToWindow) {
        requestApplyInsets()
    } else {
        addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) {
                view.removeOnAttachStateChangeListener(this)
                view.requestApplyInsets()
            }

            override fun onViewDetachedFromWindow(view: View) = Unit
        })
    }
}
'''
    ui_text = ui_text.replace(marker, helper + marker, 1)
    write_if_changed(ui, ui_text)
    print("Added reusable status/navigation bar and display-cutout inset handling")
else:
    print("System-bar inset helper: already applied")


# MainActivity hosts login, home, library, search, artist and album screens in
# the same root. Applying insets here protects every page and the bottom nav.
main_activity = android_main / "java" / "com" / "pkxutao" / "xtmusic" / "android" / "MainActivity.kt"
replace_once(
    main_activity,
    "        root = FrameLayout(this).apply { setBackgroundColor(XtColors.background) }\n",
    "        root = FrameLayout(this).apply {\n"
    "            setBackgroundColor(XtColors.background)\n"
    "            applySystemBarInsets()\n"
    "        }\n",
    "MainActivity system-bar safe area",
)


# Keep the blurred artwork edge-to-edge on the now-playing page, but inset the
# actual controls and lyrics so the close button and heading stay below the
# status bar and the lyrics card stays above gesture/navigation controls.
now_playing = android_main / "java" / "com" / "pkxutao" / "xtmusic" / "android" / "NowPlayingActivity.kt"
replace_once(
    now_playing,
    "            setPadding(dp(18), dp(6), dp(18), dp(12))\n        }\n"
    "        val top = LinearLayout(this).apply {\n",
    "            setPadding(dp(18), dp(6), dp(18), dp(12))\n"
    "            applySystemBarInsets()\n"
    "        }\n"
    "        val top = LinearLayout(this).apply {\n",
    "NowPlayingActivity system-bar safe area",
)

print("Applied Android system-bar safe-area compatibility fixes")
