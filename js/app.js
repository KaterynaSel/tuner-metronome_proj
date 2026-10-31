import { initTuner, destroyTuner } from './tuner.js';
import { initMetronome, destroyMetronome } from './metronome.js';

let activePanel = 'tuner';
let tunerActive = false;
let metronomeActive = false;

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
        if (metronomeActive) {
            destroyMetronome();
            metronomeActive = false;
        }
        if (!tunerActive) {
            initTuner();
            tunerActive = true;
        }
    } else if (name === 'metronome') {
        if (tunerActive) {
            destroyTuner();
            tunerActive = false;
        }
        if (!metronomeActive) {
            initMetronome();
            metronomeActive = true;
        }
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

setPanel('tuner');

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch((err) => {
            console.warn('Service worker registration failed:', err);
        });
    });
}
