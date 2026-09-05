# LiveWallpaper Studio

An Android live wallpaper app built with React Native. Browse bundled wallpapers, create custom ones from your own videos, preview them with animated previews, and apply them to your home screen, lock screen, or both.

## Features

- **43 bundled wallpapers** — 23 animated video wallpapers, 20 static images, and 3 procedural dynamic wallpapers
- **6 wallpaper types** — video, static, doodle, battery, membrane, and fluid
- **Custom video wallpapers** — pick any MP4/H.264 file from your device
- **Live animated previews** — see what each wallpaper looks like before applying
- **Color customization** — adjust the accent color for dynamic wallpapers
- **Multiple apply destinations** — set to home screen, lock screen, or both
- **Battery Fluid wallpaper** — animated fluid that reflects your real battery level with color spectrum shifts
- **Crimson Bloom wallpaper** — premium minimalist flowing translucent surfaces over midnight navy
- **OnePlus Fluid wallpaper** — large translucent color blobs drifting over true OLED black
- **OLED-friendly** — true black backgrounds throughout for AMOLED power savings

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native 0.87.0 (React 19.2.3) |
| Language | TypeScript 6.0.3 |
| Native | Kotlin (Android WallpaperService, Media3/ExoPlayer, OpenGL ES 2.0) |
| Video | react-native-video 6.19.2 |
| Node | >= 22.11.0 |

## Getting Started

> Requires the [React Native environment setup](https://reactnative.dev/docs/set-up-your-environment) for Android development.

### Install dependencies

```bash
npm install
```

### Start Metro bundler

```bash
npm start
```

### Build and run on Android

In a separate terminal:

```bash
npm run android
```

### Run tests

```bash
npm test
```

### Lint

```bash
npm run lint
```

## Project Structure

```
wall_e/
  App.tsx                     Main screen, modals, all UI state
  index.js                    React Native entry point

  src/
    types.ts                  Wallpaper type definitions
    styles/index.ts           Shared StyleSheet
    data/
      bundledWallpapers.ts    43 bundled wallpapers (live + static + dynamic)
    services/
      wallpaperBridge.ts      Typed wrapper around native module
      logService.ts           In-memory log capture
      toast.ts                Android Toast helper
    components/
      ActionButton.tsx        Shared primary/secondary button
      AuraFlowPreview.tsx     JS preview for Aura gradient wallpaper
      BatteryFluidPreview.tsx JS preview for battery-level fluid wallpaper
      ColorPicker.tsx         HSV color picker for accent customization
      FluidFlowPreview.tsx    JS preview for OnePlus-style fluid wallpaper
      GeometricArt.tsx        Abstract art for billboard/grid thumbnails
      MembraneFlowPreview.tsx JS preview for Crimson Bloom wallpaper
      WallpaperCard.tsx       Wallpaper list card

  android/
    app/src/main/java/com/wall_e/
      bridge/
        WallpaperModule.kt        Native module (pickers, apply, battery, clipboard)
        VideoRotationProcessor.kt On-device GPU video rotation/transcode
      wallpaper/
        WallpaperService.kt       Android WallpaperService (ExoPlayer, Canvas, frame fallback)
        VideoGlRenderer.kt        OpenGL ES video renderer
```

## Wallpaper Types

| Type | Description |
|---|---|
| `video` | MP4 video loop with configurable duration, audio, and rotation |
| `static` | Still image set directly as Android wallpaper |
| `doodle` | Animated Canvas-drawn shapes rendered natively |
| `battery` | Fluid animation driven by real battery level with health color spectrum |
| `membrane` | Premium minimalist flowing translucent surfaces over midnight navy |
| `fluid` | OnePlus-inspired translucent color blobs drifting over true OLED black |

## How It Works

- **JS Preview** — Each dynamic wallpaper type has a React component that approximates the native rendering using `Animated.View` layers, enabling instant preview without waiting for native rendering
- **Native Rendering** — The Android `WallpaperService` uses `Choreographer` frame callbacks with `Canvas` drawing for procedural wallpapers, and `Media3/ExoPlayer` for video wallpapers
- **Decoder Resilience** — If hardware decoders fail, the app falls back to `MediaMetadataRetriever` frame extraction painted to Canvas at ~30 FPS
- **Media Pipeline** — Selected videos are copied from `content://` URIs to app-private `file://` storage to survive the process boundary between the app and wallpaper service
- **Config Sync** — Wallpaper configuration is shared between JS and native via `SharedPreferences("wallpaper_pref")` with a 1-second polling watchdog that detects config changes made while the system picker is on top

## Notes

- User-created wallpapers exist only in memory and are lost on app restart
- Release APK size is ~317 MB due to 43 bundled media assets
- The `AuraFlowPreview` component exists but is not currently wired into a bundled wallpaper entry
