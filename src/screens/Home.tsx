import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { useBring } from '../contexts/BringContext';

/**
 * The phone-side list view. Shows the currently active shopping list,
 * lets you check items off, remove them, add new ones, and switch to a
 * different list via a dropdown. Mirrors what appears on the glasses.
 */
export function Home() {
  const { status } = useAuth();
  const {
    lists,
    activeListUuid,
    setActiveListUuid,
    items,
    itemsLoading,
    itemsError,
    addItem,
    completeItem,
    uncompleteItem,
    removeItem,
    refreshItems,
  } = useBring();

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  if (status === 'loading') return <div className="bl-spin">Loading…</div>;
  if (status === 'signed-out') return <Navigate to="/login" replace />;

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await addItem(draft);
      setDraft('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="bl-card">
        <h2>Active list</h2>
        <div className="bl-field">
          <label htmlFor="list-select">Showing</label>
          <select
            id="list-select"
            value={activeListUuid ?? ''}
            onChange={(e) => setActiveListUuid(e.target.value || null)}
          >
            {lists.length === 0 ? <option value="">No lists found</option> : null}
            {lists.map((list) => (
              <option key={list.listUuid} value={list.listUuid}>
                {list.name}
              </option>
            ))}
          </select>
          <div className="bl-hint">
            This is also the list your glasses will show by default.
          </div>
        </div>

        <form onSubmit={handleAdd} className="bl-add">
          <input
            type="text"
            placeholder="Add an item…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy || !activeListUuid}
          />
          <button
            type="submit"
            className="bl-btn"
            disabled={busy || !draft.trim() || !activeListUuid}
          >
            Add
          </button>
        </form>
      </div>

      {itemsError ? <div className="bl-error">{itemsError}</div> : null}

      <div className="bl-card">
        <h2>To buy ({items.purchase.length})</h2>
        {items.purchase.length === 0 && !itemsLoading ? (
          <p>Your list is empty. Add an item above, or say something on the glasses.</p>
        ) : null}
        <ul className="bl-items">
          {items.purchase.map((item) => (
            <li key={item.uuid} className="bl-item">
              <button
                type="button"
                aria-label={`Check off ${item.itemId}`}
                className="bl-check"
                onClick={() => completeItem(item)}
              />
              <span className="bl-item-name">
                {item.itemId}
                {item.specification ? (
                  <span className="bl-item-spec">{item.specification}</span>
                ) : null}
              </span>
              <button
                type="button"
                className="bl-btn ghost"
                onClick={() => removeItem(item)}
                aria-label={`Remove ${item.itemId}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      {items.recently.length > 0 ? (
        <div className="bl-card">
          <h2>Recently bought</h2>
          <ul className="bl-items">
            {items.recently.slice(0, 20).map((item) => (
              <li key={item.uuid} className="bl-item recently">
                <button
                  type="button"
                  aria-label={`Add back ${item.itemId}`}
                  className="bl-check on"
                  onClick={() => uncompleteItem(item)}
                >
                  ✓
                </button>
                <span className="bl-item-name">
                  {item.itemId}
                  {item.specification ? (
                    <span className="bl-item-spec">{item.specification}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="bl-actions">
        <button
          type="button"
          className="bl-btn ghost"
          onClick={() => refreshItems()}
          disabled={itemsLoading}
        >
          {itemsLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </>
  );
}
