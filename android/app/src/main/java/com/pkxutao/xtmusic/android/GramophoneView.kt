package com.pkxutao.xtmusic.android

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Shader
import android.graphics.SweepGradient
import android.view.Choreographer
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

/** Native, resolution-independent turntable. No WebView, external artwork, or playback engine. */
class GramophoneView(context: Context) : ViewGroup(context) {
    val artwork = ImageView(context).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        circleOutline()
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    private val record = FrameLayout(context).apply {
        clipChildren = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        addView(VinylSurface(context), FrameLayout.LayoutParams(-1, -1))
        addView(artwork, FrameLayout.LayoutParams(1, 1, Gravity.CENTER))
    }
    private val tonearm = TonearmView(context)
    private val motion = RecordRotation()
    private var foreground = false
    private var playing = false
    private var running = false
    private var ready = false
    private var scale = 1f
    private var sceneLeft = 0
    private var sceneTop = 0
    val recordAngle: Float get() = motion.angle
    val isRecordAnimating: Boolean get() = running

    private val frames = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!running) return
            if (!isShown || !ValueAnimator.areAnimatorsEnabled()) {
                syncMotion()
                return
            }
            record.rotation = motion.advance(frameTimeNanos)
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    init {
        clipChildren = false
        clipToPadding = false
        isClickable = true
        isFocusable = true
        contentDescription = "唱片，点击查看歌词"
        addView(record)
        addView(tonearm)
        ready = true
    }

    override fun getAccessibilityClassName(): CharSequence = "android.widget.Button"

    fun setPlaying(value: Boolean) {
        if (playing == value) return
        playing = value
        syncMotion()
    }

    fun setForeground(value: Boolean) {
        foreground = value
        syncMotion()
    }

    fun restoreAngle(value: Float) {
        motion.restore(value)
        record.rotation = motion.angle
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        syncMotion()
    }

    override fun onDetachedFromWindow() {
        stopFrames()
        tonearm.animate().cancel()
        super.onDetachedFromWindow()
    }

    override fun onVisibilityAggregated(isVisible: Boolean) {
        super.onVisibilityAggregated(isVisible)
        syncMotion()
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        syncMotion()
    }

    private fun syncMotion() {
        if (!ready) return
        val visible = foreground && isAttachedToWindow && isShown && windowVisibility == VISIBLE
        val enabled = ValueAnimator.areAnimatorsEnabled()
        val shouldRun = visible && playing && enabled
        if (shouldRun && !running) {
            running = true
            motion.pause()
            record.setLayerType(LAYER_TYPE_HARDWARE, null)
            Choreographer.getInstance().postFrameCallback(frames)
        } else if (!shouldRun && running) {
            stopFrames()
        }
        val needleAngle = if (playing) 0f else -28f
        if (abs(tonearm.rotation - needleAngle) > 0.1f) {
            tonearm.animate().cancel()
            if (visible && enabled) {
                tonearm.animate().rotation(needleAngle).setDuration(380L)
                    .setInterpolator(DecelerateInterpolator()).start()
            } else {
                tonearm.rotation = needleAngle
            }
        }
    }

    private fun stopFrames() {
        running = false
        Choreographer.getInstance().removeFrameCallback(frames)
        motion.pause()
        record.setLayerType(LAYER_TYPE_NONE, null)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        val h = MeasureSpec.getSize(heightMeasureSpec)
        setMeasuredDimension(w, h)
        scale = min(w / 400f, h / 460f).coerceAtLeast(0f)
        val diameter = (352f * scale).roundToInt()
        val artSize = (236f * scale).roundToInt()
        artwork.layoutParams = (artwork.layoutParams as FrameLayout.LayoutParams).apply {
            width = artSize
            height = artSize
        }
        record.measure(exact(diameter), exact(diameter))
        tonearm.measure(exact((400 * scale).roundToInt()), exact((460 * scale).roundToInt()))
        sceneLeft = ((w - 400 * scale) / 2).roundToInt()
        sceneTop = ((h - 460 * scale) / 2).roundToInt()
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val x = sceneLeft + (24 * scale).roundToInt()
        val y = sceneTop + (91 * scale).roundToInt()
        record.layout(x, y, x + record.measuredWidth, y + record.measuredHeight)
        tonearm.layout(sceneLeft, sceneTop, sceneLeft + tonearm.measuredWidth, sceneTop + tonearm.measuredHeight)
        tonearm.pivotX = 205 * scale
        tonearm.pivotY = 25 * scale
    }

    private fun exact(size: Int) = MeasureSpec.makeMeasureSpec(size, MeasureSpec.EXACTLY)
}

/** All paints/shaders are cached; rotation is a hardware-layer transform, not bitmap recreation. */
private class VinylSurface(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val sheen = SweepGradient(176f, 176f,
        intArrayOf(0xFF11121A.toInt(), 0xFF30313A.toInt(), 0xFF090A10.toInt(),
            0xFF171822.toInt(), 0xFF30313A.toInt(), 0xFF11121A.toInt()), null)
    private val label = RadialGradient(176f, 176f, 123f,
        intArrayOf(XtColors.primaryStrong, XtColors.surfaceRaised), null, Shader.TileMode.CLAMP)

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (width == 0) return
        canvas.save()
        canvas.scale(width / 352f, height / 352f)
        paint.style = Paint.Style.FILL
        paint.shader = null
        paint.color = colorWithAlpha(XtColors.primary, 30)
        canvas.drawCircle(176f, 176f, 176f, paint)
        paint.color = 0xFF07080E.toInt()
        canvas.drawCircle(176f, 176f, 171f, paint)
        paint.shader = sheen
        canvas.drawCircle(176f, 176f, 167f, paint)
        paint.shader = null
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 0.65f
        for (radius in 124..164 step 3) {
            paint.color = colorWithAlpha(Color.WHITE, if (radius % 2 == 0) 15 else 8)
            canvas.drawCircle(176f, 176f, radius.toFloat(), paint)
        }
        paint.style = Paint.Style.FILL
        paint.shader = label
        canvas.drawCircle(176f, 176f, 121f, paint)
        paint.shader = null
        paint.color = colorWithAlpha(XtColors.primarySoft, 85)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1f
        canvas.drawCircle(176f, 176f, 119f, paint)
        canvas.restore()
    }
}

private class TonearmView(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val arm = Path().apply {
        moveTo(205f, 25f)
        lineTo(250f, 86f)
        quadTo(255f, 93f, 264f, 100f)
        lineTo(298f, 137f)
    }
    private val metal = LinearGradient(198f, 20f, 300f, 146f,
        intArrayOf(XtColors.primarySoft, Color.WHITE, XtColors.textSecondary), null, Shader.TileMode.CLAMP)

    init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (width == 0) return
        canvas.save()
        canvas.scale(width / 400f, height / 460f)
        paint.shader = null
        paint.style = Paint.Style.FILL
        paint.color = colorWithAlpha(Color.BLACK, 80)
        canvas.drawCircle(207f, 28f, 19f, paint)
        paint.color = XtColors.surfaceRaised
        canvas.drawCircle(205f, 25f, 17f, paint)
        paint.color = colorWithAlpha(XtColors.primarySoft, 80)
        canvas.drawCircle(205f, 25f, 13f, paint)
        paint.color = XtColors.text
        canvas.drawCircle(205f, 25f, 9f, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeJoin = Paint.Join.ROUND
        paint.strokeCap = Paint.Cap.ROUND
        paint.strokeWidth = 7f
        paint.shader = metal
        canvas.drawPath(arm, paint)
        paint.shader = null
        paint.style = Paint.Style.FILL
        canvas.save()
        canvas.rotate(-42f, 299f, 138f)
        paint.color = XtColors.textSecondary
        canvas.drawRoundRect(292f, 130f, 307f, 146f, 3f, 3f, paint)
        paint.color = XtColors.text
        canvas.drawRoundRect(289f, 141f, 310f, 163f, 4f, 4f, paint)
        paint.color = XtColors.primaryStrong
        canvas.drawRoundRect(294f, 153f, 305f, 157f, 1f, 1f, paint)
        canvas.restore()
        canvas.restore()
    }
}
