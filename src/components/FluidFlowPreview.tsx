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
 * OnePlus-style animated fluid wallpaper.
 *
 * Performance: each blob is a single Animated.View with all motion driven by
 * one Animated.Value via useNativeDriver: true.  No layout props (left/top)
 * are animated — only transforms + opacity run on the native UI thread.
 */
export const FluidFlowPreview = React.memo(function ({ compact = false, accent = '#00B0FF' }: Props) {
  const stageWidth = compact ? 92 : 250;
  const stageHeight = compact ? 150 : 420;
  const centerX = stageWidth / 2;
  const centerY = stageHeight / 2;

  const [ar, ag, ab] = hexToRgb(accent);

  // 5 blobs — each gets one Animated.Value, one Animated.View
  const phases = React.useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  const blobs = React.useMemo(() => {
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

    // Fixed accent hue; only lightness (value) and alpha vary per blob so the
    // whole composition stays strictly in the chosen colour family.
    const hsv = (v: number) => {
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
      return [Math.round((r2 + m) * 255), Math.round((g2 + m) * 255), Math.round((b2 + m) * 255)];
    };

    const sizes = [0.88, 0.74, 0.96, 0.62, 0.8];
    const baseXs = [0.18, 0.62, 0.42, 0.82, 0.28];
    const baseYs = [0.22, 0.58, 0.78, 0.38, 0.68];
    const driftAmps = [0.07, 0.055, 0.08, 0.06, 0.05];
    const alphas = [0.5, 0.4, 0.46, 0.36, 0.42];
    const values = [0.55, 0.42, 0.6, 0.35, 0.5];

    return Array.from({ length: 5 }, (_, i) => {
      const [Rv, Gv, Bv] = hsv(values[i]);
      return {
        size: stageWidth * sizes[i],
        color: `rgba(${Rv}, ${Gv}, ${Bv}, ${alphas[i]})`,
        // Position offset from center (in pixels)
        offsetX: (baseXs[i] - 0.5) * stageWidth,
        offsetY: (baseYs[i] - 0.5) * stageHeight,
        drift: stageWidth * driftAmps[i],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, ar, ag, ab, stageWidth]);

  React.useEffect(() => {
    const loops = phases.map(v =>
      Animated.loop(
        Animated.timing(v, {
          toValue: 1,
          duration: 20000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ),
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.stage, { width: stageWidth, height: stageHeight }]}>
      {blobs.map((blob, i) => {
        // Bake static offset + drift into the interpolation ranges so translateX
        // and translateY carry everything (no runtime addition of number + node).
        const baseX = centerX + blob.offsetX;
        const baseY = centerY + blob.offsetY;
        const driftX = phases[i].interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [baseX - blob.drift, baseX + blob.drift * 0.8, baseX - blob.drift],
        });
        const driftY = phases[i].interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [baseY - blob.drift * 0.7, baseY + blob.drift * 0.9, baseY - blob.drift * 0.7],
        });
        const scale = phases[i].interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0.88, 1.18, 0.88],
        });
        const opacity = phases[i].interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0.82, 1, 0.82],
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
    </View>
  );
});

const styles = StyleSheet.create({
  stage: {
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#1F2937',
    backgroundColor: '#000000',
  },
  blob: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
