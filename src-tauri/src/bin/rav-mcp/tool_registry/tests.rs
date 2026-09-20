use std::collections::HashSet;

use super::tools_list;

const NEW_TOOL_NAMES: [&str; 8] = [
    "rav_get_global_vm_tree",
    "rav_global_vm_get",
    "rav_global_vm_set",
    "rav_global_vm_fire",
    "rav_global_vm_set_image",
    "rav_global_vm_clear_image",
    "rav_capture_canvas",
    "rav_entitlement_status",
];

#[test]
fn advertises_56_unique_tools_including_globals_canvas_capture_and_entitlement_status() {
    let tools = tools_list();
    let tools = tools.as_array().expect("tools_list must return an array");
    let names = tools
        .iter()
        .map(|tool| {
            tool.get("name")
                .and_then(|name| name.as_str())
                .expect("every tool must have a string name")
        })
        .collect::<Vec<_>>();
    let unique_names = names.iter().copied().collect::<HashSet<_>>();

    assert_eq!(names.len(), 56);
    assert_eq!(unique_names.len(), 56);
    assert!(!unique_names.contains("rav_get_sm_inputs"));
    assert!(!unique_names.contains("rav_set_sm_input"));
    assert!(!unique_names.contains("rav_inspect_full"));
    for expected in NEW_TOOL_NAMES {
        assert!(unique_names.contains(expected), "missing tool {expected}");
    }
}
