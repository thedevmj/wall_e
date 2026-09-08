import React from 'react';
import { Animated, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { useThemedStyles } from '../theme/ThemeContext';
import type { Wallpaper } from '../types';

type WallpaperCardProps = {
  wallpaper: Wallpaper;
  index: number;
  onPress?: (id: string) => void;
  onDelete?: (id: string) => void;
};

export function WallpaperCard({ wallpaper, index, onPress, onDelete }: WallpaperCardProps) {
  const styles = useThemedStyles();
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
        styles.wcCard,
        { borderLeftColor: wallpaper.accent },
        index % 2 === 0 ? styles.wcCardLeft : styles.wcCardRight,
      ]}
    >
      <Animated.View style={[styles.wcIndicator, { backgroundColor: wallpaper.accent, transform: [{scale: pulse}] }]} />
      <View style={styles.wcContent}>
        <Text style={styles.wcTitle}>{wallpaper.title}</Text>
        <Text style={styles.wcDescription}>{wallpaper.description}</Text>
        <View style={styles.wcMetaRow}>
          <Text style={styles.wcMeta}>{wallpaper.kind.toUpperCase()}</Text>
          <Text style={styles.wcMeta}>{wallpaper.duration}</Text>
        </View>
      </View>
      <Text style={styles.wcStatus}>{wallpaper.status}</Text>
      {wallpaper.kind === 'video' && onDelete && (
        <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${wallpaper.title}`} onPress={() => onDelete(wallpaper.id)} style={styles.wcDeleteButton}>
          <Text style={styles.wcDeleteText}>Delete</Text>
        </Pressable>
      )}
    </TouchableOpacity>
  );
}

