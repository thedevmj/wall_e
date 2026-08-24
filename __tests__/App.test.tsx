/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders wallpaper studio home screen', async () => {
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
    return text.includes('Live Wallpaper Studio');
  });

  expect(hasTitle).toBe(true);
  expect(textNodes.length).toBeGreaterThan(10);
});
