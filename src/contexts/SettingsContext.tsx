import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getJson, setJson, StorageKeys } from '../lib/storage';

export type GlassesViewMode = 'full' | 'minimal';

export interface AppSettings {
  /** The list that is shown on the glasses by default on app start. */
  defaultListUuid: string | null;
  /** Which layout the glasses boot into. */
  defaultView: GlassesViewMode;
  /** Soniox STT API key for voice-add. Optional. */
  sonioxApiKey: string | null;
  /** Locale used for item names. Drives Bring!'s `X-BRING-COUNTRY` header. */
  country: string;
  /** STT language code for Soniox. */
  sttLanguage: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultListUuid: null,
  defaultView: 'full',
  sonioxApiKey: null,
  country: 'DE',
  sttLanguage: 'en-US',
};

interface SettingsContextValue {
  settings: AppSettings;
  loaded: boolean;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getJson<AppSettings>(StorageKeys.settings);
      if (cancelled) return;
      if (stored) {
        // Merge against defaults so new fields don't break existing installs.
        setSettings({ ...DEFAULT_SETTINGS, ...stored });
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        // Fire-and-forget persist; callers don't need to await storage.
        void setJson(StorageKeys.settings, next);
        return next;
      });
    },
    [],
  );

  const value = useMemo(
    () => ({ settings, loaded, updateSettings }),
    [settings, loaded, updateSettings],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
