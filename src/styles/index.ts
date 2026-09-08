import { StyleSheet } from 'react-native';
import type { ThemePalette } from '../theme/palette';

/**
 * Unified theme-aware design system.
 *
 * The style sheet is built per-theme via `createStyles(palette)`, so a
 * light/dark switch restyles every screen. Components consume it through the
 * `useThemedStyles()` hook (see `src/theme/ThemeContext.tsx`). Component-
 * specific entries are namespaced with a short prefix (wc = WallpaperCard,
 * ab = ActionButton, ga = GeometricArt).
 */
export function createStyles(p: ThemePalette) {
  return StyleSheet.create({
    // ── App: layout & chrome ────────────────────────────────────────────────
    safeArea: {
      flex: 1,
      backgroundColor: p.background,
    },
    scroll: {
      flex: 1,
      backgroundColor: p.background,
    },
    content: {
      paddingHorizontal: 18,
      paddingTop: 14,
      paddingBottom: 36,
    },
    header: {
      paddingBottom: 16,
    },
    searchInput: {
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.surfaceBorder,
      borderRadius: 12,
      color: p.textPrimary,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 14,
      marginTop: 14,
    },
    sortRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 10,
    },
    sortButton: {
      alignItems: 'center',
      borderWidth: 1,
      borderColor: p.surfaceBorder,
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 14,
    },
    sortButtonActive: {
      backgroundColor: p.accentSoft,
      borderColor: p.accentBorder,
    },
    sortButtonText: {
      color: p.textTertiary,
      fontSize: 12,
      fontWeight: '800',
    },
    sortButtonTextActive: {
      color: p.accent,
    },
    tabBar: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 16,
      backgroundColor: p.surface,
      borderRadius: 14,
      padding: 4,
      borderWidth: 1,
      borderColor: p.surfaceBorder,
    },
    tabButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 10,
      paddingVertical: 10,
    },
    tabButtonActive: {
      backgroundColor: p.accentSoft,
    },
    tabLabel: {
      color: p.textTertiary,
      fontSize: 15,
      fontWeight: '800',
    },
    tabLabelActive: {
      color: p.accent,
    },
    tabCountPill: {
      minWidth: 22,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      backgroundColor: p.surfaceBorder,
      alignItems: 'center',
    },
    tabCountPillActive: {
      backgroundColor: p.accentSoft,
    },
    tabCountText: {
      color: p.textTertiary,
      fontSize: 11,
      fontWeight: '800',
    },
    tabCountTextActive: {
      color: p.accent,
    },

    // ── App: theme toggle ───────────────────────────────────────────────────
    themeToggle: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: p.accentBorder,
      backgroundColor: p.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 10,
    },
    themeToggleText: {
      color: p.accent,
      fontSize: 12,
      fontWeight: '800',
    },

    // ── App: unsupported banner ─────────────────────────────────────────────
    unsupportedBanner: {
      marginTop: 14,
      backgroundColor: p.hintBg,
      borderWidth: 1,
      borderColor: p.hintBorder,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    unsupportedBannerTitle: {
      color: p.hintTitle,
      fontSize: 13,
      fontWeight: '800',
      marginBottom: 4,
    },
    unsupportedBannerText: {
      color: p.hintText,
      fontSize: 12,
      lineHeight: 18,
    },
    unsupportedHint: {
      color: p.hintStrong,
      fontSize: 12,
      fontWeight: '600',
      marginBottom: 14,
    },

    // ── App: brand / header ─────────────────────────────────────────────────
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      color: p.textPrimary,
      fontSize: 24,
      fontWeight: '800',
      letterSpacing: -0.4,
    },
    // ── App: billboard ──────────────────────────────────────────────────────
    billboardSection: {
      marginBottom: 22,
    },
    billboardCard: {
      height: 176,
      borderRadius: 22,
      overflow: 'hidden',
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.surfaceBorder,
    },
    billboardArt: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    billboardMedia: {
      width: '100%',
      height: '100%',
    },
    billboardScrim: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: p.scrim,
    },
    billboardInfo: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: 14,
    },
    billboardKindChip: {
      alignSelf: 'flex-start',
      backgroundColor: 'rgba(255, 255, 255, 0.16)',
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
      marginBottom: 8,
    },
    billboardKindText: {
      color: p.white,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
    },
    billboardName: {
      color: p.white,
      fontSize: 22,
      fontWeight: '800',
      textShadowColor: 'rgba(0,0,0,0.4)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
      marginBottom: 4,
    },
    billboardDesc: {
      color: 'rgba(240, 248, 255, 0.85)',
      fontSize: 13,
      lineHeight: 18,
      textShadowColor: 'rgba(0,0,0,0.35)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    dotsRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 10,
      gap: 6,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: p.dot,
    },
    dotActive: {
      backgroundColor: p.accent,
      width: 18,
    },

    // ── App: sections & grid ────────────────────────────────────────────────
    sectionHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14,
    },
    section: {
      marginBottom: 30,
    },
    sectionTitle: {
      color: p.textPrimary,
      fontSize: 20,
      fontWeight: '700',
    },
    sectionCount: {
      color: p.textTertiary,
      fontSize: 13,
      fontWeight: '800',
    },
    gridRow: {
      flexDirection: 'row',
      gap: 14,
      marginBottom: 14,
    },
    gridItem: {
      flex: 1,
      minWidth: 0,
    },
    gridArt: {
      width: '100%',
      height: 132,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: p.surface,
    },
    gridMedia: {
      width: '100%',
      height: '100%',
    },
    videoPlaceholder: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.surface,
    },
    doodleFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.surface,
    },
    gridKindChip: {
      position: 'absolute',
      top: 8,
      right: 8,
      backgroundColor: p.hardOnMediaBg,
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 3,
    },
    gridKindText: {
      color: p.hardOnMediaText,
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.8,
    },
    gridName: {
      color: p.textPrimary,
      fontSize: 15,
      fontWeight: '700',
      marginTop: 10,
      marginBottom: 2,
    },
    gridMeta: {
      color: p.textTertiary,
      fontSize: 12,
      fontWeight: '600',
    },

    // ── App: wrapper & create FAB ───────────────────────────────────────────
    wrapper: {
      flex: 1,
    },
    createFab: {
      position: 'absolute',
      right: 20,
      bottom: 32,
      width: 72,
      height: 52,
      borderRadius: 26,
      backgroundColor: p.accent,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: p.accentShadow,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.45,
      shadowRadius: 14,
      elevation: 10,
      zIndex: 20,
    },
    createFabText: {
      color: p.onAccent,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.3,
      textAlign: 'center',
    },

    // ── App: detail / create modal ──────────────────────────────────────────
    modalBackdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: p.overlay,
    },
    modalPanel: {
      backgroundColor: p.modalBg,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 22,
      borderWidth: 1,
      borderColor: p.surfaceBorder,
      maxHeight: '88%',
    },
    modalScrollContent: {
      paddingBottom: 8,
    },
    modalScroll: {
      flexShrink: 1,
    },
    modalTitle: {
      color: p.textPrimary,
      fontSize: 24,
      fontWeight: '800',
      marginBottom: 8,
    },
    modalSubtitle: {
      color: p.textSecondary,
      fontSize: 14,
      lineHeight: 21,
      marginBottom: 18,
    },
    input: {
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.surfaceBorder,
      borderRadius: 12,
      color: p.textPrimary,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: 15,
      marginBottom: 14,
    },
    kindRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 18,
    },
    kindButton: {
      flex: 1,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: p.surfaceBorder,
      borderRadius: 10,
      paddingVertical: 12,
    },
    kindButtonSelected: {
      backgroundColor: p.accentSoft,
      borderColor: p.accentBorder,
    },
    kindButtonDisabled: {
      opacity: 0.5,
    },
    kindButtonText: {
      color: p.textBody,
      fontSize: 12,
      fontWeight: '800',
    },
    modalActions: {
      flexDirection: 'row',
      gap: 10,
    },
    modalButton: {
      flex: 1,
      minWidth: 0,
    },

    // ── App: preview ────────────────────────────────────────────────────────
    preview: {
      height: 150,
      borderRadius: 16,
      marginBottom: 18,
      overflow: 'hidden',
      justifyContent: 'flex-end',
      padding: 16,
    },
    previewStage: {
      position: 'relative',
    },
    previewBadge: {
      position: 'absolute',
      top: 8,
      right: 8,
      zIndex: 10,
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      borderRadius: 6,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    previewBadgeText: {
      color: p.white,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.2,
    },
    videoPreview: {
      width: '100%',
      height: 220,
      borderRadius: 16,
      backgroundColor: p.surface,
      marginBottom: 18,
    },
    videoPreviewWrap: {
      width: '100%',
      height: 220,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: p.surface,
      marginBottom: 18,
    },
    videoPreviewAbs: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100%',
      height: '100%',
    },
    previewOrb: {
      position: 'absolute',
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: 'rgba(255,255,255,0.25)',
      top: 15,
      left: '35%',
    },
    previewLabel: {
      color: p.white,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1,
    },
    videoErrorHint: {
      color: p.textSecondary,
      fontSize: 11,
      fontWeight: '600',
      marginTop: 4,
    },
    destinationLabel: {
      color: p.textPrimary,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.2,
      marginBottom: 8,
    },
    previewOnlyLabel: {
      color: p.textPrimary,
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 14,
    },
    loopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 14,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: p.checkboxBorder,
      marginRight: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      backgroundColor: p.accent,
      borderColor: p.accentBorder,
    },
    checkmark: {
      color: p.onAccent,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 18,
    },
    loopText: {
      color: p.textBody,
      fontSize: 14,
      fontWeight: '600',
    },
    durationLabel: {
      color: p.textBody,
      fontSize: 13,
      fontWeight: '700',
      marginTop: 14,
      marginBottom: 8,
    },
    sliderTrack: {
      height: 22,
      backgroundColor: p.surfaceBorder,
      borderRadius: 11,
      justifyContent: 'center',
      marginBottom: 4,
    },
    sliderFill: {
      height: 22,
      backgroundColor: p.sliderFill,
      borderRadius: 11,
    },
    sliderThumb: {
      position: 'absolute',
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: p.sliderThumbBg,
      borderWidth: 3,
      borderColor: p.sliderThumbBorder,
    },
    rotationRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 14,
    },
    rotationButton: {
      flex: 1,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: p.surfaceBorder,
      borderRadius: 10,
      paddingVertical: 10,
    },
    rotationButtonSelected: {
      backgroundColor: p.accentSoft,
      borderColor: p.accentBorder,
    },
    rotationButtonText: {
      color: p.textBody,
      fontSize: 13,
      fontWeight: '800',
    },
    rotationHint: {
      color: p.textSecondary,
      fontSize: 12,
      fontWeight: '600',
      marginBottom: 6,
    },
    staticImagePreview: {
      width: '100%',
      height: 220,
      borderRadius: 16,
      backgroundColor: p.surface,
      marginTop: 14,
      marginBottom: 14,
    },
    staticHint: {
      color: p.textTertiary,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 2,
      marginBottom: 20,
      lineHeight: 18,
    },
    errorText: {
      color: p.dangerText,
      fontSize: 13,
      fontWeight: '700',
      marginTop: 14,
      flexShrink: 1,
    },
    errorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 14,
    },
    loadingOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: p.loadingOverlay,
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 10,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    loadingText: {
      color: p.loadingText,
      fontSize: 14,
      fontWeight: '700',
      marginTop: 14,
    },

    // ── App: error boundary ─────────────────────────────────────────────────
    errorBoundary: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      backgroundColor: p.background,
    },
    errorBoundaryTitle: {
      color: p.textPrimary,
      fontSize: 24,
      fontWeight: '800',
      marginBottom: 12,
    },
    errorBoundaryMessage: {
      color: p.errorBoundaryMessage,
      fontSize: 14,
      textAlign: 'center',
      marginBottom: 24,
      lineHeight: 20,
    },
    errorBoundaryActions: {
      marginTop: 12,
      alignSelf: 'stretch',
    },

    // ── WallpaperCard (wc) ──────────────────────────────────────────────────
    wcCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: p.surface,
      borderColor: p.surfaceBorder,
      borderWidth: 1,
      borderRadius: 18,
      borderLeftWidth: 5,
      marginBottom: 14,
      padding: 14,
      minHeight: 110,
    },
    wcCardLeft: {
      marginRight: 4,
    },
    wcCardRight: {
      marginLeft: 4,
    },
    wcIndicator: {
      width: 12,
      height: 12,
      borderRadius: 6,
      marginRight: 12,
    },
    wcContent: {
      flex: 1,
      gap: 6,
    },
    wcTitle: {
      color: p.textPrimary,
      fontSize: 18,
      fontWeight: '700',
    },
    wcDescription: {
      color: p.textBody,
      fontSize: 13,
      lineHeight: 18,
    },
    wcMetaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    wcMeta: {
      color: p.textTertiary,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.8,
    },
    wcStatus: {
      color: p.accent,
      fontSize: 11,
      fontWeight: '700',
      marginLeft: 8,
    },
    wcDeleteButton: {
      marginLeft: 8,
      paddingHorizontal: 8,
      paddingVertical: 7,
    },
    wcDeleteText: {
      color: p.dangerText,
      fontSize: 11,
      fontWeight: '800',
    },

    // ── ActionButton (ab) ───────────────────────────────────────────────────
    abButton: {
      borderRadius: 14,
      paddingHorizontal: 18,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 160,
    },
    abPrimary: {
      backgroundColor: p.accent,
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.2)',
      shadowColor: p.accentShadow,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.35,
      shadowRadius: 8,
    },
    abSecondary: {
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.surfaceBorder,
    },
    abDanger: {
      backgroundColor: p.danger,
      borderWidth: 1,
      borderColor: p.dangerBorder,
    },
    abPressed: {
      opacity: 0.85,
    },
    abButtonText: {
      color: p.white,
      fontSize: 15,
      fontWeight: '700',
    },
    abSecondaryText: {
      color: p.textBody,
    },

    // ── GeometricArt (ga) ───────────────────────────────────────────────────
    gaArt: {
      overflow: 'hidden',
    },
    gaBlob: {
      position: 'absolute',
    },
    gaRing: {
      position: 'absolute',
      backgroundColor: 'transparent',
    },
    gaDiamond: {
      position: 'absolute',
      transform: [{ rotate: '45deg' }],
    },
    gaDiamondShine: {
      backgroundColor: 'rgba(255, 255, 255, 0.38)',
    },
    gaOrb: {
      position: 'absolute',
    },
    gaTriangle: {
      position: 'absolute',
      width: 0,
      height: 0,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      backgroundColor: 'transparent',
    },
    gaDot: {
      position: 'absolute',
    },
  });
}

export type ThemedStyles = ReturnType<typeof createStyles>;