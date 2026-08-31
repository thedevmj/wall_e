import React from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

type Props = {
  level?: number;
  charging?: boolean;
  compact?: boolean;
};

/**
 * JS approximation of the native battery-fluid wallpaper. This is not the real
 * accelerometer/gyro feed (that only runs inside the wallpaper service), but it
 * previews the animated liquid, the color-by-level behaviour and the charging
 * state so the user knows what they will get before applying.
 */
export function BatteryFluidPreview({ level = 50, charging = false, compact = false }: Props) {
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

  const fillRatio = Math.max(0.04, Math.min(1, level / 100));
  const hue = fillRatio * 120;
  const bodyColor = `hsl(${hue}, 75%, ${charging ? 60 : 52}%)`;
  const deepColor = `hsl(${hue}, 82%, 32%)`;
  const topBand = `hsla(${hue}, 90%, 82%, 0.55)`;

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
            { borderColor: `hsl(${hue}, 90%, 75%)`, opacity: glow },
          ]}
        />
      )}
    </View>
  );
}

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
