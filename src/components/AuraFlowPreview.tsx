import React from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

type Props = { compact?: boolean };

/**
 * JS approximation of the native "Aura" premium flowing-gradient wallpaper.
 * A dark charcoal canvas with three large, soft translucent orbs (deep purple
 * / soft lavender) that drift and swell slowly. Pure View layering + Animated
 * translation (all useNativeDriver: false), so it previews cheaply.
 */
export function AuraFlowPreview({ compact = false }: Props) {
  const stageWidth = compact ? 92 : 250;
  const stageHeight = compact ? 150 : 420;

  const phaseA = React.useRef(new Animated.Value(0)).current;
  const phaseB = React.useRef(new Animated.Value(0)).current;
  const phaseC = React.useRef(new Animated.Value(0)).current;

  const orbs: {
    value: Animated.Value;
    dur: number;
    size: number;
    color: string;
    baseX: number;
    baseY: number;
  }[] = [
    { value: phaseA, dur: 13000, size: stageWidth * 0.75, color: 'rgba(122,44,173,0.5)', baseX: 0.2, baseY: 0.25 },
    { value: phaseB, dur: 16000, size: stageWidth * 0.9, color: 'rgba(206,147,216,0.32)', baseX: 0.55, baseY: 0.5 },
    { value: phaseC, dur: 20000, size: stageWidth * 0.7, color: 'rgba(74,20,140,0.45)', baseX: 0.35, baseY: 0.72 },
  ];

  React.useEffect(() => {
    const loops = orbs.map(orb => {
      return Animated.loop(
        Animated.timing(orb.value, {
          toValue: 1,
          duration: orb.dur,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      );
    });
    loops.forEach(loop => loop.start());
    return () => loops.forEach(loop => loop.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      style={[
        styles.stage,
        { width: stageWidth, height: stageHeight },
      ]}>
      {orbs.map((orb, i) => {
        const left = orb.value.interpolate({
          inputRange: [0, 1],
          outputRange: [orb.baseX * stageWidth - orb.size * 0.3, orb.baseX * stageWidth + orb.size * 0.12],
        });
        const top = orb.value.interpolate({
          inputRange: [0, 1],
          outputRange: [orb.baseY * stageHeight - orb.size * 0.2, orb.baseY * stageHeight + orb.size * 0.15],
        });
        const scale = orb.value.interpolate({
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
                left,
                top,
                transform: [{ scale }],
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
  },
});
