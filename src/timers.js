import { initialCollectTime } from './constants.js';
import { state } from './state.js';
import { showMessage, updateCollectTimeDisplay } from './ui.js';

// --- Collect Timer Functions ---
export function startCollectTimer() {
    state.collectTimerValue = initialCollectTime;
    updateCollectTimeDisplay();

    if (state.collectTimerInterval) { // Clear any existing interval
        clearInterval(state.collectTimerInterval);
    }

    state.collectTimerInterval = setInterval(() => {
        if (!state.gameActive) { // If game ends for another reason, stop this timer
            clearInterval(state.collectTimerInterval);
            return;
        }
        state.collectTimerValue--;
        updateCollectTimeDisplay();

        if (state.collectTimerValue <= 0) { // Time ran out to collect a block
            clearInterval(state.collectTimerInterval);
            state.gameActive = false;
            showMessage(`GAME OVER! Failed to collect a block in time. Final Score: ${state.score}`);
        }
    }, 1000); // Update every second
}

export function resetCollectTimer() {
    state.collectTimerValue = initialCollectTime;
    updateCollectTimeDisplay();
    // The interval continues running, just the countdown value is reset.
}
