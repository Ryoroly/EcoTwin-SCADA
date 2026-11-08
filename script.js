// ============================================================
//  STARE GLOBALĂ
// ============================================================
let isRunning = false;
let totalEnergy = 0;
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

let thermalMass = 1.0;
let pausedByVisibility = false;

const CO2_CAP = 5000;
const CO2_FLOOR = 400;
const THERMAL_MASS_DEFAULT = 1.0;

let intervalId = null;

const PERSIST_KEY = 'ecoTwinSettings_v1';
const HVAC_LOG_COOLDOWN_MIN = 60;

let weatherMode = 'fixed';
let weatherData = null;
let currentExtTemp = 5;

let gaugeDisplayPower = 0;

let useRoomsFromFile = false;

// ============================================================
//  DOM
// ============================================================
const buildingContainer = document.getElementById('building-container');
const inputFloors = document.getElementById('input-floors');
const inputArea = document.getElementById('input-area');
const inputThermal = document.getElementById('input-thermal');
const inputExtTemp = document.getElementById('input-ext-temp');
const inputInitTemp = document.getElementById('input-init-temp');
const inputThermalMass = document.getElementById('input-thermal-mass');
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

const btnUploadWeather = document.getElementById('btn-upload-weather');
const weatherFileInput = document.getElementById('weather-file-input');
const weatherModeFixed = document.getElementById('weather-mode-fixed');
const weatherModeVariable = document.getElementById('weather-mode-variable');
const weatherTempValue = document.getElementById('weather-temp-value');
const weatherSourceLabel = document.getElementById('weather-source-label');

// ============================================================
//  TIMER
// ============================================================
function setRunning(state) {
    isRunning = state;
    if (state) {
        if (!intervalId) intervalId = setInterval(simulationTick, 100);
    } else {
        if (intervalId) { clearInterval(intervalId); intervalId = null; }
    }
}

// ============================================================
//  UTILITARE
// ============================================================
inputThermal.addEventListener('input', (e) => {
    document.getElementById('val-thermal').innerText = e.target.value;
});

if (inputThermalMass) {
    inputThermalMass.value = THERMAL_MASS_DEFAULT;
    inputThermalMass.addEventListener('input', (e) => {
        thermalMass = parseFloat(e.target.value);
        document.getElementById('val-thermal-mass').innerText = thermalMass.toFixed(2);
    });
}

function getValidNumber(inputEl, fallback, min = -100, max = 10000) {
    let val = parseFloat(inputEl.value);
    if (isNaN(val)) return fallback;
    return Math.max(min, Math.min(max, val));
}

// ============================================================
//  🌡️ VREME + CAMERE
// ============================================================
function getExtTempAt(minute) {
    if (weatherMode === 'variable' && weatherData && weatherData.hourly_temp.length > 0) {
        const hours = weatherData.hourly_temp.length;
        const hourFloat = minute / 60;
        const h0 = Math.floor(hourFloat) % hours;
        const h1 = (h0 + 1) % hours;
        const t = hourFloat - Math.floor(hourFloat);
        return weatherData.hourly_temp[h0] * (1 - t) + weatherData.hourly_temp[h1] * t;
    }
    return getValidNumber(inputExtTemp, 5, -30, 50);
}

function updateWeatherDisplay() {
    if (weatherTempValue) {
        weatherTempValue.innerText = currentExtTemp.toFixed(1) + '°C';
        if (currentExtTemp < 0) weatherTempValue.style.color = '#74b9ff';
        else if (currentExtTemp < 15) weatherTempValue.style.color = '#00ffcc';
        else if (currentExtTemp < 25) weatherTempValue.style.color = '#f39c12';
        else weatherTempValue.style.color = '#ff4757';
    }
}

function applyWeatherModeUI() {
    const isVariable = weatherMode === 'variable';

    weatherModeFixed.checked = !isVariable;
    weatherModeVariable.checked = isVariable;

    inputExtTemp.disabled = isVariable;
    inputExtTemp.style.opacity = isVariable ? '0.4' : '1';
    inputExtTemp.style.cursor = isVariable ? 'not-allowed' : '';

    if (isVariable) {
        if (weatherData) {
            weatherSourceLabel.innerText = `Fișier · ${weatherData.hourly_temp.length}h`;
            weatherSourceLabel.classList.add('variable');
        } else {
            weatherSourceLabel.innerText = '⚠️ Fără fișier';
            weatherSourceLabel.classList.add('variable');
        }
    } else {
        weatherSourceLabel.innerText = 'Fixă';
        weatherSourceLabel.classList.remove('variable');
    }

    updateWeatherDisplay();
}

function setWeatherMode(mode) {
    if (mode === 'variable' && !weatherData) {
        alert('⚠️ Încarcă mai întâi un fișier de vreme (butonul 📂 Vreme din top)!');
        weatherModeFixed.checked = true;
        weatherModeVariable.checked = false;
        return;
    }
    weatherMode = mode;
    applyWeatherModeUI();
    saveSettings();
}

weatherModeFixed.addEventListener('change', () => {
    if (weatherModeFixed.checked) {
        setWeatherMode('fixed');
        logEvent('🌡 Sursă temp: Fixă', 'info');
    }
});

weatherModeVariable.addEventListener('change', () => {
    if (weatherModeVariable.checked) {
        setWeatherMode('variable');
        if (weatherData) {
            logEvent(`🌡 Sursă temp: Variabilă (${weatherData.hourly_temp.length}h din ${weatherData.filename})`, 'success');
        }
    }
});

btnUploadWeather.addEventListener('click', () => {
    weatherFileInput.click();
});

weatherFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        let hourlyTemp = null;

        if (Array.isArray(data.hourly_temp)) {
            hourlyTemp = data.hourly_temp;
        } else if (Array.isArray(data.hourly)) {
            hourlyTemp = data.hourly.map(h => {
                if (typeof h === 'number') return h;
                if (typeof h.temp === 'number') return h.temp;
                if (typeof h.temperature === 'number') return h.temperature;
                return 5;
            });
        } else if (Array.isArray(data)) {
            hourlyTemp = data;
        }

        if (!hourlyTemp || hourlyTemp.length === 0) {
            throw new Error('Fișier invalid — nu găsesc array "hourly_temp"');
        }

        hourlyTemp = hourlyTemp.map(v => {
            const n = parseFloat(v);
            if (isNaN(n)) throw new Error('Valoare ne-numerică în fișier');
            return n;
        });

        let roomsSchedule = null;
        if (Array.isArray(data.rooms_schedule)) {
            roomsSchedule = data.rooms_schedule.map(rooms => {
                if (!Array.isArray(rooms)) return [0, 0, 0, 0];
                return rooms.map(v => Math.max(0, Math.round(parseFloat(v) || 0)));
            });
        }

        weatherData = {
            hourly_temp: hourlyTemp,
            rooms_schedule: roomsSchedule,
            metadata: data.metadata || {},
            filename: file.name,
            config: data.config || {},
        };

        useRoomsFromFile = !!roomsSchedule;

        weatherMode = 'variable';
        applyWeatherModeUI();
        currentExtTemp = getExtTempAt(simulatedMinutes);
        updateWeatherDisplay();
        saveSettings();

        const minT = Math.min(...hourlyTemp);
        const maxT = Math.max(...hourlyTemp);
        const roomsInfo = roomsSchedule ? ' + camere' : '';
        logEvent(`📂 Vreme încărcată: ${file.name} · ${hourlyTemp.length}h${roomsInfo} · ${minT.toFixed(1)}…${maxT.toFixed(1)}°C`, 'success');

        if (roomsSchedule) {
            // Arată un preview al distribuției în camere
            const firstWorkingHour = roomsSchedule.find(r => r.some(p => p > 0));
            if (firstWorkingHour) {
                logEvent(`🏢 Camere: ${roomsSchedule.length}h, prima oră cu persoane: [${firstWorkingHour.join(', ')}] (total ${firstWorkingHour.reduce((a,b)=>a+b,0)})`, 'info');
            }
        }
    } catch (err) {
        alert('Eroare la încărcarea fișierului:\n' + err.message);
        logEvent(`❌ Upload vreme eșuat: ${err.message}`, 'danger');
    }

    e.target.value = '';
});

inputExtTemp.addEventListener('input', () => {
    if (weatherMode === 'fixed') {
        currentExtTemp = getValidNumber(inputExtTemp, 5, -30, 50);
        updateWeatherDisplay();
    }
});

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

        // 🆕 Camerele sunt acum în .face-top (tavan), nu în .face-base (podea)
        floorDiv.innerHTML = `
            <div class="face-base" id="base-f${i}"></div>
            <div class="face-top">
                ${i === numFloors ? `
                <div class="rooms-layout">
                    <div class="room" id="room-f${i}-r1">
                        <div class="bulb" id="bulb-f${i}-r1"></div>
                        <div class="room-people" id="room-people-f${i}-r1"></div>
                    </div>
                    <div class="room" id="room-f${i}-r2">
                        <div class="bulb" id="bulb-f${i}-r2"></div>
                        <div class="room-people" id="room-people-f${i}-r2"></div>
                    </div>
                    <div class="room" id="room-f${i}-r3">
                        <div class="bulb" id="bulb-f${i}-r3"></div>
                        <div class="room-people" id="room-people-f${i}-r3"></div>
                    </div>
                    <div class="room" id="room-f${i}-r4">
                        <div class="bulb" id="bulb-f${i}-r4"></div>
                        <div class="room-people" id="room-people-f${i}-r4"></div>
                    </div>
                </div>
                ` : ''}
            </div>
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
            _prevCo2Level: 0,
            _lastHvacLogMinute: -999,
            rooms: [
                { id: 1, people: 0, occupied: false },
                { id: 2, people: 0, occupied: false },
                { id: 3, people: 0, occupied: false },
                { id: 4, people: 0, occupied: false }
            ],
            _lastRoomMove: -999,
            lightingPower: 0
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
//  🆕 DISTRIBUȚIE PERSOANE ÎN CAMERE (cu update UI)
// ============================================================
function updateRoomUI(floor, roomIdx, count) {
    const bulb = document.getElementById(`bulb-f${floor.level}-r${roomIdx + 1}`);
    const peopleEl = document.getElementById(`room-people-f${floor.level}-r${roomIdx + 1}`);
    const roomEl = document.getElementById(`room-f${floor.level}-r${roomIdx + 1}`);

    const occupied = count > 0;

    if (bulb) bulb.classList.toggle('on', occupied);
    if (roomEl) roomEl.classList.toggle('has-people', occupied);

    if (peopleEl) {
        if (occupied) {
            peopleEl.innerText = `${count} 👤`;
            peopleEl.classList.add('visible');
        } else {
            peopleEl.classList.remove('visible');
        }
    }
}

function distributePeopleToRooms(floor, areaMultiplier) {
    // Doar ultimul etaj are camere
    if (floor.level !== floorsData.length) {
        floor.lightingPower = 0;
        return;
    }

    const totalPeople = floor.hasPeople ? floor.peopleCount : 0;

    if (totalPeople === 0) {
        floor.rooms.forEach((r, i) => {
            r.people = 0;
            r.occupied = false;
            updateRoomUI(floor, i, 0);
        });
        floor.lightingPower = 0;
        return;
    }

    // 🆕 Dacă avem rooms_schedule din fișier, îl folosim
    if (useRoomsFromFile && weatherData && weatherData.rooms_schedule && weatherData.rooms_schedule.length > 0) {
        const hoursTotal = weatherData.rooms_schedule.length;
        const hourIndex = Math.floor(simulatedMinutes / 60) % hoursTotal;
        const schedule = weatherData.rooms_schedule[hourIndex];

        // Aplică pe camere (schedule-ul e deja scalat corect)
        floor.rooms.forEach((r, i) => {
            const count = schedule[i] || 0;
            r.people = count;
            r.occupied = count > 0;
            updateRoomUI(floor, i, count);
        });

        const activeRooms = floor.rooms.filter(r => r.occupied).length;
        floor.lightingPower = activeRooms * 0.15 * areaMultiplier;
        return;
    }

    // 🆕 Fallback: 5-15 persoane per cameră ocupată, schimbare la 3 ore
    if (floor._lastRoomMove === undefined || simulatedMinutes - floor._lastRoomMove >= 180) {
        floor._lastRoomMove = simulatedMinutes;

        // Reset
        floor.rooms.forEach((r, i) => {
            r.people = 0;
            r.occupied = false;
        });

        // Câte camere ocupate (1-4)
        const numOccupied = Math.max(1, Math.min(4, Math.ceil(totalPeople / 5)));
        const indices = [0, 1, 2, 3].sort(() => Math.random() - 0.5);

        // Distribuie 5-15 per cameră (până epuizăm totalPeople)
        let peopleLeft = totalPeople;
        for (let i = 0; i < numOccupied && peopleLeft > 0; i++) {
            const idx = indices[i];
            const minPerRoom = 5;
            const maxPerRoom = 15;
            let count = Math.min(
                peopleLeft - (numOccupied - i - 1) * Math.min(minPerRoom, Math.floor(peopleLeft / (numOccupied - i))),
                Math.floor(Math.random() * (maxPerRoom - minPerRoom + 1)) + minPerRoom
            );
            count = Math.max(1, Math.min(count, peopleLeft));
            floor.rooms[idx].people = count;
            floor.rooms[idx].occupied = count > 0;
            peopleLeft -= count;
        }
    }

    // Update UI pentru toate camerele
    floor.rooms.forEach((r, i) => {
        updateRoomUI(floor, i, r.people);
    });

    const activeRooms = floor.rooms.filter(r => r.occupied).length;
    floor.lightingPower = activeRooms * 0.15 * areaMultiplier;
}

// ============================================================
//  MOD SIMULARE
// ============================================================
simModeSelect.addEventListener('change', (e) => {
    const isAuto = e.target.value === 'auto';

    document.getElementById('auto-config-panel').classList.toggle('hidden', !isAuto);
    logEvent(`Mod simulare: ${isAuto ? 'Auto (Optimizat)' : 'Manual'}`, 'info');

    if (isAuto) {
        autoConfig.isApplied = false;
        document.getElementById('auto-status').innerText =
            'Configurează parametrii și apasă Aplică pentru a începe.';

        floorsData.forEach(floor => {
            const inputTarget = document.getElementById(`target-f${floor.level}`);
            if (inputTarget) {
                inputTarget.readOnly = true;
                inputTarget.style.opacity = '0.5';
            }
        });
    } else {
        autoConfig.isApplied = false;
        floorsData.forEach(floor => {
            const inputTarget = document.getElementById(`target-f${floor.level}`);
            const chk = document.getElementById(`chk-occ-f${floor.level}`);
            const slider = document.getElementById(`slider-occ-f${floor.level}`);

            if (inputTarget) {
                inputTarget.readOnly = false;
                inputTarget.style.opacity = '1';
                if (floor.targetTemp < 10 || floor.targetTemp > 35) {
                    floor.targetTemp = 22;
                    inputTarget.value = '22';
                }
            }
            if (chk) chk.disabled = false;
            if (slider) slider.disabled = !floor.hasPeople;
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
//  SELECȚIE ETAJ
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

    gaugeDisplayPower = floorsData[index].lastPower;
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
    occChk.disabled = isFire || isAuto;
    occChk.checked = floor.hasPeople;

    const peopleSlider = document.getElementById('detail-people');
    peopleSlider.disabled = isFire || isAuto || !floor.hasPeople;
    peopleSlider.value = floor.peopleCount;
    document.getElementById('detail-people-val').innerText = floor.hasPeople ? floor.peopleCount : 0;
}

// ============================================================
//  GAUGE CONSUM
// ============================================================
function drawFloorGauge(power, maxPower) {
    const canvas = document.getElementById('floor-gauge-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h - 30;
    const radius = Math.min(w / 2, h) - 40;

    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI, 2 * Math.PI);
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.stroke();

    const ratio = Math.min(1, Math.max(0, power / maxPower));
    const endAngle = Math.PI + ratio * Math.PI;

    let color = '#00ffcc';
    if (ratio > 0.8) color = '#ff4757';
    else if (ratio > 0.5) color = '#ff9f43';

    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI, endAngle);
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = 'bold 24px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(power.toFixed(2), cx, cy - 20);

    ctx.font = '13px "Segoe UI", sans-serif';
    ctx.fillStyle = '#aaa';
    ctx.fillText('kW', cx, cy + 5);

    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText(`0 - ${maxPower.toFixed(0)} kW`, cx, cy + radius + 18);
}

// ============================================================
//  ANIMAȚIE GAUGE
// ============================================================
function animateGauge() {
    if (selectedFloorIndex !== null && floorsData[selectedFloorIndex]) {
        const floor = floorsData[selectedFloorIndex];
        const targetPower = floor.lastPower;
        const areaMultiplier = getValidNumber(inputArea, 200, 50, 2000) / 100;
        const maxPower = 6.0 * areaMultiplier;

        const smoothing = 0.08;
        gaugeDisplayPower += (targetPower - gaugeDisplayPower) * smoothing;

        if (Math.abs(targetPower - gaugeDisplayPower) < 0.005) {
            gaugeDisplayPower = targetPower;
        }

        drawFloorGauge(gaugeDisplayPower, maxPower);
    }
    requestAnimationFrame(animateGauge);
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

    while (container.children.length > 200) {
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
//  SIMULARE
// ============================================================
function simulationTick() {
    if (!isRunning) return;
    if (fireModeActive) return;

    const thermalLossCoeff = parseFloat(inputThermal.value);
    const areaMultiplier = getValidNumber(inputArea, 200, 50, 2000) / 100;
    const numFloors = floorsData.length;

    let tickEnergy = 0;
    let powerSumForTick = 0;

    for (let step = 0; step < timeMultiplier; step++) {
        simulatedMinutes += 1;

        const extTemp = getExtTempAt(simulatedMinutes);
        currentExtTemp = extTemp;

        if (simModeSelect.value === 'auto' && autoConfig.isApplied && simulatedMinutes % 5 === 0) {
            runAutoOptimizer();
        }

        const newTemps = floorsData.map(f => f.currentTemp);

        for (let i = 0; i < numFloors; i++) {
            const extFactor = i === 0 ? 1.5 : (i === numFloors - 1 ? 1.3 : 1.0);
            newTemps[i] += (thermalLossCoeff * (extTemp - floorsData[i].currentTemp) * extFactor) / thermalMass;
        }

        for (let i = 0; i < numFloors - 1; i++) {
            const deltaT = floorsData[i].currentTemp - floorsData[i + 1].currentTemp;
            const k = deltaT > 0 ? 0.02 : 0.005;
            const flow = (deltaT * k) / thermalMass;
            newTemps[i]     -= flow;
            newTemps[i + 1] += flow;
        }

        for (let i = 0; i < numFloors; i++) floorsData[i].currentTemp = newTemps[i];

        floorsData.forEach((floor) => {
            const currentOccupants = floor.hasPeople ? floor.peopleCount : 0;

            if (floor.hasPeople) {
                floor.co2 += currentOccupants * 1.5;
                floor.currentTemp += (currentOccupants * 0.0003) / thermalMass;
            } else {
                floor.co2 -= 0.5;
            }

            floor.exhaustActive = false;
            let exhaustPower = 0;
            let ventTempDelta = 0;

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

            if (floor.co2 < CO2_FLOOR) floor.co2 = CO2_FLOOR;
            if (floor.co2 > CO2_CAP)   floor.co2 = CO2_CAP;

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

            let hvacPower = 0.1 * areaMultiplier;

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

            ventTempDelta = Math.max(-0.15, Math.min(0.15, ventTempDelta));
            floor.currentTemp += ventTempDelta / thermalMass;

            distributePeopleToRooms(floor, areaMultiplier);

            const totalFloorPower = hvacPower + exhaustPower + floor.lightingPower;
            floor.lastPower = totalFloorPower;
            powerSumForTick += totalFloorPower;
            tickEnergy += totalFloorPower;

            if (floor._prevHvac !== floor.hvacState) {
                const labels = {
                    heating: 'Încălzire', cooling: 'Răcire',
                    maintaining: 'Menținere', ventilating: 'Ventilare'
                };

                let shouldLog = false;
                if (floor.hvacState === 'ventilating' || floor._prevHvac === 'ventilating') {
                    shouldLog = true;
                } else if (floor.hvacState === 'heating' || floor.hvacState === 'cooling') {
                    shouldLog = (simulatedMinutes - floor._lastHvacLogMinute) >= HVAC_LOG_COOLDOWN_MIN;
                }

                if (shouldLog) {
                    logEvent(`Etaj ${floor.level}: ${labels[floor._prevHvac]} → ${labels[floor.hvacState]}`, 'info');
                    floor._lastHvacLogMinute = simulatedMinutes;
                }

                floor._prevHvac = floor.hvacState;
            }

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

        if (simulatedMinutes % 30 === 0) {
            const runningTotal = totalEnergy + tickEnergy / 60;
            energyHistory.push({ min: simulatedMinutes, kwh: runningTotal });
        }
    }

    const currentInstantPower = powerSumForTick / timeMultiplier;

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

    if (simModeSelect.value === 'auto' && autoConfig.isApplied) {
        syncAutoUI();
    }

    updateWeatherDisplay();

    totalEnergy += tickEnergy / 60;
    displayEnergy.innerText = totalEnergy.toFixed(2);
}

// ============================================================
//  APLICĂ SETĂRI
// ============================================================
document.getElementById('btn-apply-settings').addEventListener('click', () => {
    setRunning(false);
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

    const wasAutoApplied = simModeSelect.value === 'auto' && autoConfig.isApplied;

    generateBuilding();

    currentExtTemp = getExtTempAt(0);
    updateWeatherDisplay();

    logEvent(`🏢 Clădire reconstruită: ${inputFloors.value} etaje, ${inputArea.value} m²`, 'info');

    if (wasAutoApplied) {
        runAutoOptimizer();
        syncAutoUI();
        logEvent('🤖 Configurație Auto reaplicată după reconstrucție', 'info');
    }

    saveSettings();
});

// ============================================================
//  TEMP INIȚIALĂ
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
    if (weatherMode === 'variable' && !weatherData) {
        alert('⚠️ Modul vreme variabilă activ dar nu ai încărcat niciun fișier!');
        return;
    }
    if (fireModeActive) {
        displayStatus.innerText = '🚨 Anulează incendiul întâi';
        displayStatus.style.color = '#ff4757';
        return;
    }
    setRunning(!isRunning);
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

    setRunning(false);
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

    const wasAutoApplied = simModeSelect.value === 'auto' && autoConfig.isApplied;

    generateBuilding();

    currentExtTemp = getExtTempAt(0);
    updateWeatherDisplay();

    if (wasAutoApplied) {
        runAutoOptimizer();
        syncAutoUI();
        document.getElementById('auto-status').innerHTML =
            '<span style="color:#00ffcc;">✅ Reset complet. Configurația Auto a fost reaplicată. Poți da Start.</span>';
        logEvent('🔄 Reset complet — configurație Auto reaplicată automat', 'success');
    } else {
        logEvent('🔄 Scenariu resetat - simulare oprită', 'info');
    }

    saveSettings();
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
    setRunning(false);
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
    document.querySelectorAll('.bulb').forEach(el => el.classList.add('off'));

    floorsData.forEach(floor => {
        floor.lastPower = 0;
        floor.lightingPower = 0;
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
    document.querySelectorAll('.bulb').forEach(el => el.classList.remove('off'));

    if (wasRunningBeforeFire) {
        setRunning(true);
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
//  ISTORIC
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
        extTemp: weatherMode === 'variable'
            ? `variabil (${weatherData ? weatherData.hourly_temp.length + 'h' : '?'})`
            : getValidNumber(inputExtTemp, 5, -30, 50),
        weatherMode: weatherMode,
        initTemp: getValidNumber(inputInitTemp, 10, -20, 50),
        thermalCoeff: parseFloat(inputThermal.value),
        thermalMass: thermalMass,
        occupancyMap: occupancyMap,
        targetsMap: targetsMap,
        energySeries: energyHistory.slice()
    };

    history.unshift(newRecord);
    history = history.slice(0, 50);
    localStorage.setItem('ecoTwinHistory', JSON.stringify(history));
    logEvent(`💾 Scenariu salvat: ${totalEnergy.toFixed(2)} kWh`, 'success');
}

window.deleteRecord = function(recId) {
    let history = JSON.parse(localStorage.getItem('ecoTwinHistory')) || [];
    const index = history.findIndex(r => r.id === recId);
    if (index === -1) {
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
        const extTempInfo = record.extTemp !== undefined
            ? `🌡 ${typeof record.extTemp === 'number' ? record.extTemp + '°C' : record.extTemp}`
            : '';
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
//  PAUZĂ LA TAB ASCUNS
// ============================================================
document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRunning) {
        pausedByVisibility = true;
        setRunning(false);
        btnStart.innerText = '▶ Start Simulare';
        btnStart.classList.remove('highlight');
        displayStatus.innerText = '⏸ Pauză (tab ascuns)';
        displayStatus.style.color = '#ff9f43';
    } else if (!document.hidden && pausedByVisibility) {
        pausedByVisibility = false;
        setRunning(true);
        btnStart.innerText = '⏸ Pauză Simulare';
        btnStart.classList.add('highlight');
        displayStatus.innerText = 'Simulare Activă...';
        displayStatus.style.color = '#00ffcc';
        logEvent('▶ Simulare reluată (tab activ)', 'info');
    }
});

// ============================================================
//  AUTO MODE
// ============================================================
const autoConfig = {
    workStart: 8 * 60,
    workEnd: 18 * 60,
    workDays: [0, 1, 2, 3, 4],
    tempMin: 20,
    tempMax: 24,
    setback: 16,
    preheatMinutes: 30,
    totalPeople: 30,
    peopleDist: 'uniform',
    isApplied: false
};

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

function isWorkTime(minuteAhead = 0) {
    const total = simulatedMinutes + minuteAhead;
    const day = Math.floor(total / (24 * 60)) % 7;
    const min = total % (24 * 60);
    if (!autoConfig.workDays.includes(day)) return false;
    return min >= autoConfig.workStart && min < autoConfig.workEnd;
}

let _cacheMUW_At = -1;
let _cacheMUW_Val = -1;
function minutesUntilWork() {
    if (_cacheMUW_At === simulatedMinutes) return _cacheMUW_Val;
    let result = Infinity;
    for (let m = 1; m < 7 * 24 * 60; m++) {
        if (isWorkTime(m)) { result = m; break; }
    }
    _cacheMUW_At = simulatedMinutes;
    _cacheMUW_Val = result;
    return result;
}

function distributePeople() {
    const n = floorsData.length;
    const total = autoConfig.totalPeople;

    floorsData.forEach(f => { f.hasPeople = false; f.peopleCount = 0; });
    if (total <= 0) return;

    // 🆕 Dacă avem rooms_schedule, ultimul etaj e gestionat de fișier
    if (useRoomsFromFile) {
        const nWithoutLast = n - 1;
        if (nWithoutLast <= 0) return;

        const perFloor = Math.floor(total / nWithoutLast);
        const rem = total % nWithoutLast;
        for (let i = 0; i < nWithoutLast; i++) {
            floorsData[i].peopleCount = perFloor + (i < rem ? 1 : 0);
            floorsData[i].hasPeople = floorsData[i].peopleCount > 0;
        }
        // Ultimul etaj → schedule
        const last = floorsData[n - 1];
        const hoursTotal = weatherData.rooms_schedule.length;
        const hourIndex = Math.floor(simulatedMinutes / 60) % hoursTotal;
        const schedule = weatherData.rooms_schedule[hourIndex];
        const totalLast = schedule.reduce((a, b) => a + b, 0);
        last.peopleCount = totalLast;
        last.hasPeople = totalLast > 0;
        return;
    }

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

function computeComfortTarget(floor, floorIndex) {
    let lowTarget = autoConfig.tempMin;

    if (floor.hasPeople) {
        lowTarget -= Math.min(1.5, (floor.peopleCount / 20) * 0.3);
    } else {
        lowTarget -= 0.5;
    }

    let heatFromBelow = 0;
    for (let j = 0; j < floorIndex; j++) {
        if (floorsData[j].currentTemp > floor.currentTemp + 0.5) {
            heatFromBelow += 0.3;
        }
    }
    lowTarget -= Math.min(1, heatFromBelow);
    lowTarget = Math.max(autoConfig.tempMin - 1, lowTarget);

    if (floor.currentTemp < lowTarget - 0.1) return lowTarget;
    if (floor.currentTemp > autoConfig.tempMax) return autoConfig.tempMax;
    return floor.currentTemp;
}

function runAutoOptimizer() {
    if (simModeSelect.value !== 'auto') return;
    if (!autoConfig.isApplied) return;

    const inWork = isWorkTime();
    const minsToWork = minutesUntilWork();
    const inPreheat = !inWork && minsToWork <= autoConfig.preheatMinutes;

    if (inWork) {
        distributePeople();
    } else {
        // Dacă avem fișier de camere, ultimul etaj păstrează schedule-ul
        if (useRoomsFromFile) {
            for (let i = 0; i < floorsData.length - 1; i++) {
                floorsData[i].hasPeople = false;
                floorsData[i].peopleCount = 0;
            }
            const last = floorsData[floorsData.length - 1];
            const hoursTotal = weatherData.rooms_schedule.length;
            const hourIndex = Math.floor(simulatedMinutes / 60) % hoursTotal;
            const schedule = weatherData.rooms_schedule[hourIndex];
            const totalLast = schedule.reduce((a, b) => a + b, 0);
            last.peopleCount = totalLast;
            last.hasPeople = totalLast > 0;
        } else {
            floorsData.forEach(f => { f.hasPeople = false; f.peopleCount = 0; });
        }
    }

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

function syncAutoUI() {
    floorsData.forEach(floor => {
        const inputEl = document.getElementById(`target-f${floor.level}`);
        const chk = document.getElementById(`chk-occ-f${floor.level}`);
        const slider = document.getElementById(`slider-occ-f${floor.level}`);
        const val = document.getElementById(`occ-val-f${floor.level}`);
        const base = document.getElementById(`base-f${floor.level}`);

        if (inputEl) {
            inputEl.value = floor.targetTemp.toFixed(1);
            inputEl.readOnly = true;
            inputEl.style.opacity = '0.5';
            inputEl.style.cursor = 'not-allowed';
        }
        if (chk) {
            chk.checked = floor.hasPeople;
            chk.disabled = true;
            chk.style.cursor = 'not-allowed';
        }
        if (slider) {
            slider.value = floor.peopleCount;
            slider.disabled = true;
        }
        if (val) val.innerText = floor.hasPeople ? floor.peopleCount : 0;
        if (base) base.classList.toggle('lights-on', floor.hasPeople);
    });

    if (selectedFloorIndex !== null && floorsData[selectedFloorIndex]) {
        updateFloorDetailPanel(floorsData[selectedFloorIndex]);
    }

    updateAutoStatusLine();
}

function updateAutoStatusLine() {
    const el = document.getElementById('auto-status');
    if (!el || !autoConfig.isApplied) return;

    const inWork = isWorkTime();
    const minsToWork = minutesUntilWork();
    const inPreheat = !inWork && minsToWork <= autoConfig.preheatMinutes;

    const sH = String(Math.floor(autoConfig.workStart / 60)).padStart(2, '0');
    const sM = String(autoConfig.workStart % 60).padStart(2, '0');
    const eH = String(Math.floor(autoConfig.workEnd / 60)).padStart(2, '0');
    const eM = String(autoConfig.workEnd % 60).padStart(2, '0');
    const program = `${sH}:${sM}–${eH}:${eM}`;

    const dist = floorsData.map(f => `N${f.level}=${f.hasPeople ? f.peopleCount : 0}`).join(' · ');

    let stateBadge = '';
    let stateColor = '#aaa';

    if (inWork) {
        stateBadge = '✅ PROGRAM ACTIV';
        stateColor = '#00ffcc';
    } else if (inPreheat) {
        stateBadge = `🔥 PRE-HEATING (${minsToWork} min până la start)`;
        stateColor = '#f39c12';
    } else {
        const h = Math.floor(minsToWork / 60);
        const m = minsToWork % 60;
        stateBadge = `🌙 SETBACK (start în ${h}h ${m}m)`;
        stateColor = '#ff9f43';
    }

    el.innerHTML = `
        <div style="color:${stateColor}; font-weight:bold; margin-bottom:6px;">
            ${stateBadge}
        </div>
        <div style="font-size:0.75rem; color:#888;">
            Program: ${program} · Confort: ${autoConfig.tempMin}–${autoConfig.tempMax}°C · Setback: ${autoConfig.setback}°C
        </div>
        <div style="font-size:0.75rem; color:#888; margin-top:4px;">
            Persoane: ${dist}
        </div>
    `;
}

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

    setRunning(false);
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

    currentExtTemp = getExtTempAt(0);
    updateWeatherDisplay();

    runAutoOptimizer();
    syncAutoUI();

    logEvent(`🤖 Auto configurat: ${autoConfig.totalPeople} persoane, confort ${autoConfig.tempMin}–${autoConfig.tempMax}°C`, 'success');

    saveSettings();
}

// ============================================================
//  PERSISTENȚĂ
// ============================================================
function saveSettings() {
    try {
        const data = {
            floors: inputFloors.value,
            area: inputArea.value,
            thermal: inputThermal.value,
            initTemp: inputInitTemp.value,
            extTemp: inputExtTemp.value,
            thermalMass: inputThermalMass ? inputThermalMass.value : '1',
            simMode: simModeSelect.value,
            weatherMode: weatherMode,
            weatherData: weatherData ? {
                hourly_temp: weatherData.hourly_temp,
                rooms_schedule: weatherData.rooms_schedule,
                filename: weatherData.filename,
                metadata: weatherData.metadata,
            } : null,
            auto: {
                workStart: document.getElementById('auto-work-start').value,
                workEnd: document.getElementById('auto-work-end').value,
                workDays: Array.from(document.querySelectorAll('.day-chk input'))
                    .filter(c => c.checked)
                    .map(c => parseInt(c.dataset.day)),
                tempMin: document.getElementById('auto-temp-min').value,
                tempMax: document.getElementById('auto-temp-max').value,
                setback: document.getElementById('auto-setback').value,
                preheat: document.getElementById('auto-preheat').value,
                peopleTotal: document.getElementById('auto-people-total').value,
                peopleDist: document.getElementById('auto-people-dist').value
            }
        };
        localStorage.setItem(PERSIST_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('saveSettings error:', e);
    }
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(PERSIST_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);

        if (data.floors != null) inputFloors.value = data.floors;
        if (data.area != null) inputArea.value = data.area;
        if (data.thermal != null) {
            inputThermal.value = data.thermal;
            document.getElementById('val-thermal').innerText = data.thermal;
        }
        if (data.initTemp != null) inputInitTemp.value = data.initTemp;
        if (data.extTemp != null) inputExtTemp.value = data.extTemp;
        if (data.thermalMass != null && inputThermalMass) {
            inputThermalMass.value = data.thermalMass;
            thermalMass = parseFloat(data.thermalMass);
            document.getElementById('val-thermal-mass').innerText = thermalMass.toFixed(2);
        }

        if (data.weatherData && Array.isArray(data.weatherData.hourly_temp)) {
            weatherData = {
                hourly_temp: data.weatherData.hourly_temp,
                rooms_schedule: data.weatherData.rooms_schedule || null,
                filename: data.weatherData.filename || 'restaurat',
                metadata: data.weatherData.metadata || {},
            };
            useRoomsFromFile = !!weatherData.rooms_schedule;
        }
        if (data.weatherMode === 'variable' && weatherData) {
            weatherMode = 'variable';
        } else if (data.weatherMode === 'variable' && !weatherData) {
            weatherMode = 'fixed';
        } else if (data.weatherMode) {
            weatherMode = data.weatherMode;
        }

        if (data.auto) {
            const a = data.auto;
            if (a.workStart) document.getElementById('auto-work-start').value = a.workStart;
            if (a.workEnd) document.getElementById('auto-work-end').value = a.workEnd;
            if (a.workDays) {
                document.querySelectorAll('.day-chk input').forEach(chk => {
                    chk.checked = a.workDays.includes(parseInt(chk.dataset.day));
                });
            }
            if (a.tempMin != null) document.getElementById('auto-temp-min').value = a.tempMin;
            if (a.tempMax != null) document.getElementById('auto-temp-max').value = a.tempMax;
            if (a.tempMin != null && a.tempMax != null) {
                document.getElementById('auto-range-val').innerText =
                    `${parseFloat(a.tempMin).toFixed(1)} – ${parseFloat(a.tempMax).toFixed(1)} °C`;
            }
            if (a.setback != null) {
                document.getElementById('auto-setback').value = a.setback;
                document.getElementById('auto-setback-val').innerText = parseFloat(a.setback).toFixed(1);
            }
            if (a.preheat != null) {
                document.getElementById('auto-preheat').value = a.preheat;
                document.getElementById('auto-preheat-val').innerText = a.preheat;
            }
            if (a.peopleTotal != null) {
                document.getElementById('auto-people-total').value = a.peopleTotal;
                document.getElementById('auto-people-val').innerText = a.peopleTotal;
            }
            if (a.peopleDist) document.getElementById('auto-people-dist').value = a.peopleDist;
        }

        if (data.simMode) {
            simModeSelect.value = data.simMode;
            simModeSelect.dispatchEvent(new Event('change'));
        }

        readAutoConfigFromUI();
        autoConfig.isApplied = false;

        if (simModeSelect.value === 'auto') {
            document.getElementById('auto-status').innerHTML =
                '<span style="color:#f39c12;">⚙️ Configurație restaurată — apasă „Aplică Configurație" pentru a porni.</span>';
        }
    } catch (e) {
        console.warn('loadSettings error:', e);
    }
}

(function bindSaveListeners() {
    const changeIds = [
        'input-floors', 'input-area', 'input-thermal', 'input-init-temp',
        'input-ext-temp', 'sim-mode',
        'auto-work-start', 'auto-work-end', 'auto-temp-min', 'auto-temp-max',
        'auto-people-dist'
    ];
    changeIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', saveSettings);
    });

    ['input-thermal-mass', 'auto-setback', 'auto-preheat', 'auto-people-total'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', saveSettings);
            el.addEventListener('change', saveSettings);
        }
    });

    document.querySelectorAll('.day-chk input').forEach(chk => {
        chk.addEventListener('change', saveSettings);
    });
})();

// ============================================================
//  BOOT
// ============================================================
loadSettings();
applyWeatherModeUI();
currentExtTemp = getExtTempAt(simulatedMinutes);
updateWeatherDisplay();
generateBuilding();
logEvent('✓ Sistem inițializat - 3 etaje, 200 m²', 'success');

requestAnimationFrame(animateGauge);