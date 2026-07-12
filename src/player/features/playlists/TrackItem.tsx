import React, { useState } from "react";
import Box from "@mui/material/Box";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import PlayArrow from "@mui/icons-material/PlayArrowRounded";
import Pause from "@mui/icons-material/PauseRounded";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";

import MoreVert from "@mui/icons-material/MoreVertRounded";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";

import { backgrounds, isBackground } from "../../backgrounds";
import { Track, removeTrack, Playlist } from "./playlistsSlice";
import { useDispatch, useSelector } from "react-redux";
import { TrackSettings } from "./TrackSettings";
import { RootState } from "../../app/store";
import {
  playPause,
  removeTrackFromQueue,
  startQueue,
  stopTrack,
  updatePlayback,
} from "./playlistPlaybackSlice";

type TrackItemProps = {
  track: Track;
  playlist: Playlist;
  onPlay: (id: string) => void;
};

export function TrackItem({ track, playlist, onPlay }: TrackItemProps) {
  const isCurrentTrack = useSelector(
    (state: RootState) => state.playlistPlayback.track?.id === track.id,
  );
  const playing = useSelector(
    (state: RootState) => state.playlistPlayback.playing && isCurrentTrack,
  );
  const dispatch = useDispatch();

  const [settingsOpen, setSettingsOpen] = useState(false);

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);
  function handleMenuClick(event: React.MouseEvent<HTMLButtonElement>) {
    setAnchorEl(event.currentTarget);
  }
  function handleMenuClose() {
    setAnchorEl(null);
  }

  function handleEdit() {
    setSettingsOpen(true);
    handleMenuClose();
  }

  function handleCopyID() {
    navigator.clipboard.writeText(track.id);
    handleMenuClose();
  }

  function handleDelete() {
    // TODO: Fix bug where playback does not update to zero when isCurrentTrack is removed
    if (isCurrentTrack) {
      dispatch(playPause(false));
      dispatch(stopTrack());
    }
    dispatch(removeTrack({ trackId: track.id, playlistId: playlist.id }));
    dispatch(
      removeTrackFromQueue({ trackId: track.id, playlistId: playlist.id }),
    );
    handleMenuClose();
  }

  function handlePlayPause() {
    if (isCurrentTrack) {
      dispatch(playPause(!playing));
    } else {
      onPlay(track.id);
    }
  }

  const image = track.background
    ? isBackground(track.background)
      ? backgrounds[track.background]
      : track.background
    : undefined;

  return (
    <ListItem key={track.id} disablePadding>
      <Paper
        sx={{
          position: "relative",
          minWidth: 0,
          width: "100%",
          height: 96,
          m: 0.5,
          borderRadius: "16px",
          overflow: "hidden",
          backgroundColor: "rgba(34, 38, 57, 0.8)",
          backgroundImage: image ? `url("${image}")` : undefined,
          backgroundSize: "cover",
          backgroundPosition: `center ${track.backgroundPosition ?? 50}%`,
          outline: isCurrentTrack ? "2px solid" : "none",
          outlineColor: "primary.main",
          outlineOffset: "-2px",
        }}
      >
        {/* Darkening gradient toward the bottom for text legibility */}
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backgroundImage:
              "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0) 100%)",
          }}
        />
        <ListItemButton
          role={undefined}
          sx={{
            position: "relative",
            height: "100%",
            alignItems: "flex-end",
            borderRadius: "16px",
            p: 1.5,
          }}
          dense
        >
          <ListItemText
            primary={track.title}
            sx={{
              m: 0,
              zIndex: 1,
              ".MuiListItemText-primary": {
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                textShadow: "0 1px 3px rgba(0,0,0,0.9)",
              },
            }}
            primaryTypographyProps={{
              typography: "body1",
            }}
          />
        </ListItemButton>
        {/* Playback controls stay visible above the artwork */}
        <Box
          sx={{
            position: "absolute",
            top: 4,
            right: 4,
            zIndex: 2,
            display: "flex",
            borderRadius: "20px",
            backgroundColor: "rgba(0, 0, 0, 0.35)",
          }}
        >
          <IconButton
            aria-label={playing ? "pause" : "play"}
            onClick={handlePlayPause}
            sx={{ color: "#fff" }}
          >
            {playing ? <Pause /> : <PlayArrow />}
          </IconButton>
          <IconButton onClick={handleMenuClick} sx={{ color: "#fff" }}>
            <MoreVert />
          </IconButton>
        </Box>
      </Paper>
      <Menu
        id="playlist-menu"
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={handleMenuClose}
        slotProps={{ list: { "aria-labelledby": "more-button" } }}
      >
        <MenuItem onClick={handleEdit}>Edit</MenuItem>
        <MenuItem onClick={handleCopyID}>Copy ID</MenuItem>
        <MenuItem onClick={handleDelete}>Delete</MenuItem>
      </Menu>
      <TrackSettings
        track={track}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </ListItem>
  );
}
