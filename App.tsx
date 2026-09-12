/**
 * Live Wallpaper Studio
 * Dark cinematic library shell backed by the native wallpaper engine.
 */

import React from 'react';
import { StyleSheet, Text, View, Alert, StatusBar, AppState } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING } from './src/ui/theme';
import { HomeScreen } from './src/ui/HomeScreen';
import { PreviewScreen, type PlaybackOptions } from './src/ui/PreviewScreen';
import { BottomNav } from './src/ui/BottomNav';
import { CreateWallpaperModal } from './src/ui/CreateWallpaperModal';
import type { ApplyDestination } from './src/ui/DestinationSheet';
import { wallpaperRepository, isBundled, findBundledTitleCollision } from './src/services/wallpaperRepository';
import { wallpaperBridge } from './src/services/wallpaperBridge';
import { enforceStorageQuota } from './src/services/storageManager';
import { showToast } from './src/services/toast';
import { getMetaSync, setMetaSync } from './src/services/db';
import type { Wallpaper } from './src/types';
import { bundledWallpapers } from './src/data/bundledWallpapers';

type AppTab = 'home' | 'grid' | 'fav' | 'settings' | 'library';

const FAVORITES_KEY = 'favoriteIds';

function readFavorites(): Set<string> {
  try {
    const raw = getMetaSync(FAVORITES_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((id): id is string => typeof id === 'string'));
    }
  } catch (error) {
    console.warn('Failed to read favorites', error);
  }
  return new Set();
}

function PlaceholderScreen({ title, icon }: { title: string; icon: string }) {
  return (
    <View style={styles.placeholderRoot}>
      <Text style={styles.placeholderIcon}>{icon}</Text>
      <Text style={styles.placeholderTitle}>{title}</Text>
      <Text style={styles.placeholderSub}>Coming soon</Text>
    </View>
  );
}

function AppShell() {
  const [wallpapers, setWallpapers] = React.useState<Wallpaper[]>(() => {
    // Only the Live (video) and Static categories are shown.
    return bundledWallpapers.filter(w => w.kind === 'video' || w.kind === 'static');
  });
  const [favorites, setFavorites] = React.useState<Set<string>>(readFavorites);
  const [activeTab, setActiveTab] = React.useState<AppTab>('home');
  const [selectedWallpaper, setSelectedWallpaper] = React.useState<Wallpaper | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [pendingApplyId, setPendingApplyId] = React.useState<string | null>(null);

  const pendingApplyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    pendingApplyRef.current = pendingApplyId;
  }, [pendingApplyId]);

  const wallpapersRef = React.useRef(wallpapers);
  React.useEffect(() => {
    wallpapersRef.current = wallpapers;
  }, [wallpapers]);

  const ownedMediaUrisRef = React.useRef(new Map<string, string>());
  React.useEffect(() => {
    const map = new Map<string, string>();
    for (const item of wallpapers) {
      const uri = item.kind === 'video' ? item.videoUri : item.imageUri;
      if (uri) map.set(uri, item.id);
    }
    ownedMediaUrisRef.current = map;
  }, [wallpapers]);

  // Persist favorites.
  const favoritesRef = React.useRef(favorites);
  React.useEffect(() => {
    favoritesRef.current = favorites;
    try {
      setMetaSync(FAVORITES_KEY, JSON.stringify(Array.from(favorites)));
    } catch (error) {
      console.warn('Failed to persist favorites', error);
    }
  }, [favorites]);

  // Load persisted user-created wallpapers and merge with the bundled catalog.
  React.useEffect(() => {
    let cancelled = false;
    wallpaperRepository
      .getAll()
      .then(merged => {
        if (cancelled) return;
        const filtered = merged.filter(w => w.kind === 'video' || w.kind === 'static');
        setWallpapers(filtered);
        Promise.all([
          wallpaperRepository.pruneBundledRows(),
          wallpaperRepository.dedupeUserWallpapers(),
        ])
          .then(() => wallpaperRepository.getAll())
          .then(cleaned => {
            if (!cancelled) {
              setWallpapers(cleaned.filter(w => w.kind === 'video' || w.kind === 'static'));
            }
          })
          .catch(() => undefined);
        enforceStorageQuota(filtered).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve a pending live apply once the system picker closes.
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      const pendingId = pendingApplyRef.current;
      if (state !== 'active' || pendingId == null) return;
      wallpaperBridge.resolvePendingApply().then(committed => {
        if (committed) {
          const name = wallpapersRef.current.find(item => item.id === pendingId)?.title ?? 'Wallpaper';
          showToast(`${name} applied`);
          setWallpapers(current =>
            current.map(item => {
              if (item.id !== pendingId) return item;
              const updated = { ...item, status: 'Applied' as const };
              wallpaperRepository.upsert(updated).catch(() => undefined);
              return updated;
            }),
          );
        }
        setPendingApplyId(null);
      });
    });
    return () => subscription.remove();
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    wallpaperBridge
      .getCapabilities()
      .then(info => {
        if (!cancelled) console.info('Wallpaper capabilities', info);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFavorite = React.useCallback((id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openWallpaper = React.useCallback((w: Wallpaper) => {
    setSelectedWallpaper(w);
  }, []);

  const closeWallpaper = React.useCallback(() => {
    setSelectedWallpaper(null);
  }, []);

  const handleApply = React.useCallback(
    async (destination: ApplyDestination, opts?: PlaybackOptions): Promise<boolean> => {
      const w = selectedWallpaper;
      if (!w) return false;
      const loop = opts?.loop ?? w.loop ?? true;
      const audio = opts?.audio ?? w.audio ?? false;
      const playbackDuration = opts?.playbackDuration ?? w.playbackDuration ?? 30;
      const result = await wallpaperBridge.applyWallpaper(
        w.id,
        w.kind,
        destination,
        w.videoUri,
        loop,
        playbackDuration,
        audio,
        w.rotation ?? 0,
        w.accent,
      );
      if (result.ok) {
        if (w.kind === 'video') {
          // The native live wallpaper picker handles the set; confirm on return.
          setPendingApplyId(w.id);
          showToast('Open the picker to apply');
        } else {
          showToast(`${w.title} applied`);
        }
        setWallpapers(current =>
          current.map(item => {
            if (item.id !== w.id) return item;
            const updated = {
              ...item,
              loop,
              audio,
              playbackDuration,
              ...(w.kind === 'static' ? { status: 'Applied' as const } : null),
            };
            wallpaperRepository.upsert(updated).catch(() => undefined);
            return updated;
          }),
        );
        return true;
      }
      Alert.alert('Could not apply', result.error ?? 'Something went wrong.');
      return false;
    },
    [selectedWallpaper],
  );

  const handleDelete = React.useCallback(async (): Promise<boolean> => {
    const w = selectedWallpaper;
    if (!w) return false;
    if (isBundled(w)) return false;
    const mediaUri = w.videoUri ?? w.imageUri;
    if (mediaUri) {
      ownedMediaUrisRef.current.delete(mediaUri);
      wallpaperBridge.deleteStoredMedia(mediaUri).catch(() => undefined);
      wallpaperRepository.videoFiles.findByUri(mediaUri).then(registered => {
        if (!registered) return;
        if (registered.posterUri) {
          wallpaperBridge.deleteStoredMedia(registered.posterUri).catch(() => undefined);
        }
        wallpaperRepository.videoFiles.remove(registered.digest).catch(() => undefined);
      });
      enforceStorageQuota(wallpapersRef.current).catch(() => undefined);
    }
    await wallpaperRepository.delete(w.id);
    setWallpapers(current => current.filter(item => item.id !== w.id));
    setFavorites(prev => {
      const next = new Set(prev);
      next.delete(w.id);
      return next;
    });
    setSelectedWallpaper(null);
    showToast(`Deleted "${w.title}"`);
    return true;
  }, [selectedWallpaper]);

  const handleWallpaperCreated = React.useCallback((newWallpaper: Wallpaper) => {
    const bundledCollision = findBundledTitleCollision(newWallpaper.title, newWallpaper.kind);
    if (bundledCollision) {
      setIsCreating(false);
      setSelectedWallpaper(bundledCollision);
      showToast(`"${newWallpaper.title}" is already in your library`);
      return;
    }
    const mediaUri =
      newWallpaper.kind === 'video' ? newWallpaper.videoUri : newWallpaper.imageUri;
    if (mediaUri) {
      const ownerId = ownedMediaUrisRef.current.get(mediaUri);
      if (ownerId) {
        setIsCreating(false);
        const existing = wallpapersRef.current.find(item => item.id === ownerId);
        setSelectedWallpaper(existing ?? newWallpaper);
        showToast(`"${newWallpaper.title}" is already in your library`);
        return;
      }
    }
    wallpaperRepository.upsert(newWallpaper).catch(() => undefined);
    setWallpapers(current => [newWallpaper, ...current]);
    setSelectedWallpaper(newWallpaper);
    setIsCreating(false);
    showToast(`Added "${newWallpaper.title}"`);
    enforceStorageQuota([newWallpaper, ...wallpapersRef.current]).catch(() => undefined);
  }, []);

  const handleTabChange = React.useCallback((tab: string) => {
    setActiveTab(tab as AppTab);
  }, []);

  const selected = selectedWallpaper;

  return (
    <SafeAreaView style={styles.safe}>
      {selected != null ? (
        <PreviewScreen
          wallpaper={selected}
          onBack={closeWallpaper}
          isFavorite={favorites.has(selected.id)}
          onToggleFavorite={toggleFavorite}
          onApply={handleApply}
          onDelete={handleDelete}
          canDelete={!isBundled(selected)}
        />
      ) : (
        <>
          {(activeTab === 'home' || activeTab === 'fav') && (
            <HomeScreen
              wallpapers={wallpapers}
              favorites={favorites}
              onSelectWallpaper={openWallpaper}
              onToggleFavorite={toggleFavorite}
              onCreatePress={() => setIsCreating(true)}
              favoritesOnly={activeTab === 'fav'}
            />
          )}
          {activeTab === 'grid' && <PlaceholderScreen title="Categories" icon={'\u25A6'} />}
          {activeTab === 'settings' && <PlaceholderScreen title="Settings" icon={'\u2699'} />}
          {activeTab === 'library' && <PlaceholderScreen title="Library" icon={'\u224F'} />}
          <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
        </>
      )}

      <CreateWallpaperModal
        visible={isCreating}
        onClose={() => setIsCreating(false)}
        onCreated={handleWallpaperCreated}
      />
    </SafeAreaView>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <AppShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  placeholderRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    paddingBottom: 80,
  },
  placeholderIcon: {
    fontSize: 44,
    color: COLORS.cyan,
    marginBottom: SPACING.lg,
  },
  placeholderTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  placeholderSub: {
    fontSize: 15,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
  },
});

export default App;