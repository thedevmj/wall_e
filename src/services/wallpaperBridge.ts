import { NativeModules } from 'react-native';
import type { PickedVideo, WallpaperCapabilities } from '../types';

const fallbackCapabilities: WallpaperCapabilities = {
  supportsLiveWallpaper: false,
  minSdk: 24,
  targetSdk: 36,
  features: ['Doodle renderer', 'Video preview', 'Wallpaper picker'],
};

export const wallpaperBridge = {
  async getCapabilities(): Promise<WallpaperCapabilities> {
    try {
      const nativeModule = NativeModules.WallpaperModule;
      if (nativeModule && typeof nativeModule.getCapabilities === 'function') {
        return await nativeModule.getCapabilities();
      }
      return fallbackCapabilities;
    } catch (error) {
      console.warn('Native wallpaper bridge unavailable', error);
      return fallbackCapabilities;
    }
  },

  async applyWallpaper(id: string, kind: 'doodle' | 'video', destination: 'HOME' | 'LOCK' | 'BOTH', videoUri?: string, loop = true, playbackDuration = 30, audio = false) {
    try {
      const nativeModule = NativeModules.WallpaperModule;
      if (nativeModule && typeof nativeModule.applyWallpaper === 'function') {
        return await nativeModule.applyWallpaper(id, kind, destination, videoUri ?? '', loop, playbackDuration, audio);
      }
      return { ok: false, id, destination, error: 'Native wallpaper module unavailable' };
    } catch (error) {
      console.warn('Wallpaper apply failed', error);
      return { ok: false, error: error instanceof Error ? error.message : 'Unable to open the wallpaper preview' };
    }
  },

  async pickVideo(): Promise<PickedVideo | null> {
    try {
      const nativeModule = NativeModules.WallpaperModule;
      if (!nativeModule || typeof nativeModule.pickVideo !== 'function') return null;
      const result = await nativeModule.pickVideo();
      if (!result) return null;
      if (typeof result === 'string') {
        return {uri: result, durationSeconds: 30};
      }
      if (typeof result.uri !== 'string' || !result.uri) return null;
      return {
        uri: result.uri,
        durationSeconds: Number.isFinite(Number(result.durationSeconds)) ? Number(result.durationSeconds) : 30,
      };
    } catch (error) {
      console.warn('Video picker unavailable', error);
      return null;
    }
  },

  async openWallpaperPicker(id: string, kind: 'doodle' | 'video', videoUri?: string, loop = true, playbackDuration = 30, accent?: string, audio = false): Promise<boolean> {
    try {
      const nativeModule = NativeModules.WallpaperModule;
      if (!nativeModule || typeof nativeModule.openWallpaperPicker !== 'function') {
        return false;
      }
      return Boolean(await nativeModule.openWallpaperPicker(id, kind, videoUri ?? '', loop, playbackDuration, accent ?? '', audio));
    } catch (error) {
      console.warn('Wallpaper picker unavailable', error);
      return false;
    }
  },
};
