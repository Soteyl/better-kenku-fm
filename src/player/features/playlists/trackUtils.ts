export function resolveLocalTrackPath(url: string): string | null {
  if (url.startsWith("file://")) {
    try {
      const parsed = new URL(url);
      const pathname = decodeURIComponent(parsed.pathname);
      if (/^\/[A-Za-z]:\//.test(pathname)) {
        return pathname.slice(1);
      }
      return pathname;
    } catch {
      return null;
    }
  }

  if (url.startsWith("/")) {
    return url;
  }

  if (/^[A-Za-z]:\\/.test(url)) {
    return url;
  }

  return null;
}
