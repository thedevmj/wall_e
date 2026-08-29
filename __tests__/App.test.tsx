/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('react-native-video', () => {
  const mockReact = require('react');
  const { View } = require('react-native');
  const Video = mockReact.forwardRef(
    (props: Record<string, unknown>, ref: unknown) =>
      mockReact.createElement(View, { ...props, ref }),
  );
  Video.displayName = 'Video';
  return {
    __esModule: true,
    default: Video,
    ViewType: { TEXTURE: 0, SCHEDULE: 1, SURFACE: 2 },
  };
});

test('renders wallpaper studio home screen', async () => {
  jest.useFakeTimers();
  let component: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(async () => {
    component = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });

  const textNodes = component!.root.findAllByType(require('react-native').Text);
  console.log(
    textNodes.map(node => {
      const text = Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children ?? '');
      return text;
    }),
  );
  const hasTitle = textNodes.some(node => {
    const text = Array.isArray(node.props.children)
      ? node.props.children.join('')
      : String(node.props.children ?? '');
    return text.includes('LiveWallpaper Studio');
  });

  const hasLiveSection = textNodes.some(node => {
    const text = Array.isArray(node.props.children)
      ? node.props.children.join('')
      : String(node.props.children ?? '');
    return text.includes('Live wallpapers');
  });

  expect(hasTitle).toBe(true);
  expect(hasLiveSection).toBe(true);
  expect(textNodes.length).toBeGreaterThan(10);

  await ReactTestRenderer.act(async () => {
    component!.unmount();
  });
  jest.useRealTimers();
});
