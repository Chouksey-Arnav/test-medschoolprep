import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/* ── Safely decode a base64 UTF-8 string ── */
function b64DecodeUTF8(str) {
  try {
    const bytes = Uint8Array.from(atob(str), c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch (err) {
    console.warn('Base64 decode failed:', err.message);
    return null;
  }
}

/* ── Bootstrap and validate session ── */
function bootstrapSession() {
  try {
    const params = new URLSearchParams(window.location.search);
    const rawToken = params.get('msp_auth');
    
    // 1. If a token exists in URL, process it
    if (rawToken) {
      const decoded = b64DecodeUTF8(decodeURIComponent(rawToken));
      if (decoded) {
        const sessionData = JSON.parse(decoded);
        localStorage.setItem('msp_session', JSON.stringify(sessionData));
        
        // Seed user profile
        const existingUser = JSON.parse(localStorage.getItem('msp_user') || '{}');
        localStorage.setItem('msp_user', JSON.stringify({
          name: sessionData.name,
          specialty: existingUser.specialty || null,
          xp: existingUser.xp || 0,
          streak: existingUser.streak || 0,
        }));
      }
      // Clean the URL so the token is not visible
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // 2. Read current session
    const rawSession = localStorage.getItem('msp_session');
    let session = rawSession ? JSON.parse(rawSession) : null;

    // 3. Fallback: If no valid session exists, create a local Guest to prevent crashes
    if (!session || !session.email || (Date.now() - session.at > SESSION_TTL_MS)) {
      session = {
        name: "Future Doctor",
        email: "guest@local.app",
        at: Date.now()
      };
      localStorage.setItem('msp_session', JSON.stringify(session));
      
      const existingUser = localStorage.getItem('msp_user');
      if (!existingUser) {
        localStorage.setItem('msp_user', JSON.stringify({
          name: "Future Doctor",
          specialty: null,
          xp: 0,
          streak: 0
        }));
      }
    }
    
    return session;
  } catch (err) {
    console.error('Session initialization failed:', err);
    return { name: "Guest", email: "guest@local.app", at: Date.now() };
  }
}

// Initialize
const session = bootstrapSession();
document.title = `MedSchoolPrep — ${session.name.split(' ')[0]}'s Workspace`;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
