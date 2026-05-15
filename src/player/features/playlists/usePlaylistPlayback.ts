import { useCallback, useEffect, useRef } from "react";
import { Howl } from "howler";

import { useDispatch, useSelector, useStore } from "react-redux";
import { RootState } from "../../app/store";
import {
  editTrack,
} from "./playlistsSlice";
import {
  playPause,
  playTrack,
  updatePlayback,
  updateQueue,
  stopTrack,
} from "./playlistPlaybackSlice";
import { Track } from "./playlistsSlice";

type LoopRange = {
  start: number;
  end: number;
};

function resolveLoopRange(
  track: Track | undefined,
  duration: number,
  loopEnabled: boolean,
): LoopRange | null {
  if (!loopEnabled || duration <= 0) {
    return null;
  }

  if (
    !track ||
    typeof track.loopStart !== "number" ||
    typeof track.loopEnd !== "number"
  ) {
    return null;
  }

  const start = Math.max(0, track.loopStart);
  const end = Math.min(duration, track.loopEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.05) {
    return null;
  }

  return { start, end };
}

function resolveLocalTrackPath(url: string): string | null {
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

function hasTrackLoopPoints(track: Track | undefined): boolean {
  return (
    Boolean(track) &&
    typeof track?.loopStart === "number" &&
    typeof track?.loopEnd === "number" &&
    track.loopEnd > track.loopStart
  );
}

export function usePlaylistPlayback(onError: (message: string) => void) {
  const trackRef = useRef<Howl | null>(null);
  const animationRef = useRef<number | null>(null);
  const activeLoopRef = useRef<LoopRange | null>(null);
  const loopAnalysisQueueRef = useRef<Array<{ id: string; url: string }>>([]);
  const loopAnalysisRunningRef = useRef(false);
  const loopAnalysisActiveTrackRef = useRef<string | null>(null);
  const loopAnalysisRetryAfterRef = useRef<Record<string, number>>({});
  const lastManualWrapAtRef = useRef(0);
  const lastLoopCheckAtRef = useRef(0);
  const fallbackEndTimerRef = useRef<number | null>(null);
  const playbackGenerationRef = useRef(0);
  const loopScheduleTimerRef = useRef<number | null>(null);

  const playlists = useSelector((state: RootState) => state.playlists);
  const store = useStore<RootState>();
  const muted = useSelector((state: RootState) => state.playlistPlayback.muted);
  const loopEnabled = useSelector(
    (state: RootState) => state.playlistPlayback.loopEnabled,
  );
  const repeat = useSelector(
    (state: RootState) => state.playlistPlayback.repeat
  );
  const shuffle = useSelector(
    (state: RootState) => state.playlistPlayback.shuffle
  );
  const queue = useSelector((state: RootState) => state.playlistPlayback.queue);
  const playbackTrack = useSelector(
    (state: RootState) => state.playlistPlayback.track
  );
  const canonicalPlaybackTrack = playbackTrack?.id
    ? playlists.tracks[playbackTrack.id] || playbackTrack
    : undefined;
  const dispatch = useDispatch();

  const logDebug = useCallback((message: string) => {
    window.player.debugLog(`[loop-playback] ${message}`);
  }, []);

  const persistLoopTagsAsync = useCallback(
    (
      trackId: string,
      trackPath: string,
      startSamples: number,
      endSamples: number,
    ): void => {
      void window.player
        .writeLoopTags(trackPath, startSamples, endSamples)
        .then(() => {
          logDebug(
            `loop-autodetect-tag-write-success id=${trackId} startSamples=${startSamples} endSamples=${endSamples}`,
          );
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : "unknown tag write error";
          logDebug(
            `loop-autodetect-tag-write-error id=${trackId} error="${message}"`,
          );
        });
    },
    [logDebug],
  );

  const runLoopAnalysisQueue = useCallback(async (): Promise<void> => {
    if (loopAnalysisRunningRef.current) {
      return;
    }
    loopAnalysisRunningRef.current = true;
    try {
      while (loopAnalysisQueueRef.current.length > 0) {
        const next = loopAnalysisQueueRef.current.shift();
        if (!next) {
          continue;
        }
        loopAnalysisActiveTrackRef.current = next.id;
        const latestTrack = store.getState().playlists.tracks[next.id];
        if (!latestTrack || hasTrackLoopPoints(latestTrack)) {
          loopAnalysisActiveTrackRef.current = null;
          delete loopAnalysisRetryAfterRef.current[next.id];
          if (latestTrack) {
            dispatch(
              editTrack({
                id: latestTrack.id,
                loopAnalysisState: undefined,
                loopAnalysisError: undefined,
              }),
            );
          }
          continue;
        }

        const trackPath = resolveLocalTrackPath(latestTrack.url || next.url);
        if (!trackPath) {
          loopAnalysisActiveTrackRef.current = null;
          logDebug(
            `loop-autodetect-skip id=${next.id} reason=non-local-source url=${latestTrack.url || next.url}`,
          );
          dispatch(
            editTrack({
              id: next.id,
              loopAnalysisState: "error",
              loopAnalysisError: "Loop analysis is only available for local files.",
            }),
          );
          continue;
        }

        try {
          logDebug(`loop-autodetect-start id=${next.id} path="${trackPath}"`);
          const points = await window.player.getLoopPoints(trackPath);
          if (
            typeof points.start !== "number" ||
            typeof points.end !== "number" ||
            typeof points.sampleRate !== "number" ||
            points.sampleRate <= 0
          ) {
            throw new Error("analysis returned invalid loop points");
          }

          const loopStart = points.start / points.sampleRate;
          const loopEnd = points.end / points.sampleRate;
          if (loopEnd - loopStart < 0.05) {
            throw new Error("analysis loop range is too short");
          }
          const startSamples = Math.max(0, Math.round(points.start));
          const endSamples = Math.max(startSamples + 1, Math.round(points.end));

          dispatch(
            editTrack({
              id: next.id,
              loopStart,
              loopEnd,
              loopSource: "analysis",
              loopAnalysisState: undefined,
              loopAnalysisError: undefined,
            }),
          );
          delete loopAnalysisRetryAfterRef.current[next.id];
          logDebug(
            `loop-autodetect-success id=${next.id} source=analysis start=${loopStart.toFixed(
              4,
            )} end=${loopEnd.toFixed(4)}`,
          );
          persistLoopTagsAsync(next.id, trackPath, startSamples, endSamples);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown analysis error";
          loopAnalysisRetryAfterRef.current[next.id] = Date.now() + 30_000;
          logDebug(`loop-autodetect-error id=${next.id} error="${message}"`);
          dispatch(
            editTrack({
              id: next.id,
              loopAnalysisState: "error",
              loopAnalysisError: message,
            }),
          );
        } finally {
          loopAnalysisActiveTrackRef.current = null;
        }
      }
    } finally {
      loopAnalysisRunningRef.current = false;
    }
  }, [dispatch, logDebug, persistLoopTagsAsync, store]);

  const ensureTrackLoopPoints = useCallback(
    (track: Track): void => {
      if (
        !loopEnabled ||
        hasTrackLoopPoints(track) ||
        track.loopAnalysisState === "pending"
      ) {
        return;
      }
      const retryAfter = loopAnalysisRetryAfterRef.current[track.id];
      if (retryAfter && Date.now() < retryAfter) {
        return;
      }
      const currentlyQueuedOrRunning =
        loopAnalysisQueueRef.current.some((queued) => queued.id === track.id) ||
        loopAnalysisActiveTrackRef.current === track.id;
      if (currentlyQueuedOrRunning) {
        return;
      }
      dispatch(
        editTrack({
          id: track.id,
          loopAnalysisState: "pending",
          loopAnalysisError: undefined,
        }),
      );
      // Keep only the current track request to avoid long stale backlogs.
      loopAnalysisQueueRef.current = [{ id: track.id, url: track.url }];
      void runLoopAnalysisQueue();
    },
    [dispatch, loopEnabled, runLoopAnalysisQueue],
  );

  const applyNativeLoopRegion = useCallback(
    (howl: Howl, duration: number, reason: string): void => {
      const sound = (howl as any)._sounds?.[0];
      const activeLoop = activeLoopRef.current;
      if (!sound) {
        logDebug(`native-loop-skip reason=${reason} missing-sound`);
        return;
      }

      if (!activeLoop) {
        sound._loop = false;
        sound._start = 0;
        sound._stop = duration;
        howl.loop(false, sound._id);
        if (sound._node?.bufferSource) {
          sound._node.bufferSource.loop = false;
        }
        logDebug(`native-loop-disabled reason=${reason} id=${sound._id}`);
        return;
      }

      sound._loop = true;
      sound._start = activeLoop.start;
      sound._stop = activeLoop.end;
      // Keep native loop disabled and use explicit manual wrap transport.
      howl.loop(false, sound._id);
      if (sound._node?.bufferSource) {
        sound._node.bufferSource.loop = false;
      }
      logDebug(
        `native-loop-configured reason=${reason} id=${sound._id} start=${activeLoop.start.toFixed(
          4,
        )} end=${activeLoop.end.toFixed(4)}`,
      );
    },
    [logDebug],
  );

  const play = useCallback(
    (track: Track) => {
      const previousTrack = trackRef.current;
      function error() {
        trackRef.current = undefined;
        dispatch(stopTrack());
        if (previousTrack) {
          previousTrack.stop();
          previousTrack.unload();
        }
        onError(`Unable to play track: ${track.title}`);
      }

      try {
        if (previousTrack) {
          previousTrack.stop();
          previousTrack.unload();
        }

        const howl = new Howl({
          src: track.url,
          // Use Web Audio API only when loop points are active — it enables
          // lower-latency seek wraps. Fall back to html5 (streaming) otherwise
          // so large files start immediately without full decode upfront.
          html5: !(loopEnabled && hasTrackLoopPoints(track)),
          mute: muted,
          volume: 0,
        });

        trackRef.current = howl;
        howl.once("load", () => {
          playbackGenerationRef.current += 1;
          if (fallbackEndTimerRef.current !== null) {
            window.clearTimeout(fallbackEndTimerRef.current);
            fallbackEndTimerRef.current = null;
          }
          const duration = howl.duration();
          lastManualWrapAtRef.current = 0;
          lastLoopCheckAtRef.current = 0;
          activeLoopRef.current = resolveLoopRange(track, duration, loopEnabled);
          logDebug(
            `track-load id=${track.id} title="${track.title}" duration=${duration.toFixed(
              3,
            )} loopEnabled=${loopEnabled} start=${track.loopStart ?? "n/a"} end=${
              track.loopEnd ?? "n/a"
            } source=${track.loopSource ?? "n/a"} activeLoop=${
              activeLoopRef.current
                ? `${activeLoopRef.current.start.toFixed(3)}-${activeLoopRef.current.end.toFixed(3)}`
              : "none"
            }`,
          );
          applyNativeLoopRegion(howl, duration, "load");
          dispatch(
            playTrack({
              track,
              duration: Math.floor(duration),
            })
          );
          howl.volume(store.getState().playlistPlayback.volume);
          howl.on("play", () => {
            applyNativeLoopRegion(howl, duration, "play");
          });

          // Update playback
          // Create playback animation
          if (animationRef.current !== null) {
            cancelAnimationFrame(animationRef.current);
          }
          let prevTime = performance.now();
          function animatePlayback(time: number) {
            animationRef.current = requestAnimationFrame(animatePlayback);
            if (!howl.playing()) {
              return;
            }

            const activeLoop = activeLoopRef.current;
            if (activeLoop && time - lastLoopCheckAtRef.current >= 40) {
              lastLoopCheckAtRef.current = time;
              const rawPosition = Number(howl.seek() || 0);
              const minWrapGapMs = 120;
              if (
                Number.isFinite(rawPosition) &&
                rawPosition >= activeLoop.end &&
                time - lastManualWrapAtRef.current > minWrapGapMs
              ) {
                const overshoot = rawPosition - activeLoop.end;
                const wrappedPosition = activeLoop.start + Math.max(0, overshoot);
                lastManualWrapAtRef.current = time;
                logDebug(
                  `manual-loop-wrap id=${track.id} raw=${rawPosition.toFixed(4)} start=${activeLoop.start.toFixed(
                    4,
                  )} end=${activeLoop.end.toFixed(4)} wrapped=${wrappedPosition.toFixed(4)}`,
                );
                howl.seek(wrappedPosition);
              }
            }

            // Limit Redux playback updates.
            const delta = time - prevTime;
            if (delta > 500) {
              dispatch(updatePlayback(Math.floor(Number(howl.seek() || 0))));
              prevTime = time;
            }
          }
          animationRef.current = requestAnimationFrame(animatePlayback);
        });

        howl.on("loaderror", error);

        howl.on("playerror", error);

        const sound = (howl as any)._sounds[0];
        if (!sound) {
          error();
        }
      } catch {
        error();
      }
    },
    [applyNativeLoopRegion, logDebug, onError, loopEnabled, muted, store]
  );

  const seek = useCallback((to: number) => {
    dispatch(updatePlayback(to));
    trackRef.current?.seek(to);
  }, []);

  const stop = useCallback(() => {
    playbackGenerationRef.current += 1;
    activeLoopRef.current = null;
    lastManualWrapAtRef.current = 0;
    lastLoopCheckAtRef.current = 0;
    if (fallbackEndTimerRef.current !== null) {
      window.clearTimeout(fallbackEndTimerRef.current);
      fallbackEndTimerRef.current = null;
    }
    dispatch(playPause(false));
    dispatch(updatePlayback(0));
    trackRef.current?.stop();
  }, []);

  const next = useCallback(() => {
    if (!trackRef.current) {
      return;
    }
    if (!queue) {
      stop();
    } else if (repeat === "track") {
      seek(0);
    } else {
      let index = queue.current + 1;

      if (index >= queue.tracks.length) {
        // Repeat off just stop the playback
        if (repeat === "off") {
          stop();
          return;
        }
        index = 0;
      }

      let id: string;
      if (shuffle) {
        id = queue.tracks[queue.shuffled[index]];
      } else {
        id = queue.tracks[index];
      }
      if (id) {
        if (id === playbackTrack?.id) {
          // Playing the same track just restart it
          seek(0);
        } else {
          // Play the previous track
          const previousTrack = playlists.tracks[id];
          if (previousTrack) {
            play(previousTrack);
            dispatch(updateQueue(index));
          }
        }
      }
    }
  }, [repeat, queue, shuffle, playbackTrack, playlists, seek, play, stop]);

  const previous = useCallback(() => {
    if (!trackRef.current) {
      return;
    }
    if (!queue) {
      stop();
    } else if (repeat === "track") {
      seek(0);
    } else {
      let index = queue.current;
      // Only go to previous if at the start of the track
      if (trackRef.current.seek() < 5) {
        index -= 1;
      }
      if (index < 0) {
        // Start of playlist with repeat off just stop the track
        if (repeat === "off") {
          stop();
          return;
        }
        index = queue.tracks.length - 1;
      }
      let id: string;
      if (shuffle) {
        id = queue.tracks[queue.shuffled[index]];
      } else {
        id = queue.tracks[index];
      }
      if (id) {
        if (id === playbackTrack?.id) {
          // Playing the same track just restart it
          seek(0);
        } else {
          // Play the next track
          const nextTrack = playlists.tracks[id];
          if (nextTrack) {
            play(nextTrack);
            dispatch(updateQueue(index));
          }
        }
      }
    }
  }, [repeat, queue, shuffle, playbackTrack, playlists, seek, play, stop]);

  useEffect(() => {
    const track = trackRef.current;
    // Move to next song or repeat this song on track end
    function handleEnd() {
      const activeLoop = activeLoopRef.current;
      if (activeLoop) {
        // Backup only: manual-wrap should normally prevent end events.
        const generationAtEnd = playbackGenerationRef.current;
        if (fallbackEndTimerRef.current !== null) {
          window.clearTimeout(fallbackEndTimerRef.current);
        }
        fallbackEndTimerRef.current = window.setTimeout(() => {
          fallbackEndTimerRef.current = null;
          if (generationAtEnd !== playbackGenerationRef.current) {
            return;
          }
          if (trackRef.current !== track) {
            return;
          }
          const now = performance.now();
          if (now - lastManualWrapAtRef.current < 400) {
            logDebug(
              `track-end-with-active-loop id=${playbackTrack?.id ?? "unknown"} action=ignore-recent-wrap`,
            );
            return;
          }
          const position = Number(track?.seek() || 0);
          logDebug(
            `track-end-with-active-loop id=${playbackTrack?.id ?? "unknown"} position=${position.toFixed(
              4,
            )} action=fallback-seek`,
          );
          lastManualWrapAtRef.current = now;
          seek(activeLoop.start);
          track?.play();
        }, 60);
        return;
      }
      if (!queue) {
        stop();
      } else if (repeat === "track") {
        seek(0);
        track?.play();
      } else {
        let index = queue.current + 1;
        if (index >= queue.tracks.length) {
          // Repeat off just stop the playback
          if (repeat === "off") {
            stop();
            return;
          }
          index = 0;
        }
        let id: string;
        if (shuffle) {
          id = queue.tracks[queue.shuffled[index]];
        } else {
          id = queue.tracks[index];
        }
        if (id) {
          if (id === playbackTrack?.id) {
            // Playing the same track just restart it
            seek(0);
            track?.play();
          } else {
            // Play the next track
            const nextTrack = playlists.tracks[id];
            if (nextTrack) {
              play(nextTrack);
              dispatch(updateQueue(index));
            }
          }
        }
      }
    }
    track?.on("end", handleEnd);
    return () => {
      track?.off("end", handleEnd);
    };
  }, [logDebug, repeat, queue, shuffle, playbackTrack, playlists, play, seek, stop]);

  useEffect(() => {
    const duration = trackRef.current?.duration() || 0;
    activeLoopRef.current = resolveLoopRange(
      canonicalPlaybackTrack,
      duration,
      loopEnabled,
    );
    logDebug(
      `loop-range-update id=${canonicalPlaybackTrack?.id ?? "none"} loopEnabled=${loopEnabled} start=${
        canonicalPlaybackTrack?.loopStart ?? "n/a"
      } end=${canonicalPlaybackTrack?.loopEnd ?? "n/a"} resolved=${
        activeLoopRef.current
          ? `${activeLoopRef.current.start.toFixed(3)}-${activeLoopRef.current.end.toFixed(3)}`
          : "none"
      }`,
    );
    if (trackRef.current) {
      applyNativeLoopRegion(trackRef.current, duration, "state-update");
    }
  }, [applyNativeLoopRegion, canonicalPlaybackTrack, logDebug, loopEnabled, store]);

  useEffect(() => {
    if (!loopEnabled || !canonicalPlaybackTrack || hasTrackLoopPoints(canonicalPlaybackTrack)) {
      return;
    }
    if (loopScheduleTimerRef.current !== null) {
      window.clearTimeout(loopScheduleTimerRef.current);
    }
    loopScheduleTimerRef.current = window.setTimeout(() => {
      loopScheduleTimerRef.current = null;
      ensureTrackLoopPoints(canonicalPlaybackTrack);
    }, 900);
    return () => {
      if (loopScheduleTimerRef.current !== null) {
        window.clearTimeout(loopScheduleTimerRef.current);
        loopScheduleTimerRef.current = null;
      }
    };
  }, [canonicalPlaybackTrack, ensureTrackLoopPoints, loopEnabled]);

  useEffect(() => {
    return () => {
      if (loopScheduleTimerRef.current !== null) {
        window.clearTimeout(loopScheduleTimerRef.current);
        loopScheduleTimerRef.current = null;
      }
      if (fallbackEndTimerRef.current !== null) {
        window.clearTimeout(fallbackEndTimerRef.current);
        fallbackEndTimerRef.current = null;
      }
    };
  }, []);

  const pauseResume = useCallback((resume: boolean) => {
    if (trackRef.current) {
      if (resume) {
        trackRef.current.play();
      } else {
        trackRef.current.pause();
      }
    }
  }, []);

  const mute = useCallback((muted: boolean) => {
    if (trackRef.current) {
      trackRef.current.mute(muted);
    }
  }, []);

  const volume = useCallback((volume: number) => {
    if (trackRef.current) {
      trackRef.current.volume(volume);
    }
  }, []);

  return {
    seek,
    play,
    next,
    previous,
    stop,
    pauseResume,
    mute,
    volume,
  };
}
