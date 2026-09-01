import type { ImageSourcePropType } from 'react-native';

export type WallpaperKind = 'doodle' | 'video' | 'static' | 'battery' | 'membrane';

export type Wallpaper = {
  id: string;
  title: string;
  kind: WallpaperKind;
  description: string;
  accent: string;
  status: 'Ready' | 'Needs preview' | 'Applied';
  duration: string;
  createdAt: string;
  source?: ImageSourcePropType;
  poster?: ImageSourcePropType;
  videoUri?: string;
  imageUri?: string;
  loop?: boolean;
  audio?: boolean;
  playbackDuration?: number;
  rotation?: number;
};

export type PickedVideo = {
  uri: string;
  durationSeconds: number;
};

export type PickedImage = {
  uri: string;
};

export type WallpaperCapabilities = {
  supportsLiveWallpaper: boolean;
  setWallpaperAllowed: boolean;
  liveWallpaperPickerAvailable: boolean;
  canSetLiveWallpaperDirectly: boolean;
  minSdk: number;
  targetSdk: number;
  features: string[];
  device?: string;
  androidVersion?: string;
};

export type WallpaperApplyResult = {
  ok: boolean;
  id?: string;
  destination?: string;
  mode?: string;
  error?: string;
  errorCode?: string;
};

export type WallpaperError = {
  code: string;
  message: string;
  recoverable: boolean;
};
