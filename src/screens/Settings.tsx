import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { useBring } from '../contexts/BringContext';
import { useSettings } from '../contexts/SettingsContext';

/**
 * Phone-side settings: pick the default list, default glasses view,
 * configure voice input, and sign out.
 */
export function Settings() {
  const { status, auth, signOut } = useAuth();
  const { lists, refreshLists, activeListUuid, setActiveListUuid } = useBring();
  const { settings, updateSettings } = useSettings();
  const navigate = useNavigate();
  const [sonioxDraft, setSonioxDraft] = useState(settings.sonioxApiKey ?? '');

  if (status === 'loading') return <div className="bl-spin">Loading…</div>;
  if (status === 'signed-out') return <Navigate to="/login" replace />;

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <>
      <div className="bl-card">
        <h2>Account</h2>
        <p>
          Signed in as <strong>{auth?.name || auth?.email}</strong> (
          {auth?.email})
        </p>
        <p>Region: {auth?.country}</p>
        <div className="bl-actions">
          <button type="button" className="bl-btn danger" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>

      <div className="bl-card">
        <h2>Default list</h2>
        <p>The list the glasses boot into on launch.</p>
        <div className="bl-field">
          <label htmlFor="default-list">Default list</label>
          <select
            id="default-list"
            value={settings.defaultListUuid ?? activeListUuid ?? ''}
            onChange={(e) => {
              const uuid = e.target.value || null;
              void updateSettings({ defaultListUuid: uuid });
              if (uuid) setActiveListUuid(uuid);
            }}
          >
            {lists.length === 0 ? (
              <option value="">No lists found</option>
            ) : null}
            {lists.map((list) => (
              <option key={list.listUuid} value={list.listUuid}>
                {list.name}
              </option>
            ))}
          </select>
        </div>
        <div className="bl-actions">
          <button
            type="button"
            className="bl-btn ghost"
            onClick={() => refreshLists()}
          >
            Reload lists
          </button>
        </div>
      </div>

      <div className="bl-card">
        <h2>Voice input (Soniox)</h2>
        <p>
          Voice-add uses the Soniox speech-to-text provider bundled with
          the Even Toolkit. Paste your API key to enable it. The key is
          stored via the Even Realities SDK local store, same as your
          Bring! credentials.
        </p>
        <div className="bl-field">
          <label htmlFor="soniox-key">Soniox API key</label>
          <input
            id="soniox-key"
            type="password"
            placeholder="sn-…"
            value={sonioxDraft}
            onChange={(e) => setSonioxDraft(e.target.value)}
          />
        </div>
        <div className="bl-field">
          <label htmlFor="stt-lang">Language</label>
          <select
            id="stt-lang"
            value={settings.sttLanguage}
            onChange={(e) => void updateSettings({ sttLanguage: e.target.value })}
          >
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="de-DE">German</option>
            <option value="fr-FR">French</option>
            <option value="it-IT">Italian</option>
            <option value="es-ES">Spanish</option>
            <option value="nl-NL">Dutch</option>
          </select>
        </div>
        <div className="bl-actions">
          <button
            type="button"
            className="bl-btn"
            onClick={() =>
              void updateSettings({
                sonioxApiKey: sonioxDraft.trim() || null,
              })
            }
          >
            Save key
          </button>
          {settings.sonioxApiKey ? (
            <button
              type="button"
              className="bl-btn ghost"
              onClick={() => {
                setSonioxDraft('');
                void updateSettings({ sonioxApiKey: null });
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
