import React, { useEffect, useState } from "react";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";

import { useDispatch } from "react-redux";
import { editTrack, Track } from "./playlistsSlice";
import { AudioSelector } from "../../common/AudioSelector";

type TrackSettingsProps = {
  track: Track;
  open: boolean;
  onClose: () => void;
};

export function TrackSettings({ track, open, onClose }: TrackSettingsProps) {
  const dispatch = useDispatch();
  const [loopStart, setLoopStart] = useState("");
  const [loopEnd, setLoopEnd] = useState("");
  const [loopSampleRate, setLoopSampleRate] = useState<number | undefined>(
    undefined,
  );
  const [loopBusy, setLoopBusy] = useState<"analyze" | "read" | "write" | null>(
    null,
  );
  const [loopError, setLoopError] = useState<string | null>(null);
  const [loopMessage, setLoopMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLoopStart(
      typeof track.loopStart === "number" ? track.loopStart.toFixed(3) : "",
    );
    setLoopEnd(typeof track.loopEnd === "number" ? track.loopEnd.toFixed(3) : "");
    setLoopBusy(null);
    setLoopError(null);
    setLoopMessage(null);
  }, [open, track.id, track.loopEnd, track.loopStart]);

  function handleTitleChange(event: React.ChangeEvent<HTMLInputElement>) {
    dispatch(editTrack({ id: track.id, title: event.target.value }));
  }

  function handleTitleStringChange(title: string) {
    dispatch(editTrack({ id: track.id, title }));
  }

  function handleURLChange(url: string) {
    dispatch(editTrack({ id: track.id, url }));
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

  function parseLoopRangeSeconds(): { start: number; end: number } {
    const start = Number.parseFloat(loopStart);
    const end = Number.parseFloat(loopEnd);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error("Loop start and end must be numbers in seconds.");
    }
    if (start < 0 || end <= 0) {
      throw new Error("Loop points must be positive values.");
    }
    if (end <= start) {
      throw new Error("Loop end must be greater than loop start.");
    }
    return { start, end };
  }

  async function ensureLoopSampleRate(trackPath: string): Promise<number> {
    if (loopSampleRate && loopSampleRate > 0) {
      return loopSampleRate;
    }

    const points = await window.player.getLoopPoints(trackPath);
    const sampleRate = points.sampleRate;
    if (!sampleRate || sampleRate <= 0) {
      throw new Error("Unable to determine track sample rate.");
    }
    setLoopSampleRate(sampleRate);
    return sampleRate;
  }

  async function handleAnalyzeLoopPoints() {
    const trackPath = resolveLocalTrackPath(track.url);
    if (!trackPath) {
      setLoopError("Loop analysis is only available for local audio files.");
      return;
    }

    setLoopBusy("analyze");
    setLoopError(null);
    setLoopMessage(null);
    try {
      const loopPoints = await window.player.getLoopPoints(trackPath);
      if (!loopPoints.sampleRate || loopPoints.sampleRate <= 0) {
        throw new Error("PyMusicLooper did not provide sample rate.");
      }
      const loopStartSeconds = loopPoints.start / loopPoints.sampleRate;
      const loopEndSeconds = loopPoints.end / loopPoints.sampleRate;
      setLoopSampleRate(loopPoints.sampleRate);
      setLoopStart(loopStartSeconds.toFixed(3));
      setLoopEnd(loopEndSeconds.toFixed(3));
      dispatch(
        editTrack({
          id: track.id,
          loopStart: loopStartSeconds,
          loopEnd: loopEndSeconds,
          loopSource: "analysis",
        }),
      );
      setLoopMessage("Loop points analyzed and applied.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to analyze loop points.";
      setLoopError(message);
    } finally {
      setLoopBusy(null);
    }
  }

  async function handleReadTags() {
    const trackPath = resolveLocalTrackPath(track.url);
    if (!trackPath) {
      setLoopError("Tag read is only available for local audio files.");
      return;
    }

    setLoopBusy("read");
    setLoopError(null);
    setLoopMessage(null);
    try {
      const tags = await window.player.readLoopTags(trackPath);
      if (
        typeof tags.start !== "number" ||
        typeof tags.end !== "number" ||
        !tags.sampleRate ||
        tags.sampleRate <= 0
      ) {
        throw new Error("Loop tags are missing or invalid for this file.");
      }
      const loopStartSeconds = tags.start / tags.sampleRate;
      const loopEndSeconds = tags.end / tags.sampleRate;
      setLoopSampleRate(tags.sampleRate);
      setLoopStart(loopStartSeconds.toFixed(3));
      setLoopEnd(loopEndSeconds.toFixed(3));
      dispatch(
        editTrack({
          id: track.id,
          loopStart: loopStartSeconds,
          loopEnd: loopEndSeconds,
          loopSource: "tags",
        }),
      );
      setLoopMessage("Loop tags read and applied.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to read loop tags.";
      setLoopError(message);
    } finally {
      setLoopBusy(null);
    }
  }

  function applyLoopRangeOnly() {
    try {
      const { start, end } = parseLoopRangeSeconds();
      dispatch(
        editTrack({
          id: track.id,
          loopStart: start,
          loopEnd: end,
          loopSource: "manual",
        }),
      );
      setLoopMessage("Manual loop range applied.");
      setLoopError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid manual loop range.";
      setLoopError(message);
      setLoopMessage(null);
    }
  }

  async function handleWriteTags() {
    const trackPath = resolveLocalTrackPath(track.url);
    if (!trackPath) {
      setLoopError("Tag write is only available for local audio files.");
      return;
    }

    setLoopBusy("write");
    setLoopError(null);
    setLoopMessage(null);
    try {
      const { start, end } = parseLoopRangeSeconds();
      const sampleRate = await ensureLoopSampleRate(trackPath);
      const startSamples = Math.max(0, Math.round(start * sampleRate));
      const endSamples = Math.max(startSamples + 1, Math.round(end * sampleRate));
      await window.player.writeLoopTags(trackPath, startSamples, endSamples);
      dispatch(
        editTrack({
          id: track.id,
          loopStart: start,
          loopEnd: end,
          loopSource: "manual",
        }),
      );
      setLoopMessage("Loop tags written successfully.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to write loop tags.";
      setLoopError(message);
    } finally {
      setLoopBusy(null);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      // Stop key events from propagating to prevent the track drag and drop from stealing the space bar
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <DialogTitle>Edit Track</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <AudioSelector
            value={track.url}
            onChange={handleURLChange}
            onFileName={handleTitleStringChange}
          />
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
            value={track.title}
            onChange={handleTitleChange}
          />
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Loop
          </Typography>
          <Stack direction="row" spacing={1.5}>
            <TextField
              margin="dense"
              label="Loop Start (sec)"
              fullWidth
              variant="standard"
              autoComplete="off"
              value={loopStart}
              onChange={(event) => setLoopStart(event.target.value)}
            />
            <TextField
              margin="dense"
              label="Loop End (sec)"
              fullWidth
              variant="standard"
              autoComplete="off"
              value={loopEnd}
              onChange={(event) => setLoopEnd(event.target.value)}
            />
          </Stack>
          <Box sx={{ mt: 1, display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button
              size="small"
              variant="outlined"
              onClick={handleAnalyzeLoopPoints}
              disabled={Boolean(loopBusy)}
            >
              {loopBusy === "analyze" ? "Analyzing..." : "Analyze"}
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={handleReadTags}
              disabled={Boolean(loopBusy)}
            >
              {loopBusy === "read" ? "Reading..." : "Read Tags"}
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={applyLoopRangeOnly}
              disabled={Boolean(loopBusy)}
            >
              Apply Loop
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={handleWriteTags}
              disabled={Boolean(loopBusy)}
            >
              {loopBusy === "write" ? "Writing..." : "Write Tags"}
            </Button>
          </Box>
          {track.loopSource && (
            <Typography
              variant="caption"
              color="rgba(255,255,255,0.8)"
              sx={{ display: "block", mt: 1 }}
            >
              Source: {track.loopSource}
            </Typography>
          )}
          {loopError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {loopError}
            </Alert>
          )}
          {loopMessage && (
            <Alert severity="success" sx={{ mt: 1.5 }}>
              {loopMessage}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button type="submit">Done</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
