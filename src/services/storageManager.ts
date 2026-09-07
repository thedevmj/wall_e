import type { Wallpaper } from '../types';
import { wallpaperBridge } from './wallpaperBridge';
import { wallpaperRepository } from './wallpaperRepository';

/**
 * Storage quota manager.
 *
 * Keeps the app-private `filesDir/wallpapers` directory bounded. When a new
 * video/image is imported (or on app start) `enforceQuota()`:
 *
 * 1. Collects every file URI still referenced by the wallpaper library.
 * 2. Lists the actual files under `filesDir/wallpapers` (oldest first).
 * 3. Deletes the oldest files that are NOT referenced until the directory is
 *    under the quota, or only referenced files remain.
 *
 * Referenced app-private files are never deleted; the quota trims orphans
 * first and stops early when only live wallpapers remain.
 */

const DEFAULT_MAX_STORAGE_BYTES = 1024 * 1024 * 1024; // 1 GiB

function isAppPrivateEntry(name: string): boolean {
  // The wallpapers dir only holds copies we created (video_, image_,
  // bundled_video_, bundled_image_, poster_, rotated_) and software-playback
  // sequence directories (seq_). Anything else is not ours to delete.
  return (
    name.startsWith('video_') ||
    name.startsWith('image_') ||
    name.startsWith('bundled_video_') ||
    name.startsWith('bundled_image_') ||
    name.startsWith('poster_') ||
    name.startsWith('rotated_') ||
    name.startsWith('seq_')
  );
}

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/**
 * A file is prunable when it is app-private, not referenced by any wallpaper,
 * and has no live rotated/poster sibling still in use. Rotated caches for a
 * live video are derived from it: they are regenerable, so they may be pruned
 * under pressure without breaking the wallpaper.
 *
 * Software-playback sequence dirs (seq_<digest10>) are kept only for digests
 * that are still registered; abandoned sequences are prunable like any file.
 */
function isUnreferenced(
  file: { path: string; name: string },
  referenced: Set<string>,
  referencedSeqNames: Set<string>,
): boolean {
  if (!isAppPrivateEntry(file.name)) return false;
  if (file.name.startsWith('seq_')) {
    return !referencedSeqNames.has(file.name);
  }
  if (referenced.has(file.path)) return false;
  // A rotated_<base>_r<deg>.mp4 file belongs to whatever <base> video it was
  // derived from; if that source is still referenced but only the rotated copy
  // is listed as unreferenced, keep it (it is the playable form).
  if (file.name.startsWith('rotated_')) {
    const base = file.name.replace(/^rotated_/, '').replace(/_r(90|180|270)\.mp4$/, '');
    for (const uri of referenced) {
      const refName = uri.split('/').pop() ?? '';
      if (refName.startsWith(`${base}_`) || refName === base) return false;
    }
  }
  return true;
}

export async function enforceStorageQuota(
  wallpapers: Wallpaper[],
  maxBytes: number = DEFAULT_MAX_STORAGE_BYTES,
): Promise<{ deletedFiles: number; freedBytes: number }> {
  const usage = await wallpaperBridge.getWallpaperStorage();
  if (!usage) return { deletedFiles: 0, freedBytes: 0 };

  // Reference set: every video/image URI currently in the library plus every
  // registered poster file. Bundled sources (require() asset ids, remote URIs)
  // are not app-private files and simply never match a path below.
  const referenced = await wallpaperRepository.videoFiles.allReferencedUris();
  for (const w of wallpapers) {
    if (w.videoUri) referenced.add(w.videoUri);
    if (w.imageUri) referenced.add(w.imageUri);
  }

  // Software-playback sequence dirs are keyed by the SHA-1 digest of their
  // source video: seq_<digest10>. Keep them while the digest is registered.
  const registeredDigests = await wallpaperRepository.videoFiles.allDigests();
  const referencedSeqNames = new Set(
    registeredDigests.map(digest => `seq_${digest.slice(0, 10)}`),
  );

  let deletedFiles = 0;
  let freedBytes = 0;
  let remaining = usage.totalBytes;
  const items = [...usage.items].sort((a, b) => a.modified - b.modified);

  for (const file of items) {
    if (remaining <= maxBytes) break;
    if (!isUnreferenced(file, referenced, referencedSeqNames)) continue;
    const renamed = await wallpaperBridge.deleteStoredMedia(toFileUri(file.path));
    if (renamed > 0) {
      deletedFiles++;
      freedBytes += file.bytes;
      remaining = Math.max(0, remaining - file.bytes);
    }
  }
  return { deletedFiles, freedBytes };
}