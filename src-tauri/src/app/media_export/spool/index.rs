//! A disk-backed capture journal keeps long PNG recordings independent of RAM size.
use super::super::process::Control;
use super::*;
use std::io::{BufReader, Read};

pub fn record(spool: &Spool, index: u32) -> Result<()> {
    OpenOptions::new()
        .append(true)
        .create(true)
        .open(spool.dir.join("frames.idx"))
        .and_then(|mut f| f.write_all(&index.to_le_bytes()))
        .map_err(io)
}
fn next(reader: &mut impl Read) -> Result<Option<u32>> {
    let mut bytes = [0; 4];
    if reader.read(&mut bytes[..1]).map_err(io)? == 0 {
        return Ok(None);
    }
    reader.read_exact(&mut bytes[1..]).map_err(io)?;
    Ok(Some(u32::from_le_bytes(bytes)))
}
pub fn capture_sequence(
    spool: &Spool,
    fixture_indices: &[u32],
    count: u32,
    output_count: u32,
    control: &Control,
) -> Result<PathBuf> {
    if count == 0 || output_count == 0 {
        return Err("Empty sequence".into());
    }
    let mut journal = if fixture_indices.is_empty() {
        Some(BufReader::new(
            File::open(spool.dir.join("frames.idx")).map_err(io)?,
        ))
    } else {
        None
    };
    let mut fixtures = fixture_indices.iter().copied();
    let mut read_next = || match journal.as_mut() {
        Some(reader) => next(reader),
        None => Ok(fixtures.next()),
    };
    let mut current = read_next()?.ok_or("Empty capture journal")?;
    if current != 0 {
        return Err("Capture journal must begin at zero".into());
    }
    let mut following = read_next()?;
    let dir = spool.dir.join("sequence");
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(io)?;
    }
    private_dir(&dir)?;
    for n in 0..output_count {
        control.check()?;
        if n % 256 == 0 {
            disk::ensure_finalization(&spool.dir, 0)?;
        }
        let source = (n as u64 * count as u64 / output_count as u64) as u32;
        while following.is_some_and(|index| index <= source) {
            let index = following.unwrap();
            if index <= current || index >= count {
                return Err("Invalid capture journal order".into());
            }
            current = index;
            following = read_next()?;
        }
        fs::hard_link(spool.frame_path(current), dir.join(format!("{n:06}.png"))).map_err(io)?;
    }
    Ok(dir)
}
