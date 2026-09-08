import { wallpaperBridge } from './wallpaperBridge';

/**
 * Serializes software-playback frame-sequence extractions.
 *
 * `prepareVideoFrameSequence` decodes and compresses the whole video off-thread
 * and is expensive on low-RAM phones. Firing many at once (create + apply +
 * replace) could OOM a 4GB device. This module runs them strictly one at a
 * time (a FIFO promise chain) and de-duplicates in-flight requests by URI so
 * the same video is never extracted twice concurrently. Native extraction is
 * cached on disk, so re-requesting an already-extracted video is cheap and is
 * still just forwarded (it short-circuits natively).
 */

type PendingTask = {
  uri: string;
  resolve: (value: SequenceInfo | null) => void;
  reject: (error: unknown) => void;
};

export type SequenceInfo = {
  dir: string;
  frames: number;
  fps: number;
};

type Job = {
  uri: string;
  tasks: PendingTask[];
};

const queue: Job[] = [];
let running = false;

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      try {
        const info = await wallpaperBridge.prepareVideoFrameSequence(job.uri);
        for (const task of job.tasks) {
          task.resolve(
            info && typeof info.dir === 'string' && info.dir
              ? { dir: info.dir, frames: info.frames, fps: info.fps }
              : null,
          );
        }
      } catch (error) {
        for (const task of job.tasks) {
          task.reject(error);
        }
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Requests a frame-sequence extraction for [uri], serialized behind any other
 * pending extractions. Concurrent calls for the same URI share one extraction.
 * Returns the extraction summary on success or null when native is unavailable.
 */
export function enqueueVideoSequence(uri: string): Promise<SequenceInfo | null> {
  if (!uri) return Promise.resolve(null);

  return new Promise<SequenceInfo | null>((resolve, reject) => {
    const existing = queue.find(job => job.uri === uri);
    if (existing) {
      existing.tasks.push({ uri, resolve, reject });
      return;
    }
    queue.push({ uri, tasks: [{ uri, resolve, reject }] });
    pump().catch(() => undefined);
  });
}