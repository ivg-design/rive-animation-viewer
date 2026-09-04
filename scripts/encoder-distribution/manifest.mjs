import { exactKeys, fail, SHA256 } from './schema.mjs';

const runtimeFile = ({ file, sha256, size_bytes }) => ({
    file,
    sha256: sha256.toLowerCase(),
    size_bytes,
});

export const runtimeEntry = (binary) => ({
    id: binary.id,
    file: binary.file,
    sha256: binary.sha256.toLowerCase(),
    size_bytes: binary.size_bytes,
    version: binary.version,
    source: {
        kind: binary.source.kind,
        artifact_url: binary.source.artifact_url,
        artifact_sha256: binary.source.artifact_sha256.toLowerCase(),
        source_code_url: binary.source.source_code_url,
        source_code_sha256: binary.source.source_code_sha256.toLowerCase(),
    },
    provenance_file: runtimeFile(binary.provenance_file),
    license: {
        spdx: binary.license.spdx,
        notice_files: binary.license.notice_files.map(runtimeFile),
        redistribution_basis: binary.license.redistribution_basis,
        review_reference: binary.license.review_reference,
    },
});

export const createRuntimeManifest = (inventory, inventorySha256, inventorySize) => ({
    schema_version: 1,
    distribution: {
        id: inventory.distribution.id,
        target: inventory.distribution.target,
        provenance_summary: inventory.distribution.provenance_summary,
        inventory_file: 'inventory.json',
        inventory_sha256: inventorySha256,
        inventory_size_bytes: inventorySize,
        approval: inventory.distribution.approval,
    },
    binaries: inventory.binaries.map(runtimeEntry),
});

export const validateRuntimeManifest = (manifest, expectedTarget) => {
    exactKeys(manifest, ['schema_version', 'distribution', 'binaries'], 'manifest');
    if (manifest.schema_version !== 1) fail('manifest.schema_version must be 1');
    exactKeys(
        manifest.distribution,
        [
            'id',
            'target',
            'provenance_summary',
            'inventory_file',
            'inventory_sha256',
            'inventory_size_bytes',
            'approval',
        ],
        'manifest.distribution',
    );
    if (manifest.distribution.target !== expectedTarget) fail('Staged manifest target mismatch');
    if (manifest.distribution.inventory_file !== 'inventory.json'
        || !SHA256.test(manifest.distribution.inventory_sha256)
        || !Number.isSafeInteger(manifest.distribution.inventory_size_bytes)) {
        fail('Staged manifest inventory integrity metadata is invalid');
    }
    exactKeys(
        manifest.distribution.approval,
        ['redistribution_approved', 'approved_by', 'approved_at', 'review_reference', 'signing_required'],
        'manifest.distribution.approval',
    );
    if (manifest.distribution.approval.redistribution_approved !== true
        || manifest.distribution.approval.signing_required !== true) {
        fail('Staged manifest is not approved for redistribution/signing');
    }
    if (!Array.isArray(manifest.binaries)) fail('manifest.binaries must be an array');
    return manifest;
};
