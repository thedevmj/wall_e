import React from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions, PanResponder } from 'react-native';
import type { Wallpaper } from '../types';
import { WallpaperThumb } from './WallpaperThumb';
import { COLORS, SPACING, RADIUS } from './theme';
import { DestinationSheet, type ApplyDestination } from './DestinationSheet';

const SCREEN_W = Dimensions.get('window').width;
const PREVIEW_W = SCREEN_W * 0.72;

export type PlaybackOptions = {
  loop: boolean;
  audio: boolean;
  playbackDuration?: number;
};

type Props = {
  wallpaper: Wallpaper;
  onBack: () => void;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  onApply: (destination: ApplyDestination, opts?: PlaybackOptions) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  canDelete: boolean;
};

type Segment = { key: string; label: string };

function Segmented({
  options,
  value,
  onChange,
}: {
  options: Segment[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map(option => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={[styles.segmentBtn, active && styles.segmentBtnActive]}
            accessibilityRole="button">
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function DurationSlider({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (seconds: number) => void;
}) {
  const [trackWidth, setTrackWidth] = React.useState(0);
  const stateRef = React.useRef({ trackWidth, min, max, onChange });
  React.useEffect(() => {
    stateRef.current = { trackWidth, min, max, onChange };
  }, [trackWidth, min, max, onChange]);

  const panResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: event => apply(event),
      onPanResponderMove: event => apply(event),
      onPanResponderRelease: () => {},
    }),
  ).current;

  function apply(event: { nativeEvent: { locationX: number } }) {
    const state = stateRef.current;
    if (state.trackWidth <= 0) return;
    const ratio = clamp(event.nativeEvent.locationX / state.trackWidth, 0, 1);
    const seconds = Math.round(state.min + ratio * (state.max - state.min));
    state.onChange(clamp(seconds, state.min, state.max));
  }

  const ratio = max > min ? (value - min) / (max - min) : 0;
  const fillStyle = { width: `${ratio * 100}%` };
  const thumbStyle = { left: `${ratio * 100}%` };

  return (
    <View
      style={styles.durationSlider}
      onLayout={e => setTrackWidth(e.nativeEvent.layout.width)}
      {...panResponder.panHandlers}>
      <View style={styles.durationTrack} />
      <View style={[styles.durationFill, fillStyle]} />
      <View style={[styles.durationThumb, thumbStyle]} />
    </View>
  );
}

export function PreviewScreen({
  wallpaper,
  onBack,
  isFavorite,
  onToggleFavorite,
  onApply,
  onDelete,
  canDelete,
}: Props) {
  const [sheetVisible, setSheetVisible] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [loop, setLoop] = React.useState(wallpaper.loop ?? true);
  const [audio, setAudio] = React.useState(wallpaper.audio ?? false);

  const isVideo = wallpaper.kind === 'video';
  const canTrimDuration = isVideo && canDelete;

  // The source clip length (from the import) determines the slider ceiling; the
  // wallpaper engine itself caps the window at 30s.
  const sourceSeconds = React.useMemo(() => {
    const match = /(\d+)/.exec(wallpaper.duration);
    const parsed = match ? Number(match[1]) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return wallpaper.playbackDuration ?? 30;
  }, [wallpaper.duration, wallpaper.playbackDuration]);
  const durationMax = Math.floor(Math.min(30, sourceSeconds));

  const [durationSec, setDurationSec] = React.useState(() =>
    clamp(wallpaper.playbackDuration ?? durationMax, 3, durationMax),
  );

  React.useEffect(() => {
    setLoop(wallpaper.loop ?? true);
    setAudio(wallpaper.audio ?? false);
    setDurationSec(clamp(wallpaper.playbackDuration ?? durationMax, 3, durationMax));
  }, [wallpaper.id, wallpaper.loop, wallpaper.audio, wallpaper.playbackDuration, durationMax]);

  const handleApplyPress = React.useCallback(() => {
    setError(null);
    setSheetVisible(true);
  }, []);

  const handleApply = React.useCallback(
    async (dest: ApplyDestination) => {
      setApplying(true);
      setError(null);
      const ok = await onApply(dest, {
        loop,
        audio,
        playbackDuration: canTrimDuration ? durationSec : undefined,
      });
      setApplying(false);
      if (ok) {
        setSheetVisible(false);
      }
    },
    [onApply, loop, audio, canTrimDuration, durationSec],
  );

  const handleDelete = React.useCallback(async () => {
    setApplying(true);
    const ok = await onDelete();
    setApplying(false);
    if (ok) {
      setSheetVisible(false);
    }
  }, [onDelete]);

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Text style={styles.backIcon}>{'\u2039'}</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Wallpapers
        </Text>
        <Pressable
          onPress={() => onToggleFavorite(wallpaper.id)}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
          <Text style={[styles.favIcon, isFavorite && styles.favIconActive]}>
            {isFavorite ? '\u2665' : '\u2661'}
          </Text>
        </Pressable>
      </View>

      {/* Preview */}
      <View style={styles.previewWrap}>
        <View style={styles.preview}>
          <WallpaperThumb wallpaper={wallpaper} style={styles.cover} />
          {/* Lock screen overlay */}
          <View style={styles.lockOverlay}>
            <View style={styles.lockIconRow}>
              <View style={styles.lockIcon} />
            </View>
            <Text style={styles.time}>8:24</Text>
            <Text style={styles.date}>Wednesday, 9 September</Text>
          </View>
          <View style={styles.kindRow}>
            <Text style={styles.kindText}>{wallpaper.kind.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      {/* Playback options */}
      {isVideo && (
        <View style={styles.playback}>
          <View style={styles.playbackRow}>
            <Text style={styles.playbackLabel}>Play</Text>
            <Segmented
              options={[
                { key: 'once', label: 'Once' },
                { key: 'loop', label: 'Continuous' },
              ]}
              value={loop ? 'loop' : 'once'}
              onChange={key => setLoop(key === 'loop')}
            />
          </View>
          <View style={styles.playbackRow}>
            <Text style={styles.playbackLabel}>Audio</Text>
            <Segmented
              options={[
                { key: 'off', label: 'Off' },
                { key: 'on', label: 'On' },
              ]}
              value={audio ? 'on' : 'off'}
              onChange={key => setAudio(key === 'on')}
            />
          </View>
          {canTrimDuration && durationMax >= 3 && (
            <View style={styles.playbackRow}>
              <Text style={styles.playbackLabel}>Duration</Text>
              <View style={styles.durationControl}>
                <DurationSlider
                  min={3}
                  max={durationMax}
                  value={durationSec}
                  onChange={setDurationSec}
                />
                <Text style={styles.durationValue}>{durationSec}s</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Apply */}
      <View style={styles.footer}>
        <Pressable
          onPress={handleApplyPress}
          style={({ pressed }) => [styles.applyBtn, pressed && styles.applyBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Apply wallpaper">
          <Text style={styles.applyText}>Apply</Text>
        </Pressable>
        <Text style={styles.duration}>{wallpaper.duration}</Text>
      </View>

      <DestinationSheet
        visible={sheetVisible}
        title={`Apply "${wallpaper.title}" to`}
        applying={applying}
        error={error}
        canDelete={canDelete}
        onApply={handleApply}
        onDelete={handleDelete}
        onCancel={() => setSheetVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xxl,
    paddingBottom: SPACING.md,
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 3,
  },
  backIcon: {
    color: COLORS.white,
    fontSize: 34,
    lineHeight: 36,
    marginLeft: -2,
  },
  headerTitle: {
    color: COLORS.white,
    fontSize: 28,
    fontWeight: '700',
    flexShrink: 1,
    paddingHorizontal: SPACING.sm,
  },
  favIcon: {
    color: COLORS.white,
    fontSize: 24,
  },
  favIconActive: {
    color: COLORS.cyan,
  },
  previewWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  preview: {
    width: PREVIEW_W,
    height: PREVIEW_W * 2.0,
    maxHeight: '88%',
    borderRadius: 44,
    borderWidth: 1,
    borderColor: COLORS.translucentBorder,
    overflow: 'hidden',
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: '20%',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  lockIconRow: {
    alignItems: 'center',
    marginBottom: 16,
  },
  lockIcon: {
    width: 28,
    height: 24,
    borderRadius: 5,
    borderWidth: 2.5,
    borderColor: COLORS.white,
  },
  time: {
    color: COLORS.white,
    fontSize: 68,
    fontWeight: '300',
    letterSpacing: 1,
  },
  date: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 19,
    fontWeight: '400',
    marginTop: 8,
  },
  kindRow: {
    position: 'absolute',
    bottom: SPACING.md,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  kindText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 100,
    overflow: 'hidden',
  },
  playback: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  playbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  playbackLabel: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: '600',
    width: 64,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  segmentBtnActive: {
    backgroundColor: 'rgba(0, 191, 255, 0.16)',
  },
  segmentText: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: COLORS.cyan,
  },
  durationControl: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  durationSlider: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  durationTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.cardLight,
  },
  durationFill: {
    position: 'absolute',
    left: 0,
    top: 11,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.cyan,
  },
  durationThumb: {
    position: 'absolute',
    top: '50%',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.cyan,
    marginTop: -8,
    marginLeft: -8,
    shadowColor: COLORS.cyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  durationValue: {
    color: COLORS.cyan,
    fontSize: 15,
    fontWeight: '700',
    width: 44,
    textAlign: 'right',
    marginLeft: SPACING.sm,
  },
  footer: {
    paddingHorizontal: 40,
    paddingBottom: 40,
    paddingTop: SPACING.lg,
    alignItems: 'center',
  },
  applyBtn: {
    width: '100%',
    height: 70,
    borderRadius: 100,
    backgroundColor: 'rgba(30, 26, 20, 0.94)',
    borderWidth: 1,
    borderColor: COLORS.orangeLight,
    shadowColor: COLORS.orange,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  applyText: {
    color: COLORS.cream,
    fontSize: 24,
    fontWeight: '700',
  },
  duration: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: SPACING.md,
  },
});