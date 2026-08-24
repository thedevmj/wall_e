export type WallpaperKind = 'doodle' | 'video';

export type Wallpaper = {
  id: string;
  title: string;
  kind: WallpaperKind;
  description: string;
  accent: string;
  status: 'Ready' | 'Needs preview' | 'Applied';
  duration: string;
  createdAt: string;
  videoUri?: string;
  loop?: boolean;
  audio?: boolean;
  playbackDuration?: number;
};

export type PickedVideo = {
  uri: string;
  durationSeconds: number;
};

export type WallpaperCapabilities = {
  supportsLiveWallpaper: boolean;
  minSdk: number;
  targetSdk: number;
  features: string[];
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
