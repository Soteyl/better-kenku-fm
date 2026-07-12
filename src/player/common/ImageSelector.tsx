import React, { useCallback, useEffect, useRef, useState } from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormGroup from "@mui/material/FormGroup";
import IconButton from "@mui/material/IconButton";
import ImageList from "@mui/material/ImageList";
import ImageListItem from "@mui/material/ImageListItem";
import Input from "@mui/material/Input";
import InputLabel from "@mui/material/InputLabel";
import styled from "@mui/material/styles/styled";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";


import { encodeFilePath, getDropURL } from "../../renderer/common/drop";
import { backgrounds } from "../backgrounds";
import useFileDrop, { FileInfo } from "./useFileDrop";

const ImageListButton = styled("img")({
  userSelect: "none",
  objectFit: "cover",
  width: "100%",
  height: "100%",
  borderRadius: "16px",
});

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

type ImageSelectorProps = {
  value: string;
  onChange: (value: string) => void;
  customOnly?: boolean;
  position?: number;
  onPositionChange?: (value: number) => void;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function ImageSelector({
  value,
  onChange,
  customOnly = false,
  position = 50,
  onPositionChange,
}: ImageSelectorProps) {
  const hasCustomImage = value.startsWith("file") || value.startsWith("http");
  const [imageType, setImageType] = useState(
    customOnly || hasCustomImage ? "custom" : "default"
  );

  // Drag-to-reposition state for the track-shaped preview
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startPos: number; height: number }>({
    startY: 0,
    startPos: position,
    height: 96,
  });

  function handlePositionPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!onPositionChange) {
      return;
    }
    event.preventDefault();
    dragRef.current = {
      startY: event.clientY,
      startPos: position,
      height: event.currentTarget.getBoundingClientRect().height || 96,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function handlePositionPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !onPositionChange) {
      return;
    }
    const { startY, startPos, height } = dragRef.current;
    const deltaY = event.clientY - startY;
    // Dragging up reveals the lower part of the image → position increases
    const next = clamp(startPos - (deltaY / height) * 100, 0, 100);
    onPositionChange(Math.round(next));
  }

  function handlePositionPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }

  const onDrop = useCallback((acceptedFiles: FileInfo[]) => {
    const file = acceptedFiles[0];
    if (file) {
      onChange(encodeFilePath(file.path));
    }
  }, []);

  // Handle pasting an image (Ctrl/Cmd+V) while this selector is mounted
  useEffect(() => {
    async function handlePaste(event: ClipboardEvent) {
      const clipboard = event.clipboardData;
      if (!clipboard) {
        return;
      }

      // A file copied from the OS file manager keeps a filesystem path
      const pastedFile = clipboard.files[0];
      if (pastedFile && pastedFile.type.startsWith("image/")) {
        event.preventDefault();
        const path = window.player.getPathForFile(pastedFile);
        if (path) {
          onChange(encodeFilePath(path));
          setImageType("custom");
          return;
        }
      }

      // Raw image data (e.g. a screenshot) has no path, so persist it to disk
      const imageItem = Array.from(clipboard.items).find((item) =>
        item.type.startsWith("image/")
      );
      if (imageItem) {
        event.preventDefault();
        const blob = imageItem.getAsFile();
        if (!blob) {
          return;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const ext = MIME_EXTENSIONS[blob.type] ?? "png";
        const savedPath = await window.player.saveImageData(bytes, ext);
        onChange(encodeFilePath(savedPath));
        setImageType("custom");
      }
    }

    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("paste", handlePaste);
    };
  }, [onChange]);

  const { rootProps, inputProps, isDragging } = useFileDrop({
    onDrop,
    accept: "image/*",
    multiple: false,
  });

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

  const imageSelector = (
    <ImageList variant="masonry" cols={3} gap={8} sx={{ m: 0 }}>
      {Object.entries(backgrounds).map(([key, src]) => (
        <ImageListItem key={key}>
          <ImageListButton src={src} alt={key} loading="lazy" />
          <IconButton
            aria-label={key}
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              borderRadius: "16px",
              borderStyle: value === key ? "solid" : "none",
              borderWidth: "2px",
              borderColor: "primary.main",
            }}
            onClick={() => onChange(key)}
          />
        </ImageListItem>
      ))}
    </ImageList>
  );

  const imageImporter = (
    <Box my={2}>
      <Input
        autoFocus
        margin="dense"
        id="url"
        aria-label="source"
        placeholder="Enter a URL or select an image below"
        fullWidth
        autoComplete="off"
        value={value}
        onChange={handleURLChange}
        onDrop={handleURLDrop}
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
          <Typography variant="caption">Drop the image here...</Typography>
        ) : (
          <Typography variant="caption">
            Drag &amp; drop, click, or paste (Ctrl/Cmd+V) an image
          </Typography>
        )}
      </Button>
      {hasCustomImage &&
        (onPositionChange ? (
          <Box>
            <Box
              onPointerDown={handlePositionPointerDown}
              onPointerMove={handlePositionPointerMove}
              onPointerUp={handlePositionPointerUp}
              onPointerCancel={handlePositionPointerUp}
              sx={{
                position: "relative",
                width: "100%",
                height: "96px",
                borderRadius: "16px",
                overflow: "hidden",
                touchAction: "none",
                userSelect: "none",
                cursor: dragging ? "grabbing" : "grab",
                backgroundColor: "rgba(34, 38, 57, 0.8)",
                backgroundImage: `url("${value}")`,
                backgroundSize: "cover",
                backgroundPosition: `center ${position}%`,
              }}
            >
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  backgroundImage:
                    "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0) 100%)",
                }}
              />
              <Typography
                variant="body1"
                sx={{
                  position: "absolute",
                  left: 12,
                  bottom: 8,
                  right: 12,
                  pointerEvents: "none",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textShadow: "0 1px 3px rgba(0,0,0,0.9)",
                }}
              >
                Track title
              </Typography>
            </Box>
            <Typography
              variant="caption"
              sx={{ display: "block", mt: 0.5, opacity: 0.7 }}
            >
              Drag the image up or down to reposition
            </Typography>
          </Box>
        ) : (
          <ImageListButton src={value} alt="preview" />
        ))}
    </Box>
  );

  return (
    <FormGroup sx={{ my: 1 }}>
      <InputLabel id="bg-image" shrink>
        Background Image
      </InputLabel>
      {!customOnly && (
        <ToggleButtonGroup
          color="primary"
          value={imageType}
          exclusive
          fullWidth
          size="small"
          onChange={(_, value) => {
            if (value) {
              onChange("");
              setImageType(value);
            }
          }}
          aria-labelledby="bg-image"
        >
          <ToggleButton value="default">Default</ToggleButton>
          <ToggleButton value="custom">Custom</ToggleButton>
        </ToggleButtonGroup>
      )}
      <Box
        sx={{
          maxWidth: 500,
          width: "100%",
          height: "200px",
          bgcolor: "rgba(0, 0, 0, 0.16)",
          borderRadius: "16px",
          p: 1,
          pr: 0,
          mt: 1,
        }}
      >
        <Box sx={{ overflowY: "scroll", height: "100%" }}>
          {!customOnly && imageType === "default" ? imageSelector : imageImporter}
        </Box>
      </Box>
    </FormGroup>
  );
}
