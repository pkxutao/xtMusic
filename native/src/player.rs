use crate::model::Track;
use crossbeam_channel::{unbounded, Receiver, RecvTimeoutError, Sender};
use rodio::{Decoder, OutputStream, Sink, Source};
use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, Default)]
pub struct PlayerState {
    pub track: Option<Track>,
    pub playing: bool,
    pub loading: bool,
    pub position: f64,
    pub duration: f64,
    pub volume: f32,
    pub error: Option<String>,
}

#[derive(Debug)]
pub enum PlayerCommand {
    Load {
        track: Track,
        path: PathBuf,
        autoplay: bool,
    },
    Toggle,
    Play,
    Pause,
    Stop,
    Seek(f64),
    Volume(f32),
    Shutdown,
}

#[derive(Debug, Clone)]
pub enum PlayerEvent {
    State(PlayerState),
    Ended(String),
    Error(String),
}

pub struct NativePlayer {
    command_tx: Sender<PlayerCommand>,
    event_rx: Receiver<PlayerEvent>,
}

impl NativePlayer {
    pub fn new(initial_volume: f32) -> Self {
        let (command_tx, command_rx) = unbounded();
        let (event_tx, event_rx) = unbounded();
        thread::Builder::new()
            .name("xtmusic-audio".into())
            .spawn(move || audio_thread(command_rx, event_tx, initial_volume.clamp(0.0, 1.0)))
            .expect("unable to start native audio thread");
        Self {
            command_tx,
            event_rx,
        }
    }

    pub fn send(&self, command: PlayerCommand) {
        let _ = self.command_tx.send(command);
    }

    pub fn try_events(&self) -> impl Iterator<Item = PlayerEvent> + '_ {
        self.event_rx.try_iter()
    }
}

impl Drop for NativePlayer {
    fn drop(&mut self) {
        let _ = self.command_tx.send(PlayerCommand::Shutdown);
    }
}

fn audio_thread(
    command_rx: Receiver<PlayerCommand>,
    event_tx: Sender<PlayerEvent>,
    initial_volume: f32,
) {
    let Ok((_stream, handle)) = OutputStream::try_default() else {
        let _ = event_tx.send(PlayerEvent::Error("未找到可用的系统音频输出设备".into()));
        return;
    };

    let mut sink: Option<Sink> = None;
    let mut state = PlayerState {
        volume: initial_volume,
        ..Default::default()
    };
    let mut ended_sent = false;

    loop {
        match command_rx.recv_timeout(Duration::from_millis(80)) {
            Ok(PlayerCommand::Load {
                track,
                path,
                autoplay,
            }) => {
                if let Some(previous) = sink.take() {
                    previous.stop();
                }
                state.loading = true;
                state.error = None;
                state.position = 0.0;
                state.duration = track.duration;
                state.track = Some(track.clone());
                send_state(&event_tx, &state);

                let result = (|| {
                    let file =
                        File::open(&path).map_err(|error| format!("无法读取音频缓存：{error}"))?;
                    let decoder = Decoder::new(BufReader::new(file))
                        .map_err(|error| format!("当前格式无法解码：{error}"))?;
                    let decoded_duration =
                        decoder.total_duration().map(|value| value.as_secs_f64());
                    let next = Sink::try_new(&handle)
                        .map_err(|error| format!("无法创建系统音频输出：{error}"))?;
                    next.set_volume(state.volume);
                    next.append(decoder);
                    if autoplay {
                        next.play();
                    } else {
                        next.pause();
                    }
                    Ok::<(Sink, Option<f64>), String>((next, decoded_duration))
                })();

                match result {
                    Ok((next, decoded_duration)) => {
                        if let Some(duration) = decoded_duration {
                            state.duration = duration;
                        }
                        state.loading = false;
                        state.playing = autoplay;
                        sink = Some(next);
                        ended_sent = false;
                        send_state(&event_tx, &state);
                    }
                    Err(message) => {
                        state.loading = false;
                        state.playing = false;
                        state.error = Some(message.clone());
                        let _ = event_tx.send(PlayerEvent::Error(message));
                        send_state(&event_tx, &state);
                    }
                }
            }
            Ok(PlayerCommand::Toggle) => {
                if let Some(current) = sink.as_ref() {
                    if current.is_paused() {
                        current.play();
                        state.playing = true;
                    } else {
                        current.pause();
                        state.playing = false;
                    }
                    send_state(&event_tx, &state);
                }
            }
            Ok(PlayerCommand::Play) => {
                if let Some(current) = sink.as_ref() {
                    current.play();
                    state.playing = true;
                    send_state(&event_tx, &state);
                }
            }
            Ok(PlayerCommand::Pause) => {
                if let Some(current) = sink.as_ref() {
                    current.pause();
                    state.playing = false;
                    send_state(&event_tx, &state);
                }
            }
            Ok(PlayerCommand::Stop) => {
                if let Some(current) = sink.take() {
                    current.stop();
                }
                state = PlayerState {
                    volume: state.volume,
                    ..Default::default()
                };
                ended_sent = false;
                send_state(&event_tx, &state);
            }
            Ok(PlayerCommand::Seek(seconds)) => {
                if let Some(current) = sink.as_ref() {
                    let target = seconds.max(0.0).min(state.duration.max(seconds));
                    match current.try_seek(Duration::from_secs_f64(target)) {
                        Ok(()) => {
                            state.position = target;
                            send_state(&event_tx, &state);
                        }
                        Err(error) => {
                            let _ = event_tx
                                .send(PlayerEvent::Error(format!("当前音频无法跳转：{error}")));
                        }
                    }
                }
            }
            Ok(PlayerCommand::Volume(volume)) => {
                state.volume = volume.clamp(0.0, 1.0);
                if let Some(current) = sink.as_ref() {
                    current.set_volume(state.volume);
                }
                send_state(&event_tx, &state);
            }
            Ok(PlayerCommand::Shutdown) => break,
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }

        if let Some(current) = sink.as_ref() {
            state.position = current.get_pos().as_secs_f64();
            state.playing = !current.is_paused() && !current.empty();
            if current.empty() && state.track.is_some() && !ended_sent {
                ended_sent = true;
                state.playing = false;
                if let Some(track) = state.track.as_ref() {
                    let _ = event_tx.send(PlayerEvent::Ended(track.guid.clone()));
                }
            }
            send_state(&event_tx, &state);
        }
    }
}

fn send_state(sender: &Sender<PlayerEvent>, state: &PlayerState) {
    let _ = sender.send(PlayerEvent::State(state.clone()));
}
