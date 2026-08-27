package com.pkxutao.xtmusic.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.MediaPlayer
import android.media.session.MediaSession
import android.media.session.PlaybackState as SystemPlaybackState
import android.net.Uri
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

class PlaybackService : Service(), AudioManager.OnAudioFocusChangeListener {
    private val handler = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private lateinit var mediaSession: MediaSession
    private lateinit var audioManager: AudioManager
    private var audioFocusRequest: AudioFocusRequest? = null

    private val progressTask = object : Runnable {
        override fun run() {
            val current = player
            val previous = PlaybackState.snapshot
            if (current != null && (current.isPlaying || previous.preparing)) {
                PlaybackState.update(
                    previous.copy(
                        playing = runCatching { current.isPlaying }.getOrDefault(false),
                        positionMs = runCatching { current.currentPosition.toLong() }.getOrDefault(previous.positionMs),
                        durationMs = runCatching { current.duration.toLong() }.getOrDefault(previous.durationMs)
                    )
                )
                updateSystemState()
            }
            handler.postDelayed(this, 500)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
        audioManager = getSystemService(AudioManager::class.java)
        mediaSession = MediaSession(this, "XTMusicAndroid").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = toggle(forcePlay = true)
                override fun onPause() = pause()
                override fun onSkipToNext() = next()
                override fun onSkipToPrevious() = previous()
                override fun onSeekTo(pos: Long) = seek(pos)
                override fun onStop() = stopPlayback()
            })
            isActive = true
        }
        handler.post(progressTask)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY_CURRENT -> playCurrent()
            ACTION_TOGGLE -> toggle()
            ACTION_NEXT -> next()
            ACTION_PREVIOUS -> previous()
            ACTION_SEEK -> seek(intent.getLongExtra(EXTRA_POSITION_MS, 0))
            ACTION_STOP -> stopPlayback()
            else -> if (PlaybackQueue.current() != null && player == null) playCurrent()
        }
        return START_NOT_STICKY
    }

    private fun playCurrent() {
        val track = PlaybackQueue.current() ?: run {
            stopSelf()
            return
        }
        val session = SessionStore(this).load() ?: run {
            PlaybackState.update(PlaybackSnapshot(track = track, error = "登录状态不存在，请重新登录"))
            stopSelf()
            return
        }

        releasePlayer()
        startForeground(NOTIFICATION_ID, notification(track, false, true))

        val client = FnosClient(session)
        val nextPlayer = MediaPlayer()
        player = nextPlayer
        PlaybackState.update(PlaybackSnapshot(track = track, preparing = true))

        try {
            nextPlayer.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK)
            nextPlayer.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            nextPlayer.setDataSource(
                this,
                Uri.parse(client.streamUrl(track.guid)),
                client.resourceHeaders()
            )
            nextPlayer.setOnPreparedListener { prepared ->
                if (!requestAudioFocus()) {
                    PlaybackState.update(
                        PlaybackSnapshot(track = track, error = "无法获得音频焦点")
                    )
                    return@setOnPreparedListener
                }
                prepared.start()
                PlaybackState.update(
                    PlaybackSnapshot(
                        track = track,
                        playing = true,
                        preparing = false,
                        durationMs = prepared.duration.toLong().coerceAtLeast(0)
                    )
                )
                client.reportPlay(track.guid)
                updateNotification()
                updateSystemMetadata(track)
                updateSystemState()
            }
            nextPlayer.setOnCompletionListener {
                if (PlaybackQueue.canNext()) next() else pause(resetPosition = true)
            }
            nextPlayer.setOnErrorListener { _, what, extra ->
                PlaybackState.update(
                    PlaybackSnapshot(
                        track = track,
                        error = "播放失败（MediaPlayer $what/$extra）"
                    )
                )
                updateNotification()
                true
            }
            nextPlayer.prepareAsync()
        } catch (error: Exception) {
            PlaybackState.update(
                PlaybackSnapshot(
                    track = track,
                    error = error.message ?: "无法打开音频流"
                )
            )
            updateNotification()
        }
    }

    private fun toggle(forcePlay: Boolean = false) {
        val current = player
        if (current == null) {
            playCurrent()
            return
        }
        runCatching {
            if (current.isPlaying && !forcePlay) {
                current.pause()
                PlaybackState.update(PlaybackState.snapshot.copy(playing = false))
                abandonAudioFocus()
            } else {
                if (requestAudioFocus()) {
                    current.start()
                    PlaybackState.update(PlaybackState.snapshot.copy(playing = true, error = null))
                }
            }
        }.onFailure {
            PlaybackState.update(PlaybackState.snapshot.copy(error = it.message ?: "播放控制失败"))
        }
        updateNotification()
        updateSystemState()
    }

    private fun pause(resetPosition: Boolean = false) {
        val current = player ?: return
        runCatching {
            if (current.isPlaying) current.pause()
            if (resetPosition) current.seekTo(0)
        }
        PlaybackState.update(
            PlaybackState.snapshot.copy(
                playing = false,
                positionMs = if (resetPosition) 0 else PlaybackState.snapshot.positionMs
            )
        )
        abandonAudioFocus()
        updateNotification()
        updateSystemState()
    }

    private fun next() {
        if (PlaybackQueue.canNext()) {
            PlaybackQueue.next()
            playCurrent()
        }
    }

    private fun previous() {
        val currentPosition = player?.currentPosition ?: 0
        if (currentPosition > 5_000) {
            seek(0)
        } else if (PlaybackQueue.canPrevious()) {
            PlaybackQueue.previous()
            playCurrent()
        }
    }

    private fun seek(positionMs: Long) {
        val current = player ?: return
        runCatching {
            current.seekTo(positionMs.coerceIn(0, current.duration.toLong().coerceAtLeast(0)).toInt())
            PlaybackState.update(PlaybackState.snapshot.copy(positionMs = current.currentPosition.toLong()))
        }
        updateSystemState()
    }

    private fun stopPlayback() {
        releasePlayer()
        PlaybackState.update(PlaybackSnapshot())
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun releasePlayer() {
        player?.let {
            runCatching { it.stop() }
            runCatching { it.reset() }
            runCatching { it.release() }
        }
        player = null
        abandonAudioFocus()
    }

    private fun updateNotification() {
        val snapshot = PlaybackState.snapshot
        val track = snapshot.track ?: return
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, notification(track, snapshot.playing, snapshot.preparing))
    }

    private fun notification(track: Track, playing: Boolean, preparing: Boolean): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            1,
            Intent(this, NowPlayingActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val previousIntent = servicePendingIntent(ACTION_PREVIOUS, 2)
        val toggleIntent = servicePendingIntent(ACTION_TOGGLE, 3)
        val nextIntent = servicePendingIntent(ACTION_NEXT, 4)

        val builder = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(track.title)
            .setContentText(
                if (preparing) "正在连接 · ${track.artistText}"
                else "${track.artistText} · ${track.albumText}"
            )
            .setContentIntent(openIntent)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(playing || preparing)
            .addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_media_previous,
                    "上一首",
                    previousIntent
                ).build()
            )
            .addAction(
                Notification.Action.Builder(
                    if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                    if (playing) "暂停" else "播放",
                    toggleIntent
                ).build()
            )
            .addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_media_next,
                    "下一首",
                    nextIntent
                ).build()
            )
            .setStyle(
                Notification.MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
        return builder.build()
    }

    private fun servicePendingIntent(action: String, requestCode: Int): PendingIntent {
        return PendingIntent.getService(
            this,
            requestCode,
            Intent(this, PlaybackService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun updateSystemMetadata(track: Track) {
        mediaSession.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, track.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, track.artistText)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, track.albumText)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, PlaybackState.snapshot.durationMs)
                .build()
        )
    }

    private fun updateSystemState() {
        val snapshot = PlaybackState.snapshot
        val actions = SystemPlaybackState.ACTION_PLAY or
            SystemPlaybackState.ACTION_PAUSE or
            SystemPlaybackState.ACTION_PLAY_PAUSE or
            SystemPlaybackState.ACTION_SEEK_TO or
            SystemPlaybackState.ACTION_SKIP_TO_NEXT or
            SystemPlaybackState.ACTION_SKIP_TO_PREVIOUS or
            SystemPlaybackState.ACTION_STOP
        val state = when {
            snapshot.preparing -> SystemPlaybackState.STATE_BUFFERING
            snapshot.playing -> SystemPlaybackState.STATE_PLAYING
            snapshot.track != null -> SystemPlaybackState.STATE_PAUSED
            else -> SystemPlaybackState.STATE_NONE
        }
        mediaSession.setPlaybackState(
            SystemPlaybackState.Builder()
                .setActions(actions)
                .setState(state, snapshot.positionMs, if (snapshot.playing) 1f else 0f)
                .build()
        )
    }

    private fun requestAudioFocus(): Boolean {
        if (audioFocusRequest == null) {
            audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setOnAudioFocusChangeListener(this)
                .build()
        }
        return audioManager.requestAudioFocus(audioFocusRequest!!) ==
            AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun abandonAudioFocus() {
        audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
    }

    override fun onAudioFocusChange(focusChange: Int) {
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> pause()
            AudioManager.AUDIOFOCUS_GAIN -> {
                if (PlaybackState.snapshot.track != null && !PlaybackState.snapshot.playing) {
                    toggle(forcePlay = true)
                }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK ->
                player?.setVolume(0.25f, 0.25f)
        }
        if (focusChange == AudioManager.AUDIOFOCUS_GAIN) player?.setVolume(1f, 1f)
    }

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "音乐播放",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "XT Music 后台播放控制"
                setSound(null, null)
            }
        )
    }

    override fun onDestroy() {
        handler.removeCallbacks(progressTask)
        releasePlayer()
        mediaSession.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_PLAY_CURRENT = "com.pkxutao.xtmusic.android.PLAY_CURRENT"
        const val ACTION_TOGGLE = "com.pkxutao.xtmusic.android.TOGGLE"
        const val ACTION_NEXT = "com.pkxutao.xtmusic.android.NEXT"
        const val ACTION_PREVIOUS = "com.pkxutao.xtmusic.android.PREVIOUS"
        const val ACTION_SEEK = "com.pkxutao.xtmusic.android.SEEK"
        const val ACTION_STOP = "com.pkxutao.xtmusic.android.STOP"
        const val EXTRA_POSITION_MS = "position_ms"

        private const val CHANNEL_ID = "xtmusic_playback"
        private const val NOTIFICATION_ID = 3701

        fun start(context: Context) {
            context.startForegroundService(
                Intent(context, PlaybackService::class.java)
                    .setAction(ACTION_PLAY_CURRENT)
            )
        }

        fun command(context: Context, action: String, positionMs: Long? = null) {
            val intent = Intent(context, PlaybackService::class.java).setAction(action)
            if (positionMs != null) intent.putExtra(EXTRA_POSITION_MS, positionMs)
            context.startService(intent)
        }
    }
}
