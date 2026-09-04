use std::collections::HashSet;

use super::tools_list;

const NEW_TOOL_NAMES: [&str; 7] = [
    "rav_get_global_vm_tree",
    "rav_global_vm_get",
    "rav_global_vm_set",
    "rav_global_vm_fire",
    "rav_global_vm_set_image",
    "rav_global_vm_clear_image",
    "rav_capture_canvas",
];

#[test]
fn advertises_57_unique_tools_including_globals_and_canvas_capture() {
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

    assert_eq!(names.len(), 57);
    assert_eq!(unique_names.len(), 57);
    for expected in NEW_TOOL_NAMES {
        assert!(unique_names.contains(expected), "missing tool {expected}");
    }
}
