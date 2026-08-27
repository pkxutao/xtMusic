package com.pkxutao.xtmusic.android

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView

object XtColors {
    val background: Int = Color.rgb(11, 13, 18)
    val surface: Int = Color.rgb(21, 25, 34)
    val surfaceRaised: Int = Color.rgb(29, 34, 45)
    val primary: Int = Color.rgb(229, 255, 79)
    val text: Int = Color.rgb(244, 246, 250)
    val muted: Int = Color.rgb(154, 162, 178)
    val danger: Int = Color.rgb(255, 112, 112)
}

fun Context.dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

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

fun TextView.styleText(
    sizeSp: Float,
    color: Int = XtColors.text,
    bold: Boolean = false
) {
    textSize = sizeSp
    setTextColor(color)
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
