import React from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

type Props = {
  level?: number;
  charging?: boolean;
  compact?: boolean;
  accent?: string;
};

/* ── colour helpers ────────────────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  return [h, s, v];
}

/**
 * JS approximation of the native battery-fluid wallpaper.  The fluid colour
 * shifts through a full health spectrum driven by battery level: red/orange at
 * low, green/cyan in the healthy mid-range, and fresh blue at full.  The
 * accent seeds the hue family so the custom colour picker still matters.
 */
export const BatteryFluidPreview = React.memo(function ({ level = 50, charging = false, compact = false, accent }: Props) {
  const stageHeight = compact ? 150 : 420;
  const stageWidth = compact ? 92 : 250;
  const baseRadius = compact ? 18 : 28;

  const targetPx = (Math.max(0, Math.min(100, level)) / 100) * stageHeight;
  const fillAnim = React.useRef(new Animated.Value(targetPx)).current;
  const pulse = React.useRef(new Animated.Value(0)).current;
  const drift = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: targetPx,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [level, targetPx, fillAnim]);

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);

  /* ── Health-spectrum colour driven by battery level ────────────────────────
   * Shifts through a full hue range so the level is readable at a glance:
   *   level 0   → hue −110° (red/orange, urgent)
   *   level 50% → hue ±0°   (accent / healthy mid)
   *   level 100%→ hue +130° (fresh cyan-blue, full)
   * The accent seeds the hue family so the custom colour picker still matters.
   */
  const [r, g, b] = hexToRgb(accent || '#22C55E');
  const [accentHue, satRaw] = rgbToHsv(r, g, b);
  const sat = Math.max(0.65, satRaw);
  const fillRatio = Math.max(0.04, Math.min(1, level / 100));
  // +240° sweep from −110° to +130° around the accent hue, matching the native ramp.
  const hue = (((accentHue - 110 + 240 * fillRatio) % 360) + 360) % 360;
  const light = charging ? 60 : 52;
  const bodyColor = `hsl(${hue}, ${Math.round(sat * 100)}%, ${light}%)`;
  const deepColor = `hsl(${hue}, ${Math.round(Math.max(50, sat * 110))}%, 32%)`;
  const topBand = `hsla(${hue}, ${Math.round(Math.min(100, sat * 120))}%, 82%, 0.55)`;

  const opac = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, charging ? 1 : 0.8] });
  const sway = drift.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-10, 8, -10] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, charging ? 0.85 : 0.5] });

  return (
    <View
      style={[
        styles.stage,
        {
          width: stageWidth,
          height: stageHeight,
          borderRadius: baseRadius,
        },
      ]}>
      <Animated.View
        style={[
          styles.liquid,
          {
            height: fillAnim,
            backgroundColor: bodyColor,
            borderRadius: baseRadius,
            opacity: opac,
            transform: [{ translateX: sway }],
          },
        ]}>
        <View style={[styles.liquidBand, { backgroundColor: topBand }]} />
        <View style={[styles.liquidDeep, { backgroundColor: deepColor }]} />
      </Animated.View>

      {!compact && (
        <View style={styles.txtLayer} pointerEvents="none">
          <Text style={styles.percent}>{Math.round(level)}%</Text>
          <Text style={styles.caption}>{charging ? 'CHARGING' : 'BATTERY'}</Text>
        </View>
      )}
      {charging && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.chargingGlow,
            { borderColor: `hsl(${hue}, ${Math.round(Math.min(100, sat * 120))}%, 75%)`, opacity: glow },
          ]}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  stage: {
    backgroundColor: '#060A10',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#1F2937',
  },
  liquid: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    justifyContent: 'flex-start',
  },
  liquidBand: {
    width: '120%',
    height: 26,
    borderRadius: 13,
    marginLeft: -10,
  },
  liquidDeep: {
    flex: 1,
    width: '100%',
  },
  txtLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percent: {
    color: '#FFFFFF',
    fontSize: 46,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  caption: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 3,
    marginTop: 4,
  },
  chargingGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 28,
    borderWidth: 3,
  },
});
