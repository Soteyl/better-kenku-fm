import React, { useEffect, useState } from "react";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";

import { v4 as uuid } from "uuid";

import { useDispatch } from "react-redux";
import { addTrack } from "./playlistsSlice";
import { AudioSelector } from "../../common/AudioSelector";
import { addTrackToQueueIfNeeded } from "./playlistPlaybackSlice";
import { TrackSourceProgress } from "../../../types/player";

type TrackAddProps = {
  playlistId: string;
  open: boolean;
  onClose: () => void;
};

export function TrackAdd({ playlistId, open, onClose }: TrackAddProps) {
  const dispatch = useDispatch();

  const [title, setTitle] = useState("");
  const [url, setURL] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TrackSourceProgress | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setURL("");
      setError(null);
      setLoading(false);
      setProgress(null);
      setRequestId(null);
    }
  }, [open]);

  useEffect(() => {
    const handleProgress = (args: any[]) => {
      const [incomingRequestId, incomingProgress] = args as [
        string,
        TrackSourceProgress,
      ];
      if (incomingRequestId && incomingRequestId === requestId) {
        setProgress((prev) => {
          if (!prev) {
            return incomingProgress;
          }

          const prevValue =
            typeof prev.progress === "number" ? prev.progress : undefined;
          const incomingValue =
            typeof incomingProgress.progress === "number"
              ? incomingProgress.progress
              : undefined;

          // Prevent visual regressions caused by out-of-order progress events.
          if (
            typeof prevValue === "number" &&
            typeof incomingValue === "number" &&
            incomingValue < prevValue
          ) {
            return {
              ...incomingProgress,
              progress: prevValue,
            };
          }

          if (
            typeof prevValue === "number" &&
            incomingValue === undefined &&
            incomingProgress.stage === "download-audio"
          ) {
            return {
              ...incomingProgress,
              progress: prevValue,
            };
          }

          return incomingProgress;
        });
      }
    };

    window.player.on("PLAYER_RESOLVE_TRACK_SOURCE_PROGRESS", handleProgress);
    return () => {
      window.player.removeAllListeners("PLAYER_RESOLVE_TRACK_SOURCE_PROGRESS");
    };
  }, [requestId]);

  function handleTitleChange(event: React.ChangeEvent<HTMLInputElement>) {
    setTitle(event.target.value);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const id = uuid();
    setRequestId(id);
    setProgress({
      stage: "prepare",
      message: "Preparing import pipeline...",
      progress: 5,
    });

    try {
      const resolved = await window.player.resolveTrackSource(url, playlistId, id);
      const trackId = uuid();
      const trackTitle = title || resolved.title || "Track";
      dispatch(
        addTrack({
          track: { id: trackId, title: trackTitle, url: resolved.url },
          playlistId,
        }),
      );
      dispatch(addTrackToQueueIfNeeded({ playlistId, trackId }));
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to add track source";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Add Track</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <AudioSelector value={url} onChange={setURL} onFileName={setTitle} />
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
          {loading && progress && (
            <Box
              sx={{
                mt: 2,
                p: 1.5,
                borderRadius: 1,
                backgroundColor: "rgba(255, 255, 255, 0.04)",
              }}
            >
              <Typography variant="body2" sx={{ mb: 1 }}>
                {progress.message}
              </Typography>
              <LinearProgress
                variant={
                  typeof progress.progress === "number"
                    ? "determinate"
                    : "indeterminate"
                }
                value={progress.progress}
              />
              <Typography
                variant="caption"
                color="rgba(255,255,255,0.75)"
                sx={{ display: "block", mt: 1 }}
              >
                Stage: {progress.stage}
                {typeof progress.progress === "number"
                  ? ` (${progress.progress}%)`
                  : ""}
              </Typography>
            </Box>
          )}
          <TextField
            margin="dense"
            id="name"
            label="Name"
            fullWidth
            variant="standard"
            autoComplete="off"
            InputLabelProps={{
              shrink: true,
            }}
            value={title}
            onChange={handleTitleChange}
            disabled={loading}
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={loading} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!url || loading} type="submit">
            {loading ? "Working..." : "Add"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
