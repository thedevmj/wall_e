/**
 * Live Wallpaper Studio
 * Android-only wallpaper editor and library shell.
 */

import React from 'react';
import {
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
import Video from 'react-native-video';

function App() {
  const [capabilities, setCapabilities] = React.useState({
    supportsLiveWallpaper: false,
    minSdk: 24,
    targetSdk: 36,
    features: ['Doodle renderer', 'Video preview', 'Wallpaper picker'],
  });
  const [wallpapers, setWallpapers] = React.useState(mockWallpapers);
  const [selectedWallpaper, setSelectedWallpaper] = React.useState<Wallpaper | null>(null);
  const [editorKind, setEditorKind] = React.useState<'doodle' | 'video'>('doodle');
  const [title, setTitle] = React.useState('');
  const [filter, setFilter] = React.useState<'all' | 'doodle' | 'video'>('all');
  const [isCreating, setIsCreating] = React.useState(false);
  const [isApplying, setIsApplying] = React.useState(false);
  const [videoUri, setVideoUri] = React.useState<string | null>(null);
  const [loopVideo, setLoopVideo] = React.useState(true);
  const [videoAudio, setVideoAudio] = React.useState(false);
  const [playbackDuration, setPlaybackDuration] = React.useState(30);
  const [sliderWidth, setSliderWidth] = React.useState(0);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const updateDuration = React.useCallback((position: number) => {
    if (!sliderWidth) return;
    const ratio = Math.max(0, Math.min(1, position / sliderWidth));
    setPlaybackDuration(Math.max(1, Math.min(30, Math.round(1 + ratio * 29))));
  }, [sliderWidth]);
  const durationPanResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => updateDuration(event.nativeEvent.locationX),
    onPanResponderMove: event => updateDuration(event.nativeEvent.locationX),
  }), [updateDuration]);

  React.useEffect(() => {
    wallpaperBridge.getCapabilities().then(setCapabilities).catch(() => undefined);
  }, []);

  return (
    <>
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
              <Text style={styles.metricValue}>{capabilities.supportsLiveWallpaper ? 'ON' : 'OFF'}</Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <ActionButton label="Create Doodle" onPress={() => openCreator('doodle')} />
            <ActionButton label="Video Wallpaper" onPress={() => openCreator('video')} tone="secondary" />
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Wallpapers</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Open library" onPress={() => setFilter('all')}>
              <Text style={styles.sectionLink}>Open library</Text>
            </Pressable>
          </View>

          <View style={styles.filterRow}>
            {(['all', 'doodle', 'video'] as const).map(option => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{selected: filter === option}}
                onPress={() => setFilter(option)}
                style={[styles.filter, filter === option && styles.filterSelected]}
              >
                <Text style={[styles.filterText, filter === option && styles.filterTextSelected]}>
                  {option === 'all' ? 'All' : option === 'doodle' ? 'Doodles' : 'Videos'}
                </Text>
              </Pressable>
            ))}
          </View>

          {wallpapers.filter(wallpaper => filter === 'all' || wallpaper.kind === filter).map((wallpaper, index) => (
            <WallpaperCard key={wallpaper.id} wallpaper={wallpaper} index={index} onPress={() => setSelectedWallpaper(wallpaper)} onDelete={wallpaper.kind === 'video' ? deleteWallpaper : undefined} />
          ))}

          <View style={styles.footerPanel}>
            <Text style={styles.footerTitle}>Android runtime</Text>
            <Text style={styles.footerText}>
              Wallpaper rendering is handled by the native Android service layer, while React Native remains the editor and configuration UI.
            </Text>
            <Text style={styles.footerMeta}>
              {capabilities.features.join(' • ')}
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
      <Modal visible={isCreating || selectedWallpaper !== null} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalPanel}>
            {isCreating ? (
              <>
                <Text style={styles.modalTitle}>Create wallpaper</Text>
                <Text style={styles.modalSubtitle}>Give your next loop a name and choose its renderer.</Text>
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
                    <ActionButton label={videoUri ? 'Video selected' : 'Choose video from device'} onPress={chooseVideo} tone="secondary" />
                    <Text style={styles.durationLabel}>Playback duration: {playbackDuration} seconds</Text>
                    <View
                      accessibilityRole="adjustable"
                      accessibilityLabel="Playback duration"
                      onLayout={event => setSliderWidth(event.nativeEvent.layout.width)}
                      {...durationPanResponder.panHandlers}
                      style={styles.sliderTrack}
                    >
                      <View style={[styles.sliderFill, {width: sliderWidth ? `${((playbackDuration - 1) / 29) * 100}%` : '0%'}]} />
                      <View style={[styles.sliderThumb, {left: sliderWidth ? ((playbackDuration - 1) / 29) * (sliderWidth - 22) : 0}]} />
                    </View>
                    <Pressable accessibilityRole="checkbox" accessibilityState={{checked: loopVideo}} onPress={() => setLoopVideo(value => !value)} style={styles.loopRow}>
                      <View style={[styles.checkbox, loopVideo && styles.checkboxChecked]} />
                      <Text style={styles.loopText}>Play continuously</Text>
                    </Pressable>
                    <Pressable accessibilityRole="checkbox" accessibilityState={{checked: videoAudio}} onPress={() => setVideoAudio(value => !value)} style={styles.loopRow}>
                      <View style={[styles.checkbox, videoAudio && styles.checkboxChecked]} />
                      <Text style={styles.loopText}>Include audio</Text>
                    </Pressable>
                  </>
                )}
                <View style={styles.kindRow}>
                  {(['doodle', 'video'] as const).map(kind => (
                    <Pressable key={kind} onPress={() => setEditorKind(kind)} style={[styles.kindButton, editorKind === kind && styles.kindButtonSelected]}>
                      <Text style={styles.kindButtonText}>{kind === 'doodle' ? 'Doodle' : 'Video'}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.modalActions}>
                  <ActionButton label="Cancel" tone="secondary" onPress={closeModal} style={styles.modalButton} />
                  <ActionButton label="Create" onPress={createWallpaper} style={styles.modalButton} />
                </View>
              </>
            ) : selectedWallpaper ? (
              <>
                {selectedWallpaper.kind === 'video' && selectedWallpaper.videoUri ? (
                  <Video
                    key={selectedWallpaper.videoUri}
                    source={{uri: selectedWallpaper.videoUri}}
                    style={styles.videoPreview}
                    resizeMode="cover"
                    repeat={selectedWallpaper.loop !== false}
                    paused={false}
                    muted={!selectedWallpaper.audio}
                    controls
                    playInBackground={false}
                    playWhenInactive={false}
                    onLoadStart={() => setErrorMessage(null)}
                    onLoad={() => setErrorMessage(null)}
                    onError={() => setErrorMessage('This video cannot be previewed on the device. Try selecting an MP4 or H.264 video.')}
                  />
                ) : (
                  <AnimatedPreview accent={selectedWallpaper.accent} />
                )}
                <Text style={styles.modalTitle}>{selectedWallpaper.title}</Text>
                <Text style={styles.modalSubtitle}>{selectedWallpaper.description}</Text>
                {selectedWallpaper.kind === 'video' && (
                  <>
                    <Text style={styles.durationLabel}>Plays for {selectedWallpaper.playbackDuration ?? 30} seconds{selectedWallpaper.loop === false ? ' once' : ' on repeat'}{selectedWallpaper.audio ? ' with audio' : ' muted'}</Text>
                    {!selectedWallpaper.videoUri && <ActionButton label="Choose video from device" onPress={chooseVideoForSelected} tone="secondary" />}
                  </>
                )}
                <Text style={styles.previewOnlyLabel}>Preview only. Choose a destination below to apply.</Text>
                <Text style={styles.destinationLabel}>Apply to</Text>
                <View style={styles.kindRow}>
                  {(['HOME', 'LOCK', 'BOTH'] as const).map(destination => (
                    <Pressable key={destination} onPress={() => applySelected(destination)} style={styles.kindButton}>
                      <Text style={styles.kindButtonText}>{destination}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.modalActions}>
                  <ActionButton label="Close" tone="secondary" onPress={closeModal} style={styles.modalButton} />
                  <ActionButton label={isApplying ? 'Opening...' : 'Wallpaper picker'} onPress={openPicker} style={styles.modalButton} />
                </View>
                {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );

  function openCreator(kind: 'doodle' | 'video') {
    setEditorKind(kind);
    setTitle('');
    setVideoUri(null);
    setLoopVideo(true);
    setVideoAudio(false);
    setPlaybackDuration(30);
    setErrorMessage(null);
    setIsCreating(true);
  }

  async function chooseVideo() {
    setErrorMessage(null);
    try {
      const pickedVideo = await wallpaperBridge.pickVideo();
      if (pickedVideo) {
        setVideoUri(pickedVideo.uri);
        setPlaybackDuration(Math.min(30, Math.max(1, Math.round(pickedVideo.durationSeconds))));
      } else setErrorMessage('No video was selected. Please try again.');
    } catch (_error) {
      setErrorMessage('The selected video could not be read. Please choose another video.');
    }
  }

  function closeModal() {
    setIsCreating(false);
    setSelectedWallpaper(null);
  }

  function createWallpaper() {
    if (editorKind === 'video' && !videoUri) {
      setErrorMessage('Choose a video before creating this wallpaper.');
      return;
    }
    const name = title.trim() || `${editorKind === 'doodle' ? 'Untitled Doodle' : 'Untitled Video'}`;
    const newWallpaper = {
      id: `${editorKind}-${Date.now()}`,
      title: name,
      kind: editorKind,
      description: editorKind === 'doodle' ? 'A custom animated doodle loop.' : 'A custom muted video wallpaper loop.',
      accent: editorKind === 'doodle' ? '#22D3EE' : '#FB7185',
      status: 'Needs preview' as const,
      duration: editorKind === 'doodle' ? '15 sec' : `${playbackDuration} sec`,
      createdAt: 'Just now',
      videoUri: editorKind === 'video' ? videoUri ?? undefined : undefined,
      loop: editorKind === 'video' ? loopVideo : undefined,
      audio: editorKind === 'video' ? videoAudio : undefined,
      playbackDuration: editorKind === 'video' ? playbackDuration : undefined,
    };
    setWallpapers(current => [newWallpaper, ...current]);
    setSelectedWallpaper(newWallpaper);
    setIsCreating(false);
  }

  async function applySelected(destination: 'HOME' | 'LOCK' | 'BOTH') {
    if (!selectedWallpaper) return;
    if (selectedWallpaper.kind === 'video' && !selectedWallpaper.videoUri) {
      setErrorMessage('Choose a video before applying this wallpaper.');
      return;
    }
    setIsApplying(true);
    const result = await wallpaperBridge.applyWallpaper(selectedWallpaper.id, selectedWallpaper.kind, destination, selectedWallpaper.videoUri, selectedWallpaper.loop ?? true, selectedWallpaper.playbackDuration ?? 30, selectedWallpaper.audio ?? false);
    setIsApplying(false);
    if (result.ok) {
      setWallpapers(current => current.map(item => ({...item, status: item.id === selectedWallpaper.id ? 'Applied' : item.status})));
      closeModal();
    } else {
      setErrorMessage(result.error ?? 'Android could not open the live wallpaper picker.');
    }
  }

  async function openPicker() {
    setIsApplying(true);
    if (!selectedWallpaper) {
      setIsApplying(false);
      return;
    }
    if (selectedWallpaper.kind === 'video' && !selectedWallpaper.videoUri) {
      setErrorMessage('Choose a video before opening the live wallpaper preview.');
      setIsApplying(false);
      return;
    }
    const opened = await wallpaperBridge.openWallpaperPicker(
      selectedWallpaper.id,
      selectedWallpaper.kind,
      selectedWallpaper.videoUri,
      selectedWallpaper.loop ?? true,
      selectedWallpaper.playbackDuration ?? 30,
      selectedWallpaper.accent,
      selectedWallpaper.audio ?? false,
    );
    setIsApplying(false);
    if (!opened) {
      setErrorMessage('This device does not provide a live wallpaper picker.');
    }
  }

  async function chooseVideoForSelected() {
    setErrorMessage(null);
    try {
      const pickedVideo = await wallpaperBridge.pickVideo();
      if (!pickedVideo || !selectedWallpaper) {
        setErrorMessage('No video was selected. Please try again.');
        return;
      }
      const updatedWallpaper = {...selectedWallpaper, videoUri: pickedVideo.uri, playbackDuration: Math.min(30, Math.max(1, Math.round(pickedVideo.durationSeconds)))};
      setSelectedWallpaper(updatedWallpaper);
      setWallpapers(current => current.map(item => item.id === updatedWallpaper.id ? updatedWallpaper : item));
    } catch (_error) {
      setErrorMessage('The selected video could not be read. Please choose another video.');
    }
  }

  function deleteWallpaper(id: string) {
    Alert.alert('Delete wallpaper?', 'This removes the video from this library.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Delete', style: 'destructive', onPress: () => setWallpapers(current => current.filter(item => item.id !== id))},
    ]);
  }

}

function AnimatedPreview({accent}: {accent: string}) {
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(progress, {toValue: 1, duration: 2600, useNativeDriver: true}),
    );
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const drift = progress.interpolate({inputRange: [0, 1], outputRange: [-18, 18]});
  const scale = progress.interpolate({inputRange: [0, 0.5, 1], outputRange: [0.9, 1.12, 0.9]});

  return (
    <View style={[styles.preview, {backgroundColor: accent}]}>
      <Animated.View style={[styles.previewOrb, {transform: [{translateX: drift}, {scale}]}]} />
      <Text style={styles.previewLabel}>DOODLE PREVIEW</Text>
    </View>
  );
}

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
});

export default App;
