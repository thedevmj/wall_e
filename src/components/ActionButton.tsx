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
    backgroundColor: '#7C3AED',
  },
  secondary: {
    backgroundColor: '#1F2937',
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
