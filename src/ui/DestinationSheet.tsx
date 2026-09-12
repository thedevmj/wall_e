import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS, SPACING, RADIUS } from './theme';

export type ApplyDestination = 'HOME' | 'LOCK' | 'BOTH';

type Props = {
  visible: boolean;
  title: string;
  applying: boolean;
  error?: string | null;
  canDelete: boolean;
  onApply: (destination: ApplyDestination) => void;
  onDelete: () => void;
  onCancel: () => void;
};

export function DestinationSheet({
  visible,
  title,
  applying,
  error,
  canDelete,
  onApply,
  onDelete,
  onCancel,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={applying ? undefined : onCancel} />
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>

          <Pressable
            onPress={() => onApply('HOME')}
            disabled={applying}
            style={[styles.option, applying && styles.optionDisabled]}>
            <Text style={styles.optionText}>Home screen</Text>
          </Pressable>
          <Pressable
            onPress={() => onApply('LOCK')}
            disabled={applying}
            style={[styles.option, applying && styles.optionDisabled]}>
            <Text style={styles.optionText}>Lock screen</Text>
          </Pressable>
          <Pressable
            onPress={() => onApply('BOTH')}
            disabled={applying}
            style={[styles.option, applying && styles.optionDisabled]}>
            <Text style={styles.optionText}>Both screens</Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {canDelete && (
            <Pressable
              onPress={onDelete}
              disabled={applying}
              style={[styles.option, styles.deleteOption, applying && styles.optionDisabled]}>
              <Text style={styles.deleteText}>Delete wallpaper</Text>
            </Pressable>
          )}

          <Pressable onPress={onCancel} style={styles.cancelBtn} disabled={applying}>
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
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  option: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  optionText: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '600',
  },
  deleteOption: {
    marginTop: SPACING.sm,
    backgroundColor: 'rgba(220, 38, 75, 0.12)',
    borderColor: 'rgba(220, 38, 75, 0.5)',
  },
  deleteText: {
    color: '#FDA4AF',
    fontSize: 17,
    fontWeight: '600',
  },
  error: {
    color: '#FDA4AF',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: SPACING.sm,
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