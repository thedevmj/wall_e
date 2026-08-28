import React from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Color helpers for the abstract art: convert a hex accent into a small
 * palette of translucent tints so every wallpaper gets a unique gradient feel.
 */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map(c => c + c)
          .join('')
      : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function mix(hex: string, towardWhite: boolean, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = towardWhite ? 255 : 0;
  const mixChannel = (c: number) => Math.round(c + (target - c) * amount);
  return `rgba(${mixChannel(r)}, ${mixChannel(g)}, ${mixChannel(b)}, 1)`;
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type GeometricArtProps = {
  accent: string;
  size: number;
  seed?: number;
};

/**
 * Deterministic geometric composition made only out of Views: rings,
 * diamonds, circles, triangles and dots. `seed` picks an arrangement so
 * each wallpaper looks different from the others.
 */
export function GeometricArt({ accent, size, seed = 0 }: GeometricArtProps) {
  const light = mix(accent, true, 0.55);
  const paper = mix(accent, true, 0.78);
  const deep = mix(accent, false, 0.4);
  const variant = Math.abs(seed) % 3;

  const diamond = Math.round(size * 0.42);
  const ring = Math.round(size * 0.5);
  const orb = Math.round(size * 0.26);
  const dot = Math.round(size * 0.07);

  const placement = [
    // variant 0: diamond center, ring top-left, orb bottom-right
    { diamondX: size * 0.32, diamondY: size * 0.28, ringX: -size * 0.2, ringY: size * 0.02, orbX: size * 0.58, orbY: size * 0.55 },
    // variant 1: diamond right, ring bottom-right, orb top-left
    { diamondX: size * 0.52, diamondY: size * 0.4, ringX: size * 0.58, ringY: size * 0.5, orbX: -size * 0.12, orbY: size * 0.08 },
    // variant 2: diamond left, ring center-right, orb top-right
    { diamondX: size * 0.14, diamondY: size * 0.42, ringX: size * 0.5, ringY: size * 0.02, orbX: size * 0.62, orbY: size * 0.1 },
  ][variant];

  return (
    <View
      style={[styles.art, { width: size, height: size, backgroundColor: paper }]}>
      {/* soft glow blobs */}
      <View style={[styles.blob, { width: size * 0.9, height: size * 0.9, borderRadius: size * 0.45, backgroundColor: rgba(accent, 0.28), top: -size * 0.35, left: -size * 0.2 }]} />
      <View style={[styles.blob, { width: size * 0.7, height: size * 0.7, borderRadius: size * 0.35, backgroundColor: rgba(accent, 0.22), bottom: -size * 0.25, right: -size * 0.15 }]} />

      {/* accent ring */}
      <View
        style={[
          styles.ring,
          {
            width: ring,
            height: ring,
            borderRadius: ring / 2,
            borderWidth: Math.max(3, ring * 0.16),
            borderColor: rgba(accent, 0.85),
            left: placement.ringX,
            top: placement.ringY,
          },
        ]}
      />

      {/* white diamond */}
      <View
        style={[
          styles.diamond,
          styles.diamondShine,
          {
            width: diamond,
            height: diamond,
            left: placement.diamondX,
            top: placement.diamondY,
          },
        ]}
      />

      {/* deep orb */}
      <View
        style={[
          styles.orb,
          {
            width: orb,
            height: orb,
            borderRadius: orb / 2,
            backgroundColor: deep,
            left: placement.orbX,
            top: placement.orbY,
          },
        ]}
      />

      {/* triangle */}
      <View
        style={[
          styles.triangle,
          {
            borderBottomWidth: size * 0.2,
            borderLeftWidth: size * 0.13,
            borderRightWidth: size * 0.13,
            borderBottomColor: rgba(accent, 0.75),
            right: size * 0.08,
            bottom: size * 0.12,
          },
        ]}
      />

      {/* dots */}
      <View style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2, backgroundColor: light, left: size * 0.16, bottom: size * 0.16 }]} />
      <View style={[styles.dot, { width: dot * 0.7, height: dot * 0.7, borderRadius: size * 0.035, backgroundColor: rgba(accent, 0.9), right: size * 0.2, top: size * 0.1 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  art: {
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
  },
  ring: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
  diamond: {
    position: 'absolute',
    transform: [{ rotate: '45deg' }],
  },
  diamondShine: {
    backgroundColor: 'rgba(255, 255, 255, 0.38)',
  },
  orb: {
    position: 'absolute',
  },
  triangle: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    backgroundColor: 'transparent',
  },
  dot: {
    position: 'absolute',
  },
});