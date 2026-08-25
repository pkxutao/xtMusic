#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod app;
mod backend;
mod lrc;
mod model;
mod player;
mod storage;

use eframe::egui;
use single_instance::SingleInstance;

fn main() -> eframe::Result<()> {
    let instance = SingleInstance::new("com.pkxutao.xtmusic.native")
        .expect("failed to create XT Music single-instance lock");
    if !instance.is_single() {
        return Ok(());
    }

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("XT Music Native 0.3.0")
            .with_inner_size([1440.0, 860.0])
            .with_min_inner_size([1024.0, 680.0])
            .with_decorations(true),
        renderer: eframe::Renderer::Glow,
        persist_window: true,
        ..Default::default()
    };

    eframe::run_native(
        "XT Music Native",
        options,
        Box::new(|cc| Ok(Box::new(app::XtMusicApp::new(cc)))),
    )
}
