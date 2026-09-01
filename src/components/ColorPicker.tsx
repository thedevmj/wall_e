import React from 'react';
import { View, PanResponder, LayoutChangeEvent, StyleSheet, Text, Animated } from 'react-native';

type Props = {
  color: string;
  onChange: (hex: string) => void;
};

/* ── colour math ───────────────────────────────────────────────────────── */

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const vv = max;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  return [h, s, vv];
}

function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

/* ── Saturation-Brightness strips (row of <View> bars) ─────────────────── */

const SB_ROWS = 16;
const SB_COLS = 16;

const SatBrightSquare = React.memo(function ({ hue }: { hue: number }) {
  const rows = React.useMemo(() => {
    const result: string[][] = [];
    for (let row = 0; row < SB_ROWS; row++) {
      const bright = 1 - row / (SB_ROWS - 1);
      const cols: string[] = [];
      for (let col = 0; col < SB_COLS; col++) {
        const sat = col / (SB_COLS - 1);
        cols.push(hsvToHex(hue, sat, bright));
      }
      result.push(cols);
    }
    return result;
  }, [hue]);

  return (
    <View style={sbStyles.container}>
      {rows.map((row, ri) => (
        <View key={ri} style={sbStyles.row}>
          {row.map((c, ci) => (
            <View key={ci} style={[sbStyles.cell, { backgroundColor: c }]} />
          ))}
        </View>
      ))}
    </View>
  );
});

const sbStyles = StyleSheet.create({
  container: { borderRadius: 10, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  cell: { flex: 1, aspectRatio: 1 },
});

/* ── Hue bar strips ────────────────────────────────────────────────────── */

const HUE_SEGMENTS = 36;

function HueBar() {
  const segments = React.useMemo(() => {
    return Array.from({ length: HUE_SEGMENTS }, (_, i) => {
      const h = (i / (HUE_SEGMENTS - 1)) * 360;
      return hsvToHex(h, 1, 1);
    });
  }, []);

  return (
    <View style={hueStyles.bar}>
      {segments.map((c, i) => (
        <View key={i} style={[hueStyles.seg, { backgroundColor: c }]} />
      ))}
    </View>
  );
}

const hueStyles = StyleSheet.create({
  bar: { flexDirection: 'row', borderRadius: 9, overflow: 'hidden' },
  seg: { flex: 1, height: 18 },
});

/* ── Component ─────────────────────────────────────────────────────────── */

const THUMB = 22;

export function ColorPicker({ color, onChange }: Props) {
  const [hsv, setHsv] = React.useState<[number, number, number]>(() => hexToHsv(color));
  const [boxW, setBoxW] = React.useState(220);
  const [boxH, setBoxH] = React.useState(220);

  // onChange is the parent's callback; keep it in a ref so the PanResponder
  // closures (created once) always call the latest version without re-creating.
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => { onChangeRef.current = onChange; });

  // Live HSV values mirrored into refs so the PanResponder reads the current
  // value each move (fixes stale-closure drift) without rebuilding handlers.
  const hsvRef = React.useRef(hsv);
  const boxRef = React.useRef({ w: boxW, h: boxH });

  // Starting value captured at grant, so on move we compute absolute position
  // as start + gesture delta. This is self-correcting and immune to RN's
  // locationX-child targeting and to scrolling/origin offsets.
  const sbStartRef = React.useRef({ x: 0, y: 0 });
  const hueStartRef = React.useRef(0);

  // The thumbs are driven by Animated values mapped to native-driver-friendly
  // transforms. Writing setValue() on drag does NOT re-render React, so the
  // slider stays perfectly smooth regardless of how heavy the grid rebuild is.
  const sbAnim = React.useRef(new Animated.ValueXY()).current;
  const hueAnim = React.useRef(new Animated.Value(0)).current;

  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

  const syncSBThumb = React.useCallback(
    (ch: number, cs: number, cv: number) => {
      const { w, h: hh } = boxRef.current;
      sbAnim.setValue({
        x: clamp(cs * w - THUMB / 2, -THUMB / 2, w - THUMB / 2),
        y: clamp((1 - cv) * hh - THUMB / 2, -THUMB / 2, hh - THUMB / 2),
      });
    },
    [sbAnim],
  );

  const syncHueThumb = React.useCallback(
    (ch: number) => {
      const { w } = boxRef.current;
      hueAnim.setValue(clamp((ch / 360) * w - THUMB / 2 + 2, -2, w - THUMB));
    },
    [hueAnim],
  );

  // ---- Frame-coalesced state updates ------------------------------------
  // Update React state once per animation frame (not throttled by arbitrary
  // ms). This keeps all feedback — thumb ring, hex readout, swatch and grid —
  // tracking the finger at up to 60fps, while touch-move bursts within a frame
  // are coalesced into a single render so the JS thread never floods.
  const rafRef = React.useRef<number | null>(null);
  const pendingRef = React.useRef<[number, number, number] | null>(null);

  const setHsvLive = React.useCallback((next: [number, number, number]) => {
    hsvRef.current = next;
    pendingRef.current = next;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const value = pendingRef.current;
        pendingRef.current = null;
        if (value) setHsv(value);
      });
    }
  }, []);

  const commit = React.useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) setHsv(pending);
    const [ck, cs, cv] = hsvRef.current;
    onChangeRef.current(hsvToHex(ck, cs, cv));
  }, []);

  React.useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  React.useEffect(() => {
    const [ch, cs, cv] = hexToHsv(color);
    hsvRef.current = [ch, cs, cv];
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
    setHsv([ch, cs, cv]);
    syncSBThumb(ch, cs, cv);
    syncHueThumb(ch);
  }, [color, syncSBThumb, syncHueThumb]);

  const h = hsv[0], s = hsv[1], v = hsv[2];

  /* ── Saturation / Brightness pan ─────────────────────────────────────── */
  // x/y are absolute pixel positions inside the wrap, derived from the current
  // value baseline plus pure gesture deltas (see the PanResponder), so the
  // thumb always tracks the finger regardless of coordinate source quirks.
  const handleSB = React.useCallback(
    (x: number, y: number) => {
      const { w, h: hh } = boxRef.current;
      const newS = clamp(x / w, 0, 1);
      const newV = clamp(1 - y / hh, 0, 1);
      const ch = hsvRef.current[0];
      // Move the thumb natively (no React render), then update state per frame.
      syncSBThumb(ch, newS, newV);
      hsvRef.current = [ch, newS, newV];
      setHsvLive([ch, newS, newV]);
    },
    [setHsvLive, syncSBThumb],
  );

  const sbPan = React.useRef(
    PanResponder.create({
      // Capture the touch immediately and refuse to let the parent ScrollView
      // take over — otherwise vertical drags scroll the modal and the slider
      // fights the scroll gesture, which read as "doesn't follow touches".
      onStartShouldSetPanResponderCapture: () => true,
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      // Baseline is the CURRENT value — pure relative dragging via gesture
      // deltas, so the thumb always tracks the finger with zero coordinate-
      // source ambiguity (no locationX/pageX/origin measurement involved).
      onPanResponderGrant: () => {
        const [, cs, cv] = hsvRef.current;
        const { w, h: hh } = boxRef.current;
        sbStartRef.current = { x: cs * w, y: (1 - cv) * hh };
      },
      onPanResponderMove: (_e, g) => {
        const { w, h: hh } = boxRef.current;
        const x = clamp(sbStartRef.current.x + g.dx, 0, w);
        const y = clamp(sbStartRef.current.y + g.dy, 0, hh);
        handleSB(x, y);
      },
      onPanResponderRelease: () => commit(),
      onPanResponderTerminate: () => commit(),
    }),
  ).current;

  /* ── Hue pan ─────────────────────────────────────────────────────────── */
  const handleHue = React.useCallback(
    (x: number) => {
      const { w } = boxRef.current;
      const ratio = clamp(x / w, 0, 1);
      const newH = ratio * 360;
      const [cs, cv] = [hsvRef.current[1], hsvRef.current[2]];
      syncHueThumb(newH);
      hsvRef.current = [newH, cs, cv];
      setHsvLive([newH, cs, cv]);
    },
    [setHsvLive, syncHueThumb],
  );

  const huePan = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const [ch] = hsvRef.current;
        const { w } = boxRef.current;
        hueStartRef.current = (ch / 360) * w;
      },
      onPanResponderMove: (_e, g) => {
        const { w } = boxRef.current;
        const x = clamp(hueStartRef.current + g.dx, 0, w);
        handleHue(x);
      },
      onPanResponderRelease: () => commit(),
      onPanResponderTerminate: () => commit(),
    }),
  ).current;

  const onLayout = React.useCallback((e: LayoutChangeEvent) => {
    setBoxW(e.nativeEvent.layout.width);
    setBoxH(e.nativeEvent.layout.height);
  }, []);

  // Sync the thumbs from the LIVE value (hsvRef), which is never stale during a
  // drag — so a layout change can't snap the thumb backward to throttled state.
  React.useEffect(() => {
    boxRef.current = { w: boxW, h: boxH };
    const [ch, cs, cv] = hsvRef.current;
    syncSBThumb(ch, cs, cv);
    syncHueThumb(ch);
  }, [boxW, boxH, syncSBThumb, syncHueThumb]);

  const previewHex = hsvToHex(h, s, v);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Color</Text>

      {/* Saturation / Brightness square */}
      <View style={styles.sbWrap} onLayout={onLayout} {...sbPan.panHandlers}>
        <SatBrightSquare hue={h} />
        <Animated.View
          style={[
            styles.sbThumb,
            { transform: [{ translateX: sbAnim.x }, { translateY: sbAnim.y }] },
          ]}>
          <View style={[styles.sbThumbRing, { backgroundColor: previewHex }]} />
        </Animated.View>
      </View>

      {/* Hue bar */}
      <View style={styles.hueWrap} {...huePan.panHandlers}>
        <HueBar />
        <Animated.View
          style={[
            styles.hueThumb,
            { transform: [{ translateX: hueAnim }] },
          ]}
        />
      </View>

      {/* Preview */}
      <View style={styles.previewRow}>
        <View style={[styles.swatch, { backgroundColor: previewHex }]} />
        <Text style={styles.hexText}>{previewHex.toUpperCase()}</Text>
      </View>
    </View>
  );
}

/* ── Styles ────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { marginBottom: 14 },
  label: {
    color: '#E0FFFF',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  sbWrap: {
    borderRadius: 10,
    overflow: 'visible',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  sbThumb: {
    position: 'absolute',
    width: THUMB + 4,
    height: THUMB + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sbThumbRing: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 4,
  },
  hueWrap: {
    position: 'relative',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    overflow: 'visible',
  },
  hueThumb: {
    position: 'absolute',
    top: -3,
    width: THUMB + 4,
    height: 24,
    borderRadius: 12,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
    elevation: 3,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  hexText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});
