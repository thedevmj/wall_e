import React from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  ScrollView,
  StyleSheet,
} from 'react-native';
import type { Wallpaper } from '../types';
import { COLORS, SPACING, RADIUS } from './theme';
import { LoadingCard, WallpaperCard } from './WallpaperCard';

type Section = 'All' | 'Live' | 'Static';

const CATEGORIES: Section[] = ['All', 'Live', 'Static'];

type Props = {
  wallpapers: Wallpaper[];
  favorites: Set<string>;
  onSelectWallpaper: (w: Wallpaper) => void;
  onToggleFavorite: (id: string) => void;
  onCreatePress: () => void;
  favoritesOnly?: boolean;
};

const INITIAL_LOAD_MS = 500;

export function HomeScreen({
  wallpapers,
  favorites,
  onSelectWallpaper,
  onToggleFavorite,
  onCreatePress,
  favoritesOnly = false,
}: Props) {
  const [section, setSection] = React.useState<Section>('All');
  const [search, setSearch] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const timer = setTimeout(() => setLoading(false), INITIAL_LOAD_MS);
    return () => clearTimeout(timer);
  }, []);

  const filtered = React.useMemo(() => {
    let items = wallpapers;
    if (favoritesOnly) {
      items = items.filter(w => favorites.has(w.id));
    } else if (section === 'Live') {
      items = items.filter(w => w.kind === 'video');
    } else if (section === 'Static') {
      items = items.filter(w => w.kind === 'static');
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(
        w => w.title.toLowerCase().includes(q) || w.description.toLowerCase().includes(q),
      );
    }
    return items;
  }, [wallpapers, section, search, favorites, favoritesOnly]);

  const renderCard = React.useCallback(
    ({ item }: { item: Wallpaper }) => (
      <WallpaperCard
        wallpaper={item}
        isFavorite={favorites.has(item.id)}
        onPress={onSelectWallpaper}
        onToggleFavorite={onToggleFavorite}
      />
    ),
    [favorites, onSelectWallpaper, onToggleFavorite],
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={loading ? [] : filtered}
        renderItem={renderCard}
        keyExtractor={w => w.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            {/* Header */}
            <View style={styles.header}>
              <Pressable
                style={styles.pillBtn}
                onPress={() => setSection('All')}
                accessibilityRole="button"
                accessibilityLabel="Live Wallpaper">
                <Text style={styles.pillText}>Live Wallpaper</Text>
              </Pressable>
              <Pressable
                style={styles.createBtn}
                onPress={onCreatePress}
                accessibilityRole="button"
                accessibilityLabel="Add wallpaper">
                <Text style={styles.createIcon}>{'\u271A'}</Text>
              </Pressable>
            </View>

            {/* Categories */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.catScroll}>
              {CATEGORIES.map(cat => {
                const active = favoritesOnly ? false : cat === section;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => setSection(cat)}
                    style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {cat}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Section title */}
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>
                {favoritesOnly ? 'Favorites' : section} ({filtered.length})
              </Text>
            </View>

            {/* Search */}
            <View style={styles.searchWrap}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search wallpapers..."
                placeholderTextColor={COLORS.textSecondary}
                style={styles.searchInput}
                accessibilityLabel="Search wallpapers"
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.row}>
              <LoadingCard />
              <LoadingCard />
              <LoadingCard />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No wallpapers found</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  listContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: 140,
  },
  row: {
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: SPACING.xxl + SPACING.lg,
    paddingBottom: SPACING.lg,
  },
  pillBtn: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 28,
    paddingVertical: 14,
    flexShrink: 1,
  },
  pillText: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '500',
  },
  createBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createIcon: {
    color: COLORS.cyan,
    fontSize: 24,
    lineHeight: 26,
  },
  catScroll: {
    paddingBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  chip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: 'rgba(0, 191, 255, 0.15)',
    borderColor: COLORS.cyan,
    shadowColor: COLORS.cyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  chipText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  chipTextActive: {
    color: COLORS.white,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.text,
  },
  searchWrap: {
    marginBottom: SPACING.lg,
  },
  searchInput: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 15,
  },
  empty: {
    paddingTop: 80,
    alignItems: 'center',
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 16,
  },
});