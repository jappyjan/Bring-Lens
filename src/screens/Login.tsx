import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { BASE_URL, pingProxy } from '../lib/bring-client';

type PingResult = Awaited<ReturnType<typeof pingProxy>>;

/**
 * Login form for the Bring! account. Credentials are handed directly
 * to the Bring! auth endpoint; the resulting access/refresh tokens are
 * persisted via the Even Realities SDK's local storage (see
 * `src/lib/storage.ts`).
 */
export function Login() {
  const { status, signIn, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('DE');
  const [submitting, setSubmitting] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [ping, setPing] = useState<PingResult | null>(null);

  async function handlePing() {
    setPinging(true);
    setPing(null);
    try {
      setPing(await pingProxy());
    } finally {
      setPinging(false);
    }
  }

  if (status === 'signed-in') {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signIn(email, password, country);
    } catch {
      // Error is already surfaced on the context.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bl-card">
      <h2>Sign in to Bring!</h2>
      <p>
        Your Bring! account connects this app to your shopping lists. Your
        credentials are stored securely on your glasses via the Even
        Realities SDK and are never sent anywhere except to Bring!.
      </p>

      {error ? (
        <div className="bl-error">
          <strong>Sign-in failed</strong>
          <pre className="bl-error-detail">{error}</pre>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} autoComplete="on">
        <div className="bl-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="bl-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="bl-field">
          <label htmlFor="country">Country</label>
          <select
            id="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            <option value="DE">Germany (DE)</option>
            <option value="CH">Switzerland (CH)</option>
            <option value="AT">Austria (AT)</option>
            <option value="FR">France (FR)</option>
            <option value="IT">Italy (IT)</option>
            <option value="NL">Netherlands (NL)</option>
            <option value="GB">United Kingdom (GB)</option>
            <option value="US">United States (US)</option>
          </select>
          <div className="bl-hint">
            Bring! keys item names on your locale. Pick the country your
            account was created in for matching icons.
          </div>
        </div>
        <div className="bl-actions">
          <button type="submit" className="bl-btn" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>

      <hr style={{ margin: '18px 0', border: 0, borderTop: '1px solid rgba(0,0,0,0.08)' }} />

      <h2 style={{ marginTop: 0 }}>Diagnostics</h2>
      <p>
        If sign-in fails with a generic network error ("Load failed" /
        "Failed to fetch"), use this button to test the proxy directly.
        It hits <code>{BASE_URL}/healthz</code> with no custom headers,
        so it bypasses the CORS preflight and tells you whether the
        proxy is reachable at all.
      </p>
      <div className="bl-actions">
        <button
          type="button"
          className="bl-btn ghost"
          disabled={pinging}
          onClick={handlePing}
        >
          {pinging ? 'Testing…' : 'Test proxy'}
        </button>
      </div>
      {ping ? (
        <pre className="bl-error-detail" style={{ marginTop: 12 }}>
{`URL:    ${ping.url}
Status: ${ping.status ?? '(no response)'}
Body:   ${ping.body ?? ''}
${ping.error ? `Error:  ${ping.error}` : ''}
Result: ${ping.ok ? 'OK — proxy is reachable.' : 'FAIL — proxy is not reachable from this browser.'}`}
        </pre>
      ) : null}
    </div>
  );
}
