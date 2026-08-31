import React from 'react';
import { Pressable, Text, ViewStyle } from 'react-native';
import { styles } from '../styles';

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary';
  style?: ViewStyle;
  disabled?: boolean;
};

export function ActionButton({
  label,
  onPress,
  tone = 'primary',
  style,
  disabled = false,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`action-button-${label.toLowerCase().replace(/\s+/g, '-')}`}
      onPress={onPress}
      disabled={disabled}
      style={({pressed}) => [
        styles.abButton,
        tone === 'primary' ? styles.abPrimary : styles.abSecondary,
        pressed && !disabled && styles.abPressed,
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      <Text style={[styles.abButtonText, tone === 'secondary' && styles.abSecondaryText]}>{label}</Text>
    </Pressable>
  );
}

