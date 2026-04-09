import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useGlasses } from 'even-toolkit/useGlasses';
import { createScreenMapper } from 'even-toolkit/glass-router';
import { useSTT } from 'even-toolkit/stt/react';
import { useAuth } from '../contexts/AuthContext';
import { useBring } from '../contexts/BringContext';
import { useSettings } from '../contexts/SettingsContext';
import { parseVoiceInput } from '../lib/bring-client';
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
 *   /                → items-full
 *   /glasses/lists   → list-select
 *
 * When the user signs out we pin the display to the signed-out screen
 * regardless of URL.
 *
 * The parent (`GlassesRoot` in App.tsx) remounts this component whenever
 * `auth.status` changes (via `key={status}`), so by the time we get here
 * `status` is either `'signed-in'` or `'signed-out'` and won't flip for
 * the lifetime of the component. That lets us use `status` directly in
 * `deriveScreen` without refs — `useGlasses` only re-runs `deriveScreen`
 * on pathname changes, so a stale closure on mid-life status changes was
 * the reason the glasses used to get stuck on the signed-out screen after
 * the initial "loading → signed-in" transition.
 */

// Keep screen names in sync with selectors.ts.
const deriveScreenForAuthed = createScreenMapper(
  [
    { pattern: '/glasses/lists', screen: 'list-select' },
    { pattern: '/', screen: 'items-full' },
  ],
  'items-full',
);

// Ignore accidental double-selects within this window of start(): if the
// glasses hardware fires two SELECT_HIGHLIGHTED events back-to-back we
// don't want the second one to instantly commit an empty transcript.
const VOICE_COMMIT_COOLDOWN_MS = 750;

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
  const { settings } = useSettings();
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

  // Mirror any engine-level STT error into `voiceError` so the user
  // actually sees why the voice session dropped. Without this, a failed
  // Soniox init / audio-source selection just flips `isListening` back
  // to false and the "Listening…" line silently disappears.
  const sttError = stt.error ?? null;
  useEffect(() => {
    if (!sttError) return;
    const message =
      sttError instanceof Error
        ? sttError.message
        : typeof sttError === 'object' && sttError && 'message' in sttError
          ? String((sttError as { message: unknown }).message)
          : String(sttError);
    setVoiceError(message);
  }, [sttError]);

  // ── Snapshot (memoised shape, refreshed each render) ─────────────
  const snapshot = useMemo<BringSnapshot>(
    () => ({
      lists,
      activeListUuid,
      purchase: items.purchase,
      recently: items.recently,
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
  // `useGlasses` only calls `deriveScreen` on pathname changes, so this
  // closure is captured once at mount. That's fine because the parent
  // remounts us when auth status changes — `status` can't go stale for
  // the lifetime of this component.
  const deriveScreen = useCallback(
    (path: string): string => {
      if (status !== 'signed-in') return 'signed-out';
      return deriveScreenForAuthed(path);
    },
    [status],
  );

  // ── Actions (glass screens call these via `ctx`) ─────────────────

  // Keep refs for anything the action handlers close over so we don't
  // have to rebuild the `useGlasses` config on every change.
  const actionsRef = useRef<BringActions>(null as unknown as BringActions);

  // Track when the current voice session started, so we can reject
  // accidental immediate commits from hardware double-events.
  const voiceStartedAtRef = useRef(0);

  const startVoice = useCallback(() => {
    if (!settings.sonioxApiKey) {
      setVoiceError('Add a Soniox API key in Settings.');
      return;
    }
    setVoiceError(null);
    voiceStartedAtRef.current = Date.now();
    // `start()` returns a Promise; catch async init failures so the
    // user sees the reason on the glass instead of a silent bail-out.
    Promise.resolve()
      .then(() => stt.start())
      .catch((err: unknown) => {
        setVoiceError(
          err instanceof Error ? err.message : 'Could not start microphone.',
        );
      });
  }, [settings.sonioxApiKey, stt]);

  const stopVoice = useCallback(() => {
    try {
      stt.stop();
    } catch {
      // ignore
    }
  }, [stt]);

  const commitVoice = useCallback(async () => {
    // Reject commits that arrive before the cooldown — these are almost
    // certainly a stray second tap from the same physical press that
    // started the session.
    if (Date.now() - voiceStartedAtRef.current < VOICE_COMMIT_COOLDOWN_MS) {
      return;
    }
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

  // Every screen uses the toolkit's `text` page mode — items-full and
  // list-select are both just text lines on the G2 display. We pass a
  // constant getter so useGlasses doesn't have to introspect.
  const getPageMode = useCallback(() => 'text' as const, []);

  useGlasses({
    getSnapshot,
    toDisplayData,
    onGlassAction: handleGlassAction,
    deriveScreen,
    appName: 'BRING LENS',
    getPageMode,
    shutdownOnHomeBack: true,
  });

  return null;
}
