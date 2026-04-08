import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import type { BringActions, BringSnapshot } from '../shared';

/**
 * Placeholder shown on the glasses before the user signs in on the
 * phone app. We don't expose a sign-in flow through the glasses
 * themselves — typing a password on a pair of AR glasses is a bad
 * idea — so we just nudge the wearer to open the phone app.
 */
export const signedOutScreen: GlassScreen<BringSnapshot, BringActions> = {
  display() {
    return {
      lines: [
        line('BRING LENS', 'normal'),
        line('', 'separator'),
        line('  Not signed in', 'normal'),
        line('', 'normal'),
        line('  Open the Bring Lens', 'meta'),
        line('  phone app to sign in', 'meta'),
        line('  to your Bring! account.', 'meta'),
      ],
    };
  },
  action(_action, nav) {
    return nav;
  },
};
