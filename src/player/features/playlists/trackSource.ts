/**
 * Helpers for reasoning about a track's `url` source.
 *
 * Local files are stored as `file://<encoded-path>` (see `encodeFilePath` in
 * `src/renderer/common/drop.ts`), while internet sources are `http(s)://…`.
 */

export function isLocalFileUrl(url: string): boolean {
  return url.startsWith("file://");
}

/** Reverse of `encodeFilePath` — returns the OS filesystem path. */
export function fileUrlToPath(url: string): string {
  return decodeURIComponent(url.slice("file://".length));
}

/** Platform-appropriate label for revealing a file in the OS file manager. */
export function revealLabel(platform: string): string {
  switch (platform) {
    case "darwin":
      return "Reveal in Finder";
    case "win32":
      return "Show in File Explorer";
    default:
      return "Show in Folder";
  }
}
