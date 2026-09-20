use serde_json::Value;

const ENTITLEMENT_TOOLS_JSON: &str =
    include_str!("../../../../mcp-server/tools/entitlement-tools.json");

const SCOPE_KEY: &str = "x-rav-scope";

fn all_entitlement_tools() -> Vec<Value> {
    serde_json::from_str(ENTITLEMENT_TOOLS_JSON).expect("valid entitlement tool schema")
}

/// The always-advertised entitlement status tool (no gating, no scope key).
pub fn status_tool() -> Value {
    all_entitlement_tools()
        .into_iter()
        .find(|tool| tool.get("name").and_then(Value::as_str) == Some("rav_entitlement_status"))
        .expect("rav_entitlement_status tool definition must exist in entitlement-tools.json")
}

/// Tools gated behind an entitlement scope, advertised only once that scope
/// is present in `granted_scopes`. The internal `x-rav-scope` marker is
/// stripped before the tool definition is handed back for advertising.
pub fn gated_tools(granted_scopes: &[String]) -> Vec<Value> {
    all_entitlement_tools()
        .into_iter()
        .filter_map(|mut tool| {
            let scope = tool.get(SCOPE_KEY).and_then(Value::as_str)?.to_owned();
            if !granted_scopes.iter().any(|granted| granted == &scope) {
                return None;
            }
            if let Some(object) = tool.as_object_mut() {
                object.remove(SCOPE_KEY);
            }
            Some(tool)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_tool_has_no_scope_marker() {
        let tool = status_tool();
        assert_eq!(tool["name"], "rav_entitlement_status");
        assert!(tool.get(SCOPE_KEY).is_none());
    }

    #[test]
    fn gated_tools_empty_without_scope() {
        assert!(gated_tools(&[]).is_empty());
    }

    #[test]
    fn gated_tools_contains_inspect_full_and_analyze_full_when_scope_granted() {
        let granted = vec!["inspection.full".to_string()];
        let tools = gated_tools(&granted);
        let names: Vec<&str> = tools
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert_eq!(tools.len(), 2);
        assert!(names.contains(&"rav_inspect_full"));
        assert!(names.contains(&"rav_analyze_full"));
        assert!(tools.iter().all(|tool| tool.get(SCOPE_KEY).is_none()));
    }

    #[test]
    fn gated_tools_ignores_unrelated_scopes() {
        let granted = vec!["something.else".to_string()];
        assert!(gated_tools(&granted).is_empty());
    }
}
