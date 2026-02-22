import React, { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import { v4 as uuid } from "uuid";

import { useDispatch } from "react-redux";
import { addBookmark } from "./bookmarksSlice";

import { getDropURL } from "../../common/drop";
import { showWindowControls } from "../../common/showWindowControls";

type AddBookmarkProps = {
  open: boolean;
  onClose: () => void;
};

export function AddBookmark({ open, onClose }: AddBookmarkProps) {
  const dispatch = useDispatch();

  const [url, setURL] = useState("");
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (!open) {
      setURL("");
      setTitle("");
    }
  }, [open]);

  function handleURLChange(event: React.ChangeEvent<HTMLInputElement>) {
    setURL(event.target.value);
  }

  function handleURLDrop(event: React.DragEvent<HTMLInputElement>) {
    event.preventDefault();
    const droppedURL = getDropURL(event.dataTransfer);
    if (droppedURL) {
      setURL(droppedURL);
    }
  }

  function handleTitleChange(event: React.ChangeEvent<HTMLInputElement>) {
    setTitle(event.target.value);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const id = uuid();
    dispatch(addBookmark({ id, url, title, icon: "" }));
    onClose();
  }

  return (
    <Dialog
      fullScreen
      sx={{ width: 240 }}
      open={open}
      onClose={onClose}
      // Stop key events from propagating to prevent the track drag and drop from stealing the space bar
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <DialogTitle
        sx={{
          textAlign: showWindowControls ? "left" : "right",
          py: showWindowControls ? 2 : 1.5,
        }}
      >
        Add Bookmark
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            id="url"
            label="URL"
            fullWidth
            variant="standard"
            autoComplete="off"
            InputLabelProps={{
              shrink: true,
            }}
            value={url}
            onChange={handleURLChange}
            onDrop={handleURLDrop}
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
            value={title}
            onChange={handleTitleChange}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2, justifyContent: "space-between" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={!url} type="submit">
            Add
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
