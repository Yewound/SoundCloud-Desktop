use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;

use windows_sys::Win32::UI::WindowsAndMessaging::{SPI_GETDESKWALLPAPER, SystemParametersInfoW};

use crate::rt::AppHandle;

const PATH_CHARS: usize = 1024;

pub const FORMATS: &[&str] = &["jpg", "jpeg", "jfif", "png", "gif", "webp", "bmp", "avif"];

pub async fn current(_app: &AppHandle) -> Option<PathBuf> {
    let mut wide = [0u16; PATH_CHARS];
    let read = unsafe {
        SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            PATH_CHARS as u32,
            wide.as_mut_ptr().cast(),
            0,
        )
    };
    let len = wide
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(PATH_CHARS);
    if read == 0 || len == 0 {
        return None;
    }
    let path = PathBuf::from(OsString::from_wide(&wide[..len]));
    if path.is_file() {
        return Some(path);
    }
    Some(dirs::config_dir()?.join(r"Microsoft\Windows\Themes\TranscodedWallpaper"))
}
