import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileIntegrity } from '../integrity.mjs';
import { canonicalJson, hostTarget, MAX_BINARY, MAX_DOCUMENT } from '../schema.mjs';

const writeResource = async (root, relative, bytes, executable = false) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { mode: executable ? 0o755 : 0o644 });
    if (executable) await chmod(file, 0o755);
    return fileIntegrity(file, executable ? MAX_BINARY : MAX_DOCUMENT);
};

export const createFixture = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rav-encoder-package-test-'));
    const source = path.join(root, 'approved-source');
    await mkdir(source);
    const notice = await writeResource(source, 'legal/NOTICE.txt', 'Synthetic test notice\n');
    const provenance = await writeResource(
        source,
        'attestations/build.json',
        '{"builder":"RAV test fixture","synthetic":true}\n',
    );
    const executable = '#!/bin/sh\nprintf "%s\\n" "synthetic encoder"\n';
    const ffmpeg = await writeResource(source, 'bin/ffmpeg', executable, true);
    const ffprobe = await writeResource(source, 'bin/ffprobe', executable, true);
    const binary = (id, integrity) => ({
        id,
        source_file: `bin/${id}`,
        file: id,
        sha256: integrity.sha256,
        size_bytes: integrity.size_bytes,
        version: 'synthetic-1.0.0',
        source: {
            kind: 'self_built_from_upstream',
            artifact_url: `https://downloads.example.invalid/${id}.tar.xz`,
            artifact_sha256: 'a'.repeat(64),
            source_code_url: 'https://sources.example.invalid/ffmpeg.tar.xz',
            source_code_sha256: 'b'.repeat(64),
        },
        provenance_file: {
            source_file: 'attestations/build.json',
            file: 'provenance/build.json',
            ...provenance,
        },
        license: {
            spdx: 'MIT',
            notice_files: [{
                source_file: 'legal/NOTICE.txt',
                file: 'licenses/NOTICE.txt',
                ...notice,
            }],
            redistribution_basis: 'Synthetic fixture bytes are owned by the test suite',
            review_reference: 'TEST-ONLY-LICENSE-REVIEW',
        },
    });
    const inventory = {
        schema_version: 1,
        distribution: {
            id: 'rav-synthetic-encoder-fixture',
            target: hostTarget(),
            provenance_summary: 'Synthetic fixtures generated and owned by the RAV test suite',
            approval: {
                redistribution_approved: true,
                approved_by: 'RAV automated test fixture owner',
                approved_at: '2026-09-03',
                review_reference: 'TEST-ONLY-DISTRIBUTION-REVIEW',
                signing_required: true,
            },
        },
        binaries: [binary('ffprobe', ffprobe), binary('ffmpeg', ffmpeg)],
    };
    const inventoryFile = path.join(root, 'inventory.input.json');
    const saveInventory = async () => writeFile(inventoryFile, canonicalJson(inventory));
    await saveInventory();
    return {
        root,
        source,
        inventory,
        inventoryFile,
        saveInventory,
        cleanup: () => rm(root, { recursive: true, force: true }),
    };
};
