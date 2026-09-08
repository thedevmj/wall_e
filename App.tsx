/**
 * Live Wallpaper Studio
 * Android-only wallpaper editor and library shell.
 */

import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
  PanResponder,
} from 'react-native';
import type { ImageStyle, StyleProp, ViewStyle } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import Video, { ViewType } from 'react-native-video';
import type { ReactVideoSource, VideoRef } from 'react-native-video';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from './src/components/ActionButton';
import { BatteryFluidPreview } from './src/components/BatteryFluidPreview';
import { ColorPicker } from './src/components/ColorPicker';
import { FluidFlowPreview } from './src/components/FluidFlowPreview';
import { MembraneFlowPreview } from './src/components/MembraneFlowPreview';
import { GeometricArt } from './src/components/GeometricArt';
import { bundledWallpapers } from './src/data/bundledWallpapers';
import { wallpaperRepository, findBundledTitleCollision } from './src/services/wallpaperRepository';
import { wallpaperBridge } from './src/services/wallpaperBridge';
import { enforceStorageQuota } from './src/services/storageManager';
import { copyLogs, startLogCapture, logEvent } from './src/services/logService';
import {
  enqueueVideoSequence,
  SequenceInfo,
} from './src/services/sequenceQueue';
import { showToast } from './src/services/toast';
import { ThemeProvider, useTheme, useThemedStyles } from './src/theme/ThemeContext';
import type { Wallpaper, WallpaperCapabilities } from './src/types';

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
    logEvent('error', 'App ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorBoundaryView
          message={this.state.error?.message ?? 'An unexpected error occurred.'}
          onRestart={() => this.setState({ hasError: false, error: null })}
        />
      );
    }
    return this.props.children;
  }
}

function ErrorBoundaryView({
  message,
  onRestart,
}: {
  message: string;
  onRestart: () => void;
}) {
  const styles = useThemedStyles();
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.errorBoundary}>
        <Text style={styles.errorBoundaryTitle}>Something went wrong</Text>
        <Text style={styles.errorBoundaryMessage}>{message}</Text>
        <ActionButton
          label="Copy Logs"
          tone="secondary"
          onPress={() => {
            copyLogs();
            Alert.alert('Logs Copied', 'Logs have been copied to your clipboard. You can paste and share them.');
          }}
        />
        <View style={styles.errorBoundaryActions}>
          <ActionButton
            label="Restart"
            onPress={onRestart}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── Create Wallpaper Modal ──────────────────────────────────────────────

type CreateModalProps = {
  visible: boolean;
  onClose: () => void;
  onCreated: (wallpaper: Wallpaper) => void;
};

function CreateWallpaperModal({ visible, onClose, onCreated }: CreateModalProps) {
  const styles = useThemedStyles();
  const { palette } = useTheme();
  const [editorKind, setEditorKind] = React.useState<'video' | 'static'>('video');
  const [title, setTitle] = React.useState('');
  const [videoUri, setVideoUri] = React.useState<string | null>(null);
  const [pickedVideoPoster, setPickedVideoPoster] = React.useState<string | null>(null);
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
      setPickedVideoPoster(null);
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
        // Reuse the existing app-private copy when this exact video (same
        // SHA-1 digest) was imported before, and remember its poster frame so
        // the created wallpaper has a thumbnail.
        const resolved = await wallpaperRepository.videoFiles.resolvePickedVideo(pickedVideo);
        // Pre-extract the software-playback frame sequence in the background so
        // the wallpaper still plays smoothly on devices with no working video
        // decoder for the wallpaper surface (fire-and-forget; takes a while for
        // long clips). Extractions are serialized so low-RAM phones never run
        // many encodes at once.
        enqueueVideoSequence(resolved.uri).catch(() => undefined);
        setVideoUri(resolved.uri);
        setPickedVideoPoster(resolved.posterUri ?? null);
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
    const name = title.trim() || (editorKind === 'video' ? 'Untitled Video' : 'Untitled Image');
    const newWallpaper: Wallpaper = {
      id: `${editorKind}-${Date.now()}`,
      title: name,
      kind: editorKind,
      description:
        editorKind === 'video'
          ? 'A custom muted video wallpaper loop.'
          : 'A custom still image wallpaper.',
      accent: editorKind === 'video' ? '#FB7185' : '#F59E0B',
      status: 'Needs preview',
      duration: editorKind === 'video' ? `${playbackDuration} sec` : 'Still',
      createdAt: 'Just now',
      videoUri: editorKind === 'video' ? videoUri ?? undefined : undefined,
      imageUri: editorKind === 'static' ? imageUri ?? undefined : undefined,
      poster:
        editorKind === 'video' && pickedVideoPoster ? { uri: pickedVideoPoster } : undefined,
      loop: editorKind === 'video' ? loopVideo : undefined,
      audio: editorKind === 'video' ? videoAudio : undefined,
      playbackDuration: editorKind === 'video' ? playbackDuration : undefined,
      rotation: editorKind === 'video' ? videoRotation : undefined,
    };
    onCreated(newWallpaper);
  }, [editorKind, title, videoUri, pickedVideoPoster, imageUri, loopVideo, videoAudio, playbackDuration, videoRotation, onCreated]);

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
            placeholderTextColor={palette.placeholder}
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
              <Text style={styles.durationLabel}>Video orientation</Text>
              <View style={styles.rotationRow}>
                {([
                  { label: 'Horizontal', value: 0 },
                  { label: 'Vertical', value: 90 },
                ] as const).map(option => (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.label} orientation`}
                    onPress={() => setVideoRotation(option.value)}
                    style={[
                      styles.rotationButton,
                      videoRotation === option.value && styles.rotationButtonSelected,
                    ]}>
                    <Text style={styles.rotationButtonText}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>
              {videoRotation !== 0 && (
                <Text style={styles.rotationHint}>
                  Video rotates 90° clockwise (portrait)
                </Text>
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
            {(['video', 'static'] as const).map(kind => (
              <Pressable
                key={kind}
                onPress={() => setEditorKind(kind)}
                style={[styles.kindButton, editorKind === kind && styles.kindButtonSelected]}>
                <Text style={styles.kindButtonText}>
                  {kind === 'video' ? 'Video' : 'Static'}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.modalActions}>
            <ActionButton label="Cancel" tone="secondary" onPress={onClose} style={styles.modalButton} />
            <ActionButton label="Create" onPress={handleCreate} style={styles.modalButton} />
          </View>
          {errorMessage && (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{errorMessage}</Text>
              <ActionButton
                label="Copy Logs"
                tone="secondary"
                onPress={() => {
                  copyLogs();
                  Alert.alert('Logs Copied', 'Logs have been copied to your clipboard. You can paste and share them.');
                }}
              />
            </View>
          )}
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
  onPickerOpened: (id: string) => void;
  onDelete?: (wallpaper: Wallpaper) => void;
  livePickerAvailable?: boolean;
};

const WallpaperDetailModal = React.memo(function ({
  wallpaper,
  onClose,
  onApplied,
  onWallpaperUpdated,
  onPickerOpened,
  onDelete,
  livePickerAvailable = true,
}: DetailModalProps) {
  const styles = useThemedStyles();
  const { palette } = useTheme();
  const [isApplying, setIsApplying] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [videoError, setVideoError] = React.useState(false);
  const [imageError, setImageError] = React.useState(false);
  const [videoLoaded, setVideoLoaded] = React.useState(false);
  const [rotation, setRotation] = React.useState(0);
  const [preparedUri, setPreparedUri] = React.useState<string | null>(null);
  const [batteryInfo, setBatteryInfo] = React.useState<{ level: number; charging: boolean } | null>(null);
  const [showColorPicker, setShowColorPicker] = React.useState(true);
  const [sequenceInfo, setSequenceInfo] = React.useState<SequenceInfo | null>(null);

  const isBundledVideo = wallpaper?.kind === 'video' && wallpaper?.source != null;
  const videoUri = wallpaper?.videoUri ?? '';
  const isRemotePreview = isBundledVideo && videoUri.startsWith('http');

  // For user-imported videos, load (or lazily prepare on disk) the software
  // frame sequence so the in-app preview matches the wallpaper engine instead
  // of relying on the video decoder. Native short-circuits when the sequence
  // already exists, so this is cheap on every subsequent open.
  const wallpaperId = wallpaper?.id;
  const wallpaperKind = wallpaper?.kind;
  React.useEffect(() => {
    setSequenceInfo(null);
    if (!wallpaperId || wallpaperKind !== 'video' || isBundledVideo || !videoUri) {
      return undefined;
    }
    let cancelled = false;
    enqueueVideoSequence(videoUri)
      .then(info => {
        if (!cancelled && info) setSequenceInfo(info);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [wallpaperId, wallpaperKind, isBundledVideo, videoUri]);
  // Only user-created (persisted) wallpapers can ever be deleted; bundled
  // defaults never show the Delete action.
  const canDelete =
    wallpaper != null &&
    wallpaper.createdAt !== 'Bundled' &&
    wallpaperRepository.isPersisted(wallpaper);

  const previewRotationStyle = React.useMemo(() => {
    const deg = rotation % 360;
    if (deg === 0) return undefined;
    const scale = deg === 90 || deg === 270 ? 1.6 : 1;
    return {
      transform:
        scale === 1
          ? [{ rotate: `${deg}deg` }]
          : [
              { rotate: `${deg}deg` },
              { scale },
            ],
    };
  }, [rotation]);

  // Reset errors when wallpaper changes
  React.useEffect(() => {
    setErrorMessage(null);
    setIsApplying(false);
    setVideoError(false);
    setImageError(false);
    setVideoLoaded(false);
    setRotation(
      wallpaper?.rotation === 90 || wallpaper?.rotation === 270 ? 90 : 0,
    );
  }, [wallpaper?.id, wallpaper?.rotation]);

  // Read the real battery level/charging state for the battery fluid preview.
  React.useEffect(() => {
    if (wallpaper?.kind !== 'battery') {
      setBatteryInfo(null);
      return undefined;
    }
    let cancelled = false;
    wallpaperBridge
      .getBatteryLevel()
      .then(info => {
        if (!cancelled && info) setBatteryInfo(info);
      })
      .catch(() => {
        if (!cancelled) setBatteryInfo({ level: 50, charging: false });
      });
    return () => {
      cancelled = true;
    };
  }, [wallpaper?.id, wallpaper?.kind]);

  // Bundled (embedded) videos in release resolve to a resource identifier
  // that must be copied to a playable local file first. In dev the URI is
  // already an HTTP metro URL the player can read directly, so skip the copy.
  React.useEffect(() => {
    if (!isBundledVideo || isRemotePreview) {
      setPreparedUri(null);
      return undefined;
    }
    let cancelled = false;
    setPreparedUri(null);
    setVideoError(false);
    const sourceUri = videoUri;
    wallpaperBridge
      .prepareBundledMedia(sourceUri, 'video')
      .then(uri => {
        if (!cancelled && uri) {
          setPreparedUri(uri);
        } else if (!cancelled) {
          setVideoError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setVideoError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isBundledVideo, isRemotePreview, videoUri, wallpaper?.id]);

  // Persist rotation changes back to the library when it changes.
  React.useEffect(() => {
    if (wallpaper && rotation !== (wallpaper.rotation ?? 0)) {
      onWallpaperUpdated({ ...wallpaper, rotation });
    }
  }, [rotation, wallpaper, onWallpaperUpdated]);

  const performApply = React.useCallback(
    async (destination: 'HOME' | 'LOCK' | 'BOTH') => {
      if (!wallpaper) return;
      setIsApplying(true);
      setErrorMessage(null);
      try {
        const mediaUri =
          wallpaper.kind === 'static'
            ? wallpaper.imageUri ?? ''
            : wallpaper.kind === 'video' && isBundledVideo && preparedUri
              ? preparedUri
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
          wallpaper.accent,
        );
        if (result.ok) {
          // Prepare the software-playback fallback sequence in the background so
          // this wallpaper runs on every device, even without a usable video
          // decoder (extraction is one-time, cached on disk, and serialized so
          // only one encode runs at a time on low-RAM phones).
          if (wallpaper.kind === 'video' && mediaUri) {
            enqueueVideoSequence(mediaUri).catch(() => undefined);
          }
          const directSet =
            result.mode != null && result.mode.startsWith('direct-live-wallpaper');
          // Direct set commits immediately (deterministic). For static wallpapers
          // native commits with setBitmap. Only the system-picker fallback still
          // needs to be resolved on resume (see onPickerOpened / AppState).
          onApplied(wallpaper.id);
          if (!directSet && wallpaper.kind !== 'static') {
            onPickerOpened(wallpaper.id);
          }
          if (directSet) {
            showToast(`✓ "${wallpaper.title}" set as ${destination.toLowerCase()} wallpaper`);
            Alert.alert(
              'Wallpaper Set',
              `"${wallpaper.title}" is now your ${destination.toLowerCase()} wallpaper.`,
              [{ text: 'OK' }],
            );
          } else if (wallpaper.kind === 'static') {
            showToast(`✓ "${wallpaper.title}" set as ${destination.toLowerCase()} wallpaper`);
            Alert.alert(
              'Wallpaper Applied',
              '"' + wallpaper.title + '" is now your ' + destination.toLowerCase() + ' wallpaper.',
              [{ text: 'OK' }],
            );
          } else {
            showToast('Follow the system prompt to confirm the wallpaper', 'long');
          }
          onClose();
        } else {
          const applyError =
            result.error ?? 'Android could not open the wallpaper picker.';
          setErrorMessage(applyError);
          showToast(applyError, 'long');
          logEvent('error', `applyWallpaper failed for "${wallpaper.title}":`, applyError);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
        setErrorMessage(message);
        showToast(message, 'long');
        logEvent('error', `applyWallpaper threw for "${wallpaper.title}":`, error);
      } finally {
        setIsApplying(false);
      }
    },
    [wallpaper, rotation, preparedUri, isBundledVideo, onApplied, onPickerOpened, onClose],
  );

  const applySelected = React.useCallback(
    (destination: 'HOME' | 'LOCK' | 'BOTH') => {
      if (!wallpaper) return;
      if (wallpaper.kind === 'video' && !wallpaper.videoUri) {
        setErrorMessage('Choose a video before applying this wallpaper.');
        showToast('Choose a video before applying', 'long');
        return;
      }
      if (wallpaper.kind === 'static' && !wallpaper.imageUri) {
        setErrorMessage('Choose an image before applying this wallpaper.');
        showToast('Choose an image before applying', 'long');
        return;
      }
      // Static and direct-set wallpapers take effect immediately with no system
      // prompt, so confirm in-app first to avoid accidental one-tap sets.
      Alert.alert(
        'Set as wallpaper',
        `Set "${wallpaper.title}" as your ${destination.toLowerCase()} wallpaper?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Set Wallpaper', onPress: () => performApply(destination) },
        ],
      );
    },
    [wallpaper, performApply],
  );

  const chooseVideoForSelected = React.useCallback(async () => {
    if (!wallpaper) return;
    setErrorMessage(null);
    try {
      const pickedVideo = await wallpaperBridge.pickVideo();
      if (!pickedVideo) {
        setErrorMessage('No video was selected. Please try again.');
        showToast('No video selected', 'long');
        return;
      }
      // Reuse an existing app-private copy + thumbnail when this exact video
      // was imported before, so re-picking never multiplies storage usage.
      const resolved = await wallpaperRepository.videoFiles.resolvePickedVideo(pickedVideo);
      enqueueVideoSequence(resolved.uri).catch(() => undefined);
      const updatedWallpaper: Wallpaper = {
        ...wallpaper,
        videoUri: resolved.uri,
        poster: resolved.posterUri ? { uri: resolved.posterUri } : wallpaper.poster,
        playbackDuration: Math.min(30, Math.max(1, Math.round(pickedVideo.durationSeconds))),
      };
      // The old copied video (if in app-private storage) becomes orphaned once
      // the wallpaper points at the new file — release it and deregister its
      // digest so its poster file can be pruned too.
      const oldUri = wallpaper.videoUri;
      onWallpaperUpdated(updatedWallpaper);
      if (oldUri && oldUri !== resolved.uri) {
        const registered = await wallpaperRepository.videoFiles.findByUri(oldUri);
        wallpaperBridge.deleteStoredMedia(oldUri).catch(() => undefined);
        if (registered) {
          if (registered.posterUri) {
            wallpaperBridge.deleteStoredMedia(registered.posterUri).catch(() => undefined);
          }
          wallpaperRepository.videoFiles.remove(registered.digest).catch(() => undefined);
        }
      }
      setVideoError(false);
      showToast('Video selected');
    } catch {
      setErrorMessage('The selected video could not be read. Please choose another video.');
      showToast('Could not read that video', 'long');
    }
  }, [wallpaper, onWallpaperUpdated]);

  const chooseImageForSelected = React.useCallback(async () => {
    if (!wallpaper) return;
    setErrorMessage(null);
    try {
      const pickedImage = await wallpaperBridge.pickImage();
      if (!pickedImage) {
        setErrorMessage('No image was selected. Please try again.');
        showToast('No image selected', 'long');
        return;
      }
      const updatedWallpaper: Wallpaper = {
        ...wallpaper,
        imageUri: pickedImage.uri,
      };
      onWallpaperUpdated(updatedWallpaper);
      setImageError(false);
      showToast('Image selected');
    } catch {
      setErrorMessage('The selected image could not be read. Please choose another image.');
      showToast('Could not read that image', 'long');
    }
  }, [wallpaper, onWallpaperUpdated]);

  const requestDelete = React.useCallback(() => {
    if (!wallpaper || !onDelete) return;
    Alert.alert(
      'Delete wallpaper',
      `Are you sure you want to delete "${wallpaper.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete(wallpaper) },
      ],
    );
  }, [wallpaper, onDelete]);

  if (!wallpaper) return null;

  return (
    <Modal visible={wallpaper !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalPanel}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}>
          {/* Loading overlay */}
          {isApplying && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={palette.accent} />
              <Text style={styles.loadingText}>Opening wallpaper picker...</Text>
            </View>
          )}

          {/* Preview */}
          <View style={styles.previewStage}>
            <View style={styles.previewBadge} pointerEvents="none">
              <Text style={styles.previewBadgeText}>
                {                wallpaper.kind === 'video' ||
                wallpaper.kind === 'battery' ||
                wallpaper.kind === 'membrane' ||
                wallpaper.kind === 'fluid'
                  ? 'LIVE PREVIEW'
                  : 'PREVIEW'}
              </Text>
            </View>
          {wallpaper.kind === 'static' && wallpaper.imageUri && !imageError ? (
            <Image
              key={wallpaper.id}
              source={wallpaper.source ?? { uri: wallpaper.imageUri }}
              style={[styles.staticImagePreview, previewRotationStyle]}
              resizeMode="cover"
              onError={() => setImageError(true)}
            />
          ) : wallpaper.kind === 'static' && imageError ? (
            <View style={[styles.preview, { backgroundColor: wallpaper.accent }]}>
              <Text style={styles.previewLabel}>IMAGE PREVIEW UNAVAILABLE</Text>
              <Text style={styles.videoErrorHint}>Try selecting another image</Text>
            </View>
          ) : wallpaper.kind === 'video' && sequenceInfo && !videoError ? (
            <SequenceVideo
              dir={sequenceInfo.dir}
              frames={sequenceInfo.frames}
              fps={sequenceInfo.fps}
              loop={wallpaper.loop !== false}
              style={[styles.videoPreviewAbs, previewRotationStyle]}
            />
          ) : wallpaper.kind === 'video' && isBundledVideo && !videoError ? (
            <View style={styles.videoPreviewWrap}>
              {/*
                Ordering matters: react-native-video's TEXTURE view renders an
                opaque green frame until it presents the first real frame. Keep
                the static poster on top while the video is still loading so the
                green is never visible, then move the video on top to reveal the
                live preview only once it is ready. For play-once, settle back on
                the poster when the clip ends.
              */}
              {videoLoaded && wallpaper.poster && (
                <Image
                  source={wallpaper.poster}
                  resizeMode="cover"
                  resizeMethod="resize"
                  style={styles.videoPreviewAbs as StyleProp<ImageStyle>}
                />
              )}
              <Video
                key={wallpaper.id}
                source={resolveVideoPreviewSource(wallpaper, preparedUri)}
                style={[styles.videoPreviewAbs, previewRotationStyle]}
                resizeMode="cover"
                viewType={ViewType.TEXTURE}
                repeat={wallpaper.loop !== false}
                muted={!wallpaper.audio}
                playInBackground={false}
                playWhenInactive={false}
                bufferConfig={{
                  minBufferMs: 15000,
                  maxBufferMs: 60000,
                  bufferForPlaybackMs: 2500,
                  bufferForPlaybackAfterRebufferMs: 5000,
                  maxHeapAllocationPercent: 25,
                  minBufferMemoryReservePercent: 10,
                }}
                onLoad={() => setVideoLoaded(true)}
                onError={() => setVideoError(true)}
                onEnd={() => {
                  if (wallpaper.loop !== false) return;
                  setVideoLoaded(false);
                }}
              />
              {!videoLoaded && wallpaper.poster && (
                <Image
                  source={wallpaper.poster}
                  resizeMode="cover"
                  resizeMethod="resize"
                  style={styles.videoPreviewAbs as StyleProp<ImageStyle>}
                />
              )}
            </View>
          ) : wallpaper.kind === 'video' && wallpaper.poster ? (
            <Image
              source={wallpaper.poster}
              resizeMode="cover"
              resizeMethod="resize"
              style={styles.videoPreview as StyleProp<ImageStyle>}
            />
          ) : wallpaper.kind === 'video' ? (
            <View style={[styles.preview, { backgroundColor: wallpaper.accent }]}>
              <Text style={styles.previewLabel}>VIDEO PREVIEW UNAVAILABLE</Text>
              <Text style={styles.videoErrorHint}>
                Try selecting an MP4 or H.264 video
              </Text>
            </View>
          ) : wallpaper.kind === 'battery' ? (
            <View style={styles.preview}>
              <BatteryFluidPreview
                level={batteryInfo?.level ?? 50}
                charging={batteryInfo?.charging ?? false}
                accent={wallpaper.accent}
              />
            </View>
          ) : wallpaper.kind === 'membrane' ? (
            <View style={styles.preview}>
              <MembraneFlowPreview accent={wallpaper.accent} />
            </View>
          ) : wallpaper.kind === 'fluid' ? (
            <View style={styles.preview}>
              <FluidFlowPreview accent={wallpaper.accent} />
            </View>
          ) : (
            <AnimatedPreview accent={wallpaper.accent} />
          )}
          </View>

          <Text style={styles.modalTitle}>{wallpaper.title}</Text>
          <Text style={styles.modalSubtitle}>{wallpaper.description}</Text>

          {wallpaper.kind === 'video' && (
            <>
              <Text style={styles.durationLabel}>
                Plays for {wallpaper.playbackDuration ?? 30} seconds
                {wallpaper.loop === false ? ' once' : ' on repeat'}
                {wallpaper.audio ? ' with audio' : ' muted'}
                {rotation !== 0 ? ' · portrait' : ' · horizontal'}
              </Text>
              <Text style={styles.durationLabel}>Video orientation</Text>
              <View style={styles.rotationRow}>
                {([
                  { label: 'Horizontal', value: 0 },
                  { label: 'Vertical', value: 90 },
                ] as const).map(option => (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.label} orientation`}
                    onPress={() => setRotation(option.value)}
                    style={[
                      styles.rotationButton,
                      rotation === option.value && styles.rotationButtonSelected,
                    ]}>
                    <Text style={styles.rotationButtonText}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Play continuously toggle"
                accessibilityState={{ checked: wallpaper.loop !== false }}
                onPress={() =>
                  onWallpaperUpdated({ ...wallpaper, loop: wallpaper.loop === false })
                }
                style={styles.loopRow}>
                <View
                  style={[
                    styles.checkbox,
                    wallpaper.loop !== false && styles.checkboxChecked,
                  ]}>
                  {wallpaper.loop !== false && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <Text style={styles.loopText}>
                  {wallpaper.loop === false ? 'Play once' : 'Play continuously'}
                </Text>
              </Pressable>
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

          {wallpaper.kind === 'battery' && (
            <Text style={styles.staticHint}>
              Animated fluid that fills to your real battery level and shifts through a
              full health spectrum — red/orange at low, green at mid, and blue at full —
              surges while charging, and sways as you tilt your phone.
            </Text>
          )}

          {wallpaper.kind === 'membrane' && (
            <Text style={styles.staticHint}>
              Premium minimalist light. Enormous translucent surfaces of soft pink-lavender
              and deep crimson flow slowly over a spacious midnight-navy void, separated by
              one giant organic curve. Calm, cinematic and OLED-friendly.
            </Text>
          )}

          {wallpaper.kind === 'fluid' && (
            <Text style={styles.staticHint}>
              OnePlus-inspired animated fluid. Large translucent colour blobs drift, morph
              and overlap over true OLED black, creating an organic glass-like flowing
              composition. Customise the accent to shift the entire palette.
            </Text>
          )}

          {(wallpaper.kind === 'battery' || wallpaper.kind === 'membrane' || wallpaper.kind === 'fluid') && (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowColorPicker(prev => !prev)}
                style={[styles.kindButton, showColorPicker && styles.kindButtonSelected]}>
                <Text style={styles.kindButtonText}>
                  {showColorPicker ? 'Hide Color Picker' : 'Customize Color'}
                </Text>
              </Pressable>
              {showColorPicker && (
                <ColorPicker
                  color={wallpaper.accent}
                  onChange={(hex) => onWallpaperUpdated({ ...wallpaper, accent: hex })}
                />
              )}
            </>
          )}

          {(wallpaper.kind === 'video' ||
            wallpaper.kind === 'battery' ||
            wallpaper.kind === 'membrane' ||
            wallpaper.kind === 'fluid') &&
            !livePickerAvailable && (
              <Text style={styles.unsupportedHint}>
                This device has no live wallpaper picker, so live wallpapers cannot be applied.
                Use a static wallpaper instead.
              </Text>
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
            {canDelete && (
              <ActionButton
                label="Delete"
                tone="danger"
                onPress={requestDelete}
                style={styles.modalButton}
              />
            )}
          </View>
          {errorMessage && (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{errorMessage}</Text>
              <ActionButton
                label="Copy Logs"
                tone="secondary"
                onPress={() => {
                  copyLogs();
                  Alert.alert('Logs Copied', 'Logs have been copied to your clipboard. You can paste and share them.');
                }}
              />
            </View>
          )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

// ─── Animated Preview (doodle) ───────────────────────────────────────────

function AnimatedPreview({ accent }: { accent: string }) {
  const styles = useThemedStyles();
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

// ─── Media rendering helpers ─────────────────────────────────────────────

function toVideoSource(source: Wallpaper['source']): ReactVideoSource {
  if (source == null) return {};
  return source as unknown as ReactVideoSource;
}

/**
 * Picks the most playable source for the video preview. Bundled videos carry
 * an asset id (require()) that react-native-video can resolve in both dev
 * (metro URL) and release. A prepared local file is preferred when available
 * so the preview does not depend on the dev server being reachable.
 */
function resolveVideoPreviewSource(
  wallpaper: Wallpaper,
  preparedUri: string | null,
): ReactVideoSource {
  if (wallpaper.kind !== 'video') return {};
  if (preparedUri) return { uri: preparedUri };
  if (wallpaper.source != null) return toVideoSource(wallpaper.source);
  if (wallpaper.videoUri) return { uri: wallpaper.videoUri };
  return {};
}

/**
 * Paused, muted video thumbnail that seeks to a real frame once loaded.
 * Set `autoPlay` to preview a video while it is visible.
 */
function LiveThumb({
  wallpaper,
  style,
  autoPlay = false,
}: {
  wallpaper: Wallpaper;
  style?: StyleProp<ViewStyle>;
  autoPlay?: boolean;
}) {
  const styles = useThemedStyles();
  const videoRef = React.useRef<VideoRef>(null);
  const [failed, setFailed] = React.useState(false);
  const source =
    wallpaper.source ?? (wallpaper.videoUri ? { uri: wallpaper.videoUri } : undefined);

  if (failed) {
    return (
      <View style={[style, styles.videoPlaceholder]}>
        <GeometricArt accent={wallpaper.accent} size={90} seed={wallpaper.id.length} />
      </View>
    );
  }

  // User-imported videos carry an extracted poster frame; static thumbnails
  // render that JPEG instead of decoding the whole file (which for a large
  // library would be slow and memory-heavy). Auto-play (billboard) still
  // decodes the real video.
  if (!autoPlay && wallpaper.poster) {
    return (
      <Image
        source={wallpaper.poster}
        resizeMode="cover"
        resizeMethod="resize"
        style={style as StyleProp<ImageStyle>}
      />
    );
  }

  return (
    <Video
      ref={videoRef}
      source={toVideoSource(source)}
      style={style}
      resizeMode="cover"
      viewType={ViewType.TEXTURE}
      muted={!wallpaper.audio}
      paused={!autoPlay}
      repeat
      playWhenInactive={false}
      playInBackground={false}
      bufferConfig={{
        minBufferMs: 15000,
        maxBufferMs: 60000,
        bufferForPlaybackMs: 2500,
        bufferForPlaybackAfterRebufferMs: 5000,
        maxHeapAllocationPercent: 25,
        minBufferMemoryReservePercent: 10,
      }}
      onLoad={() => {
        if (!autoPlay) {
          try {
            videoRef.current?.seek(0.1);
          } catch {
            // ignore seek failures on paused thumbnails
          }
        }
      }}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Renders the actual media for a wallpaper — image, video, or a fallback
 * doodle accent for placeholders.
 */
const WallpaperMedia = React.memo(function ({
  wallpaper,
  style,
  autoPlay = false,
}: {
  wallpaper: Wallpaper;
  style?: StyleProp<ViewStyle>;
  autoPlay?: boolean;
}) {
  const styles = useThemedStyles();
  if (wallpaper.kind === 'static') {
    return (
      <Image
        source={wallpaper.source ?? (wallpaper.imageUri ? { uri: wallpaper.imageUri } : undefined)}
        resizeMode="cover"
        resizeMethod="resize"
        style={style as StyleProp<ImageStyle>}
      />
    );
  }
  if (wallpaper.kind === 'doodle') {
    return (
      <View style={[style, styles.doodleFallback]}>
        <GeometricArt accent={wallpaper.accent} size={140} seed={wallpaper.id.length} />
      </View>
    );
  }
  if (wallpaper.kind === 'battery') {
    return (
      <View
        style={[
          style,
          styles.doodleFallback,
          { alignItems: 'center', justifyContent: 'center' },
        ]}>
        <BatteryFluidPreview level={65} charging={false} compact />
      </View>
    );
  }
  if (wallpaper.kind === 'membrane') {
    return (
      <View
        style={[
          style,
          styles.doodleFallback,
          { alignItems: 'center', justifyContent: 'center' },
        ]}>
        <MembraneFlowPreview compact accent={wallpaper.accent} />
      </View>
    );
  }
  if (wallpaper.kind === 'fluid') {
    return (
      <View
        style={[
          style,
          styles.doodleFallback,
          { alignItems: 'center', justifyContent: 'center' },
        ]}>
        <FluidFlowPreview compact accent={wallpaper.accent} />
      </View>
    );
  }
  return <LiveThumb key={wallpaper.id} wallpaper={wallpaper} style={style} autoPlay={autoPlay} />;
});

/**
 * Renders a user-imported video from its pre-extracted JPEG frame sequence
 * (the same pixels the native wallpaper service plays). Drives a frame index at
 * the recorded FPS with one JS timer while <Image> supplies frames, so the
 * in-app preview matches the wallpaper without depending on the device's (often
 * broken) hardware AVC decoder. Pauses automatically while the app is in the
 * background.
 */
type SequenceVideoProps = {
  dir: string;
  frames: number;
  fps: number;
  loop?: boolean;
  style?: StyleProp<ImageStyle>;
};

// How many frames ahead of the current one to keep warm in the preview's image
// cache. Larger smooths decodes that lag under JS load, but each is a full JPEG.
const LOOKAHEAD_PREVIEW_FRAMES = 3;

function SequenceVideo({ dir, frames, fps, loop = true, style }: SequenceVideoProps) {
  const [index, setIndex] = React.useState(0);
  const [appActive, setAppActive] = React.useState(true);
  const frameCount = Math.max(1, Math.trunc(frames));
  const rate = Math.max(1, fps);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  // Advance the timeline on the display's vsync (requestAnimationFrame) instead
  // of a fixed setInterval, so the preview stays aligned with how the native
  // wallpaper engine paces frames. Elapsed time is accumulated and converted to
  // a frame index, so a dropped JS frame simply advances further rather than
  // holding the previous picture.
  React.useEffect(() => {
    if (!appActive || frameCount <= 1) return undefined;
    let rafId: number;
    let last = Date.now();
    let elapsed = 0;
    const tick = () => {
      const now = Date.now();
      elapsed += now - last;
      last = now;
      const raw = Math.floor((elapsed / 1000) * rate);
      const maxIndex = loop ? frameCount - 1 : frameCount - 1;
      let next = raw % frameCount;
      if (!loop && raw >= frameCount) next = maxIndex;
      setIndex(current => (current === next ? current : next));
      // Continue ticking for looping; for one-shot keep ticking so warmup never
      // stalls, but clamp the index so it holds the final frame.
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [rate, frameCount, loop, appActive]);

  const uriFor = React.useCallback(
    (frameIndex: number) => {
      const safe = ((frameIndex % frameCount) + frameCount) % frameCount;
      return `file://${dir}/frame_${String(safe).padStart(6, '0')}.jpg`;
    },
    [dir, frameCount],
  );

  // Warm a small lookahead window so a slow decode under load never leaves the
  // viewer on a stale frame.
  React.useEffect(() => {
    for (let ahead = 1; ahead <= LOOKAHEAD_PREVIEW_FRAMES; ahead += 1) {
      Image.prefetch(uriFor(index + ahead)).catch(() => undefined);
    }
  }, [index, uriFor]);

  return (
    <Image
      source={{ uri: uriFor(index) }}
      resizeMode="cover"
      resizeMethod="resize"
      style={style}
    />
  );
}

// ─── Featured Billboard (auto-rotates every 5 seconds) ───────────────────

const BILLBOARD_INTERVAL_MS = 5000;
const BILLBOARD_CARD_HEIGHT = 176;
const BOARD_OVERSCAN = 300;
const BILLBOARD_MAX = 10;

type BillboardProps = {
  wallpapers: Wallpaper[];
  onSelect: (wallpaper: Wallpaper) => void;
  scrollY: number;
  viewportHeight: number;
  active?: boolean;
};

const Billboard = React.memo(function ({ wallpapers, onSelect, scrollY, viewportHeight, active = true }: BillboardProps) {
  const styles = useThemedStyles();
  const [index, setIndex] = React.useState(0);
  const fade = React.useRef(new Animated.Value(1)).current;
  const sectionTop = React.useRef(0);
  const measured = React.useRef(false);
  const count = wallpapers.length;

  const visible =
    !measured.current ||
    (sectionTop.current + BILLBOARD_CARD_HEIGHT + BOARD_OVERSCAN > scrollY &&
      sectionTop.current - BOARD_OVERSCAN < scrollY + viewportHeight);

  React.useEffect(() => {
    if (count < 2 || !active) return undefined;
    const timer = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 240, useNativeDriver: true }).start(() => {
        setIndex(current => (current + 1) % count);
        Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }).start();
      });
    }, BILLBOARD_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [count, fade, active]);

  if (count === 0) return null;

  const current = wallpapers[Math.min(index, count - 1)];

  return (
    <View
      style={styles.billboardSection}
      onLayout={event => {
        sectionTop.current = event.nativeEvent.layout.y;
        measured.current = true;
      }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Featured: ${current.title}`}
        onPress={() => onSelect(current)}>
        <Animated.View style={[styles.billboardCard, { opacity: fade }]}>
          <View style={styles.billboardArt}>
            {visible && active ? (
              <WallpaperMedia wallpaper={current} style={styles.billboardMedia} autoPlay />
            ) : (
              <View style={[styles.billboardMedia, styles.videoPlaceholder]}>
                <GeometricArt accent={current.accent} size={140} seed={current.id.length} />
              </View>
            )}
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
});

// ─── Media Grid (FlatList rows) ───────────────────────────────────────────

type Section = 'live' | 'dynamic' | 'static';

type GridRow =
  | { key: string; $rowType: 'billboard' }
  | { key: string; $rowType: 'header'; title: string; count: number }
  | { key: string; $rowType: 'cards'; cards: Wallpaper[] };

/**
 * Lightweight grid card. Video players are intentionally NOT mounted here —
 * they are only created for the featured billboard and the wallpaper you
 * select. Video cards render a placeholder so FlatList can keep rows cheap.
 */
const WallpaperCard = React.memo(function ({
  wallpaper,
  onSelect,
}: {
  wallpaper: Wallpaper;
  onSelect: (wallpaper: Wallpaper) => void;
}) {
  const styles = useThemedStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${wallpaper.title}`}
      onPress={() => onSelect(wallpaper)}
      style={styles.gridItem}>
      <View style={styles.gridArt}>
        {wallpaper.kind === 'battery' ? (
          <View
            style={[
              styles.gridMedia,
              { alignItems: 'center', justifyContent: 'center', backgroundColor: '#060A10' },
            ]}>
            <BatteryFluidPreview level={60} charging={false} compact />
          </View>
        ) : wallpaper.kind === 'membrane' ? (
          <View
            style={[
              styles.gridMedia,
              { alignItems: 'center', justifyContent: 'center', backgroundColor: '#020610' },
            ]}>
            <MembraneFlowPreview compact accent={wallpaper.accent} />
          </View>
        ) : wallpaper.kind === 'fluid' ? (
          <View
            style={[
              styles.gridMedia,
              { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' },
            ]}>
            <FluidFlowPreview compact accent={wallpaper.accent} />
          </View>
        ) : wallpaper.kind === 'static' ? (
          <Image
            source={wallpaper.source ?? (wallpaper.imageUri ? { uri: wallpaper.imageUri } : undefined)}
            resizeMode="cover"
            resizeMethod="resize"
            style={styles.gridMedia as StyleProp<ImageStyle>}
          />
        ) : wallpaper.kind === 'video' && wallpaper.poster ? (
          <Image
            source={wallpaper.poster}
            resizeMode="cover"
            resizeMethod="resize"
            style={styles.gridMedia as StyleProp<ImageStyle>}
          />
        ) : (
          <View style={[styles.gridMedia, styles.videoPlaceholder]}>
            <GeometricArt accent={wallpaper.accent} size={90} seed={wallpaper.id.length} />
          </View>
        )}
        <View style={styles.gridKindChip}>
          <Text style={styles.gridKindText}>
            {wallpaper.kind === 'video'
              ? 'LIVE'
              : wallpaper.kind === 'battery' ||
                  wallpaper.kind === 'membrane' ||
                  wallpaper.kind === 'fluid'
                ? 'DYNAMIC'
                : wallpaper.kind === 'static'
                  ? 'STATIC'
                  : 'DOODLE'}
          </Text>
        </View>
      </View>
      <Text style={styles.gridName} numberOfLines={1}>
        {wallpaper.title}
      </Text>
      <Text style={styles.gridMeta}>{wallpaper.duration}</Text>
    </Pressable>
  );
});

function buildGridRows(
  section: Section,
  liveItems: Wallpaper[],
  dynamicItems: Wallpaper[],
  staticItems: Wallpaper[],
): GridRow[] {
  const rows: GridRow[] = [{ key: 'billboard', $rowType: 'billboard' }];
  const pushSection = (title: string, items: Wallpaper[]) => {
    if (items.length === 0) return;
    rows.push({ key: `h-${title}`, $rowType: 'header', title, count: items.length });
    for (let start = 0; start < items.length; start += 2) {
      rows.push({ key: `c-${title}-${start}`, $rowType: 'cards', cards: items.slice(start, start + 2) });
    }
  };
  if (section === 'live') {
    pushSection('Live wallpapers', liveItems);
  } else if (section === 'dynamic') {
    pushSection('Dynamic wallpapers', dynamicItems);
  } else {
    pushSection('Static wallpapers', staticItems);
  }
  return rows;
}

// ─── Section Tabs (top navigation) ───────────────────────────────────────

const SECTION_TABS: { key: Section; label: string }[] = [
  { key: 'live', label: 'Live' },
  { key: 'dynamic', label: 'Dynamic' },
  { key: 'static', label: 'Static' },
];

const SectionTabs = React.memo(function ({
  section,
  onChange,
  liveCount,
  dynamicCount,
  staticCount,
}: {
  section: Section;
  onChange: (section: Section) => void;
  liveCount: number;
  dynamicCount: number;
  staticCount: number;
}) {
  const styles = useThemedStyles();
  return (
    <View style={styles.tabBar}>
      {SECTION_TABS.map(tab => {
        const active = tab.key === section;
        const count =
          tab.key === 'live'
            ? liveCount
            : tab.key === 'dynamic'
              ? dynamicCount
              : staticCount;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${tab.label} wallpapers`}
            onPress={() => onChange(tab.key)}
            style={[styles.tabButton, active && styles.tabButtonActive]}>
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
              {tab.label}
            </Text>
            <View style={[styles.tabCountPill, active && styles.tabCountPillActive]}>
              <Text style={[styles.tabCountText, active && styles.tabCountTextActive]}>
                {count}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
});

// ─── Main App ────────────────────────────────────────────────────────────

function AppShell() {
  const styles = useThemedStyles();
  const { isDark: isDarkTheme, palette } = useTheme();
  const [wallpapers, setWallpapers] = React.useState<Wallpaper[]>(bundledWallpapers);
  const [selectedWallpaper, setSelectedWallpaper] = React.useState<Wallpaper | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [section, setSection] = React.useState<Section>('live');
  const [scrollY, setScrollY] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(0);
  const lastScrollCommit = React.useRef(0);
  const [capabilities, setCapabilities] = React.useState<WallpaperCapabilities | null>(null);
  const [pendingApplyId, setPendingApplyId] = React.useState<string | null>(null);
  // Tracks whether the app is in the foreground so the billboard stops
  // decoding videos and rotating while the user is elsewhere.
  const [isForeground, setIsForeground] = React.useState(true);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setIsForeground(state === 'active');
    });
    return () => subscription.remove();
  }, [])

  React.useEffect(() => {
    startLogCapture();
  }, []);

  // Load persisted user-created wallpapers on mount and merge them with the
  // bundled (code-defined) library so the library survives app restarts.
  React.useEffect(() => {
    let cancelled = false;
    wallpaperRepository
      .getAll()
      .then(merged => {
        if (!cancelled) {
          setWallpapers(merged);
          // Housekeeping on launch: remove any stale DB rows for bundled
          // wallpapers (older versions could persist them) so merely viewing
          // defaults never creates extra library entries. Also de-duplicate
          // accidental double-created wallpapers (same name + same media file)
          // and trim orphaned media so storage stays bounded.
          Promise.all([
            wallpaperRepository.pruneBundledRows(),
            wallpaperRepository.dedupeUserWallpapers(),
          ])
            .then(() => wallpaperRepository.getAll())
            .then(cleaned => {
              if (!cancelled && cleaned.length !== merged.length) {
                setWallpapers(cleaned);
              }
            })
            .catch(() => undefined);
          enforceStorageQuota(merged).catch(() => undefined);
        }
      })
      .catch(() => {
        // Repository already falls back to bundled on error; keep current state.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve a pending live wallpaper apply once the app returns to the
  // foreground after the system wallpaper picker closes. Native code decides
  // whether the wallpaper was actually confirmed; if not, it resets any preview
  // so a cancelled/previewed wallpaper never sticks as the set wallpaper.
  const pendingApplyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    pendingApplyRef.current = pendingApplyId;
  }, [pendingApplyId]);

  const wallpapersRef = React.useRef(wallpapers);
  React.useEffect(() => {
    wallpapersRef.current = wallpapers;
  }, [wallpapers]);

  // Owns one media file per wallpaper (by URI). Updated synchronously on every
  // create/update/delete so re-importing a video that is already in the library
  // (or committing a fast double-tap) cannot add a second copy of the card.
  const ownedMediaUrisRef = React.useRef(new Map<string, string>());
  React.useEffect(() => {
    const map = new Map<string, string>();
    for (const item of wallpapers) {
      const uri = item.kind === 'video' ? item.videoUri : item.imageUri;
      if (uri) map.set(uri, item.id);
    }
    ownedMediaUrisRef.current = map;
  }, [wallpapers]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      const pendingId = pendingApplyRef.current;
      if (state !== 'active' || pendingId == null) return;
      wallpaperBridge.resolvePendingApply().then(committed => {
        if (committed) {
          const name =
            wallpapersRef.current.find(item => item.id === pendingId)?.title ?? 'Wallpaper';
          showToast(`✓ "${name}" applied`);
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
        if (!cancelled) setCapabilities(info);
      })
      .catch(() => {
        if (!cancelled) setCapabilities(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // On devices without a live wallpaper picker (budget/enterprise/kiosk ROMs),
  // the Live tab explains the limitation instead of failing silently.
  const livePickerUnavailable = capabilities != null && !capabilities.liveWallpaperPickerAvailable;

  const [searchQuery, setSearchQuery] = React.useState('');
  const [sortMode, setSortMode] = React.useState<'newest' | 'name'>('newest');

  // Serializable search (title/description/id) + sort (newest first / A–Z)
  // over the whole library before it is split into sections, so every tab
  // reflects the same filter.
  const searchableWallpapers = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? wallpapers.filter(
          item =>
            item.title.toLowerCase().includes(query) ||
            item.description.toLowerCase().includes(query) ||
            item.id.toLowerCase().includes(query),
        )
      : wallpapers;
    if (sortMode === 'name') {
      return [...filtered].sort((a, b) => a.title.localeCompare(b.title));
    }
    return [...filtered].sort((a, b) => {
      const ta = Date.parse(a.createdAt);
      const tb = Date.parse(b.createdAt);
      const na = Number.isNaN(ta) ? 0 : ta;
      const nb = Number.isNaN(tb) ? 0 : tb;
      return nb - na;
    });
  }, [wallpapers, searchQuery, sortMode]);

  const liveItems = React.useMemo(
    () => searchableWallpapers.filter(item => item.kind === 'video' || item.kind === 'doodle'),
    [searchableWallpapers],
  );
  const dynamicItems = React.useMemo(
    () =>
      searchableWallpapers.filter(
        item =>
          item.kind === 'battery' ||
          item.kind === 'membrane' ||
          item.kind === 'fluid',
      ),
    [searchableWallpapers],
  );
  const staticItems = React.useMemo(
    () => searchableWallpapers.filter(item => item.kind === 'static'),
    [searchableWallpapers],
  );

  const rows = React.useMemo(
    () => buildGridRows(section, liveItems, dynamicItems, staticItems),
    [section, liveItems, dynamicItems, staticItems],
  );

  const handleScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Throttle scroll-driven state updates (~10/s) — scroll position only
    // gates the Billboard's active-vs-placeholder media, so re-rendering the
    // whole app at 60fps for it is wasteful. Reading a ref before committing
    // also keeps the latest value available across drop-outs.
    const now = Date.now();
    if (now - lastScrollCommit.current < 100) return;
    lastScrollCommit.current = now;
    setScrollY(event.nativeEvent.contentOffset.y);
  }, []);

  const openCreator = React.useCallback(() => {
    setIsCreating(true);
  }, []);

  const handleWallpaperCreated = React.useCallback((newWallpaper: Wallpaper) => {
    // A user row whose title matches a bundled default (like a re-imported
    // bundled video that keeps its name) would render as a second identical
    // card, because the bundled catalog is always merged in by id. Open the
    // existing bundled card instead of creating a phantom duplicate.
    const bundledCollision = findBundledTitleCollision(
      newWallpaper.title,
      newWallpaper.kind,
    );
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
        // A wallpaper using this exact media file already exists — never create
        // a duplicate card for it. Open the existing one instead.
        setIsCreating(false);
        const existing = wallpapersRef.current.find(item => item.id === ownerId);
        setSelectedWallpaper(existing ?? newWallpaper);
        showToast(`"${newWallpaper.title}" is already in your library`);
        return;
      }
      ownedMediaUrisRef.current.set(mediaUri, newWallpaper.id);
    }
    wallpaperRepository.upsert(newWallpaper).catch(() => undefined);
    setWallpapers(current => [newWallpaper, ...current]);
    setSelectedWallpaper(newWallpaper);
    setIsCreating(false);
    showToast(`Created "${newWallpaper.title}"`);
    // Include the brand-new wallpaper (whose file the registry now owns) in the
    // reference set so quota enforcement never prunes the just-created media.
    enforceStorageQuota([newWallpaper, ...wallpapersRef.current]).catch(() => undefined);
  }, []);

  const handleApplied = React.useCallback((id: string) => {
    setWallpapers(current => {
      const next = current.map(item => ({
        ...item,
        status: item.id === id ? ('Applied' as const) : item.status,
      }));
      const appliedItem = next.find(item => item.id === id);
      if (appliedItem) {
        wallpaperRepository.upsert(appliedItem).catch(() => undefined);
      }
      return next;
    });
  }, []);

  const handlePickerOpened = React.useCallback((id: string) => {
    setPendingApplyId(id);
  }, []);

  const handleWallpaperUpdated = React.useCallback((updated: Wallpaper) => {
    const previous = wallpapersRef.current.find(item => item.id === updated.id);
    const oldMedia = previous ? (previous.kind === 'video' ? previous.videoUri : previous.imageUri) : undefined;
    const newMedia = updated.kind === 'video' ? updated.videoUri : updated.imageUri;
    if (oldMedia && oldMedia !== newMedia) ownedMediaUrisRef.current.delete(oldMedia);
    if (newMedia) ownedMediaUrisRef.current.set(newMedia, updated.id);
    wallpaperRepository.upsert(updated).catch(() => undefined);
    setSelectedWallpaper(updated);
    // Re-reference the updated wallpaper so its video/thumbnail survive quota
    // pruning while any orphaned older copies get cleaned.
    const next = wallpapersRef.current.map(item => (item.id === updated.id ? updated : item));
    setWallpapers(next);
    enforceStorageQuota(next).catch(() => undefined);
  }, []);

  const handleWallpaperDeleted = React.useCallback((deleted: Wallpaper) => {
    // Remove copied media + its poster from app-private storage first so
    // orphaned video files do not accumulate, then drop the row from the
    // SQLite library and deregister the video digest.
    const mediaUri = deleted.videoUri ?? deleted.imageUri;
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
      // Unreferenced files (incl. the deleted poster) become scrape-able on
      // the next import, so re-create quota headroom immediately.
      enforceStorageQuota(wallpapersRef.current).catch(() => undefined);
    }
    wallpaperRepository.delete(deleted.id);
    setWallpapers(current => current.filter(item => item.id !== deleted.id));
    setSelectedWallpaper(null);
    showToast(`Deleted "${deleted.title}"`);
  }, []);

  const openDetail = React.useCallback((w: Wallpaper) => setSelectedWallpaper(w), []);
  const closeDetail = React.useCallback(() => setSelectedWallpaper(null), []);

  const renderRow = React.useCallback(
    ({ item }: { item: GridRow }) => {
      if (item.$rowType === 'billboard') {
        const billboardItems = (
          section === 'live'
            ? liveItems
            : section === 'dynamic'
              ? dynamicItems
              : staticItems
        ).slice(0, BILLBOARD_MAX);
        return (
          <Billboard
            wallpapers={billboardItems}
            onSelect={openDetail}
            scrollY={scrollY}
            viewportHeight={viewportHeight}
            active={selectedWallpaper === null && isForeground}
          />
        );
      }
      if (item.$rowType === 'header') {
        return (
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>{item.title}</Text>
            <Text style={styles.sectionCount}>{item.count}</Text>
          </View>
        );
      }
      return (
        <View style={styles.gridRow}>
          {item.cards.map(card => (
            <WallpaperCard key={card.id} wallpaper={card} onSelect={openDetail} />
          ))}
        </View>
      );
    },
    [section, liveItems, dynamicItems, staticItems, scrollY, viewportHeight, selectedWallpaper, isForeground, styles, openDetail],
  );

  return (
    <ErrorBoundary>
      <StatusBar barStyle={isDarkTheme ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.wrapper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create wallpaper"
            style={styles.createFab}
            onPress={openCreator}>
            <Text style={styles.createFabText}>Create</Text>
          </Pressable>

          <FlatList
            data={rows}
            renderItem={renderRow}
            keyExtractor={row => row.key}
            style={styles.scroll}
            contentContainerStyle={styles.content}
            scrollEventThrottle={16}
            onScroll={handleScroll}
            onLayout={event => setViewportHeight(event.nativeEvent.layout.height)}
            initialNumToRender={4}
            maxToRenderPerBatch={5}
            windowSize={7}
            updateCellsBatchingPeriod={50}
            removeClippedSubviews
            ListHeaderComponent={
              <View style={styles.header}>
                <View style={styles.brandRow}>
                  <Text testID="app-title" style={styles.title}>
                    LiveWallpaper Studio
                  </Text>
                </View>
                <SectionTabs
                  section={section}
                  onChange={setSection}
                  liveCount={liveItems.length}
                  dynamicCount={dynamicItems.length}
                  staticCount={staticItems.length}
                />
                <TextInput
                  accessibilityLabel="Search wallpapers"
                  placeholder="Search wallpapers..."
                  placeholderTextColor={palette.placeholder}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  style={styles.searchInput}
                />
                <View style={styles.sortRow}>
                  {(
                    [
                      { key: 'newest', label: 'Newest' },
                      { key: 'name', label: 'A–Z' },
                    ] as const
                  ).map(option => (
                    <Pressable
                      key={option.key}
                      accessibilityRole="button"
                      accessibilityLabel={`Sort by ${option.label}`}
                      accessibilityState={{ selected: sortMode === option.key }}
                      onPress={() => setSortMode(option.key)}
                      style={[styles.sortButton, sortMode === option.key && styles.sortButtonActive]}>
                      <Text
                        style={[
                          styles.sortButtonText,
                          sortMode === option.key && styles.sortButtonTextActive,
                        ]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {livePickerUnavailable && section === 'live' && (
                  <View accessibilityRole="alert" style={styles.unsupportedBanner}>
                    <Text style={styles.unsupportedBannerTitle}>
                      Live wallpapers unavailable on this device
                    </Text>
                    <Text style={styles.unsupportedBannerText}>
                      {capabilities?.setWallpaperAllowed
                        ? 'This device has no live wallpaper picker. Static wallpapers still work — switch to the Static tab to apply them.'
                        : 'Wallpaper changes are disabled by your device or company policy.'}
                    </Text>
                  </View>
                )}
              </View>
            }
          />
        </View>
      </SafeAreaView>

      <CreateWallpaperModal
        visible={isCreating}
        onClose={() => setIsCreating(false)}
        onCreated={handleWallpaperCreated}
      />

      <WallpaperDetailModal
        wallpaper={selectedWallpaper}
        onClose={closeDetail}
        onApplied={handleApplied}
        onWallpaperUpdated={handleWallpaperUpdated}
        onPickerOpened={handlePickerOpened}
        onDelete={handleWallpaperDeleted}
        livePickerAvailable={capabilities?.liveWallpaperPickerAvailable ?? true}
      />
    </ErrorBoundary>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

export default App;
