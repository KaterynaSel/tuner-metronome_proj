import { YIN, Macleod } from 'pitchfinder';

//1. Эталонные частоты для каждой струны
const targetFrequencies = {
    1: 329.6, // E4
    2: 246.9, // B3
    3: 196.0, // G3
    4: 146.8, // D3
    5: 110.0, // A2
    6: 82.4   // E2
};

const STRING_LABELS = {
    1: '1 · E4',
    2: '2 · B3',
    3: '3 · G3',
    4: '4 · D3',
    5: '5 · A2',
    6: '6 · E2'
};

let currentAudio = null;
let mediaStream = null;
let audioContext = null;
let referenceTonesBound = false;

const pitchHistory = [];
const MAX_HISTORY = 7;

let currentString = null;
let candidateString = null;
let candidateCount = 0;
const SWITCH_THRESHOLD = 5;
const STRING_RANGE_TOLERANCE = 0.08;

let isAcquiring = false;
let acquisitionStartTime = 0;
const ACQUISITION_TIME = 250;
const acquisitionPitches = [];

let previousRMS = 0;
const THRESHOLD = 0.005;
const ATTACK_THRESHOLD = 0.01;

let silenceStartTime = null;
const SILENCE_TIMEOUT = 3000;

function initReferenceTones() {
    if (referenceTonesBound) return;
    referenceTonesBound = true;

    document.querySelectorAll('.string-btn').forEach((button) => {
        button.addEventListener('click', () => {
            if (currentAudio) {
                currentAudio.pause();
                currentAudio.currentTime = 0;
            }

            const soundUrl = button.getAttribute('data-sound');
            currentAudio = new Audio(soundUrl);
            currentAudio.play().catch((e) => console.error('Audio error:', soundUrl, e));
        });
    });
}

export async function initTuner() {
    initReferenceTones();

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        audioContext = new AudioContext();

        const detectYIN = YIN({
            sampleRate: audioContext.sampleRate,
            threshold: 0.15,
            probabilityThreshold: 0.85
        });

        const detectMacleod = Macleod({
            sampleRate: audioContext.sampleRate,
            bufferSize: 4096,
            cutoff: 0.93
        });

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 4096;

        const lowPass = audioContext.createBiquadFilter();
        lowPass.type = 'lowpass';
        lowPass.frequency.value = 400;
        lowPass.Q.value = 0.7;

        const source = audioContext.createMediaStreamSource(mediaStream);
        source.connect(lowPass);
        lowPass.connect(analyser);

        const buffer = new Float32Array(analyser.fftSize);
        startAnalysisLoop(analyser, buffer, detectYIN, detectMacleod);
    } catch (error) {
        console.error('error with micro', error);
    }
}

export function destroyTuner() {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    clearHtmlFields();
    resetTunerDisplay();
}

function getRMS(buffer) {
    const sum = buffer.reduce((acc, val) => acc + val * val, 0);
    return Math.sqrt(sum / buffer.length);
}

function getMedian(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function snapToTargetOctave(detectedHz, targetHz) {
    let best = detectedHz;
    let bestCents = Infinity;

    for (const factor of [0.5, 1, 2]) {
        const candidate = detectedHz * factor;
        const cents = Math.abs(1200 * Math.log2(candidate / targetHz));
        if (cents < bestCents) {
            bestCents = cents;
            best = candidate;
        }
    }

    return best;
}

function isInStringRange(hz, targetHz) {
    const min = targetHz * (1 - STRING_RANGE_TOLERANCE);
    const max = targetHz * (1 + STRING_RANGE_TOLERANCE);
    return hz >= min && hz <= max;
}

function detectPitchFused(buffer, detectYIN, detectMacleod) {
    const yinPitch = detectYIN(buffer);
    if (yinPitch) return yinPitch;

    const macleodResult = detectMacleod(buffer);
    if (macleodResult.freq > 0) return macleodResult.freq;

    return null;
}

function startAnalysisLoop(analyser, buffer, detectYIN, detectMacleod) {
    function updatePitch() {
        if (!audioContext) return;

        analyser.getFloatTimeDomainData(buffer);
        const rms = getRMS(buffer);

        if (rms < 0.007) {
            if (silenceStartTime === null) {
                silenceStartTime = Date.now();
            }

            const silenceDuration = Date.now() - silenceStartTime;

            if (silenceDuration >= SILENCE_TIMEOUT) {
                clearHtmlFields();
                resetTunerDisplay();
                currentString = null;
                candidateString = null;
                candidateCount = 0;
                silenceStartTime = null;
            }

            requestAnimationFrame(updatePitch);
            return;
        }

        silenceStartTime = null;

        const rmsDelta = rms - previousRMS;

        if (rms > THRESHOLD && rmsDelta > ATTACK_THRESHOLD) {
            pitchHistory.length = 0;
            currentString = null;
            candidateString = null;
            candidateCount = 0;
            isAcquiring = true;
            acquisitionStartTime = Date.now();
            acquisitionPitches.length = 0;
        }

        previousRMS = rms;

        let pitch = detectPitchFused(buffer, detectYIN, detectMacleod);

        if (pitch && currentString !== null) {
            const lockedTargetHz = targetFrequencies[currentString];
            pitch = snapToTargetOctave(pitch, lockedTargetHz);

            if (!isInStringRange(pitch, lockedTargetHz)) {
                requestAnimationFrame(updatePitch);
                return;
            }
        }

        if (pitch && pitch > 50 && pitch < 400) {
            pitchHistory.push(pitch);
            window.debugPitchHistory = pitchHistory;

            if (pitchHistory.length > MAX_HISTORY) {
                pitchHistory.shift();
            }

            const stablePitch = getMedian(pitchHistory);

            if (isAcquiring) {
                acquisitionPitches.push(stablePitch);

                const acquisitionDuration = Date.now() - acquisitionStartTime;

                if (acquisitionDuration < ACQUISITION_TIME) {
                    requestAnimationFrame(updatePitch);
                    return;
                }

                const acquisitionPitch = getMedian(acquisitionPitches);
                currentString = Number(findClosestString(acquisitionPitch));
                isAcquiring = false;
            }

            const detectedString = findClosestString(stablePitch);

            if (currentString === null) {
                currentString = detectedString;
            } else if (detectedString !== currentString) {
                if (candidateString === detectedString) {
                    candidateCount++;
                } else {
                    candidateString = detectedString;
                    candidateCount = 1;
                }

                if (candidateCount >= SWITCH_THRESHOLD) {
                    currentString = detectedString;
                    candidateString = null;
                    candidateCount = 0;
                }
            } else {
                candidateString = null;
                candidateCount = 0;
            }

            const targetHz = targetFrequencies[currentString];
            const displayPitch = snapToTargetOctave(stablePitch, targetHz);

            window.debugTuner = {
                stablePitch,
                displayPitch,
                detectedString,
                currentString,
                candidateString,
                candidateCount
            };

            updateHtmlFields(currentString, displayPitch, targetHz);
        }

        requestAnimationFrame(updatePitch);
    }

    updatePitch();
}

function findClosestString(detectedHz) {
    let closestString = 1;
    let minCents = Infinity;

    for (const [stringNum, targetHz] of Object.entries(targetFrequencies)) {
        const snapped = snapToTargetOctave(detectedHz, targetHz);
        const cents = Math.abs(1200 * Math.log2(snapped / targetHz));
        if (cents < minCents) {
            minCents = cents;
            closestString = Number(stringNum);
        }
    }

    return closestString;
}

function hzToCents(detectedHz, targetHz) {
    return 1200 * Math.log2(detectedHz / targetHz);
}

//цветовые зоны по |¢|: зелёный → жёлтый (5–15) → красный (15–30)
const TUNING_COLOR_GREEN = '#3dff9a';
const TUNING_COLOR_YELLOW = '#ffd43b';
const TUNING_COLOR_RED = '#ff5c6c';

function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return {
        r: (value >> 16) & 255,
        g: (value >> 8) & 255,
        b: value & 255,
    };
}

function rgbToHex(r, g, b) {
    const toHex = (n) => Math.round(n).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function lerpColor(hexA, hexB, t) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    const mix = (from, to) => from + (to - from) * t;
    return rgbToHex(mix(a.r, b.r), mix(a.g, b.g), mix(a.b, b.b));
}

function getTuningColor(cents) {
    const abs = Math.min(50, Math.abs(cents));

    if (abs <= 5) {
        return TUNING_COLOR_GREEN;
    }

    if (abs <= 15) {
        const t = (abs - 5) / 10;
        return lerpColor(TUNING_COLOR_GREEN, TUNING_COLOR_YELLOW, t);
    }

    if (abs <= 30) {
        const t = (abs - 15) / 15;
        return lerpColor(TUNING_COLOR_YELLOW, TUNING_COLOR_RED, t);
    }

    return TUNING_COLOR_RED;
}

function applyTuningColor(element, color) {
    if (!element) return;
    element.style.color = color;
    element.style.setProperty('--tuning-color', color);
}

function updateTunerVisual(stringNumber, detectedHz, targetHz) {
    const cents = hzToCents(detectedHz, targetHz);
    const tuningColor = getTuningColor(cents);
    const needle = document.getElementById('tuner-needle');
    const centsEl = document.getElementById('tuner-cents');
    const activeLabel = document.getElementById('tuner-active-string');
    const gauge = document.querySelector('.tuner-gauge');

    const clampedCents = Math.max(-50, Math.min(50, cents));
    const rotation = clampedCents * 0.9;

    if (needle) {
        needle.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
        needle.style.background = `linear-gradient(180deg, ${tuningColor} 0%, ${lerpColor(tuningColor, '#000000', 0.35)} 100%)`;
        needle.style.boxShadow = `0 0 16px ${tuningColor}99`;
    }

    if (centsEl) {
        centsEl.textContent = cents > 0 ? `+${cents.toFixed(1)}` : cents.toFixed(1);
        applyTuningColor(centsEl, tuningColor);
    }

    if (activeLabel) {
        activeLabel.textContent = STRING_LABELS[stringNumber] || '—';
    }

    if (gauge) {
        gauge.style.setProperty('--tuning-color', tuningColor);
        gauge.style.borderColor = `${tuningColor}66`;
    }

    document.querySelectorAll('.string-row').forEach((row) => {
        const isActive = row.dataset.string === String(stringNumber);
        row.classList.toggle('string-row--active', isActive);
        if (isActive) {
            row.style.borderColor = `${tuningColor}88`;
            row.style.boxShadow = `0 0 0 1px ${tuningColor}40`;
        } else {
            row.style.borderColor = '';
            row.style.boxShadow = '';
        }
    });
}

function resetTunerDisplay() {
    const needle = document.getElementById('tuner-needle');
    const centsEl = document.getElementById('tuner-cents');
    const activeLabel = document.getElementById('tuner-active-string');
    const gauge = document.querySelector('.tuner-gauge');

    if (needle) {
        needle.style.transform = 'translateX(-50%) rotate(0deg)';
        needle.style.background = '';
        needle.style.boxShadow = '';
    }
    if (centsEl) {
        centsEl.textContent = '--';
        centsEl.style.color = '';
    }
    if (activeLabel) activeLabel.textContent = 'Играйте струну';
    if (gauge) {
        gauge.style.removeProperty('--tuning-color');
        gauge.style.borderColor = '';
    }

    document.querySelectorAll('.string-row').forEach((row) => {
        row.classList.remove('string-row--active');
        row.style.borderColor = '';
        row.style.boxShadow = '';
    });
}

function updateHtmlFields(stringNumber, detectedHz, targetHz) {
    for (let i = 1; i <= 6; i++) {
        if (i !== parseInt(stringNumber, 10)) {
            const hzStr = document.getElementById(`hz-string${i}`);
            const diffStr = document.getElementById(`diff-string${i}`);
            if (hzStr) hzStr.innerText = '--';
            if (diffStr) diffStr.innerText = '--';
        }
    }

    const hzElement = document.getElementById(`hz-string${stringNumber}`);
    const diffElement = document.getElementById(`diff-string${stringNumber}`);

    if (hzElement && diffElement) {
        const difference = detectedHz - targetHz;
        hzElement.innerText = detectedHz.toFixed(1);
        diffElement.innerText = difference > 0 ? `+${difference.toFixed(1)} Hz` : `${difference.toFixed(1)} Hz`;
    }

    updateTunerVisual(stringNumber, detectedHz, targetHz);
}

function clearHtmlFields() {
    for (let i = 1; i <= 6; i++) {
        const hzStr = document.getElementById(`hz-string${i}`);
        const diffStr = document.getElementById(`diff-string${i}`);
        if (hzStr) hzStr.innerText = '--';
        if (diffStr) diffStr.innerText = '--';
    }
}
