// ============================================================
// SATELLITE MISSION CONTROL - STANDALONE ENGINE
// Real-Time Satellite Monitoring System (Sentinel-2A / Vikram-Sat)
// ============================================================

let smcAnimationFrame = null;
let smcClockInterval = null;
let globeRotation = 0;
let globeZoom = 1.0;
let is3DMode = true;
let activeTimeFilter = '1h';

// Satellite State & Telemetry
const smcData = {
  activeSat: 'Sentinel-2A',
  lat: 19.0760,
  lon: 72.8777,
  alt: 786.2,
  spd: 7.46,
  dir: 'SW 234° (PROGRADE)',
  direction: 1,         // 1 = Prograde, -1 = Retrograde
  speedMultiplier: 1.0,  // 0.0 to 5.0
  isPaused: false,
  orbitProgress: 0,
  nextPassSec: 765, // 00:12:45
  battery: 91.0,
  temp: 28.4,
  solar: 1.84,
  power: 1.23,
  cpu: 34,
  mem: 42,
  storage: 65,
  signal: -71,
  history: {
    bat: [90.5, 90.8, 91.0, 91.2, 91.0, 90.9, 91.0, 91.1, 91.0],
    temp: [27.8, 28.1, 28.4, 28.6, 28.5, 28.3, 28.4, 28.5, 28.4],
    solar: [1.80, 1.82, 1.84, 1.85, 1.84, 1.83, 1.84, 1.84, 1.84],
    sig: [-73, -72, -71, -70, -71, -72, -71, -71, -71]
  }
};

// World Map Image Loader for 2D Ground Track
const worldMapImg = new Image();
worldMapImg.src = 'world_map_bg.jpg';
let worldMapLoaded = false;
worldMapImg.onload = () => { worldMapLoaded = true; };

document.addEventListener('DOMContentLoaded', () => {
  initSMC();
  startSMCClock();
  startSMCLoop();
});

// ESP32 Hardware REST API Communicator
async function sendCommand(command) {
  try {
    const res = await fetch(`/command?cmd=${encodeURIComponent(command)}&t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const txt = await res.text();
      console.log('ESP32 Satellite Response:', txt);
    }
  } catch (e) {
    // Local simulation fallback
  }
}

// --- CONTROLLER INITIALIZATION ---
function initSMC() {
  // Navigation Tabs
  document.querySelectorAll('.smc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.smc-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // Time Filter Buttons
  document.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTimeFilter = btn.getAttribute('data-time');
      generateHistoryData();
    });
  });

  // Speed Slider
  const speedSlider = document.getElementById('satSpeedSlider');
  const speedValText = document.getElementById('satSpeedValue');
  if (speedSlider) {
    speedSlider.addEventListener('input', (e) => {
      smcData.speedMultiplier = parseFloat(e.target.value);
      if (speedValText) speedValText.textContent = `${smcData.speedMultiplier.toFixed(1)}x`;
      sendCommand(`sat_speed&val=${smcData.speedMultiplier}`);
      document.querySelectorAll('.spd-pill').forEach(p => p.classList.remove('active'));
    });
  }

  // Speed Preset Pills
  document.querySelectorAll('.spd-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.spd-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const spd = parseFloat(pill.getAttribute('data-spd'));
      smcData.speedMultiplier = spd;
      if (speedSlider) speedSlider.value = spd;
      if (speedValText) speedValText.textContent = `${spd.toFixed(1)}x`;
      sendCommand(`sat_speed&val=${spd}`);
    });
  });

  // Direction Toggle (Prograde / Retrograde)
  const btnDir = document.getElementById('btnOrbitDirection');
  const dirLabel = document.getElementById('dirLabel');
  if (btnDir) {
    btnDir.addEventListener('click', () => {
      smcData.direction *= -1;
      const isPrograde = smcData.direction === 1;
      if (dirLabel) dirLabel.textContent = isPrograde ? 'PROGRADE' : 'RETROGRADE';
      smcData.dir = isPrograde ? 'SW 234° (PROGRADE)' : 'NE 54° (RETROGRADE)';
      btnDir.style.color = isPrograde ? '#38bdf8' : '#eab308';
      btnDir.style.borderColor = isPrograde ? 'rgba(56, 189, 248, 0.4)' : 'rgba(234, 179, 8, 0.4)';
      sendCommand('sat_dir');
    });
  }

  // Play / Pause Toggle
  const btnPause = document.getElementById('btnOrbitPause');
  if (btnPause) {
    btnPause.addEventListener('click', () => {
      smcData.isPaused = !smcData.isPaused;
      btnPause.textContent = smcData.isPaused ? '▶ RESUME' : '⏸ PAUSE';
      btnPause.style.color = smcData.isPaused ? '#22c55e' : '#eab308';
      sendCommand('sat_pause');
    });
  }

  // Constellation Satellites Selection
  document.querySelectorAll('.constellation-sat').forEach(satCard => {
    satCard.addEventListener('click', () => {
      document.querySelectorAll('.constellation-sat').forEach(s => s.classList.remove('active'));
      satCard.classList.add('active');
      const satName = satCard.querySelector('.const-name').textContent;
      smcData.activeSat = satName;
      const headline = document.querySelector('.sat-headline h2');
      if (headline) headline.innerHTML = `${satName} <span class="sat-subname">/ VIKRAM-SAT</span>`;
      const hudTitle = document.querySelector('.hud-sat-title');
      if (hudTitle) hudTitle.textContent = `${satName} / VIKRAM-SAT`;
    });
  });

  // 3D Globe Tools
  const btn3D = document.getElementById('btnToggle3D');
  if (btn3D) {
    btn3D.addEventListener('click', () => {
      is3DMode = !is3DMode;
      btn3D.textContent = is3DMode ? '🌐 3D VIEW' : '🗺️ 2D MAP';
    });
  }

  const btnZoomIn = document.getElementById('btnGlobeZoomIn');
  if (btnZoomIn) btnZoomIn.addEventListener('click', () => { globeZoom = Math.min(globeZoom + 0.15, 1.8); });

  const btnZoomOut = document.getElementById('btnGlobeZoomOut');
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => { globeZoom = Math.max(globeZoom - 0.15, 0.7); });

  const btnCenter = document.getElementById('btnGlobeCenter');
  if (btnCenter) btnCenter.addEventListener('click', () => { globeRotation = 0; globeZoom = 1.0; });
}

// --- UTC MISSION CLOCK & COUNTDOWN TICKER (INDEPENDENT OF SYSTEM TIME) ---
const satMissionClock = {
  hours: 12,
  minutes: 37,
  seconds: 21,
  day: 31,
  month: 'May',
  year: 2025
};

function startSMCClock() {
  if (smcClockInterval) clearInterval(smcClockInterval);

  function updateClock() {
    satMissionClock.seconds++;
    if (satMissionClock.seconds >= 60) {
      satMissionClock.seconds = 0;
      satMissionClock.minutes++;
      if (satMissionClock.minutes >= 60) {
        satMissionClock.minutes = 0;
        satMissionClock.hours = (satMissionClock.hours + 1) % 24;
      }
    }

    const h = String(satMissionClock.hours).padStart(2, '0');
    const m = String(satMissionClock.minutes).padStart(2, '0');
    const s = String(satMissionClock.seconds).padStart(2, '0');

    const timeEl = document.getElementById('smcUtcTime');
    if (timeEl) timeEl.textContent = `UTC ${h}:${m}:${s}`;
    const dateEl = document.getElementById('smcUtcDate');
    if (dateEl) dateEl.textContent = `${satMissionClock.day} ${satMissionClock.month} ${satMissionClock.year}`;

    // Next pass countdown
    if (smcData.nextPassSec > 0) {
      smcData.nextPassSec--;
      const passM = Math.floor(smcData.nextPassSec / 60);
      const passS = smcData.nextPassSec % 60;
      const passStr = `00:${String(passM).padStart(2, '0')}:${String(passS).padStart(2, '0')}`;
      const nextPassEl = document.getElementById('stripNextPass');
      if (nextPassEl) nextPassEl.textContent = passStr;
      const nextContactEl = document.getElementById('smcNextContact');
      if (nextContactEl) nextContactEl.textContent = passStr;
    }
  }

  updateClock();
  smcClockInterval = setInterval(updateClock, 1000);
}

// --- GENERATE RANDOMIZED HISTORY FOR ACTIVE FILTER ---
function generateHistoryData() {
  const points = 12;
  smcData.history.bat = Array.from({ length: points }, () => (90 + Math.random() * 2));
  smcData.history.temp = Array.from({ length: points }, () => (27.5 + Math.random() * 1.5));
  smcData.history.solar = Array.from({ length: points }, () => (1.75 + Math.random() * 0.15));
  smcData.history.sig = Array.from({ length: points }, () => (-74 + Math.random() * 5));
}

// --- MAIN ANIMATION LOOP WITH SPEED & DIRECTION CONTROL ---
function startSMCLoop() {
  if (smcAnimationFrame) cancelAnimationFrame(smcAnimationFrame);

  function loop() {
    if (!smcData.isPaused) {
      // Accumulate orbit progress based on speed and direction
      const step = (0.0015 * smcData.speedMultiplier * smcData.direction);
      smcData.orbitProgress = (smcData.orbitProgress + step + 1) % 1;
      globeRotation += (0.003 * smcData.speedMultiplier * smcData.direction);
    }

    const orbitProg = smcData.orbitProgress;

    // Dynamic coordinates & telemetry calculation
    smcData.lat = (19.0760 + Math.sin(orbitProg * Math.PI * 2) * 55).toFixed(4);
    smcData.lon = ((72.8777 + orbitProg * 360) % 360 - 180).toFixed(4);
    smcData.spd = (7.45 * Math.max(smcData.speedMultiplier, 0.1) + Math.sin(orbitProg * 4) * 0.03).toFixed(2);
    smcData.alt = (786.2 + Math.cos(orbitProg * 3) * 0.4).toFixed(1);

    updateSMCTelemetryDisplay();

    draw3DGlobe(orbitProg);
    draw2DGroundTrack(orbitProg);
    drawPassMiniMap(orbitProg);
    drawHistoryCharts();

    smcAnimationFrame = requestAnimationFrame(loop);
  }

  smcAnimationFrame = requestAnimationFrame(loop);
}

// --- UPDATE REAL-TIME VALUES ---
function updateSMCTelemetryDisplay() {
  const latStr = `${Math.abs(smcData.lat)}° ${smcData.lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(smcData.lon)}° ${smcData.lon >= 0 ? 'E' : 'W'}`;

  // Strip items
  const sLat = document.getElementById('stripLat'); if (sLat) sLat.textContent = latStr;
  const sLon = document.getElementById('stripLon'); if (sLon) sLon.textContent = lonStr;
  const sAlt = document.getElementById('stripAlt'); if (sAlt) sAlt.textContent = `${smcData.alt} km`;
  const sSpd = document.getElementById('stripSpd'); if (sSpd) sSpd.textContent = `${smcData.spd} km/s`;
  const sDir = document.getElementById('stripDir'); if (sDir) sDir.textContent = smcData.dir;

  // Floating HUD
  const hLat = document.getElementById('hudLat'); if (hLat) hLat.textContent = latStr;
  const hLon = document.getElementById('hudLon'); if (hLon) hLon.textContent = lonStr;
  const hAlt = document.getElementById('hudAlt'); if (hAlt) hAlt.textContent = `${smcData.alt} km`;
  const hSpd = document.getElementById('hudSpd'); if (hSpd) hSpd.textContent = `${smcData.spd} km/s`;

  const coordTag = document.getElementById('globeCoordTag');
  if (coordTag) coordTag.textContent = `${latStr}, ${lonStr}`;
}

// --- RENDER HERO 3D GLOBE ---
function draw3DGlobe(orbitProg) {
  const canvas = document.getElementById('smc3DGlobeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2 + 10;
  const baseR = Math.min(w, h) * 0.36 * globeZoom;

  ctx.clearRect(0, 0, w, h);

  // 1. Starfield
  for (let i = 0; i < 40; i++) {
    const sx = (Math.sin(i * 99) * 0.5 + 0.5) * w;
    const sy = (Math.cos(i * 33) * 0.5 + 0.5) * h;
    const sr = (i % 3 === 0) ? 1.2 : 0.7;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + (i % 5) * 0.1})`;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Atmospheric Outer Glow
  const glowGrad = ctx.createRadialGradient(cx, cy, baseR * 0.95, cx, cy, baseR * 1.25);
  glowGrad.addColorStop(0, 'rgba(56, 189, 248, 0.45)');
  glowGrad.addColorStop(0.5, 'rgba(14, 165, 233, 0.15)');
  glowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR * 1.25, 0, Math.PI * 2);
  ctx.fill();

  // 3. Earth Ocean Sphere & Day/Night Gradient
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
  ctx.clip();

  const oceanGrad = ctx.createRadialGradient(cx - baseR * 0.35, cy - baseR * 0.35, baseR * 0.1, cx, cy, baseR);
  oceanGrad.addColorStop(0, '#0284c7');
  oceanGrad.addColorStop(0.5, '#0369a1');
  oceanGrad.addColorStop(0.85, '#0c4a6e');
  oceanGrad.addColorStop(1, '#082f49');
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(cx - baseR, cy - baseR, baseR * 2, baseR * 2);

  // 4. Continents & Landmasses with rotation
  ctx.fillStyle = '#15803d';
  const numContinents = 7;
  for (let c = 0; c < numContinents; c++) {
    const angle = (c * (Math.PI * 2 / numContinents) + globeRotation) % (Math.PI * 2);
    const contX = cx + Math.cos(angle) * (baseR * 0.7);
    const contY = cy + Math.sin(c * 1.8) * (baseR * 0.5);
    const contRadius = baseR * (0.2 + (c % 3) * 0.08);

    if (Math.sin(angle) > -0.2) {
      ctx.beginPath();
      ctx.ellipse(contX, contY, contRadius, contRadius * 0.65, angle * 0.3, 0, Math.PI * 2);
      ctx.fill();

      // City night lights
      if (contX > cx) {
        ctx.fillStyle = 'rgba(253, 224, 71, 0.8)';
        for (let l = 0; l < 4; l++) {
          ctx.beginPath();
          ctx.arc(contX - 10 + l * 6, contY - 5 + (l % 2) * 8, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#15803d';
      }
    }
  }

  // 5. Day/Night Shadow Overlay
  const shadowGrad = ctx.createLinearGradient(cx - baseR, cy, cx + baseR, cy);
  shadowGrad.addColorStop(0, 'rgba(2, 6, 23, 0.0)');
  shadowGrad.addColorStop(0.45, 'rgba(2, 6, 23, 0.2)');
  shadowGrad.addColorStop(0.75, 'rgba(2, 6, 23, 0.7)');
  shadowGrad.addColorStop(1, 'rgba(2, 6, 23, 0.9)');
  ctx.fillStyle = shadowGrad;
  ctx.fillRect(cx - baseR, cy - baseR, baseR * 2, baseR * 2);

  ctx.restore();

  // 6. Golden Orbital Trajectory Ellipse Line
  const orbitRx = baseR * 1.35;
  const orbitRy = baseR * 0.62;
  const orbitAngle = -0.38;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(orbitAngle);

  ctx.beginPath();
  ctx.ellipse(0, 0, orbitRx, orbitRy, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(234, 179, 8, 0.85)';
  ctx.lineWidth = 1.8;
  ctx.shadowColor = '#eab308';
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 7. Ground Track Path
  ctx.beginPath();
  ctx.ellipse(0, 0, orbitRx * 0.82, orbitRy * 0.82, 0, 0, Math.PI * 2);
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.setLineDash([]);

  // 8. Satellite Position on Orbit Ellipse
  const satOrbitTheta = orbitProg * Math.PI * 2;
  const satX = Math.cos(satOrbitTheta) * orbitRx;
  const satY = Math.sin(satOrbitTheta) * orbitRy;

  const footX = Math.cos(satOrbitTheta) * (baseR * 0.8);
  const footY = Math.sin(satOrbitTheta) * (baseR * 0.45);

  // 9. Sensor Footprint Projection Cone
  const coneGrad = ctx.createLinearGradient(satX, satY, footX, footY);
  coneGrad.addColorStop(0, 'rgba(56, 189, 248, 0.45)');
  coneGrad.addColorStop(1, 'rgba(34, 197, 94, 0.15)');

  ctx.beginPath();
  ctx.moveTo(satX, satY);
  ctx.lineTo(footX - 22, footY);
  ctx.lineTo(footX + 22, footY);
  ctx.closePath();
  ctx.fillStyle = coneGrad;
  ctx.fill();

  // Footprint circle on surface
  ctx.beginPath();
  ctx.ellipse(footX, footY, 24, 14, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = 'rgba(34, 197, 94, 0.2)';
  ctx.fill();
  ctx.stroke();

  // 10. Satellite Body Render
  ctx.translate(satX, satY);
  ctx.rotate(-orbitAngle);

  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(-18, -4, 10, 8);
  ctx.fillRect(8, -4, 10, 8);
  ctx.strokeStyle = '#60a5fa';
  ctx.strokeRect(-18, -4, 10, 8);
  ctx.strokeRect(8, -4, 10, 8);

  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(-6, -6, 12, 12);
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// --- RENDER 2D GROUND TRACK WORLD MAP ---
function draw2DGroundTrack(orbitProg) {
  const canvas = document.getElementById('smc2DTrackCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // 1. Draw High-Tech World Map Background
  if (worldMapLoaded && worldMapImg.complete && worldMapImg.naturalWidth > 0) {
    ctx.drawImage(worldMapImg, 0, 0, w, h);
    ctx.fillStyle = 'rgba(6, 11, 25, 0.25)';
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = '#030816';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(14, 165, 233, 0.15)';
    ctx.fillRect(w * 0.12, h * 0.18, w * 0.22, h * 0.38);
    ctx.fillRect(w * 0.45, h * 0.12, w * 0.18, h * 0.32);
    ctx.fillRect(w * 0.46, h * 0.42, w * 0.16, h * 0.42);
    ctx.fillRect(w * 0.62, h * 0.14, w * 0.30, h * 0.48);
  }

  // 2. Secondary Orbit Path Line
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const y = h / 2 + Math.sin((x / w + orbitProg + 0.15) * Math.PI * 2) * (h * 0.38);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(234, 179, 8, 0.7)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.setLineDash([]);

  // 3. Primary Ground Track Line
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const y = h / 2 + Math.sin((x / w + orbitProg) * Math.PI * 2) * (h * 0.38);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2.0;
  ctx.shadowColor = '#22c55e';
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 4. Satellite Current Coordinates
  const satX = (orbitProg * w) % w;
  const satY = h / 2 + Math.sin((satX / w + orbitProg) * Math.PI * 2) * (h * 0.38);

  // 5. Footprint
  ctx.beginPath();
  ctx.ellipse(satX, satY, 28, 18, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(34, 197, 94, 0.22)';
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 1.4;
  ctx.fill();
  ctx.stroke();

  // 6. Crosshair
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(satX - 18, satY);
  ctx.lineTo(satX + 18, satY);
  ctx.moveTo(satX, satY - 18);
  ctx.lineTo(satX + 18, satY);
  ctx.stroke();

  // 7. Sat Icon
  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(satX - 10, satY - 3, 6, 6);
  ctx.fillRect(satX + 4, satY - 3, 6, 6);
  ctx.beginPath();
  ctx.arc(satX, satY, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#38bdf8';
  ctx.fill();

  // 8. Tooltip Tag
  ctx.font = '10px Orbitron, monospace';
  ctx.fillStyle = '#f8fafc';
  const tagText = `${smcData.activeSat} [${Math.abs(smcData.lat).toFixed(1)}°N, ${Math.abs(smcData.lon).toFixed(1)}°E]`;
  ctx.fillText(tagText, Math.min(satX + 12, w - 160), Math.max(satY - 10, 16));
}

// --- RENDER REGIONAL PASS MINI-MAP ---
function drawPassMiniMap(orbitProg) {
  const canvas = document.getElementById('smcPassMiniMap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = '#050a18';
  ctx.fillRect(0, 0, w, h);

  // India peninsula outline
  ctx.fillStyle = 'rgba(21, 128, 61, 0.35)';
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w * 0.45, 10);
  ctx.lineTo(w * 0.75, 25);
  ctx.lineTo(w * 0.78, 55);
  ctx.lineTo(w * 0.50, h - 8);
  ctx.lineTo(w * 0.25, 45);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Pass line
  ctx.beginPath();
  ctx.moveTo(w * 0.70, 0);
  ctx.lineTo(w * 0.35, h);
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Marker
  const trackY = (Date.now() / 30) % h;
  const trackX = w * 0.70 - (trackY / h) * (w * 0.35);

  ctx.beginPath();
  ctx.arc(trackX, trackY, 10, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
}

// --- RENDER TELEMETRY HISTORY SPARKLINES ---
function drawHistoryCharts() {
  drawSparkline('chartBatCanvas', smcData.history.bat, '#22c55e', 'rgba(34, 197, 94, 0.15)');
  drawSparkline('chartTempCanvas', smcData.history.temp, '#eab308', 'rgba(234, 179, 8, 0.15)');
  drawSparkline('chartSolarCanvas', smcData.history.solar, '#38bdf8', 'rgba(56, 189, 248, 0.15)');
  drawSparkline('chartSigCanvas', smcData.history.sig, '#a855f7', 'rgba(168, 85, 247, 0.15)');
}

function drawSparkline(canvasId, dataArr, strokeColor, fillColor) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !dataArr || dataArr.length === 0) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const min = Math.min(...dataArr) - 0.2;
  const max = Math.max(...dataArr) + 0.2;
  const range = max - min || 1;

  ctx.beginPath();
  dataArr.forEach((val, i) => {
    const x = (i / (dataArr.length - 1)) * w;
    const y = h - ((val - min) / range) * (h - 6) - 3;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
}
