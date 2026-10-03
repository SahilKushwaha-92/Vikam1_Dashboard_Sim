// ============================================================
// VIKRAM-1 / FALCON 9 LAUNCH DASHBOARD & SIMULATION ENGINE
// SpaceX / Skyroot Real-Time Launch Monitoring System
// ============================================================

// --- Simulation State ---
const state = {
  phase: 'IDLE',               // IDLE, STARTUP, IGNITION, LIFTOFF, MAX_Q, MECO, ORBIT_DEPLOY, COMPLETE
  systemStatus: 'GO FOR LAUNCH',
  rocketStatus: 'AT_BOTTOM',   // AT_BOTTOM, MOVING_UP, AT_TOP, MOVING_DOWN
  satelliteStatus: 'OFF',      // OFF, ORBITING
  isRunning: false,
  isMissionSequence: false,

  // Telemetry Numbers
  speed: 0,                    // km/h
  altitude: 0.0,               // km
  velocity: 0.0,               // km/s
  gForce: 1.0,                 // G
  thrust: 0,                   // kN
  chamberPressure: 0,          // bar
  
  // Animation and Interval IDs
  timers: [],
  animationFrameId: null,
  countdownInterval: null,
  clockInterval: null,
  smokeInterval: null,
  missionStartTime: null,
  elapsedInterval: null,
  
  // Positions
  rocketPosition: 0,           // 0 to 1
  orbitAngle: 0,
  trajectoryProgress: 0,       // 0 to 1

  // Sparkline History Buffers
  sparkHistory: {
    speed: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    alt: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    vel: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    gForce: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]
  },

  // Settings
  settings: {
    countdownTime: 7,
    launchDuration: 5,
    holdTime: 3,
    orbitDuration: 15,
    returnDuration: 5
  }
};

const UI = {};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  // Top Header & Meta
  UI.topUtcTime = document.getElementById('topUtcTime');
  UI.topUtcDate = document.getElementById('topUtcDate');
  UI.topConnectionStatus = document.getElementById('topConnectionStatus');
  UI.stageSteps = document.querySelectorAll('.stage-step');

  // Sidebar elements
  UI.launchStatusText = document.getElementById('launchStatusText');
  UI.launchStatusPill = document.getElementById('launchStatusPill');
  UI.sidebarCountdown = document.getElementById('sidebarCountdown');
  UI.cdSecs = document.getElementById('cdSecs');
  UI.cdMins = document.getElementById('cdMins');
  UI.cdHours = document.getElementById('cdHours');
  UI.btnStartMission = document.getElementById('btnStartMission');
  UI.btnStopMission = document.getElementById('btnStopMission');
  UI.btnResetSystem = document.getElementById('btnResetSystem');
  UI.btnSatStatus = document.getElementById('btnSatStatus');
  UI.rangeMapCanvas = document.getElementById('rangeMapCanvas');

  // Settings Accordion
  UI.btnToggleSettings = document.getElementById('btnToggleSettings');
  UI.settingsBody = document.getElementById('settingsBody');
  if (UI.btnToggleSettings && UI.settingsBody) {
    UI.btnToggleSettings.addEventListener('click', () => {
      const isVisible = UI.settingsBody.style.display !== 'none';
      UI.settingsBody.style.display = isVisible ? 'none' : 'flex';
    });
  }

  // Sliders
  const sliderIds = ['countdownTime', 'launchDuration', 'holdTime', 'orbitDuration', 'returnDuration'];
  UI.sliders = {};
  UI.sliderValues = {};
  sliderIds.forEach(id => {
    UI.sliders[id] = document.getElementById(id);
    UI.sliderValues[id] = document.getElementById(id + 'Value');
    if (UI.sliders[id]) {
      UI.sliders[id].addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (UI.sliderValues[id]) UI.sliderValues[id].textContent = val + 's';
        state.settings[id] = val;
      });
    }
  });

  // Hero Viewport & Scene Elements
  UI.starsCanvas = document.getElementById('starsCanvas');
  UI.vizArea = document.getElementById('vizArea');
  UI.rocketScene = document.getElementById('rocketScene');
  UI.satelliteScene = document.getElementById('satelliteScene');
  UI.rocketContainer = document.getElementById('rocketContainer');
  UI.flameContainer = document.getElementById('flameContainer');
  UI.smokeContainer = document.getElementById('smokeContainer');
  UI.satelliteArm = document.getElementById('satelliteArm');
  UI.countdownOverlay = document.getElementById('countdownOverlay');
  UI.countdownNumber = document.getElementById('countdownNumber');

  // Live Feed HUD elements
  UI.feedSpeed = document.getElementById('feedSpeed');
  UI.feedAltitude = document.getElementById('feedAltitude');
  UI.feedVelocity = document.getElementById('feedVelocity');
  UI.feedGForce = document.getElementById('feedGForce');
  UI.feedTTimer = document.getElementById('feedTTimer');
  UI.feedFlightState = document.getElementById('feedFlightState');

  // Trajectory Canvas
  UI.flightTrajectoryCanvas = document.getElementById('flightTrajectoryCanvas');

  // Middle Row Gauges
  UI.dialSpeed = document.getElementById('dialSpeed');
  UI.dialAltitude = document.getElementById('dialAltitude');
  UI.dialVelocity = document.getElementById('dialVelocity');
  UI.dialGForce = document.getElementById('dialGForce');
  UI.gaugeRingSpeed = document.getElementById('gaugeRingSpeed');
  UI.gaugeRingAltitude = document.getElementById('gaugeRingAltitude');
  UI.gaugeRingVelocity = document.getElementById('gaugeRingVelocity');
  UI.gaugeRingGForce = document.getElementById('gaugeRingGForce');

  // Engine Stats
  UI.engineThrustVal = document.getElementById('engineThrustVal');
  UI.enginePressureVal = document.getElementById('enginePressureVal');
  UI.engineNodes = document.querySelectorAll('.eng-node');

  // Telemetry Sparklines
  UI.sparkSpeedCanvas = document.getElementById('sparkSpeedCanvas');
  UI.sparkAltitudeCanvas = document.getElementById('sparkAltitudeCanvas');
  UI.sparkVelocityCanvas = document.getElementById('sparkVelocityCanvas');
  UI.sparkGForceCanvas = document.getElementById('sparkGForceCanvas');

  // Bottom Log and Comms
  UI.eventLogTbody = document.getElementById('eventLogTbody');
  UI.commsStreamList = document.getElementById('commsStreamList');

  // Navigation Items
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Action Buttons
  if (UI.btnStartMission) UI.btnStartMission.addEventListener('click', startFullMission);
  if (UI.btnStopMission) UI.btnStopMission.addEventListener('click', stopMission);
  if (UI.btnResetSystem) UI.btnResetSystem.addEventListener('click', resetSystem);

  // Satellite Modal Overlay
  UI.satModalOverlay = document.getElementById('satModalOverlay');
  UI.btnCloseSatModal = document.getElementById('btnCloseSatModal');
  if (UI.btnSatStatus) UI.btnSatStatus.addEventListener('click', openSatModal);
  if (UI.btnCloseSatModal) UI.btnCloseSatModal.addEventListener('click', closeSatModal);
  if (UI.satModalOverlay) {
    UI.satModalOverlay.addEventListener('click', (e) => {
      if (e.target === UI.satModalOverlay) closeSatModal();
    });
  }

  // Setup Systems
  initStarsCanvas();
  window.addEventListener('resize', initStarsCanvas);
  startTopClock();
  drawRangeMap();
  drawFlightTrajectory(0);
  startSparklineLoop();
});

// ============================================================
// TOP MISSION CLOCK & DATE TICKER (INDEPENDENT OF SYSTEM TIME)
// ============================================================
const missionClock = {
  hours: 16,
  minutes: 16,
  seconds: 53,
  day: 31,
  month: 'May',
  year: 2025
};

function getMissionTimeFormatted() {
  const h12 = ((missionClock.hours + 11) % 12 + 1);
  const ampm = missionClock.hours >= 12 ? 'PM' : 'AM';
  const h = String(h12).padStart(2, '0');
  const m = String(missionClock.minutes).padStart(2, '0');
  const s = String(missionClock.seconds).padStart(2, '0');
  return `${h}:${m}:${s} ${ampm}`;
}

function startTopClock() {
  function tick() {
    missionClock.seconds++;
    if (missionClock.seconds >= 60) {
      missionClock.seconds = 0;
      missionClock.minutes++;
      if (missionClock.minutes >= 60) {
        missionClock.minutes = 0;
        missionClock.hours = (missionClock.hours + 1) % 24;
      }
    }

    const h = String(missionClock.hours).padStart(2, '0');
    const m = String(missionClock.minutes).padStart(2, '0');
    const s = String(missionClock.seconds).padStart(2, '0');

    if (UI.topUtcTime) UI.topUtcTime.textContent = `${h}:${m}:${s}`;
    if (UI.topUtcDate) UI.topUtcDate.textContent = `${missionClock.month} ${missionClock.day}, ${missionClock.year}`;
  }
  tick();
  setInterval(tick, 1000);
}

// ============================================================
// RANGE MINIMAP RENDERER
// ============================================================
function drawRangeMap() {
  if (!UI.rangeMapCanvas) return;
  const ctx = UI.rangeMapCanvas.getContext('2d');
  const w = UI.rangeMapCanvas.width;
  const h = UI.rangeMapCanvas.height;

  ctx.fillStyle = '#030a1c';
  ctx.fillRect(0, 0, w, h);

  // Coastline polygon
  ctx.beginPath();
  ctx.moveTo(w * 0.35, 0);
  ctx.lineTo(w * 0.45, h * 0.4);
  ctx.lineTo(w * 0.52, h * 0.65);
  ctx.lineTo(w * 0.48, h);
  ctx.lineTo(0, h);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Range radar arcs
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
  [20, 40, 60].forEach(r => {
    ctx.beginPath();
    ctx.arc(w * 0.55, h * 0.5, r, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Launch pad target beacon
  ctx.beginPath();
  ctx.arc(w * 0.55, h * 0.5, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#22c55e';
  ctx.fill();
}

// ============================================================
// FLIGHT TRAJECTORY CANVAS RENDERER
// ============================================================
function drawFlightTrajectory(progress) {
  if (!UI.flightTrajectoryCanvas) return;
  const ctx = UI.flightTrajectoryCanvas.getContext('2d');
  const w = UI.flightTrajectoryCanvas.width;
  const h = UI.flightTrajectoryCanvas.height;

  ctx.clearRect(0, 0, w, h);

  // Earth horizon curvature
  ctx.beginPath();
  ctx.arc(w / 2, h * 3.2, h * 2.5, Math.PI * 1.35, Math.PI * 1.65);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Parabolic Trajectory Arc
  ctx.beginPath();
  ctx.moveTo(w * 0.08, h * 0.85);
  ctx.bezierCurveTo(w * 0.25, h * 0.15, w * 0.70, h * 0.15, w * 0.92, h * 0.85);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Trajectory Progress Marker
  const t = Math.max(0, Math.min(progress, 1));
  const p0 = { x: w * 0.08, y: h * 0.85 };
  const p1 = { x: w * 0.25, y: h * 0.15 };
  const p2 = { x: w * 0.70, y: h * 0.15 };
  const p3 = { x: w * 0.92, y: h * 0.85 };

  const cx = Math.pow(1 - t, 3) * p0.x + 3 * Math.pow(1 - t, 2) * t * p1.x + 3 * (1 - t) * Math.pow(t, 2) * p2.x + Math.pow(t, 3) * p3.x;
  const cy = Math.pow(1 - t, 3) * p0.y + 3 * Math.pow(1 - t, 2) * t * p1.y + 3 * (1 - t) * Math.pow(t, 2) * p2.y + Math.pow(t, 3) * p3.y;

  // Draw rocket marker dot
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#22c55e';
  ctx.shadowColor = '#22c55e';
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.shadowBlur = 0;
}

// ============================================================
// TELEMETRY SPARKLINES RENDERER
// ============================================================
function startSparklineLoop() {
  function renderAllSparks() {
    drawSparklineGraph('sparkSpeedCanvas', state.sparkHistory.speed, '#22c55e');
    drawSparklineGraph('sparkAltitudeCanvas', state.sparkHistory.alt, '#38bdf8');
    drawSparklineGraph('sparkVelocityCanvas', state.sparkHistory.vel, '#eab308');
    drawSparklineGraph('sparkGForceCanvas', state.sparkHistory.gForce, '#f97316');
  }

  setInterval(() => {
    // Add current readings to buffer
    state.sparkHistory.speed.push(state.speed);
    if (state.sparkHistory.speed.length > 15) state.sparkHistory.speed.shift();

    state.sparkHistory.alt.push(state.altitude);
    if (state.sparkHistory.alt.length > 15) state.sparkHistory.alt.shift();

    state.sparkHistory.vel.push(state.velocity);
    if (state.sparkHistory.vel.length > 15) state.sparkHistory.vel.shift();

    state.sparkHistory.gForce.push(state.gForce);
    if (state.sparkHistory.gForce.length > 15) state.sparkHistory.gForce.shift();

    renderAllSparks();
  }, 500);
}

function drawSparklineGraph(canvasId, dataArr, strokeColor) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const min = Math.min(...dataArr);
  const max = Math.max(...dataArr) || 1;
  const range = (max - min) === 0 ? 1 : (max - min);

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

  // Area Fill
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = `${strokeColor}22`;
  ctx.fill();
}

// ============================================================
// STAGES STEPPER & STATUS UPDATER
// ============================================================
function setStage(stageName) {
  if (!UI.stageSteps) return;
  let activeFound = false;
  UI.stageSteps.forEach(step => {
    const st = step.getAttribute('data-stage');
    if (st === stageName) {
      step.classList.add('active');
      step.classList.remove('completed');
      activeFound = true;
    } else if (!activeFound) {
      step.classList.remove('active');
      step.classList.add('completed');
    } else {
      step.classList.remove('active', 'completed');
    }
  });
}

// ============================================================
// AUDIO BUZZER / TONE GENERATOR
// ============================================================
let audioCtx = null;
function playBuzzerBeep(freq = 880, durationMs = 120) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durationMs / 1000);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durationMs / 1000);
  } catch (e) {
    // Audio context may be restricted
  }
}

// ============================================================
// EVENT LOG & COMMS FEED WRITER
// ============================================================
function addEventLog(eventText, statusText = 'SUCCESS') {
  if (!UI.eventLogTbody) return;
  const timeStr = getMissionTimeFormatted();
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${timeStr}</td>
    <td>${eventText}</td>
    <td class="text-green">${statusText}</td>
  `;
  UI.eventLogTbody.insertBefore(tr, UI.eventLogTbody.firstChild);
}

function addCommsLine(callsign, msgText) {
  if (!UI.commsStreamList) return;
  const timeStr = getMissionTimeFormatted();
  const div = document.createElement('div');
  div.className = 'comm-line';
  div.innerHTML = `
    <span class="c-time">${timeStr}</span>
    <span class="c-callsign">${callsign}</span>
    <span class="c-msg">${msgText}</span>
    <span class="c-audio-icon">🔊</span>
  `;
  UI.commsStreamList.insertBefore(div, UI.commsStreamList.firstChild);
  playBuzzerBeep(1200, 80);
}

// ============================================================
// ESP32 HARDWARE REST API COMMUNICATOR
// ============================================================
async function sendCommand(command) {
  try {
    const res = await fetch(`/command?cmd=${encodeURIComponent(command)}&t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const txt = await res.text();
      console.log('ESP32 Hardware Response:', txt);
    }
  } catch (e) {
    // Local simulation fallback
  }
}

// ============================================================
// MISSION SEQUENCE CONTROLLER
// ============================================================
function startFullMission() {
  if (state.isRunning) return;
  state.isRunning = true;
  state.isMissionSequence = true;
  state.phase = 'STARTUP';
  setStage('startup');

  // Trigger ESP32 Hardware Launch Sequence
  sendCommand('launch');

  if (UI.btnStartMission) UI.btnStartMission.disabled = true;
  if (UI.launchStatusText) UI.launchStatusText.textContent = 'STARTUP SEQUENCE';
  if (UI.launchStatusPill) UI.launchStatusPill.style.borderColor = '#38bdf8';

  addEventLog('Startup Sequence Initiated', 'COMPLETE');
  addCommsLine('SPACEX FLIGHT', 'Falcon 9, you are go for launch sequence.');

  // Begin Countdown Phase
  startCountdownPhase();
}

function startCountdownPhase() {
  state.phase = 'COUNTDOWN';
  let remaining = state.settings.countdownTime;

  if (UI.countdownOverlay) UI.countdownOverlay.style.display = 'flex';
  if (UI.countdownNumber) UI.countdownNumber.textContent = String(remaining).padStart(2, '0');

  state.countdownInterval = setInterval(() => {
    remaining--;
    if (UI.cdSecs) UI.cdSecs.textContent = String(remaining).padStart(2, '0');
    if (UI.countdownNumber) UI.countdownNumber.textContent = String(remaining).padStart(2, '0');

    if (remaining === 3) {
      setStage('ignition');
      state.phase = 'IGNITION';
      if (UI.flameContainer) UI.flameContainer.classList.add('active');
      state.thrust = 7607;
      state.chamberPressure = 97;
      if (UI.engineThrustVal) UI.engineThrustVal.textContent = '7,607 kN';
      if (UI.enginePressureVal) UI.enginePressureVal.textContent = '97 bar';
      addEventLog('Engine Ignition', 'COMPLETE');
      addCommsLine('SPACEX FLIGHT', 'Engine ignition sequence started.');
    }

    if (remaining <= 0) {
      clearInterval(state.countdownInterval);
      if (UI.countdownOverlay) UI.countdownOverlay.style.display = 'none';
      executeLiftoff();
    } else {
      playBuzzerBeep(880, 100);
    }
  }, 1000);
}

function executeLiftoff() {
  state.phase = 'LIFTOFF';
  setStage('liftoff');
  if (UI.launchStatusText) UI.launchStatusText.textContent = 'VEHICLE IN FLIGHT (ASCENT)';
  if (UI.launchStatusPill) UI.launchStatusPill.style.borderColor = '#22c55e';
  if (UI.feedFlightState) UI.feedFlightState.textContent = 'LIFTOFF';
  if (UI.flameContainer) UI.flameContainer.classList.add('active');

  addEventLog('Liftoff Confirmed: Rocket Going Up', 'SUCCESS');
  addCommsLine('F9', 'Liftoff confirmed. Rocket ascending to target altitude.');

  const launchSecs = state.settings.launchDuration || 5;
  const startTime = Date.now();

  function animateAscent() {
    const elapsed = (Date.now() - startTime) / 1000;
    const progress = Math.min(elapsed / launchSecs, 1.0);
    state.rocketPosition = progress;
    state.trajectoryProgress = progress * 0.5;

    // Telemetry curves
    state.altitude = (progress * 78.5).toFixed(1);
    state.speed = Math.round(progress * 5600);
    state.velocity = (progress * 2.1).toFixed(1);
    state.gForce = (1.0 + Math.sin(progress * Math.PI) * 2.4).toFixed(1);

    updateTelemetryDisplays();
    drawFlightTrajectory(state.trajectoryProgress);

    // Physical rocket lift animation (bottom to top)
    if (UI.rocketContainer && UI.vizArea) {
      const maxH = UI.vizArea.clientHeight - 160;
      UI.rocketContainer.style.bottom = `${18 + progress * maxH}px`;
    }

    if (progress > 0.4 && progress < 0.7) setStage('maxq');

    if (progress < 1.0 && state.isRunning) {
      requestAnimationFrame(animateAscent);
    } else if (state.isRunning) {
      // Reached top after 5s -> start coming down
      executeDescent();
    }
  }

  requestAnimationFrame(animateAscent);
}

// Rocket Comes DOWN after 5s
function executeDescent() {
  state.phase = 'BOOSTBACK';
  setStage('boostback');
  if (UI.launchStatusText) UI.launchStatusText.textContent = 'STAGE 1 RETURNING (DESCENT)';
  if (UI.feedFlightState) UI.feedFlightState.textContent = 'RETURNING';

  addEventLog('Peak Altitude Reached: Initiating Return', 'SUCCESS');
  addCommsLine('SPACEX FLIGHT', 'Rocket reached peak. Stage 1 descending back to pad.');

  const returnSecs = state.settings.returnDuration || 5;
  const returnStart = Date.now();

  function animateDescent() {
    const elapsed = (Date.now() - returnStart) / 1000;
    const returnProg = Math.min(elapsed / returnSecs, 1.0);
    const rocketPos = 1.0 - returnProg;
    state.rocketPosition = rocketPos;
    state.trajectoryProgress = 0.5 + returnProg * 0.5;

    // Telemetry reducing smoothly as rocket lands
    state.altitude = (rocketPos * 78.5).toFixed(1);
    state.speed = Math.round(rocketPos * 5600);
    state.velocity = (rocketPos * 2.1).toFixed(1);
    state.gForce = (1.0 + Math.sin(rocketPos * Math.PI) * 1.5).toFixed(1);

    updateTelemetryDisplays();
    drawFlightTrajectory(state.trajectoryProgress);

    // Physical rocket descent animation (top to bottom)
    if (UI.rocketContainer && UI.vizArea) {
      const maxH = UI.vizArea.clientHeight - 160;
      UI.rocketContainer.style.bottom = `${18 + rocketPos * maxH}px`;
    }

    if (returnProg < 1.0 && state.isRunning) {
      requestAnimationFrame(animateDescent);
    } else if (state.isRunning) {
      // Rocket safely landed back at bottom -> Turn off flames & Open Satellite Dashboard!
      if (UI.flameContainer) UI.flameContainer.classList.remove('active');
      state.thrust = 0;
      state.chamberPressure = 0;
      if (UI.engineThrustVal) UI.engineThrustVal.textContent = '0 kN';
      if (UI.enginePressureVal) UI.enginePressureVal.textContent = '0 bar';

      setStage('deploy');
      addEventLog('Stage 1 Touchdown Confirmed', 'SUCCESS');
      addCommsLine('SPACEX FLIGHT', 'Stage 1 touchdown complete. Launching Satellite Mission Control Dashboard.');

      // Automatically Open the Satellite Mission Control Dashboard!
      setTimeout(() => {
        openSatModal();
        completeMission();
      }, 600);
    }
  }

  requestAnimationFrame(animateDescent);
}

function completeMission() {
  state.phase = 'COMPLETE';
  state.isRunning = false;
  if (UI.btnStartMission) UI.btnStartMission.disabled = false;
  if (UI.launchStatusText) UI.launchStatusText.textContent = 'MISSION COMPLETE';
  if (UI.launchStatusPill) UI.launchStatusPill.style.borderColor = '#38bdf8';
  if (UI.flameContainer) UI.flameContainer.classList.remove('active');

  addEventLog('Satellite Dashboard Activated', 'SUCCESS');
  addCommsLine('SPACEX FLIGHT', 'Satellite in orbit. Real-time satellite telemetry active.');
}

function stopMission() {
  state.isRunning = false;
  clearInterval(state.countdownInterval);
  sendCommand('stop');
  if (UI.countdownOverlay) UI.countdownOverlay.style.display = 'none';
  if (UI.flameContainer) UI.flameContainer.classList.remove('active');
  if (UI.btnStartMission) UI.btnStartMission.disabled = false;
  if (UI.launchStatusText) UI.launchStatusText.textContent = 'ABORTED / STOPPED';
  if (UI.launchStatusPill) UI.launchStatusPill.style.borderColor = '#ef4444';

  addEventLog('Emergency Abort Triggered', 'ABORTED');
  addCommsLine('SPACEX FLIGHT', 'Mission aborted by flight controller.');
}

function resetSystem() {
  stopMission();
  sendCommand('reset');
  state.speed = 0;
  state.altitude = 0.0;
  state.velocity = 0.0;
  state.gForce = 1.0;
  state.rocketPosition = 0;
  state.orbitAngle = 0;

  if (UI.rocketContainer) UI.rocketContainer.style.bottom = '18px';
  if (UI.vizArea) {
    UI.vizArea.style.display = 'block';
  }
  if (UI.satelliteScene) UI.satelliteScene.style.display = 'none';
  if (UI.launchStatusText) UI.launchStatusText.textContent = 'GO FOR LAUNCH';
  if (UI.launchStatusPill) UI.launchStatusPill.style.borderColor = 'rgba(34, 197, 94, 0.35)';

  setStage('startup');
  updateTelemetryDisplays();
  drawFlightTrajectory(0);
  addEventLog('System Reset: Ready', 'COMPLETE');
}

// ============================================================
// TELEMETRY UPDATERS (GAUGES + FEED BAR)
// ============================================================
function updateTelemetryDisplays() {
  // Feed HUD Bar
  if (UI.feedSpeed) UI.feedSpeed.textContent = state.speed;
  if (UI.feedAltitude) UI.feedAltitude.textContent = state.altitude;
  if (UI.feedVelocity) UI.feedVelocity.textContent = state.velocity;
  if (UI.feedGForce) UI.feedGForce.textContent = state.gForce;

  // Radial Gauges
  if (UI.dialSpeed) UI.dialSpeed.textContent = state.speed;
  if (UI.dialAltitude) UI.dialAltitude.textContent = state.altitude;
  if (UI.dialVelocity) UI.dialVelocity.textContent = state.velocity;
  if (UI.dialGForce) UI.dialGForce.textContent = state.gForce;

  // SVG Gauge Rings (circumference = 264)
  const maxDash = 264;
  if (UI.gaugeRingSpeed) {
    const pct = Math.min(state.speed / 6000, 1.0);
    UI.gaugeRingSpeed.style.strokeDashoffset = maxDash - pct * maxDash;
  }
  if (UI.gaugeRingAltitude) {
    const pct = Math.min(state.altitude / 80, 1.0);
    UI.gaugeRingAltitude.style.strokeDashoffset = maxDash - pct * maxDash;
  }
  if (UI.gaugeRingVelocity) {
    const pct = Math.min(state.velocity / 3.0, 1.0);
    UI.gaugeRingVelocity.style.strokeDashoffset = maxDash - pct * maxDash;
  }
  if (UI.gaugeRingGForce) {
    const pct = Math.min(state.gForce / 4.0, 1.0);
    UI.gaugeRingGForce.style.strokeDashoffset = maxDash - pct * maxDash;
  }
}

// ============================================================
// STARS CANVAS BACKGROUND
// ============================================================
function initStarsCanvas() {
  if (!UI.starsCanvas || !UI.vizArea) return;
  const canvas = UI.starsCanvas;
  canvas.width = UI.vizArea.clientWidth || 800;
  canvas.height = UI.vizArea.clientHeight || 400;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = Math.random() * 1.5;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.2 + Math.random() * 0.8})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============================================================
// SATELLITE MISSION CONTROL MODAL ENGINE (RETAINED)
// ============================================================
let smcAnimationFrame = null;
let smcClockInterval = null;
let globeRotation = 0;
let globeZoom = 1.0;

const smcData = {
  activeSat: 'Sentinel-2A',
  lat: 19.0760,
  lon: 72.8777,
  alt: 786.2,
  spd: 7.46,
  history: {
    bat: [90.5, 90.8, 91.0, 91.2, 91.0, 90.9, 91.0],
    temp: [27.8, 28.1, 28.4, 28.6, 28.5, 28.3, 28.4],
    solar: [1.80, 1.82, 1.84, 1.85, 1.84, 1.83, 1.84],
    sig: [-73, -72, -71, -70, -71, -72, -71]
  }
};

const worldMapImg = new Image();
worldMapImg.src = 'world_map_bg.jpg';
let worldMapLoaded = false;
worldMapImg.onload = () => { worldMapLoaded = true; };

function openSatModal() {
  window.location.href = 'satellite.html';
}

function closeSatModal() {
  // Standalone page
}

function startSMCLoop() {
  if (smcAnimationFrame) cancelAnimationFrame(smcAnimationFrame);
  function loop() {
    const orbitProg = (Date.now() / 8000) % 1;
    globeRotation += 0.003;
    draw3DGlobe(orbitProg);
    draw2DGroundTrack(orbitProg);
    drawHistoryCharts();
    if (UI.satModalOverlay && UI.satModalOverlay.style.display !== 'none') {
      smcAnimationFrame = requestAnimationFrame(loop);
    }
  }
  smcAnimationFrame = requestAnimationFrame(loop);
}

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

  // Atmospheric glow
  const glowGrad = ctx.createRadialGradient(cx, cy, baseR * 0.95, cx, cy, baseR * 1.25);
  glowGrad.addColorStop(0, 'rgba(56, 189, 248, 0.45)');
  glowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR * 1.25, 0, Math.PI * 2);
  ctx.fill();

  // Ocean sphere
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#0369a1';
  ctx.fillRect(cx - baseR, cy - baseR, baseR * 2, baseR * 2);

  // Continents
  ctx.fillStyle = '#15803d';
  for (let c = 0; c < 6; c++) {
    const angle = (c * (Math.PI * 2 / 6) + globeRotation) % (Math.PI * 2);
    const contX = cx + Math.cos(angle) * (baseR * 0.7);
    const contY = cy + Math.sin(c * 1.8) * (baseR * 0.5);
    if (Math.sin(angle) > -0.2) {
      ctx.beginPath();
      ctx.ellipse(contX, contY, baseR * 0.25, baseR * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // Orbit path
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.38);
  ctx.beginPath();
  ctx.ellipse(0, 0, baseR * 1.35, baseR * 0.62, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#eab308';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Sat dot
  const satX = Math.cos(orbitProg * Math.PI * 2) * (baseR * 1.35);
  const satY = Math.sin(orbitProg * Math.PI * 2) * (baseR * 0.62);
  ctx.beginPath();
  ctx.arc(satX, satY, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#38bdf8';
  ctx.fill();
  ctx.restore();
}

function draw2DGroundTrack(orbitProg) {
  const canvas = document.getElementById('smc2DTrackCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (worldMapLoaded && worldMapImg.complete) {
    ctx.drawImage(worldMapImg, 0, 0, w, h);
  } else {
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, w, h);
  }

  // Sine ground track
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const y = h / 2 + Math.sin((x / w + orbitProg) * Math.PI * 2) * (h * 0.38);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2.0;
  ctx.stroke();

  // Sat marker
  const satX = (orbitProg * w) % w;
  const satY = h / 2 + Math.sin((satX / w + orbitProg) * Math.PI * 2) * (h * 0.38);
  ctx.beginPath();
  ctx.arc(satX, satY, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#38bdf8';
  ctx.fill();
}

function drawHistoryCharts() {
  drawSparkline('chartBatCanvas', smcData.history.bat, '#22c55e');
  drawSparkline('chartTempCanvas', smcData.history.temp, '#eab308');
  drawSparkline('chartSolarCanvas', smcData.history.solar, '#38bdf8');
  drawSparkline('chartSigCanvas', smcData.history.sig, '#a855f7');
}

function drawSparkline(canvasId, dataArr, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  dataArr.forEach((val, i) => {
    const x = (i / (dataArr.length - 1)) * w;
    const y = h - ((val - Math.min(...dataArr)) / (Math.max(...dataArr) - Math.min(...dataArr) || 1)) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
