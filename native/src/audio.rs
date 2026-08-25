use anyhow::{anyhow, Context, Result};
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub struct AudioPlayer {
    _stream: OutputStream,
    handle: OutputStreamHandle,
    sink: Option<Sink>,
    path: Option<PathBuf>,
    volume: f32,
    base_position: Duration,
    started_at: Option<Instant>,
    paused: bool,
}

impl AudioPlayer {
    pub fn new() -> Result<Self> {
        let (stream, handle) = OutputStream::try_default()
            .context("没有找到可用的系统音频输出设备")?;
        Ok(Self {
            _stream: stream,
            handle,
            sink: None,
            path: None,
            volume: 0.82,
            base_position: Duration::ZERO,
            started_at: None,
            paused: true,
        })
    }

    pub fn load(&mut self, path: impl AsRef<Path>, autoplay: bool) -> Result<()> {
        self.path = Some(path.as_ref().to_path_buf());
        self.rebuild(Duration::ZERO, autoplay)
    }

    fn rebuild(&mut self, offset: Duration, autoplay: bool) -> Result<()> {
        let path = self.path.clone().ok_or_else(|| anyhow!("没有音频文件"))?;
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        let file = File::open(&path)
            .with_context(|| format!("无法打开音频文件：{}", path.display()))?;
        let decoder = Decoder::new(BufReader::new(file))
            .context("当前音频格式无法由系统解码")?;
        let sink = Sink::try_new(&self.handle)
            .context("无法创建系统音频播放器")?;
        sink.set_volume(self.volume);
        sink.append(decoder.skip_duration(offset));
        if autoplay {
            sink.play();
            self.started_at = Some(Instant::now());
            self.paused = false;
        } else {
            sink.pause();
            self.started_at = None;
            self.paused = true;
        }
        self.base_position = offset;
        self.sink = Some(sink);
        Ok(())
    }

    pub fn toggle(&mut self) {
        if self.paused { self.play(); } else { self.pause(); }
    }

    pub fn play(&mut self) {
        if let Some(sink) = &self.sink {
            if self.paused {
                sink.play();
                self.started_at = Some(Instant::now());
                self.paused = false;
            }
        }
    }

    pub fn pause(&mut self) {
        if self.sink.is_some() && !self.paused {
            self.base_position = self.position();
            self.started_at = None;
            if let Some(sink) = &self.sink {
                sink.pause();
            }
            self.paused = true;
        }
    }

    pub fn seek(&mut self, seconds: f64) -> Result<()> {
        if self.path.is_none() {
            return Ok(());
        }
        let offset = Duration::from_secs_f64(seconds.max(0.0));
        self.rebuild(offset, !self.paused)
    }

    pub fn stop(&mut self) {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.path = None;
        self.base_position = Duration::ZERO;
        self.started_at = None;
        self.paused = true;
    }

    pub fn position(&self) -> Duration {
        match self.started_at {
            Some(start) if !self.paused => self.base_position.saturating_add(start.elapsed()),
            _ => self.base_position,
        }
    }

    pub fn is_paused(&self) -> bool { self.paused }

    pub fn is_finished(&self) -> bool {
        self.sink.as_ref().is_some_and(|sink| sink.empty()) && self.path.is_some()
    }

    pub fn set_volume(&mut self, value: f32) {
        self.volume = value.clamp(0.0, 1.0);
        if let Some(sink) = &self.sink {
            sink.set_volume(self.volume);
        }
    }
}
