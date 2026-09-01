import React from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

type Props = { compact?: boolean; accent?: string };

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

/**
 * A premium "membrane" (Crimson Bloom) approximation made purely from a few
 * enormous translucent animated Views. One huge curved boundary separates a
 * luminous soft pink/lavender field (left/lower) from a deep crimson/wine field
 * (right/lower) over a spacious midnight-navy void (upper/right). On top, a
 * bright breathing "supernova" core emits luminous rays that slowly rotate and
 * stream outward, giving the otherwise calm surfaces an active, moving energy.
 */
export const MembraneFlowPreview = React.memo(function ({ compact = false, accent = '#E883B0' }: Props) {
  const stageWidth = compact ? 92 : 250;
  const stageHeight = compact ? 150 : 420;

  const phases = React.useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    // supernova heartbeat + slow rotation of the rays
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  const [ar, ag, ab] = hexToRgb(accent);
  const accentSoft = `rgba(${ar}, ${ag}, ${ab}, 0.42)`;

  // Enormous soft surfaces seeded around the accent. Each is a long, wide
  // translucent sheet; their borders blend into the neighbours so the only
  // visual structure is the giant organic curve between the light and dark.
  const fields: {
    value: Animated.Value;
    dur: number;
    w: number;
    h: number;
    color: string;
    baseX: number;
    baseY: number;
    phase: number;
  }[] = [
    // deep midnight-navy void (upper, accent-tinted, very dark)
    { value: phases[0], dur: 34000, w: stageWidth * 1.5, h: stageHeight * 1.1, color: 'rgba(6, 12, 34, 0.95)', baseX: 0.15, baseY: -0.05, phase: 0.0 },
    // luminous pink/lavender glow (lower-left)
    { value: phases[1], dur: 40000, w: stageWidth * 1.5, h: stageHeight * 1.05, color: accentSoft, baseX: 0.18, baseY: 0.68, phase: 1.7 },
    // deep crimson / wine (lower-right)
    { value: phases[2], dur: 38000, w: stageWidth * 1.3, h: stageHeight * 0.95, color: 'rgba(120, 12, 44, 0.85)', baseX: 0.82, baseY: 0.72, phase: 3.1 },
    // dominant curved boundary highlight (pale lavender sweep)
    { value: phases[3], dur: 30000, w: stageWidth * 0.9, h: stageHeight * 1.2, color: 'rgba(216, 180, 254, 0.32)', baseX: 0.4, baseY: 0.42, phase: 4.6 },
  ];

  React.useEffect(() => {
    const loops = phases.map((value, i) => {
      const dur = i < 4 ? fields[i].dur : i === 4 ? 2600 : 14000;
      const useInOut = i !== 5;
      return Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration: dur,
          easing: useInOut ? Easing.inOut(Easing.sin) : Easing.linear,
          useNativeDriver: true,
        }),
      );
    });
    loops.forEach(loop => loop.start());
    return () => loops.forEach(loop => loop.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sheetDefs = fields.map((field, i) => {
    const translateX = field.value.interpolate({
      inputRange: [0, 1],
      outputRange: [
        field.baseX * stageWidth - field.w * 0.45 - (i % 2 === 0 ? stageWidth * 0.06 : -stageWidth * 0.06),
        field.baseX * stageWidth - field.w * 0.45 + (i % 2 === 0 ? stageWidth * 0.12 : -stageWidth * 0.12),
      ],
    });
    const translateY = field.value.interpolate({
      inputRange: [0, 1],
      outputRange: [
        field.baseY * stageHeight - field.h * 0.5 - field.h * 0.05,
        field.baseY * stageHeight - field.h * 0.5 + field.h * 0.05,
      ],
    });
    const scaleX = field.value.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.15] });
    const scaleY = field.value.interpolate({ inputRange: [0, 1], outputRange: [1.12, 0.9] });
    const rotate = field.value.interpolate({
      inputRange: [0, 1],
      outputRange: [`${-6 + i * 4}deg`, `${6 + i * 4}deg`],
    });
    const radius = field.h / 2;
    return { field, translateX, translateY, scaleX, scaleY, rotate, radius };
  });

  // Supernova core: breathes in/out while the radiating rays slowly rotate.
  const corePulse = phases[4];
  const raySpin = phases[5];
  const core = {
    scale: corePulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.25] }),
    opacity: corePulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
  };
  const spin = raySpin.interpolate({ inputRange: [0, 1], outputRange: ['-20deg', '340deg'] });

  const coreX = stageWidth * 0.34;
  const coreY = stageHeight * 0.7;
  const coreR = compact ? 7 : 13;
  const rayCount = 10;
  const rayLen = compact ? 26 : 52;
  const rayCol = `rgba(${Math.min(255, ar + 40)}, ${Math.min(255, ag + 40)}, ${Math.min(255, ab + 40)}, 0.55)`;

  const rayAngles = Array.from({ length: rayCount }, (_, i) => (i / rayCount) * 360);

  return (
    <View
      style={[
        styles.stage,
        { width: stageWidth, height: stageHeight, backgroundColor: '#020610' },
      ]}>
      {sheetDefs.map((s, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            styles.sheet,
            {
              width: s.field.w,
              height: s.field.h,
              borderRadius: s.radius,
              backgroundColor: s.field.color,
              transform: [
                { translateX: s.translateX },
                { translateY: s.translateY },
                { scaleX: s.scaleX },
                { scaleY: s.scaleY },
                { rotate: s.rotate },
              ],
            },
          ]}
        />
      ))}

      {/* Rotating supernova rays streaming from the core */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.rays,
          { left: coreX, top: coreY, transform: [{ rotate: spin }] },
        ]}>
        {rayAngles.map((deg, i) => (
          <View
            key={i}
            style={[
              styles.ray,
              {
                left: -rayLen / 2,
                top: -1,
                width: rayLen,
                backgroundColor: rayCol,
                opacity: 0.35 + 0.4 * ((i + 1) % 3) / 2,
                transform: [{ rotate: `${deg}deg` }],
              },
            ]}
          />
        ))}
      </Animated.View>

      {/* Bright breathing supernova heart */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.core,
          {
            left: coreX - coreR,
            top: coreY - coreR,
            width: coreR * 2,
            height: coreR * 2,
            borderRadius: coreR,
            opacity: core.opacity,
            transform: [{ scale: core.scale }],
          },
        ]}>
        <View style={[styles.coreInner, { backgroundColor: 'rgba(255,255,255,0.85)' }]} />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  stage: {
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#1F2937',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  rays: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
  ray: {
    position: 'absolute',
    height: 2,
    borderRadius: 1,
  },
  core: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreInner: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
  },
});
