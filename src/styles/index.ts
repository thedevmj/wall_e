import { StyleSheet } from 'react-native';

/**
 * Shared design system accent color used across the app.
 */
export const ACCENT = '#22D3EE';

/**
 * Unified global style sheet. Every component imports styles from here
 * instead of declaring its own local StyleSheet, keeping the design system
 * in one place. Component-specific entries are namespaced with a short
 * prefix (wc = WallpaperCard, ab = ActionButton, ga = GeometricArt).
 */
const styles = StyleSheet.create({
  // ── App: layout & chrome ────────────────────────────────────────────────
  safeArea: {
    flex: 1,
    backgroundColor: '#050E23',
  },
  scroll: {
    flex: 1,
    backgroundColor: '#050E23',
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
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    color: '#F0F8FF',
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
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  sortButtonActive: {
    backgroundColor: 'rgba(34, 211, 238, 0.18)',
    borderColor: ACCENT,
  },
  sortButtonText: {
    color: 'rgba(240, 248, 255, 0.7)',
    fontSize: 12,
    fontWeight: '800',
  },
  sortButtonTextActive: {
    color: ACCENT,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
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
    backgroundColor: 'rgba(34, 211, 238, 0.18)',
  },
  tabLabel: {
    color: 'rgba(240, 248, 255, 0.6)',
    fontSize: 15,
    fontWeight: '800',
  },
  tabLabelActive: {
    color: ACCENT,
  },
  tabCountPill: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
  },
  tabCountPillActive: {
    backgroundColor: 'rgba(34, 211, 238, 0.25)',
  },
  tabCountText: {
    color: 'rgba(240, 248, 255, 0.6)',
    fontSize: 11,
    fontWeight: '800',
  },
  tabCountTextActive: {
    color: ACCENT,
  },

  // ── App: unsupported banner ─────────────────────────────────────────────
  unsupportedBanner: {
    marginTop: 14,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  unsupportedBannerTitle: {
    color: '#FCD34D',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  unsupportedBannerText: {
    color: 'rgba(253, 230, 138, 0.85)',
    fontSize: 12,
    lineHeight: 18,
  },
  unsupportedHint: {
    color: '#FCD34D',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 14,
  },

  // ── App: brand / header ─────────────────────────────────────────────────
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    marginRight: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  brandText: {
    flex: 1,
  },
  title: {
    color: '#F0F8FF',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 3,
  },
  subtitle: {
    color: 'rgba(240, 248, 255, 0.78)',
    fontSize: 13,
    lineHeight: 19,
  },
  // ── App: billboard ──────────────────────────────────────────────────────
  billboardSection: {
    marginBottom: 22,
  },
  billboardCard: {
    height: 176,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
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
    backgroundColor: 'rgba(3, 8, 26, 0.5)',
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
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  billboardName: {
    color: '#FFFFFF',
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
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  dotActive: {
    backgroundColor: ACCENT,
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
    color: '#F0F8FF',
    fontSize: 20,
    fontWeight: '700',
  },
  sectionCount: {
    color: 'rgba(230, 240, 250, 0.55)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  gridMedia: {
    width: '100%',
    height: '100%',
  },
  videoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  doodleFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  gridKindChip: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(2, 8, 23, 0.55)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  gridKindText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  gridName: {
    color: '#F0F8FF',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 2,
  },
  gridMeta: {
    color: 'rgba(230, 240, 250, 0.6)',
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
    backgroundColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
    zIndex: 20,
  },
  createFabText: {
    color: '#052033',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
  },

  // ── App: detail / create modal ──────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 8, 23, 0.72)',
  },
  modalPanel: {
    backgroundColor: '#0B1526',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    maxHeight: '88%',
  },
  modalScrollContent: {
    paddingBottom: 8,
  },
  modalScroll: {
    flexShrink: 1,
  },
  modalTitle: {
    color: '#F0F8FF',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  modalSubtitle: {
    color: 'rgba(240, 248, 255, 0.82)',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    color: '#F0F8FF',
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
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 10,
    paddingVertical: 12,
  },
  kindButtonSelected: {
    backgroundColor: 'rgba(34, 211, 238, 0.18)',
    borderColor: ACCENT,
  },
  kindButtonDisabled: {
    opacity: 0.5,
  },
  kindButtonText: {
    color: '#E2E8F0',
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
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  videoPreview: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: 18,
  },
  videoPreviewWrap: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
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
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  videoErrorHint: {
    color: '#C7D2FE',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  destinationLabel: {
    color: '#F0F8FF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  previewOnlyLabel: {
    color: '#E0FFFF',
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
    borderColor: '#64748B',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  loopText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  durationLabel: {
    color: '#E0FFFF',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 8,
  },
  sliderTrack: {
    height: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 11,
    justifyContent: 'center',
    marginBottom: 4,
  },
  sliderFill: {
    height: 22,
    backgroundColor: '#0E7490',
    borderRadius: 11,
  },
  sliderThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#A5F3FC',
    borderWidth: 3,
    borderColor: '#083344',
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
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 10,
    paddingVertical: 10,
  },
  rotationButtonSelected: {
    backgroundColor: 'rgba(34, 211, 238, 0.18)',
    borderColor: ACCENT,
  },
  rotationButtonText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '800',
  },
  rotationHint: {
    color: 'rgba(224, 255, 255, 0.75)',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  staticImagePreview: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginTop: 14,
    marginBottom: 14,
  },
  staticHint: {
    color: 'rgba(230, 240, 250, 0.65)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
    marginBottom: 20,
    lineHeight: 18,
  },
  errorText: {
    color: '#FDA4AF',
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
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  loadingText: {
    color: '#E0FFFF',
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
    backgroundColor: '#050E23',
  },
  errorBoundaryTitle: {
    color: '#F0F8FF',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 12,
  },
  errorBoundaryMessage: {
    color: '#FDA4AF',
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
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
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
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    fontSize: 18,
    fontWeight: '700',
  },
  wcDescription: {
    color: '#E2E8F0',
    fontSize: 13,
    lineHeight: 18,
  },
  wcMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  wcMeta: {
    color: '#B0BEC5',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  wcStatus: {
    color: '#E0FFFF',
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
    color: '#FFC2C2',
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
    backgroundColor: 'rgba(124, 58, 237, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  abSecondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  abDanger: {
    backgroundColor: 'rgba(190, 30, 45, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  abPressed: {
    opacity: 0.85,
  },
  abButtonText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  abSecondaryText: {
    color: '#E2E8F0',
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

export { styles };
export default styles;
