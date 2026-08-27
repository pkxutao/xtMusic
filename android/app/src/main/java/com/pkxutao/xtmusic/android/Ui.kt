package com.pkxutao.xtmusic.android

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.ImageView
import android.widget.TextView
import kotlin.math.roundToInt

object XtColors {
    val background: Int = Color.rgb(8, 10, 16)
    val backgroundElevated: Int = Color.rgb(13, 16, 25)
    val surface: Int = Color.rgb(20, 23, 34)
    val surfaceRaised: Int = Color.rgb(29, 32, 47)
    val surfaceSoft: Int = Color.rgb(37, 39, 56)
    val primary: Int = Color.rgb(171, 112, 255)
    val primaryStrong: Int = Color.rgb(138, 76, 255)
    val primarySoft: Int = Color.rgb(205, 177, 255)
    val pink: Int = Color.rgb(255, 81, 130)
    val text: Int = Color.rgb(248, 248, 252)
    val textSecondary: Int = Color.rgb(205, 207, 219)
    val muted: Int = Color.rgb(143, 148, 169)
    val divider: Int = Color.rgb(42, 45, 61)
    val danger: Int = Color.rgb(255, 112, 128)
    val success: Int = Color.rgb(91, 220, 159)
}

fun Context.dp(value: Int): Int = (value * resources.displayMetrics.density).roundToInt()
fun Context.dp(value: Float): Int = (value * resources.displayMetrics.density).roundToInt()

fun roundedBackground(
    color: Int,
    radius: Float,
    strokeColor: Int? = null,
    strokeWidth: Int = 0
): GradientDrawable = GradientDrawable().apply {
    setColor(color)
    cornerRadius = radius
    if (strokeColor != null && strokeWidth > 0) setStroke(strokeWidth, strokeColor)
}

fun gradientBackground(
    startColor: Int,
    endColor: Int,
    radius: Float,
    orientation: GradientDrawable.Orientation = GradientDrawable.Orientation.TL_BR
): GradientDrawable = GradientDrawable(orientation, intArrayOf(startColor, endColor)).apply {
    cornerRadius = radius
}

fun TextView.styleText(
    sizeSp: Float,
    color: Int = XtColors.text,
    bold: Boolean = false
) {
    textSize = sizeSp
    setTextColor(color)
    includeFontPadding = false
    if (bold) setTypeface(typeface, Typeface.BOLD)
}

fun View.setPaddingDp(context: Context, horizontal: Int, vertical: Int) {
    setPadding(
        context.dp(horizontal),
        context.dp(vertical),
        context.dp(horizontal),
        context.dp(vertical)
    )
}

fun View.roundedOutline(radiusPx: Float) {
    clipToOutline = true
    outlineProvider = object : ViewOutlineProvider() {
        override fun getOutline(view: View, outline: Outline) {
            outline.setRoundRect(0, 0, view.width, view.height, radiusPx)
        }
    }
}

fun View.circleOutline() {
    clipToOutline = true
    outlineProvider = object : ViewOutlineProvider() {
        override fun getOutline(view: View, outline: Outline) {
            outline.setOval(0, 0, view.width, view.height)
        }
    }
}

fun ImageView.tint(color: Int) {
    imageTintList = ColorStateList.valueOf(color)
}

fun colorWithAlpha(color: Int, alpha: Int): Int = Color.argb(
    alpha.coerceIn(0, 255),
    Color.red(color),
    Color.green(color),
    Color.blue(color)
)
