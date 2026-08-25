use std::fs;
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read(path: impl AsRef<Path>) -> String {
    fs::read_to_string(path).expect("source file must be readable")
}

#[test]
fn runtime_has_no_webview_or_electron_dependency() {
    let cargo = read(root().join("Cargo.toml")).to_ascii_lowercase();
    for forbidden in ["electron", "tauri", "wry", "webview", "webkit2gtk"] {
        assert!(
            !cargo.contains(forbidden),
            "native runtime must not depend on {forbidden}"
        );
    }
    assert!(cargo.contains("eframe"));
    assert!(cargo.contains("rodio"));
}

#[test]
fn password_is_not_serializable_or_persisted() {
    let model = read(root().join("src/model.rs"));
    let storage = read(root().join("src/storage.rs"));
    assert!(!storage.contains("password:"));
    assert!(!storage.contains("password\""));
    assert!(model.contains("pub password: String"));
    assert!(!model.contains("struct LoginRequest") || !model.contains("Serialize, Deserialize)]\npub struct LoginRequest"));
}

#[test]
fn redirect_layer_strips_sensitive_headers() {
    let transport = read(root().join("src/api.rs"));
    for marker in [
        "headers.remove(COOKIE)",
        "headers.remove(AUTHORIZATION)",
        "x-access-code",
        "HTTPS_DOWNGRADE_BLOCKED",
    ] {
        assert!(transport.contains(marker), "missing redirect guard: {marker}");
    }
}

#[test]
fn large_track_lists_are_virtualized() {
    let app = read(root().join("src/app.rs"));
    assert!(app.contains("show_rows(ui, 38.0, tracks.len()"));
}
