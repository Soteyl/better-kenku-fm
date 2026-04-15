import React, { useCallback } from "react";

import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { Link } from "@mui/material";

import {
  getDropURL,
  encodeFilePath,
  cleanFileName,
} from "../../renderer/common/drop";
import useFileDrop, { FileInfo } from "./useFileDrop";

type AudioSelectorProps = {
  value: string;
  onChange: (value: string) => void;
  onFileName: (name: string) => void;
};

const formats = ["mp3", "flac", "wav", "ogg", "mp4", "3gp", "webm", "mpeg"];

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

export function AudioSelector({
  value,
  onChange,
  onFileName,
}: AudioSelectorProps) {
  function handleURLChange(event: React.ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value);
  }

  function handleURLDrop(event: React.DragEvent<HTMLInputElement>) {
    event.preventDefault();
    const url = getDropURL(event.dataTransfer);
    if (url) {
      onChange(url);
    }
  }

  const onDrop = useCallback((acceptedFiles: FileInfo[]) => {
    const file = acceptedFiles[0];
    if (file) {
      onChange(encodeFilePath(file.path));
      onFileName(cleanFileName(file.name));
    }
  }, []);

  const { rootProps, inputProps, isDragging } = useFileDrop({
    onDrop,
    accept: "audio/*",
    multiple: false,
  });

  const youtube = Boolean(value) && isYoutubeURL(value);
  const warning =
    Boolean(value) &&
    !youtube &&
    !formats.some((format) => value.toLowerCase().endsWith(format));

  return (
    <>
      <TextField
        autoFocus
        margin="dense"
        id="url"
        label="Source"
        placeholder="Enter a URL or select a track below"
        fullWidth
        variant="standard"
        autoComplete="off"
        InputLabelProps={{
          shrink: true,
        }}
        value={value}
        onChange={handleURLChange}
        onDrop={handleURLDrop}
        color={warning ? "warning" : undefined}
        helperText={
          youtube ? (
            <>
              YouTube link detected. Kenku will try to download audio from this
              video using bundled yt-dlp/ffmpeg tools.
            </>
          ) : warning ? (
            <>
              Unable to verify audio format, this file may not be supported. See{" "}
              <Link
                href="https://www.kenku.fm/docs/using-kenku-player"
                target="_blank"
                rel="noopener noreferrer"
              >
                here
              </Link>{" "}
              for more information.
            </>
          ) : undefined
        }
      />
      <Button
        sx={{
          p: 2,
          borderStyle: "dashed",
          my: 1,
        }}
        variant="outlined"
        fullWidth
        {...rootProps}
      >
        <input {...inputProps} />
        {isDragging ? (
          <Typography variant="caption">Drop the track here...</Typography>
        ) : (
          <Typography variant="caption">
            Drag and drop or click to select a track
          </Typography>
        )}
      </Button>
    </>
  );
}
