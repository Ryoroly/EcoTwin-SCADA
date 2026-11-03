let isRunning = false;
let totalEnergy = 0; // kWh
let simulatedMinutes = 0;

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
const btnTimeSpeed = document.getElementById('time-speed-btn');
const btnStart = document.getElementById('btn-start');

const btnHistory = document.getElementById('btn-history');
const modalHistory = document.getElementById('history-modal');
const btnCloseModal = document.getElementById('close-modal');
const btnClearHistory = document.getElementById('btn-clear-history');
const historyBody = document.getElementById('history-body');

// Update label live pt slider-ul termic
inputThermal.addEventListener('input', (e) => {
    document.getElementById('val-thermal').innerText = e.target.value;
});

// Funcție Helper pt curățarea input-urilor (Clamp & NaN check)
function getValidNumber(inputEl, fallback, min = -100, max = 10000) {
    let val = parseFloat(inputEl.value);
    if (isNaN(val)) return fallback;
    return Math.max(min, Math.min(max, val));
}

function generateBuilding() {
    // Aici nu mai avem limita de max 10
    const numFloors = Math.floor(getValidNumber(inputFloors, 3, 1, 10000));
    inputFloors.value = numFloors; 
    
    const initTemp = getValidNumber(inputInitTemp, 10, -20, 50);
    inputInitTemp.value = initTemp;

    buildingContainer.innerHTML = '';
    floorsData = [];

    const floorHeight = 90; // Înălțimea CSS a peretelui

    // --- ANCORARE DE SUS ÎN JOS ---
    // Scădem înălțimea totală a clădirii pe axa Z.
    // Astfel, etajul cel mai de sus va rămâne mereu ancorat lângă bara de sus, 
    // iar restul clădirii se va construi în jos.
    const zOffset = -((numFloors - 1) * floorHeight);
    buildingContainer.style.transform = `rotateX(65deg) rotateZ(-40deg) translateZ(${zOffset}px)`;

    for (let i = 1; i <= numFloors; i++) {
        const floorDiv = document.createElement('div');
        floorDiv.className = 'floor-level';
        floorDiv.style.transform = `translateZ(${ (i - 1) * floorHeight }px)`;
        
        floorDiv.innerHTML = `
            <div class="face-base"></div>
            <div class="face-top"></div>
            <div class="face-front">
                <div class="f-title">NIVEL ${i} <span style="font-size:0.7rem; color:#aaa; font-weight:normal;">(<span id="power-f${i}">0.0</span>kW)</span></div>
                <div class="f-temp" id="curr-temp-f${i}">${initTemp.toFixed(1)}°C</div>
                <div class="f-target">
                    Țintă: <input type="number" id="target-f${i}" class="glass-input" value="22" step="0.5">
                </div>
            </div>
            <div class="face-right">
                <div class="vent-grill"><div id="vent-air-f${i}" class="vent-air maintaining"></div></div>
            </div>
        `;
        buildingContainer.appendChild(floorDiv);

        floorsData.push({
            level: i,
            currentTemp: initTemp,
            targetTemp: 22,
            hvacState: 'maintaining',
            lastPower: 0 
        });

        document.getElementById(`target-f${i}`).addEventListener('change', (e) => {
            if (simModeSelect.value !== 'auto') {
                floorsData[i-1].targetTemp = getValidNumber(e.target, 22, 10, 35);
                e.target.value = floorsData[i-1].targetTemp; 
            }
        });
    }
}

// Schimbare Mod UI (Read-Only pe auto)
simModeSelect.addEventListener('change', (e) => {
    const isAuto = e.target.value === 'auto';
    floorsData.forEach(floor => {
        const inputTarget = document.getElementById(`target-f${floor.level}`);
        inputTarget.readOnly = isAuto;
        if(isAuto) {
            // Nu forțăm actualizarea la fiecare frame, doar cand se schimba modul/strategia
            floor.targetTemp = 21 + (floor.level * 0.5);
            inputTarget.value = floor.targetTemp.toFixed(1);
        }
    });
});

btnTimeSpeed.addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % speeds.length;
    timeMultiplier = speeds[speedIndex];
    btnTimeSpeed.innerText = `Viteză: ${timeMultiplier}x`;
    btnTimeSpeed.style.borderColor = timeMultiplier >= 60 ? '#ff9f43' : 'rgba(0, 255, 204, 0.4)';
});

function formatTime(mins) {
    const d = Math.floor(mins / (24 * 60));
    const h = Math.floor((mins % (24 * 60)) / 60);
    return `${d} Zile, ${h} Ore`;
}

function simulationTick() {
    if (!isRunning) return;

    // Citim mediul live la fiecare frame, dar validat
    const extTemp = getValidNumber(inputExtTemp, 5, -30, 50);
    const thermalLossCoeff = parseFloat(inputThermal.value); 
    const areaMultiplier = getValidNumber(inputArea, 200, 50, 2000) / 100; 
    
    let tickEnergy = 0; // kW*min în acest calup
    let currentInstantPower = 0; // kW instant total clădire

    // Micro-Stepping pentru precizie fizică
    for (let step = 0; step < timeMultiplier; step++) {
        simulatedMinutes += 1;
        currentInstantPower = 0; 
        
        floorsData.forEach((floor) => {
            // 1. Transfer cu exteriorul
            floor.currentTemp += (extTemp - floor.currentTemp) * thermalLossCoeff;

            // 2. Termostat Histerezis (Toleranță ±1°C)
            if (floor.hvacState === 'heating' && floor.currentTemp >= floor.targetTemp) {
                floor.hvacState = 'maintaining';
                floor.currentTemp = floor.targetTemp; 
            } else if (floor.hvacState === 'cooling' && floor.currentTemp <= floor.targetTemp) {
                floor.hvacState = 'maintaining';
                floor.currentTemp = floor.targetTemp; 
            }

            if (floor.hvacState === 'maintaining') {
                if (floor.currentTemp < floor.targetTemp - 1.0) floor.hvacState = 'heating';
                else if (floor.currentTemp > floor.targetTemp + 1.0) floor.hvacState = 'cooling';
            }

            // 3. Aplicare Energie Fizică
            const baseHeatingPower = 2.0 * areaMultiplier;
            const baseCoolingPower = 2.5 * areaMultiplier;
            let powerUsed = 0;

            if (floor.hvacState === 'heating') {
                floor.currentTemp += 0.05; 
                powerUsed = baseHeatingPower; 
            } else if (floor.hvacState === 'cooling') {
                floor.currentTemp -= 0.05;
                powerUsed = baseCoolingPower; 
            } else {
                powerUsed = 0.1 * areaMultiplier; // Standby
            }

            floor.lastPower = powerUsed; // Stocăm pt UI
            currentInstantPower += powerUsed;
            tickEnergy += powerUsed; // Integrăm pt kWh
        });
    }

    // UPDATE UI o singură dată per tick
    displayTime.innerText = formatTime(simulatedMinutes);
    displayInstantPower.innerText = `${currentInstantPower.toFixed(2)} kW`;
    
    floorsData.forEach((floor) => {
        document.getElementById(`curr-temp-f${floor.level}`).innerText = `${floor.currentTemp.toFixed(1)}°C`;
        document.getElementById(`power-f${floor.level}`).innerText = floor.lastPower.toFixed(1);
        document.getElementById(`vent-air-f${floor.level}`).className = `vent-air ${floor.hvacState}`;
    });

    totalEnergy += (tickEnergy) / 60; // kW*min / 60 = kWh
    displayEnergy.innerText = totalEnergy.toFixed(2);
}

// Controale UI
document.getElementById('btn-apply-settings').addEventListener('click', generateBuilding);

btnStart.addEventListener('click', () => {
    isRunning = !isRunning;
    btnStart.innerText = isRunning ? '⏸ Pauză Simulare' : '▶ Start Simulare';
    btnStart.classList.toggle('highlight');
    
    displayStatus.innerText = isRunning ? 'Simulare Activă...' : 'Pauză';
    displayStatus.style.color = isRunning ? '#00ffcc' : '#ff9f43';
});

document.getElementById('btn-reset').addEventListener('click', () => {
    // SALVĂM DATELE ÎN ISTORIC ÎNAINTE DE A RESETA
    if (simulatedMinutes > 0) {
        saveToHistory();
    }

    isRunning = false;
    btnStart.innerText = '▶ Start Simulare';
    btnStart.classList.remove('highlight');
    
    totalEnergy = 0; 
    simulatedMinutes = 0;
    
    displayEnergy.innerText = "0.00"; 
    displayTime.innerText = "0 Zile, 0 Ore";
    displayInstantPower.innerText = "0.00 kW";
    displayStatus.innerText = "Resetat (Salvat & Pauză)";
    displayStatus.style.color = "#ff9f43";
    
    generateBuilding(); 
});

// Start loop fizică
setInterval(simulationTick, 100);
generateBuilding();


// === LOGICA PENTRU ISTORIC (LOCAL STORAGE) ===

function saveToHistory() {
    // Citim istoricul vechi sau creăm un array gol
    let history = JSON.parse(localStorage.getItem('ecoTwinHistory')) || [];
    
    // Creăm înregistrarea nouă
    const newRecord = {
        date: new Date().toLocaleString('ro-RO'),
        mode: simModeSelect.value === 'auto' ? 'Auto (AI)' : 'Manual',
        time: formatTime(simulatedMinutes),
        energy: totalEnergy.toFixed(2) + ' kWh',
        settings: `${inputFloors.value} Etaje, ${inputArea.value} m²`
    };
    
    // O punem la începutul listei și salvăm
    history.unshift(newRecord);
    localStorage.setItem('ecoTwinHistory', JSON.stringify(history));
}

function renderHistory() {
    let history = JSON.parse(localStorage.getItem('ecoTwinHistory')) || [];
    historyBody.innerHTML = '';
    
    if (history.length === 0) {
        // Am schimbat colspan la 6
        historyBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#aaa;">Nicio simulare salvată încă.</td></tr>';
        return;
    }

    history.forEach((record, index) => {
        const modeColor = record.mode === 'Auto (AI)' ? '#00ffcc' : 'white';
        
        historyBody.innerHTML += `
            <tr>
                <td>${record.date}</td>
                <td style="color: ${modeColor}; font-weight:bold;">${record.mode}</td>
                <td>${record.time}</td>
                <td style="color: #ff9f43; font-weight:bold;">${record.energy}</td>
                <td>${record.settings}</td>
                <td style="text-align:center;">
                    <!-- BUTONUL NOU DE ȘTERGERE -->
                    <button class="btn-delete-row" onclick="deleteRecord(${index})" title="Șterge scenariu">🗑️</button>
                </td>
            </tr>
        `;
    });
}
// Funcție expusă global pentru a fi apelată din HTML
window.deleteRecord = function(index) {
    let history = JSON.parse(localStorage.getItem('ecoTwinHistory')) || [];
    history.splice(index, 1); // Șterge doar elementul vizat
    localStorage.setItem('ecoTwinHistory', JSON.stringify(history));
    renderHistory(); // Re-generează tabelul actualizat
};

// Evenimente pentru deschiderea/închiderea ferestrei
btnHistory.addEventListener('click', () => {
    renderHistory();
    modalHistory.classList.remove('hidden');
});

btnCloseModal.addEventListener('click', () => {
    modalHistory.classList.add('hidden');
});

// Opțional: Închide modalul dacă dai click în afara lui
modalHistory.addEventListener('click', (e) => {
    if (e.target === modalHistory) modalHistory.classList.add('hidden');
});

btnClearHistory.addEventListener('click', () => {
    if(confirm('Ești sigur că vrei să ștergi toate simulările salvate?')) {
        localStorage.removeItem('ecoTwinHistory');
        renderHistory();
    }
});