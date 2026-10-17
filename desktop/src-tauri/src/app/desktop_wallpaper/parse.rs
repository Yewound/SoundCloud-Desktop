use std::collections::BTreeMap;
use std::path::PathBuf;

const PLASMA_IMAGE_PLUGIN: &str = "org.kde.image";
const PLASMA_DEFAULT_IMAGE: &str = "/usr/share/wallpapers/Next";

#[derive(Default)]
struct PlasmaContainment<'a> {
    activity: &'a str,
    primary: bool,
    plugin: Option<&'a str>,
    image: Option<&'a str>,
}

pub fn uri_path(value: &str) -> Option<PathBuf> {
    let value = value.trim();
    if value.starts_with("file://") {
        url::Url::parse(value).ok()?.to_file_path().ok()
    } else if value.starts_with('/') {
        Some(PathBuf::from(value))
    } else {
        None
    }
}

pub fn gvariant_string(value: &str) -> Option<&str> {
    let value = value.trim();
    value
        .strip_prefix('\'')
        .and_then(|rest| rest.strip_suffix('\''))
        .or_else(|| {
            value
                .strip_prefix('"')
                .and_then(|rest| rest.strip_suffix('"'))
        })
}

pub fn swww_image(query: &str) -> Option<&str> {
    query
        .lines()
        .find_map(|line| line.split_once("image: "))
        .map(|(_, path)| path.trim())
}

pub fn hyprpaper_image(active: &str) -> Option<&str> {
    active
        .lines()
        .find_map(|line| line.split_once(" = "))
        .map(|(_, path)| path.trim())
}

pub fn fehbg_image(script: &str) -> Option<&str> {
    script
        .lines()
        .filter(|line| line.trim_start().starts_with("feh "))
        .find_map(|line| line.split('\'').nth(1))
}

pub fn xfce_image_property<'a>(properties: &'a str, monitors: &str) -> Option<&'a str> {
    let active: Vec<&str> = monitors
        .lines()
        .skip(1)
        .filter_map(|line| line.split_whitespace().last())
        .collect();
    properties
        .lines()
        .map(str::trim)
        .filter(|property| property.ends_with("/last-image"))
        .min_by_key(|property| {
            let monitor = property
                .split('/')
                .find_map(|part| part.strip_prefix("monitor"))
                .unwrap_or_default();
            (
                active
                    .iter()
                    .position(|name| *name == monitor)
                    .unwrap_or(usize::MAX),
                monitor.bytes().all(|byte| byte.is_ascii_digit()),
                !property.ends_with("/workspace0/last-image"),
            )
        })
}

pub fn plasma_activity(config: &str) -> Option<&str> {
    config
        .lines()
        .find_map(|line| line.trim().strip_prefix("currentActivity="))
}

pub fn plasma_image<'a>(config: &'a str, activity: Option<&str>) -> Option<&'a str> {
    let mut containments: BTreeMap<&str, PlasmaContainment> = BTreeMap::new();
    let mut section = None;
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            section = line
                .strip_prefix("[Containments][")
                .and_then(|rest| rest.split_once(']'));
        } else if let Some((id, group)) = section
            && let Some((key, value)) = line.split_once('=')
        {
            let containment = containments.entry(id).or_default();
            match (group, key) {
                ("", "activityId") => containment.activity = value,
                ("", "lastScreen") => containment.primary = value == "0",
                ("", "wallpaperplugin") => containment.plugin = Some(value),
                ("[Wallpaper][org.kde.image][General]", "Image") => containment.image = Some(value),
                _ => {}
            }
        }
    }
    let desktop = containments
        .values()
        .filter(|containment| !containment.activity.is_empty())
        .min_by_key(|containment| {
            (
                activity.is_some_and(|current| containment.activity != current),
                !containment.primary,
            )
        })?;
    matches!(desktop.plugin, None | Some(PLASMA_IMAGE_PLUGIN))
        .then(|| desktop.image.unwrap_or(PLASMA_DEFAULT_IMAGE))
}

pub fn slideshow_first(xml: &str) -> Option<PathBuf> {
    xml.split('<')
        .filter_map(|tag| tag.split_once('>'))
        .map(|(_, text)| text.trim())
        .find(|text| text.starts_with('/'))
        .map(PathBuf::from)
}

pub fn largest_package_image(names: &[String]) -> Option<&str> {
    names.iter().map(String::as_str).max_by_key(|name| {
        let size = name.split('.').next().unwrap_or_default();
        let (width, height) = size.split_once('x').unwrap_or_default();
        width.parse::<u64>().unwrap_or(0) * height.parse::<u64>().unwrap_or(0)
    })
}
