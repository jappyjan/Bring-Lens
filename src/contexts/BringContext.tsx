import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  addItem as apiAddItem,
  completeItem as apiCompleteItem,
  getListItems,
  getLists,
  removeItem as apiRemoveItem,
  uncompleteItem as apiUncompleteItem,
  type BringItem,
  type BringList,
  type BringListItems,
} from '../lib/bring-client';
import { useAuth } from './AuthContext';
import { useSettings } from './SettingsContext';

/**
 * BringContext owns the lists, the active list, and the items on that
 * list. It polls the active list while the app is open so the glasses
 * view stays in sync with whatever the user (or anyone else sharing
 * the list) does on the phone.
 */

interface RefreshItemsOptions {
  /**
   * When true, don't toggle `itemsLoading` during the fetch. Used by the
   * background polling loop so the phone empty-state copy and the glass
   * header's "…" busy hint don't blink every tick.
   */
  silent?: boolean;
}

interface BringContextValue {
  lists: BringList[];
  listsLoading: boolean;
  listsError: string | null;
  refreshLists(): Promise<void>;

  activeListUuid: string | null;
  setActiveListUuid(uuid: string | null): void;

  items: BringListItems;
  itemsLoading: boolean;
  itemsError: string | null;
  refreshItems(options?: RefreshItemsOptions): Promise<void>;

  addItem(name: string, spec?: string): Promise<void>;
  completeItem(item: BringItem): Promise<void>;
  uncompleteItem(item: BringItem): Promise<void>;
  removeItem(item: BringItem): Promise<void>;
}

const EMPTY_ITEMS: BringListItems = { purchase: [], recently: [] };

const BringContext = createContext<BringContextValue | null>(null);

const ITEMS_POLL_MS = 15_000; // 15 seconds while the app is open

export function BringProvider({ children }: { children: ReactNode }) {
  const { status, getAuth } = useAuth();
  const { settings, loaded: settingsLoaded, updateSettings } = useSettings();

  const [lists, setLists] = useState<BringList[]>([]);
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);

  const [activeListUuid, setActiveListUuidState] = useState<string | null>(
    null,
  );
  const activeListRef = useRef<string | null>(null);
  activeListRef.current = activeListUuid;

  const [items, setItems] = useState<BringListItems>(EMPTY_ITEMS);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  // ── Loaders ──────────────────────────────────────────────────────

  const refreshLists = useCallback(async () => {
    const auth = getAuth();
    if (!auth) return;
    setListsLoading(true);
    setListsError(null);
    try {
      const next = await getLists(auth);
      setLists(next);
      // If no active list is chosen yet, prefer the saved default,
      // otherwise fall back to the first list in the response.
      if (!activeListRef.current) {
        const chosen =
          next.find((l) => l.listUuid === settings.defaultListUuid)?.listUuid ??
          next[0]?.listUuid ??
          null;
        if (chosen) {
          setActiveListUuidState(chosen);
          activeListRef.current = chosen;
        }
      }
    } catch (err) {
      setListsError(err instanceof Error ? err.message : String(err));
    } finally {
      setListsLoading(false);
    }
  }, [getAuth, settings.defaultListUuid]);

  const refreshItems = useCallback(
    async (options?: RefreshItemsOptions) => {
      const silent = options?.silent ?? false;
      const listUuid = activeListRef.current;
      if (!listUuid) {
        setItems(EMPTY_ITEMS);
        return;
      }
      const auth = getAuth();
      if (!auth) return;
      if (!silent) setItemsLoading(true);
      setItemsError(null);
      try {
        const next = await getListItems(auth, listUuid);
        // Only apply the result if the active list hasn't changed while
        // the request was in flight. Prevents stale items flashing in.
        if (activeListRef.current === listUuid) {
          setItems(next);
        }
      } catch (err) {
        setItemsError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setItemsLoading(false);
      }
    },
    [getAuth],
  );

  // Refresh lists as soon as we're signed in and settings are loaded.
  useEffect(() => {
    if (status === 'signed-in' && settingsLoaded) {
      void refreshLists();
    }
    if (status === 'signed-out') {
      setLists([]);
      setActiveListUuidState(null);
      setItems(EMPTY_ITEMS);
    }
  }, [status, settingsLoaded, refreshLists]);

  // When the active list changes (or on initial load), fetch its items
  // and start polling. The initial fetch is non-silent (drives the first
  // spinner), but the background poll is silent so it doesn't flash the
  // phone empty-state or the glass header's busy hint.
  useEffect(() => {
    if (!activeListUuid || status !== 'signed-in') return;
    void refreshItems();
    const id = window.setInterval(() => {
      void refreshItems({ silent: true });
    }, ITEMS_POLL_MS);
    return () => window.clearInterval(id);
  }, [activeListUuid, status, refreshItems]);

  const setActiveListUuid = useCallback(
    (uuid: string | null) => {
      setActiveListUuidState(uuid);
      activeListRef.current = uuid;
      setItems(EMPTY_ITEMS);
      // Persist the user's choice as the default for future launches.
      if (uuid && uuid !== settings.defaultListUuid) {
        void updateSettings({ defaultListUuid: uuid });
      }
    },
    [settings.defaultListUuid, updateSettings],
  );

  // ── Mutations (optimistic) ───────────────────────────────────────

  // Thin wrapper: hand a non-null auth record to the API caller, or
  // throw. The proxy is stateless so there's nothing to refresh.
  const withAuth = useCallback(
    async <T,>(fn: (auth: NonNullable<ReturnType<typeof getAuth>>) => Promise<T>) => {
      const auth = getAuth();
      if (!auth) throw new Error('Not signed in');
      return fn(auth);
    },
    [getAuth],
  );

  const doAddItem = useCallback(
    async (name: string, spec = '') => {
      const listUuid = activeListRef.current;
      if (!listUuid) throw new Error('No active list');
      const trimmed = name.trim();
      if (!trimmed) return;
      // Optimistic: put the new item at the top of the purchase list.
      // Items are keyed by name on the to-buy side, so duplicate names
      // would conflict — drop any existing entry with the same name
      // before splicing the optimistic copy in.
      const optimistic: BringItem = { name: trimmed, specification: spec };
      setItems((prev) => ({
        purchase: [
          optimistic,
          ...prev.purchase.filter((i) => i.name !== trimmed),
        ],
        recently: prev.recently,
      }));
      try {
        await withAuth((auth) => apiAddItem(auth, listUuid, trimmed, spec));
        await refreshItems();
      } catch (err) {
        // Roll back the optimistic add on failure.
        setItems((prev) => ({
          purchase: prev.purchase.filter((i) => i.name !== trimmed),
          recently: prev.recently,
        }));
        throw err;
      }
    },
    [withAuth, refreshItems],
  );

  const doComplete = useCallback(
    async (item: BringItem) => {
      const listUuid = activeListRef.current;
      if (!listUuid) return;
      setItems((prev) => ({
        purchase: prev.purchase.filter((i) => i.name !== item.name),
        recently: [item, ...prev.recently.filter((i) => i.name !== item.name)],
      }));
      try {
        await withAuth((auth) => apiCompleteItem(auth, listUuid, item));
      } catch (err) {
        await refreshItems();
        throw err;
      }
    },
    [withAuth, refreshItems],
  );

  const doUncomplete = useCallback(
    async (item: BringItem) => {
      const listUuid = activeListRef.current;
      if (!listUuid) return;
      setItems((prev) => ({
        purchase: [item, ...prev.purchase.filter((i) => i.name !== item.name)],
        recently: prev.recently.filter((i) => i.name !== item.name),
      }));
      try {
        await withAuth((auth) => apiUncompleteItem(auth, listUuid, item));
      } catch (err) {
        await refreshItems();
        throw err;
      }
    },
    [withAuth, refreshItems],
  );

  const doRemove = useCallback(
    async (item: BringItem) => {
      const listUuid = activeListRef.current;
      if (!listUuid) return;
      setItems((prev) => ({
        purchase: prev.purchase.filter((i) => i.name !== item.name),
        recently: prev.recently.filter((i) => i.name !== item.name),
      }));
      try {
        await withAuth((auth) => apiRemoveItem(auth, listUuid, item));
      } catch (err) {
        await refreshItems();
        throw err;
      }
    },
    [withAuth, refreshItems],
  );

  const value = useMemo<BringContextValue>(
    () => ({
      lists,
      listsLoading,
      listsError,
      refreshLists,
      activeListUuid,
      setActiveListUuid,
      items,
      itemsLoading,
      itemsError,
      refreshItems,
      addItem: doAddItem,
      completeItem: doComplete,
      uncompleteItem: doUncomplete,
      removeItem: doRemove,
    }),
    [
      lists,
      listsLoading,
      listsError,
      refreshLists,
      activeListUuid,
      setActiveListUuid,
      items,
      itemsLoading,
      itemsError,
      refreshItems,
      doAddItem,
      doComplete,
      doUncomplete,
      doRemove,
    ],
  );

  return <BringContext.Provider value={value}>{children}</BringContext.Provider>;
}

export function useBring(): BringContextValue {
  const ctx = useContext(BringContext);
  if (!ctx) throw new Error('useBring must be used inside <BringProvider>');
  return ctx;
}
