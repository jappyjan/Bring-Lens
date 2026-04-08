import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { moveHighlight } from 'even-toolkit/glass-nav';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { glassHeader } from 'even-toolkit/types';
import { truncate } from 'even-toolkit/text-utils';
import type { BringActions, BringSnapshot } from '../shared';

/**
 * LIST SELECT view — shows every Bring! list the user has access to.
 * Selecting a list makes it active (persisted as the new default) and
 * jumps to the full items view.
 */

export const listSelectScreen: GlassScreen<BringSnapshot, BringActions> = {
  display(snapshot, nav) {
    const header = glassHeader('Pick a list');
    if (snapshot.lists.length === 0) {
      return {
        lines: [
          ...header,
          { text: '  (no lists found)', inverted: false, style: 'meta' },
          { text: '  Sign in on the phone', inverted: false, style: 'meta' },
          { text: '  to get started.', inverted: false, style: 'meta' },
        ],
      };
    }
    const listLines = buildScrollableList({
      items: snapshot.lists,
      highlightedIndex: Math.min(
        nav.highlightedIndex,
        snapshot.lists.length - 1,
      ),
      maxVisible: 6,
      formatter: (list) => {
        const active = list.listUuid === snapshot.activeListUuid ? '●' : ' ';
        return `${active} ${truncate(list.name, 42)}`;
      },
    });
    return { lines: [...header, ...listLines] };
  },

  action(action, nav, snapshot, ctx) {
    if (snapshot.lists.length === 0) return nav;

    if (action.type === 'HIGHLIGHT_MOVE') {
      return {
        ...nav,
        highlightedIndex: moveHighlight(
          nav.highlightedIndex,
          action.direction,
          snapshot.lists.length - 1,
        ),
      };
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      const picked =
        snapshot.lists[
          Math.min(nav.highlightedIndex, snapshot.lists.length - 1)
        ];
      if (picked) {
        ctx.setActiveList(picked.listUuid);
        ctx.navigate('/');
      }
    }
    if (action.type === 'GO_BACK') {
      ctx.navigate('/');
    }
    return nav;
  },
};
