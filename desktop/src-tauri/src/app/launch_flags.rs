use std::ffi::OsString;

const NO_CUSTOM_CSS: &str = "--no-custom-css";

fn has_flag(args: impl IntoIterator<Item = OsString>, flag: &str) -> bool {
    args.into_iter().any(|arg| arg == flag)
}

pub fn has_no_custom_css(args: &[String]) -> bool {
    args.iter().any(|arg| arg == NO_CUSTOM_CSS)
}

#[tauri::command]
pub fn custom_css_suppressed() -> bool {
    has_flag(std::env::args_os(), NO_CUSTOM_CSS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn detects_the_flag_anywhere_in_args() {
        assert!(has_flag(
            args(&["app", "--minimized", NO_CUSTOM_CSS]),
            NO_CUSTOM_CSS
        ));
    }

    #[test]
    fn ignores_similar_args() {
        assert!(!has_flag(
            args(&["app", "--no-custom-css=1", "no-custom-css"]),
            NO_CUSTOM_CSS
        ));
    }

    #[test]
    fn second_instance_args_carry_the_flag() {
        let with = ["app".to_string(), NO_CUSTOM_CSS.to_string()];
        let without = ["app".to_string(), "--no-custom-css=1".to_string()];
        assert!(has_no_custom_css(&with));
        assert!(!has_no_custom_css(&without));
        assert!(!has_no_custom_css(&[]));
    }
}
