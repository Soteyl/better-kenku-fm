import { createSlice, PayloadAction } from "@reduxjs/toolkit";

import { Track } from "./playlistsSlice";

export interface TrackClipboardState {
  track: Track | null;
}

const initialState: TrackClipboardState = {
  track: null,
};

export const trackClipboardSlice = createSlice({
  name: "trackClipboard",
  initialState,
  reducers: {
    copyTrackToClipboard: (state, action: PayloadAction<Track>) => {
      state.track = action.payload;
    },
    clearTrackClipboard: (state) => {
      state.track = null;
    },
  },
});

export const { copyTrackToClipboard, clearTrackClipboard } =
  trackClipboardSlice.actions;

export default trackClipboardSlice.reducer;
