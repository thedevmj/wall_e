/**
 * Live Wallpaper Studio
 * Android-only wallpaper editor and library shell.
 */

import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  PanResponder,
} from 'react-native';
import { ActionButton } from './src/components/ActionButton';
import { WallpaperCard } from './src/components/WallpaperCard';
import { mockWallpapers } from './src/data/mockWallpapers';
import { wallpaperBridge } from './src/services/wallpaperBridge';
import type { Wallpaper } from './src/types';
import Video, { ViewType } from 'react-native-video';

// ─── Error Boundary ──────────────────────────────────────────────────────

type ErrorBoundaryState = { hasError: boolean; error: Error | null };

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('App ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.errorBoundary}>
            <Text style={styles.errorBoundaryTitle}>Something went wrong</Text>
            <Text style={styles.errorBoundaryMessage}>
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </Text>
            <ActionButton
              label="Restart"
              onPress={() => this.setState({ hasError: false, error: null })}
            />
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

// ─── Create Wallpaper Modal ──────────────────────────────────────────────

type CreateModalProps = {
  visible: boolean;
  onClose: () => void;
  onCreated: (wallpaper: Wallpaper) => void;
};

function CreateWallpaperModal({ visible, onClose, onCreated }: CreateModalProps) {
  const [editorKind, setEditorKind] = React.useState<'doodle' | 'video'>('doodle');
  const [title, setTitle] = React.useState('');
  const [videoUri, setVideoUri] = React.useState<string | null>(null);
  const [loopVideo, setLoopVideo] = React.useState(true);
  const [videoAudio, setVideoAudio] = React.useState(false);
  const [playbackDuration, setPlaybackDuration] = React.useState(30);
  const [sliderWidth, setSliderWidth] = React.useState(0);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isPickingVideo, setIsPickingVideo] = React.useState(false);

  const updateDuration = React.useCallback(
    (position: number) => {
      if (!sliderWidth) return;
      const ratio = Math.max(0, Math.min(1, position / sliderWidth));
      setPlaybackDuration(Math.max(1, Math.min(30, Math.round(1 + ratio * 29))));
    },
    [sliderWidth],
  );

  const durationPanResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: event => updateDuration(event.nativeEvent.locationX),
        onPanResponderMove: event => updateDuration(event.nativeEvent.locationX),
      }),
    [updateDuration],
  );

  // Reset state when modal opens
  React.useEffect(() => {
    if (visible) {
      setTitle('');
      setVideoUri(null);
      setLoopVideo(true);
      setVideoAudio(false);
      setPlaybackDuration(30);
      setErrorMessage(null);
      setIsPickingVideo(false);
    }
  }, [visible]);

  const chooseVideo = React.useCallback(async () => {
    setErrorMessage(null);
    setIsPickingVideo(true);
    try {
      const pickedVideo = await wallpaperBridge.pickVideo();
      if (pickedVideo) {
        setVideoUri(pickedVideo.uri);
        setPlaybackDuration(Math.min(30, Math.max(1, Math.round(pickedVideo.durationSeconds))));
      } else {
        setErrorMessage('No video was selected. Please try again.');
      }
    } catch (_error) {
      setErrorMessage('The selected video could not be read. Please choose another video.');
    } finally {
      setIsPickingVideo(false);
    }
  }, []);

  const handleCreate = React.useCallback(() => {
    if (editorKind === 'video' && !videoUri) {
      setErrorMessage('Choose a video before creating this wallpaper.');
      return;
    }
    const name = title.trim() || (editorKind === 'doodle' ? 'Untitled Doodle' : 'Untitled Video');
    const newWallpaper: Wallpaper = {
      id: `${editorKind}-${Date.now()}`,
      title: name,
      kind: editorKind,
      description:
        editorKind === 'doodle'
          ? 'A custom animated doodle loop.'
          : 'A custom muted video wallpaper loop.',
      accent: editorKind === 'doodle' ? '#22D3EE' : '#FB7185',
      status: 'Needs preview',
      duration: editorKind === 'doodle' ? '15 sec' : `${playbackDuration} sec`,
      createdAt: 'Just now',
      videoUri: editorKind === 'video' ? videoUri ?? undefined : undefined,
      loop: editorKind === 'video' ? loopVideo : undefined,
      audio: editorKind === 'video' ? videoAudio : undefined,
      playbackDuration: editorKind === 'video' ? playbackDuration : undefined,
    };
    onCreated(newWallpaper);
  }, [editorKind, title, videoUri, loopVideo, videoAudio, playbackDuration, onCreated]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalPanel}>
          <Text style={styles.modalTitle}>Create wallpaper</Text>
          <Text style={styles.modalSubtitle}>
            Give your next loop a name and choose its renderer.
          </Text>
          <TextInput
            accessibilityLabel="Wallpaper name"
            placeholder="Wallpaper name"
            placeholderTextColor="#64748B"
            value={title}
            onChangeText={setTitle}
            style={styles.input}
            autoFocus
          />
          {editorKind === 'video' && (
            <>
              <ActionButton
                label={
                  isPickingVideo
                    ? 'Selecting...'
                    : videoUri
                      ? 'Video selected ✓'
                      : 'Choose video from device'
                }
                onPress={chooseVideo}
                tone="secondary"
              />
              <Text style={styles.durationLabel}>
                Playback duration: {playbackDuration} seconds
              </Text>
              <View
                accessibilityRole="adjustable"
                accessibilityLabel="Playback duration"
                onLayout={event => setSliderWidth(event.nativeEvent.layout.width)}
                {...durationPanResponder.panHandlers}
                style={styles.sliderTrack}>
                <View
                  style={[
                    styles.sliderFill,
                    {
                      width: sliderWidth
                        ? `${((playbackDuration - 1) / 29) * 100}%`
                        : '0%',
                    },
                  ]}
                />
                <View
                  style={[
                    styles.sliderThumb,
                    {
                      left: sliderWidth
                        ? ((playbackDuration - 1) / 29) * (sliderWidth - 22)
                        : 0,
                    },
                  ]}
                />
              </View>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: loopVideo }}
                onPress={() => setLoopVideo(v => !v)}
                style={styles.loopRow}>
                <View style={[styles.checkbox, loopVideo && styles.checkboxChecked]} />
                <Text style={styles.loopText}>Play continuously</Text>
              </Pressable>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: videoAudio }}
                onPress={() => setVideoAudio(v => !v)}
                style={styles.loopRow}>
                <View style={[styles.checkbox, videoAudio && styles.checkboxChecked]} />
                <Text style={styles.loopText}>Include audio</Text>
              </Pressable>
            </>
          )}
          <View style={styles.kindRow}>
            {(['doodle', 'video'] as const).map(kind => (
              <Pressable
                key={kind}
                onPress={() => setEditorKind(kind)}
                style={[styles.kindButton, editorKind === kind && styles.kindButtonSelected]}>
                <Text style={styles.kindButtonText}>
                  {kind === 'doodle' ? 'Doodle' : 'Video'}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.modalActions}>
            <ActionButton label="Cancel" tone="secondary" onPress={onClose} style={styles.modalButton} />
            <ActionButton label="Create" onPress={handleCreate} style={styles.modalButton} />
          </View>
          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
        </View>
      </View>
    </Modal>
  );
}

// ─── Wallpaper Detail Modal ──────────────────────────────────────────────

type DetailModalProps = {
  wallpaper: Wallpaper | null;
  onClose: () => void;
  onApplied: (id: string) => void;
  onVideoChosen: (updated: Wallpaper) => void;
};

function WallpaperDetailModal({ wallpaper, onClose, onApplied, onVideoChosen }: DetailModalProps) {
  const [isApplying, setIsApplying] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [videoError, setVideoError] = React.useState(false);

  // Reset errors when wallpaper changes
  React.useEffect(() => {
    setErrorMessage(null);
    setIsApplying(false);
    setVideoError(false);
  }, [wallpaper?.id]);

  const applySelected = React.useCallback(
    async (destination: 'HOME' | 'LOCK' | 'BOTH') => {
      if (!wallpaper) return;
      if (wallpaper.kind === 'video' && !wallpaper.videoUri) {
        setErrorMessage('Choose a video before applying this wallpaper.');
        return;
      }
      setIsApplying(true);
      setErrorMessage(null);
      try {
        const result = await wallpaperBridge.applyWallpaper(
          wallpaper.id,
          wallpaper.kind,
          destination,
          wallpaper.videoUri,
          wallpaper.loop ?? true,
          wallpaper.playbackDuration ?? 30,
          wallpaper.audio ?? false,
        );
        if (result.ok) {
          onApplied(wallpaper.id);
          Alert.alert(
            'Wallpaper Applied',
            `"${wallpaper.title}" is being set as your ${destination.toLowerCase()} wallpaper. Follow the system prompt to confirm.`,
            [{ text: 'OK' }],
          );
          onClose();
        } else {
          setErrorMessage(result.error ?? 'Android could not open the live wallpaper picker.');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
        setErrorMessage(message);
      } finally {
        setIsApplying(false);
      }
    },
    [wallpaper, onApplied, onClose],
  );

  const chooseVideoForSelected = React.useCallback(async () => {
    if (!wallpaper) return;
    setErrorMessage(null);
    try {
      const pickedVideo = await wallpaperBridge.pickVideo();
      if (!pickedVideo) {
        setErrorMessage('No video was selected. Please try again.');
        return;
      }
      const updatedWallpaper: Wallpaper = {
        ...wallpaper,
        videoUri: pickedVideo.uri,
        playbackDuration: Math.min(30, Math.max(1, Math.round(pickedVideo.durationSeconds))),
      };
      onVideoChosen(updatedWallpaper);
      setVideoError(false);
    } catch (_error) {
      setErrorMessage('The selected video could not be read. Please choose another video.');
    }
  }, [wallpaper, onVideoChosen]);

  if (!wallpaper) return null;

  return (
    <Modal visible={wallpaper !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalPanel}>
          {/* Loading overlay */}
          {isApplying && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#22D3EE" />
              <Text style={styles.loadingText}>Opening wallpaper picker...</Text>
            </View>
          )}

          {/* Preview */}
          {wallpaper.kind === 'video' && wallpaper.videoUri && !videoError ? (
            <Video
              key={wallpaper.videoUri}
              source={{ uri: wallpaper.videoUri }}
              style={styles.videoPreview}
              resizeMode="cover"
              viewType={ViewType.TEXTURE}
              repeat={wallpaper.loop !== false}
              paused={false}
              muted={!wallpaper.audio}
              playInBackground={true}
              playWhenInactive={false}
              onError={() => setVideoError(true)}
            />
          ) : wallpaper.kind === 'video' && videoError ? (
            <View style={[styles.preview, { backgroundColor: wallpaper.accent }]}>
              <Text style={styles.previewLabel}>VIDEO PREVIEW UNAVAILABLE</Text>
              <Text style={styles.videoErrorHint}>
                Try selecting an MP4 or H.264 video
              </Text>
            </View>
          ) : (
            <AnimatedPreview accent={wallpaper.accent} />
          )}

          <Text style={styles.modalTitle}>{wallpaper.title}</Text>
          <Text style={styles.modalSubtitle}>{wallpaper.description}</Text>

          {wallpaper.kind === 'video' && (
            <>
              <Text style={styles.durationLabel}>
                Plays for {wallpaper.playbackDuration ?? 30} seconds
                {wallpaper.loop === false ? ' once' : ' on repeat'}
                {wallpaper.audio ? ' with audio' : ' muted'}
              </Text>
              {(!wallpaper.videoUri || videoError) && (
                <ActionButton
                  label={videoError ? 'Choose a compatible video' : 'Choose video from device'}
                  onPress={chooseVideoForSelected}
                  tone="secondary"
                />
              )}
            </>
          )}

          <Text style={styles.previewOnlyLabel}>
            Preview only. Choose a destination below to apply.
          </Text>
          <Text style={styles.destinationLabel}>Apply to</Text>
          <View style={styles.kindRow}>
            {(['HOME', 'LOCK', 'BOTH'] as const).map(destination => (
              <Pressable
                key={destination}
                onPress={() => applySelected(destination)}
                disabled={isApplying}
                style={[styles.kindButton, isApplying && styles.kindButtonDisabled]}>
                <Text style={styles.kindButtonText}>{destination}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.modalActions}>
            <ActionButton
              label="Close"
              tone="secondary"
              onPress={onClose}
              style={styles.modalButton}
            />
          </View>
          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
        </View>
      </View>
    </Modal>
  );
}

// ─── Animated Preview (doodle) ───────────────────────────────────────────

function AnimatedPreview({ accent }: { accent: string }) {
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: 2600, useNativeDriver: true }),
    );
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const drift = progress.interpolate({ inputRange: [0, 1], outputRange: [-18, 18] });
  const scale = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.9, 1.12, 0.9] });

  return (
    <View style={[styles.preview, { backgroundColor: accent }]}>
      <Animated.View
        style={[styles.previewOrb, { transform: [{ translateX: drift }, { scale }] }]}
      />
      <Text style={styles.previewLabel}>DOODLE PREVIEW</Text>
    </View>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────

function App() {
  const [capabilities, setCapabilities] = React.useState({
    supportsLiveWallpaper: false,
    minSdk: 24,
    targetSdk: 36,
    features: ['Doodle renderer', 'Video preview', 'Wallpaper picker'],
  });
  const [wallpapers, setWallpapers] = React.useState(mockWallpapers);
  const [selectedWallpaper, setSelectedWallpaper] = React.useState<Wallpaper | null>(null);
  const [filter, setFilter] = React.useState<'all' | 'doodle' | 'video'>('all');
  const [isCreating, setIsCreating] = React.useState(false);
  const [creatorKind, setCreatorKind] = React.useState<'doodle' | 'video'>('doodle');

  React.useEffect(() => {
    wallpaperBridge.getCapabilities().then(setCapabilities).catch(() => undefined);
  }, []);

  const openCreator = React.useCallback((kind: 'doodle' | 'video') => {
    setCreatorKind(kind);
    setIsCreating(true);
  }, []);

  const handleWallpaperCreated = React.useCallback((newWallpaper: Wallpaper) => {
    setWallpapers(current => [newWallpaper, ...current]);
    setSelectedWallpaper(newWallpaper);
    setIsCreating(false);
  }, []);

  const handleApplied = React.useCallback((id: string) => {
    setWallpapers(current =>
      current.map(item => ({
        ...item,
        status: item.id === id ? ('Applied' as const) : item.status,
      })),
    );
  }, []);

  const handleVideoChosen = React.useCallback((updated: Wallpaper) => {
    setSelectedWallpaper(updated);
    setWallpapers(current =>
      current.map(item => (item.id === updated.id ? updated : item)),
    );
  }, []);

  const deleteWallpaper = React.useCallback((id: string) => {
    Alert.alert('Delete wallpaper?', 'This removes the video from this library.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => setWallpapers(current => current.filter(item => item.id !== id)),
      },
    ]);
  }, []);

  const filteredWallpapers = React.useMemo(
    () => wallpapers.filter(w => filter === 'all' || w.kind === filter),
    [wallpapers, filter],
  );

  return (
    <ErrorBoundary>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.eyebrow}>Android wallpaper studio</Text>
            <Text testID="app-title" style={styles.title}>
              Live Wallpaper Studio
            </Text>
            <Text style={styles.subtitle}>
              Create, preview, and apply native Android live wallpapers without leaving the app.
            </Text>
          </View>

          <View style={styles.metricsRow}>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>Library</Text>
              <Text style={styles.metricValue}>{wallpapers.length}</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>SDK</Text>
              <Text style={styles.metricValue}>{capabilities.minSdk}+</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>Native</Text>
              <Text style={styles.metricValue}>
                {capabilities.supportsLiveWallpaper ? 'ON' : 'OFF'}
              </Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <ActionButton label="Create Doodle" onPress={() => openCreator('doodle')} />
            <ActionButton
              label="Video Wallpaper"
              onPress={() => openCreator('video')}
              tone="secondary"
            />
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Wallpapers</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open library"
              onPress={() => setFilter('all')}>
              <Text style={styles.sectionLink}>Open library</Text>
            </Pressable>
          </View>

          <View style={styles.filterRow}>
            {(['all', 'doodle', 'video'] as const).map(option => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === option }}
                onPress={() => setFilter(option)}
                style={[styles.filter, filter === option && styles.filterSelected]}>
                <Text
                  style={[
                    styles.filterText,
                    filter === option && styles.filterTextSelected,
                  ]}>
                  {option === 'all' ? 'All' : option === 'doodle' ? 'Doodles' : 'Videos'}
                </Text>
              </Pressable>
            ))}
          </View>

          {filteredWallpapers.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>
                No {filter === 'all' ? '' : filter} wallpapers yet.{'\n'}
                Tap a button above to create one!
              </Text>
            </View>
          ) : (
            filteredWallpapers.map((wallpaper, index) => (
              <WallpaperCard
                key={wallpaper.id}
                wallpaper={wallpaper}
                index={index}
                onPress={() => setSelectedWallpaper(wallpaper)}
                onDelete={wallpaper.kind === 'video' ? deleteWallpaper : undefined}
              />
            ))
          )}

          <View style={styles.footerPanel}>
            <Text style={styles.footerTitle}>Android runtime</Text>
            <Text style={styles.footerText}>
              Wallpaper rendering is handled by the native Android service layer, while React
              Native remains the editor and configuration UI.
            </Text>
            <Text style={styles.footerMeta}>{capabilities.features.join(' • ')}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>

      <CreateWallpaperModal
        visible={isCreating}
        onClose={() => setIsCreating(false)}
        onCreated={handleWallpaperCreated}
      />

      <WallpaperDetailModal
        wallpaper={selectedWallpaper}
        onClose={() => setSelectedWallpaper(null)}
        onApplied={handleApplied}
        onVideoChosen={handleVideoChosen}
      />
    </ErrorBoundary>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#020817',
  },
  scroll: {
    flex: 1,
    backgroundColor: '#020817',
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 36,
  },
  header: {
    paddingBottom: 18,
  },
  eyebrow: {
    color: '#A5F3FC',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginBottom: 10,
  },
  subtitle: {
    color: '#CBD5E1',
    fontSize: 15,
    lineHeight: 21,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
    gap: 10,
  },
  metricBox: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
  },
  metricLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  metricValue: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '700',
  },
  sectionLink: {
    color: '#7DD3FC',
    fontSize: 12,
    fontWeight: '700',
  },
  footerPanel: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 20,
    padding: 18,
    marginTop: 18,
  },
  footerTitle: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  footerText: {
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 21,
  },
  footerMeta: {
    color: '#A5F3FC',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  filter: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterSelected: {
    backgroundColor: '#164E63',
    borderColor: '#22D3EE',
  },
  filterText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  filterTextSelected: {
    color: '#ECFEFF',
  },
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 8, 23, 0.72)',
  },
  modalPanel: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  modalSubtitle: {
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
  },
  input: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    color: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    marginBottom: 14,
  },
  kindRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
  },
  kindButton: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingVertical: 12,
  },
  kindButtonSelected: {
    backgroundColor: '#334155',
    borderColor: '#A5F3FC',
  },
  kindButtonDisabled: {
    opacity: 0.5,
  },
  kindButtonText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '800',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalButton: {
    flex: 1,
    minWidth: 0,
  },
  preview: {
    height: 150,
    borderRadius: 16,
    marginBottom: 18,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: 16,
  },
  videoPreview: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    backgroundColor: '#020617',
    marginBottom: 18,
  },
  previewOrb: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.25)',
    top: 15,
    left: '35%',
  },
  previewLabel: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  videoErrorHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  destinationLabel: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  previewOnlyLabel: {
    color: '#A5F3FC',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 14,
  },
  loopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#64748B',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: '#22D3EE',
    borderColor: '#22D3EE',
  },
  loopText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  durationLabel: {
    color: '#A5F3FC',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 8,
  },
  sliderTrack: {
    height: 22,
    backgroundColor: '#1E293B',
    borderRadius: 11,
    justifyContent: 'center',
    marginBottom: 4,
  },
  sliderFill: {
    height: 22,
    backgroundColor: '#0E7490',
    borderRadius: 11,
  },
  sliderThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#A5F3FC',
    borderWidth: 3,
    borderColor: '#083344',
  },
  errorText: {
    color: '#FDA4AF',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 14,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  loadingText: {
    color: '#A5F3FC',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 14,
  },
  errorBoundary: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#020817',
  },
  errorBoundaryTitle: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 12,
  },
  errorBoundaryMessage: {
    color: '#FDA4AF',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
});

export default App;
