let isRunning = false;
let totalEnergy = 0;
let simulatedMinutes = 0;

const speeds = [1, 5, 15, 60, 120]; 
let speedIndex = 0;
let timeMultiplier = speeds[speedIndex];
let floorsData = [];

const buildingContainer = document.getElementById('building-container');
const inputFloors = document.getElementById('input-floors');
const inputArea = document.getElementById('input-area');
const inputThermal = document.getElementById('input-thermal');
const inputExtTemp = document.getElementById('input-ext-temp');
const inputInitTemp = document.getElementById('input-init-temp');
const simModeSelect = document.getElementById('sim-mode');

const displayEnergy = document.getElementById('total-energy');
const displayTime = document.getElementById('stat-time');
const displayStatus = document.getElementById('stat-status');
const btnTimeSpeed = document.getElementById('time-speed-btn');

function generateBuilding() {
    const numFloors = parseInt(inputFloors.value);
    const initTemp = parseFloat(inputInitTemp.value);
    buildingContainer.innerHTML = '';
    floorsData = [];

    const floorHeight = 90; // Înălțimea exactă a pereților

    for (let i = 1; i <= numFloors; i++) {
        const floorDiv = document.createElement('div');
        floorDiv.className = 'floor-level';
        
        floorDiv.style.transform = `translateZ(${ (i - 1) * floorHeight }px)`;
        
        floorDiv.innerHTML = `
            <div class="face-base"></div>
            <div class="face-top"></div>
            <div class="face-front">
                <div class="f-title">Nivel ${i} <span style="font-size:0.7rem; color:#aaa; font-weight:normal;">(<span id="power-f${i}">0.0</span>kW)</span></div>
                <div class="f-temp" id="curr-temp-f${i}">${initTemp.toFixed(1)}°C</div>
                <div class="f-target">
                    Țintă: <input type="number" id="target-f${i}" class="glass-input" value="22" step="0.5"> °C
                </div>
            </div>
            <div class="face-right">
                <div class="vent-grill"><div id="vent-air-f${i}" class="vent-air"></div></div>
            </div>
        `;
        
        buildingContainer.appendChild(floorDiv);

        floorsData.push({
            level: i,
            currentTemp: initTemp,
            targetTemp: 22,
            hvacState: 'maintaining' 
        });

        document.getElementById(`target-f${i}`).addEventListener('change', (e) => {
            floorsData[i-1].targetTemp = parseFloat(e.target.value);
        });
    }
}

btnTimeSpeed.addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % speeds.length;
    timeMultiplier = speeds[speedIndex];
    btnTimeSpeed.innerText = `Viteză: ${timeMultiplier}x`;
    btnTimeSpeed.style.borderColor = timeMultiplier >= 60 ? '#ff9f43' : 'rgba(255, 255, 255, 0.3)';
});

function formatTime(mins) {
    const d = Math.floor(mins / (24 * 60));
    const h = Math.floor((mins % (24 * 60)) / 60);
    return `${d} Zile, ${h} Ore`;
}

function simulationTick() {
    if (!isRunning) return;

    const extTemp = parseFloat(inputExtTemp.value);
    const mode = simModeSelect.value;
    const thermalLossCoeff = parseFloat(inputThermal.value); 
    const areaMultiplier = parseFloat(inputArea.value) / 100; 
    let tickEnergy = 0;

    for (let step = 0; step < timeMultiplier; step++) {
        simulatedMinutes += 1;
        
        floorsData.forEach((floor, index) => {
            if (mode === 'auto') {
                floor.targetTemp = 21 + (index * 0.5); 
                document.getElementById(`target-f${floor.level}`).value = floor.targetTemp.toFixed(1);
            }

            floor.currentTemp += (extTemp - floor.currentTemp) * thermalLossCoeff;

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
                powerUsed = 0.1 * areaMultiplier; 
            }

            tickEnergy += powerUsed;
        });
    }

    displayTime.innerText = formatTime(simulatedMinutes);
    
    floorsData.forEach((floor) => {
        document.getElementById(`curr-temp-f${floor.level}`).innerText = `${floor.currentTemp.toFixed(1)}°C`;
        
        const areaMult = parseFloat(inputArea.value) / 100;
        let displayPower = floor.hvacState === 'heating' ? (2.0 * areaMult) : (floor.hvacState === 'cooling' ? (2.5 * areaMult) : (0.1 * areaMult));
        
        document.getElementById(`power-f${floor.level}`).innerText = displayPower.toFixed(1);
        document.getElementById(`vent-air-f${floor.level}`).className = `vent-air ${floor.hvacState}`;
    });

    totalEnergy += (tickEnergy) / 60; 
    displayEnergy.innerText = totalEnergy.toFixed(2);
    document.getElementById('stat-manual').innerText = `${totalEnergy.toFixed(2)} kWh`;
}

document.getElementById('btn-apply-settings').addEventListener('click', generateBuilding);
document.getElementById('btn-start').addEventListener('click', () => {
    isRunning = !isRunning;
    document.getElementById('btn-start').innerText = isRunning ? '⏸ Pauză Simulare' : '▶ Start Simulare';
    document.getElementById('btn-start').classList.toggle('highlight');
    displayStatus.innerText = isRunning ? 'Simulare Activă...' : 'Așteptare';
    displayStatus.style.color = isRunning ? '#00ffcc' : 'white';
});
document.getElementById('btn-reset').addEventListener('click', () => {
    totalEnergy = 0; simulatedMinutes = 0;
    displayEnergy.innerText = "0.00"; displayTime.innerText = "0 Zile, 0 Ore";
    generateBuilding(); 
});

setInterval(simulationTick, 100);
generateBuilding();