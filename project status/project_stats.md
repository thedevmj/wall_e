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
  - Three initial in-memory examples: two doodles and one video.
  - These are mock library entries; the mock video has no local playable URI until replaced by the user.

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

## Native Configuration Contract

`WallpaperModule.saveWallpaperConfig()` writes these keys to `SharedPreferences("wallpaper_pref", 0)`:

- `W_ID`: wallpaper ID
- `W_KIND`: `doodle` or `video`
- `W_PATH`: video URI; currently an app-private `file://` URI for selected videos
- `W_LOOP`: boolean loop setting
- `W_DURATION`: playback duration clamped from 1 to 30 seconds
- `W_AUDIO`: boolean audio setting
- `W_ACCENT`: accent color, with a native fallback if empty

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
