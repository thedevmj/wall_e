import React from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, RADIUS } from './theme';

type NavTab = {
  key: string;
  label: string;
};

const TABS: NavTab[] = [
  { key: 'home', label: 'Home' },
  { key: 'grid', label: 'Grid' },
  { key: 'fav', label: 'Favorites' },
  { key: 'settings', label: 'Settings' },
  { key: 'library', label: 'Library' },
];

type Props = {
  activeTab: string;
  onTabChange: (tab: string) => void;
};

function IconDot({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
      }}
    />
  );
}

function HomeIcon({ active }: { active: boolean }) {
  const c = active ? COLORS.cyan : COLORS.textSecondary;
  return (
    <View style={styles.bounds}>
      <View style={[styles.roof, { borderBottomColor: c }]} />
      <View style={[styles.house, { backgroundColor: c }]} />
    </View>
  );
}

function GridIcon({ active }: { active: boolean }) {
  const c = active ? COLORS.cyan : COLORS.textSecondary;
  return (
    <View style={styles.grid}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={[styles.gridCell, { backgroundColor: c }]} />
      ))}
    </View>
  );
}

function HeartIcon({ active }: { active: boolean }) {
  const c = active ? COLORS.cyan : COLORS.textSecondary;
  return (
    <View style={styles.heartWrap}>
      <View style={[styles.heartBody, { backgroundColor: c }]} />
      <View style={styles.heartTop}>
        <View style={[styles.heartLobe, { backgroundColor: c }]} />
        <View style={[styles.heartLobe, { backgroundColor: c }]} />
      </View>
    </View>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  const c = active ? COLORS.cyan : COLORS.textSecondary;
  return (
    <View style={styles.settingsWrap}>
      <View style={[styles.gearRing, { borderColor: c }]} />
      <View style={[styles.gearHub, { backgroundColor: c }]} />
    </View>
  );
}

function LibraryIcon({ active }: { active: boolean }) {
  const c = active ? COLORS.cyan : COLORS.textSecondary;
  return (
    <View style={styles.library}>
      <View style={[styles.barTall, { backgroundColor: c }]} />
      <View style={[styles.barMid, { backgroundColor: c }]} />
      <View style={[styles.barTall, { backgroundColor: c }]} />
    </View>
  );
}

const ICONS: Record<string, React.FC<{ active: boolean }>> = {
  home: HomeIcon,
  grid: GridIcon,
  fav: HeartIcon,
  settings: SettingsIcon,
  library: LibraryIcon,
};

export function BottomNav({ activeTab, onTabChange }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        {TABS.map(tab => {
          const active = tab.key === activeTab;
          const Icon = ICONS[tab.key] ?? IconDot;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={[styles.tab, active && styles.tabActive]}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}>
              {active && <View style={styles.glow} />}
              <Icon active={active} />
              <Text style={[styles.label, active && styles.labelActive]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 28,
    left: SPACING.lg,
    right: SPACING.lg,
    alignItems: 'center',
  },
  inner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(20, 20, 24, 0.92)',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.translucentBorder,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    justifyContent: 'space-around',
    width: '100%',
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 50,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
    position: 'relative',
  },
  tabActive: {},
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.cyanGlow,
    borderRadius: RADIUS.md,
  },
  label: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 3,
    fontWeight: '500',
  },
  labelActive: {
    color: COLORS.cyan,
  },

  // Icon primitives
  bounds: {
    width: 22,
    height: 20,
    justifyContent: 'flex-end',
  },
  roof: {
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    position: 'absolute',
    top: 0,
  },
  house: {
    width: 18,
    height: 11,
    borderRadius: 2,
    alignSelf: 'center',
  },
  grid: {
    width: 20,
    height: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
  },
  gridCell: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  heartWrap: {
    width: 22,
    height: 20,
    alignItems: 'center',
  },
  heartBody: {
    width: 12,
    height: 12,
    borderRadius: 6,
    transform: [{ rotate: '45deg' }],
    marginTop: 2,
  },
  heartTop: {
    flexDirection: 'row',
    marginTop: -3,
  },
  heartLobe: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  settingsWrap: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearRing: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2.5,
  },
  gearHub: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: 'absolute',
  },
  library: {
    width: 20,
    height: 20,
    flexDirection: 'row',
    gap: 2,
    alignItems: 'flex-end',
  },
  barTall: {
    width: 6,
    height: 20,
    borderRadius: 2,
  },
  barMid: {
    width: 6,
    height: 16,
    borderRadius: 2,
  },
});