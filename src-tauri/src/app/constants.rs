pub const DEFAULT_MCP_PORT: u16 = 9274;
pub const ISOLATED_DEV_MCP_PORT: u16 = 9278;
pub const OFFICIAL_APP_IDENTIFIER: &str = "app.rive.animation.viewer";
pub const APP_UPDATE_TIMEOUT_SECS: u64 = 30;
pub const ONLINE_DOCS_MENU_ID: &str = "rav-online-docs";
pub const ABOUT_MENU_ID: &str = "rav-about";
pub const RAV_DOCS_URL: &str = "https://forge.mograph.life/apps/rav/docs";
pub const MCP_CLIENT_LAUNCHER_NAME: &str = "rav-mcp-rav";

pub fn is_official_app_identifier(identifier: &str) -> bool {
    identifier == OFFICIAL_APP_IDENTIFIER
}

#[cfg(test)]
mod tests {
    use super::{is_official_app_identifier, DEFAULT_MCP_PORT, ISOLATED_DEV_MCP_PORT};

    #[test]
    fn isolates_non_production_app_identifiers() {
        assert!(is_official_app_identifier("app.rive.animation.viewer"));
        assert!(!is_official_app_identifier(
            "app.rive.animation.viewer.flicker-test"
        ));
    }

    #[test]
    fn reserves_a_distinct_mcp_port_for_isolated_dev_instances() {
        assert_eq!(DEFAULT_MCP_PORT, 9274);
        assert_eq!(ISOLATED_DEV_MCP_PORT, 9278);
        assert_ne!(DEFAULT_MCP_PORT, ISOLATED_DEV_MCP_PORT);
    }
}
