import React, { useState } from "react";

import styled from "@mui/material/styles/styled";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Slider from "@mui/material/Slider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Pause from "@mui/icons-material/PauseRounded";
import PlayArrow from "@mui/icons-material/PlayArrowRounded";
import VolumeDown from "@mui/icons-material/VolumeDownRounded";
import VolumeOff from "@mui/icons-material/VolumeOffRounded";
import VolumeUp from "@mui/icons-material/VolumeUp";
import RepeatIcon from "@mui/icons-material/RepeatRounded";
import RepeatOne from "@mui/icons-material/RepeatOneRounded";
import Shuffle from "@mui/icons-material/ShuffleRounded";
import Loop from "@mui/icons-material/AllInclusiveRounded";
import Next from "@mui/icons-material/SkipNextRounded";
import Previous from "@mui/icons-material/SkipPreviousRounded";
import useMediaQuery from "@mui/material/useMediaQuery";
import Tooltip from "@mui/material/Tooltip";

import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../app/store";
import {
  adjustVolume,
  playPause,
  mute,
  shuffle,
  repeat,
  setLoopEnabled,
} from "../playlists/playlistPlaybackSlice";

const minWidthForLargeContext = 650;

const TimeSlider = styled(Slider)({
  color: "#fff",
  height: 4,
  "& .MuiSlider-thumb": {
    width: 8,
    height: 8,
    "&:before": {
      boxShadow: "0 2px 12px 0 rgba(0,0,0,0.4)",
    },
    "&:hover, &.Mui-focusVisible": {
      boxShadow: "0px 0px 0px 8px rgb(255 255 255 / 16%)",
    },
    "&.Mui-active": {
      width: 20,
      height: 20,
    },
  },
  "& .MuiSlider-rail": {
    opacity: 0.28,
  },
});

const VolumeSlider = styled(Slider)({
  color: "#fff",
  "& .MuiSlider-track": {
    border: "none",
  },
  "& .MuiSlider-thumb": {
    width: 24,
    height: 24,
    backgroundColor: "#fff",
    "&:hover, &.Mui-focusVisible, &.Mui-active": {
      boxShadow: "0 4px 8px rgba(0,0,0,0.4)",
    },
  },
});

const TinyText = styled(Typography)({
  fontSize: "0.75rem",
  opacity: 0.38,
  fontWeight: 500,
  letterSpacing: 0.2,
});

type PlaylistPlayerProps = {
  onPlaylistNext: () => void;
  onPlaylistPrevious: () => void;
  onPlaylistSeek: (to: number) => void;
};

function Title() {
  const playlists = useSelector((state: RootState) => state.playlists);
  const queue = useSelector((state: RootState) => state.playlistPlayback.queue);
  const track = useSelector((state: RootState) => state.playlistPlayback.track);
  const noTrack = track?.title === undefined;
  const large = useMediaQuery(`(min-width: ${minWidthForLargeContext}px)`);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: large ? "30%" : "100%",
        flexDirection: "column",
      }}
    >
      <Typography
        variant="body2"
        sx={{ width: "100%", textAlign: large ? undefined : "center" }}
        noWrap
        gutterBottom
      >
        {noTrack ? "" : track.title}
      </Typography>
      <Typography
        variant="caption"
        color="rgba(255, 255, 255, 0.8)"
        sx={{ width: "100%", textAlign: large ? undefined : "center" }}
        noWrap
      >
        {noTrack ? "" : playlists.playlists.byId[queue.playlistId]?.title}
      </Typography>
    </Box>
  );
}

function Controls({
  onPlaylistPrevious,
  onPlaylistNext,
}: Omit<PlaylistPlayerProps, "onPlaylistSeek">) {
  const dispatch = useDispatch();
  const playbackShuffle = useSelector(
    (state: RootState) => state.playlistPlayback.shuffle,
  );
  const disabled = useSelector(
    (state: RootState) => !Boolean(state.playlistPlayback.playback),
  );
  const playing = useSelector(
    (state: RootState) => state.playlistPlayback.playing,
  );
  const playbackRepeat = useSelector(
    (state: RootState) => state.playlistPlayback.repeat,
  );
  const loopEnabled = useSelector(
    (state: RootState) => state.playlistPlayback.loopEnabled,
  );
  const duration = useSelector(
    (state: RootState) => state.playlistPlayback.playback?.duration ?? 0,
  );
  const loopDisabledByDuration = duration > 30 * 60;

  function handlePlay() {
    dispatch(playPause(!playing));
  }

  function handlRepeat() {
    switch (playbackRepeat) {
      case "off":
        dispatch(repeat("playlist"));
        break;
      case "playlist":
        dispatch(repeat("track"));
        break;
      case "track":
        dispatch(repeat("off"));
        break;
    }
  }

  function handleShuffle() {
    const newShuffle = !playbackShuffle;
    dispatch(shuffle(newShuffle));
  }

  function handleLoopToggle() {
    dispatch(setLoopEnabled(!loopEnabled));
  }

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        mt: -1,
        flexGrow: 1,
      }}
    >
      <IconButton aria-label="shuffle" onClick={handleShuffle}>
        <Shuffle color={playbackShuffle ? "primary" : undefined} />
      </IconButton>
      <IconButton
        disabled={disabled}
        aria-label="previous"
        onClick={() => onPlaylistPrevious()}
      >
        <Previous />
      </IconButton>
      <IconButton
        aria-label={playing ? "pause" : "play"}
        onClick={handlePlay}
        disabled={disabled}
      >
        {playing ? (
          <Pause sx={{ fontSize: "3rem" }} />
        ) : (
          <PlayArrow sx={{ fontSize: "3rem" }} />
        )}
      </IconButton>
      <IconButton
        disabled={disabled}
        aria-label="next"
        onClick={() => onPlaylistNext()}
      >
        <Next />
      </IconButton>
      <Tooltip
        title={
          loopDisabledByDuration
            ? "Loop is unavailable for tracks longer than 30 minutes"
            : ""
        }
      >
        <span>
          <IconButton
            aria-label={loopEnabled ? "loop enabled" : "loop disabled"}
            onClick={handleLoopToggle}
            disabled={loopDisabledByDuration}
          >
            <Loop color={loopEnabled && !loopDisabledByDuration ? "primary" : undefined} />
          </IconButton>
        </span>
      </Tooltip>
      <IconButton aria-label={`repeat ${playbackRepeat}`} onClick={handlRepeat}>
        {playbackRepeat === "off" ? (
          <RepeatIcon />
        ) : playbackRepeat === "playlist" ? (
          <RepeatIcon color="primary" />
        ) : (
          <RepeatOne color="primary" />
        )}
      </IconButton>
    </Box>
  );
}

function Volume() {
  const dispatch = useDispatch();
  const large = useMediaQuery(`(min-width: ${minWidthForLargeContext}px)`);

  const muted = useSelector((state: RootState) => state.playlistPlayback.muted);
  const volume = useSelector(
    (state: RootState) => state.playlistPlayback.volume,
  );

  function handleVolumeChange(_: Event, value: number | number[]) {
    dispatch(adjustVolume(value as number));
    // TODO: handle value isArray
    if (muted) {
      if (!Array.isArray(value) && value > 0) {
        dispatch(mute(false));
      }
    }
  }

  function handleMute() {
    dispatch(mute(!muted));
  }

  return (
    <Stack
      spacing={2}
      direction="row"
      sx={{ mb: 1, px: 1, width: large ? "30%" : "100%" }}
      alignItems="center"
    >
      <IconButton aria-label={muted ? "unmute" : "mute"} onClick={handleMute}>
        {muted ? <VolumeOff /> : <VolumeDown />}
      </IconButton>
      <VolumeSlider
        aria-label="Volume"
        value={muted ? 0 : volume}
        step={0.01}
        min={0}
        max={1}
        onChange={handleVolumeChange}
      />
      {!large && (
        <Box px={2} height="24px">
          <VolumeUp sx={{ color: "rgba(255,255,255,0.4)" }} />
        </Box>
      )}
    </Stack>
  );
}

function Time({ onPlaylistSeek }: Pick<PlaylistPlayerProps, "onPlaylistSeek">) {
  const playback = useSelector(
    (state: RootState) => state.playlistPlayback.playback,
  );
  const loopEnabled = useSelector(
    (state: RootState) => state.playlistPlayback.loopEnabled,
  );
  const playlists = useSelector((state: RootState) => state.playlists);
  const playbackTrack = useSelector(
    (state: RootState) => state.playlistPlayback.track,
  );
  const track = playbackTrack?.id
    ? playlists.tracks[playbackTrack.id] || playbackTrack
    : undefined;

  function formatDuration(value: number) {
    const minute = Math.floor(value / 60);
    const secondLeft = value - minute * 60;
    return `${minute}:${secondLeft < 10 ? `0${secondLeft}` : secondLeft}`;
  }

  // Override the time slider when changing the value
  const [timeOverride, setTimeOverride] = useState<number | null>(null);
  // Commit the time value when letting go of the slider
  function handleTimeChange(_: Event, value: number | number[]) {
    setTimeOverride(null);
    onPlaylistSeek(value as number);
  }

  const time = timeOverride === null ? playback?.progress || 0 : timeOverride;
  const duration = playback?.duration || 0;
  const hasLoopPoints =
    Boolean(track) &&
    typeof track?.loopStart === "number" &&
    typeof track?.loopEnd === "number" &&
    track.loopEnd > track.loopStart &&
    duration > 0;
  const loopStart = hasLoopPoints
    ? Math.max(0, Math.min(duration, track?.loopStart ?? 0))
    : 0;
  const loopEnd = hasLoopPoints
    ? Math.max(0, Math.min(duration, track?.loopEnd ?? 0))
    : 0;
  const loopStartPercent = hasLoopPoints ? (loopStart / duration) * 100 : 0;
  const loopWidthPercent = hasLoopPoints
    ? ((loopEnd - loopStart) / duration) * 100
    : 0;
  const showLoopPreview = loopEnabled && hasLoopPoints;
  const loopAnalysisPending = track?.loopAnalysisState === "pending";
  const loopAnalysisError =
    track?.loopAnalysisState === "error" ? track?.loopAnalysisError : undefined;

  return (
    <Box sx={{ position: "relative" }}>
      {showLoopPreview && (
        <Box
          sx={{
            position: "absolute",
            left: `${loopStartPercent}%`,
            top: 6,
            width: `${loopWidthPercent}%`,
            height: 4,
            borderRadius: 999,
            backgroundColor: "rgba(76, 175, 80, 0.55)",
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      )}
      {showLoopPreview && (
        <>
          <Box
            sx={{
              position: "absolute",
              left: `calc(${loopStartPercent}% - 1px)`,
              top: 2,
              width: 2,
              height: 12,
              borderRadius: 1,
              backgroundColor: "rgba(76, 175, 80, 0.95)",
              pointerEvents: "none",
              zIndex: 2,
            }}
          />
          <Box
            sx={{
              position: "absolute",
              left: `calc(${loopStartPercent + loopWidthPercent}% - 1px)`,
              top: 2,
              width: 2,
              height: 12,
              borderRadius: 1,
              backgroundColor: "rgba(76, 175, 80, 0.95)",
              pointerEvents: "none",
              zIndex: 2,
            }}
          />
        </>
      )}
      <TimeSlider
        aria-label="time-indicator"
        size="small"
        value={time}
        min={0}
        step={1}
        max={duration}
        disabled={!Boolean(playback)}
        onChange={(_, value) => setTimeOverride(value as number)}
        onChangeCommitted={handleTimeChange}
      />
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mt: -2,
        }}
      >
        <TinyText>{formatDuration(time)}</TinyText>
        <TinyText>-{formatDuration(duration - time)}</TinyText>
      </Box>
      {loopEnabled && loopAnalysisPending && (
        <Typography
          variant="caption"
          sx={{ display: "block", mt: 0.5, color: "rgba(76, 175, 80, 0.95)" }}
        >
          Analyzing loop...
        </Typography>
      )}
      {loopEnabled && !loopAnalysisPending && loopAnalysisError && (
        <Typography
          variant="caption"
          sx={{ display: "block", mt: 0.5, color: "rgba(255, 145, 0, 0.95)" }}
        >
          Loop analysis failed
        </Typography>
      )}
    </Box>
  );
}

export function PlaylistPlayer({
  onPlaylistNext,
  onPlaylistPrevious,
  onPlaylistSeek,
}: PlaylistPlayerProps) {
  const large = useMediaQuery(`(min-width: ${minWidthForLargeContext}px)`);

  if (large) {
    return (
      <>
        <Stack direction="row">
          <Title />
          <Controls
            onPlaylistNext={onPlaylistNext}
            onPlaylistPrevious={onPlaylistPrevious}
          />
          <Volume />
        </Stack>
        <Time onPlaylistSeek={onPlaylistSeek} />
      </>
    );
  } else {
    return (
      <>
        <Title />
        <Time onPlaylistSeek={onPlaylistSeek} />
        <Controls
          onPlaylistNext={onPlaylistNext}
          onPlaylistPrevious={onPlaylistPrevious}
        />
        <Volume />
      </>
    );
  }
}
