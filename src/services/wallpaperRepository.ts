import { bundledWallpapers } from '../data/bundledWallpapers';
import { wallpaperBridge } from './wallpaperBridge';
import type { Wallpaper, WallpaperKind, PickedVideo } from '../types';
import { getDB, toBool, toInt, toStr, rowsAs } from './db';

/**
 * The wallpaper library is split into two sources:
 *
 * 1. Bundled wallpapers — defined in code (they reference assets via
 *    `require()`, which cannot be serialized). They are always present and are
 *    treated as read-only defaults seeded from `bundledWallpapers.ts`.
 *
 * 2. User-created wallpapers — persisted in SQLite. These survive app restarts.
 *
 * The repository exposes a single `getAll()` that merges both, with
 * user-created wallpapers taking precedence on IDs that collide with bundled
 * ones. Pagination and filtering are supported so the library scales to a
 * large number of wallpapers without loading everything into memory.
 */

const USER_CREATED_KINDS = new Set<WallpaperKind>(['video', 'static']);

const BUNDLED_IDS = new Set(bundledWallpapers.map(w => w.id));

const PAGE_SIZE_DEFAULT = 50;

function fromRow(row: Record<string, unknown>): Wallpaper {
  const kind = toStr(row.kind) as WallpaperKind;
  const loop = toBool(row.loop);
  const audio = toBool(row.audio);
  const playbackDuration = row.playback_duration == null ? undefined : toInt(row.playback_duration, 30);
  const posterUri = row.poster_uri == null ? '' : toStr(row.poster_uri);
  return {
    id: toStr(row.id),
    title: toStr(row.title),
    kind,
    description: toStr(row.description),
    accent: toStr(row.accent, '#7C3AED'),
    status: (toStr(row.status, 'Ready') as Wallpaper['status']),
    duration: toStr(row.duration),
    createdAt: new Date(toInt(row.created_at)).toISOString(),
    videoUri: row.video_uri == null ? undefined : toStr(row.video_uri),
    imageUri: row.image_uri == null ? undefined : toStr(row.image_uri),
    poster: posterUri ? { uri: posterUri } : undefined,
    loop: kind === 'video' ? loop : undefined,
    audio: kind === 'video' ? audio : undefined,
    playbackDuration: kind === 'video' ? playbackDuration : undefined,
    rotation: kind === 'video' ? toInt(row.rotation, 0) : undefined,
  };
}

function toArgs(wallpaper: Wallpaper): (string | number | null)[] {
  const kind: WallpaperKind = wallpaper.kind;
  const posterUri =
    wallpaper.poster != null && typeof wallpaper.poster === 'object' && 'uri' in wallpaper.poster
      ? (wallpaper.poster as { uri?: string }).uri
      : undefined;
  return [
    wallpaper.id,
    wallpaper.title,
    wallpaper.description ?? '',
    kind,
    wallpaper.accent ?? '#7C3AED',
    wallpaper.status ?? 'Ready',
    wallpaper.duration ?? '',
    Date.parse(wallpaper.createdAt) || Date.now(),
    kind === 'video' ? (wallpaper.videoUri ?? '') : '',
    kind === 'static' ? (wallpaper.imageUri ?? '') : '',
    kind === 'video' ? (wallpaper.loop !== false ? 1 : 0) : 1,
    kind === 'video' ? (wallpaper.audio === true ? 1 : 0) : 0,
    kind === 'video' ? (wallpaper.playbackDuration ?? 30) : null,
    kind === 'video' ? (wallpaper.rotation ?? 0) : 0,
    posterUri ?? '',
  ];
}

/**
 * A wallpaper is user-created only when it is a video/static kind AND it does
 * not collide with a bundled (code-defined) wallpaper ID. Bundled wallpapers
 * also use video/static kinds and all carry `createdAt: 'Bundled'`, so the ID
 * check is what stops them from being persisted — previously merely opening a
 * bundled wallpaper triggered an upsert and silently added hidden DB rows.
 */
function isUserCreated(wallpaper: Wallpaper): boolean {
  if (BUNDLED_IDS.has(wallpaper.id)) return false;
  return USER_CREATED_KINDS.has(wallpaper.kind);
}

/**
 * Whether a wallpaper is a bundled (code-defined, read-only) default. Used by
 * the UI to hide Delete for bundled wallpapers.
 */
export function isBundled(wallpaper: Wallpaper): boolean {
  return (
    wallpaper.createdAt === 'Bundled' ||
    wallpaper.source != null ||
    BUNDLED_IDS.has(wallpaper.id)
  );
}

/**
 * Whether a user-created wallpaper would render as a duplicate of a bundled
 * default in the library list. The bundled catalog is always merged into
 * `getAll()` by *id*, so a user row with the same title (and kind) as a bundled
 * default would appear as a second, visually identical card. Returns the
 * matching bundled wallpaper (which the caller can open instead) or null.
 */
export function findBundledTitleCollision(
  title: string,
  kind: WallpaperKind,
): Wallpaper | undefined {
  const normalized = title.trim().toLowerCase();
  if (!normalized) return undefined;
  return bundledWallpapers.find(
    w => w.kind === kind && w.title.trim().toLowerCase() === normalized,
  );
}

/**
 * Merge bundled wallpapers with user-created ones from the DB.
 * Bundled IDs that also exist in the DB are overridden by the DB copy
 * (so an edited bundled wallpaper keeps its edits), except that the bundled
 * `source`/`poster` image assets are never lost.
 */
function mergeIntoBundled(bundled: Wallpaper[], userWallpapers: Wallpaper[]): Wallpaper[] {
  const byId = new Map<string, Wallpaper>();
  for (const w of bundled) byId.set(w.id, w);
  for (const w of userWallpapers) byId.set(w.id, { ...byId.get(w.id), ...w });
  return Array.from(byId.values());
}

export const wallpaperRepository = {
  /**
   * Returns all wallpapers (bundled + user-created), newest user-created first.
   * Optional kind filter.
   */
  async getAll(filter?: { kinds?: WallpaperKind[] }): Promise<Wallpaper[]> {
    try {
      const db = getDB();
      let sql = 'SELECT * FROM wallpapers ORDER BY created_at DESC';
      const args: (string | number)[] = [];
      if (filter?.kinds && filter.kinds.length > 0) {
        const placeholders = filter.kinds.map(() => '?').join(', ');
        sql = `SELECT * FROM wallpapers WHERE kind IN (${placeholders}) ORDER BY created_at DESC`;
        args.push(...filter.kinds);
      }
      const result = await db.execute(sql, args);
      const userWallpapers = rowsAs(result).map(fromRow);
      return mergeIntoBundled(bundledWallpapers, userWallpapers);
    } catch (error) {
      console.warn('WallpaperRepository.getAll failed, falling back to bundled', error);
      return bundledWallpapers;
    }
  },

  /**
   * Paginated query over user-created wallpapers only (scalable). Returns
   * { items, total }.
   */
  async getPage(options?: {
    page?: number;
    pageSize?: number;
    kinds?: WallpaperKind[];
  }): Promise<{ items: Wallpaper[]; total: number }> {
    const page = Math.max(1, options?.page ?? 1);
    const pageSize = Math.max(1, options?.pageSize ?? PAGE_SIZE_DEFAULT);
    try {
      const db = getDB();
      const where: string[] = [];
      const args: (string | number)[] = [];
      if (options?.kinds && options.kinds.length > 0) {
        const placeholders = options.kinds.map(() => '?').join(', ');
        where.push(`kind IN (${placeholders})`);
        args.push(...options.kinds);
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const countResult = await db.execute(`SELECT COUNT(*) AS c FROM wallpapers ${whereSql}`, args);
      const total = toInt(countResult.rows[0]?.c, 0);
      const result = await db.execute(
        `SELECT * FROM wallpapers ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...args, pageSize, (page - 1) * pageSize],
      );
      return { items: rowsAs(result).map(fromRow), total };
    } catch (error) {
      console.warn('WallpaperRepository.getPage failed', error);
      return { items: [], total: 0 };
    }
  },

  /**
   * Persists (insert or update) a user-created wallpaper. Bundled wallpapers
   * are ignored — they are code-defined and re-created on each launch.
   */
  async upsert(wallpaper: Wallpaper): Promise<void> {
    if (!isUserCreated(wallpaper)) return;
    try {
      const db = getDB();
      await db.execute(
        `INSERT OR REPLACE INTO wallpapers (
          id, title, description, kind, accent, status, duration, created_at,
          video_uri, image_uri, loop, audio, playback_duration, rotation, poster_uri
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        toArgs(wallpaper),
      );
    } catch (error) {
      console.warn('WallpaperRepository.upsert failed', error);
    }
  },

  /**
   * Deletes a user-created wallpaper from the DB. Bundled wallpapers cannot
   * be deleted (returns false).
   */
  async delete(id: string): Promise<boolean> {
    if (BUNDLED_IDS.has(id)) return false;
    try {
      const db = getDB();
      const result = await db.execute('DELETE FROM wallpapers WHERE id = ?', [id]);
      return result.rowsAffected > 0;
    } catch (error) {
      console.warn('WallpaperRepository.delete failed', error);
      return false;
    }
  },

  /**
   * Whether a wallpaper is user-created (persisted) vs bundled (code-defined).
   */
  isPersisted(wallpaper: Wallpaper): boolean {
    return isUserCreated(wallpaper);
  },

  /**
   * Older builds could persist bundled wallpapers into SQLite because they only
   * checked `kind`. Prunes any leftover bundled rows so the library does not
   * show duplicate/stale defaults. Safe to run on every launch.
   */
  async pruneBundledRows(): Promise<number> {
    if (BUNDLED_IDS.size === 0) return 0;
    try {
      const db = getDB();
      const placeholders = Array.from(BUNDLED_IDS).map(() => '?').join(', ');
      const result = await db.execute(
        `DELETE FROM wallpapers WHERE id IN (${placeholders})`,
        Array.from(BUNDLED_IDS),
      );
      return result.rowsAffected;
    } catch (error) {
      console.warn('WallpaperRepository.pruneBundledRows failed', error);
      return 0;
    }
  },

  /**
   * Older builds (and fast double-taps) could persist two user wallpapers that
   * use the SAME media file with the SAME name — the library then lists the
   * same card twice. De-duplicates rows by (kind, title, media uri), keeping
   * only the newest copy. Only DB rows are removed (never the shared media
   * file); returns the number of rows deleted.
   */
  async dedupeUserWallpapers(): Promise<number> {
    try {
      const db = getDB();
      const result = await db.execute('SELECT * FROM wallpapers ORDER BY created_at DESC');
      const seen = new Map<string, string>();
      const stale: string[] = [];
      for (const row of result.rows) {
        const kind = toStr(row.kind);
        if (!USER_CREATED_KINDS.has(kind as WallpaperKind)) continue;
        const media = kind === 'video' ? toStr(row.video_uri) : toStr(row.image_uri);
        if (!media) continue;
        // A user row that duplicates a bundled default's title+kind would render
        // as a second identical card (the bundled catalog is always merged in),
        // so drop it — the bundled default already represents it.
        if (findBundledTitleCollision(toStr(row.title), kind as WallpaperKind)) {
          stale.push(toStr(row.id));
          continue;
        }
        const key = `${kind}|${toStr(row.title)}|${media}`;
        if (seen.has(key)) {
          stale.push(toStr(row.id));
        } else {
          seen.set(key, toStr(row.id));
        }
      }
      let deleted = 0;
      for (const id of stale) {
        const r = await db.execute('DELETE FROM wallpapers WHERE id = ?', [id]);
        deleted += r.rowsAffected;
      }
      return deleted;
    } catch (error) {
      console.warn('WallpaperRepository.dedupeUserWallpapers failed', error);
      return 0;
    }
  },

  async count(): Promise<number> {
    try {
      const db = getDB();
      const result = await db.execute('SELECT COUNT(*) AS c FROM wallpapers');
      return toInt(result.rows[0]?.c, 0);
    } catch (error) {
      console.warn('WallpaperRepository.count failed', error);
      return 0;
    }
  },

  /**
   * Video de-duplication registry. When the same source video is imported
   * twice, native returns the same SHA-1 digest; registerFile keeps the URI of
   * the first copy and findFileByDigest lets callers reuse it instead of
   * keeping a second copy on disk.
   */
  videoFiles: {
    async registerFile(args: {
      digest: string;
      uri: string;
      bytes?: number;
      posterUri?: string;
    }): Promise<void> {
      if (!args.digest) return;
      try {
        const db = getDB();
        await db.execute(
          `INSERT OR REPLACE INTO video_files (digest, uri, bytes, poster_uri, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [args.digest, args.uri, args.bytes ?? 0, args.posterUri ?? '', Date.now()],
        );
      } catch (error) {
        console.warn('WallpaperRepository.videoFiles.registerFile failed', error);
      }
    },

    async findByDigest(
      digest: string,
    ): Promise<{ uri: string; bytes: number; posterUri?: string } | null> {
      if (!digest) return null;
      try {
        const db = getDB();
        const result = await db.execute('SELECT * FROM video_files WHERE digest = ?', [digest]);
        if (result.rows.length === 0) return null;
        const row = result.rows[0];
        return {
          uri: toStr(row.uri),
          bytes: toInt(row.bytes, 0),
          posterUri: row.poster_uri == null ? undefined : toStr(row.poster_uri),
        };
      } catch (error) {
        console.warn('WallpaperRepository.videoFiles.findByDigest failed', error);
        return null;
      }
    },

    /**
     * Looks up the digest registration that owns a specific app-private file
     * URI, if any. Used when deleting a wallpaper so its video_files row and
     * matching poster are cleaned up together with the media.
     */
    async findByUri(uri: string): Promise<{ digest: string; posterUri?: string } | null> {
      if (!uri) return null;
      try {
        const db = getDB();
        const result = await db.execute('SELECT * FROM video_files WHERE uri = ?', [uri]);
        if (result.rows.length === 0) return null;
        const row = result.rows[0];
        return {
          digest: toStr(row.digest),
          posterUri: row.poster_uri == null ? undefined : toStr(row.poster_uri),
        };
      } catch (error) {
        console.warn('WallpaperRepository.videoFiles.findByUri failed', error);
        return null;
      }
    },

    /**
     * Deduplicates a freshly imported video against the registry.
     *
     * When the picked video's SHA-1 matches an already-registered file, the
     * just-copied duplicate (video + its poster) is deleted and the previously
     * registered uri/poster are returned so the import reuses the existing
     * copy. When it is a new video, the new file is registered and returned
     * unchanged.
     */
    async resolvePickedVideo(
      picked: PickedVideo,
    ): Promise<{ uri: string; posterUri?: string }> {
      if (!picked.uri) return { uri: '', posterUri: undefined };

      // Videos with no digest (digest error) cannot be deduplicated; register
      // nothing and keep the copy as-is.
      if (!picked.digest) {
        return { uri: picked.uri, posterUri: picked.posterUri };
      }

      const existing = await this.findByDigest(picked.digest);
      if (existing) {
        const sameFile = existing.uri === picked.uri;
        if (!sameFile) {
          // The duplicate is already ours to discard. Remove the fresh copy
          // and its poster; posters are never covered by deleteStoredMedia's
          // pattern matching, so delete them explicitly.
          try {
            await wallpaperBridge.deleteStoredMedia(picked.uri);
          } catch (error) {
            console.warn('Failed to remove duplicate video file', error);
          }
          if (picked.posterUri) {
            try {
              await wallpaperBridge.deleteStoredMedia(picked.posterUri);
            } catch (error) {
              console.warn('Failed to remove duplicate video poster', error);
            }
          }
        }
        // Keep the original registration fresh (updated created_at), in case
        // the poster was regenerated.
        await this.registerFile({
          digest: picked.digest,
          uri: existing.uri,
          bytes: existing.bytes,
          posterUri: existing.posterUri ?? picked.posterUri,
        });
        return { uri: existing.uri, posterUri: existing.posterUri };
      }

      await this.registerFile({
        digest: picked.digest,
        uri: picked.uri,
        bytes: picked.bytes,
        posterUri: picked.posterUri,
      });
      return { uri: picked.uri, posterUri: picked.posterUri };
    },

    /**
     * All URIs referenced by any video wallpaper in the library. Used as the
     * "keep" set when pruning orphaned files over the storage quota.
     */
    async allReferencedUris(): Promise<Set<string>> {
      const referenced = new Set<string>();
      try {
        const db = getDB();
        const result = await db.execute(
          "SELECT video_uri FROM wallpapers WHERE video_uri IS NOT NULL AND video_uri != ''",
        );
        for (const row of result.rows) {
          const uri = toStr(row.video_uri);
          if (uri) referenced.add(uri);
        }
        // Poster JPEGs belong to the same wallpaper as their video, so they are
        // kept together when their video URI is referenced.
        const posters = await db.execute(
          'SELECT poster_uri FROM video_files WHERE poster_uri IS NOT NULL AND poster_uri != ?',
          [''],
        );
        for (const row of posters.rows) {
          const posterUri = toStr(row.poster_uri);
          if (posterUri) referenced.add(posterUri);
        }
      } catch (error) {
        console.warn('WallpaperRepository.videoFiles.allReferencedUris failed', error);
      }
      return referenced;
    },

    /**
     * Removes a digest entry (called after its file is deleted).
     */
    async remove(digest: string): Promise<void> {
      if (!digest) return;
      try {
        const db = getDB();
        await db.execute('DELETE FROM video_files WHERE digest = ?', [digest]);
      } catch (error) {
        console.warn('WallpaperRepository.videoFiles.remove failed', error);
      }
    },

    /**
     * Every registered digest. Used by the storage quota keeper to keep the
     * software-playback sequence directory (seq_<digest10>) of every still
     * registered video.
     */
    async allDigests(): Promise<string[]> {
      try {
        const db = getDB();
        const result = await db.execute('SELECT digest FROM video_files WHERE digest != ?', ['']);
        return result.rows.map(row => toStr(row.digest)).filter((d): d is string => d.length > 0);
      } catch (error) {
        console.warn('WallpaperRepository.videoFiles.allDigests failed', error);
        return [];
      }
    },
  },
};
