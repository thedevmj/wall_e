import React from 'react';
import { Modal, View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { wallpaperBridge } from '../services/wallpaperBridge';
import { wallpaperRepository } from '../services/wallpaperRepository';
import type { PickedImage, PickedVideo, Wallpaper } from '../types';
import { COLORS, SPACING, RADIUS } from './theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (w: Wallpaper) => void;
};

type PickedState = { kind: 'video' | 'static'; picked: PickedVideo | PickedImage } | null;

function titleFromUri(uri: string, fallback: string): string {
  const cleaned = uri.split('/').pop() ?? '';
  const noExt = cleaned.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  return noExt.length > 2 ? noExt : fallback;
}

export function CreateWallpaperModal({ visible, onClose, onCreated }: Props) {
  const [busy, setBusy] = React.useState(false);
  const [picked, setPicked] = React.useState<PickedState>(null);
  const [title, setTitle] = React.useState('');

  const reset = React.useCallback(() => {
    setBusy(false);
    setPicked(null);
    setTitle('');
  }, []);

  const close = React.useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const pick = React.useCallback(async (kind: 'video' | 'static') => {
    setBusy(true);
    try {
      if (kind === 'video') {
        const video = await wallpaperBridge.pickVideo();
        if (!video) return;
        setTitle(titleFromUri(video.uri, 'Live Wallpaper'));
        setPicked({ kind: 'video', picked: video });
      } else {
        const image = await wallpaperBridge.pickImage();
        if (!image) return;
        setTitle(titleFromUri(image.uri, 'Wallpaper'));
        setPicked({ kind: 'static', picked: image });
      }
    } catch (error) {
      console.warn('Pick failed', error);
    } finally {
      setBusy(false);
    }
  }, []);

  const create = React.useCallback(async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const name = title.trim();
      const finalTitle = name || (picked.kind === 'video' ? 'Live Wallpaper' : 'Wallpaper');
      if (picked.kind === 'video') {
        const video = picked.picked as PickedVideo;
        const resolved = await wallpaperRepository.videoFiles.resolvePickedVideo(video);
        const now = Date.now();
        const wallpaper: Wallpaper = {
          id: `user-${now}`,
          title: finalTitle,
          kind: 'video',
          description: 'User-imported live wallpaper.',
          accent: '#00BFFF',
          status: 'Ready',
          duration: `${Math.round(video.durationSeconds)} sec`,
          createdAt: new Date(now).toISOString(),
          videoUri: resolved.uri,
          poster: resolved.posterUri ? { uri: resolved.posterUri } : undefined,
          loop: true,
          audio: false,
          playbackDuration: Math.min(60, video.durationSeconds),
          rotation: 0,
        };
        reset();
        onCreated(wallpaper);
      } else {
        const image = picked.picked as PickedImage;
        const now = Date.now();
        const wallpaper: Wallpaper = {
          id: `user-${now}`,
          title: finalTitle,
          kind: 'static',
          description: 'User-imported wallpaper image.',
          accent: '#7C3AED',
          status: 'Ready',
          duration: 'Still',
          createdAt: new Date(now).toISOString(),
          imageUri: image.uri,
        };
        reset();
        onCreated(wallpaper);
      }
    } catch (error) {
      console.warn('Create failed', error);
    } finally {
      setBusy(false);
    }
  }, [picked, title, onCreated, reset]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={busy ? undefined : close} />
        <View style={styles.sheet}>
          <Text style={styles.title}>Add wallpaper</Text>
          <Text style={styles.subtitle}>Import a live video or a static image from your gallery.</Text>

          {picked == null ? (
            <View style={styles.options}>
              <Pressable
                onPress={() => pick('video')}
                disabled={busy}
                style={[styles.option, busy && styles.optionDisabled]}>
                {busy ? (
                  <ActivityIndicator color={COLORS.cyan} />
                ) : (
                  <Text style={styles.optionIcon}>{'\u25B6'}</Text>
                )}
                <Text style={styles.optionLabel}>Live video</Text>
                <Text style={styles.optionHint}>Import an MP4 for the live wallpaper</Text>
              </Pressable>
              <Pressable
                onPress={() => pick('static')}
                disabled={busy}
                style={[styles.option, busy && styles.optionDisabled]}>
                {busy ? (
                  <ActivityIndicator color={COLORS.cyan} />
                ) : (
                  <Text style={styles.optionIcon}>{'\u25A6'}</Text>
                )}
                <Text style={styles.optionLabel}>Static image</Text>
                <Text style={styles.optionHint}>Import a photo or artwork</Text>
              </Pressable>
            </View>
          ) : (
            <View>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Wallpaper name"
                placeholderTextColor={COLORS.textSecondary}
                style={styles.input}
                autoFocus
                accessible
              />
              <Pressable
                onPress={create}
                disabled={busy}
                style={[styles.createBtn, busy && styles.optionDisabled]}>
                {busy ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.createText}>Add to library</Text>
                )}
              </Pressable>
            </View>
          )}

          <Pressable onPress={close} style={styles.cancelBtn} disabled={busy}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: '#141418',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: 40,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderBottomWidth: 0,
  },
  title: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  options: {
    gap: SPACING.sm,
  },
  option: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 86,
  },
  optionDisabled: {
    opacity: 0.6,
  },
  optionIcon: {
    color: COLORS.cyan,
    fontSize: 22,
  },
  optionLabel: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '600',
    marginTop: SPACING.xs,
  },
  optionHint: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  input: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    color: COLORS.text,
    fontSize: 16,
    marginBottom: SPACING.md,
  },
  createBtn: {
    backgroundColor: COLORS.cyan,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  createText: {
    color: '#04121A',
    fontSize: 17,
    fontWeight: '700',
  },
  cancelBtn: {
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  cancelText: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: '500',
  },
});