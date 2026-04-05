const REPO = 'ivg-design/rive-animation-viewer';
const API_URL = `https://api.github.com/repos/${REPO}/releases`;

export interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  assets: ReleaseAsset[];
}

export interface PlatformDownload {
  platform: 'mac-silicon' | 'mac-intel' | 'windows';
  label: string;
  filename: string;
  size: number;
  url: string;
}

export interface ParsedRelease {
  version: string;
  name: string;
  body: string;
  date: string;
  downloads: PlatformDownload[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function classifyAsset(asset: ReleaseAsset): PlatformDownload | null {
  const name = asset.name.toLowerCase();

  if (name.endsWith('.dmg')) {
    if (name.includes('aarch64') || name.includes('arm64') || name.includes('apple-silicon')) {
      return {
        platform: 'mac-silicon',
        label: 'macOS (Apple Silicon)',
        filename: asset.name,
        size: asset.size,
        url: asset.browser_download_url,
      };
    }
    if (name.includes('x64') || name.includes('x86_64') || name.includes('intel')) {
      return {
        platform: 'mac-intel',
        label: 'macOS (Intel)',
        filename: asset.name,
        size: asset.size,
        url: asset.browser_download_url,
      };
    }
    // Default DMG to Apple Silicon if no arch specified
    return {
      platform: 'mac-silicon',
      label: 'macOS (Apple Silicon)',
      filename: asset.name,
      size: asset.size,
      url: asset.browser_download_url,
    };
  }

  if (name.endsWith('.msi') || name.endsWith('.exe')) {
    return {
      platform: 'windows',
      label: 'Windows',
      filename: asset.name,
      size: asset.size,
      url: asset.browser_download_url,
    };
  }

  return null;
}

export function parseRelease(release: Release): ParsedRelease {
  const downloads: PlatformDownload[] = [];

  for (const asset of release.assets) {
    const classified = classifyAsset(asset);
    if (classified) {
      downloads.push(classified);
    }
  }

  return {
    version: release.tag_name.replace(/^v/, ''),
    name: release.name || release.tag_name,
    body: release.body || '',
    date: release.published_at,
    downloads,
  };
}

export async function getLatestRelease(): Promise<ParsedRelease | null> {
  try {
    const res = await fetch(`${API_URL}/latest`, {
      next: { revalidate: 3600 },
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) return null;
    const release: Release = await res.json();
    return parseRelease(release);
  } catch {
    return null;
  }
}

export async function getAllReleases(): Promise<ParsedRelease[]> {
  try {
    const res = await fetch(`${API_URL}?per_page=50`, {
      next: { revalidate: 3600 },
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) return [];
    const releases: Release[] = await res.json();
    return releases.map(parseRelease);
  } catch {
    return [];
  }
}

export { formatBytes };
