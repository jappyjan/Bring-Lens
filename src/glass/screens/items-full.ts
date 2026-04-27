import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { moveHighlight } from 'even-toolkit/glass-nav';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { glassHeader } from 'even-toolkit/types';
import { truncate } from 'even-toolkit/text-utils';
import type { BringActions, BringSnapshot } from '../shared';
import { activeListName } from '../shared';

/**
 * The full glasses list view.
 *
 * Layout:
 *   ── Header ────────────────
 *    Einkauf           12
 *   ─────────────────────────
 *    + Add by voice            ← index 0 (only if canVoice)
 *    Milch (1L)                ← indices continue with purchase items
 *    Brot
 *    …
 *    → Change list             ← bottom utility row
 *
 * Tapping a purchase item arms it for check-off (row gets a "?" prefix);
 * a second tap on the same item commits (TO_RECENTLY). Any other action
 * disarms. Tapping the voice row starts a recording. Tapping "Change
 * list" navigates.
 */

// Row kinds the full view can contain.
type Row =
  | { kind: 'voice' }
  | { kind: 'item'; index: number }
  | { kind: 'change-list' };

function buildRows(snapshot: BringSnapshot): Row[] {
  const rows: Row[] = [];
  if (snapshot.canVoice) rows.push({ kind: 'voice' });
  snapshot.purchase.forEach((_, i) => rows.push({ kind: 'item', index: i }));
  rows.push({ kind: 'change-list' });
  return rows;
}

// Pad/truncate "name   spec" for a glasses row.
function formatItemRow(name: string, spec: string, maxWidth = 44): string {
  if (!spec) return truncate(name, maxWidth);
  const specPart = ` (${spec})`;
  const room = Math.max(6, maxWidth - specPart.length);
  return `${truncate(name, room)}${specPart}`;
}

function formatRow(row: Row, snapshot: BringSnapshot): string {
  switch (row.kind) {
    case 'voice':
      if (snapshot.voice.active) {
        return snapshot.voice.transcript
          ? `● ${truncate(snapshot.voice.transcript, 42)}`
          : '● Listening…';
      }
      return '+ Add by voice';
    case 'item': {
      const item = snapshot.purchase[row.index];
      if (!item) return '';
      const armed = snapshot.pendingCompleteName === item.name;
      // Armed rows lose 2 chars of name budget to the "? " prefix so the
      // line still fits the 44-char display width.
      const text = formatItemRow(item.name, item.specification, armed ? 42 : 44);
      return armed ? `? ${text}` : text;
    }
    case 'change-list':
      return '→ Change list';
  }
}

export const itemsFullScreen: GlassScreen<BringSnapshot, BringActions> = {
  display(snapshot, nav) {
    const rows = buildRows(snapshot);
    const title = activeListName(snapshot);
    const count = snapshot.purchase.length;
    // Tack on a small "…" marker when an API call is in flight.
    const headerText = snapshot.busy
      ? `${title}   ${count}   …`
      : `${title}   ${count}`;
    const header = glassHeader(headerText);

    // When the list is empty, show a hint and still render the utility rows.
    if (rows.length === 0) {
      return { lines: [...header, { text: '  (empty list)', inverted: false, style: 'meta' }] };
    }

    const listLines = buildScrollableList<Row>({
      items: rows,
      highlightedIndex: Math.min(nav.highlightedIndex, rows.length - 1),
      maxVisible: 6,
      formatter: (row) => formatRow(row, snapshot),
    });

    const lines = [...header, ...listLines];
    if (snapshot.voice.error) {
      lines.push({
        text: `  ! ${truncate(snapshot.voice.error, 40)}`,
        inverted: false,
        style: 'meta',
      });
    }

    return { lines };
  },

  action(action, nav, snapshot, ctx) {
    const rows = buildRows(snapshot);
    if (rows.length === 0) return nav;

    // If the user is in the middle of a voice recording, route the
    // primary button to commit/cancel instead of checking off items.
    if (snapshot.voice.active) {
      if (action.type === 'SELECT_HIGHLIGHTED') {
        void ctx.commitVoice();
        return nav;
      }
      if (action.type === 'GO_BACK') {
        ctx.cancelVoice();
        return nav;
      }
      // Swallow highlight moves while recording.
      return nav;
    }

    if (action.type === 'HIGHLIGHT_MOVE') {
      if (snapshot.pendingCompleteName) ctx.setPendingCompleteName(null);
      return {
        ...nav,
        highlightedIndex: moveHighlight(
          nav.highlightedIndex,
          action.direction,
          rows.length - 1,
        ),
      };
    }

    if (action.type === 'SELECT_HIGHLIGHTED') {
      const row = rows[Math.min(nav.highlightedIndex, rows.length - 1)];
      if (!row) return nav;
      switch (row.kind) {
        case 'voice':
          if (snapshot.pendingCompleteName) ctx.setPendingCompleteName(null);
          ctx.startVoice();
          return nav;
        case 'item': {
          const item = snapshot.purchase[row.index];
          if (!item) return nav;
          if (snapshot.pendingCompleteName === item.name) {
            // Second tap on the same item — commit the check-off.
            ctx.setPendingCompleteName(null);
            void ctx.completeItem(item);
            // Keep highlight on the same index, which now points at the
            // next item because the one we completed just disappeared.
            return {
              ...nav,
              highlightedIndex: Math.min(
                nav.highlightedIndex,
                Math.max(0, rows.length - 2),
              ),
            };
          }
          // First tap (or arming a different item) — arm and wait for the
          // second tap. Do NOT call completeItem.
          ctx.setPendingCompleteName(item.name);
          return nav;
        }
        case 'change-list':
          if (snapshot.pendingCompleteName) ctx.setPendingCompleteName(null);
          ctx.navigate('/glasses/lists');
          return nav;
      }
    }

    if (action.type === 'GO_BACK') {
      if (snapshot.pendingCompleteName) ctx.setPendingCompleteName(null);
      ctx.navigate('/glasses/lists');
    }

    return nav;
  },
};
