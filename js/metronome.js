let audioCtx = null;
let isPlaying = false;
let nextTickTime = 0;
let beatCounter = 0;
let timerId = null;
let lastValidBpm = 120;
let metronomeBound = false;

const timeSignatures = {
    '2/4': { beatsPerMeasure: 2, strongBeats: [0] },
    '3/4': { beatsPerMeasure: 3, strongBeats: [0] },
    '4/4': { beatsPerMeasure: 4, strongBeats: [0] },
    '5/4': { beatsPerMeasure: 5, strongBeats: [0] },
    '6/8': { beatsPerMeasure: 6, strongBeats: [0] },
    // 7/8 as 3+2+2 — accent first beat of each group
    '7/8': { beatsPerMeasure: 7, strongBeats: [0, 3, 5] },
};

function playClick(time, beatIndex) {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    const currentSignature = document.getElementById('timeSelect').value;
    const config = timeSignatures[currentSignature];
    const beatInMeasure = beatIndex % config.beatsPerMeasure;
    const isStrong = config.strongBeats.includes(beatInMeasure);

    osc.type = 'sine';
    osc.frequency.value = isStrong ? 1000 : 500;

    const startVolume = isStrong ? 1.0 : 0.5;
    gain.gain.setValueAtTime(startVolume, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.05);
}

function scheduler() {
    if (!isPlaying) return;

    const secondsPerBeat = 60 / lastValidBpm;

    while (nextTickTime < audioCtx.currentTime + 0.2) {
        playClick(nextTickTime, beatCounter);
        beatCounter++;
        nextTickTime += secondsPerBeat;
    }
}

function startMetronome() {
    if (isPlaying) return;

    if (!audioCtx) audioCtx = new AudioContext();
    isPlaying = true;
    beatCounter = 0;
    nextTickTime = audioCtx.currentTime;
    timerId = setInterval(scheduler, 25);
}

function stopMetronome() {
    isPlaying = false;
    clearInterval(timerId);
    timerId = null;
}

function updateBpmDisplay(value) {
    const display = document.getElementById('metroBpmDisplay');
    if (display) display.textContent = value;
}

export function destroyMetronome() {
    stopMetronome();
    audioCtx?.close();
    audioCtx = null;
}

export function initMetronome() {
    if (metronomeBound) return;
    metronomeBound = true;

    const bpmSlider = document.getElementById('bpmSlider');
    const bpmInput = document.getElementById('bpmInput');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');

    updateBpmDisplay(lastValidBpm);

    startBtn.addEventListener('click', startMetronome);
    stopBtn.addEventListener('click', stopMetronome);

    bpmSlider.addEventListener('input', () => {
        bpmInput.value = bpmSlider.value;
        lastValidBpm = parseInt(bpmSlider.value, 10);
        updateBpmDisplay(lastValidBpm);
    });

    bpmInput.addEventListener('input', () => {
        const value = parseInt(bpmInput.value, 10);
        if (isNaN(value)) return;

        if (value >= 40 && value <= 240) {
            bpmSlider.value = value;
            lastValidBpm = value;
            updateBpmDisplay(lastValidBpm);
        }
    });

    bpmInput.addEventListener('change', () => {
        const value = parseInt(bpmInput.value, 10);
        if (isNaN(value) || value < 40 || value > 240) {
            bpmInput.value = lastValidBpm;
            bpmSlider.value = lastValidBpm;
            updateBpmDisplay(lastValidBpm);
        }
    });
}
