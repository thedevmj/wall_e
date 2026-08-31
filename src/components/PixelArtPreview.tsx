import React from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

type Props = { compact?: boolean };

const PALETTE = ['#FF006E', '#00D9FF', '#8338EC', '#FFBE0B'];

/**
 * JS approximation of the native pixel-art wallpaper. A coarse grid of retro
 * "pixel" blocks colored from the four-brand palette, with a soft global pulse
 * and two translucent wave bands that sweep diagonally to hint at the native
 * flowing motion. All animation uses useNativeDriver: false.
 */
export function PixelArtPreview({ compact = false }: Props) {
  const stageWidth = compact ? 92 : 250;
  const stageHeight = compact ? 150 : 420;

  const cols = 8;
  const rows = compact ? 12 : 24;
  const cellW = stageWidth / cols;
  const cellH = stageHeight / rows;

  const pulse = React.useRef(new Animated.Value(0)).current;
  const sweep = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 2600,
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
      Animated.timing(sweep, {
        toValue: 1,
        duration: 6000,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const stageOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });

  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = (col * 7 + row * 13 + Math.floor((col + row) / 4)) % 4;
      const fade = ((col + row) % 3) * 0.07;
      const isFlat = ((col + row) % 5) === 0;
      cells.push(
        <View
          key={`${col}-${row}`}
          style={{
            position: 'absolute',
            left: col * cellW,
            top: row * cellH,
            width: cellW + 0.5,
            height: cellH + 0.5,
            backgroundColor: PALETTE[index],
            opacity: isFlat ? 1 : 0.85 - fade,
          }}
        />,
      );
    }
  }

  const sweepX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-stageWidth, stageWidth] });

  return (
    <Animated.View
      style={[
        styles.stage,
        { width: stageWidth, height: stageHeight, opacity: stageOpacity },
      ]}>
      {cells}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.wave,
          {
            left: sweepX,
            top: -stageHeight * 0.3,
            height: stageHeight * 1.6,
            backgroundColor: 'rgba(0,217,255,0.10)',
            transform: [{ rotate: '18deg' }],
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.wave,
          {
            left: sweepX,
            top: stageHeight * 0.45,
            height: stageHeight * 0.7,
            backgroundColor: 'rgba(255,0,110,0.10)',
            transform: [{ rotate: '-14deg' }],
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: {
    backgroundColor: '#0a0a0a',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#1F2937',
  },
  wave: {
    position: 'absolute',
    width: 180,
  },
});
