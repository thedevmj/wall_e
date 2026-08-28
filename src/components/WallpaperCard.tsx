import React from 'react';
import { Animated, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Wallpaper } from '../types';

type WallpaperCardProps = {
  wallpaper: Wallpaper;
  index: number;
  onPress?: (id: string) => void;
  onDelete?: (id: string) => void;
};

export function WallpaperCard({ wallpaper, index, onPress, onDelete }: WallpaperCardProps) {
  const pulse = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {toValue: 1.18, duration: 1100 + index * 160, useNativeDriver: true}),
        Animated.timing(pulse, {toValue: 1, duration: 1100 + index * 160, useNativeDriver: true}),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [index, pulse]);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      activeOpacity={0.9}
      onPress={() => onPress?.(wallpaper.id)}
      style={[
        styles.card,
        { borderLeftColor: wallpaper.accent },
        index % 2 === 0 ? styles.cardLeft : styles.cardRight,
      ]}
    >
      <Animated.View style={[styles.indicator, { backgroundColor: wallpaper.accent, transform: [{scale: pulse}] }]} />
      <View style={styles.content}>
        <Text style={styles.title}>{wallpaper.title}</Text>
        <Text style={styles.description}>{wallpaper.description}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{wallpaper.kind.toUpperCase()}</Text>
          <Text style={styles.meta}>{wallpaper.duration}</Text>
        </View>
      </View>
      <Text style={styles.status}>{wallpaper.status}</Text>
      {wallpaper.kind === 'video' && onDelete && (
        <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${wallpaper.title}`} onPress={() => onDelete(wallpaper.id)} style={styles.deleteButton}>
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 18,
    borderLeftWidth: 5,
    marginBottom: 14,
    padding: 14,
    minHeight: 110,
  },
  cardLeft: {
    marginRight: 4,
  },
  cardRight: {
    marginLeft: 4,
  },
  indicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  content: {
    flex: 1,
    gap: 6,
  },
  title: {
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 4,
    fontSize: 18,
    fontWeight: '700',
  },
  description: {
    color: '#E2E8F0',
    fontSize: 13,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  meta: {
    color: '#B0BEC5',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  status: {
    color: '#E0FFFF',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 8,
  },
  deleteButton: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  deleteText: {
    color: '#FFC2C2',
    fontSize: 11,
    fontWeight: '800',
  },
});
