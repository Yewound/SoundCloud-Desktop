pub const DISCORD_CLIENT_ID: &str = "1431978756687265872";

const LOCAL_HOSTS: [&str; 3] = ["localhost", "127.0.0.1", "tauri.localhost"];
const OUR_ZONES: [&str; 2] = ["scnative.dev", "scnative.space"];
const OUR_HOSTS: [&str; 8] = [
    "api",
    "images",
    "storage",
    "stream",
    "api-star",
    "stream-star",
    "storage-star",
    "pay",
];

pub fn is_domain_whitelisted(host: &str) -> bool {
    if LOCAL_HOSTS.contains(&host) {
        return true;
    }
    OUR_ZONES.iter().any(|zone| {
        host.strip_suffix(zone)
            .and_then(|rest| rest.strip_suffix('.'))
            .is_some_and(|label| OUR_HOSTS.contains(&label))
    })
}

pub const LASTFM_API_KEY: Option<&str> = option_env!("LASTFM_API_KEY");
pub const LASTFM_API_SECRET: Option<&str> = option_env!("LASTFM_API_SECRET");

#[cfg(test)]
mod tests {
    use super::is_domain_whitelisted;

    #[test]
    fn our_hosts_are_whitelisted_in_both_zones() {
        for host in [
            "localhost",
            "api.scnative.dev",
            "storage-star.scnative.dev",
            "storage.scnative.space",
            "images.scnative.space",
        ] {
            assert!(is_domain_whitelisted(host), "{host}");
        }
        for host in [
            "s3.scnative.dev",
            "scnative.dev",
            "evil-api.scnative.dev",
            "api.scnative.dev.example",
            "api.r1.relay.scnative.dev",
            "i1.sndcdn.com",
        ] {
            assert!(!is_domain_whitelisted(host), "{host}");
        }
    }
}
