// ============================================================
//  STARE GLOBALĂ
// ============================================================
let isRunning = false;
let totalEnergy = 0;            // kWh
let simulatedMinutes = 0;

let fireModeActive = false;
let wasRunningBeforeFire = false;

let selectedFloorIndex = null;

let selectedScenarios = new Set();

let energyHistory = [{ min: 0, kwh: 0 }];

const speeds = [1, 5, 15, 60, 120];
let speedIndex = 0;
let timeMultiplier = speeds[speedIndex];
let floorsData = [];

// 🆕 Masă termică (inerție pereți) — factor care încetinește TOATE variațiile de temperatură
let thermalMass = 1.0;

// 🆕 Bug 3 fix: păstrează targeturile manuale când comuți pe Auto
let savedManualTargets = null;

// 🆕 Bug 5 fix: pauză la tab ascuns
let pausedByVisibility = false;

// 🆕 Limite fizice
const CO2_CAP = 5000;           // ppm — limită superioară (TLV)
const CO2_FLOOR = 400;          // ppm — minim natural
const THERMAL_MASS_DEFAULT = 1.0;

// ============================================================
//  DOM
// ============================================================
const buildingContainer = document.getElementById('building-container');
const inputFloors = document.getElementById('input-floors');
const inputArea = document.getElementById('input-area');
const inputThermal = document.getElementById('input-thermal');
const inputExtTemp = document.getElementById('input-ext-temp');
const inputInitTemp = document.getElementById('input-init-temp');
const inputThermalMass = document.getElementById('input-thermal-mass'); // 🆕
const simModeSelect = document.getElementById('sim-mode');

const displayEnergy = document.getElementById('total-energy');
const displayTime = document.getElementById('stat-time');
const displayInstantPower = document.getElementById('stat-instant-power');
const displayStatus = document.getElementById('stat-status');
const btnSpeedDown = document.getElementById('btn-speed-down');
const btnSpeedUp = document.getElementById('btn-speed-up');
const speedDisplay = document.getElementById('speed-display');
const btnStart = document.getElementById('btn-start');

const btnFire = document.getElementById('btn-fire');
const fireBanner = document.getElementById('fire-banner');
const btnFireCancel = document.getElementById('btn-fire-cancel');

const floorDetailPanel = document.getElementById('floor-detail-panel');

const btnHistory = document.getElementById('btn-history');
const modalHistory = document.getElementById('history-modal');
const btnCloseModal = document.getElementById('close-modal');
const historyBody = document.getElementById('history-body');

// ============================================================
//  UTILITARE
// ============================================================
inputThermal.addEventListener('input', (e) => {
    document.getElementById('val-thermal').innerText = e.target.value;
});

// 🆕 Listener masă termică (live, fără rebuild)
if (inputThermalMass) {
    inputThermalMass.value = THERMAL_MASS_DEFAULT;
    inputThermalMass.addEventListener('input', (e) => {
        thermalMass = parseFloat(e.target.value);
        document.getElementById('val-thermal-mass').innerText = thermalMass.toFixed(2);
        logEvent(`🧱 Masă termică setată la ${thermalMass.toFixed(2)}x`, 'info');
    });
}

function getValidNumber(inputEl, fallback, min = -100, max = 10000) {
    let val = parseFloat(inputEl.value);
    if (isNaN(val)) return fallback;
    return Math.max(min, Math.min(max, val));
}

// ============================================================
//  GENERARE CLĂDIRE
// ============================================================
function generateBuilding() {
    const rawFloors = parseFloat(inputFloors.value);
    const numFloors = Math.floor(getValidNumber(inputFloors, 3, 1, 30));

    if (!isNaN(rawFloors) && rawFloors > 30) {
        displayStatus.innerText = `⚠️ Maxim 30 etaje (ai introdus ${rawFloors})`;
        displayStatus.style.color = "#ff9f43";
        setTimeout(() => {
            if (!isRunning) {
                displayStatus.innerText = "Pauză";
                displayStatus.style.color = "#ff9f43";
            }
        }, 2500);
    }

    inputFloors.value = numFloors;
    const initTemp = getValidNumber(inputInitTemp, 10, -20, 50);
    inputInitTemp.value = initTemp;

    buildingContainer.innerHTML = '';
    floorsData = [];
    selectedFloorIndex = null;
    floorDetailPanel.classList.add('floor-panel-hidden');

    // Scaling dinamic
    const MAX_VISUAL_HEIGHT = 1400;
    const MIN_FLOOR_HEIGHT = 100;
    const MAX_FLOOR_HEIGHT = 200;
    const floorHeight = Math.max(
        MIN_FLOOR_HEIGHT,
        Math.min(MAX_FLOOR_HEIGHT, MAX_VISUAL_HEIGHT / numFloors)
    );

    buildingContainer.style.setProperty('--fh', floorHeight + 'px');

    const perspective = Math.max(2500, 1500 + numFloors * 120);
    document.getElementById('building-wrapper').style.perspective = perspective + 'px';

    const zOffset = -((numFloors - 1) * floorHeight);
    buildingContainer.style.transform =
        `rotateX(65deg) rotateZ(-40deg) translateZ(${zOffset}px)`;

    for (let i = 1; i <= numFloors; i++) {
        const floorDiv = document.createElement('div');
        floorDiv.className = 'floor-level';
        floorDiv.style.transform = `translateZ(${(i - 1) * floorHeight}px)`;

        floorDiv.innerHTML = `
            <div class="face-base" id="base-f${i}"></div>
            <div class="face-top"></div>
            <div class="face-front">
                <div class="f-header">
                    <div class="f-title">NIVEL ${i} <span style="color:#aaa; font-weight:normal; text-transform:none;">(<span id="power-f${i}">0.0</span>kW)</span></div>
                    <div class="f-co2" id="co2-f${i}">CO2: <span id="co2-val-f${i}">400</span> ppm</div>
                </div>
                <div class="f-temp" id="curr-temp-f${i}">${initTemp.toFixed(1)}°C</div>

                <div class="f-people">
                    <input type="checkbox" id="chk-occ-f${i}"> Ocupat
                    <input type="range" id="slider-occ-f${i}" min="0" max="50" value="10" disabled>
                    <span id="occ-val-f${i}">0</span>👤
                </div>

                <div class="f-target">
                    Țintă: <input type="number" id="target-f${i}" class="glass-input" value="22" step="0.5"> °C
                </div>

                <div class="local-exhaust" title="Evacuare Locală CO2">
                    <div class="exhaust-fan" id="exhaust-f${i}"></div>
                </div>
            </div>
            <div class="face-right">
                <div class="vent-grill"><div id="vent-air-f${i}" class="vent-air maintaining"></div></div>
            </div>
        `;
        buildingContainer.appendChild(floorDiv);

        floorDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            selectFloor(i - 1);
        });

        floorsData.push({
            level: i,
            currentTemp: initTemp,
            targetTemp: 22,
            hvacState: 'maintaining',
            lastPower: 0,
            co2: 400,
            hasPeople: false,
            peopleCount: 10,
            _prevHvac: 'maintaining',
            _prevCo2Level: 0
        });

        document.getElementById(`target-f${i}`).addEventListener('change', (e) => {
            if (simModeSelect.value !== 'auto') {
                floorsData[i - 1].targetTemp = getValidNumber(e.target, 22, 10, 35);
                e.target.value = floorsData[i - 1].targetTemp;
                if (selectedFloorIndex === i - 1) updateFloorDetailPanel(floorsData[i - 1]);
            }
        });

        const chk = document.getElementById(`chk-occ-f${i}`);
        const slider = document.getElementById(`slider-occ-f${i}`);
        const occVal = document.getElementById(`occ-val-f${i}`);

        chk.addEventListener('change', (e) => {
            floorsData[i - 1].hasPeople = e.target.checked;
            slider.disabled = !e.target.checked;
            occVal.innerText = e.target.checked ? slider.value : 0;
            document.getElementById(`base-f${i}`).classList.toggle('lights-on', e.target.checked);
            if (selectedFloorIndex === i - 1) updateFloorDetailPanel(floorsData[i - 1]);
        });

        slider.addEventListener('input', (e) => {
            floorsData[i - 1].peopleCount = parseInt(e.target.value);
            occVal.innerText = e.target.value;
            if (selectedFloorIndex === i - 1) updateFloorDetailPanel(floorsData[i - 1]);
        });
    }
}

// ============================================================
//  BUG 3 FIX — Mod simulare: salvează/restaurează targeturi manuale
// ============================================================
simModeSelect.addEventListener('change', (e) => {
    const isAuto = e.target.value === 'auto';

    // 🆕 Afișează/ascunde panoul auto
    document.getElementById('auto-config-panel').classList.toggle('hidden', !isAuto);

    logEvent(`Mod simulare: ${isAuto ? 'Auto (Optimizat)' : 'Manual'}`, 'info');

    if (isAuto) {
        autoConfig.isApplied = false;  // trebuie reaplicat
        document.getElementById('auto-status').innerText =
            'Configurează parametrii și apasă Aplică pentru a începe.';

        floorsData.forEach(floor => {
            const inputTarget = document.getElementById(`target-f${floor.level}`);
            inputTarget.readOnly = true;
        });
    } else {
        autoConfig.isApplied = false;
        floorsData.forEach(floor => {
            const inputTarget = document.getElementById(`target-f${floor.level}`);
            inputTarget.readOnly = false;
            // Restaurează targetul manual (dacă există)
            if (floor.targetTemp < 10 || floor.targetTemp > 35) {
                floor.targetTemp = 22;
                inputTarget.value = '22';
            }
        });
    }
});

// ============================================================
//  VITEZĂ
// ============================================================
function updateSpeedUI() {
    timeMultiplier = speeds[speedIndex];
    speedDisplay.innerText = `Viteză: ${timeMultiplier}x`;
    speedDisplay.style.color = timeMultiplier >= 60 ? '#ff9f43' : '#00ffcc';
    btnSpeedDown.disabled = speedIndex === 0;
    btnSpeedUp.disabled = speedIndex === speeds.length - 1;
}

btnSpeedUp.addEventListener('click', () => {
    if (speedIndex < speeds.length - 1) { speedIndex++; updateSpeedUI(); }
});
btnSpeedDown.addEventListener('click', () => {
    if (speedIndex > 0) { speedIndex--; updateSpeedUI(); }
});

function formatTime(mins) {
    const d = Math.floor(mins / (24 * 60));
    const h = Math.floor((mins % (24 * 60)) / 60);
    return `${d} Zile, ${h} Ore`;
}

// ============================================================
//  SELECȚIE ETAJ + PANOU 2D
// ============================================================
function selectFloor(index) {
    if (index < 0 || index >= floorsData.length) return;

    if (selectedFloorIndex !== null) {
        const prev = buildingContainer.children[selectedFloorIndex];
        if (prev) prev.classList.remove('selected');
    }

    selectedFloorIndex = index;
    const floorEl = buildingContainer.children[index];
    if (floorEl) floorEl.classList.add('selected');

    floorDetailPanel.classList.remove('floor-panel-hidden');
    document.getElementById('floor-detail-title').innerText = `NIVEL ${index + 1}`;
    updateFloorDetailPanel(floorsData[index]);
}

function deselectFloor() {
    if (selectedFloorIndex === null) return;
    const prev = buildingContainer.children[selectedFloorIndex];
    if (prev) prev.classList.remove('selected');
    selectedFloorIndex = null;
    floorDetailPanel.classList.add('floor-panel-hidden');
}

function updateFloorDetailPanel(floor) {
    if (!floor) return;

    const isFire = fireModeActive;
    const isAuto = simModeSelect.value === 'auto';

    document.getElementById('detail-temp').innerText = floor.currentTemp.toFixed(1) + '°C';
    document.getElementById('detail-co2').innerText = Math.round(floor.co2) + ' ppm';
    document.getElementById('detail-power').innerText = floor.lastPower.toFixed(2) + ' kW';

    const hvacLabels = {
        'heating': '🔥 Încălzește',
        'cooling': '❄ Răcește',
        'maintaining': '✋ Menține',
        'ventilating': '🌪 Ventilează'
    };
    document.getElementById('detail-hvac').innerText = hvacLabels[floor.hvacState] || floor.hvacState;

    const targetSlider = document.getElementById('detail-target');
    targetSlider.disabled = isFire || isAuto;
    targetSlider.value = floor.targetTemp;
    document.getElementById('detail-target-val').innerText = floor.targetTemp.toFixed(1);

    const occChk = document.getElementById('detail-occupied');
    occChk.disabled = isFire;
    occChk.checked = floor.hasPeople;

    const peopleSlider = document.getElementById('detail-people');
    peopleSlider.disabled = isFire || !floor.hasPeople;
    peopleSlider.value = floor.peopleCount;
    document.getElementById('detail-people-val').innerText = floor.hasPeople ? floor.peopleCount : 0;
}

document.getElementById('floor-detail-close').addEventListener('click', deselectFloor);

document.getElementById('detail-target').addEventListener('input', (e) => {
    if (selectedFloorIndex === null) return;
    const val = parseFloat(e.target.value);
    const floor = floorsData[selectedFloorIndex];
    floor.targetTemp = val;
    document.getElementById('detail-target-val').innerText = val.toFixed(1);
    const input3D = document.getElementById(`target-f${floor.level}`);
    if (input3D) input3D.value = val;
});

document.getElementById('detail-occupied').addEventListener('change', (e) => {
    if (selectedFloorIndex === null) return;
    const floor = floorsData[selectedFloorIndex];
    floor.hasPeople = e.target.checked;

    const level = floor.level;
    const chk3D = document.getElementById(`chk-occ-f${level}`);
    const slider3D = document.getElementById(`slider-occ-f${level}`);
    const occVal3D = document.getElementById(`occ-val-f${level}`);
    const baseEl = document.getElementById(`base-f${level}`);
    if (chk3D) chk3D.checked = e.target.checked;
    if (slider3D) slider3D.disabled = !e.target.checked;
    if (occVal3D) occVal3D.innerText = e.target.checked ? floor.peopleCount : 0;
    if (baseEl) baseEl.classList.toggle('lights-on', e.target.checked);

    updateFloorDetailPanel(floor);
});

document.getElementById('detail-people').addEventListener('input', (e) => {
    if (selectedFloorIndex === null) return;
    const floor = floorsData[selectedFloorIndex];
    floor.peopleCount = parseInt(e.target.value);
    document.getElementById('detail-people-val').innerText = floor.peopleCount;

    const slider3D = document.getElementById(`slider-occ-f${floor.level}`);
    const occVal3D = document.getElementById(`occ-val-f${floor.level}`);
    if (slider3D) slider3D.value = floor.peopleCount;
    if (occVal3D) occVal3D.innerText = floor.peopleCount;
});

document.addEventListener('click', (e) => {
    if (selectedFloorIndex === null) return;
    if (e.target.closest('.floor-level')) return;
    if (e.target.closest('#floor-detail-panel')) return;
    if (e.target.closest('button, input, select, label')) return;
    deselectFloor();
});

// ============================================================
//  LOG EVENIMENTE
// ============================================================
function logEvent(message, type = 'info') {
    const container = document.getElementById('event-log');
    if (!container) return;

    const timeStr = formatTime(simulatedMinutes);
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `<span class="log-time">${timeStr}</span>${message}`;
    container.appendChild(entry);

    while (container.children.length > 50) {
        container.removeChild(container.firstChild);
    }
    container.scrollTop = container.scrollHeight;
}

document.getElementById('btn-clear-log').addEventListener('click', () => {
    document.getElementById('event-log').innerHTML = '';
    logEvent('Log golit', 'info');
});

// ============================================================
//  MODAL CONFIRMARE
// ============================================================
function showConfirm({ title, body, okLabel = '✓ Confirmă', cancelLabel = 'Anulează' }) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-title');
        const bodyEl = document.getElementById('confirm-body');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');

        titleEl.innerText = title;
        bodyEl.innerHTML = body;
        okBtn.innerText = okLabel;
        cancelBtn.innerText = cancelLabel;
        modal.classList.remove('hidden');

        const cleanup = () => {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
        };
        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };
        const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
        const onKey = (e) => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter') onOk();
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
    });
}

// ============================================================
//  SIMULARE — cu thermal mass, transfer simetric, cap CO₂
// ============================================================
function simulationTick() {
    if (!isRunning) return;
    if (fireModeActive) return;

    const extTemp = getValidNumber(inputExtTemp, 5, -30, 50);
    const thermalLossCoeff = parseFloat(inputThermal.value);
    const areaMultiplier = getValidNumber(inputArea, 200, 50, 2000) / 100;
    const numFloors = floorsData.length;

    let tickEnergy = 0;
    let powerSumForTick = 0; // 🆕 Bug 7 fix: acumulează pentru medie

    for (let step = 0; step < timeMultiplier; step++) {
        simulatedMinutes += 1;
        // 🆕 Auto optimizer la fiecare 5 minute simulate
        if (simModeSelect.value === 'auto' && autoConfig.isApplied && simulatedMinutes % 5 === 0) {
            runAutoOptimizer();
        }

        // --------------------------------------------------
        // PASUL 1: Pierderi spre exterior + transfer vertical
        //         (aplicate pe copie, apoi comise — păstrează
        //          comportamentul original + thermal mass)
        // --------------------------------------------------
        const newTemps = floorsData.map(f => f.currentTemp);

        // (a) Pierderi pereți (parter 1.5x, ultimul etaj 1.3x)
        for (let i = 0; i < numFloors; i++) {
            const extFactor = i === 0 ? 1.5 : (i === numFloors - 1 ? 1.3 : 1.0);
            newTemps[i] += (thermalLossCoeff * (extTemp - floorsData[i].currentTemp) * extFactor) / thermalMass;
        }

        // (b) Transfer vertical — ASIMETRIC, DAR CU CONSERVARE DE ENERGIE
        //     k_up (0.02) = căldura urcă (convecție naturală)
        //     k_down (0.005) = căldura coboară (mult mai slab)
        for (let i = 0; i < numFloors - 1; i++) {
            const deltaT = floorsData[i].currentTemp - floorsData[i + 1].currentTemp;
            const k = deltaT > 0 ? 0.02 : 0.005;   // asimetrie intenționată
            const flow = (deltaT * k) / thermalMass;
            newTemps[i]     -= flow;   // pierde
            newTemps[i + 1] += flow;   // primește (conservare energie ✓)
        }

        for (let i = 0; i < numFloors; i++) floorsData[i].currentTemp = newTemps[i];

        // --------------------------------------------------
        // PASUL 2: HVAC + CO₂ + exhaust (per etaj)
        // --------------------------------------------------
        floorsData.forEach((floor) => {
            const currentOccupants = floor.hasPeople ? floor.peopleCount : 0;

            // Metabolism
            if (floor.hasPeople) {
                floor.co2 += currentOccupants * 1.5;
                floor.currentTemp += (currentOccupants * 0.0003) / thermalMass;
            } else {
                floor.co2 -= 0.5;
            }

            // --- Ventilator local CO₂ (P-controller cu saturație) ---
            floor.exhaustActive = false;
            let exhaustPower = 0;
            let ventTempDelta = 0;

                        // 🆕 În auto mode, exhaust doar în program sau pre-heating
            const _isAuto = simModeSelect.value === 'auto' && autoConfig.isApplied;
            const _allowExhaust = !_isAuto
                || isWorkTime()
                || (minutesUntilWork() <= autoConfig.preheatMinutes);

            if (floor.co2 > 600 && _allowExhaust) {
                floor.exhaustActive = true;
                const extractionEffort = Math.min(120, (floor.co2 - 500) * 0.1);
                floor.co2 -= extractionEffort;
                exhaustPower = (extractionEffort / 100) * 1.2 * areaMultiplier;
                ventTempDelta += (extTemp - floor.currentTemp) * (extractionEffort / 100) * 0.002;
            }

            // 🆕 Cap CO₂ (sus) + floor natural (jos)
            if (floor.co2 < CO2_FLOOR) floor.co2 = CO2_FLOOR;
            if (floor.co2 > CO2_CAP)   floor.co2 = CO2_CAP;

            // --- HVAC (intensitate continuă) ---
            const diff = floor.targetTemp - floor.currentTemp;
            const DEADBAND = 0.05;
            const FULL_POWER_AT = 0.55;

            let intensity = 0;
            if (diff > DEADBAND) {
                intensity = Math.min(1, (diff - DEADBAND) / FULL_POWER_AT);
            } else if (diff < -DEADBAND) {
                intensity = -Math.min(1, (-diff - DEADBAND) / FULL_POWER_AT);
            }

            if (floor.co2 > 1200 && Math.abs(intensity) < 0.3) {
                floor.hvacState = 'ventilating';
            } else if (intensity > 0.005) {
                floor.hvacState = 'heating';
            } else if (intensity < -0.005) {
                floor.hvacState = 'cooling';
            } else {
                floor.hvacState = 'maintaining';
            }

            let hvacPower = 0.1 * areaMultiplier; // standby

            if (intensity > 0) {
                floor.currentTemp += (0.15 * intensity) / thermalMass;
                hvacPower += 2.0 * areaMultiplier * intensity;
                floor.co2 -= 5 * intensity;
            } else if (intensity < 0) {
                floor.currentTemp += (0.10 * intensity) / thermalMass;
                hvacPower += 2.5 * areaMultiplier * (-intensity);
                floor.co2 -= 5 * (-intensity);
            } else if (floor.hvacState === 'ventilating') {
                hvacPower = 1.5 * areaMultiplier;
                floor.co2 -= 40;
                ventTempDelta += (extTemp - floor.currentTemp) * 0.01;
            }

            // Impact termic ventilație (plafonat ±0.15°C/min) + thermal mass
            ventTempDelta = Math.max(-0.15, Math.min(0.15, ventTempDelta));
            floor.currentTemp += ventTempDelta / thermalMass;

            // Putere totală etaj
            const totalFloorPower = hvacPower + exhaustPower;
            floor.lastPower = totalFloorPower;
            powerSumForTick += totalFloorPower;
            tickEnergy += totalFloorPower;

            // --- Log tranziții HVAC ---
            if (floor._prevHvac !== floor.hvacState) {
                const labels = {
                    heating: 'Încălzire', cooling: 'Răcire',
                    maintaining: 'Menținere', ventilating: 'Ventilare'
                };
                logEvent(`Etaj ${floor.level}: ${labels[floor._prevHvac]} → ${labels[floor.hvacState]}`, 'info');
                floor._prevHvac = floor.hvacState;
            }

            // --- Log praguri CO₂ ---
            const co2Level = floor.co2 > 1200 ? 2 : (floor.co2 > 1000 ? 1 : 0);
            if (co2Level === 1 && floor._prevCo2Level === 0) {
                logEvent(`Etaj ${floor.level}: CO2 > 1000 ppm`, 'warn');
            } else if (co2Level === 2 && floor._prevCo2Level !== 2) {
                logEvent(`Etaj ${floor.level}: CO2 critic > 1200 ppm`, 'danger');
            } else if (co2Level === 0 && floor._prevCo2Level > 0) {
                logEvent(`Etaj ${floor.level}: CO2 revenit la normal`, 'success');
            }
            floor._prevCo2Level = co2Level;
        });

        // Sample grafic la fiecare 30 min virtuale
        if (simulatedMinutes % 30 === 0) {
            const runningTotal = totalEnergy + tickEnergy / 60;
            energyHistory.push({ min: simulatedMinutes, kwh: runningTotal });
        }
    }

    // --------------------------------------------------
    // PASUL 3: Update UI (după toate iterațiile din tick)
    // --------------------------------------------------
    const currentInstantPower = powerSumForTick / timeMultiplier; // 🆕 medie pe tick

    displayTime.innerText = formatTime(simulatedMinutes);
    displayInstantPower.innerText = `${currentInstantPower.toFixed(2)} kW`;

    floorsData.forEach((floor) => {
        document.getElementById(`curr-temp-f${floor.level}`).innerText = `${floor.currentTemp.toFixed(1)}°C`;
        document.getElementById(`power-f${floor.level}`).innerText = floor.lastPower.toFixed(2);
        document.getElementById(`vent-air-f${floor.level}`).className = `vent-air ${floor.hvacState}`;

        const co2El = document.getElementById(`co2-f${floor.level}`);
        document.getElementById(`co2-val-f${floor.level}`).innerText = Math.round(floor.co2);
        co2El.classList.toggle('warning', floor.co2 > 1000);

        const exhaustEl = document.getElementById(`exhaust-f${floor.level}`);
        if (floor.exhaustActive) {
            exhaustEl.classList.add('active');
            if (floor.hasPeople && floor.peopleCount > 15) {
                exhaustEl.classList.add('fast');
            } else {
                exhaustEl.classList.remove('fast');
            }
        } else {
            exhaustEl.classList.remove('active', 'fast');
        }
    });

    if (selectedFloorIndex !== null && floorsData[selectedFloorIndex]) {
        updateFloorDetailPanel(floorsData[selectedFloorIndex]);
    }

    // 🆕 Sync panoul auto o dată per tick (nu per step)
    if (simModeSelect.value === 'auto' && autoConfig.isApplied) {
        syncAutoUI();
    }

    totalEnergy += tickEnergy / 60;
    displayEnergy.innerText = totalEnergy.toFixed(2);
}

// ============================================================
//  APLICĂ SETĂRI (reset complet — fix colateral inclus)
// ============================================================
document.getElementById('btn-apply-settings').addEventListener('click', () => {
    isRunning = false;
    btnStart.innerText = '▶ Start Simulare';
    btnStart.classList.remove('highlight');

    totalEnergy = 0;
    simulatedMinutes = 0;
    energyHistory = [{ min: 0, kwh: 0 }];
    displayEnergy.innerText = '0.00';
    displayTime.innerText = '0 Zile, 0 Ore';
    displayInstantPower.innerText = '0.00 kW';
    displayStatus.innerText = 'Pauză';
    displayStatus.style.color = '#ff9f43';

    generateBuilding();
    logEvent(`🏢 Clădire reconstruită: ${inputFloors.value} etaje, ${inputArea.value} m²`, 'info');
});

// ============================================================
//  BUG 2 FIX — temp inițială modificată
// ============================================================
inputInitTemp.addEventListener('change', () => {
    if (simulatedMinutes === 0 && !isRunning) {
        generateBuilding();
        logEvent('🌡 Temperatură inițială actualizată', 'info');
    } else {
        logEvent(`🌡 Temp. inițială modificată la ${inputInitTemp.value}°C — apasă "Aplică & Reconstruiește" pentru a aplica`, 'warn');
        displayStatus.innerText = '⚠️ Modificări neaplicate';
        displayStatus.style.color = '#ff9f43';
    }
});

// ============================================================
//  START / RESET
// ============================================================
btnStart.addEventListener('click', () => {
    if (simModeSelect.value === 'auto' && !autoConfig.isApplied) {
        alert('⚠️ Apasă mai întâi "Aplică Configurație" în panoul Auto!');
        return;
    }
    if (fireModeActive) {
        displayStatus.innerText = '🚨 Anulează incendiul întâi';
        displayStatus.style.color = '#ff4757';
        return;
    }
    isRunning = !isRunning;
    btnStart.innerText = isRunning ? '⏸ Pauză Simulare' : '▶ Start Simulare';
    btnStart.classList.toggle('highlight');
    displayStatus.innerText = isRunning ? 'Simulare Activă...' : 'Pauză';
    displayStatus.style.color = isRunning ? '#00ffcc' : '#ff9f43';
    logEvent(isRunning ? '▶ Simulare pornită' : '⏸ Simulare pe pauză', 'info');
});

document.getElementById('btn-reset').addEventListener('click', async () => {
    if (fireModeActive) deactivateFireMode();
    deselectFloor();
    const MIN_MINUTES_TO_SAVE = 60;

    if (simulatedMinutes >= MIN_MINUTES_TO_SAVE) {
        const ok = await showConfirm({
            title: '⚠️ Salvare Scenariu',
            body: `Simularea a rulat <b style="color:#00ffcc">${formatTime(simulatedMinutes)}</b> și a consumat <b style="color:#ff9f43">${totalEnergy.toFixed(2)} kWh</b>.<br><br>Dorești să salvezi acest scenariu în istoric înainte de resetare?`,
            okLabel: '💾 Salvează & Resetează',
            cancelLabel: 'Anulează'
        });
        if (!ok) return;
        saveToHistory();
    }

    isRunning = false;
    btnStart.innerText = '▶ Start Simulare';
    btnStart.classList.remove('highlight');
    totalEnergy = 0;
    simulatedMinutes = 0;
    energyHistory = [{ min: 0, kwh: 0 }];
    displayEnergy.innerText = '0.00';
    displayTime.innerText = '0 Zile, 0 Ore';
    displayInstantPower.innerText = '0.00 kW';
    displayStatus.innerText = 'Pauză';
    displayStatus.style.color = '#ff9f43';
    generateBuilding();
    logEvent('🔄 Scenariu resetat - simulare oprită', 'info');
});

// ============================================================
//  MODUL INCENDIU
// ============================================================
async function activateFireMode() {
    const ok = await showConfirm({
        title: '🚨 SIMULARE INCENDIU',
        body: 'Această acțiune va:<br>• <b>OPRI</b> toate sistemele HVAC<br>• <b>TĂIA</b> ventilația<br>• <b>DEBLOCA</b> ușile pentru evacuare<br>• <b>ÎNTRERUPE</b> curentul pe toate nivelurile<br><br><span style="color:#ff9f43">Simularea va fi pusă pe pauză.</span>',
        okLabel: '🚨 Declanșează',
        cancelLabel: 'Anulează'
    });
    if (!ok) return;

    fireModeActive = true;
    wasRunningBeforeFire = isRunning;
    isRunning = false;
    deselectFloor();

    if (selectedFloorIndex !== null && floorsData[selectedFloorIndex]) {
        updateFloorDetailPanel(floorsData[selectedFloorIndex]);
    }

    btnStart.innerText = '▶ Start Simulare';
    btnStart.classList.remove('highlight');
    displayStatus.innerText = '🚨 EVACUARE ACTIVĂ';
    displayStatus.style.color = '#ff4757';
    displayInstantPower.innerText = '0.00 kW';

    btnFire.classList.add('active');
    btnFire.innerText = '🚨 INCENDIU ACTIV';
    fireBanner.classList.remove('hidden');
    logEvent('🚨 SIMULARE INCENDIU ACTIVATĂ - Ventilație oprită, uși deblocate', 'danger');

    buildingContainer.classList.add('fire-mode');
    document.querySelectorAll('.floor-level').forEach(el => el.classList.add('fire-pulse'));
    document.querySelectorAll('.vent-air').forEach(el => el.classList.add('off'));
    document.querySelectorAll('.exhaust-fan').forEach(el => el.classList.add('off'));

    floorsData.forEach(floor => {
        floor.lastPower = 0;
        const powerEl = document.getElementById(`power-f${floor.level}`);
        if (powerEl) powerEl.innerText = '0.00';
    });
}

function deactivateFireMode() {
    fireModeActive = false;

    displayStatus.innerText = 'Pauză';
    displayStatus.style.color = '#ff9f43';

    btnFire.classList.remove('active');
    btnFire.innerText = '🚨 INCENDIU';
    fireBanner.classList.add('hidden');
    logEvent('Incendiu anulat - Sistemele revin la normal', 'success');

    buildingContainer.classList.remove('fire-mode');
    document.querySelectorAll('.floor-level').forEach(el => el.classList.remove('fire-pulse'));
    document.querySelectorAll('.vent-air').forEach(el => el.classList.remove('off'));
    document.querySelectorAll('.exhaust-fan').forEach(el => el.classList.remove('off'));

    if (wasRunningBeforeFire) {
        isRunning = true;
        btnStart.innerText = '⏸ Pauză Simulare';
        btnStart.classList.add('highlight');
        displayStatus.innerText = 'Simulare Activă...';
        displayStatus.style.color = '#00ffcc';
    }
    wasRunningBeforeFire = false;
}

btnFire.addEventListener('click', () => {
    if (fireModeActive) deactivateFireMode();
    else activateFireMode();
});
btnFireCancel.addEventListener('click', deactivateFireMode);

// ============================================================
//  ISTORIC & COMPARAȚII
// ============================================================
function saveToHistory() {
    let history = JSON.parse(localStorage.getItem('ecoTwinHistory')) || [];

    const occupancyMap = floorsData.map(f => f.hasPeople ? f.peopleCount : 0);
    const targetsMap = floorsData.map(f => f.targetTemp);

    const newRecord = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        date: new Date().toLocaleString('ro-RO'),
        mode: simModeSelect.value === 'auto' ? 'Auto (AI)' : 'Manual',
        time: formatTime(simulatedMinutes),
        timeMinutes: simulatedMinutes,
        energy: totalEnergy.toFixed(2) + ' kWh',
        energyValue: totalEnergy,
        settings: `${inputFloors.value} Etaje, ${inputArea.value} m²`,
        floors: parseInt(inputFloors.value),
        area: getValidNumber(inputArea, 200, 50, 2000),
        extTemp: getValidNumber(inputExtTemp, 5, -30, 50),
        initTemp: getValidNumber(inputInitTemp, 10, -20, 50),
        thermalCoeff: parseFloat(inputThermal.value),
        thermalMass: thermalMass, // 🆕 salvează și masa termică
        occupancyMap: occupancyMap,
        targetsMap: targetsMap,
        energySeries: energyHistory.slice()
    };

    history.unshift(newRecord);
    history = history.slice(0, 50);
    localStorage.setItem('ecoTwinHistory', JSON.stringify(history));
    logEvent(`💾 Scenariu salvat: ${totalEnergy.toFixed(2)} kWh`, 'success');
}

// 🆕 BUG 1 FIX — ștergere după ID, nu după index
window.deleteRecord = function(recId) {
    let history = JSON.parse(localStorage.getItem('ecoTwinHistory')) || [];
    const index = history.findIndex(r => r.id === recId);
    if (index === -1) {
        // Fallback pentru legacy fără id
        const legacyIdx = parseInt(String(recId).replace('legacy-', ''));
        if (isNaN(legacyIdx) || legacyIdx < 0 || legacyIdx >= history.length) return;
        history.splice(legacyIdx, 1);
        selectedScenarios.delete(recId);
    } else {
        history.splice(index, 1);
        selectedScenarios.delete(recId);
    }
    localStorage.setItem('ecoTwinHistory', JSON.stringify(history));
    renderHistory();
};

function renderHistory() {
    let history = JSON.parse(localStorage.getItem('ecoTwinHistory')) || [];
    historyBody.innerHTML = '';

    if (history.length === 0) {
        historyBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#aaa;">Nicio simulare salvată încă. Rulează o simulare și apasă Reset.</td></tr>';
        drawChart([]);
        return;
    }

    history.forEach((record, index) => {
        const recId = record.id || `legacy-${index}`;
        const hasSeries = record.energySeries && record.energySeries.length > 1;
        const isChecked = selectedScenarios.has(recId) ? 'checked' : '';
        const disabled = hasSeries ? '' : 'disabled title="Înregistrare veche - fără serie temporală"';
        const modeColor = record.mode === 'Auto (AI)' ? '#00ffcc' : 'white';

        const totalPeople = (record.occupancyMap || []).reduce((a, b) => a + b, 0);
        const peopleInfo = totalPeople > 0 ? `👥 ${totalPeople}` : '';
        const extTempInfo = record.extTemp !== undefined ? `🌡 ${record.extTemp}°C` : '';
        const massInfo = record.thermalMass && record.thermalMass !== 1 ? `🧱 ${record.thermalMass}x` : '';
        const extraInfo = [peopleInfo, extTempInfo, massInfo].filter(x => x).join(' · ');
        const settingsDisplay = extraInfo
            ? `${record.settings}<br><span style="font-size:0.78em; color:#888;">${extraInfo}</span>`
            : record.settings;

        historyBody.innerHTML += `
            <tr>
                <td style="text-align:center;">
                    <input type="checkbox" class="history-check" data-rec-id="${recId}" ${isChecked} ${disabled}>
                </td>
                <td>${record.date}</td>
                <td style="color: ${modeColor}; font-weight:bold;">${record.mode}</td>
                <td>${record.time}</td>
                <td style="color: #ff9f43; font-weight:bold;">${record.energy}</td>
                <td>${settingsDisplay}</td>
                <td style="text-align:center;">
                    <button class="btn-delete-row" onclick="deleteRecord('${recId}')" title="Șterge scenariu">🗑️</button>
                </td>
            </tr>
        `;
    });

    document.querySelectorAll('.history-check').forEach(chk => {
        chk.addEventListener('change', (e) => {
            const recId = e.target.dataset.recId;
            if (e.target.checked) {
                if (selectedScenarios.size >= 4) {
                    e.target.checked = false;
                    return;
                }
                selectedScenarios.add(recId);
            } else {
                selectedScenarios.delete(recId);
            }
            drawChart(history);
        });
    });

    drawChart(history);
}

// ============================================================
//  GRAFIC
// ============================================================
function formatChartTime(mins) {
    const h = Math.floor(mins / 60);
    if (h >= 24) return Math.floor(h / 24) + 'z ' + (h % 24) + 'h';
    return h + 'h';
}

function drawChart(history) {
    const canvas = document.getElementById('history-chart');
    const emptyEl = document.getElementById('chart-empty');
    const legendEl = document.getElementById('chart-legend');
    const ctx = canvas.getContext('2d');

    const selectedRecords = [];
    history.forEach((record, index) => {
        const recId = record.id || `legacy-${index}`;
        if (selectedScenarios.has(recId) && record.energySeries && record.energySeries.length > 1) {
            selectedRecords.push(record);
        }
    });

    legendEl.innerHTML = '';

    if (selectedRecords.length === 0) {
        canvas.style.display = 'none';
        emptyEl.style.display = 'block';
        return;
    }

    canvas.style.display = 'block';
    emptyEl.style.display = 'none';

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = 320;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const pad = { top: 20, right: 25, bottom: 40, left: 65 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    let maxTime = 0, maxKwh = 0;
    selectedRecords.forEach(r => {
        r.energySeries.forEach(p => {
            if (p.min > maxTime) maxTime = p.min;
            if (p.kwh > maxKwh) maxKwh = p.kwh;
        });
    });
    maxTime = Math.max(1, maxTime);
    maxKwh = Math.max(0.1, maxKwh * 1.1);

    const xScale = (min) => pad.left + (min / maxTime) * plotW;
    const yScale = (kwh) => pad.top + plotH - (kwh / maxKwh) * plotH;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(pad.left, pad.top, plotW, plotH);

    ctx.strokeStyle = 'rgba(0, 255, 204, 0.12)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#888';
    ctx.font = '11px Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= 5; i++) {
        const kwh = (maxKwh / 5) * i;
        const y = yScale(kwh);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
        ctx.fillText(kwh.toFixed(1) + ' kWh', pad.left - 8, y);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 5; i++) {
        const min = (maxTime / 5) * i;
        const x = xScale(min);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, h - pad.bottom);
        ctx.stroke();
        ctx.fillText(formatChartTime(min), x, h - pad.bottom + 8);
    }

    const colors = ['#00ffcc', '#ff9f43', '#9b59b6', '#2ecc71', '#e74c3c', '#3498db'];

    selectedRecords.forEach((record, idx) => {
        const color = colors[idx % colors.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;

        ctx.beginPath();
        record.energySeries.forEach((p, i) => {
            const x = xScale(p.min);
            const y = yScale(p.kwh);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;

        const last = record.energySeries[record.energySeries.length - 1];
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(xScale(last.min), yScale(last.kwh), 4, 0, Math.PI * 2);
        ctx.fill();

        legendEl.innerHTML += `
            <div class="legend-item">
                <div class="legend-swatch" style="background:${color}; box-shadow: 0 0 8px ${color};"></div>
                <span><b style="color:${color}">${record.mode}</b> · ${record.date.slice(0, 16)} · <b>${record.energy}</b></span>
            </div>
        `;
    });
}

window.addEventListener('resize', () => {
    if (!modalHistory.classList.contains('hidden')) {
        const history = JSON.parse(localStorage.getItem('ecoTwinHistory')) || [];
        drawChart(history);
    }
});

btnHistory.addEventListener('click', () => { renderHistory(); modalHistory.classList.remove('hidden'); });

document.getElementById('btn-clear-history').addEventListener('click', async () => {
    const ok = await showConfirm({
        title: '⚠️ Ștergere Istoric',
        body: `Sigur dorești să ștergi <b style="color:#ff4757">întregul istoric</b> de scenarii?<br>Această acțiune nu poate fi anulată.`,
        okLabel: '🗑️ Șterge tot',
        cancelLabel: 'Anulează'
    });
    if (!ok) return;
    localStorage.removeItem('ecoTwinHistory');
    selectedScenarios.clear();
    renderHistory();
});

btnCloseModal.addEventListener('click', () => { modalHistory.classList.add('hidden'); });
modalHistory.addEventListener('click', (e) => { if (e.target === modalHistory) modalHistory.classList.add('hidden'); });

// ============================================================
//  BUG 5 FIX — pauză la tab ascuns (reluare automată)
// ============================================================
document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRunning) {
        pausedByVisibility = true;
        isRunning = false;
        btnStart.innerText = '▶ Start Simulare';
        btnStart.classList.remove('highlight');
        displayStatus.innerText = '⏸ Pauză (tab ascuns)';
        displayStatus.style.color = '#ff9f43';
    } else if (!document.hidden && pausedByVisibility) {
        pausedByVisibility = false;
        isRunning = true;
        btnStart.innerText = '⏸ Pauză Simulare';
        btnStart.classList.add('highlight');
        displayStatus.innerText = 'Simulare Activă...';
        displayStatus.style.color = '#00ffcc';
        logEvent('▶ Simulare reluată (tab activ)', 'info');
    }
});

// ============================================================
//  BOOT
// ============================================================
// ============================================================
//  🤖 AUTO MODE — configurare + optimizator (MPC-lite)
// ============================================================
const autoConfig = {
    workStart: 8 * 60,          // 08:00 în minute
    workEnd: 18 * 60,           // 18:00
    workDays: [0, 1, 2, 3, 4],  // 0=Luni ... 6=Duminică
    tempMin: 20,
    tempMax: 24,
    setback: 16,
    preheatMinutes: 30,
    totalPeople: 30,
    peopleDist: 'uniform',
    isApplied: false
};

// --- Bind UI (o singură dată, la încărcare) ---
(function initAutoPanel() {
    const el = (id) => document.getElementById(id);

    const updateRangeLabel = () => {
        const min = parseFloat(el('auto-temp-min').value);
        const max = parseFloat(el('auto-temp-max').value);
        el('auto-range-val').innerText = `${min.toFixed(1)} – ${max.toFixed(1)} °C`;
    };
    el('auto-temp-min').addEventListener('input', updateRangeLabel);
    el('auto-temp-max').addEventListener('input', updateRangeLabel);

    el('auto-setback').addEventListener('input', (e) => {
        el('auto-setback-val').innerText = parseFloat(e.target.value).toFixed(1);
    });
    el('auto-preheat').addEventListener('input', (e) => {
        el('auto-preheat-val').innerText = e.target.value;
    });
    el('auto-people-total').addEventListener('input', (e) => {
        el('auto-people-val').innerText = e.target.value;
    });

    el('btn-apply-auto').addEventListener('click', applyAutoConfig);
})();

// --- Helpers timp virtual ---
function getSimDay() {
    return Math.floor(simulatedMinutes / (24 * 60)) % 7;
}
function getSimMinuteOfDay() {
    return simulatedMinutes % (24 * 60);
}
function isWorkTime(minuteAhead = 0) {
    const total = simulatedMinutes + minuteAhead;
    const day = Math.floor(total / (24 * 60)) % 7;
    const min = total % (24 * 60);
    if (!autoConfig.workDays.includes(day)) return false;
    return min >= autoConfig.workStart && min < autoConfig.workEnd;
}
function minutesUntilWork() {
    for (let m = 1; m < 7 * 24 * 60; m++) {
        if (isWorkTime(m)) return m;
    }
    return Infinity;
}

// --- Distribuție persoane pe etaje ---
function distributePeople() {
    const n = floorsData.length;
    const total = autoConfig.totalPeople;

    floorsData.forEach(f => { f.hasPeople = false; f.peopleCount = 0; });
    if (total <= 0) return;

    const setFloor = (idx, count) => {
        if (idx >= 0 && idx < n) {
            floorsData[idx].peopleCount = count;
            floorsData[idx].hasPeople = count > 0;
        }
    };

    if (autoConfig.peopleDist === 'uniform') {
        const perFloor = Math.floor(total / n);
        const rem = total % n;
        floorsData.forEach((f, i) => {
            f.peopleCount = perFloor + (i < rem ? 1 : 0);
            f.hasPeople = f.peopleCount > 0;
        });
    } else if (autoConfig.peopleDist === 'bottom') {
        const main = Math.floor(total * 0.6);
        setFloor(0, main);
        const rest = total - main;
        const perFloor = Math.floor(rest / Math.max(1, n - 1));
        for (let i = 1; i < n; i++) setFloor(i, perFloor);
    } else if (autoConfig.peopleDist === 'top') {
        const main = Math.floor(total * 0.6);
        setFloor(n - 1, main);
        const rest = total - main;
        const perFloor = Math.floor(rest / Math.max(1, n - 1));
        for (let i = 0; i < n - 1; i++) setFloor(i, perFloor);
    } else if (autoConfig.peopleDist === 'middle') {
        const mid = Math.floor(n / 2);
        const main = Math.floor(total * 0.6);
        setFloor(mid, main);
        const rest = total - main;
        const perFloor = Math.floor(rest / Math.max(1, n - 1));
        for (let i = 0; i < n; i++) if (i !== mid) setFloor(i, perFloor);
    }
}

// --- Calculează targetTemp pentru un etaj în program ---
function computeComfortTarget(floor, floorIndex) {
    // Bandă confort: heat până la lowTarget, cool peste tempMax
    let lowTarget = autoConfig.tempMin;

    // Căldură metabolică → poți coborî ușor sub tempMin
    if (floor.hasPeople) {
        lowTarget -= Math.min(1.5, (floor.peopleCount / 20) * 0.3);
    } else {
        lowTarget -= 0.5;
    }

    // Transfer de la etajele de dedesubt
    let heatFromBelow = 0;
    for (let j = 0; j < floorIndex; j++) {
        if (floorsData[j].currentTemp > floor.currentTemp + 0.5) {
            heatFromBelow += 0.3;
        }
    }
    lowTarget -= Math.min(1, heatFromBelow);
    lowTarget = Math.max(autoConfig.tempMin - 1, lowTarget);

    // Decizie
    if (floor.currentTemp < lowTarget - 0.1) return lowTarget;    // heat
    if (floor.currentTemp > autoConfig.tempMax) return autoConfig.tempMax;  // cool
    return floor.currentTemp;   // în bandă → deadband (fără acțiune)
}

// --- Optimizatorul propriu-zis (chemat periodic din tick) ---
function runAutoOptimizer() {
    if (simModeSelect.value !== 'auto') return;
    if (!autoConfig.isApplied) return;

    const inWork = isWorkTime();
    const minsToWork = minutesUntilWork();
    const inPreheat = !inWork && minsToWork <= autoConfig.preheatMinutes;

    // 1. Persoane
    if (inWork) {
        distributePeople();
    } else {
        floorsData.forEach(f => { f.hasPeople = false; f.peopleCount = 0; });
    }

    // 2. Target per etaj (fără DOM — doar date)
    floorsData.forEach((floor, i) => {
        if (inWork) {
            floor.targetTemp = computeComfortTarget(floor, i);
        } else if (inPreheat) {
            const progress = 1 - (minsToWork / autoConfig.preheatMinutes);
            floor.targetTemp = autoConfig.setback +
                (autoConfig.tempMin - autoConfig.setback) * progress;
        } else {
            floor.targetTemp = autoConfig.setback;
        }
    });
}

// --- Sync UI (o dată per tick, nu per step) ---
function syncAutoUI() {
    floorsData.forEach(floor => {
        const inputEl = document.getElementById(`target-f${floor.level}`);
        if (inputEl) inputEl.value = floor.targetTemp.toFixed(1);

        const chk = document.getElementById(`chk-occ-f${floor.level}`);
        const slider = document.getElementById(`slider-occ-f${floor.level}`);
        const val = document.getElementById(`occ-val-f${floor.level}`);
        const base = document.getElementById(`base-f${floor.level}`);
        if (chk) chk.checked = floor.hasPeople;
        if (slider) { slider.value = floor.peopleCount; slider.disabled = true; }
        if (val) val.innerText = floor.hasPeople ? floor.peopleCount : 0;
        if (base) base.classList.toggle('lights-on', floor.hasPeople);
    });

    if (selectedFloorIndex !== null && floorsData[selectedFloorIndex]) {
        updateFloorDetailPanel(floorsData[selectedFloorIndex]);
    }
}

// --- Citește config din UI ---
function readAutoConfigFromUI() {
    const el = (id) => document.getElementById(id);
    const parseTime = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

    autoConfig.workStart = parseTime(el('auto-work-start').value);
    autoConfig.workEnd = parseTime(el('auto-work-end').value);

    autoConfig.workDays = [];
    document.querySelectorAll('.day-chk input').forEach(chk => {
        if (chk.checked) autoConfig.workDays.push(parseInt(chk.dataset.day));
    });

    autoConfig.tempMin = parseFloat(el('auto-temp-min').value);
    autoConfig.tempMax = parseFloat(el('auto-temp-max').value);
    autoConfig.setback = parseFloat(el('auto-setback').value);
    autoConfig.preheatMinutes = parseInt(el('auto-preheat').value);
    autoConfig.totalPeople = parseInt(el('auto-people-total').value);
    autoConfig.peopleDist = el('auto-people-dist').value;
}

// --- Aplică config + reset simulare ---
function applyAutoConfig() {
    readAutoConfigFromUI();

    if (autoConfig.workStart >= autoConfig.workEnd) {
        alert('⚠️ Ora de sfârșit trebuie să fie după ora de început!');
        return;
    }
    if (autoConfig.tempMin >= autoConfig.tempMax) {
        alert('⚠️ Temperatura minimă trebuie să fie sub temperatura maximă!');
        return;
    }
    if (autoConfig.workDays.length === 0) {
        alert('⚠️ Selectează cel puțin o zi lucrătoare!');
        return;
    }

    autoConfig.isApplied = true;

    // Reset simulare
    isRunning = false;
    btnStart.innerText = '▶ Start Simulare';
    btnStart.classList.remove('highlight');
    totalEnergy = 0;
    simulatedMinutes = 0;
    energyHistory = [{ min: 0, kwh: 0 }];
    displayEnergy.innerText = '0.00';
    displayTime.innerText = '0 Zile, 0 Ore';
    displayInstantPower.innerText = '0.00 kW';
    displayStatus.innerText = '✅ Auto configurat — gata de start';
    displayStatus.style.color = '#00ffcc';

    generateBuilding();
    runAutoOptimizer();
    syncAutoUI();

    const sH = Math.floor(autoConfig.workStart / 60);
    const sM = String(autoConfig.workStart % 60).padStart(2, '0');
    const eH = Math.floor(autoConfig.workEnd / 60);
    const eM = String(autoConfig.workEnd % 60).padStart(2, '0');
    const startStr = `${sH}:${sM}`;
    const endStr = `${eH}:${eM}`;

    document.getElementById('auto-status').innerHTML =
        `✅ Configurat: <b style="color:#00ffcc;">${startStr}–${endStr}</b> · ` +
        `${autoConfig.totalPeople} persoane · confort ${autoConfig.tempMin}–${autoConfig.tempMax}°C`;

    logEvent(`🤖 Auto configurat: program ${startStr}–${endStr}, ${autoConfig.totalPeople} persoane, confort ${autoConfig.tempMin}–${autoConfig.tempMax}°C`, 'success');
}


setInterval(simulationTick, 100);
generateBuilding();
logEvent('✓ Sistem inițializat - 3 etaje, 200 m²', 'success');