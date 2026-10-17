use std::path::Path;

use windows_registry::{CURRENT_USER, Key};

use super::LOGIN_ARG;

const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APPROVED_KEY: &str =
    "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
const VALUE_NAME: &str = "soundcloud-desktop";
const LEGACY_VALUE_NAME: &str = "SoundCloud Desktop";

fn command_line(exe: &Path) -> String {
    format!("\"{}\" {LOGIN_ARG}", exe.display())
}

fn registered(name: &str) -> bool {
    CURRENT_USER
        .open(RUN_KEY)
        .and_then(|key| key.get_string(name))
        .is_ok()
}

fn disabled_by_user(name: &str) -> bool {
    CURRENT_USER
        .open(APPROVED_KEY)
        .and_then(|key| key.get_value(name))
        .is_ok_and(|value| value.first().is_some_and(|state| state & 1 == 1))
}

fn enabled_as(name: &str) -> bool {
    registered(name) && !disabled_by_user(name)
}

fn remove_value(key: &Key, name: &str) -> Result<(), String> {
    if key.get_value(name).is_err() {
        return Ok(());
    }
    key.remove_value(name).map_err(|e| e.to_string())
}

fn write_entry(enabled: bool) -> Result<(), String> {
    let run = CURRENT_USER.create(RUN_KEY).map_err(|e| e.to_string())?;
    if let Ok(approved) = CURRENT_USER.options().read().write().open(APPROVED_KEY) {
        remove_value(&approved, VALUE_NAME)?;
        remove_value(&approved, LEGACY_VALUE_NAME)?;
    }
    remove_value(&run, LEGACY_VALUE_NAME)?;
    if !enabled {
        return remove_value(&run, VALUE_NAME);
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    run.set_string(VALUE_NAME, command_line(&exe))
        .map_err(|e| e.to_string())
}

pub fn is_enabled() -> bool {
    enabled_as(VALUE_NAME) || enabled_as(LEGACY_VALUE_NAME)
}

pub async fn set_enabled(enabled: bool, _reason: &str) -> Result<(), String> {
    write_entry(enabled)
}

pub fn refresh() -> Result<(), String> {
    let enabled = is_enabled();
    if enabled || registered(LEGACY_VALUE_NAME) {
        return write_entry(enabled);
    }
    Ok(())
}
