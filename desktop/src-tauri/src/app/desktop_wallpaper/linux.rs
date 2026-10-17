use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::fs;
use tokio::process::Command;

use super::parse::{
    fehbg_image, gvariant_string, hyprpaper_image, largest_package_image, plasma_activity,
    plasma_image, slideshow_first, swww_image, uri_path, xfce_image_property,
};
use crate::rt::AppHandle;

const GNOME_BACKGROUND: &str = "org.gnome.desktop.background";
const GNOME_LIKE: [&str; 4] = ["gnome", "unity", "budgie", "pantheon"];
const TOOL_TIMEOUT: Duration = Duration::from_secs(3);

pub const FORMATS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "jxl",
];

pub async fn current(_app: &AppHandle) -> Option<PathBuf> {
    if Path::new("/.flatpak-info").exists() {
        return None;
    }
    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let found = if desktop.contains("kde") {
        plasma().await
    } else if desktop.contains("cinnamon") {
        gsettings("org.cinnamon.desktop.background", "picture-uri").await
    } else if desktop.contains("mate") {
        gsettings("org.mate.background", "picture-filename").await
    } else if desktop.contains("xfce") {
        xfce().await
    } else if GNOME_LIKE.iter().any(|name| desktop.contains(name)) {
        gnome().await
    } else {
        window_manager().await
    };
    resolve(found?).await
}

async fn gnome() -> Option<PathBuf> {
    let scheme = output(
        "gsettings",
        &["get", "org.gnome.desktop.interface", "color-scheme"],
    )
    .await
    .unwrap_or_default();
    if scheme.contains("dark")
        && let Some(path) = gsettings(GNOME_BACKGROUND, "picture-uri-dark").await
    {
        return Some(path);
    }
    gsettings(GNOME_BACKGROUND, "picture-uri").await
}

async fn gsettings(schema: &str, key: &str) -> Option<PathBuf> {
    let value = output("gsettings", &["get", schema, key]).await?;
    uri_path(gvariant_string(&value)?)
}

async fn plasma() -> Option<PathBuf> {
    let config_dir = dirs::config_dir()?;
    let activities = fs::read_to_string(config_dir.join("kactivitymanagerdrc"))
        .await
        .unwrap_or_default();
    let config = fs::read_to_string(config_dir.join("plasma-org.kde.plasma.desktop-appletsrc"))
        .await
        .ok()?;
    uri_path(plasma_image(&config, plasma_activity(&activities))?)
}

async fn xfce() -> Option<PathBuf> {
    let properties = output("xfconf-query", &["-c", "xfce4-desktop", "-l"]).await?;
    let monitors = output("xrandr", &["--listactivemonitors"])
        .await
        .unwrap_or_default();
    let property = xfce_image_property(&properties, &monitors)?;
    let value = output("xfconf-query", &["-c", "xfce4-desktop", "-p", property]).await?;
    uri_path(&value)
}

async fn window_manager() -> Option<PathBuf> {
    for tool in ["awww", "swww"] {
        if let Some(query) = output(tool, &["query"]).await
            && let Some(path) = swww_image(&query).and_then(uri_path)
        {
            return Some(path);
        }
    }
    if let Some(active) = output("hyprctl", &["hyprpaper", "listactive"]).await
        && let Some(path) = hyprpaper_image(&active).and_then(uri_path)
    {
        return Some(path);
    }
    let script = fs::read_to_string(dirs::home_dir()?.join(".fehbg"))
        .await
        .ok()?;
    fehbg_image(&script).and_then(uri_path)
}

async fn resolve(path: PathBuf) -> Option<PathBuf> {
    if fs::metadata(&path).await.ok()?.is_dir() {
        let images = path.join("contents").join("images");
        let mut entries = fs::read_dir(&images).await.ok()?;
        let mut names = Vec::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
        return largest_package_image(&names).map(|name| images.join(name));
    }
    if path.extension().is_some_and(|ext| ext == "xml") {
        return slideshow_first(&fs::read_to_string(&path).await.ok()?);
    }
    Some(path)
}

async fn output(program: &str, args: &[&str]) -> Option<String> {
    let run = Command::new(program)
        .args(args)
        .env_remove("GSETTINGS_SCHEMA_DIR")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output();
    let done = tokio::time::timeout(TOOL_TIMEOUT, run).await.ok()?.ok()?;
    done.status
        .success()
        .then(|| String::from_utf8_lossy(&done.stdout).into_owned())
}
