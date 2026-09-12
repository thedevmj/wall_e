import React from 'react';
import { View, Pressable, Text, StyleSheet, useWindowDimensions } from 'react-native';
import type { Wallpaper } from '../types';
import { COLORS, SPACING, RADIUS } from './theme';
import { WallpaperThumb } from './WallpaperThumb';

type Props = {
  wallpaper: Wallpaper;
  onPress: (w: Wallpaper) => void;
  onToggleFavorite: (id: string) => void;
  isFavorite: boolean;
};

export function WallpaperCard({ wallpaper, onPress, onToggleFavorite, isFavorite }: Props) {
  const { width } = useWindowDimensions();
  const cardWidth = (width - SPACING.lg * 2 - SPACING.md) / 2;

  return (
    <Pressable
      style={[styles.card, { width: cardWidth }]}
      onPress={() => onPress(wallpaper)}
      accessibilityRole="button"
      accessibilityLabel={`${wallpaper.title}, ${wallpaper.kind === 'video' ? 'live wallpaper' : 'wallpaper'}`}>
      <View style={[styles.art, { width: cardWidth, height: cardWidth * 1.4 }]}>
        <WallpaperThumb wallpaper={wallpaper} style={styles.cover} />
        {wallpaper.kind === 'video' && (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        )}
        <Pressable
          onPress={() => onToggleFavorite(wallpaper.id)}
          style={styles.favBtn}
          accessibilityRole="button"
          accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
          <Text style={[styles.favIcon, isFavorite && styles.favIconActive]}>
            {isFavorite ? '\u2665' : '\u2661'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {wallpaper.title}
      </Text>
    </Pressable>
  );
}

export function LoadingCard() {
  const { width } = useWindowDimensions();
  const cardWidth = (width - SPACING.lg * 2 - SPACING.md) / 2;

  return (
    <View style={[styles.card, { width: cardWidth }]}>
      <View
        style={[
          styles.art,
          styles.artLoading,
          { width: cardWidth, height: cardWidth * 1.4 },
        ]}>
        <View style={styles.spinner} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: SPACING.lg,
  },
  art: {
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.card,
    overflow: 'hidden',
    position: 'relative',
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  artLoading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 3,
    borderColor: COLORS.border,
    borderTopColor: COLORS.cyan,
  },
  liveBadge: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.cyan,
  },
  liveText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.cyan,
    letterSpacing: 0.8,
  },
  favBtn: {
    position: 'absolute',
    bottom: SPACING.sm,
    right: SPACING.sm,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: COLORS.translucentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favIcon: {
    fontSize: 18,
    color: COLORS.white,
  },
  favIconActive: {
    color: COLORS.cyan,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: SPACING.sm,
    paddingHorizontal: 2,
  },
});