let isRunning = false;
let totalEnergy = 0; // kWh
let simulatedMinutes = 0;

let fireModeActive = false;
let wasRunningBeforeFire = false;

let selectedFloorIndex = null;

let selectedScenarios = new Set();  // IDs de scenarii bifate pentru grafic

let energyHistory = [{ min: 0, kwh: 0 }];

const speeds = [1, 5, 15, 60, 120]; 
let speedIndex = 0;
let timeMultiplier = speeds[speedIndex];
let floorsData = [];

// DOM References
const buildingContainer = document.getElementById('building-container');
const inputFloors = document.getElementById('input-floors');
const inputArea = document.getElementById('input-area');
const inputThermal = document.getElementById('input-thermal');
const inputExtTemp = document.getElementById('input-ext-temp');
const inputInitTemp = document.getElementById('input-init-temp');
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

inputThermal.addEventListener('input', (e) => { document.getElementById('val-thermal').innerText = e.target.value; });

function getValidNumber(inputEl, fallback, min = -100, max = 10000) {
    let val = parseFloat(inputEl.value);
    if (isNaN(val)) return fallback;
    return Math.max(min, Math.min(max, val));
}

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
    // Reset selecție la reconstrucție
    selectedFloorIndex = null;
    floorDetailPanel.classList.add('floor-panel-hidden');
        // === SCALING DINAMIC ===
    // 1-7 etaje: păstrează 200px/etaj (aspect actual)
    // Peste 7: scade progresiv până la 100px/etaj (minim lizibil)
    const MAX_VISUAL_HEIGHT = 1400;
    const MIN_FLOOR_HEIGHT = 100;
    const MAX_FLOOR_HEIGHT = 200;
    const floorHeight = Math.max(
        MIN_FLOOR_HEIGHT,
        Math.min(MAX_FLOOR_HEIGHT, MAX_VISUAL_HEIGHT / numFloors)
    );

    // Setează variabila CSS (moștenită de toate fețele)
    buildingContainer.style.setProperty('--fh', floorHeight + 'px');

    // Ajustează perspectiva proporțional (clădiri înalte = perspectivă mai mare)
    const perspective = Math.max(2500, 1500 + numFloors * 120);
    document.getElementById('building-wrapper').style.perspective = perspective + 'px';

    const zOffset = -((numFloors - 1) * floorHeight);
    buildingContainer.style.transform = `rotateX(65deg) rotateZ(-40deg) translateZ(${zOffset}px)`;

    for (let i = 1; i <= numFloors; i++) {
        const floorDiv = document.createElement('div');
        floorDiv.className = 'floor-level';
        floorDiv.style.transform = `translateZ(${ (i - 1) * floorHeight }px)`;
        
        // În interiorul buclei for din generateBuilding():
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
                    <input type="range" id="slider-occ-f${i}" min="1" max="50" value="10" disabled>
                    <span id="occ-val-f${i}">0</span>👤
                </div>

                <div class="f-target">
                    Țintă: <input type="number" id="target-f${i}" class="glass-input" value="22" step="0.5"> °C
                </div>
                
                <!-- NOU: Ventilator local de evacuare CO2 -->
                <div class="local-exhaust" title="Evacuare Locală CO2">
                    <div class="exhaust-fan" id="exhaust-f${i}"></div>
                </div>
            </div>
            <div class="face-right">
                <div class="vent-grill"><div id="vent-air-f${i}" class="vent-air maintaining"></div></div>
            </div>
        `;
        buildingContainer.appendChild(floorDiv);

        // Click pe etaj → selectează
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
                floorsData[i-1].targetTemp = getValidNumber(e.target, 22, 10, 35);
                e.target.value = floorsData[i-1].targetTemp;
                if (selectedFloorIndex === i - 1) updateFloorDetailPanel(floorsData[i-1]);
            }
        });

        const chk = document.getElementById(`chk-occ-f${i}`);
        const slider = document.getElementById(`slider-occ-f${i}`);
        const occVal = document.getElementById(`occ-val-f${i}`);

        chk.addEventListener('change', (e) => {
            floorsData[i-1].hasPeople = e.target.checked;
            slider.disabled = !e.target.checked;
            occVal.innerText = e.target.checked ? slider.value : 0;
            document.getElementById(`base-f${i}`).classList.toggle('lights-on', e.target.checked);
            if (selectedFloorIndex === i - 1) updateFloorDetailPanel(floorsData[i-1]);
        });

        slider.addEventListener('input', (e) => {
            floorsData[i-1].peopleCount = parseInt(e.target.value);
            occVal.innerText = e.target.value;
            if (selectedFloorIndex === i - 1) updateFloorDetailPanel(floorsData[i-1]);  
        });
    }
}

simModeSelect.addEventListener('change', (e) => {
    const isAuto = e.target.value === 'auto';
    logEvent(`Mod simulare: ${isAuto ? 'Auto (AI)' : 'Manual'}`, 'info');
    floorsData.forEach(floor => {
        const inputTarget = document.getElementById(`target-f${floor.level}`);
        inputTarget.readOnly = isAuto;
        if(isAuto) {
            floor.targetTemp = 21 + (floor.level * 0.5);
            inputTarget.value = floor.targetTemp.toFixed(1);
        }
    });
});

// Funcție pentru actualizarea interfeței de viteză
function updateSpeedUI() {
    timeMultiplier = speeds[speedIndex];
    speedDisplay.innerText = `Viteză: ${timeMultiplier}x`;
    speedDisplay.style.color = timeMultiplier >= 60 ? '#ff9f43' : '#00ffcc';
    
    // Dezactivăm săgețile dacă am ajuns la limite
    btnSpeedDown.disabled = speedIndex === 0;
    btnSpeedUp.disabled = speedIndex === speeds.length - 1;
}

// Săgeata Dreapta (Mai repede)
btnSpeedUp.addEventListener('click', () => {
    if (speedIndex < speeds.length - 1) {
        speedIndex++;
        updateSpeedUI();
    }
});

// Săgeata Stânga (Mai încet)
btnSpeedDown.addEventListener('click', () => {
    if (speedIndex > 0) {
        speedIndex--;
        updateSpeedUI();
    }
});

function formatTime(mins) {
    const d = Math.floor(mins / (24 * 60));
    const h = Math.floor((mins % (24 * 60)) / 60);
    return `${d} Zile, ${h} Ore`;
}

// === SELECȚIE ETaj + PANOU 2D ===
function selectFloor(index) {
    if (index < 0 || index >= floorsData.length) return;

    // Scoate highlight-ul de pe etajul anterior
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

// --- Handlere panou → floorsData + sync 3D ---
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

// --- Deselectare la click pe fundal ---
document.addEventListener('click', (e) => {
    if (selectedFloorIndex === null) return;
    if (e.target.closest('.floor-level')) return;
    if (e.target.closest('#floor-detail-panel')) return;
    if (e.target.closest('button, input, select, label')) return;
    deselectFloor();
});

// === LOG EVENIMENTE ===
function logEvent(message, type = 'info') {
    const container = document.getElementById('event-log');
    if (!container) return;
    
    const timeStr = formatTime(simulatedMinutes);
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `<span class="log-time">${timeStr}</span>${message}`;
    container.appendChild(entry);
    
    // Cap la 50 intrări
    while (container.children.length > 50) {
        container.removeChild(container.firstChild);
    }
    
    // Auto-scroll la ultima
    container.scrollTop = container.scrollHeight;
}

document.getElementById('btn-clear-log').addEventListener('click', () => {
    document.getElementById('event-log').innerHTML = '';
    logEvent('Log golit', 'info');
});

// === MODAL CONFIRMARE REUTILIZABIL ===
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

function simulationTick() {
    if (!isRunning) return;
    if (fireModeActive) return;
    const extTemp = getValidNumber(inputExtTemp, 5, -30, 50);
    const thermalLossCoeff = parseFloat(inputThermal.value); 
    const areaMultiplier = getValidNumber(inputArea, 200, 50, 2000) / 100; 
    const numFloors = floorsData.length;
    
    let tickEnergy = 0; 
    let currentInstantPower = 0; 

    for (let step = 0; step < timeMultiplier; step++) {
        simulatedMinutes += 1;
        currentInstantPower = 0; 
        
        // 1. TRANSFER TERMIC REPARAT (Mai echilibrat)
        let newTemps = floorsData.map(f => f.currentTemp);
        
        for (let i = 0; i < numFloors; i++) {
            let floor = floorsData[i];
            
            let extLoss = thermalLossCoeff * (i === 0 ? 1.5 : 1.0);
            newTemps[i] += (extTemp - floor.currentTemp) * extLoss;

            // Transfer termic vertical
            if (i > 0) {
                let tempBelow = floorsData[i-1].currentTemp;
                if (tempBelow > floor.currentTemp) {
                    newTemps[i] += (tempBelow - floor.currentTemp) * 0.02; 
                    newTemps[i-1] -= (tempBelow - floor.currentTemp) * 0.02; 
                }
            }
            if (i < numFloors - 1) {
                let tempAbove = floorsData[i+1].currentTemp;
                newTemps[i] += (tempAbove - floor.currentTemp) * 0.005;
            }
        }
        
        for (let i = 0; i < numFloors; i++) floorsData[i].currentTemp = newTemps[i];

        // 2. METABOLISM & CONTROL SEPARAT (HVAC vs EVACUARE LOCALĂ)
    floorsData.forEach((floor) => {
    
    let currentOccupants = floor.hasPeople ? floor.peopleCount : 0;

    // Oamenii generează CO2 și căldură
    if (floor.hasPeople) {
        floor.co2 += currentOccupants * 1.5; 
        floor.currentTemp += currentOccupants * 0.0003;
    } else {
        floor.co2 -= 0.5; // Scădere naturală (aerisire pasivă)
    }

    // A. Logica Ventilatorului Local (Evacuare CO2 - INTELIGENTĂ ȘI DINAMICĂ)
    floor.exhaustActive = false;
    let exhaustPower = 0;
    let ventTempDelta = 0; // acumulator: impactul termic al ventilației (exhaust + ventilating)

    if (floor.co2 > 600) { 
        floor.exhaustActive = true;
        
        // Turație Variabilă: cu cât e mai mare CO2, cu atât trage mai tare.
        let extractionEffort = Math.min(120, (floor.co2 - 500) * 0.1); 
        
        floor.co2 -= extractionEffort; 
        
        // D7: Putere maximă redusă de la 2.5 kW → 1.2 kW (raportat la areaMultiplier=1)
        exhaustPower = (extractionEffort / 100) * 1.2 * areaMultiplier; 
        
        // Impact termic acumulat (va fi plafonat mai jos)
        ventTempDelta += (extTemp - floor.currentTemp) * (extractionEffort / 100) * 0.005;
    }
    if (floor.co2 < 400) floor.co2 = 400;

        // B. Logica Termică (HVAC - INTENSITATE CONTINUĂ, fără salturi la prag)
    let diff = floor.targetTemp - floor.currentTemp;
    const DEADBAND = 0.05;    // sub această abatere, HVAC stă pe standby
    const FULL_POWER_AT = 0.55; // intensitate 100% la 0.05+0.55=0.60°C abatere

    // Intensitate continuă: 0 la prag, crește liniar, saturație la 1
    let intensity = 0;
    if (diff > DEADBAND) {
        intensity = Math.min(1, (diff - DEADBAND) / FULL_POWER_AT);
    } else if (diff < -DEADBAND) {
        intensity = -Math.min(1, (-diff - DEADBAND) / FULL_POWER_AT);
    }

    // Stare doar pentru feedback vizual (culoare, animație)
    if (floor.co2 > 1200 && Math.abs(intensity) < 0.3) {
        floor.hvacState = 'ventilating';
    } else if (intensity > 0.005) {
        floor.hvacState = 'heating';
    } else if (intensity < -0.005) {
        floor.hvacState = 'cooling';
    } else {
        floor.hvacState = 'maintaining';
    }

    // Putere proporțională (0% la prag, 100% la 0.6°C abatere)
    let hvacPower = 0.1 * areaMultiplier; // Standby

    if (intensity > 0) {
        floor.currentTemp += 0.08 * intensity;
        hvacPower += 2.0 * areaMultiplier * intensity;
        floor.co2 -= 5 * intensity;
    } else if (intensity < 0) {
        floor.currentTemp += 0.08 * intensity;   // negative → răcește
        hvacPower += 2.5 * areaMultiplier * (-intensity);
        floor.co2 -= 5 * (-intensity);
    } else if (floor.hvacState === 'ventilating') {
        hvacPower = 1.5 * areaMultiplier;
        floor.co2 -= 40;
        ventTempDelta += (extTemp - floor.currentTemp) * 0.01;
    }

    // D12: Plafonare impact termic ventilație la ±0.15°C/min
    // Previne înghețul/supraîncălzirea când extTemp e la extreme (-30°C / +40°C)
    ventTempDelta = Math.max(-0.15, Math.min(0.15, ventTempDelta));
    floor.currentTemp += ventTempDelta;

    // C. Calcul Putere Totală pe Etaj
    let totalFloorPower = hvacPower + exhaustPower;
    floor.lastPower = totalFloorPower; 
    currentInstantPower += totalFloorPower;
    tickEnergy += totalFloorPower; 

                // === LOG: Tranziții HVAC ===
            if (floor._prevHvac !== floor.hvacState) {
                const labels = { 
                    heating: 'Încălzire', 
                    cooling: 'Răcire', 
                    maintaining: 'Menținere', 
                    ventilating: 'Ventilare' 
                };
                logEvent(
                    `Etaj ${floor.level}: ${labels[floor._prevHvac]} → ${labels[floor.hvacState]}`, 
                    'info'
                );
                floor._prevHvac = floor.hvacState;
            }

            // === LOG: Praguri CO2 ===
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

    // D9: Sample serie temporală la fiecare 30 min virtuale
        if (simulatedMinutes % 30 === 0) {
            const runningTotal = totalEnergy + tickEnergy / 60;
            energyHistory.push({ min: simulatedMinutes, kwh: runningTotal });
        }
    }

    // 3. UPDATE UI LENT
    displayTime.innerText = formatTime(simulatedMinutes);
    displayInstantPower.innerText = `${currentInstantPower.toFixed(2)} kW`;
    
    floorsData.forEach((floor) => {
        document.getElementById(`curr-temp-f${floor.level}`).innerText = `${floor.currentTemp.toFixed(1)}°C`;
        document.getElementById(`power-f${floor.level}`).innerText = floor.lastPower.toFixed(2);
        document.getElementById(`vent-air-f${floor.level}`).className = `vent-air ${floor.hvacState}`;
        
        // Update CO2 UI
        let co2El = document.getElementById(`co2-f${floor.level}`);
        document.getElementById(`co2-val-f${floor.level}`).innerText = Math.round(floor.co2);
        if (floor.co2 > 1000) co2El.classList.add('warning');
        else co2El.classList.remove('warning');

        // NOU: Update Ventilator Local
        let exhaustEl = document.getElementById(`exhaust-f${floor.level}`);
        if (floor.exhaustActive) {
            exhaustEl.classList.add('active');
            if (floor.hasPeople && floor.peopleCount > 15) {
                exhaustEl.classList.add('fast'); // Se învârte mai repede dacă-s mulți oameni
            } else {
                exhaustEl.classList.remove('fast');
            }
        } else {
            exhaustEl.classList.remove('active', 'fast');
        }
    });

        // Update panou detalii dacă e deschis
    if (selectedFloorIndex !== null && floorsData[selectedFloorIndex]) {
        updateFloorDetailPanel(floorsData[selectedFloorIndex]);
    }

    totalEnergy += (tickEnergy) / 60; 
    displayEnergy.innerText = totalEnergy.toFixed(2);
}

document.getElementById('btn-apply-settings').addEventListener('click', () => {
    energyHistory = [{ min: 0, kwh: 0 }];
    generateBuilding();
    logEvent(`🏢 Clădire reconstruită: ${inputFloors.value} etaje, ${inputArea.value} m²`, 'info');
});

btnStart.addEventListener('click', () => {
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
    deselectFloor(); // închide panoul dacă era deschis
    const MIN_MINUTES_TO_SAVE = 60;

    if (simulatedMinutes >= MIN_MINUTES_TO_SAVE) {
        const ok = await showConfirm({
            title: '⚠️ Salvare Scenariu',
            body: `Simularea a rulat <b style="color:#00ffcc">${formatTime(simulatedMinutes)}</b> și a consumat <b style="color:#ff9f43">${totalEnergy.toFixed(2)} kWh</b>.<br><br>` +
                  `Dorești să salvezi acest scenariu în istoric înainte de resetare?`,
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
    energyHistory = [{ min: 0, kwh: 0 }]; // reset serie temporală
    displayEnergy.innerText = "0.00";
    displayTime.innerText = "0 Zile, 0 Ore";
    displayInstantPower.innerText = "0.00 kW";
    displayStatus.innerText = "Pauză";
    displayStatus.style.color = "#ff9f43";
    generateBuilding();
    logEvent('🔄 Scenariu resetat - simulare oprită', 'info');
});

// === MODUL INCENDIU ===
async function activateFireMode() {
    const ok = await showConfirm({
        title: '🚨 SIMULARE INCENDIU',
        body: 'Această acțiune va:<br>' +
              '• <b>OPRI</b> toate sistemele HVAC<br>' +
              '• <b>TĂIA</b> ventilația (pentru a nu alimenta focul)<br>' +
              '• <b>DEBLOCA</b> ușile pentru evacuare<br>' +
              '• <b>ÎNTRERUPE</b> curentul pe toate nivelurile<br><br>' +
              '<span style="color:#ff9f43">Simularea va fi pusă pe pauză.</span>',
        okLabel: '🚨 Declanșează',
        cancelLabel: 'Anulează'
    });
    if (!ok) return;

    fireModeActive = true;
    wasRunningBeforeFire = isRunning;
    isRunning = false;
    deselectFloor();  // ascunde panoul 2D în timpul urgenței

        // Menținem panoul deschis, dar îl actualizăm să reflecte starea de urgență
    if (selectedFloorIndex !== null && floorsData[selectedFloorIndex]) {
        updateFloorDetailPanel(floorsData[selectedFloorIndex]);
    }

    // UI general
    btnStart.innerText = '▶ Start Simulare';
    btnStart.classList.remove('highlight');
    displayStatus.innerText = '🚨 EVACUARE ACTIVĂ';
    displayStatus.style.color = '#ff4757';
    displayInstantPower.innerText = '0.00 kW';

    btnFire.classList.add('active');
    btnFire.innerText = '🚨 INCENDIU ACTIV';
    fireBanner.classList.remove('hidden');
    logEvent('🚨 SIMULARE INCENDIU ACTIVATĂ - Ventilație oprită, uși deblocate', 'danger');

    // Vizual pe clădire
    buildingContainer.classList.add('fire-mode');
    document.querySelectorAll('.floor-level').forEach(el => el.classList.add('fire-pulse'));
    document.querySelectorAll('.vent-air').forEach(el => el.classList.add('off'));
    document.querySelectorAll('.exhaust-fan').forEach(el => el.classList.add('off'));

    // Forțează afișarea 0 kW pe fiecare etaj
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

    // Reia simularea dacă rula înainte de incendiu
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

// === LOGICA PENTRU ISTORIC & COMPARAȚII ===
function saveToHistory() {
    let history = JSON.parse(localStorage.getItem('ecoTwinHistory')) || [];
    
    // D2: Capturăm contextul complet al scenariului
    const occupancyMap = floorsData.map(f => f.hasPeople ? f.peopleCount : 0);
    const targetsMap = floorsData.map(f => f.targetTemp);
    
    const newRecord = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        date: new Date().toLocaleString('ro-RO'),
        mode: simModeSelect.value === 'auto' ? 'Auto (AI)' : 'Manual',
        time: formatTime(simulatedMinutes),
        timeMinutes: simulatedMinutes,        // pentru grafic (axa X)
        energy: totalEnergy.toFixed(2) + ' kWh',
        energyValue: totalEnergy,             // pentru grafic (axa Y)
        settings: `${inputFloors.value} Etaje, ${inputArea.value} m²`,
        // Context scenariu (D2)
        floors: parseInt(inputFloors.value),
        area: getValidNumber(inputArea, 200, 50, 2000),
        extTemp: getValidNumber(inputExtTemp, 5, -30, 50),
        initTemp: getValidNumber(inputInitTemp, 10, -20, 50),
        thermalCoeff: parseFloat(inputThermal.value),
        occupancyMap: occupancyMap,
        targetsMap: targetsMap,
        // D9: Serie temporală
        energySeries: energyHistory.slice()
    };
    
    history.unshift(newRecord);
    
    // Limită: max 50 scenarii (previne QuotaExceededError pe localStorage)
    history = history.slice(0, 50);
    
    localStorage.setItem('ecoTwinHistory', JSON.stringify(history));
    logEvent(`💾 Scenariu salvat: ${totalEnergy.toFixed(2)} kWh`, 'success');
}

window.deleteRecord = function(index) {
    let history = JSON.parse(localStorage.getItem('ecoTwinHistory')) || [];
    const removed = history.splice(index, 1);
    if (removed[0]) {
        const recId = removed[0].id || `legacy-${index}`;
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
        const extraInfo = [peopleInfo, extTempInfo].filter(x => x).join(' · ');
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
                    <button class="btn-delete-row" onclick="deleteRecord(${index})" title="Șterge scenariu">🗑️</button>
                </td>
            </tr>
        `;
    });
    
    // Wire up checkboxes
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

// === GRAFIC COMPARAȚIE ===
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
    
    // Selectează scenariile bifate, în ordinea din istoric (culori stabile)
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
    
    // Setează dimensiunea cu suport retina
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = 320;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    
    // Padding plot
    const pad = { top: 20, right: 25, bottom: 40, left: 65 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    
    // Găsește maximele
    let maxTime = 0, maxKwh = 0;
    selectedRecords.forEach(r => {
        r.energySeries.forEach(p => {
            if (p.min > maxTime) maxTime = p.min;
            if (p.kwh > maxKwh) maxKwh = p.kwh;
        });
    });
    maxTime = Math.max(1, maxTime);
    maxKwh = Math.max(0.1, maxKwh * 1.1); // +10% headroom
    
    const xScale = (min) => pad.left + (min / maxTime) * plotW;
    const yScale = (kwh) => pad.top + plotH - (kwh / maxKwh) * plotH;
    
    // Fundal plot
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(pad.left, pad.top, plotW, plotH);
    
    // Grid + labels Y
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
    
    // Grid + labels X
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
    
    // Linii scenarii
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
        
        // Punct final
        const last = record.energySeries[record.energySeries.length - 1];
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(xScale(last.min), yScale(last.kwh), 4, 0, Math.PI * 2);
        ctx.fill();
        
        // Legend entry
        legendEl.innerHTML += `
            <div class="legend-item">
                <div class="legend-swatch" style="background:${color}; box-shadow: 0 0 8px ${color};"></div>
                <span><b style="color:${color}">${record.mode}</b> · ${record.date.slice(0, 16)} · <b>${record.energy}</b></span>
            </div>
        `;
    });
}

// Redraw la resize fereastră (dacă modalul e deschis)
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

setInterval(simulationTick, 100);
generateBuilding();
logEvent('✓ Sistem inițializat - 3 etaje, 200 m²', 'success');
