import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

/* ═══════════════════════════════════════════════════════════════════
   SESSION BOOTSTRAP
   The landing page passes a base64-encoded session as ?msp_auth=TOKEN
   after the user signs in or signs up.

   FIXED: Replaced deprecated escape() with a proper UTF-8 decode using
   TextDecoder. escape() is removed from strict ES module environments
   and crashes the entire auth flow, leaving users stuck on a blank page.
═══════════════════════════════════════════════════════════════════ */

// Update this to your Repo 1 (landing page) Vercel URL:
const LANDING_URL    = 'https://medschoolprep-landing.vercel.app';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/* ── Safely decode a base64 UTF-8 string (replaces deprecated escape()) ── */
function b64DecodeUTF8(str) {
  const bytes = Uint8Array.from(atob(str), c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/* ── 1. Read and apply inbound msp_auth token from the landing page ── */
function ingestAuthToken() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('msp_auth');
    if (!raw) return;

    const session = JSON.parse(b64DecodeUTF8(decodeURIComponent(raw)));

    if (session?.email && session?.name && session?.at) {
      localStorage.setItem('msp_session', JSON.stringify(session));

      // Seed msp_user from session so App.jsx has a name immediately
      const existing = JSON.parse(localStorage.getItem('msp_user') || '{}');
      if (!existing.name) {
        localStorage.setItem('msp_user', JSON.stringify({
          name:       session.name,
          specialty:  existing.specialty  || null,
          xp:         existing.xp         || 0,
          streak:     existing.streak      || 0,
          lastActive: existing.lastActive  || null,
        }));
      }
    }

    // Clean the URL so the token is not visible to the user
    params.delete('msp_auth');
    const cleanSearch = params.toString();
    window.history.replaceState(
      {},
      document.title,
      window.location.pathname + (cleanSearch ? '?' + cleanSearch : '')
    );
  } catch (err) {
    console.warn('msp_auth parse failed:', err.message);
  }
}

/* ── 2. Validate existing session ── */
function getValidSession() {
  try {
    const raw = localStorage.getItem('msp_session');
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.email || !s?.name) return null;
    if (Date.now() - s.at > SESSION_TTL_MS) {
      localStorage.removeItem('msp_session');
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

/* ── 3. Bootstrap ── */
ingestAuthToken();
const session = getValidSession();

if (!session) {
  window.location.replace(LANDING_URL);
} else {
  document.title = `MedSchoolPrep — ${session.name.split(' ')[0]}'s Workspace`;
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
