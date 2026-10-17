use std::path::PathBuf;

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

pub fn xfce_image_property(properties: &str) -> Option<&str> {
    properties
        .lines()
        .map(str::trim)
        .find(|property| property.ends_with("/last-image"))
}

pub fn plasma_image(config: &str) -> Option<&str> {
    let mut section = "";
    let mut primary = Vec::new();
    let mut images = Vec::new();
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            section = line;
        } else if let Some(rest) = section.strip_prefix("[Containments][") {
            let id = rest.split(']').next().unwrap_or_default();
            if line == "lastScreen=0" {
                primary.push(id);
            } else if let Some(image) = line.strip_prefix("Image=")
                && section.ends_with("[Wallpaper][org.kde.image][General]")
            {
                images.push((id, image));
            }
        }
    }
    images
        .iter()
        .find(|(id, _)| primary.contains(id))
        .or(images.first())
        .map(|(_, image)| *image)
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
