/**
 * Theme palettes.
 *
 * The app ships with a light cherry-blossom white theme as the default and a
 * dark midnight-navy variant. Every color in the shared design system is
 * derived from one of these palettes so a theme switch restyles the entire UI.
 */
export type ThemePalette = {
  isDark: boolean;
  /** Strong accent — cherry blossom pink. */
  accent: string;
  /** Accent used for selected/filled backgrounds (translucent). */
  accentSoft: string;
  /** Accent border (usually the same as accent). */
  accentBorder: string;
  /** Accent used for shadows/glows (FAB etc). */
  accentShadow: string;
  /** Text/icon color placed on top of the solid accent. */
  onAccent: string;
  /** App background. */
  background: string;
  /** Translucent card/input surface. */
  surface: string;
  /** Border color for surfaces/chips. */
  surfaceBorder: string;
  /** Solid surface (modal panel). */
  modalBg: string;
  /** Modal backdrop overlay. */
  overlay: string;
  /** Primary text (titles, headings). */
  textPrimary: string;
  /** Body text (buttons, labels, descriptions). */
  textBody: string;
  /** Secondary/descriptive text. */
  textSecondary: string;
  /** Faint/meta text. */
  textTertiary: string;
  /** Input placeholder / checkbox border. */
  placeholder: string;
  /** Checkbox border color. */
  checkboxBorder: string;
  /** Pure white (used for chips over media, thumbs). */
  white: string;
  /** Solid danger (delete button fill). */
  danger: string;
  /** Danger button border. */
  dangerBorder: string;
  /** Danger/error text. */
  dangerText: string;
  /** Amber warning banner background. */
  hintBg: string;
  /** Amber warning banner border. */
  hintBorder: string;
  /** Amber warning banner title. */
  hintTitle: string;
  /** Amber warning banner body text. */
  hintText: string;
  /** Amber inline hint text (unsupportedHint). */
  hintStrong: string;
  /** Billboard dots (inactive). */
  dot: string;
  /** Billboard scrim over media (always dark). */
  scrim: string;
  /** Loading overlay background. */
  loadingOverlay: string;
  /** Loading overlay text. */
  loadingText: string;
  /** Slider fill color. */
  sliderFill: string;
  /** Slider thumb background. */
  sliderThumbBg: string;
  /** Slider thumb border. */
  sliderThumbBorder: string;
  /** Solid chip background over media (kind chips). */
  hardOnMediaBg: string;
  /** Text color over media (kind chips, badges). */
  hardOnMediaText: string;
  /** Error boundary message text. */
  errorBoundaryMessage: string;
};

export const lightPalette: ThemePalette = {
  isDark: false,
  accent: '#EC4899',
  accentSoft: 'rgba(236, 72, 153, 0.13)',
  accentBorder: '#EC4899',
  accentShadow: 'rgba(236, 72, 153, 0.45)',
  onAccent: '#FFFFFF',
  background: '#FFF7F9',
  surface: 'rgba(236, 72, 153, 0.06)',
  surfaceBorder: 'rgba(190, 70, 130, 0.22)',
  modalBg: '#FFFFFF',
  overlay: 'rgba(94, 44, 72, 0.5)',
  textPrimary: '#3A2230',
  textBody: '#5B3A4C',
  textSecondary: 'rgba(78, 46, 65, 0.82)',
  textTertiary: 'rgba(96, 58, 80, 0.62)',
  placeholder: '#B891A6',
  checkboxBorder: '#B891A6',
  white: '#FFFFFF',
  danger: '#DC264B',
  dangerBorder: 'rgba(255, 255, 255, 0.25)',
  dangerText: '#C2253F',
  hintBg: 'rgba(245, 158, 11, 0.12)',
  hintBorder: 'rgba(245, 158, 11, 0.4)',
  hintTitle: '#8A5A00',
  hintText: 'rgba(138, 90, 0, 0.9)',
  hintStrong: '#8A5A00',
  dot: 'rgba(60, 38, 52, 0.2)',
  scrim: 'rgba(3, 8, 26, 0.5)',
  loadingOverlay: 'rgba(15, 23, 42, 0.85)',
  loadingText: '#E0FFFF',
  sliderFill: '#EC4899',
  sliderThumbBg: '#FFFFFF',
  sliderThumbBorder: '#B71260',
  hardOnMediaBg: 'rgba(2, 8, 23, 0.55)',
  hardOnMediaText: '#FFFFFF',
  errorBoundaryMessage: '#C2253F',
};

export const darkPalette: ThemePalette = {
  isDark: true,
  accent: '#F472B6',
  accentSoft: 'rgba(244, 114, 182, 0.18)',
  accentBorder: '#F472B6',
  accentShadow: 'rgba(244, 114, 182, 0.5)',
  onAccent: '#FFFFFF',
  background: '#050E23',
  surface: 'rgba(255, 255, 255, 0.06)',
  surfaceBorder: 'rgba(255, 255, 255, 0.15)',
  modalBg: '#0B1526',
  overlay: 'rgba(2, 8, 23, 0.72)',
  textPrimary: '#F0F8FF',
  textBody: '#E2E8F0',
  textSecondary: 'rgba(240, 248, 255, 0.82)',
  textTertiary: 'rgba(230, 240, 250, 0.62)',
  placeholder: '#64748B',
  checkboxBorder: '#64748B',
  white: '#FFFFFF',
  danger: '#C0273A',
  dangerBorder: 'rgba(255, 255, 255, 0.2)',
  dangerText: '#FDA4AF',
  hintBg: 'rgba(245, 158, 11, 0.12)',
  hintBorder: 'rgba(245, 158, 11, 0.4)',
  hintTitle: '#FCD34D',
  hintText: 'rgba(253, 230, 138, 0.85)',
  hintStrong: '#FCD34D',
  dot: 'rgba(255, 255, 255, 0.28)',
  scrim: 'rgba(3, 8, 26, 0.5)',
  loadingOverlay: 'rgba(15, 23, 42, 0.85)',
  loadingText: '#E0FFFF',
  sliderFill: '#F472B6',
  sliderThumbBg: '#FFFFFF',
  sliderThumbBorder: '#BE3C7E',
  hardOnMediaBg: 'rgba(2, 8, 23, 0.55)',
  hardOnMediaText: '#FFFFFF',
  errorBoundaryMessage: '#FDA4AF',
};