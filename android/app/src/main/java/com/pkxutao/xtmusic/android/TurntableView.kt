package com.pkxutao.xtmusic.android

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Shader
import android.graphics.SweepGradient
import android.view.Gravity
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import kotlin.math.min

/** Pure sizing/motion rules, shared with JVM regression tests. */
internal object TurntableMotion {
    const val REVOLUTION_MS = 24_000L

    fun normalize(degrees: Float): Float =
        if (degrees.isFinite()) ((degrees % 360f) + 360f) % 360f else 0f

    fun diameter(width: Int, height: Int, maximum: Int): Int =
        min(min(width.coerceAtLeast(0) * 0.92f, height.coerceAtLeast(0) / 1.18f),
            maximum.coerceAtLeast(0).toFloat()).toInt()

    fun shouldSpin(playing: Boolean, resumed: Boolean, attached: Boolean,
                   visible: Boolean, animationsEnabled: Boolean): Boolean =
        playing && resumed && attached && visible && animationsEnabled
}

/** Native, hardware-composited record player. No bitmaps are created per animation frame. */
class TurntableView(context: Context) : FrameLayout(context) {
    val artwork = ImageView(context).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        background = gradientBackground(XtColors.primaryStrong, XtColors.surfaceRaised, 0f)
        circleOutline()
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    private val platter = FrameLayout(context).apply {
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    }
    private val vinyl = VinylFace(context)
    private val tonearm = Tonearm(context)
    private var spin: ValueAnimator? = null
    private var armAnimation: ValueAnimator? = null
    private var playing = false
    private var hostResumed = false
    private var ready = false
    private var trackKey: String? = null
    private var diameterPx = 0
    private var discLeft = 0
    private var discTop = 0
    private val haloPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = colorWithAlpha(XtColors.primarySoft, 32)
    }

    val discRotationDegrees: Float get() = TurntableMotion.normalize(platter.rotation)
    val isDiscSpinning: Boolean get() = spin?.isRunning == true

    init {
        setWillNotDraw(false)
        isClickable = true
        isFocusable = true
        contentDescription = "唱片，点击查看歌词"
        platter.addView(vinyl, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        platter.addView(artwork, LayoutParams(0, 0, Gravity.CENTER))
        val spindle = View(context).apply {
            background = roundedBackground(Color.rgb(18, 18, 23), context.dp(8).toFloat(),
                colorWithAlpha(XtColors.text, 150), context.dp(1))
        }
        platter.addView(spindle, LayoutParams(context.dp(7), context.dp(7), Gravity.CENTER))
        addView(platter, LayoutParams(0, 0))
        addView(tonearm, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        ready = true
    }

    fun bindTrack(key: String?) {
        if (trackKey == key) return
        stopSpin()
        trackKey = key
        platter.rotation = 0f
        syncAnimations()
    }

    fun restoreRotation(key: String?, degrees: Float) {
        stopSpin()
        trackKey = key
        platter.rotation = TurntableMotion.normalize(degrees)
        syncAnimations()
    }

    fun setPlaybackActive(active: Boolean) {
        playing = active
        syncAnimations()
    }

    fun setHostResumed(resumed: Boolean) {
        hostResumed = resumed
        syncAnimations()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        diameterPx = TurntableMotion.diameter(w, h, context.dp(460))
        discLeft = (w - diameterPx) / 2
        discTop = ((h - diameterPx * 1.18f) / 2f + diameterPx * 0.18f).toInt()
        platter.layoutParams = LayoutParams(diameterPx, diameterPx).apply {
            leftMargin = discLeft
            topMargin = discTop
        }
        val labelSize = (diameterPx * 0.64f).toInt()
        artwork.layoutParams = LayoutParams(labelSize, labelSize, Gravity.CENTER)
        tonearm.setGeometry(w / 2f, discTop.toFloat(), diameterPx.toFloat())
        val radius = diameterPx * 0.59f
        haloPaint.shader = if (radius > 0f) RadialGradient(
            w / 2f, discTop + diameterPx / 2f, radius,
            intArrayOf(Color.TRANSPARENT, colorWithAlpha(XtColors.primary, 22), Color.TRANSPARENT),
            floatArrayOf(0.74f, 0.87f, 1f), Shader.TileMode.CLAMP
        ) else null
        rimPaint.strokeWidth = context.dp(1).toFloat()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (diameterPx <= 0) return
        val cx = width / 2f
        val cy = discTop + diameterPx / 2f
        canvas.drawCircle(cx, cy, diameterPx * 0.59f, haloPaint)
        canvas.drawCircle(cx, cy, diameterPx * 0.51f, rimPaint)
    }

    override fun onAttachedToWindow() { super.onAttachedToWindow(); syncAnimations() }
    override fun onDetachedFromWindow() {
        stopSpin()
        armAnimation?.cancel()
        armAnimation = null
        super.onDetachedFromWindow()
    }
    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        super.onVisibilityChanged(changedView, visibility)
        if (ready) syncAnimations()
    }
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (ready) syncAnimations()
    }

    private fun syncAnimations() {
        if (!ready) return
        val visible = isShown && windowVisibility == VISIBLE
        val enabled = ValueAnimator.areAnimatorsEnabled()
        val animate = TurntableMotion.shouldSpin(playing && trackKey != null, hostResumed,
            isAttachedToWindow, visible, enabled)
        if (animate && spin == null) {
            val start = discRotationDegrees
            platter.setLayerType(LAYER_TYPE_HARDWARE, null)
            spin = ValueAnimator.ofFloat(0f, 360f).apply {
                duration = TurntableMotion.REVOLUTION_MS
                repeatCount = ValueAnimator.INFINITE
                interpolator = LinearInterpolator()
                addUpdateListener { platter.rotation = TurntableMotion.normalize(start + (it.animatedValue as Float)) }
                start()
            }
        } else if (!animate) {
            stopSpin()
        }
        val target = if (playing && trackKey != null) 1f else 0f
        if (!hostResumed || !isAttachedToWindow || !visible || !enabled) {
            armAnimation?.cancel()
            armAnimation = null
            tonearm.engagement = target
        } else if (tonearm.targetEngagement != target) {
            armAnimation?.cancel()
            tonearm.targetEngagement = target
            armAnimation = ValueAnimator.ofFloat(tonearm.engagement, target).apply {
                duration = 320L
                interpolator = DecelerateInterpolator()
                addUpdateListener { tonearm.engagement = it.animatedValue as Float }
                start()
            }
        }
        tonearm.targetEngagement = target
    }

    private fun stopSpin() {
        spin?.cancel()
        spin = null
        // cancel() preserves the current angle; resume starts from exactly this angle.
        platter.setLayerType(LAYER_TYPE_NONE, null)
    }

    private class VinylFace(context: Context) : View(context) {
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        private val sheen = Paint(Paint.ANTI_ALIAS_FLAG)
        private val groove = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
        private var radius = 0f
        override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
            radius = min(w, h) / 2f
            if (radius <= 0f) return
            fill.shader = RadialGradient(w / 2f, h / 2f, radius,
                intArrayOf(Color.rgb(28, 27, 34), Color.rgb(10, 10, 13), Color.rgb(29, 28, 33), Color.BLACK),
                floatArrayOf(0f, 0.66f, 0.96f, 1f), Shader.TileMode.CLAMP)
            sheen.shader = SweepGradient(w / 2f, h / 2f,
                intArrayOf(Color.TRANSPARENT, 0x24FFFFFF, Color.TRANSPARENT, 0x17FFFFFF, Color.TRANSPARENT),
                floatArrayOf(0f, 0.20f, 0.46f, 0.70f, 1f))
            groove.strokeWidth = (radius * 0.0022f).coerceAtLeast(0.6f)
        }
        override fun onDraw(canvas: Canvas) {
            if (radius <= 0f) return
            val cx = width / 2f
            val cy = height / 2f
            canvas.drawCircle(cx, cy, radius, fill)
            for (i in 0..36) {
                groove.color = if (i % 3 == 0) 0x19FFFFFF else 0x09FFFFFF
                canvas.drawCircle(cx, cy, radius * (0.66f + i * 0.0086f), groove)
            }
            canvas.drawCircle(cx, cy, radius * 0.995f, sheen)
            groove.color = colorWithAlpha(XtColors.primarySoft, 65)
            canvas.drawCircle(cx, cy, radius * 0.646f, groove)
        }
    }

    private class Tonearm(context: Context) : View(context) {
        var targetEngagement = 0f
        var engagement = 0f
            set(value) { field = value; invalidate() }
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        private val arm = Path()
        private var ax = 0f
        private var ay = 0f
        private var diameter = 0f
        fun setGeometry(cx: Float, top: Float, d: Float) {
            diameter = d
            ax = cx + d * 0.06f
            ay = top - d * 0.12f
            arm.reset()
            arm.moveTo(ax, ay)
            arm.lineTo(ax + d * 0.13f, ay + d * 0.21f)
            arm.quadTo(ax + d * 0.15f, ay + d * 0.24f, ax + d * 0.19f, ay + d * 0.26f)
            arm.lineTo(ax + d * 0.25f, ay + d * 0.29f)
            invalidate()
        }
        override fun onDraw(canvas: Canvas) {
            if (diameter <= 0f) return
            val d = diameter
            paint.style = Paint.Style.FILL
            paint.color = colorWithAlpha(XtColors.primary, 32)
            canvas.drawCircle(ax, ay, d * 0.047f, paint)
            paint.color = XtColors.surfaceSoft
            canvas.drawCircle(ax, ay, d * 0.032f, paint)
            val save = canvas.save()
            canvas.rotate(-26f * (1f - engagement), ax, ay)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = d * 0.021f
            paint.color = 0x55000000
            canvas.drawPath(arm, paint)
            paint.strokeWidth = d * 0.012f
            paint.color = XtColors.textSecondary
            canvas.drawPath(arm, paint)
            paint.strokeWidth = d * 0.0035f
            paint.color = XtColors.text
            canvas.drawPath(arm, paint)
            paint.style = Paint.Style.FILL
            val hx = ax + d * 0.25f
            val hy = ay + d * 0.29f
            canvas.rotate(30f, hx, hy)
            paint.color = XtColors.textSecondary
            canvas.drawRoundRect(hx - d * 0.026f, hy - d * 0.019f,
                hx + d * 0.035f, hy + d * 0.019f, d * 0.007f, d * 0.007f, paint)
            paint.color = XtColors.primarySoft
            canvas.drawRoundRect(hx + d * 0.008f, hy - d * 0.015f,
                hx + d * 0.035f, hy + d * 0.015f, d * 0.004f, d * 0.004f, paint)
            canvas.restoreToCount(save)
            paint.color = XtColors.text
            canvas.drawCircle(ax, ay, d * 0.019f, paint)
            paint.color = XtColors.primarySoft
            canvas.drawCircle(ax, ay, d * 0.007f, paint)
        }
    }
}
