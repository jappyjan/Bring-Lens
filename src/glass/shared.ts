import type { BringItem, BringList } from '../lib/bring-client';
import type { GlassesViewMode } from '../contexts/SettingsContext';

/**
 * The read-only snapshot the glasses renderer sees each tick. Everything
 * the glasses display depends on must live in here so that `useGlasses`
 * can diff efficiently. Screens are pure functions over `KitchenSnapshot`
 * in the toolkit's own example; we follow the same pattern.
 */
export interface BringSnapshot {
  /** All of the user's Bring! lists (for the list-select screen). */
  lists: BringList[];
  /** The list currently displayed on the glasses. */
  activeListUuid: string | null;
  /** Items on the active list, split into "to buy" and "recently bought". */
  purchase: BringItem[];
  recently: BringItem[];
  /** Current default view the glasses boot into. */
  viewMode: GlassesViewMode;
  /** Whether the user has a Soniox API key configured. */
  canVoice: boolean;
  /** Voice input state — see BringGlasses.tsx for the state machine. */
  voice: {
    active: boolean;
    transcript: string;
    error: string | null;
  };
  /** Whether an API mutation is currently in-flight (for "Saving…" hints). */
  busy: boolean;
}

/**
 * Side effects the glasses action handlers can call. These are filled
 * in by BringGlasses.tsx with React-context-aware implementations.
 */
export interface BringActions {
  navigate(path: string): void;
  setActiveList(uuid: string): void;
  toggleViewMode(): void;
  completeItem(item: BringItem): Promise<void>;
  uncompleteItem(item: BringItem): Promise<void>;
  startVoice(): void;
  stopVoice(): void;
  commitVoice(): Promise<void>;
  cancelVoice(): void;
}

/** Find the name of the currently-active list (for headers). */
export function activeListName(snapshot: BringSnapshot): string {
  const l = snapshot.lists.find((x) => x.listUuid === snapshot.activeListUuid);
  return l?.name ?? 'Shopping list';
}
