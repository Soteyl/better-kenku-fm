import { app } from "electron";
import { createHash, verify as cryptoVerify } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { promises as fs } from "fs";
import https from "https";
import path from "path";
import { pathToFileURL } from "url";
import { spawn } from "child_process";
import { isYoutubeURL } from "../../shared/youtubeUtils";

type ToolName = "yt-dlp" | "pymusiclooper";
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

export interface TrackSourceProgress {
  stage: string;
  message: string;
  progress?: number;
  details?: string;
}

export interface LoopPointCandidate {
  start: number;
  end: number;
  score?: number;
}

export interface LoopPointsResult {
  source: "analysis" | "tags";
  start: number;
  end: number;
  sampleRate?: number;
  candidates?: LoopPointCandidate[];
}

export interface LoopTagsResult {
  start?: number;
  end?: number;
  sampleRate?: number;
  tags: Record<string, string>;
}

const BUILTIN_TOOL_RELEASES: Record<
  ToolName,
  Partial<Record<PlatformKey, ToolRelease>>
> =
  {
    "yt-dlp": {
      "darwin-arm64": {
        version: "2026.08.16.020253",
        url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.08.16.020253/yt-dlp_macos",
        sha256:
          "d80072ab784fb88050fc16ad0c3ce94f6384b892ad0705f9fbbf66e5bb8fe8eb",
        binaryName: "yt-dlp",
      },
      "darwin-x64": {
        version: "2026.08.16.020253",
        url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.08.16.020253/yt-dlp_macos",
        sha256:
          "d80072ab784fb88050fc16ad0c3ce94f6384b892ad0705f9fbbf66e5bb8fe8eb",
        binaryName: "yt-dlp",
      },
      "linux-x64": {
        version: "2026.08.16.020253",
        url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.08.16.020253/yt-dlp_linux",
        sha256:
          "db8835cfe127010bbbbd4cbec8791951e8d6c8fc3f3e85b096d4d6ef7d8711a0",
        binaryName: "yt-dlp",
      },
      "linux-arm64": {
        version: "2026.08.16.020253",
        url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.08.16.020253/yt-dlp_linux_aarch64",
        sha256:
          "fc2a3c79409c10e5296a37c573ca4ce3bfb046e114d45fe06f4922dcfea0dd0d",
        binaryName: "yt-dlp",
      },
      "win32-x64": {
        version: "2026.08.16.020253",
        url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.08.16.020253/yt-dlp.exe",
        sha256:
          "0b6734e904f7e2f77103658c7bccb6fc90b3653f40ab47278ac6314493fdba85",
        binaryName: "yt-dlp.exe",
      },
      "win32-arm64": {
        version: "2026.08.16.020253",
        url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.08.16.020253/yt-dlp_arm64.exe",
        sha256:
          "843a8cb420240d0f016ccedbd8ee401a9bbd81ce1bd3505592fd942c32e5af31",
        binaryName: "yt-dlp.exe",
      },
    },
    pymusiclooper: {},
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
  private readonly bundledToolPathCache = new Map<ToolName, string>();

  async resolveTrackSource(
    source: string,
    playlistId: string,
    onProgress?: (progress: TrackSourceProgress) => void,
  ): Promise<ResolvedTrackSource> {
    const trimmed = source.trim();
    if (!isYoutubeURL(trimmed)) {
      onProgress?.({
        stage: "direct",
        message: "Using direct source URL.",
        progress: 100,
      });
      return {
        sourceType: "direct",
        url: trimmed,
      };
    }

    onProgress?.({
      stage: "prepare",
      message: "Preparing YouTube import pipeline...",
      progress: 5,
    });
    const ytDlpPath = await this.ensureToolInstalled("yt-dlp", onProgress);
    onProgress?.({
      stage: "download",
      message: "Starting YouTube audio download...",
      progress: 30,
    });
    const downloadResult = await this.downloadYoutubeAudio(
      ytDlpPath,
      trimmed,
      playlistId,
      onProgress,
    );
    onProgress?.({
      stage: "complete",
      message: "Audio import complete.",
      progress: 100,
    });
    return {
      sourceType: "youtube",
      title: downloadResult.title,
      localPath: downloadResult.filePath,
      url: pathToFileURL(downloadResult.filePath).toString(),
    };
  }

  async getLoopPoints(trackPath: string): Promise<LoopPointsResult> {
    return this.runPyMusicLooper<LoopPointsResult>([
      "loop-points",
      "--path",
      trackPath,
    ]);
  }

  async readLoopTags(trackPath: string): Promise<LoopTagsResult> {
    return this.runPyMusicLooper<LoopTagsResult>([
      "tag-read",
      "--path",
      trackPath,
    ]);
  }

  async writeLoopTags(
    trackPath: string,
    start: number,
    end: number,
  ): Promise<LoopTagsResult> {
    return this.runPyMusicLooper<LoopTagsResult>([
      "tag-write",
      "--path",
      trackPath,
      "--start",
      String(start),
      "--end",
      String(end),
    ]);
  }

  private async runPyMusicLooper<T>(args: string[]): Promise<T> {
    let binaryPath: string;
    try {
      binaryPath = await this.ensureToolInstalled("pymusiclooper");
    } catch {
      throw new Error(
        "PyMusicLooper is not available. Make sure the app was installed from an official release that includes bundled tools.",
      );
    }
    const { code, stdout, stderr } = await this.execBinary(binaryPath, args);
    if (code !== 0) {
      throw new Error(stderr || "PyMusicLooper invocation failed");
    }
    const payload = stdout.trim();
    if (!payload) {
      throw new Error("PyMusicLooper returned empty response");
    }
    try {
      return JSON.parse(payload) as T;
    } catch {
      throw new Error("PyMusicLooper returned invalid JSON");
    }
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

  private async ensureToolInstalled(
    tool: ToolName,
    onProgress?: (progress: TrackSourceProgress) => void,
  ): Promise<string> {
    const bundledPath = await this.resolveBundledToolPath(tool);
    if (bundledPath) {
      const stagedBundledPath = await this.ensureStagedBundledTool(
        tool,
        bundledPath,
      );
      onProgress?.({
        stage: "tool-ready",
        message: `Using bundled ${tool}.`,
        progress: 20,
      });
      return stagedBundledPath;
    }

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
      onProgress?.({
        stage: "tool-check",
        message: `Verifying installed ${tool} ${release.version}...`,
        progress: 12,
      });
      const currentHash = await this.sha256(binaryPath);
      if (currentHash === release.sha256) {
        await fs.chmod(binaryPath, 0o755);
        manifest.tools[tool] = {
          ...entry,
          lastVerifiedAt: new Date().toISOString(),
        };
        await this.writeManifest(manifest);
        onProgress?.({
          stage: "tool-ready",
          message: `${tool} is ready.`,
          progress: 22,
        });
        return binaryPath;
      }
    }

    onProgress?.({
      stage: "tool-install",
      message: `Installing ${tool} ${release.version}...`,
      progress: 10,
    });
    await fs.mkdir(this.binDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });

    const tempPath = path.join(
      this.tempDir,
      `${release.binaryName}-${Date.now()}.tmp`,
    );

    try {
      onProgress?.({
        stage: "tool-download",
        message: `Downloading ${tool} binary...`,
        progress: 14,
      });
      await this.downloadToFile(release.url, tempPath);
      onProgress?.({
        stage: "tool-verify",
        message: `Verifying ${tool} checksum...`,
        progress: 20,
      });
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
      onProgress?.({
        stage: "tool-ready",
        message: `${tool} installed.`,
        progress: 25,
      });
      return binaryPath;
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }
  }

  private getBundledBinaryName(tool: ToolName): string {
    if (tool === "yt-dlp") {
      return process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
    }
    if (tool === "pymusiclooper") {
      return process.platform === "win32"
        ? "pymusiclooper-kenku.exe"
        : "pymusiclooper-kenku";
    }
    return tool;
  }

  private async resolveBundledToolPath(tool: ToolName): Promise<string | null> {
    const platformKey = this.getPlatformKey();
    const binaryName = this.getBundledBinaryName(tool);
    // Directory name used by PyInstaller onedir mode (no .exe suffix).
    const bundleDirName = binaryName.replace(/\.exe$/i, "");

    // Base directories to search under, in priority order.
    const searchBases = [
      path.join(process.resourcesPath, "tools", platformKey),
      path.join(process.resourcesPath, "tools"),
      path.join(process.resourcesPath, ".bundled-tools", platformKey),
      path.join(process.resourcesPath, ".bundled-tools"),
      path.join(app.getAppPath(), "resources", "tools", platformKey),
      path.join(app.getAppPath(), "resources", "tools"),
      path.join(app.getAppPath(), "resources", ".bundled-tools", platformKey),
      path.join(app.getAppPath(), "resources", ".bundled-tools"),
      path.join(app.getAppPath(), "tools", platformKey),
      path.join(app.getAppPath(), "tools"),
      path.join(app.getAppPath(), ".bundled-tools", platformKey),
      path.join(app.getAppPath(), ".bundled-tools"),
    ];

    for (const base of searchBases) {
      // onedir: <base>/<bundleDirName>/<binaryName>
      const onedirExe = path.join(base, bundleDirName, binaryName);
      if (await this.exists(onedirExe)) {
        await fs.chmod(onedirExe, 0o755).catch((_error: unknown): void => {});
        return onedirExe;
      }
      // onefile (legacy): <base>/<binaryName>
      const onefile = path.join(base, binaryName);
      if (await this.exists(onefile)) {
        await fs.chmod(onefile, 0o755).catch((_error: unknown): void => {});
        return onefile;
      }
    }

    return null;
  }

  private async ensureStagedBundledTool(
    tool: ToolName,
    sourcePath: string,
  ): Promise<string> {
    const cached = this.bundledToolPathCache.get(tool);
    if (cached && (await this.exists(cached))) {
      return cached;
    }

    const platformKey = this.getPlatformKey();
    const binaryName = this.getBundledBinaryName(tool);
    const bundleDirName = binaryName.replace(/\.exe$/i, "");

    // Key the staged copy on the bundled binary's content, not app.getVersion():
    // fork releases keep package.json pinned at 1.5.5, so a version-based name
    // would pin the staged copy to whatever shipped first and never refresh it.
    const sourceStamp = (await this.sha256(sourcePath)).slice(0, 16);

    // Detect onedir: resolveBundledToolPath returns <bundle-dir>/<binaryName>,
    // so the immediate parent directory name equals bundleDirName.
    const isOnedir = path.basename(path.dirname(sourcePath)) === bundleDirName;

    if (isOnedir) {
      const sourceDir = path.dirname(sourcePath);
      const stagedDirName = `${tool}-bundled-${sourceStamp}-${platformKey}`;
      const stagedDir = path.join(this.binDir, stagedDirName);
      const stagedExePath = path.join(stagedDir, binaryName);

      if (!(await this.exists(stagedExePath))) {
        await fs.mkdir(this.binDir, { recursive: true });
        await fs.mkdir(this.tempDir, { recursive: true });
        const tempDir = path.join(
          this.tempDir,
          `${stagedDirName}-${Date.now()}.tmp`,
        );
        await fs.cp(sourceDir, tempDir, { recursive: true });
        await fs.chmod(path.join(tempDir, binaryName), 0o755).catch((_error: unknown): void => {});
        await fs.rename(tempDir, stagedDir);
      } else {
        await fs.chmod(stagedExePath, 0o755).catch((_error: unknown): void => {});
      }

      await this.pruneStaleStagedTools(tool, stagedDirName);
      this.bundledToolPathCache.set(tool, stagedExePath);
      return stagedExePath;
    }

    // onefile (legacy single-file binary)
    const stagedBinaryName = `${tool}-bundled-${sourceStamp}-${platformKey}-${binaryName}`;
    const stagedPath = path.join(this.binDir, stagedBinaryName);

    if (!(await this.exists(stagedPath))) {
      await fs.mkdir(this.binDir, { recursive: true });
      const tempPath = path.join(
        this.tempDir,
        `${stagedBinaryName}-${Date.now()}.tmp`,
      );
      await fs.mkdir(this.tempDir, { recursive: true });
      await fs.copyFile(sourcePath, tempPath);
      await fs.chmod(tempPath, 0o755);
      await fs.rename(tempPath, stagedPath);
    } else {
      await fs.chmod(stagedPath, 0o755).catch((_error: unknown): void => {});
    }

    await this.pruneStaleStagedTools(tool, stagedBinaryName);
    this.bundledToolPathCache.set(tool, stagedPath);
    return stagedPath;
  }

  // Staged copies are content-addressed, so every upgrade leaves the previous
  // one behind. Drop the older ones for this tool once the new one is in place.
  private async pruneStaleStagedTools(
    tool: ToolName,
    keepName: string,
  ): Promise<void> {
    try {
      const entries = await fs.readdir(this.binDir);
      await Promise.all(
        entries
          .filter(
            (entry) => entry.startsWith(`${tool}-bundled-`) && entry !== keepName,
          )
          .map((entry) =>
            fs.rm(path.join(this.binDir, entry), {
              recursive: true,
              force: true,
            }),
          ),
      );
    } catch {
      // Pruning is best-effort; a stale copy costs disk, not correctness.
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
    onProgress?: (progress: TrackSourceProgress) => void,
  ): Promise<{ title: string; filePath: string }> {
    const safePlaylistId =
      playlistId.replace(/[^a-zA-Z0-9-_]/g, "") || "default";
    const targetDir = path.join(this.mediaDir, safePlaylistId);
    await fs.mkdir(targetDir, { recursive: true });

    const outputTemplate = "%(title).120B-%(id)s.%(ext)s";
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--newline",
      "--progress",
      "--progress-template",
      "download:%(progress)j",
      "-f",
      "bestaudio[ext=m4a]/bestaudio/best",
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

    let lastMappedProgress = 30;
    const handleProgressLine = (line: string) => {
      const downloadProgress = this.parseYtDlpProgress(line);
      if (downloadProgress !== null) {
        const mapped = Math.max(
          30,
          Math.min(95, 30 + Math.round(downloadProgress * 0.65)),
        );
        if (mapped < lastMappedProgress) {
          return;
        }
        lastMappedProgress = mapped;
        onProgress?.({
          stage: "download-audio",
          message: `Downloading audio... ${downloadProgress.toFixed(1)}%`,
          progress: lastMappedProgress,
        });
      } else {
        onProgress?.({
          stage: "download-audio",
          message: "Downloading audio...",
        });
      }
    };

    const { stdout, stderr, code } = await this.execBinary(
      ytDlpPath,
      args,
      handleProgressLine,
      handleProgressLine,
    );

    onProgress?.({
      stage: "download-complete",
      message: "Download complete. Finalizing...",
      progress: 93,
    });
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
    onProgress?.({
      stage: "finalize",
      message: "Finalizing imported track...",
      progress: 95,
    });
    return { title, filePath };
  }

  private async execBinary(
    binaryPath: string,
    args: string[],
    onStderrLine?: (line: string) => void,
    onStdoutLine?: (line: string) => void,
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
      let stderrPartial = "";
      let stdoutPartial = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        if (onStdoutLine) {
          stdoutPartial += text.replace(/\r/g, "\n");
          const lines = stdoutPartial.split("\n");
          stdoutPartial = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
              onStdoutLine(trimmed);
            }
          }
        }
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        if (onStderrLine) {
          // yt-dlp frequently emits progress using carriage returns.
          stderrPartial += text.replace(/\r/g, "\n");
          const lines = stderrPartial.split("\n");
          stderrPartial = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
              onStderrLine(trimmed);
            }
          }
        }
      });
      proc.on("error", (err) => reject(err));
      proc.on("close", (code) => {
        if (onStderrLine && stderrPartial.trim().length > 0) {
          onStderrLine(stderrPartial.trim());
        }
        if (onStdoutLine && stdoutPartial.trim().length > 0) {
          onStdoutLine(stdoutPartial.trim());
        }
        resolve({
          code: code ?? 1,
          stdout,
          stderr,
        });
      });
    });
  }

  private parseYtDlpProgress(line: string): number | null {
    let jsonPayload: string | null = null;
    const prefixed = line.match(/^download:(\{.*\})$/);
    if (prefixed && prefixed[1]) {
      jsonPayload = prefixed[1];
    } else if (line.startsWith("{") && line.endsWith("}")) {
      jsonPayload = line;
    }

    if (jsonPayload) {
      try {
        const payload = JSON.parse(jsonPayload) as {
          downloaded_bytes?: number;
          total_bytes?: number;
          total_bytes_estimate?: number;
          _percent?: number;
          _percent_str?: string;
        };
        const downloaded = Number(payload.downloaded_bytes || 0);
        const total = Number(payload.total_bytes || 0);
        const estimate = Number(payload.total_bytes_estimate || 0);
        const denominator = total > 0 ? total : estimate;
        if (denominator > 0 && downloaded > 0) {
          return Math.min(100, Math.max(0, (downloaded / denominator) * 100));
        }

        const percentNumber = Number(payload._percent);
        if (Number.isFinite(percentNumber)) {
          return Math.min(100, Math.max(0, percentNumber));
        }

        const percentFromString = Number.parseFloat(
          String(payload._percent_str || "").replace("%", "").trim(),
        );
        if (Number.isFinite(percentFromString)) {
          return Math.min(100, Math.max(0, percentFromString));
        }
      } catch {
        // Fall through to legacy parsers.
      }
    }

    const structured = line.match(
      /^(?:download:)?(NA|\d+):(NA|\d+):(NA|\d+):\s*([0-9.]+)%?\s*$/i,
    );
    if (structured) {
      const downloadedRaw = structured[1];
      const totalRaw = structured[2];
      const estimateRaw = structured[3];
      const percentFallback = Number.parseFloat(structured[4] || "0");
      const downloaded =
        downloadedRaw && downloadedRaw.toUpperCase() !== "NA"
          ? Number.parseFloat(downloadedRaw)
          : 0;
      const total =
        totalRaw && totalRaw.toUpperCase() !== "NA"
          ? Number.parseFloat(totalRaw)
          : 0;
      const estimate =
        estimateRaw && estimateRaw.toUpperCase() !== "NA"
          ? Number.parseFloat(estimateRaw)
          : 0;
      const denominator = total > 0 ? total : estimate;
      if (denominator > 0 && downloaded > 0) {
        return Math.min(100, Math.max(0, (downloaded / denominator) * 100));
      }
      if (Number.isFinite(percentFallback)) {
        return Math.min(100, Math.max(0, percentFallback));
      }
    }

    const match = line.match(/(\d{1,3}(?:\.\d+)?)%/);
    if (!match || !match[1]) {
      return null;
    }
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value)) {
      return null;
    }
    if (value < 0) {
      return 0;
    }
    if (value > 100) {
      return 100;
    }
    return value;
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

  private async httpGetBuffer(url: string, redirectCount = 0): Promise<Buffer> {
    if (redirectCount > 5) {
      throw new Error("Too many redirects");
    }
    return new Promise((resolve, reject) => {
      const req = https.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(this.httpGetBuffer(res.headers.location, redirectCount + 1));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode ?? "unknown"}`));
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

  private async downloadToFile(
    url: string,
    destination: string,
    redirectCount = 0,
  ): Promise<void> {
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
          res.resume();
          resolve(
            this.downloadToFile(res.headers.location, destination, redirectCount + 1),
          );
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          reject(
            new Error(`Failed to download tool: ${statusCode ?? "unknown status"}`),
          );
          return;
        }

        const file = createWriteStream(destination);
        res.pipe(file);
        file.on("finish", () => file.close((err) => (err ? reject(err) : resolve())));
        file.on("error", (err) => {
          fs.rm(destination, { force: true }).catch(() => {});
          reject(err);
        });
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
