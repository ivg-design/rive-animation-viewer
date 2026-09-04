import { createHash } from 'node:crypto';
import {
    mkdir,
    mkdtemp,
    rm,
    writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

const target = (distributionTarget, asset, archiveType, bytes, extension = '') => ({
    distribution_target: distributionTarget,
    asset,
    sha256: hash(bytes),
    size_bytes: bytes.length,
    archive_type: archiveType,
    ffmpeg_member: `ffmpeg${extension}`,
    ffprobe_member: `ffprobe${extension}`,
});

export const createAcquisitionFixture = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rav-acquisition-test-'));
    const assetBytes = Buffer.from('synthetic release archive');
    const sourceBytes = Buffer.from('synthetic corresponding source archive');
    const sourceUrl = 'https://downloads.example.invalid/v7.1.4-3.tar.gz';
    const catalog = {
        schema_version: 1,
        release: {
            project: 'Synthetic Jellyfin FFmpeg',
            tag: 'v7.1.4-3',
            ffmpeg_version: '7.1.4-Jellyfin',
            base_url: 'https://downloads.example.invalid/releases/',
            source: {
                url: sourceUrl,
                sha256: hash(sourceBytes),
                size_bytes: sourceBytes.length,
                license_files: [
                    { member: 'source/COPYING.GPLv3', file: 'licenses/COPYING.GPLv3' },
                    { member: 'source/LICENSE.md', file: 'licenses/FFmpeg-LICENSE.md' },
                ],
            },
        },
        distribution: {
            license_spdx: 'GPL-3.0-or-later',
            redistribution_basis: 'Synthetic GPL fixture redistribution basis',
            review_reference: 'SYNTHETIC-LICENSE-REVIEW',
            approval: {
                redistribution_approved: true,
                approved_by: 'Synthetic test owner',
                approved_at: '2026-09-03',
                review_reference: 'SYNTHETIC-DISTRIBUTION-REVIEW',
                signing_required: true,
            },
        },
        targets: {
            'aarch64-apple-darwin': target(
                'macos-aarch64', 'mac-arm.tar.xz', 'tar.xz', assetBytes,
            ),
            'x86_64-apple-darwin': target(
                'macos-x86_64', 'mac-x64.tar.xz', 'tar.xz', assetBytes,
            ),
            'x86_64-pc-windows-msvc': target(
                'windows-x86_64', 'windows-x64.zip', 'zip', assetBytes, '.exe',
            ),
        },
    };
    const catalogFile = path.join(root, 'catalog.json');
    await writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);
    let downloads = 0;
    const archivePrograms = [];
    const downloader = async (url, destination) => {
        downloads += 1;
        await writeFile(destination, url === sourceUrl ? sourceBytes : assetBytes);
    };
    const archiveRunner = async (program, args) => {
        archivePrograms.push(program);
        const destination = args[args.indexOf('-C') + 1];
        const members = args.slice(args.indexOf('--') + 1);
        for (const member of members) {
            const file = path.join(destination, member);
            await mkdir(path.dirname(file), { recursive: true });
            if (member.endsWith('COPYING.GPLv3')) {
                await writeFile(file, 'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n');
            } else if (member.endsWith('LICENSE.md')) {
                await writeFile(file, 'Synthetic FFmpeg license overview\n');
            } else {
                const id = path.basename(member).startsWith('ffprobe') ? 'ffprobe' : 'ffmpeg';
                await writeFile(
                    file,
                    `${id} version 7.1.4-Jellyfin\0configuration: --enable-gpl --enable-version3\0`,
                );
            }
        }
    };
    return {
        root,
        assetBytes,
        catalogFile,
        downloader,
        archiveRunner,
        archivePrograms,
        downloadCount: () => downloads,
        cleanup: () => rm(root, { recursive: true, force: true }),
    };
};
