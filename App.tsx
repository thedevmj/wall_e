/**
 * Live Wallpaper Studio
 * Android-only wallpaper editor and library shell.
 */

import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
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
import { GeometricArt } from './src/components/GeometricArt';
import { predefinedWallpapers } from './src/data/mockWallpapers';
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
  const [editorKind, setEditorKind] = React.useState<'doodle' | 'video' | 'static'>('doodle');
  const [title, setTitle] = React.useState('');
  const [videoUri, setVideoUri] = React.useState<string | null>(null);
  const [imageUri, setImageUri] = React.useState<string | null>(null);
  const [videoRotation, setVideoRotation] = React.useState(0);
  const [loopVideo, setLoopVideo] = React.useState(true);
  const [videoAudio, setVideoAudio] = React.useState(false);
  const [playbackDuration, setPlaybackDuration] = React.useState(30);
  const [sliderWidth, setSliderWidth] = React.useState(0);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isPickingVideo, setIsPickingVideo] = React.useState(false);
  const [isPickingImage, setIsPickingImage] = React.useState(false);

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
      setImageUri(null);
      setVideoRotation(0);
      setLoopVideo(true);
      setVideoAudio(false);
      setPlaybackDuration(30);
      setErrorMessage(null);
      setIsPickingVideo(false);
      setIsPickingImage(false);
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
    } catch {
      setErrorMessage('The selected video could not be read. Please choose another video.');
    } finally {
      setIsPickingVideo(false);
    }
  }, []);

  const chooseImage = React.useCallback(async () => {
    setErrorMessage(null);
    setIsPickingImage(true);
    try {
      const pickedImage = await wallpaperBridge.pickImage();
      if (pickedImage) {
        setImageUri(pickedImage.uri);
      } else {
        setErrorMessage('No image was selected. Please try again.');
      }
    } catch {
      setErrorMessage('The selected image could not be read. Please choose another image.');
    } finally {
      setIsPickingImage(false);
    }
  }, []);

  const handleCreate = React.useCallback(() => {
    if (editorKind === 'video' && !videoUri) {
      setErrorMessage('Choose a video before creating this wallpaper.');
      return;
    }
    if (editorKind === 'static' && !imageUri) {
      setErrorMessage('Choose an image before creating this wallpaper.');
      return;
    }
    const name = title.trim() || (editorKind === 'doodle' ? 'Untitled Doodle' : editorKind === 'video' ? 'Untitled Video' : 'Untitled Image');
    const newWallpaper: Wallpaper = {
      id: `${editorKind}-${Date.now()}`,
      title: name,
      kind: editorKind,
      description:
        editorKind === 'doodle'
          ? 'A custom animated doodle loop.'
          : editorKind === 'video'
            ? 'A custom muted video wallpaper loop.'
            : 'A custom still image wallpaper.',
      accent: editorKind === 'doodle' ? '#22D3EE' : editorKind === 'video' ? '#FB7185' : '#F59E0B',
      status: 'Needs preview',
      duration: editorKind === 'doodle' ? '15 sec' : editorKind === 'video' ? `${playbackDuration} sec` : 'Still',
      createdAt: 'Just now',
      videoUri: editorKind === 'video' ? videoUri ?? undefined : undefined,
      imageUri: editorKind === 'static' ? imageUri ?? undefined : undefined,
      loop: editorKind === 'video' ? loopVideo : undefined,
      audio: editorKind === 'video' ? videoAudio : undefined,
      playbackDuration: editorKind === 'video' ? playbackDuration : undefined,
      rotation: editorKind === 'video' ? videoRotation : undefined,
    };
    onCreated(newWallpaper);
  }, [editorKind, title, videoUri, imageUri, loopVideo, videoAudio, playbackDuration, videoRotation, onCreated]);

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
              <Text style={styles.durationLabel}>Rotate video before applying</Text>
              <View style={styles.rotationRow}>
                {([0, 90, 180, 270] as const).map(degrees => (
                  <Pressable
                    key={degrees}
                    accessibilityRole="button"
                    accessibilityLabel={`Rotate ${degrees} degrees`}
                    onPress={() => setVideoRotation(degrees)}
                    style={[
                      styles.rotationButton,
                      videoRotation === degrees && styles.rotationButtonSelected,
                    ]}>
                    <Text style={styles.rotationButtonText}>{degrees}°</Text>
                  </Pressable>
                ))}
              </View>
              {videoRotation !== 0 && (
                <Text style={styles.rotationHint}>Video rotates {videoRotation}° clockwise</Text>
              )}
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
          {editorKind === 'static' && (
            <>
              <ActionButton
                label={
                  isPickingImage
                    ? 'Selecting...'
                    : imageUri
                      ? 'Image selected ✓'
                      : 'Choose image from device'
                }
                onPress={chooseImage}
                tone="secondary"
              />
              {imageUri && (
                <Image source={{ uri: imageUri }} style={styles.staticImagePreview} />
              )}
              <Text style={styles.staticHint}>
                Set a still photo as a regular Android wallpaper.
              </Text>
            </>
          )}
          <View style={styles.kindRow}>
            {(['doodle', 'video', 'static'] as const).map(kind => (
              <Pressable
                key={kind}
                onPress={() => setEditorKind(kind)}
                style={[styles.kindButton, editorKind === kind && styles.kindButtonSelected]}>
                <Text style={styles.kindButtonText}>
                  {kind === 'doodle' ? 'Doodle' : kind === 'video' ? 'Video' : 'Static'}
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
  onWallpaperUpdated: (updated: Wallpaper) => void;
};

function WallpaperDetailModal({ wallpaper, onClose, onApplied, onWallpaperUpdated }: DetailModalProps) {
  const [isApplying, setIsApplying] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [videoError, setVideoError] = React.useState(false);
  const [imageError, setImageError] = React.useState(false);
  const [rotation, setRotation] = React.useState(0);

  // Reset errors when wallpaper changes
  React.useEffect(() => {
    setErrorMessage(null);
    setIsApplying(false);
    setVideoError(false);
    setImageError(false);
    setRotation(wallpaper?.rotation ?? 0);
  }, [wallpaper?.id]);

  // Persist rotation changes back to the library when it changes.
  React.useEffect(() => {
    if (wallpaper && rotation !== (wallpaper.rotation ?? 0)) {
      onWallpaperUpdated({ ...wallpaper, rotation });
    }
  }, [rotation, wallpaper, onWallpaperUpdated]);

  const applySelected = React.useCallback(
    async (destination: 'HOME' | 'LOCK' | 'BOTH') => {
      if (!wallpaper) return;
      if (wallpaper.kind === 'video' && !wallpaper.videoUri) {
        setErrorMessage('Choose a video before applying this wallpaper.');
        return;
      }
      if (wallpaper.kind === 'static' && !wallpaper.imageUri) {
        setErrorMessage('Choose an image before applying this wallpaper.');
        return;
      }
      setIsApplying(true);
      setErrorMessage(null);
      try {
        const mediaUri =
          wallpaper.kind === 'static'
            ? wallpaper.imageUri ?? ''
            : wallpaper.videoUri ?? '';
        const result = await wallpaperBridge.applyWallpaper(
          wallpaper.id,
          wallpaper.kind,
          destination,
          mediaUri,
          wallpaper.loop ?? true,
          wallpaper.playbackDuration ?? 30,
          wallpaper.audio ?? false,
          rotation,
        );
        if (result.ok) {
          onApplied(wallpaper.id);
          Alert.alert(
            'Wallpaper Applied',
            wallpaper.kind === 'static'
              ? '"' + wallpaper.title + '" is now your ' + destination.toLowerCase() + ' wallpaper.'
              : `"${wallpaper.title}" is being set as your ${destination.toLowerCase()} wallpaper. Follow the system prompt to confirm.`,
            [{ text: 'OK' }],
          );
          onClose();
        } else {
          setErrorMessage(result.error ?? 'Android could not open the wallpaper picker.');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
        setErrorMessage(message);
      } finally {
        setIsApplying(false);
      }
    },
    [wallpaper, rotation, onApplied, onClose],
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
      onWallpaperUpdated(updatedWallpaper);
      setVideoError(false);
    } catch {
      setErrorMessage('The selected video could not be read. Please choose another video.');
    }
  }, [wallpaper, onWallpaperUpdated]);

  const chooseImageForSelected = React.useCallback(async () => {
    if (!wallpaper) return;
    setErrorMessage(null);
    try {
      const pickedImage = await wallpaperBridge.pickImage();
      if (!pickedImage) {
        setErrorMessage('No image was selected. Please try again.');
        return;
      }
      const updatedWallpaper: Wallpaper = {
        ...wallpaper,
        imageUri: pickedImage.uri,
      };
      onWallpaperUpdated(updatedWallpaper);
      setImageError(false);
    } catch {
      setErrorMessage('The selected image could not be read. Please choose another image.');
    }
  }, [wallpaper, onWallpaperUpdated]);

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
          {wallpaper.kind === 'static' && wallpaper.imageUri && !imageError ? (
            <Image
              key={wallpaper.imageUri}
              source={{ uri: wallpaper.imageUri }}
              style={styles.staticImagePreview}
              resizeMode="cover"
              onError={() => setImageError(true)}
            />
          ) : wallpaper.kind === 'static' && imageError ? (
            <View style={[styles.preview, { backgroundColor: wallpaper.accent }]}>
              <Text style={styles.previewLabel}>IMAGE PREVIEW UNAVAILABLE</Text>
              <Text style={styles.videoErrorHint}>Try selecting another image</Text>
            </View>
          ) : wallpaper.kind === 'video' && wallpaper.videoUri && !videoError ? (
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
                {rotation !== 0 ? ` · rotated ${rotation}°` : ''}
              </Text>
              <Text style={styles.durationLabel}>Rotate before applying</Text>
              <View style={styles.rotationRow}>
                {([0, 90, 180, 270] as const).map(degrees => (
                  <Pressable
                    key={degrees}
                    accessibilityRole="button"
                    accessibilityLabel={`Rotate video ${degrees} degrees`}
                    onPress={() => setRotation(degrees)}
                    style={[
                      styles.rotationButton,
                      rotation === degrees && styles.rotationButtonSelected,
                    ]}>
                    <Text style={styles.rotationButtonText}>{degrees}°</Text>
                  </Pressable>
                ))}
              </View>
              {(!wallpaper.videoUri || videoError) && (
                <ActionButton
                  label={videoError ? 'Choose a compatible video' : 'Choose video from device'}
                  onPress={chooseVideoForSelected}
                  tone="secondary"
                />
              )}
            </>
          )}

          {wallpaper.kind === 'static' && (
            <>
              {(!wallpaper.imageUri || imageError) && (
                <ActionButton
                  label={imageError ? 'Choose a compatible image' : 'Choose image from device'}
                  onPress={chooseImageForSelected}
                  tone="secondary"
                />
              )}
              <Text style={styles.staticHint}>
                Preview only. Choosing a destination sets this photo directly as a static wallpaper.
              </Text>
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

// ─── Featured Billboard (auto-rotates every 5 seconds) ───────────────────

const BILLBOARD_INTERVAL_MS = 5000;
const BILLBOARD_ART_SIZE = 240;

type BillboardProps = {
  wallpapers: Wallpaper[];
  onSelect: (wallpaper: Wallpaper) => void;
};

function Billboard({ wallpapers, onSelect }: BillboardProps) {
  const [index, setIndex] = React.useState(0);
  const fade = React.useRef(new Animated.Value(1)).current;
  const count = wallpapers.length;

  React.useEffect(() => {
    if (count < 2) return undefined;
    const timer = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 240, useNativeDriver: true }).start(() => {
        setIndex(current => (current + 1) % count);
        Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }).start();
      });
    }, BILLBOARD_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [count, fade]);

  if (count === 0) return null;

  const current = wallpapers[Math.min(index, count - 1)];

  return (
    <View style={styles.billboardSection}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Featured: ${current.title}`}
        onPress={() => onSelect(current)}>
        <Animated.View style={[styles.billboardCard, { opacity: fade }]}>
          <View style={styles.billboardArt}>
            <GeometricArt accent={current.accent} size={BILLBOARD_ART_SIZE} seed={index} />
          </View>
          <View style={styles.billboardScrim} />
          <View style={styles.billboardInfo}>
            <View style={styles.billboardKindChip}>
              <Text style={styles.billboardKindText}>{current.kind.toUpperCase()}</Text>
            </View>
            <Text style={styles.billboardName}>{current.title}</Text>
            <Text style={styles.billboardDesc} numberOfLines={1}>
              {current.description}
            </Text>
          </View>
        </Animated.View>
      </Pressable>

      <View style={styles.dotsRow}>
        {wallpapers.map((wallpaper, dotIndex) => (
          <Pressable
            key={wallpaper.id}
            accessibilityRole="button"
            accessibilityLabel={`Featured wallpaper ${dotIndex + 1}`}
            onPress={() => setIndex(dotIndex)}
            style={[styles.dot, dotIndex === index && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

// ─── Predefined 2x2 Grid ──────────────────────────────────────────────────

type PredefinedGridProps = {
  wallpapers: Wallpaper[];
  onSelect: (wallpaper: Wallpaper) => void;
};

function PredefinedGrid({ wallpapers, onSelect }: PredefinedGridProps) {
  return (
    <View style={styles.grid}>
      {wallpapers.map((wallpaper, seedIndex) => (
        <Pressable
          key={wallpaper.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${wallpaper.title}`}
          onPress={() => onSelect(wallpaper)}
          style={styles.gridItem}>
          <View style={styles.gridArt}>
            <GeometricArt accent={wallpaper.accent} size={140} seed={seedIndex} />
            <View style={styles.gridKindChip}>
              <Text style={styles.gridKindText}>{wallpaper.kind.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={styles.gridName}>{wallpaper.title}</Text>
          <Text style={styles.gridMeta}>{wallpaper.duration}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────

function App() {
  const [wallpapers, setWallpapers] = React.useState(predefinedWallpapers);
  const [selectedWallpaper, setSelectedWallpaper] = React.useState<Wallpaper | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);

  const openCreator = React.useCallback(() => {
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

  const handleWallpaperUpdated = React.useCallback((updated: Wallpaper) => {
    setSelectedWallpaper(updated);
    setWallpapers(current =>
      current.map(item => (item.id === updated.id ? updated : item)),
    );
  }, []);

  return (
    <ErrorBoundary>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.wrapper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create wallpaper"
            style={styles.createFab}
            onPress={openCreator}>
            <Text style={styles.createFabText}>Create</Text>
          </Pressable>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.brandRow}>
                <Image source={require('./assets/app-icon.png')} style={styles.brandIcon} />
                <View style={styles.brandText}>
                  <Text testID="app-title" style={styles.title}>
                    LiveWallpaper Studio
                  </Text>
                  <Text style={styles.subtitle}>
                    Create, preview, and apply native Android live wallpapers.
                  </Text>
                </View>
              </View>
            </View>

            {/* Auto-rotating featured billboard */}
            <Billboard wallpapers={wallpapers} onSelect={setSelectedWallpaper} />

            {/* Predefined 2x2 grid */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Predefined wallpapers</Text>
            </View>
            <PredefinedGrid
              wallpapers={wallpapers.filter(w => w.id.startsWith('pre-'))}
              onSelect={setSelectedWallpaper}
            />
          </ScrollView>
        </View>
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
        onWallpaperUpdated={handleWallpaperUpdated}
      />
    </ErrorBoundary>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#050E23',
  },
  scroll: {
    flex: 1,
    backgroundColor: '#050E23',
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 36,
  },
  header: {
    paddingBottom: 16,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    marginRight: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  brandText: {
    flex: 1,
  },
  title: {
    color: '#F0F8FF',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 3,
  },
  subtitle: {
    color: 'rgba(240, 248, 255, 0.78)',
    fontSize: 13,
    lineHeight: 19,
  },
  billboardSection: {
    marginBottom: 22,
  },
  billboardCard: {
    height: 176,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  billboardArt: {
    position: 'absolute',
    right: -64,
    top: 8,
  },
  billboardScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(3, 8, 26, 0.5)',
  },
  billboardInfo: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
  },
  billboardKindChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  billboardKindText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  billboardName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    marginBottom: 4,
  },
  billboardDesc: {
    color: 'rgba(240, 248, 255, 0.85)',
    fontSize: 13,
    lineHeight: 18,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 10,
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  dotActive: {
    backgroundColor: '#22D3EE',
    width: 18,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: {
    color: '#F0F8FF',
    fontSize: 20,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  gridItem: {
    width: '48%',
  },
  gridArt: {
    width: '100%',
    height: 132,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  gridKindChip: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(2, 8, 23, 0.55)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  gridKindText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  gridName: {
    color: '#F0F8FF',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 2,
  },
  gridMeta: {
    color: 'rgba(230, 240, 250, 0.6)',
    fontSize: 12,
    fontWeight: '600',
  },
  wrapper: {
    flex: 1,
  },
  createFab: {
    position: 'absolute',
    right: 20,
    bottom: 32,
    width: 72,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#22D3EE',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#22D3EE',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
    zIndex: 20,
  },
  createFabText: {
    color: '#052033',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 8, 23, 0.72)',
  },
  modalPanel: {
    backgroundColor: '#0B1526',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  modalTitle: {
    color: '#F0F8FF',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  modalSubtitle: {
    color: 'rgba(240, 248, 255, 0.82)',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    color: '#F0F8FF',
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
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 10,
    paddingVertical: 12,
  },
  kindButtonSelected: {
    backgroundColor: 'rgba(34, 211, 238, 0.18)',
    borderColor: '#22D3EE',
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
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
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
    color: '#C7D2FE',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  destinationLabel: {
    color: '#F0F8FF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  previewOnlyLabel: {
    color: '#E0FFFF',
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
    color: '#E0FFFF',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 8,
  },
  sliderTrack: {
    height: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
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
  rotationRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  rotationButton: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 10,
    paddingVertical: 10,
  },
  rotationButtonSelected: {
    backgroundColor: 'rgba(34, 211, 238, 0.18)',
    borderColor: '#22D3EE',
  },
  rotationButtonText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '800',
  },
  rotationHint: {
    color: 'rgba(224, 255, 255, 0.75)',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  staticImagePreview: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginTop: 14,
    marginBottom: 14,
  },
  staticHint: {
    color: 'rgba(230, 240, 250, 0.65)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
    marginBottom: 20,
    lineHeight: 18,
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
    color: '#E0FFFF',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 14,
  },
  errorBoundary: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#050E23',
  },
  errorBoundaryTitle: {
    color: '#F0F8FF',
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