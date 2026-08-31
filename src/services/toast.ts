import { ToastAndroid, Platform } from 'react-native';

/**
 * Lightweight non-blocking feedback helper. Uses the native Android toast so
 * the flow stays snappy (no dialog to dismiss). On non-Android platforms it is
 * a no-op.
 */
export function showToast(message: string, duration: 'short' | 'long' = 'short'): void {
  if (Platform.OS !== 'android') return;
  try {
    ToastAndroid.show(message, duration === 'long' ? ToastAndroid.LONG : ToastAndroid.SHORT);
    // Toasts are best-effort; failures should never interrupt the flow.
  } catch {
  }
}

export function showToastWithGravity(
  message: string,
  duration: 'short' | 'long' = 'short',
): void {
  if (Platform.OS !== 'android') return;
  try {
    ToastAndroid.showWithGravity(
      message,
      duration === 'long' ? ToastAndroid.LONG : ToastAndroid.SHORT,
      ToastAndroid.BOTTOM,
    );
  } catch {
  }
}
