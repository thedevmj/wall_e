# Wall E Project Status

## Purpose

`wall_e` is an Android-focused React Native live wallpaper studio. The app lets a user browse mock wallpapers, create a doodle or video wallpaper, preview it, choose HOME/LOCK/BOTH as the destination, and hand the configuration to a native Android `WallpaperService`.

The React Native layer is the editor and library UI. The Android layer owns the live wallpaper service, video playback, URI/file access, and the system wallpaper picker.

## Current Status

- React Native app builds from the `wall_e` directory.
- Android is the supported runtime. iOS files exist because the project was scaffolded, but the wallpaper implementation is Android-only.
- Doodle rendering is implemented in both the React preview and native wallpaper service.
- Video picking uses Android `ACTION_OPEN_DOCUMENT` with `video/*`.
- First app launch requests media access:
  - Android 13/API 33+: `READ_MEDIA_VIDEO`
  - Android 6/API 23 through Android 12/API 32: `READ_EXTERNAL_STORAGE`
- Video selection no longer requires the broad media permission before opening the system document picker.
- After selection, the native module copies the selected video into app-private storage and returns a `file://` URI. This avoids playback failures caused by provider-owned `content://` URI grants not surviving the wallpaper/settings process boundary.
- Media3 ExoPlayer is configured with decoder fallback enabled because some devices can report H.264 as supported while failing to initialize their hardware AVC decoder.
- H.264 decoder selection now prefers software-only Media3 codec candidates on the affected device, avoiding the failing `c2.qti.avc.decoder` hardware codec.
- The test device still failed with `c2.android.avc.decoder`, proving the ROM cannot initialize AVC for the wallpaper surface. `WallpaperService` now falls back to timed `MediaMetadataRetriever` frame extraction and Canvas drawing after ExoPlayer decoder failure.
- Frame fallback decoding runs on a dedicated `HandlerThread` and the render thread paints only the latest cached bitmap. This prevents synchronous frame extraction from causing visible jitter. Continuous mode wraps timestamps; once mode holds the final frame.
- Selected video metadata duration is read before returning the result.
- Native debug Kotlin compilation passes.
- Existing Jest app render test passes.
- There is an existing Jest warning that the process has open asynchronous handles after the test completes; this is not a test assertion failure.
- Gradle emits existing deprecation warnings for React Native/Android Gradle APIs.

## Important Recent Fix

### Playback error root cause

The old flow returned the document provider URI directly to React Native, then saved that URI in `SharedPreferences`. The wallpaper service later gave the URI to Media3 ExoPlayer. Although the picker intent requested read and persistable access, some providers do not support persistable grants, and the original code did not use the exact grant flags returned by the result intent. The wallpaper service could therefore fail to open the URI and display a playback error.

The device log later confirmed that URI access was no longer the problem: the file existed, had 819058 bytes, and metadata identified `video/mp4` with H.264/AVC video. The actual failure was `ERROR_CODE_DECODER_INIT_FAILED` from `c2.qti.avc.decoder`, even though Media3 reported the format as supported.

### Current solution

`WallpaperModule` now:

1. Reads the selected URI from `Intent.data` or the first `clipData` item.
2. Attempts to persist the provider read grant using the result intent flags.
3. Opens the selected URI through `ContentResolver`.
4. Copies the video bytes to `<app filesDir>/wallpapers/video_<timestamp>.mp4`.
5. Extracts duration from the copied file.
6. Returns the copied file as a `file://` URI to JavaScript.

The wallpaper service receives an app-owned file that remains readable after the document picker closes and while Android invokes the wallpaper service.

## Source Tree

### React Native entry and UI

- `App.tsx`
  - Main screen and all current UI state.
  - `CreateWallpaperModal`: creates doodle/video wallpapers, selects video, sets title, loop, audio, and duration.
  - `WallpaperDetailModal`: previews a wallpaper, can select/replace a video, and applies or opens the system wallpaper picker.
  - `AnimatedPreview`: animated doodle preview using React Native `Animated`.
  - Uses `wallpaperBridge` for all native operations.
  - Wallpaper list is held in component state and is not persisted across app restarts.

- `src/components/ActionButton.tsx`
  - Shared primary/secondary React Native button.
  - Adds accessibility labels and generated test IDs.

- `src/components/WallpaperCard.tsx`
  - Displays wallpaper title, description, kind, duration, status, and optional video delete action.
  - Uses an animated accent indicator.

- `src/types.ts`
  - `WallpaperKind`: `doodle | video`.
  - `Wallpaper`: UI/library model; optional video URI, loop, audio, and playback duration fields.
  - `PickedVideo`: `{ uri, durationSeconds }`.
  - `WallpaperCapabilities`, `WallpaperApplyResult`, and `WallpaperError` contracts.

- `src/data/mockWallpapers.ts`
  - Three initial in-memory examples (mock library) plus `predefinedWallpapers`: four ready-made featured wallpapers (Aurora Drift, Sunset Pulse, Spark Bloom, Midnight Ocean) that seed the home screen billboard and the 2x2 grid.
  - All four predefined wallpapers are `doodle` kind. Sunset Pulse and Midnight Ocean were previously marked `video` but had no bundled video file, so preview and Apply could not work for them. Since there are no bundled video assets, making them doodles lets every built-in wallpaper preview and apply through the native doodle renderer with no extra setup.

- `src/services/wallpaperBridge.ts`
  - Typed defensive wrapper around `NativeModules.WallpaperModule`.
  - Uses timeouts for native calls.
  - `getCapabilities()` returns native data or fallback capabilities.
  - `pickVideo()` normalizes a native string/map response into `PickedVideo`.
  - `applyWallpaper()` passes wallpaper configuration and normalizes the native result.
  - `applyWallpaper()` is the only wallpaper-setting API; it saves configuration and opens Android's live wallpaper confirmation flow.

- `index.js`
  - Registers `App` under the name from `app.json`.

### Android native layer

- `android/app/src/main/java/com/wall_e/MainActivity.kt`
  - React Native activity.
  - On `onCreate`, requests the correct media permission for the Android API level if it has not already been granted.
  - Permission request code is `4108`.
  - The request is intentionally one-time/system-controlled: Android will not show the dialog again if the user permanently denies it. The document picker can still be opened because selection uses URI-level access.

- `android/app/src/main/java/com/wall_e/MainApplication.kt`
  - React Native application host.
  - Adds the custom `WallpaperPackage` to the package list.

- `android/app/src/main/java/com/wall_e/WallpaperPackage.kt`
  - Registers `WallpaperModule` as a custom native React Native module.

- `android/app/src/main/java/com/wall_e/bridge/WallpaperModule.kt`
  - Exposes `WallpaperModule` to JavaScript.
  - `getCapabilities`: reports live wallpaper support and feature list.
  - `pickVideo`: starts `ACTION_OPEN_DOCUMENT` for `video/*`, listens for the activity result, persistently attempts read access, copies the selected file into app-private storage, reads duration, and resolves `{ uri, durationSeconds }`.
  - Uses request code `4107` for the video picker.
  - Uses `SharedPreferences` file `wallpaper_pref` for the active wallpaper configuration.
  - `applyWallpaper`: saves config and starts `ACTION_CHANGE_LIVE_WALLPAPER` for the app service. It maps HOME/LOCK/BOTH to Android wallpaper flags for the confirmation flow.
  - `copyVideoToAppStorage`: writes videos under the app internal `filesDir/wallpapers` directory, so no external file path or service URI grant is needed at playback time.
  - The picker result handler now copies the file and reads duration on a background `Thread` and resolves the JS promise via `reactContext.runOnUiQueueThread`, so importing a large video no longer stalls the React preview/UI thread.
  - Current behavior does not delete old copied videos when a video is replaced or deleted. This is a future storage cleanup task.

- `android/app/src/main/java/com/wall_e/wallpaper/WallpaperService.kt`
  - Android `WallpaperService` implementation.
  - Loads active config from `wallpaper_pref` when the surface is created or becomes visible.
  - For doodles, draws animated native Canvas shapes.
  - For videos, creates Media3/ExoPlayer, attaches it to the wallpaper `SurfaceHolder`, sets repeat mode and volume, prepares, and starts playback.
  - Creates `DefaultRenderersFactory` with `setEnableDecoderFallback(true)`, allowing Media3 to retry another decoder when a device hardware decoder fails initialization.
- If all ExoPlayer AVC decoders fail, opens the same app-private file with `MediaMetadataRetriever` and renders timestamped frames directly to the wallpaper Canvas. This is a compatibility fallback and is less efficient than normal video playback.
- Fallback frame decoding is paced at the source rate, currently about 30 FPS, off the render thread. The Canvas paint loop remains display-driven and uses the latest completed frame, so a slow decode repeats a frame instead of blocking/juddering the wallpaper surface. The selected source video determines the number of unique frames; the observed sample is 30 FPS.
- The React Native video preview uses `viewType={ViewType.TEXTURE}` (`textureView`) to reduce surface-layer jitter inside the modal preview. The previous broken `viewType="textureView"` string prop caused a `RCTVideo` property update error; it was corrected to use the `ViewType.TEXTURE` enum value and import.
- Non-looping playback means one complete playback per device-unlock visibility cycle: when the wallpaper becomes visible again, ExoPlayer seeks to 0 and the frame-fallback clock resets to 0. Continuous playback keeps its loop behavior.
- Apply buttons now map `HOME` to `WallpaperManager.FLAG_SYSTEM`, `LOCK` to `WallpaperManager.FLAG_LOCK`, and `BOTH` to both flags. Android ROMs that block the hidden targeted setter fall back to the official live-wallpaper confirmation screen, where Android exposes its own destination confirmation.
  - Logs metadata, player state, playback exceptions, decoder details, and available decoders.
  - Displays a native fallback message if the video cannot be loaded.
  - Releases ExoPlayer when the wallpaper surface is destroyed or configuration changes.
  - Rendering-performance change: `refreshRendering()` keeps the display-driven Choreographer frame loop ON only when the service must paint itself (doodles, frame-fallback playback, or the error screen). When ExoPlayer is ready and rendering directly to the surface, the frame loop is turned OFF so the wallpaper does not wake the device every frame for nothing. The player state listener re-enables the loop on error.
  - The W_DURATION enforcement runnable is now stored in a field and removed from the main handler whenever the player is released or restarted, so repeated visibility changes no longer pile up unbounded timers.

## Native Configuration Contract

`WallpaperModule.saveWallpaperConfig()` writes these keys to `SharedPreferences("wallpaper_pref", 0)`:

- `W_ID`: wallpaper ID
- `W_KIND`: `doodle` or `video`
- `W_PATH`: video URI; currently an app-private `file://` URI for selected videos
- `W_LOOP`: boolean loop setting
- `W_DURATION`: playback duration clamped from 1 to 30 seconds
- `W_AUDIO`: boolean audio setting
- `W_ACCENT`: accent color, with a native fallback if empty
- `W_ROTATION`: rotation in degrees `0/90/180/270` (added with the video rotation feature)

`WallpaperService.loadConfiguration()` reads the same keys. Keep these names and value types synchronized if the native contract changes.

## Android Manifest and Build

`android/app/src/main/AndroidManifest.xml` declares:

- `INTERNET`
- `SET_WALLPAPER`
- `READ_MEDIA_VIDEO`
- `READ_EXTERNAL_STORAGE` with `maxSdkVersion="32"`
- `FOREGROUND_SERVICE`
- Exported `MainActivity`
- Exported `LiveWallpaperService` protected by `android.permission.BIND_WALLPAPER`
- Wallpaper service metadata from `res/xml/live_wallpaper.xml`

Build settings in `android/build.gradle`:

- min SDK: 24
- compile SDK: 37
- target SDK: 36
- Kotlin: 2.2.0
- NDK: `27.1.12297006`

`android/app/build.gradle` uses React Native Gradle integration and Media3 `1.5.1` dependencies. Media3 ExoPlayer, UI, common, RTSP, and DASH artifacts are included; some are forced to `1.5.1` for consistency.

## Runtime Flows

### Video selection

1. User chooses Video in `CreateWallpaperModal` or opens video replacement in `WallpaperDetailModal`.
2. React calls `wallpaperBridge.pickVideo()`.
3. Bridge calls `NativeModules.WallpaperModule.pickVideo()`.
4. Native module opens Android's document picker.
5. User selects a video or cancels.
6. Native module copies the chosen content into internal app storage and reads duration.
7. Native result resolves to JavaScript.
8. React stores the returned file URI in the wallpaper model and uses it for the React Native preview.

### Apply/open wallpaper picker

1. React validates that a video wallpaper has a URI.
2. React calls `applyWallpaper()` through the bridge only after the user presses HOME, LOCK, or BOTH.
3. Native module writes the active config to `wallpaper_pref`.
4. Native module starts Android live wallpaper settings for `LiveWallpaperService`.
5. Android creates the wallpaper service and its engine.
6. The engine loads config and either draws doodle frames or starts ExoPlayer with the app-private video file.

## Development Commands

Run from `D:\Junaid Mansuri\Desktop\livewallpaper\wall_e`:

```powershell
npm install
npm start
npm run android
npm test -- --runInBand
npm run lint
```

Android-only compile check:

```powershell
cd android
.\gradlew.bat :app:compileDebugKotlin
```

The Android compile currently passes. The React Native Jest render test currently passes.

## Testing Notes

- `__tests__/App.test.tsx` renders the home screen and checks that the title and a reasonable number of text nodes are present.
- There are no current automated tests for native Kotlin behavior, Android permission dialogs, document picker results, URI copying, MediaMetadataRetriever, ExoPlayer, or the wallpaper service.
- Manual validation should use a physical Android device or emulator:
  1. Uninstall the app to clear prior permission state.
  2. Install and open it; confirm the media permission prompt appears.
  3. Create a Video wallpaper and select an MP4/H.264 file.
  4. Confirm the React preview loads.
  5. Apply/open the wallpaper picker and confirm native playback.
  6. Close/reopen the app and confirm the copied file remains usable.
  7. Test canceling selection and denying permission.

## Known Limitations and Follow-up Work

- The app's wallpaper library is in-memory only; user-created wallpapers disappear from the React list after a full app restart.
- Copied videos accumulate in app-private storage; implement a cleanup policy when replacing/deleting videos or persist a mapping of wallpaper IDs to copied files.
- Video playback support depends on the device decoder and Media3. MP4/H.264 is the safest compatibility target. A device may advertise H.264 support but still fail hardware decoder initialization; decoder fallback now handles this when an alternate software/device decoder is usable.
- On the tested Redmi Note 10 / Android 16 / Infinity-X device, both Qualcomm and Android software AVC decoder initialization failed. The frame fallback is the final playback path for that device if `MediaMetadataRetriever` can decode frames.
- The native service fallback text is drawn on the Canvas, but React's preview error is separate and may show different details.
- `SafeAreaView` from `react-native` is deprecated in the current React Native version; migrate to `react-native-safe-area-context` when touching the root layout.
- Gradle reports existing deprecated APIs, including the React Native delegate constructor and legacy variant APIs.
- The project has existing unrelated worktree modifications in several generated/config/native files. Do not revert them without checking ownership first.
- No commit should be created unless explicitly requested.

## AI Working Rules for This Repository

- Start with the owning abstraction: React UI in `App.tsx`, JS/native contract in `src/services/wallpaperBridge.ts`, picker and config in `WallpaperModule.kt`, playback in `WallpaperService.kt`.
- Preserve the `SharedPreferences` key contract unless changing both writer and reader together.
- Treat selected document URIs as temporary provider references. Keep copying into app-private storage for wallpaper-service playback unless a deliberate alternative is implemented.
- Keep permission behavior API-aware: `READ_MEDIA_VIDEO` on API 33+, `READ_EXTERNAL_STORAGE` on API 32 and below.
- Validate native changes with `android\gradlew.bat :app:compileDebugKotlin` and JavaScript changes with `npm test -- --runInBand`.
- Avoid broad refactors while fixing playback or picker behavior.

## Recent Fixes (Implemented)
- Built-in wallpapers now work end-to-end: every predefined wallpaper is a `doodle`, so Preview shows the animated pre-renderer and Apply always reaches the native doodle renderer (no "Choose a video before applying" dead end for wallpapers that ship with the app).
- Media normalization (build-time ffmpeg): all 12 bundled live-video MP4s were re-encoded in place to H.264 High / 720x1280 / SAR 1:1 / 30 fps / CRF 22 / no audio / `+faststart`. The old "HQ" files were HEVC Main 10 / 1920x1080 / ~15 Mbps landscapes (software-decode overkill on the device, causing lag and "will not load"). Backups of the originals are in `C:\Users\JUNAID~1\AppData\Local\Temp\opencode\wallpaper_originals\`. Filenames were preserved because `require()`/raw-resource mapping depends on them. Total bundle shrank from ~117 MB to ~37 MB. Posters were regenerated from the normalized frames into `assets/livewallpapers/posters/`.
- Device rotation is now handled by an on-device transcode: `android/app/src/main/java/com/wall_e/bridge/VideoRotationProcessor.kt` decodes with hardware MediaCodec, rotates with a GLES2 pass, and re-encodes to a cached pre-rotated H.264 file (`rotated_<name>_r<deg>.mp4`). When the transcode succeeds, `applyWallpaper` saves the config with the pre-rotated path and `W_ROTATION=0` so playback goes through the proven direct-surface path. On failure, rotation falls through to the runtime GL/EGL renderer as a safety net. Cached per wallpaper+rotation so re-applies are instant.
- `WallpaperService` decoders are hardware-first with only `DefaultRenderersFactory(...).setEnableDecoderFallback(true)` (removed the software-only `MediaCodecSelector`), video surfaces use `C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING`, and `drawRotatedBitmap` cover-fills the screen (`maxOf` scale) inside `canvas.rotate`.
- One-shot enforcement fixed: loop mode `seekTo(0)`; one-shot holds the final frame without churn.
- `WallpaperService.onVisibilityChanged` now restarts the player when any config field changes (kind/URI/loop/audio/duration/rotation), not just kind+URI.
- App `WallpaperDetailModal` gained a Play continuously / Play once toggle (checkbox style) that writes `wallpaper.loop`; preview repeat and apply both respect it.
- Video import is smoother: the copy + duration probe run on a background thread and the promise resolves on the React UI queue, so the preview does not jank while a large video is imported.
- `WallpaperService` stops the Choreographer frame loop while ExoPlayer renders directly to the surface and re-enables it for doodles, frame-fallback playback, and error screens (battery/CPU win; the previous loop posted empty frame callbacks continuously during video playback).
- The W_DURATION enforcement timer and the frame-fallback decode task are now cancelled/removed when the player is released, so visibility toggles no longer leak Runnables.
- Non-loop (`loop = false`): `WallpaperService` holds at final frame (`seekTo(durationMs)`) instead of restarting (`seekTo(0L)`).
- Playback duration (`W_DURATION`): enforced via `ExoPlayer` timer (`postDelayed` every 500ms) and `startFrameFallback` uses `playbackDuration * 1000L`; works for both `HOME` and `LOCK`.
- `HOME` applies only to system/home screen (`WallpaperManager.FLAG_SYSTEM`); picker flags separate `HOME`/`LOCK`/`BOTH`.
- Preview (`App.tsx`): `Video` uses `viewType={ViewType.TEXTURE}` with `controls` removed and `playInBackground={true}`.

## Recent UI Updates
- Modal panels (Create wallpaper and wallpaper detail) are now an opaque `#0B1526` card instead of a translucent glass card, so the create card is fully readable over the dark backdrop.
- Replaced the previous metric/action/footer layout with a clean, professional home screen:
  - Header shows the app icon (`assets/app-icon.png`, resized from `images/file_000000008aac820bb73abb65891e0864.png`) next to the app name `LiveWallpaper Studio`.
  - A featured `Billboard` rotates through all wallpapers every 5 seconds with a cross-fade and tappable pagination dots. The billboard card uses an abstract `GeometricArt` panel with a dark scrim and shows kind, name, and description.
  - A `Predefined wallpapers` 2x2 grid shows the ready-made wallpapers (name + kind chip + duration) over colorful geometric artwork.
  - Removed the metrics row (Library/SDK/Native), the Create Doodle/Video buttons, the filter row, and the Android runtime footer panel as unnecessary info.
  - The floating `Create` FAB opens the wallpaper creation modal; created wallpapers are prepended to the billboard rotation.
- Added `src/components/GeometricArt.tsx`: a View-only abstract composition (tinted blobs, accent ring, white diamond, deep orb, triangle, dots) that derives a palette from each wallpaper's accent color and varies by seed index, so every predefined wallpaper looks distinct.
- New app launcher icons generated from the source artwork PNG into `mipmap-mdpi..xxxhdpi` for `ic_launcher.png` (square) and `ic_launcher_round.png` (circular crop).
- App display name updated to `LiveWallpaper Studio` in `app.json` and `android/app/src/main/res/values/strings.xml`.
- The Jest render test now asserts `LiveWallpaper Studio` and unmounts the rendered component so the billboard interval is cleared after the test (removes the open-async-handle noise).
- Removed the unused capabilities/loading skeleton state from `App()` since the home screen no longer shows SDK/native metrics.
