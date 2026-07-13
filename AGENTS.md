# AGENTS.md

## Огляд проєкту

**kenku-fm** — застосунок менеджменту музики для Telegram-бота, який використовується під час
проведення настільно-рольових ігор (TTRPG). Це форк оригінального
[kenku-fm](https://github.com/owlbear-rodeo/kenku-fm). Застосунок побудований на **Electron + React + Redux Toolkit**,
відтворення аудіо реалізовано через **Howler.js**.

Ведучий гри керує плейлистами та саундбордами (фонова музика, ембієнт, звукові ефекти),
а аудіо транслюється у голосовий канал (для Telegram/Discord).

## Ключові фічі форку (відмінності від оригіналу)

- **Bundled PyMusicLooper** — інструмент для аналізу loop-точок і читання/запису loop-тегів
  постачається у складі збірки (не завантажується під час виконання). Див.
  `docs/HANDOFF_PYMUSICLOOPER_PARITY_LOOPING.md`.
- **Seamless loop-точки** — безшовне зациклення треку між `loopStart`/`loopEnd`
  (manual-wrap у циклі анімації + fallback на подію `end`). Джерела точок:
  `analysis` (PyMusicLooper), `tags`, `manual`.
- **Фонові зображення треків** — власне фонове зображення для кожного треку з
  перетягуванням для позиціонування (`background`, `backgroundPosition`).
- **Вимкнення лупу для довгих треків** — луп автоматично недоступний для треків довших за 30 хвилин.

## Структура

- `src/main/` — Electron main process (менеджери, remote API, інтеграція інструментів).
  - `src/main/managers/OptionalToolManager.ts` — виклики PyMusicLooper (`getLoopPoints`, `readLoopTags`, `writeLoopTags`).
  - `src/main/remote/routes/` — HTTP remote API для керування з мережі.
- `src/player/` — renderer (UI плеєра, Redux-стан, рушій відтворення).
  - `src/player/features/playlists/usePlaylistPlayback.ts` — **серце логіки відтворення/повтору/лупу** (Howler.js).
  - `src/player/features/playlists/playlistPlaybackSlice.ts` — Redux-стан відтворення (`repeat`, `loopEnabled`, `queue`, тощо).
  - `src/player/features/playlists/PlaylistPlaybackSync.tsx` — синхронізація Redux → Howler (play/pause/volume/mute).
  - `src/player/features/soundboards/` — саундборди (простіший `loop: boolean`).
- `src/types/player.ts` — спільні типи для IPC/remote.

## Режими повтору

`Repeat = "off" | "track" | "playlist"` — незалежно від окремого прапорця `loopEnabled`
(seamless loop-точки). У режимі `track` після завершення треку створюється новий `Howl`
(щоб уникнути проблем із пулом HTML5-аудіоелементів Howler, особливо для FLAC).

## Запуск

За пам'яткою розробника: запускати свіжозібраний бінар з `out/` напряму — `open` запускає
копію з `/Applications`. Локальна збірка: `npm run package` → бінар у
`out/Kenku FM-darwin-arm64/Kenku FM.app/Contents/MacOS/kenku-fm`.

## Як робити реліз форку

Релізи форку повністю автоматизовані через GitHub Actions
(`.github/workflows/release-fork.yaml`, тригер `on: push: tags: v*.*.*.f*`).

**Схема версій:** `v<base>.f<N>` — базова версія Owlbear + лічильник форку (`f`).
Приклади: `v1.5.6.f6`, `v1.5.6.f7`. Наступний реліз = інкремент `N`; базу міняємо
лише при синхронізації з апстрімом.

**`package.json` НЕ бампимо** — версія лишається як є (`1.5.5`); ассети так і називаються.

Кроки:

1. Закомітити зміни в `main` (форк комітить фічі/фікси напряму в `main`):
   ```
   git add <files> && git commit -m "..."
   git push origin main
   ```
2. Створити й запушити тег наступної версії (це запускає CI):
   ```
   git tag v1.5.6.fN
   git push origin v1.5.6.fN
   ```
3. CI сам: створює гілку `release/<tag>`, білдить на Linux/Windows/macOS
   (`yarn install` → `yarn run bundle:tools` → `yarn run make`) і через
   `softprops/action-gh-release` **створює GitHub-реліз з ассетами**
   (`.zip/.deb/.rpm/.exe/.nupkg/.dmg/RELEASES`). Автор релізу — `github-actions[bot]`.
   Стежити: `gh run list --repo Soteyl/better-kenku-fm` / `gh run watch`.
4. Workflow **не** задає release notes — додати їх вручну **після** появи релізу:
   ```
   gh release edit v1.5.6.fN --repo Soteyl/better-kenku-fm --notes "..."
   ```
   Формат нотаток (як у попередніх релізів):
   - заголовок `## What's Changed`;
   - буліти зі змінами (англійською);
   - за потреби зображення: `https://raw.githubusercontent.com/Soteyl/better-kenku-fm/<tag>/docs/<file>`;
   - фінальний рядок:
     `**Full Changelog**: https://github.com/Soteyl/better-kenku-fm/compare/<prev-tag>...<this-tag>`.

Remote форку: `origin` = `https://github.com/Soteyl/better-kenku-fm.git`.
