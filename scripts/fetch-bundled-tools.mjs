#!/usr/bin/env node
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import https from "node:https";
import path from "node:path";

const strictMode = process.env.KENKU_BUNDLED_TOOLS_STRICT === "1";
const platformKey = `${process.platform}-${process.arch}`;
const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, ".bundled-tools", platformKey);
const defaultPyMusicLooperBaseURL =
  "https://github.com/Soteyl/PyMusicLooper/releases/download/kenku-tools-latest";

const ytDlpMap = {
  "darwin-arm64": {
    url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.02.21/yt-dlp_macos",
    name: "yt-dlp",
  },
  "darwin-x64": {
    url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.02.21/yt-dlp_macos",
    name: "yt-dlp",
  },
  "linux-x64": {
    url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.02.21/yt-dlp_linux",
    name: "yt-dlp",
  },
  "linux-arm64": {
    url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.02.21/yt-dlp_linux_aarch64",
    name: "yt-dlp",
  },
  "win32-x64": {
    url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.02.21/yt-dlp.exe",
    name: "yt-dlp.exe",
  },
  "win32-arm64": {
    url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.02.21/yt-dlp_arm64.exe",
    name: "yt-dlp.exe",
  },
};

function getPyMusicLooperConfig() {
  const explicitURL = process.env.KENKU_PYMUSICLOOPER_TOOL_URL;
  if (explicitURL) {
    return {
      url: explicitURL,
      name: process.platform === "win32" ? "pymusiclooper-kenku.exe" : "pymusiclooper-kenku",
    };
  }

  const baseURL =
    process.env.KENKU_PYMUSICLOOPER_BASE_URL || defaultPyMusicLooperBaseURL;

  const fileName =
    process.platform === "win32"
      ? `pymusiclooper-kenku-${platformKey}.exe`
      : `pymusiclooper-kenku-${platformKey}`;

  return {
    url: `${baseURL.replace(/\/$/, "")}/${fileName}`,
    name: process.platform === "win32" ? "pymusiclooper-kenku.exe" : "pymusiclooper-kenku",
  };
}

async function downloadFile(url, destination) {
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
        downloadFile(response.headers.location, destination).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => {
        file.close(() => resolve());
      });
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

  const pyMusicLooper = getPyMusicLooperConfig();
  if (!pyMusicLooper) {
    const message =
      "KENKU_PYMUSICLOOPER_BASE_URL (or KENKU_PYMUSICLOOPER_TOOL_URL) is not set; skipping pymusiclooper bundle.";
    if (strictMode) {
      throw new Error(message);
    }
    console.warn(`[bundle-tools] ${message}`);
    return;
  }

  const pyOut = path.join(outputDir, pyMusicLooper.name);
  console.log(`[bundle-tools] downloading pymusiclooper -> ${pyOut}`);
  await downloadFile(pyMusicLooper.url, pyOut);
  await ensureExecutable(pyOut);

  console.log("[bundle-tools] completed");
}

main().catch((error) => {
  console.error("[bundle-tools] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
