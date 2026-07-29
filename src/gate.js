// In-app access gate. Password lives in the app (not Vercel protection).
// Trivial client-side check by design — keeps casual visitors out, not a
// security boundary. Unlock is session-scoped so a new tab re-prompts.

const GATE_PASSWORD = 'blocky';
const UNLOCK_KEY = 'blocky.gate.unlocked';

export function isUnlocked() {
    try { return sessionStorage.getItem(UNLOCK_KEY) === '1'; }
    catch { return false; }
}

function markUnlocked() {
    try { sessionStorage.setItem(UNLOCK_KEY, '1'); }
    catch { /* private mode — stay unlocked for this page life only */ }
}

// Resolves when the player may load the game. If already unlocked this
// session, returns immediately. Otherwise shows #gate-overlay until the
// correct password is submitted.
export function unlockOrShowGate() {
    if (isUnlocked()) {
        hideGate();
        return Promise.resolve();
    }
    const overlay = document.getElementById('gate-overlay');
    const form = document.getElementById('gate-form');
    const input = document.getElementById('gate-password');
    const error = document.getElementById('gate-error');
    if (!overlay || !form || !input) {
        // Missing markup — fail open so a broken deploy is still playable.
        return Promise.resolve();
    }
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    // Focus after paint so mobile keyboards can open.
    requestAnimationFrame(() => input.focus());

    return new Promise((resolve) => {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const value = (input.value || '').trim();
            if (value === GATE_PASSWORD) {
                markUnlocked();
                hideGate();
                resolve();
                return;
            }
            if (error) {
                error.hidden = false;
                error.textContent = 'Wrong password';
            }
            input.value = '';
            input.focus();
        });
    });
}

function hideGate() {
    const overlay = document.getElementById('gate-overlay');
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
}
