import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useGlasses } from 'even-toolkit/useGlasses';
import { createScreenMapper } from 'even-toolkit/glass-router';
import { useSTT } from 'even-toolkit/stt/react';
import { useAuth } from '../contexts/AuthContext';
import { useBring } from '../contexts/BringContext';
import { useSettings } from '../contexts/SettingsContext';
import { parseVoiceInput } from '../lib/bring-client';
import { bringSplash } from './splash';
import { onGlassAction, toDisplayData } from './selectors';
import type { BringActions, BringSnapshot } from './shared';

/**
 * Headless component that drives the glasses display. It sits next to
 * `<Routes>` in App.tsx, shares the same React contexts as the phone
 * screens, and wires everything into the toolkit's `useGlasses` hook.
 *
 * URL → screen mapping mirrors the phone-side routes so that tapping
 * "Change list" on the glasses drives the phone UI to the list picker
 * and vice versa. The actual URL prefixes are:
 *
 *   /                → items-full / items-minimal (based on settings)
 *   /glasses/lists   → list-select
 *
 * When the user signs out we pin the display to the signed-out screen
 * regardless of URL.
 */

// Keep screen names in sync with selectors.ts.
const deriveScreenForAuthed = createScreenMapper(
  [
    { pattern: '/glasses/lists', screen: 'list-select' },
    { pattern: '/', screen: 'items-full' },
  ],
  'items-full',
);

export function BringGlasses() {
  const { status } = useAuth();
  const {
    lists,
    activeListUuid,
    setActiveListUuid,
    items,
    itemsLoading,
    completeItem,
    uncompleteItem,
    addItem,
  } = useBring();
  const { settings, updateSettings } = useSettings();
  const navigate = useNavigate();

  // ── Speech-to-text ───────────────────────────────────────────────
  //
  // useSTT is a React hook. We always call it so the order of hooks
  // stays stable; if there's no API key we just never call `start`.
  const stt = useSTT({
    provider: 'soniox',
    language: settings.sttLanguage,
    apiKey: settings.sonioxApiKey ?? '',
    continuous: false,
    vad: { silenceMs: 2500 },
  });

  // Voice errors live in state (not a ref) so the snapshot triggers a
  // re-render the next time `useGlasses` polls — otherwise the error
  // hint would only appear after some other unrelated state change.
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // ── Snapshot (memoised shape, refreshed each render) ─────────────
  const snapshot = useMemo<BringSnapshot>(
    () => ({
      lists,
      activeListUuid,
      purchase: items.purchase,
      recently: items.recently,
      viewMode: settings.defaultView,
      canVoice: Boolean(settings.sonioxApiKey),
      voice: {
        active: stt.isListening,
        transcript: stt.transcript ?? '',
        error: voiceError,
      },
      busy: itemsLoading,
    }),
    [
      lists,
      activeListUuid,
      items.purchase,
      items.recently,
      settings.defaultView,
      settings.sonioxApiKey,
      stt.isListening,
      stt.transcript,
      voiceError,
      itemsLoading,
    ],
  );

  const snapshotRef = useRef<BringSnapshot>(snapshot);
  snapshotRef.current = snapshot;
  const getSnapshot = useCallback(() => snapshotRef.current, []);

  // ── Screen derivation ─────────────────────────────────────────────
  //
  // When signed out, pin the display to the signed-out screen. When
  // signed in, derive from the URL, and when derived to the items
  // view, fall through to the user's preferred variant (full/minimal).
  const deriveScreen = useCallback(
    (path: string): string => {
      if (status !== 'signed-in') return 'signed-out';
      const raw = deriveScreenForAuthed(path);
      if (raw === 'items-full') {
        return settings.defaultView === 'minimal'
          ? 'items-minimal'
          : 'items-full';
      }
      return raw;
    },
    [status, settings.defaultView],
  );

  // ── Actions (glass screens call these via `ctx`) ─────────────────

  // Keep refs for anything the action handlers close over so we don't
  // have to rebuild the `useGlasses` config on every change.
  const actionsRef = useRef<BringActions>(null as unknown as BringActions);

  const toggleViewMode = useCallback(() => {
    void updateSettings({
      defaultView: settings.defaultView === 'minimal' ? 'full' : 'minimal',
    });
  }, [settings.defaultView, updateSettings]);

  const startVoice = useCallback(() => {
    if (!settings.sonioxApiKey) {
      setVoiceError('Add a Soniox API key in Settings.');
      return;
    }
    setVoiceError(null);
    try {
      stt.start();
    } catch (err) {
      setVoiceError(
        err instanceof Error ? err.message : 'Could not start microphone.',
      );
    }
  }, [settings.sonioxApiKey, stt]);

  const stopVoice = useCallback(() => {
    try {
      stt.stop();
    } catch {
      // ignore
    }
  }, [stt]);

  const commitVoice = useCallback(async () => {
    const transcript = stt.transcript?.trim() ?? '';
    try {
      stt.stop();
    } catch {
      // ignore
    }
    if (!transcript) {
      setVoiceError('Did not catch that — try again.');
      return;
    }
    const { name, spec } = parseVoiceInput(transcript);
    if (!name) {
      setVoiceError('No item recognised.');
      return;
    }
    try {
      await addItem(name, spec);
      setVoiceError(null);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Add failed.');
    }
  }, [stt, addItem]);

  const cancelVoice = useCallback(() => {
    try {
      stt.stop();
    } catch {
      // ignore
    }
    setVoiceError(null);
  }, [stt]);

  actionsRef.current = {
    navigate,
    setActiveList: setActiveListUuid,
    toggleViewMode,
    completeItem,
    uncompleteItem,
    startVoice,
    stopVoice,
    commitVoice,
    cancelVoice,
  };

  // The router's action handler needs side-effect context; wrap it so
  // useGlasses can pass (action, nav, snapshot) and we inject `ctx`.
  const handleGlassAction = useCallback(
    (
      action: Parameters<typeof onGlassAction>[0],
      nav: Parameters<typeof onGlassAction>[1],
      snap: BringSnapshot,
    ) => onGlassAction(action, nav, snap, actionsRef.current),
    [],
  );

  // Every screen uses the toolkit's `text` page mode — full, minimal,
  // and list-select are all just text lines on the G2 display. We pass
  // a constant getter so useGlasses doesn't have to introspect.
  const getPageMode = useCallback(() => 'text' as const, []);

  useGlasses({
    getSnapshot,
    toDisplayData,
    onGlassAction: handleGlassAction,
    deriveScreen,
    appName: 'BRING LENS',
    splash: bringSplash,
    getPageMode,
    shutdownOnHomeBack: true,
  });

  return null;
}
