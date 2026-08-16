#!/usr/bin/env node
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import https from "node:https";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";

const strictMode = process.env.KENKU_BUNDLED_TOOLS_STRICT === "1";
const platformKey = `${process.platform}-${process.arch}`;
const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, ".bundled-tools", platformKey);
const defaultPyMusicLooperBaseURL =
  "https://github.com/Soteyl/PyMusicLooper/releases/download/kenku-tools-latest";

const ytDlpMap = {
  "darwin-arm64": {
    url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.08.16.020253/yt-dlp_macos",
    name: "yt-dlp",
  },
  "darwin-x64": {
    url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.08.16.020253/yt-dlp_macos",
    name: "yt-dlp",
  },
  "linux-x64": {
    url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.08.16.020253/yt-dlp_linux",
    name: "yt-dlp",
  },
  "linux-arm64": {
    url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.08.16.020253/yt-dlp_linux_aarch64",
    name: "yt-dlp",
  },
  "win32-x64": {
    url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.08.16.020253/yt-dlp.exe",
    name: "yt-dlp.exe",
  },
  "win32-arm64": {
    url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.08.16.020253/yt-dlp_arm64.exe",
    name: "yt-dlp.exe",
  },
};

// If set, copy the onedir bundle from a local directory instead of downloading.
// Expects the directory to contain the executable and _internal/ beside it.
const localPyMusicLooperDir = process.env.KENKU_PYMUSICLOOPER_LOCAL_DIR;

function getPyMusicLooperTarballURL() {
  const explicitURL = process.env.KENKU_PYMUSICLOOPER_TOOL_URL;
  if (explicitURL) return explicitURL;

  const baseURL =
    process.env.KENKU_PYMUSICLOOPER_BASE_URL || defaultPyMusicLooperBaseURL;

  return `${baseURL.replace(/\/$/, "")}/pymusiclooper-kenku-${platformKey}.tar.gz`;
}

async function downloadFile(url, destination, redirectCount = 0) {
  if (redirectCount > 5) throw new Error(`Too many redirects: ${url}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });

  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        downloadFile(response.headers.location, destination, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

async function ensureExecutable(filePath) {
  if (process.platform !== "win32") {
    await fs.chmod(filePath, 0o755);
  }
}

async function installPyMusicLooperFromLocal(sourceDir, destDir) {
  console.log(`[bundle-tools] copying pymusiclooper from local dir: ${sourceDir}`);
  // Remove any existing installation (old onefile or stale onedir).
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.cp(sourceDir, destDir, { recursive: true });
  const exeName = process.platform === "win32" ? "pymusiclooper-kenku.exe" : "pymusiclooper-kenku";
  await ensureExecutable(path.join(destDir, exeName));
  console.log(`[bundle-tools] local pymusiclooper installed -> ${destDir}`);
}

async function installPyMusicLooperFromTarball(tarballURL, destDir) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pymusiclooper-"));
  const tarballPath = path.join(tmpDir, "pymusiclooper-kenku.tar.gz");

  try {
    console.log(`[bundle-tools] downloading pymusiclooper tarball: ${tarballURL}`);
    await downloadFile(tarballURL, tarballPath);

    // Remove any existing installation before extracting.
    await fs.rm(destDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destDir), { recursive: true });

    // tar -xzf <tarball> -C <parent> extracts pymusiclooper-kenku/ into <parent>.
    execFileSync("tar", ["-xzf", tarballPath, "-C", path.dirname(destDir)], {
      stdio: "inherit",
    });

    const exeName = process.platform === "win32" ? "pymusiclooper-kenku.exe" : "pymusiclooper-kenku";
    await ensureExecutable(path.join(destDir, exeName));
    console.log(`[bundle-tools] pymusiclooper installed -> ${destDir}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log(`[bundle-tools] target platform key: ${platformKey}`);

  const ytDlp = ytDlpMap[platformKey];
  if (!ytDlp) {
    throw new Error(`Unsupported platform for yt-dlp bundling: ${platformKey}`);
  }

  await fs.mkdir(outputDir, { recursive: true });

  const ytDlpOut = path.join(outputDir, ytDlp.name);
  console.log(`[bundle-tools] downloading yt-dlp -> ${ytDlpOut}`);
  await downloadFile(ytDlp.url, ytDlpOut);
  await ensureExecutable(ytDlpOut);

  const pyDestDir = path.join(outputDir, "pymusiclooper-kenku");

  if (localPyMusicLooperDir) {
    await installPyMusicLooperFromLocal(localPyMusicLooperDir, pyDestDir);
  } else {
    const tarballURL = getPyMusicLooperTarballURL();
    if (!tarballURL) {
      const message = "No pymusiclooper source configured; skipping.";
      if (strictMode) throw new Error(message);
      console.warn(`[bundle-tools] ${message}`);
      return;
    }
    await installPyMusicLooperFromTarball(tarballURL, pyDestDir);
  }

  console.log("[bundle-tools] completed");
}

main().catch((error) => {
  console.error("[bundle-tools] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
