import React from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

type Props = { compact?: boolean };

/**
 * JS approximation of the native "Aura" premium flowing-gradient wallpaper.
 * A dark charcoal canvas with three large, soft translucent orbs (deep purple
 * / soft lavender) that drift and swell slowly.
 *
 * Performance: each orb is a single Animated.View with all motion driven by
 * one Animated.Value via useNativeDriver: true.  No layout props animated.
 */
export function AuraFlowPreview({ compact = false }: Props) {
  const stageWidth = compact ? 92 : 250;
  const stageHeight = compact ? 150 : 420;
  const centerX = stageWidth / 2;
  const centerY = stageHeight / 2;

  const phases = React.useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  const orbs = React.useMemo(() => [
    { size: stageWidth * 0.75, color: 'rgba(122,44,173,0.5)', baseX: 0.2, baseY: 0.25, drift: stageWidth * 0.12, dur: 13000 },
    { size: stageWidth * 0.9, color: 'rgba(206,147,216,0.32)', baseX: 0.55, baseY: 0.5, drift: stageWidth * 0.10, dur: 16000 },
    { size: stageWidth * 0.7, color: 'rgba(74,20,140,0.45)', baseX: 0.35, baseY: 0.72, drift: stageWidth * 0.11, dur: 20000 },
  ], [stageWidth]);

  React.useEffect(() => {
    const loops = orbs.map((orb, i) =>
      Animated.loop(
        Animated.timing(phases[i], {
          toValue: 1,
          duration: orb.dur,
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
      {orbs.map((orb, i) => {
        const baseX = centerX + (orb.baseX - 0.5) * stageWidth;
        const baseY = centerY + (orb.baseY - 0.5) * stageHeight;
        const driftX = phases[i].interpolate({
          inputRange: [0, 1],
          outputRange: [baseX - orb.drift, baseX + orb.drift],
        });
        const driftY = phases[i].interpolate({
          inputRange: [0, 1],
          outputRange: [baseY - orb.drift * 0.7, baseY + orb.drift * 0.7],
        });
        const scale = phases[i].interpolate({
          inputRange: [0, 1],
          outputRange: [0.85, 1.15],
        });

        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={[
              styles.orb,
              {
                width: orb.size,
                height: orb.size,
                borderRadius: orb.size / 2,
                backgroundColor: orb.color,
                opacity: 0.9,
                marginLeft: -orb.size / 2,
                marginTop: -orb.size / 2,
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
}

const styles = StyleSheet.create({
  stage: {
    backgroundColor: '#16161F',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#1F2937',
  },
  orb: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
