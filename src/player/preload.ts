import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  LoopPointsResult,
  LoopTagsResult,
  PlaylistPlaybackReply,
  PlaylistsReply,
  ResolvedTrackSource,
  SoundboardPlaybackReply,
  SoundboardsReply,
} from "../types/player";

type Channel =
  | "PLAYER_REMOTE_PLAYLIST_GET_ALL_REQUEST"
  | "PLAYER_REMOTE_PLAYLIST_PLAY"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_REQUEST"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PLAY"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PAUSE"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_MUTE"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_VOLUME"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_SEEK"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_NEXT"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PREVIOUS"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPEAT"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_LOOP"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_SHUFFLE"
  | "PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REQUEST"
  | "PLAYER_REMOTE_SOUNDBOARD_PLAY"
  | "PLAYER_REMOTE_SOUNDBOARD_STOP"
  | "PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REQUEST"
  | "PLAYER_RESOLVE_TRACK_SOURCE_PROGRESS";

const validChannels: Channel[] = [
  "PLAYER_REMOTE_PLAYLIST_GET_ALL_REQUEST",
  "PLAYER_REMOTE_PLAYLIST_PLAY",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_REQUEST",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PLAY",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PAUSE",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_MUTE",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_VOLUME",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_SEEK",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_NEXT",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PREVIOUS",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPEAT",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_LOOP",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_SHUFFLE",
  "PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REQUEST",
  "PLAYER_REMOTE_SOUNDBOARD_PLAY",
  "PLAYER_REMOTE_SOUNDBOARD_STOP",
  "PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REQUEST",
  "PLAYER_RESOLVE_TRACK_SOURCE_PROGRESS",
];

const listenerMap = new WeakMap<
  (...args: any[]) => any,
  (...args: any[]) => any
>();

const api = {
  on: (channel: Channel, callback: (...args: any[]) => any) => {
    if (validChannels.includes(channel)) {
      const newCallback = (_: any, ...args: any[]) => callback(args);
      listenerMap.set(callback, newCallback);
      ipcRenderer.on(channel, newCallback);
    }
  },
  removeListener: (channel: Channel, callback: (...args: any[]) => any) => {
    if (validChannels.includes(channel)) {
      const wrapped = listenerMap.get(callback);
      if (wrapped) {
        ipcRenderer.removeListener(channel, wrapped);
        listenerMap.delete(callback);
      }
    }
  },
  removeAllListeners: (channel: Channel) => {
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  playlistPlaybackReply: (playback: PlaylistPlaybackReply) => {
    ipcRenderer.send("PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPLY", playback);
  },
  soundboardPlaybackReply: (playback: SoundboardPlaybackReply) => {
    ipcRenderer.send("PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REPLY", playback);
  },
  playlistGetAllReply: (playlists: PlaylistsReply) => {
    ipcRenderer.send("PLAYER_REMOTE_PLAYLIST_GET_ALL_REPLY", playlists);
  },
  soundboardGetAllReply: (soundboards: SoundboardsReply) => {
    ipcRenderer.send("PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REPLY", soundboards);
  },
  getPathForFile: (file: File) => {
    return webUtils.getPathForFile(file);
  },
  resolveTrackSource: (source: string, playlistId: string, requestId: string) => {
    return ipcRenderer.invoke(
      "PLAYER_RESOLVE_TRACK_SOURCE",
      source,
      playlistId,
      requestId,
    ) as Promise<ResolvedTrackSource>;
  },
  getLoopPoints: (trackPath: string) => {
    return ipcRenderer.invoke(
      "PLAYER_GET_LOOP_POINTS",
      trackPath,
    ) as Promise<LoopPointsResult>;
  },
  readLoopTags: (trackPath: string) => {
    return ipcRenderer.invoke(
      "PLAYER_READ_LOOP_TAGS",
      trackPath,
    ) as Promise<LoopTagsResult>;
  },
  writeLoopTags: (trackPath: string, start: number, end: number) => {
    return ipcRenderer.invoke(
      "PLAYER_WRITE_LOOP_TAGS",
      trackPath,
      start,
      end,
    ) as Promise<LoopTagsResult>;
  },
  saveImageData: (data: Uint8Array, ext: string) => {
    return ipcRenderer.invoke(
      "PLAYER_SAVE_IMAGE",
      data,
      ext,
    ) as Promise<string>;
  },
  debugLog: (message: string) => {
    ipcRenderer.send("PLAYER_DEBUG_LOG", message);
  },
  forceQuit: () => {
    ipcRenderer.send("PLAYER_FORCE_QUIT");
  },
};

declare global {
  interface Window {
    player: typeof api;
  }
}

contextBridge.exposeInMainWorld("player", api);
