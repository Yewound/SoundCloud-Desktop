#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(target_os = "linux", test))]
mod parse;
#[cfg(test)]
mod tests;
#[cfg(windows)]
mod windows;

use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::Path;
use std::sync::Mutex;

use tauri::Manager;

use crate::rt::AppHandle;
use crate::shared::blocking::run_blocking;

#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(windows)]
use windows as platform;

const PREFIX: &str = "desktop_";

static COPYING: Mutex<()> = Mutex::new(());

#[tauri::command]
pub async fn desktop_wallpaper_found(app: AppHandle) -> bool {
    platform::current(&app)
        .await
        .is_some_and(|source| shown_ext(&source).is_some())
}

#[tauri::command]
pub async fn desktop_wallpaper_sync(app: AppHandle) -> Option<String> {
    let source = platform::current(&app).await?;
    let dir = app.path().app_cache_dir().ok()?.join("wallpapers");
    run_blocking(move || cache_copy(&source, &dir))
        .await
        .ok()
        .flatten()
}

fn shown_ext(source: &Path) -> Option<String> {
    let ext = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("jpg")
        .to_ascii_lowercase();
    platform::FORMATS.contains(&ext.as_str()).then_some(ext)
}

fn cache_copy(source: &Path, dir: &Path) -> Option<String> {
    let ext = shown_ext(source)?;
    let meta = fs::metadata(source).ok().filter(|meta| meta.is_file())?;
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    meta.len().hash(&mut hasher);
    meta.modified().ok().hash(&mut hasher);
    let name = format!("{PREFIX}{:016x}.{ext}", hasher.finish());
    let target = dir.join(&name);

    let _copying = COPYING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if target.exists() {
        return Some(name);
    }
    fs::create_dir_all(dir).ok()?;
    let partial = dir.join(format!("{name}.part"));
    fs::copy(source, &partial).ok()?;
    fs::rename(&partial, &target).ok()?;
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let file = entry.file_name();
        let file = file.to_string_lossy();
        if file.starts_with(PREFIX) && file != name {
            let _ = fs::remove_file(entry.path());
        }
    }
    Some(name)
}
