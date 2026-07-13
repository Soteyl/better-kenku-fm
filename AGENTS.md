# AGENTS.md

## Project overview

**kenku-fm** is a music management app for a Telegram bot, used to run audio during
tabletop role-playing games (TTRPG). It is a fork of the original
[kenku-fm](https://github.com/owlbear-rodeo/kenku-fm). The app is built on
**Electron + React + Redux Toolkit**, and audio playback is handled with **Howler.js**.

The game master manages playlists and soundboards (background music, ambience, sound
effects), and audio is streamed into a voice channel (for Telegram/Discord).

## Key fork features (differences from upstream)

- **Bundled PyMusicLooper** — the tool for loop-point analysis and reading/writing loop
  tags ships inside the build (it is not downloaded at runtime). See
  `docs/HANDOFF_PYMUSICLOOPER_PARITY_LOOPING.md`.
- **Seamless loop points** — gapless looping of a track between `loopStart`/`loopEnd`
  (manual-wrap in the animation loop + a fallback on the `end` event). Point sources:
  `analysis` (PyMusicLooper), `tags`, `manual`.
- **Per-track background images** — each track can have its own background image with
  drag-to-position support (`background`, `backgroundPosition`).
- **Loop disabled for long tracks** — looping is automatically unavailable for tracks
  longer than 30 minutes.

## Structure

- `src/main/` — Electron main process (managers, remote API, tool integration).
  - `src/main/managers/OptionalToolManager.ts` — PyMusicLooper calls (`getLoopPoints`, `readLoopTags`, `writeLoopTags`).
  - `src/main/remote/routes/` — HTTP remote API for network control.
- `src/player/` — renderer (player UI, Redux state, playback engine).
  - `src/player/features/playlists/usePlaylistPlayback.ts` — **heart of the playback/repeat/loop logic** (Howler.js).
  - `src/player/features/playlists/playlistPlaybackSlice.ts` — playback Redux state (`repeat`, `loopEnabled`, `queue`, etc.).
  - `src/player/features/playlists/PlaylistPlaybackSync.tsx` — syncs Redux → Howler (play/pause/volume/mute).
  - `src/player/features/soundboards/` — soundboards (simpler `loop: boolean`).
- `src/types/player.ts` — shared IPC/remote types.

## Repeat modes

`Repeat = "off" | "track" | "playlist"` — independent of the separate `loopEnabled` flag
(seamless loop points). In `track` mode a new `Howl` is created after the track ends (to
avoid issues with Howler's HTML5 audio element pool, especially for FLAC).

## Running

Per the developer's note: run the freshly built binary from `out/` directly — `open`
launches the copy in `/Applications`. Local build: `npm run package` → binary at
`out/Kenku FM-darwin-arm64/Kenku FM.app/Contents/MacOS/kenku-fm`.

## How to make a fork release

Fork releases are fully automated via GitHub Actions
(`.github/workflows/release-fork.yaml`, triggered by `on: push: tags: v*.*.*.f*`).

**Version scheme:** `v<base>.f<N>` — the upstream (Owlbear) base version plus a fork
counter (`f`). Examples: `v1.5.6.f6`, `v1.5.6.f7`. The next release increments `N`; the
base only changes when syncing with upstream.

**Do NOT bump `package.json`** — the version stays as is (`1.5.5`); assets keep that name.

Steps:

1. Commit changes to `main` (the fork commits features/fixes directly to `main`):
   ```
   git add <files> && git commit -m "..."
   git push origin main
   ```
2. Create and push the next version tag (this triggers CI):
   ```
   git tag v1.5.6.fN
   git push origin v1.5.6.fN
   ```
3. CI automatically: creates a `release/<tag>` branch, builds on Linux/Windows/macOS
   (`yarn install` → `yarn run bundle:tools` → `yarn run make`), and via
   `softprops/action-gh-release` **creates the GitHub release with assets**
   (`.zip/.deb/.rpm/.exe/.nupkg/.dmg/RELEASES`). The release author is `github-actions[bot]`.
   Monitor: `gh run list --repo Soteyl/better-kenku-fm` / `gh run watch`.
4. The workflow does **not** set release notes — add them manually **after** the release
   appears:
   ```
   gh release edit v1.5.6.fN --repo Soteyl/better-kenku-fm --notes "..."
   ```
   Release notes format (matching previous releases):
   - `## What's Changed` heading;
   - bullet points describing the changes (in English);
   - optional images: `https://raw.githubusercontent.com/Soteyl/better-kenku-fm/<tag>/docs/<file>`;
   - final line:
     `**Full Changelog**: https://github.com/Soteyl/better-kenku-fm/compare/<prev-tag>...<this-tag>`.

Fork remote: `origin` = `https://github.com/Soteyl/better-kenku-fm.git`.
