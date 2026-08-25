use std::fmt;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use xtmusic_core::MediaHeaders;

#[cfg(unix)]
use std::os::unix::net::UnixStream;
#[cfg(windows)]
use std::fs::OpenOptions;

#[derive(Clone)]
pub struct MpvController {
    inner: Arc<Mutex<MpvProcess>>,
}

impl fmt::Debug for MpvController {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("MpvController").finish_non_exhaustive()
    }
}

struct MpvProcess {
    child: Child,
    endpoint: String,
    #[cfg(unix)]
    endpoint_path: PathBuf,
}

impl MpvController {
    pub fn spawn(headers: MediaHeaders) -> Result<Self, String> {
        let executable = discover_mpv();
        let endpoint = endpoint_name();
        let mut command = Command::new(&executable);
        command
            .arg("--idle=yes")
            .arg("--no-video")
            .arg("--force-window=no")
            .arg("--audio-display=no")
            .arg("--no-terminal")
            .arg("--really-quiet")
            .arg(format!("--input-ipc-server={endpoint}"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        if !headers.values.is_empty() {
            let fields = headers
                .values
                .iter()
                .map(|(name, value)| format!("{name}: {value}"))
                .collect::<Vec<_>>()
                .join(",");
            command.arg(format!("--http-header-fields={fields}"));
        }

        let child = command.spawn().map_err(|error| {
            format!(
                "无法启动原生播放器 mpv（{}）：{}。请安装 mpv 或设置 XTMUSIC_MPV。",
                executable.display(),
                error
            )
        })?;

        let process = MpvProcess {
            child,
            endpoint: endpoint.clone(),
            #[cfg(unix)]
            endpoint_path: PathBuf::from(&endpoint),
        };
        let controller = Self {
            inner: Arc::new(Mutex::new(process)),
        };
        controller.wait_until_ready()?;
        Ok(controller)
    }

    pub fn play(&self, url: &str) -> Result<(), String> {
        self.command(serde_json::json!({
            "command": ["loadfile", url, "replace"]
        }))?;
        self.command(serde_json::json!({
            "command": ["set_property", "pause", false]
        }))?;
        Ok(())
    }

    pub fn toggle_pause(&self) -> Result<(), String> {
        self.command(serde_json::json!({"command": ["cycle", "pause"]}))
    }

    pub fn stop(&self) -> Result<(), String> {
        self.command(serde_json::json!({"command": ["stop"]}))
    }

    pub fn set_volume(&self, value: f32) -> Result<(), String> {
        self.command(serde_json::json!({
            "command": [
                "set_property",
                "volume",
                (value.clamp(0.0, 1.0) * 100.0).round()
            ]
        }))
    }

    pub fn seek(&self, seconds: f64) -> Result<(), String> {
        self.command(serde_json::json!({
            "command": ["seek", seconds.max(0.0), "absolute+exact"]
        }))
    }

    pub fn position(&self) -> Result<f64, String> {
        let response = self.request(serde_json::json!({
            "command": ["get_property", "time-pos"]
        }))?;
        Ok(response
            .get("data")
            .and_then(serde_json::Value::as_f64)
            .unwrap_or_default())
    }

    fn wait_until_ready(&self) -> Result<(), String> {
        let started = Instant::now();
        loop {
            match self.request(serde_json::json!({
                "command": ["get_property", "idle-active"]
            })) {
                Ok(_) => return Ok(()),
                Err(_) if started.elapsed() < Duration::from_secs(3) => {
                    std::thread::sleep(Duration::from_millis(60));
                }
                Err(error) => return Err(format!("mpv IPC 初始化失败：{error}")),
            }
        }
    }

    fn command(&self, value: serde_json::Value) -> Result<(), String> {
        self.request(value).map(|_| ())
    }

    fn request(&self, value: serde_json::Value) -> Result<serde_json::Value, String> {
        let endpoint = self
            .inner
            .lock()
            .map_err(|_| "播放器状态锁已损坏".to_owned())?
            .endpoint
            .clone();
        request_line(&endpoint, &format!("{}\n", value))
    }
}

impl Drop for MpvProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        #[cfg(unix)]
        let _ = std::fs::remove_file(&self.endpoint_path);
    }
}

fn discover_mpv() -> PathBuf {
    if let Some(value) = std::env::var_os("XTMUSIC_MPV") {
        return PathBuf::from(value);
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(dir) = executable.parent() {
            for relative in bundled_candidates() {
                let path = dir.join(relative);
                if path.exists() {
                    return path;
                }
            }
        }
    }
    PathBuf::from(if cfg!(windows) { "mpv.exe" } else { "mpv" })
}

fn bundled_candidates() -> &'static [&'static str] {
    if cfg!(windows) {
        &["mpv.exe", "runtime/mpv/mpv.exe", "resources/mpv/mpv.exe"]
    } else {
        &["mpv", "runtime/mpv/mpv", "resources/mpv/mpv"]
    }
}

fn endpoint_name() -> String {
    let unique = format!("{}-{}", std::process::id(), now_nanos());
    if cfg!(windows) {
        format!(r"\\.\pipe\xtmusic-{unique}")
    } else {
        std::env::temp_dir()
            .join(format!("xtmusic-{unique}.sock"))
            .to_string_lossy()
            .into_owned()
    }
}

fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

#[cfg(unix)]
fn request_line(endpoint: &str, line: &str) -> Result<serde_json::Value, String> {
    let mut stream = UnixStream::connect(endpoint).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(line.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    BufReader::new(stream)
        .read_line(&mut response)
        .map_err(|error| error.to_string())?;
    parse_response(&response)
}

#[cfg(windows)]
fn request_line(endpoint: &str, line: &str) -> Result<serde_json::Value, String> {
    let mut pipe = OpenOptions::new()
        .read(true)
        .write(true)
        .open(endpoint)
        .map_err(|error| error.to_string())?;
    pipe.write_all(line.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    BufReader::new(pipe)
        .read_line(&mut response)
        .map_err(|error| error.to_string())?;
    parse_response(&response)
}

fn parse_response(response: &str) -> Result<serde_json::Value, String> {
    let value: serde_json::Value =
        serde_json::from_str(response.trim()).map_err(|error| error.to_string())?;
    if value
        .get("error")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|error| error != "success")
    {
        return Err(value
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("mpv command failed")
            .to_owned());
    }
    Ok(value)
}
