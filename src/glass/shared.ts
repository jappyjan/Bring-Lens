import type { BringItem, BringList } from '../lib/bring-client';

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
  /**
   * Name of the purchase item currently armed for check-off. The first tap
   * on an item sets this; the second tap on the same item commits via
   * `completeItem`. Any other action (highlight move, voice, navigate,
   * tapping a different item) clears it back to null.
   */
  pendingCompleteName: string | null;
}

/**
 * Side effects the glasses action handlers can call. These are filled
 * in by BringGlasses.tsx with React-context-aware implementations.
 */
export interface BringActions {
  navigate(path: string): void;
  setActiveList(uuid: string): void;
  completeItem(item: BringItem): Promise<void>;
  uncompleteItem(item: BringItem): Promise<void>;
  startVoice(): void;
  stopVoice(): void;
  commitVoice(): Promise<void>;
  cancelVoice(): void;
  setPendingCompleteName(name: string | null): void;
}

/** Find the name of the currently-active list (for headers). */
export function activeListName(snapshot: BringSnapshot): string {
  const l = snapshot.lists.find((x) => x.listUuid === snapshot.activeListUuid);
  return l?.name ?? 'Shopping list';
}
