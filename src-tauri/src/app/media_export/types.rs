use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_PIXELS: u64 = 4_194_304;
pub const MAX_PNG: u64 = 20 * 1024 * 1024;
pub const MAX_RSS: u64 = 768 * 1024 * 1024;
pub const DISK_RESERVE: u64 = 128 * 1024 * 1024;
pub type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Debug)]
pub struct Binaries {
    pub ffmpeg: std::path::PathBuf,
    pub ffprobe: std::path::PathBuf,
    pub gifski: Option<std::path::PathBuf>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    H264,
    H265,
    Webm,
    Apng,
    Gif,
    Png,
    Jpg,
    Webp,
}
impl Format {
    pub fn extension(self) -> &'static str {
        match self {
            Self::H264 | Self::H265 => "mp4",
            Self::Webm => "webm",
            Self::Apng => "apng",
            Self::Gif => "gif",
            Self::Png => "png",
            Self::Jpg => "jpg",
            Self::Webp => "webp",
        }
    }
    pub fn codec(self) -> &'static str {
        match self {
            Self::H264 => "libx264",
            Self::H265 => "libx265",
            Self::Webm => "libvpx-vp9",
            Self::Apng => "apng",
            Self::Gif => "gif",
            Self::Png => "png",
            Self::Jpg => "mjpeg",
            Self::Webp => "libwebp",
        }
    }
    pub fn animated(self) -> bool {
        !matches!(self, Self::Png | Self::Jpg | Self::Webp)
    }
    pub fn alpha(self) -> bool {
        !matches!(self, Self::H264 | Self::H265 | Self::Jpg)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChoosePathRequest {
    pub format: Format,
    pub suggested_name: Option<String>,
}

pub fn suggested_output_file_name(format: Format, suggested_name: Option<&str>) -> String {
    let raw = suggested_name.unwrap_or("animation").trim();
    let component = raw.rsplit(['/', '\\']).next().unwrap_or_default();
    let suffix = format!(".{}", format.extension());
    let stem = component
        .to_ascii_lowercase()
        .strip_suffix(&suffix)
        .map(|_| &component[..component.len() - suffix.len()])
        .unwrap_or(component);
    let mut safe = stem
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '-'
            } else {
                character
            }
        })
        .collect::<String>();
    safe = safe
        .trim_matches(|character: char| character == '.' || character == ' ' || character == '-')
        .to_string();
    if safe.is_empty() {
        safe = "animation".into();
    }
    format!("{safe}.{}", format.extension())
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Rate {
    pub numerator: u32,
    pub denominator: u32,
}
impl Rate {
    pub fn value(self) -> f64 {
        self.numerator as f64 / self.denominator as f64
    }
    pub fn text(self) -> String {
        format!("{}/{}", self.numerator, self.denominator)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GifOptions {
    #[serde(default = "auto")]
    pub encoder: String,
    pub quality: Option<u8>,
    pub motion_quality: Option<u8>,
    pub lossy_quality: Option<u8>,
    #[serde(default)]
    pub repeat: i16,
    pub max_bytes: Option<u64>,
    pub size_policy: Option<String>,
}
fn auto() -> String {
    "auto".into()
}
impl Default for GifOptions {
    fn default() -> Self {
        Self {
            encoder: auto(),
            quality: None,
            motion_quality: None,
            lossy_quality: None,
            repeat: 0,
            max_bytes: None,
            size_policy: None,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BeginRequest {
    pub format: Format,
    pub capture_codec: Option<String>,
    pub width: u32,
    pub height: u32,
    pub fps: Rate,
    pub output_path: Option<String>,
    #[serde(default)]
    pub overwrite: bool,
    #[serde(default)]
    pub alpha: bool,
    #[serde(default = "background")]
    pub background: String,
    #[serde(default = "quality")]
    pub quality: u8,
    pub gif: Option<GifOptions>,
    pub source_identity: Option<Value>,
    pub source_session: Option<Value>,
    // Legacy caller field, ignored: there is no product frame-count limit.
    pub max_frames: Option<u32>,
}
fn background() -> String {
    "#000000".into()
}
fn quality() -> u8 {
    80
}
impl BeginRequest {
    pub fn validate(&self) -> Result<()> {
        let pixels = self.width as u64 * self.height as u64;
        if pixels == 0 || pixels > MAX_PIXELS || self.width > 4096 || self.height > 4096 {
            return Err("Dimensions exceed 4096 per edge / 4194304 pixels".into());
        }
        if self.fps.numerator == 0
            || self.fps.denominator == 0
            || self.fps.numerator > 1_000_000
            || self.fps.denominator > 1_000_000
            || !(1.0..=60.0).contains(&self.fps.value())
        {
            return Err("FPS must be a bounded rational between 1 and 60".into());
        }
        if self.format == Format::Gif && self.fps.value() > 50.0 {
            return Err("GIF supports 1–50 FPS for browser timing compatibility".into());
        }
        if self.alpha && !self.format.alpha() {
            return Err("Format does not support alpha".into());
        }
        if matches!(self.format, Format::H264 | Format::H265 | Format::Webm)
            && (self.width & 1 != 0 || self.height & 1 != 0)
        {
            return Err("Video dimensions must be even (no implicit resize)".into());
        }
        if self.background.len() != 7
            || !self.background.starts_with('#')
            || !self.background[1..].bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err("Background must be #RRGGBB".into());
        }
        if !(1..=100).contains(&self.quality) {
            return Err("Quality must be 1–100".into());
        }
        if let Some(codec) = self.capture_codec.as_deref() {
            let matches = matches!(
                (codec, self.format),
                ("h264", Format::H264) | ("hevc", Format::H265) | ("vp9", Format::Webm)
            );
            if !matches || self.alpha {
                return Err("capture_codec must match the opaque output format".into());
            }
            if self
                .source_session
                .as_ref()
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
            {
                return Err("Encoded capture requires a source_session string".into());
            }
        }
        for value in [&self.source_identity, &self.source_session]
            .into_iter()
            .flatten()
        {
            if value.to_string().len() > 4096 {
                return Err("Source receipt exceeds 4096 bytes".into());
            }
        }
        if let Some(g) = &self.gif {
            if self.format != Format::Gif {
                return Err("GIF options require GIF format".into());
            }
            if !["auto", "gifski", "ffmpeg"].contains(&g.encoder.as_str()) || g.repeat < -1 {
                return Err("Invalid GIF encoder or repeat".into());
            }
            if [g.quality, g.motion_quality, g.lossy_quality]
                .into_iter()
                .flatten()
                .any(|q| !(1..=100).contains(&q))
            {
                return Err("GIF quality must be 1–100".into());
            }
            if g.max_bytes == Some(0) {
                return Err("GIF target must be a positive byte count".into());
            }
            if g.size_policy
                .as_deref()
                .is_some_and(|p| !["quality_only", "quality_fps_scale"].contains(&p))
            {
                return Err("Unknown GIF size_policy".into());
            }
            if g.size_policy.is_some() && g.max_bytes.is_none() {
                return Err("size_policy requires max_bytes".into());
            }
        }
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrameRequest {
    pub job_id: String,
    pub frame_index: u32,
    pub png_base64: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FinishRequest {
    pub job_id: String,
    pub frame_count: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JobRequest {
    pub job_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AbortRequest {
    pub job_id: String,
    pub error: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Job {
    pub job_id: String,
    pub state: String,
    #[serde(default)]
    pub stage: String,
    pub received_frames: u32,
    pub frame_count: Option<u32>,
    pub bytes_spooled: u64,
    pub output_path: Option<String>,
    pub actual_bytes: Option<u64>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
    pub progress: f64,
    pub resolved_settings: Value,
}
pub fn io(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Clone, Debug, Serialize)]
pub struct CaptureReceipt {
    pub job_id: String,
    pub index: u32,
    pub frame_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    pub received_frames: u32,
    pub bytes_spooled: u64,
}
