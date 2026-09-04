use super::validation::{
    is_https, is_meaningful, is_sha256, runtime_target, verified_resource, Integrity,
    MANIFEST_LIMIT, RESOURCE_LIMIT,
};
use crate::app::media_export::{
    DistributionComponent, DistributionMetadata, EncoderConfig, TrustedBinary,
};
use serde::Deserialize;
use std::{collections::BTreeMap, fs, path::Path};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IntegrityFile {
    file: String,
    sha256: String,
    size_bytes: u64,
}

impl IntegrityFile {
    fn borrowed(&self) -> Integrity<'_> {
        Integrity {
            file: &self.file,
            sha256: &self.sha256,
            size_bytes: self.size_bytes,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Approval {
    redistribution_approved: bool,
    approved_by: String,
    approved_at: String,
    review_reference: String,
    signing_required: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DistributionEntry {
    id: String,
    target: String,
    provenance_summary: String,
    inventory_file: String,
    inventory_sha256: String,
    inventory_size_bytes: u64,
    approval: Approval,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceEntry {
    kind: String,
    artifact_url: String,
    artifact_sha256: String,
    source_code_url: String,
    source_code_sha256: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LicenseEntry {
    spdx: String,
    notice_files: Vec<IntegrityFile>,
    redistribution_basis: String,
    review_reference: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BinaryEntry {
    id: String,
    file: String,
    sha256: String,
    size_bytes: u64,
    version: String,
    source: SourceEntry,
    provenance_file: IntegrityFile,
    license: LicenseEntry,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    distribution: DistributionEntry,
    binaries: Vec<BinaryEntry>,
}

fn validate_approval(distribution: &DistributionEntry) -> Result<(), String> {
    let approval = &distribution.approval;
    if !approval.redistribution_approved || !approval.signing_required {
        return Err(
            "Encoder redistribution and nested-code signing must be explicitly approved".into(),
        );
    }
    if !is_meaningful(&distribution.id)
        || !is_meaningful(&distribution.provenance_summary)
        || !is_meaningful(&approval.approved_by)
        || !is_meaningful(&approval.review_reference)
        || approval.approved_at.len() < 10
    {
        return Err("Encoder distribution approval metadata is incomplete".into());
    }
    if distribution.target != runtime_target() {
        return Err(format!(
            "Encoder target {} does not match runtime {}",
            distribution.target,
            runtime_target()
        ));
    }
    Ok(())
}

fn validate_component(root: &Path, entry: &BinaryEntry) -> Result<DistributionComponent, String> {
    if !matches!(entry.id.as_str(), "ffmpeg" | "ffprobe" | "gifski")
        || !is_meaningful(&entry.version)
        || !matches!(
            entry.source.kind.as_str(),
            "upstream_release" | "vendor_supplied" | "self_built_from_upstream"
        )
        || !is_https(&entry.source.artifact_url)
        || !is_https(&entry.source.source_code_url)
        || !is_sha256(&entry.source.artifact_sha256)
        || !is_sha256(&entry.source.source_code_sha256)
        || !is_meaningful(&entry.license.spdx)
        || !is_meaningful(&entry.license.redistribution_basis)
        || !is_meaningful(&entry.license.review_reference)
        || entry.license.notice_files.is_empty()
    {
        return Err(format!(
            "Incomplete provenance/license inventory for {}",
            entry.id
        ));
    }
    verified_resource(
        root,
        entry.provenance_file.borrowed(),
        false,
        16 * 1024 * 1024,
    )?;
    let mut notices = Vec::new();
    for notice in &entry.license.notice_files {
        verified_resource(root, notice.borrowed(), false, 16 * 1024 * 1024)?;
        notices.push(notice.file.clone());
    }
    Ok(DistributionComponent {
        id: entry.id.clone(),
        version: entry.version.clone(),
        source_kind: entry.source.kind.clone(),
        artifact_url: entry.source.artifact_url.clone(),
        artifact_sha256: entry.source.artifact_sha256.to_ascii_lowercase(),
        source_code_url: entry.source.source_code_url.clone(),
        source_code_sha256: entry.source.source_code_sha256.to_ascii_lowercase(),
        provenance_file: entry.provenance_file.file.clone(),
        provenance_sha256: entry.provenance_file.sha256.to_ascii_lowercase(),
        license_spdx: entry.license.spdx.clone(),
        notice_files: notices,
        redistribution_basis: entry.license.redistribution_basis.clone(),
        review_reference: entry.license.review_reference.clone(),
    })
}

fn trusted_binary(root: &Path, entry: BinaryEntry) -> Result<TrustedBinary, String> {
    let path = verified_resource(
        root,
        Integrity {
            file: &entry.file,
            sha256: &entry.sha256,
            size_bytes: entry.size_bytes,
        },
        true,
        RESOURCE_LIMIT,
    )?;
    Ok(TrustedBinary {
        path,
        sha256: entry.sha256.to_ascii_lowercase(),
        size_bytes: entry.size_bytes,
    })
}

pub(super) fn load(root: &Path) -> Result<EncoderConfig, String> {
    let manifest_path = root.join("manifest.json");
    let metadata = fs::symlink_metadata(&manifest_path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MANIFEST_LIMIT {
        return Err("Encoder manifest must be a bounded regular file".into());
    }
    let manifest: Manifest =
        serde_json::from_slice(&fs::read(&manifest_path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    if manifest.schema_version != 1 {
        return Err("Unsupported encoder manifest schema".into());
    }
    validate_approval(&manifest.distribution)?;
    if manifest.distribution.inventory_file != "inventory.json" {
        return Err("Encoder inventory must be inventory.json".into());
    }
    verified_resource(
        root,
        Integrity {
            file: &manifest.distribution.inventory_file,
            sha256: &manifest.distribution.inventory_sha256,
            size_bytes: manifest.distribution.inventory_size_bytes,
        },
        true,
        MANIFEST_LIMIT,
    )?;

    let mut binaries = BTreeMap::new();
    let mut components = Vec::new();
    for entry in manifest.binaries {
        if binaries.contains_key(&entry.id) {
            return Err(format!("Duplicate encoder component: {}", entry.id));
        }
        components.push(validate_component(root, &entry)?);
        binaries.insert(entry.id.clone(), entry);
    }
    if binaries.len() < 2
        || binaries.len() > 3
        || !binaries.contains_key("ffmpeg")
        || !binaries.contains_key("ffprobe")
    {
        return Err(
            "Encoder manifest requires exactly one ffmpeg and ffprobe, plus optional gifski".into(),
        );
    }
    let ffmpeg = trusted_binary(root, binaries.remove("ffmpeg").expect("checked above"))?;
    let ffprobe = trusted_binary(root, binaries.remove("ffprobe").expect("checked above"))?;
    let gifski = binaries
        .remove("gifski")
        .map(|entry| trusted_binary(root, entry))
        .transpose()?;
    let distribution = DistributionMetadata {
        id: manifest.distribution.id,
        target: manifest.distribution.target,
        approved_by: manifest.distribution.approval.approved_by,
        approved_at: manifest.distribution.approval.approved_at,
        review_reference: manifest.distribution.approval.review_reference,
        inventory_sha256: manifest.distribution.inventory_sha256.to_ascii_lowercase(),
        components,
    };
    Ok(EncoderConfig {
        ffmpeg,
        ffprobe,
        gifski,
        provenance: manifest.distribution.provenance_summary,
        distribution: Some(distribution),
    })
}
