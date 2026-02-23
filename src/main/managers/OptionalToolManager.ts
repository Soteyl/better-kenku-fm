import { app } from "electron";
import { createHash, verify as cryptoVerify } from "crypto";
import { createReadStream } from "fs";
import { promises as fs } from "fs";
import https from "https";
import path from "path";
import { pathToFileURL } from "url";
import { spawn } from "child_process";

type ToolName = "yt-dlp" | "ffmpeg";
type ToolSourceType = "direct" | "youtube";
type PlatformKey = `${NodeJS.Platform}-${NodeJS.Architecture}`;

type ToolRelease = {
  version: string;
  url: string;
  sha256: string;
  binaryName: string;
  signature?: string;
  publicKeyPem?: string;
};

type ToolManifest = {
  tools: Partial<
    Record<
      ToolName,
      {
        version: string;
        sha256: string;
        binaryPath: string;
        sourceUrl: string;
        installedAt: string;
        lastVerifiedAt: string;
      }
    >
  >;
};

type RemoteToolManifest = {
  version: number;
  generatedAt: string;
  tools: Partial<Record<ToolName, Partial<Record<PlatformKey, ToolRelease>>>>;
  signature?: string;
};

type CachedRemoteManifest = {
  fetchedAt: string;
  manifest: RemoteToolManifest;
};

export interface ResolvedTrackSource {
  sourceType: ToolSourceType;
  url: string;
  title?: string;
  localPath?: string;
}

const BUILTIN_TOOL_RELEASES: Record<
  ToolName,
  Partial<Record<PlatformKey, ToolRelease>>
> =
  {
    "yt-dlp": {
      "darwin-arm64": {
        version: "2026.02.21",
        url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.02.21/yt-dlp_macos",
        sha256:
          "13dc66e13e87c187e16bf0def71b35f118bc06145907739d5549d213a9e3b9e5",
        binaryName: "yt-dlp",
      },
      "darwin-x64": {
        version: "2026.02.21",
        url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.02.21/yt-dlp_macos",
        sha256:
          "13dc66e13e87c187e16bf0def71b35f118bc06145907739d5549d213a9e3b9e5",
        binaryName: "yt-dlp",
      },
      "linux-x64": {
        version: "2026.02.21",
        url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.02.21/yt-dlp_linux",
        sha256:
          "057098b1390e8d4931e143eb889e9bbe088f17e40a2936f31ee218909f806f5f",
        binaryName: "yt-dlp",
      },
      "linux-arm64": {
        version: "2026.02.21",
        url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.02.21/yt-dlp_linux_aarch64",
        sha256:
          "7571d3a9bb1ef31a490cd33c37341002006748078ed4d7fa617b0b6ce495f965",
        binaryName: "yt-dlp",
      },
      "win32-x64": {
        version: "2026.02.21",
        url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.02.21/yt-dlp.exe",
        sha256:
          "72a91fe064d5758c976e94f877c24369477dd3e395614b5b270dd5400a035ffa",
        binaryName: "yt-dlp.exe",
      },
      "win32-arm64": {
        version: "2026.02.21",
        url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.02.21/yt-dlp_arm64.exe",
        sha256:
          "17771a25b11af4bc8324de006b39fde7ff62deb8a95bf9000a182769f7b0450b",
        binaryName: "yt-dlp.exe",
      },
    },
    ffmpeg: {},
  };

const REMOTE_MANIFEST_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const REMOTE_MANIFEST_OWNER =
  process.env.KENKU_TOOL_MANIFEST_GH_OWNER || "Soteyl";
const REMOTE_MANIFEST_REPO =
  process.env.KENKU_TOOL_MANIFEST_GH_REPO || "better-kenku-fm";
const REMOTE_MANIFEST_TAG =
  process.env.KENKU_TOOL_MANIFEST_GH_TAG || "tool-manifest";
const REMOTE_MANIFEST_ASSET =
  process.env.KENKU_TOOL_MANIFEST_ASSET || "tools-manifest.json";
const REMOTE_MANIFEST_PUBLIC_KEY_PEM =
  process.env.KENKU_TOOL_MANIFEST_PUBLIC_KEY_PEM;

function isYoutubeURL(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    return (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be" ||
      host.endsWith(".youtube.com")
    );
  } catch {
    return false;
  }
}

export class OptionalToolManager {
  private readonly baseDir = path.join(app.getPath("userData"), "optional-tools");
  private readonly binDir = path.join(this.baseDir, "bin");
  private readonly tempDir = path.join(this.baseDir, "tmp");
  private readonly manifestPath = path.join(this.baseDir, "tools.json");
  private readonly remoteManifestCachePath = path.join(
    this.baseDir,
    "tools-manifest-cache.json",
  );
  private readonly mediaDir = path.join(app.getPath("userData"), "playlist-media");
  private remoteManifestMemoryCache: CachedRemoteManifest | null = null;

  async resolveTrackSource(
    source: string,
    playlistId: string,
  ): Promise<ResolvedTrackSource> {
    const trimmed = source.trim();
    if (!isYoutubeURL(trimmed)) {
      return {
        sourceType: "direct",
        url: trimmed,
      };
    }

    const ytDlpPath = await this.ensureToolInstalled("yt-dlp");
    const downloadResult = await this.downloadYoutubeAudio(
      ytDlpPath,
      trimmed,
      playlistId,
    );
    return {
      sourceType: "youtube",
      title: downloadResult.title,
      localPath: downloadResult.filePath,
      url: pathToFileURL(downloadResult.filePath).toString(),
    };
  }

  private getPlatformKey(): PlatformKey {
    return `${process.platform}-${process.arch}` as PlatformKey;
  }

  private async getRelease(tool: ToolName): Promise<ToolRelease> {
    const platformKey = this.getPlatformKey();
    const remoteManifest = await this.getRemoteManifest();
    const remoteRelease = this.toValidToolRelease(
      remoteManifest?.tools?.[tool]?.[platformKey],
    );
    if (remoteRelease) {
      return remoteRelease;
    }

    const release = BUILTIN_TOOL_RELEASES[tool][platformKey];
    if (!release) {
      throw new Error(
        `Unsupported platform for ${tool}: ${process.platform}-${process.arch}`,
      );
    }
    return release;
  }

  private async ensureToolInstalled(tool: ToolName): Promise<string> {
    const release = await this.getRelease(tool);
    const binaryPath = path.join(this.binDir, release.binaryName);
    const manifest = await this.readManifest();
    const entry = manifest.tools[tool];

    const validExistingInstall =
      entry?.binaryPath === binaryPath &&
      entry.version === release.version &&
      entry.sha256 === release.sha256 &&
      (await this.exists(binaryPath));

    if (validExistingInstall) {
      const currentHash = await this.sha256(binaryPath);
      if (currentHash === release.sha256) {
        await fs.chmod(binaryPath, 0o755);
        manifest.tools[tool] = {
          ...entry,
          lastVerifiedAt: new Date().toISOString(),
        };
        await this.writeManifest(manifest);
        return binaryPath;
      }
    }

    await fs.mkdir(this.binDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });

    const tempPath = path.join(
      this.tempDir,
      `${release.binaryName}-${Date.now()}.tmp`,
    );

    try {
      await this.downloadToFile(release.url, tempPath);
      await this.verifyReleaseIntegrity(tool, tempPath, release);

      await fs.chmod(tempPath, 0o755);
      await fs.rename(tempPath, binaryPath);

      manifest.tools[tool] = {
        version: release.version,
        sha256: release.sha256,
        binaryPath,
        sourceUrl: release.url,
        installedAt: new Date().toISOString(),
        lastVerifiedAt: new Date().toISOString(),
      };
      await this.writeManifest(manifest);
      return binaryPath;
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }
  }

  private getRemoteManifestURL() {
    return `https://github.com/${REMOTE_MANIFEST_OWNER}/${REMOTE_MANIFEST_REPO}/releases/download/${REMOTE_MANIFEST_TAG}/${REMOTE_MANIFEST_ASSET}`;
  }

  private async getRemoteManifest(): Promise<RemoteToolManifest | null> {
    const now = Date.now();

    if (this.remoteManifestMemoryCache) {
      const fetchedAt = Date.parse(this.remoteManifestMemoryCache.fetchedAt);
      if (Number.isFinite(fetchedAt) && now - fetchedAt < REMOTE_MANIFEST_CACHE_TTL_MS) {
        return this.remoteManifestMemoryCache.manifest;
      }
    }

    const diskCache = await this.readRemoteManifestDiskCache();
    if (diskCache) {
      const fetchedAt = Date.parse(diskCache.fetchedAt);
      if (Number.isFinite(fetchedAt) && now - fetchedAt < REMOTE_MANIFEST_CACHE_TTL_MS) {
        this.remoteManifestMemoryCache = diskCache;
        return diskCache.manifest;
      }
    }

    try {
      const response = await this.httpGetBuffer(this.getRemoteManifestURL());
      const manifest = this.parseAndValidateRemoteManifest(response);
      const cache: CachedRemoteManifest = {
        fetchedAt: new Date().toISOString(),
        manifest,
      };
      this.remoteManifestMemoryCache = cache;
      await this.writeRemoteManifestDiskCache(cache);
      return manifest;
    } catch {
      if (diskCache) {
        this.remoteManifestMemoryCache = diskCache;
        return diskCache.manifest;
      }
      return null;
    }
  }

  private parseAndValidateRemoteManifest(buffer: Buffer): RemoteToolManifest {
    const parsed = JSON.parse(buffer.toString("utf-8")) as RemoteToolManifest;
    if (!parsed || typeof parsed !== "object" || typeof parsed.version !== "number") {
      throw new Error("Invalid tools manifest");
    }
    if (!parsed.tools || typeof parsed.tools !== "object") {
      throw new Error("Invalid tools manifest payload");
    }
    if (parsed.signature && REMOTE_MANIFEST_PUBLIC_KEY_PEM) {
      const payload = Buffer.from(
        JSON.stringify({
          version: parsed.version,
          generatedAt: parsed.generatedAt,
          tools: parsed.tools,
        }),
        "utf-8",
      );
      const signature = Buffer.from(parsed.signature, "base64");
      const valid = cryptoVerify(
        "sha256",
        payload,
        REMOTE_MANIFEST_PUBLIC_KEY_PEM,
        signature,
      );
      if (!valid) {
        throw new Error("Tools manifest signature verification failed");
      }
    }
    return parsed;
  }

  private toValidToolRelease(value: unknown): ToolRelease | null {
    if (!value || typeof value !== "object") {
      return null;
    }
    const release = value as Partial<ToolRelease>;
    if (
      typeof release.version !== "string" ||
      typeof release.url !== "string" ||
      typeof release.sha256 !== "string" ||
      typeof release.binaryName !== "string"
    ) {
      return null;
    }
    if (
      release.binaryName.includes("/") ||
      release.binaryName.includes("\\") ||
      release.binaryName.trim().length === 0
    ) {
      return null;
    }
    return {
      version: release.version,
      url: release.url,
      sha256: release.sha256.toLowerCase(),
      binaryName: release.binaryName,
      signature: release.signature,
      publicKeyPem: release.publicKeyPem,
    };
  }

  private async readRemoteManifestDiskCache(): Promise<CachedRemoteManifest | null> {
    if (!(await this.exists(this.remoteManifestCachePath))) {
      return null;
    }
    try {
      const content = await fs.readFile(this.remoteManifestCachePath, "utf-8");
      const parsed = JSON.parse(content) as CachedRemoteManifest;
      if (!parsed?.manifest || !parsed.fetchedAt) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async writeRemoteManifestDiskCache(
    cache: CachedRemoteManifest,
  ): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const tempPath = `${this.remoteManifestCachePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(cache, null, 2), "utf-8");
    await fs.rename(tempPath, this.remoteManifestCachePath);
  }

  private async downloadYoutubeAudio(
    ytDlpPath: string,
    sourceUrl: string,
    playlistId: string,
  ): Promise<{ title: string; filePath: string }> {
    const safePlaylistId =
      playlistId.replace(/[^a-zA-Z0-9-_]/g, "") || "default";
    const targetDir = path.join(this.mediaDir, safePlaylistId);
    await fs.mkdir(targetDir, { recursive: true });

    const outputTemplate = "%(title).120B-%(id)s.%(ext)s";
    const args = [
      "--no-playlist",
      "--no-progress",
      "--no-warnings",
      "-f",
      "bestaudio[ext=m4a]/bestaudio",
      "-P",
      targetDir,
      "-o",
      outputTemplate,
      "--print",
      "title",
      "--print",
      "after_move:filepath",
      sourceUrl,
    ];

    const { stdout, stderr, code } = await this.execBinary(ytDlpPath, args);
    if (code !== 0) {
      throw new Error(stderr || "Failed to download YouTube audio");
    }

    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const filePath = lines[lines.length - 1];
    if (!filePath || !(await this.exists(filePath))) {
      throw new Error("Unable to locate downloaded track file");
    }

    const title = lines[0] || path.basename(filePath, path.extname(filePath));
    return { title, filePath };
  }

  private async execBinary(
    binaryPath: string,
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(binaryPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
        },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on("error", (err) => reject(err));
      proc.on("close", (code) =>
        resolve({
          code: code ?? 1,
          stdout,
          stderr,
        }),
      );
    });
  }

  private async readManifest(): Promise<ToolManifest> {
    if (!(await this.exists(this.manifestPath))) {
      return { tools: {} };
    }
    try {
      const content = await fs.readFile(this.manifestPath, "utf-8");
      const parsed = JSON.parse(content) as ToolManifest;
      return {
        tools: parsed.tools || {},
      };
    } catch {
      return { tools: {} };
    }
  }

  private async writeManifest(manifest: ToolManifest): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const tempPath = `${this.manifestPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(manifest, null, 2), "utf-8");
    await fs.rename(tempPath, this.manifestPath);
  }

  private async downloadToFile(url: string, destination: string): Promise<void> {
    const response = await this.httpGetBuffer(url);
    await fs.writeFile(destination, response);
  }

  private async httpGetBuffer(
    url: string,
    redirectCount = 0,
  ): Promise<Buffer> {
    if (redirectCount > 5) {
      throw new Error("Too many redirects while downloading tool");
    }

    return new Promise((resolve, reject) => {
      const req = https.get(url, (res) => {
        const statusCode = res.statusCode;
        if (
          statusCode &&
          statusCode >= 300 &&
          statusCode < 400 &&
          res.headers.location
        ) {
          resolve(this.httpGetBuffer(res.headers.location, redirectCount + 1));
          return;
        }
        if (statusCode !== 200) {
          reject(
            new Error(
              `Failed to download tool: ${statusCode ?? "unknown status"}`,
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      });

      req.on("error", reject);
    });
  }

  private async sha256(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
    return hash.digest("hex");
  }

  private async verifyReleaseIntegrity(
    tool: ToolName,
    filePath: string,
    release: ToolRelease,
  ): Promise<void> {
    const hash = await this.sha256(filePath);
    if (hash !== release.sha256) {
      throw new Error(`Checksum mismatch while installing ${tool}`);
    }

    if (release.signature && release.publicKeyPem) {
      const signature = Buffer.from(release.signature, "base64");
      const payload = Buffer.from(`${tool}@${release.version}:${hash}`, "utf-8");
      const valid = cryptoVerify(
        "sha256",
        payload,
        release.publicKeyPem,
        signature,
      );
      if (!valid) {
        throw new Error(`Signature verification failed for ${tool}`);
      }
    }
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
