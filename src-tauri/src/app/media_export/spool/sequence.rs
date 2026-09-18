// Matches exactly the names this feature ever writes: frame_NNNNNN.png / frame_NNNNNN.jpg.
pub(crate) fn matches_sequence_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("frame_") else {
        return false;
    };
    let Some((digits, ext)) = rest.split_once('.') else {
        return false;
    };
    digits.len() == 6
        && digits.bytes().all(|b| b.is_ascii_digit())
        && (ext == "png" || ext == "jpg")
}
