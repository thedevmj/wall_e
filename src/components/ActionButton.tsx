import React from 'react';
import { Pressable, Text, ViewStyle } from 'react-native';
import { useThemedStyles } from '../theme/ThemeContext';

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary' | 'danger';
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
  const styles = useThemedStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`action-button-${label.toLowerCase().replace(/\s+/g, '-')}`}
      onPress={onPress}
      disabled={disabled}
      style={({pressed}) => [
        styles.abButton,
        tone === 'primary'
          ? styles.abPrimary
          : tone === 'danger'
            ? styles.abDanger
            : styles.abSecondary,
        pressed && !disabled && styles.abPressed,
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      <Text style={[styles.abButtonText, tone === 'secondary' && styles.abSecondaryText]}>{label}</Text>
    </Pressable>
  );
}

