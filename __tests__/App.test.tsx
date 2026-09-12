/**
 * @format
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

// react-native-safe-area-context yields no native insets in the test env, so
// its provider/view render their children as a plain View instead of null.
jest.mock('react-native-safe-area-context', () => {
  const actualReact = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const FakeSafeArea = ({
    children,
    ...props
  }: PropsWithChildren<Record<string, unknown>>) => {
    return actualReact.createElement(View, props, children);
  };
  return {
    SafeAreaProvider: FakeSafeArea,
    SafeAreaView: FakeSafeArea,
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
  };
});

import App from '../App';

test('renders wallpaper studio home screen with live and static categories', async () => {
  await render(<App />);

  expect(screen.getByText('Live Wallpaper')).toBeTruthy();
  expect(screen.getByText('All')).toBeTruthy();
  expect(screen.getByText('Live')).toBeTruthy();
  expect(screen.getByText('Static')).toBeTruthy();
  expect(screen.getByPlaceholderText('Search wallpapers...')).toBeTruthy();

  await expect(screen.findByText(/All \(\d+\)/)).resolves.toBeTruthy();
});