const MAX_IMAGE_DIMENSION: u32 = 16_384;
const MAX_IMAGE_PIXELS: u64 = 64 * 1024 * 1024;

fn read_u16_be(bytes: &[u8], offset: usize) -> Option<u16> {
    let pair = bytes.get(offset..offset + 2)?;
    Some(u16::from_be_bytes([pair[0], pair[1]]))
}

fn read_u32_be(bytes: &[u8], offset: usize) -> Option<u32> {
    let value = bytes.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([value[0], value[1], value[2], value[3]]))
}

fn jpeg_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let mut offset = 2_usize;
    while offset + 3 < bytes.len() {
        if bytes[offset] != 0xff {
            offset += 1;
            continue;
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        let Some(&marker) = bytes.get(offset) else {
            break;
        };
        offset += 1;
        if marker == 0x01 || marker == 0xd8 || marker == 0xd9 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        let Some(segment_length) = read_u16_be(bytes, offset).map(usize::from) else {
            break;
        };
        if segment_length < 2 || offset + segment_length > bytes.len() {
            break;
        }
        let is_start_of_frame = (0xc0..=0xc3).contains(&marker)
            || (0xc5..=0xc7).contains(&marker)
            || (0xc9..=0xcb).contains(&marker)
            || (0xcd..=0xcf).contains(&marker);
        if is_start_of_frame && segment_length >= 7 {
            let height = read_u16_be(bytes, offset + 3).unwrap_or_default() as u32;
            let width = read_u16_be(bytes, offset + 5).unwrap_or_default() as u32;
            return Ok((width, height));
        }
        offset += segment_length;
    }
    Err("The JPEG image header is malformed.".to_string())
}

pub(super) fn validate_picked_image_dimensions(bytes: &[u8]) -> Result<(), String> {
    let dimensions = if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        if bytes.len() < 24 || bytes.get(12..16) != Some(b"IHDR") {
            return Err("The PNG image header is malformed.".to_string());
        }
        Some((
            read_u32_be(bytes, 16).unwrap_or_default(),
            read_u32_be(bytes, 20).unwrap_or_default(),
            "PNG",
        ))
    } else if bytes.starts_with(&[0xff, 0xd8]) {
        let (width, height) = jpeg_dimensions(bytes)?;
        Some((width, height, "JPEG"))
    } else {
        None
    };
    let Some((width, height, format)) = dimensions else {
        return Ok(());
    };
    if width == 0 || height == 0 {
        return Err(format!("The {format} image has invalid dimensions."));
    }
    if width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS
    {
        return Err(format!(
            "The {format} image dimensions {width}×{height} exceed the safe substitution limit."
        ));
    }
    Ok(())
}
