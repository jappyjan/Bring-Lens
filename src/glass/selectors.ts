import { createGlassScreenRouter } from 'even-toolkit/glass-screen-router';
import type { BringActions, BringSnapshot } from './shared';
import { itemsFullScreen } from './screens/items-full';
import { listSelectScreen } from './screens/list-select';
import { signedOutScreen } from './screens/signed-out';

/**
 * The glasses router:
 *   'items-full'    — scrollable list view
 *   'list-select'   — pick the active Bring! list
 *   'signed-out'    — nudge the user back to the phone to sign in
 *
 * The fallback is the full items view because that's where users
 * spend most of their time.
 */
export const { toDisplayData, onGlassAction } = createGlassScreenRouter<
  BringSnapshot,
  BringActions
>(
  {
    'items-full': itemsFullScreen,
    'list-select': listSelectScreen,
    'signed-out': signedOutScreen,
  },
  'items-full',
);
