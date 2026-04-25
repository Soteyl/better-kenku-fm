import { ipcMain, BrowserWindow, webContents, app } from "electron";
import Fastify, { FastifyInstance } from "fastify";
import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { registerRemote } from "../remote";
import {
  LoopPointsResult,
  LoopTagsResult,
  OptionalToolManager,
  ResolvedTrackSource,
  TrackSourceProgress,
} from "./OptionalToolManager";

declare const PLAYER_WINDOW_WEBPACK_ENTRY: string;
declare const PLAYER_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

export class PlayerManager {
  registeredViewId?: number;
  fastify: FastifyInstance | null = null;
  address = "127.0.0.1";
  port = "3333";
  toolManager = new OptionalToolManager();
  debugLogPath = path.join(app.getPath("userData"), "player-debug.log");

  constructor() {
    ipcMain.on("PLAYER_GET_URL", this._handleGetURL);
    ipcMain.on("PLAYER_GET_PRELOAD_URL", this._handleGetPreloadURL);
    ipcMain.on("PLAYER_REGISTER_VIEW", this._handleRegisterView);
    ipcMain.on("PLAYER_START_REMOTE", this._handleStartRemote);
    ipcMain.on("PLAYER_STOP_REMOTE", this._handleStopRemote);
    ipcMain.handle("PLAYER_RESOLVE_TRACK_SOURCE", this._handleResolveTrackSource);
    ipcMain.handle("PLAYER_GET_LOOP_POINTS", this._handleGetLoopPoints);
    ipcMain.handle("PLAYER_READ_LOOP_TAGS", this._handleReadLoopTags);
    ipcMain.handle("PLAYER_WRITE_LOOP_TAGS", this._handleWriteLoopTags);
    ipcMain.on("PLAYER_DEBUG_LOG", this._handleDebugLog);
    ipcMain.on("PLAYER_FORCE_QUIT", this._handleForceQuit);
  }

  destroy() {
    ipcMain.off("PLAYER_GET_URL", this._handleGetURL);
    ipcMain.off("PLAYER_GET_PRELOAD_URL", this._handleGetPreloadURL);
    ipcMain.off("PLAYER_REGISTER_VIEW", this._handleRegisterView);
    ipcMain.off("PLAYER_START_REMOTE", this._handleStartRemote);
    ipcMain.off("PLAYER_STOP_REMOTE", this._handleStopRemote);
    ipcMain.removeHandler("PLAYER_RESOLVE_TRACK_SOURCE");
    ipcMain.removeHandler("PLAYER_GET_LOOP_POINTS");
    ipcMain.removeHandler("PLAYER_READ_LOOP_TAGS");
    ipcMain.removeHandler("PLAYER_WRITE_LOOP_TAGS");
    ipcMain.off("PLAYER_DEBUG_LOG", this._handleDebugLog);
    ipcMain.off("PLAYER_FORCE_QUIT", this._handleForceQuit);
    this.stopRemote();
  }

  getView() {
    if (this.registeredViewId) {
      return webContents.fromId(this.registeredViewId);
    }
  }

  startRemote(address: string, port: string) {
    this.address = address;
    this.port = port;

    this.fastify = Fastify();

    registerRemote(this);

    this.fastify.listen(this.port, this.address, (err) => {
      const windows = BrowserWindow.getAllWindows();
      if (err) {
        for (const window of windows) {
          window.webContents.send("ERROR", err.message);
        }
        this.stopRemote();
      } else {
        for (const window of windows) {
          window.webContents.send("PLAYER_REMOTE_ENABLED", true);
        }
      }
    });
  }

  stopRemote() {
    if (this.fastify) {
      this.fastify.close();
      this.fastify = null;

      const windows = BrowserWindow.getAllWindows();
      for (const window of windows) {
        window.webContents.send("PLAYER_REMOTE_ENABLED", false);
      }
    }
  }

  getRemoteInfo() {
    return `Running: ${this.fastify !== null}\nAddress: ${
      this.address
    }\nPort: ${this.port}`;
  }

  _handleStartRemote = (
    _: Electron.IpcMainEvent,
    address: string,
    port: string
  ) => this.startRemote(address, port);

  _handleStopRemote = () => this.stopRemote();

  _handleGetURL = (event: Electron.IpcMainEvent) => {
    event.returnValue = PLAYER_WINDOW_WEBPACK_ENTRY;
  };

  _handleGetPreloadURL = (event: Electron.IpcMainEvent) => {
    event.returnValue = PLAYER_WINDOW_PRELOAD_WEBPACK_ENTRY;
  };

  _handleRegisterView = (_: Electron.IpcMainEvent, viewId: number) => {
    this.registeredViewId = viewId;
  };

  _handleResolveTrackSource = async (
    event: Electron.IpcMainInvokeEvent,
    source: string,
    playlistId: string,
    requestId: string,
  ): Promise<ResolvedTrackSource> => {
    return this.toolManager.resolveTrackSource(
      source,
      playlistId,
      (progress: TrackSourceProgress) => {
        event.sender.send(
          "PLAYER_RESOLVE_TRACK_SOURCE_PROGRESS",
          requestId,
          progress,
        );
      },
    );
  };

  _handleGetLoopPoints = async (
    _: Electron.IpcMainInvokeEvent,
    trackPath: string,
  ): Promise<LoopPointsResult> => {
    return this.toolManager.getLoopPoints(trackPath);
  };

  _handleReadLoopTags = async (
    _: Electron.IpcMainInvokeEvent,
    trackPath: string,
  ): Promise<LoopTagsResult> => {
    return this.toolManager.readLoopTags(trackPath);
  };

  _handleWriteLoopTags = async (
    _: Electron.IpcMainInvokeEvent,
    trackPath: string,
    start: number,
    end: number,
  ): Promise<LoopTagsResult> => {
    return this.toolManager.writeLoopTags(trackPath, start, end);
  };

  _handleDebugLog = async (
    _: Electron.IpcMainEvent,
    payload: string,
  ): Promise<void> => {
    try {
      await mkdir(path.dirname(this.debugLogPath), { recursive: true });
      await appendFile(
        this.debugLogPath,
        `${new Date().toISOString()} ${payload}\n`,
        "utf-8",
      );
    } catch {
      // ignore logging failures
    }
  };

  _handleForceQuit = (): void => {
    app.quit();
  };
}
