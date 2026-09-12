import React from 'react';
import { Image, View, StyleSheet } from 'react-native';
import type { ImageStyle, StyleProp, ViewStyle } from 'react-native';
import { GeometricArt } from '../components/GeometricArt';
import { BatteryFluidPreview } from '../components/BatteryFluidPreview';
import { MembraneFlowPreview } from '../components/MembraneFlowPreview';
import { FluidFlowPreview } from '../components/FluidFlowPreview';
import type { Wallpaper } from '../types';
import { COLORS } from './theme';

type Props = {
  wallpaper: Wallpaper;
  style?: StyleProp<ImageStyle>;
};

/**
 * Renders a lightweight preview of a wallpaper's media — the poster frame for
 * videos (no video decoder is opened in lists), the image for statics, and a
 * compact live preview for the dynamic kinds. Anything unresolved falls back to
 * placeholder art so a card is never blank.
 */
export function WallpaperThumb({ wallpaper, style }: Props) {
  if (wallpaper.kind === 'static') {
    const source = wallpaper.source ?? (wallpaper.imageUri ? { uri: wallpaper.imageUri } : undefined);
    return <Image source={source} resizeMode="cover" resizeMethod="resize" style={style} />;
  }

  if (wallpaper.kind === 'video') {
    if (wallpaper.poster) {
      return (
        <Image
          source={wallpaper.poster}
          resizeMode="cover"
          resizeMethod="resize"
          style={style}
        />
      );
    }
    return (
      <View style={[placeholderStyle, style]}>
        <GeometricArt accent={wallpaper.accent} size={90} seed={wallpaper.id.length} />
      </View>
    );
  }

  if (wallpaper.kind === 'battery') {
    return (
      <View style={[styles.dynamicBattery, style]}>
        <BatteryFluidPreview level={60} charging={false} compact />
      </View>
    );
  }

  if (wallpaper.kind === 'membrane') {
    return (
      <View style={[styles.dynamicMembrane, style]}>
        <MembraneFlowPreview compact accent={wallpaper.accent} />
      </View>
    );
  }

  if (wallpaper.kind === 'fluid') {
    return (
      <View style={[styles.dynamicFluid, style]}>
        <FluidFlowPreview compact accent={wallpaper.accent} />
      </View>
    );
  }

  return (
    <View style={[placeholderStyle, style]}>
      <GeometricArt accent={wallpaper.accent} size={140} seed={wallpaper.id.length} />
    </View>
  );
}

const placeholderStyle: StyleProp<ViewStyle> = {
  backgroundColor: COLORS.card,
  alignItems: 'center',
  justifyContent: 'center',
};

const dynamicCentering: ViewStyle = {
  alignItems: 'center',
  justifyContent: 'center',
};

const styles = StyleSheet.create({
  dynamicBattery: { ...dynamicCentering, backgroundColor: '#060A10' },
  dynamicMembrane: { ...dynamicCentering, backgroundColor: '#020610' },
  dynamicFluid: { ...dynamicCentering, backgroundColor: '#000000' },
});

export const thumbFallbackStyles = StyleSheet.create({
  cover: {
    width: '100%',
    height: '100%',
  },
});