import { combineReducers, configureStore } from "@reduxjs/toolkit";
import playlistsReducer from "../features/playlists/playlistsSlice";
import soundboardsReducer from "../features/soundboards/soundboardsSlice";
import playlsitPlaybackReducer from "../features/playlists/playlistPlaybackSlice";
import soundboardPlaybackReducer from "../features/soundboards/soundboardPlaybackSlice";

import {
  persistStore,
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from "redux-persist";
import storage from "redux-persist/lib/storage";

const playbackPersistConfig = {
  key: "playback",
  version: 1,
  storage,
  whitelist: ["volume", "muted", "shuffle", "repeat", "loopEnabled"],
};

const rootReducer = combineReducers({
  playlists: playlistsReducer,
  soundboards: soundboardsReducer,
  playlistPlayback: persistReducer(
    playbackPersistConfig,
    playlsitPlaybackReducer
  ),
  soundboardPlayback: soundboardPlaybackReducer,
});

const persistConfig = {
  key: "player",
  version: 2,
  storage,
  whitelist: ["playlists", "soundboards"],
  migrate: (state: any) => {
    if (!state) return Promise.resolve(state);
    const tracks = state?.playlists?.tracks;
    if (tracks && typeof tracks === "object") {
      const cleaned: Record<string, any> = {};
      for (const [id, track] of Object.entries(tracks) as [string, any][]) {
        cleaned[id] = {
          ...track,
          loopAnalysisState: undefined,
          loopAnalysisError: undefined,
        };
      }
      return Promise.resolve({
        ...state,
        playlists: { ...state.playlists, tracks: cleaned },
      });
    }
    return Promise.resolve(state);
  },
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
