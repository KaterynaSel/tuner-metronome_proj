import { initTuner, destroyTuner } from './tuner.js';
import { initMetronome } from './metronome.js';

let activePanel = 'tuner';
let tunerActive = false;

const panels = {
    tuner: document.getElementById('panel-tuner'),
    metronome: document.getElementById('panel-metronome'),
};

function setPanel(name) {
    activePanel = name;

    Object.entries(panels).forEach(([key, el]) => {
        if (el) el.hidden = key !== name;
    });

    document.querySelectorAll('.nav-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.panel === name);
    });

    if (name === 'tuner') {
        if (!tunerActive) {
            initTuner();
            tunerActive = true;
        }
    } else if (tunerActive) {
        destroyTuner();
        tunerActive = false;
    }
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        const panel = btn.dataset.panel;
        if (panel && panel !== activePanel) {
            setPanel(panel);
        }
    });
});

initMetronome();
setPanel('tuner');

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch((err) => {
            console.warn('Service worker registration failed:', err);
        });
    });
}
