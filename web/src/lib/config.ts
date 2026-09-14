export const basePath = '/apps/rav';

const isDev = process.env.NODE_ENV === 'development';
const isDirectAccess = process.env.NEXT_PUBLIC_SITE_URL?.includes('rav') && !process.env.NEXT_PUBLIC_SITE_URL?.includes('forge');

export function asset(path: string): string {
  if (isDev || isDirectAccess) {
    return path;
  }
  return `${basePath}${path}`;
}

// Large media (videos, full-size screenshots) lives in the shared Vercel Blob store
// so it is not bundled into every deployment. Upload with: vercel blob put <file> --pathname rav/<path>
export const MEDIA_BASE = 'https://uitihmj6x17wjfgb.public.blob.vercel-storage.com/rav';
export function media(path: string): string {
  return `${MEDIA_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}
