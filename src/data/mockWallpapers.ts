import type { Wallpaper } from '../types';

export const mockWallpapers: Wallpaper[] = [
  {
    id: 'doodle-aurora',
    title: 'Aurora Drift',
    kind: 'doodle',
    description: 'Glowing motion loops with soft oscillating strokes.',
    accent: '#7C3AED',
    status: 'Applied',
    duration: '18 sec',
    createdAt: 'Today',
  },
  {
    id: 'video-sunset',
    title: 'Sunset Pulse',
    kind: 'video',
    description: 'Warm cinematic clip with repeat playback and muted audio.',
    accent: '#F97316',
    status: 'Ready',
    duration: '25 sec',
    createdAt: '2 days ago',
  },
  {
    id: 'doodle-spark',
    title: 'Spark Bloom',
    kind: 'doodle',
    description: 'Particle field with layered gradients and slow fade loops.',
    accent: '#10B981',
    status: 'Needs preview',
    duration: '12 sec',
    createdAt: '4 days ago',
  },
];
