import { NativeModules } from 'react-native';
import type { PickedVideo, WallpaperCapabilities, WallpaperApplyResult } from '../types';

const NATIVE_CALL_TIMEOUT_MS = 15000;

type NativeWallpaperResult = {
  ok?: unknown;
  id?: unknown;
  destination?: unknown;
  mode?: unknown;
  error?: unknown;
  errorCode?: unknown;
};

type NativeVideoResult = {
  uri?: unknown;
  durationSeconds?: unknown;
};

type NativeWallpaperModule = {
  getCapabilities?: () => Promise<unknown>;
  applyWallpaper?: (...args: unknown[]) => Promise<unknown>;
  pickVideo?: () => Promise<unknown>;
};

const fallbackCapabilities: WallpaperCapabilities = {
  supportsLiveWallpaper: false,
  minSdk: 24,
  targetSdk: 36,
  features: ['Doodle renderer', 'Video preview', 'Wallpaper picker'],
};

/**
 * Wraps a promise with a timeout. If the native call doesn't resolve within
 * the given duration, the promise rejects with a timeout error.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function getNativeModule(): NativeWallpaperModule | null {
  const mod: unknown = NativeModules.WallpaperModule;
  if (typeof mod !== 'object' || mod === null) {
    console.warn('WallpaperModule native module is not available');
    return null;
  }
  return mod as NativeWallpaperModule;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const wallpaperBridge = {
  async getCapabilities(): Promise<WallpaperCapabilities> {
    try {
      const nativeModule = getNativeModule();
      if (nativeModule && typeof nativeModule.getCapabilities === 'function') {
        const result = await withTimeout(
          nativeModule.getCapabilities(),
          NATIVE_CALL_TIMEOUT_MS,
          'getCapabilities',
        );
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          const capabilities = result as {
            supportsLiveWallpaper?: unknown;
            minSdk?: unknown;
            targetSdk?: unknown;
            features?: unknown;
          };
          return {
            supportsLiveWallpaper: capabilities.supportsLiveWallpaper === true,
            minSdk: Number.isFinite(Number(capabilities.minSdk)) ? Number(capabilities.minSdk) : 24,
            targetSdk: Number.isFinite(Number(capabilities.targetSdk)) ? Number(capabilities.targetSdk) : 36,
            features: Array.isArray(capabilities.features)
              ? capabilities.features.filter((feature): feature is string => typeof feature === 'string')
              : [...fallbackCapabilities.features],
          };
        }
      }
      return fallbackCapabilities;
    } catch (error) {
      console.warn('Native wallpaper bridge unavailable', error);
      return fallbackCapabilities;
    }
  },

  async applyWallpaper(
    id: string,
    kind: 'doodle' | 'video',
    destination: 'HOME' | 'LOCK' | 'BOTH',
    videoUri?: string,
    loop = true,
    playbackDuration = 30,
    audio = false,
  ): Promise<WallpaperApplyResult> {
    try {
      console.log('[WallpaperBridge] applyWallpaper request', {
        id,
        kind,
        destination,
        videoUri,
        loop,
        playbackDuration,
        audio,
      });
      const nativeModule = getNativeModule();
      if (nativeModule && typeof nativeModule.applyWallpaper === 'function') {
        const result = await withTimeout(
          nativeModule.applyWallpaper(id, kind, destination, videoUri ?? '', loop, playbackDuration, audio),
          NATIVE_CALL_TIMEOUT_MS,
          'applyWallpaper',
        );
        console.log('[WallpaperBridge] applyWallpaper response', result);
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          const response = result as NativeWallpaperResult;
          return {
            ok: response.ok === true,
            id: asString(response.id) ?? id,
            destination: asString(response.destination) ?? destination,
            mode: asString(response.mode),
            error: asString(response.error),
            errorCode: asString(response.errorCode),
          };
        }
        return { ok: false, id, destination, error: 'Unexpected response from wallpaper module' };
      }
      return { ok: false, id, destination, error: 'Native wallpaper module is not available on this device', errorCode: 'MODULE_UNAVAILABLE' };
    } catch (error) {
      console.warn('Wallpaper apply failed', error);
      const message = error instanceof Error ? error.message : 'Unable to open the wallpaper preview';
      return { ok: false, id, destination, error: message, errorCode: 'APPLY_EXCEPTION' };
    }
  },

  async pickVideo(): Promise<PickedVideo | null> {
    try {
      console.log('[WallpaperBridge] pickVideo request');
      const nativeModule = getNativeModule();
      if (!nativeModule || typeof nativeModule.pickVideo !== 'function') {
        return null;
      }
      const result = await withTimeout(
        nativeModule.pickVideo(),
        60000, // video picking can take a while — 60s timeout
        'pickVideo',
      );
      console.log('[WallpaperBridge] pickVideo response', result);
      if (!result) {
        return null;
      }
      if (typeof result === 'string') {
        return { uri: result, durationSeconds: 30 };
      }
      if (typeof result !== 'object' || result === null || Array.isArray(result)) {
        return null;
      }
      const video = result as NativeVideoResult;
      if (typeof video.uri !== 'string' || !video.uri) {
        return null;
      }
      return {
        uri: video.uri,
        durationSeconds:
          Number.isFinite(Number(video.durationSeconds)) && Number(video.durationSeconds) > 0
            ? Number(video.durationSeconds)
            : 30,
      };
    } catch (error) {
      console.warn('Video picker failed', error);
      throw error; // Re-throw so caller can show specific error
    }
  },

};
