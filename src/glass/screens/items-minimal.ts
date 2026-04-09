import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { truncate } from 'even-toolkit/text-utils';
import type { BringActions, BringSnapshot } from '../shared';

/**
 * MINIMAL view — the "hint in the corner" mode for when you're actually
 * in the store and want to see real life with just a small overlay.
 *
 * We draw no header, no prefix, no scroll bar. Just 3-5 items, each
 * rendered with dim (`meta`) style so the glasses display uses the
 * thinner font. GO_BACK switches to the full view.
 */

const MINIMAL_VISIBLE = 4;

export const itemsMinimalScreen: GlassScreen<BringSnapshot, BringActions> = {
  display(snapshot) {
    const items = snapshot.purchase.slice(0, MINIMAL_VISIBLE);
    if (items.length === 0) {
      return { lines: [line('  list clear', 'meta')] };
    }
    const lines = items.map((item) => {
      const text = item.specification
        ? `${item.name} · ${item.specification}`
        : item.name;
      return line(truncate(text, 30), 'meta');
    });
    // If there's overflow, hint at how many more there are.
    if (snapshot.purchase.length > MINIMAL_VISIBLE) {
      const extra = snapshot.purchase.length - MINIMAL_VISIBLE;
      lines.push(line(`  +${extra} more`, 'meta'));
    }
    return { lines };
  },

  action(action, nav, _snapshot, ctx) {
    // The minimal view is explicitly non-interactive for checking off
    // (you shouldn't have to fiddle with highlights while in-store).
    // A single tap switches back to the full view; back goes to list
    // selection.
    if (action.type === 'SELECT_HIGHLIGHTED') {
      ctx.toggleViewMode();
    } else if (action.type === 'GO_BACK') {
      ctx.navigate('/glasses/lists');
    }
    return nav;
  },
};
