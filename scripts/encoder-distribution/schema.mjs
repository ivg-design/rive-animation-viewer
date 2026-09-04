import path from 'node:path';

export const SHA256 = /^[0-9a-f]{64}$/i;
export const MAX_BINARY = 512 * 1024 * 1024;
export const MAX_DOCUMENT = 16 * 1024 * 1024;
export const MAX_MANIFEST = 256 * 1024;
export const PACKAGE_MANAGER_ROOTS = [
    '/opt/homebrew',
    '/usr/local/Cellar',
    '/usr/local/Homebrew',
    '/home/linuxbrew',
    '/opt/local',
];

export class DistributionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DistributionError';
    }
}

export const fail = (message) => {
    throw new DistributionError(message);
};

const object = (value, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail(`${label} must be an object`);
    }
};

export const exactKeys = (value, allowed, label) => {
    object(value, label);
    const extras = Object.keys(value).filter((key) => !allowed.includes(key));
    if (extras.length) fail(`${label} contains unknown fields: ${extras.join(', ')}`);
    for (const key of allowed) {
        if (!(key in value)) fail(`${label}.${key} is required`);
    }
};

const meaningful = (value) => {
    if (typeof value !== 'string' || value.trim().length < 3) return false;
    return !/(replace|example|todo)/i.test(value);
};

const httpsUrl = (value) => typeof value === 'string'
    && value.startsWith('https://')
    && !/\s/.test(value);

export const validRelative = (value, plain = false) => {
    if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)) return false;
    const portable = value.replaceAll('\\', '/');
    const normalized = path.posix.normalize(portable);
    if (normalized !== portable || normalized === '.' || normalized.startsWith('../')) return false;
    const parts = normalized.split('/');
    return parts.every((part) => part && part !== '.' && part !== '..') && (!plain || parts.length === 1);
};

export const canonicalJson = (value) => {
    const canonical = (item) => {
        if (Array.isArray(item)) return item.map(canonical);
        if (item && typeof item === 'object') {
            return Object.fromEntries(
                Object.keys(item).sort().map((key) => [key, canonical(item[key])]),
            );
        }
        return item;
    };
    return `${JSON.stringify(canonical(value), null, 2)}\n`;
};

export const hostTarget = () => {
    const os = { darwin: 'macos', win32: 'windows' }[process.platform] || process.platform;
    const arch = { arm64: 'aarch64', x64: 'x86_64' }[process.arch] || process.arch;
    return `${os}-${arch}`;
};

const validateIntegrityFile = (entry, label, { plain = false } = {}) => {
    exactKeys(entry, ['source_file', 'file', 'sha256', 'size_bytes'], label);
    if (!validRelative(entry.source_file) || !validRelative(entry.file, plain)) {
        fail(`${label} contains an unsafe path`);
    }
    if (!SHA256.test(entry.sha256) || !Number.isSafeInteger(entry.size_bytes) || entry.size_bytes <= 0) {
        fail(`${label} requires a positive size and SHA-256`);
    }
};

const validateApproval = (distribution, expectedTarget) => {
    exactKeys(
        distribution,
        ['id', 'target', 'provenance_summary', 'approval'],
        'inventory.distribution',
    );
    exactKeys(
        distribution.approval,
        ['redistribution_approved', 'approved_by', 'approved_at', 'review_reference', 'signing_required'],
        'inventory.distribution.approval',
    );
    const approval = distribution.approval;
    if (distribution.target !== expectedTarget) {
        fail(`Inventory target ${distribution.target} does not match build host ${expectedTarget}`);
    }
    if (!meaningful(distribution.id) || !meaningful(distribution.provenance_summary)) {
        fail('Distribution identity and provenance summary must be complete and non-placeholder');
    }
    if (approval.redistribution_approved !== true || approval.signing_required !== true) {
        fail('Redistribution approval and nested-code signing must both be explicit');
    }
    if (!meaningful(approval.approved_by)
        || !meaningful(approval.review_reference)
        || !/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(approval.approved_at)) {
        fail('Distribution approval metadata is incomplete');
    }
};

const validateBinary = (binary, index, ids, destinations) => {
    const label = `inventory.binaries[${index}]`;
    exactKeys(
        binary,
        ['id', 'source_file', 'file', 'sha256', 'size_bytes', 'version', 'source', 'provenance_file', 'license'],
        label,
    );
    if (!['ffmpeg', 'ffprobe'].includes(binary.id) || ids.has(binary.id)) {
        fail(`${label}.id must be a unique supported encoder id`);
    }
    ids.add(binary.id);
    if (!validRelative(binary.source_file) || !validRelative(binary.file, true)) {
        fail(`${label} contains an unsafe executable path`);
    }
    if (destinations.has(binary.file)) fail(`Duplicate staged destination: ${binary.file}`);
    destinations.add(binary.file);
    if (!SHA256.test(binary.sha256)
        || !Number.isSafeInteger(binary.size_bytes)
        || binary.size_bytes <= 0
        || binary.size_bytes > MAX_BINARY
        || !meaningful(binary.version)) {
        fail(`${label} requires a version, bounded size, and SHA-256`);
    }
    exactKeys(
        binary.source,
        ['kind', 'artifact_url', 'artifact_sha256', 'source_code_url', 'source_code_sha256'],
        `${label}.source`,
    );
    if (!['upstream_release', 'vendor_supplied', 'self_built_from_upstream'].includes(binary.source.kind)
        || !httpsUrl(binary.source.artifact_url)
        || !httpsUrl(binary.source.source_code_url)
        || !SHA256.test(binary.source.artifact_sha256)
        || !SHA256.test(binary.source.source_code_sha256)) {
        fail(`${label}.source lacks explicit upstream artifact/source provenance`);
    }
    validateIntegrityFile(binary.provenance_file, `${label}.provenance_file`);
    if (!binary.provenance_file.file.startsWith('provenance/')) {
        fail(`${label}.provenance_file must be staged under provenance/`);
    }
    exactKeys(
        binary.license,
        ['spdx', 'notice_files', 'redistribution_basis', 'review_reference'],
        `${label}.license`,
    );
    if (!meaningful(binary.license.spdx)
        || !meaningful(binary.license.redistribution_basis)
        || !meaningful(binary.license.review_reference)
        || !Array.isArray(binary.license.notice_files)
        || binary.license.notice_files.length === 0) {
        fail(`${label}.license requires SPDX, notices, basis, and a review reference`);
    }
    for (const [noticeIndex, notice] of binary.license.notice_files.entries()) {
        validateIntegrityFile(notice, `${label}.license.notice_files[${noticeIndex}]`);
        if (!notice.file.startsWith('licenses/')) fail(`${label} license notices must be under licenses/`);
    }
};

export const validateInventory = (inventory, { expectedTarget = hostTarget() } = {}) => {
    exactKeys(inventory, ['schema_version', 'distribution', 'binaries'], 'inventory');
    if (inventory.schema_version !== 1) fail('inventory.schema_version must be 1');
    validateApproval(inventory.distribution, expectedTarget);
    if (!Array.isArray(inventory.binaries) || inventory.binaries.length !== 2) {
        fail('Production inventory requires exactly ffmpeg and ffprobe');
    }
    const ids = new Set();
    const destinations = new Set();
    inventory.binaries.forEach((binary, index) => validateBinary(binary, index, ids, destinations));
    if (!ids.has('ffmpeg') || !ids.has('ffprobe')) {
        fail('Inventory requires exactly one ffmpeg and one ffprobe');
    }
    return inventory;
};
