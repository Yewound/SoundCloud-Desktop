use std::path::PathBuf;

use objc2::MainThreadMarker;
use objc2_app_kit::{NSScreen, NSWorkspace};
use tokio::sync::oneshot;

use crate::rt::AppHandle;

pub const FORMATS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "heic", "jxl", "tif", "tiff",
];

pub async fn current(app: &AppHandle) -> Option<PathBuf> {
    let (sender, receiver) = oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(main_screen_image());
    })
    .ok()?;
    receiver.await.ok().flatten()
}

fn main_screen_image() -> Option<PathBuf> {
    let screen = NSScreen::mainScreen(MainThreadMarker::new()?)?;
    NSWorkspace::sharedWorkspace()
        .desktopImageURLForScreen(&screen)?
        .to_file_path()
}
