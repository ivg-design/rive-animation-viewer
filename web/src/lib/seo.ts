export const CANONICAL_HOST = "https://forge.mograph.life";
export const CANONICAL_BASE_PATH = "/apps/rav";

export function toCanonicalUrl(path = ""): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedPath === "/") {
    return `${CANONICAL_HOST}${CANONICAL_BASE_PATH}/`;
  }
  return `${CANONICAL_HOST}${CANONICAL_BASE_PATH}${normalizedPath}`;
}
