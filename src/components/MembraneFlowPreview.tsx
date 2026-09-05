import React from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

type Props = { compact?: boolean; accent?: string };

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * "Crimson Bloom" — a soft OnePlus-fluid-style composition built from a handful
 * of enormous translucent blobs in the chosen accent hue. Unlike the old
 * "supernova" membrane (bright core + rotating rays), there is no hard or
 * jarring motion: each blob drifts and swells extremely slowly and seamlessly.
 *
 * Performance: one Animated.Value + one Animated.View per blob, all motion via
 * transforms + opacity with useNativeDriver: true (native UI thread).
 */
export const MembraneFlowPreview = React.memo(function ({ compact = false, accent = '#E883B0' }: Props) {
  const stageWidth = compact ? 92 : 250;
  const stageHeight = compact ? 150 : 420;
  const centerX = stageWidth / 2;
  const centerY = stageHeight / 2;

  const [ar, ag, ab] = hexToRgb(accent);

  // All blobs strictly follow the accent hue; only lightness (value) and alpha
  // vary.
  const maxC = Math.max(ar, ag, ab) / 255;
  const minC = Math.min(ar, ag, ab) / 255;
  const delta = maxC - minC;
  let hue = 0;
  if (delta !== 0) {
    if (maxC === ar / 255) hue = 60 * (((ag / 255 - ab / 255) / delta) % 6);
    else if (maxC === ag / 255) hue = 60 * ((ab / 255 - ar / 255) / delta + 2);
    else hue = 60 * ((ar / 255 - ag / 255) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const sat = delta === 0 ? 0 : maxC === 0 ? 0 : delta / maxC;
  const hsv = (v: number, a: number) => {
    const c = sat * v;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = v - c;
    let r2 = 0, g2 = 0, b2 = 0;
    if (hue < 60) { r2 = c; g2 = x; }
    else if (hue < 120) { r2 = x; g2 = c; }
    else if (hue < 180) { g2 = c; b2 = x; }
    else if (hue < 240) { g2 = x; b2 = c; }
    else if (hue < 300) { r2 = x; b2 = c; }
    else { r2 = c; b2 = x; }
    return `rgba(${Math.round((r2 + m) * 255)}, ${Math.round((g2 + m) * 255)}, ${Math.round((b2 + m) * 255)}, ${a})`;
  };

  // 4 blobs + 1 soft central bloom highlight.
  const phases = React.useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  const blobs = React.useMemo(() => {
    const sizes = [1.05, 0.9, 1.0, 0.78];
    const baseXs = [0.22, 0.7, 0.42, 0.82];
    const baseYs = [0.28, 0.62, 0.78, 0.38];
    const driftAmps = [0.07, 0.06, 0.075, 0.055];
    const values = [0.32, 0.22, 0.16, 0.28];
    const alphas = [0.55, 0.5, 0.6, 0.46];
    return Array.from({ length: 4 }, (_, i) => ({
      size: stageWidth * sizes[i],
      color: hsv(values[i], alphas[i]),
      offsetX: (baseXs[i] - 0.5) * stageWidth,
      offsetY: (baseYs[i] - 0.5) * stageHeight,
      drift: stageWidth * driftAmps[i],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, stageWidth, stageHeight]);

  React.useEffect(() => {
    const loops = phases.map(v =>
      Animated.loop(
        Animated.timing(v, {
          toValue: 1,
          duration: 30000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ),
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Soft breathing bloom highlight near the centre, gently swelling in value.
  const bloomValue = phases[4];
  const bloomScale = bloomValue.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.2] });
  const bloomOpacity = bloomValue.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.35, 0.7, 0.35] });

  return (
    <View style={[styles.stage, { width: stageWidth, height: stageHeight }]}>
      {blobs.map((blob, i) => {
        const baseX = centerX + blob.offsetX;
        const baseY = centerY + blob.offsetY;
        const driftX = phases[i].interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [baseX - blob.drift, baseX + blob.drift * 0.9, baseX - blob.drift],
        });
        const driftY = phases[i].interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [baseY - blob.drift * 0.7, baseY + blob.drift, baseY - blob.drift * 0.7],
        });
        const scale = phases[i].interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0.9, 1.2, 0.9],
        });
        const opacity = phases[i].interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0.8, 1, 0.8],
        });
        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={[
              styles.blob,
              {
                width: blob.size,
                height: blob.size,
                borderRadius: blob.size / 2,
                backgroundColor: blob.color,
                marginLeft: -blob.size / 2,
                marginTop: -blob.size / 2,
                opacity,
                transform: [
                  { translateX: driftX },
                  { translateY: driftY },
                  { scale },
                ],
              },
            ]}
          />
        );
      })}

      {/* Soft central bloom highlight */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.blob,
          styles.bloom,
          {
            width: stageWidth * 0.9,
            height: stageWidth * 0.9,
            borderRadius: (stageWidth * 0.9) / 2,
            left: centerX,
            top: centerY,
            opacity: bloomOpacity,
            transform: [{ scale: bloomScale }],
          },
        ]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  stage: {
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#1F2937',
    backgroundColor: '#05070C',
  },
  blob: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  bloom: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginLeft: 0,
    marginTop: 0,
  },
});
