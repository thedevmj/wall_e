import React from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary';
  style?: ViewStyle;
};

export function ActionButton({
  label,
  onPress,
  tone = 'primary',
  style,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`action-button-${label.toLowerCase().replace(/\s+/g, '-')}`}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        tone === 'primary' ? styles.primary : styles.secondary,
        pressed && styles.pressed,
        style,
      ]}
    >
      <Text style={[styles.buttonText, tone === 'secondary' && styles.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 160,
  },
  primary: {
    backgroundColor: 'rgba(124, 58, 237, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    shadowColor: '#7C3AED',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  secondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  pressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryText: {
    color: '#E2E8F0',
  },
});
