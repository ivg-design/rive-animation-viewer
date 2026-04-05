export const basePath = '/apps/rav';

const isDev = process.env.NODE_ENV === 'development';
const isDirectAccess = process.env.NEXT_PUBLIC_SITE_URL?.includes('rav') && !process.env.NEXT_PUBLIC_SITE_URL?.includes('forge');

export function asset(path: string): string {
  if (isDev || isDirectAccess) {
    return path;
  }
  return `${basePath}${path}`;
}
