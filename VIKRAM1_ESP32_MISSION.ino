/*
  ============================================================
              VIKRAM-1 / KES SPACE MISSION
              ESP32 UNIFIED MASTER CONTROLLER
  ============================================================

  HARDWARE CONFIGURATION:
    ESP32 Dev Module
    Buzzer            -> GPIO 15
    Rocket Motor CW   -> GPIO 26 (Relay 1 - Lift Up)
    Rocket Motor CCW  -> GPIO 27 (Relay 2 - Return Down)
    Satellite Motor   -> GPIO 14 (Relay 3 / Orbit Motor)
    Status LED        -> GPIO 2  (Onboard Blue LED)

  NETWORK:
    SoftAP SSID       : KES Space Mission (or VIKRAM-1 Space Mission)
    SoftAP Password   : kes12345
    IP Address        : 192.168.4.1
    Web Server Port   : 80

  UNIFIED MISSION WORKFLOW:
    1. System is READY at http://192.168.4.1 (Main Launch Dashboard)
    2. User clicks "START FULL MISSION" (cmd=launch)
    3. Buzzer Countdown:
       5, 4, 3, 2, 1 -> 1200Hz Short Beeps (120ms)
       1 -> 900Hz Long Ignition Beep (1800ms)
       700ms Silent Gap
       1800Hz Final Beep (100ms) -> "GO!"
    4. Rocket Ascent (Motor CW active, 0% to 100% over 5s/10s)
    5. Rocket Descent (Motor CCW active, 100% to 0% over 5s/10s)
    6. Landed: Rocket motor stops, Satellite Orbit Motor activates!
    7. Web interface automatically opens Satellite Mission Control (satellite.html)!
  ============================================================
*/

#include <WiFi.h>
#include <WebServer.h>
#include <LittleFS.h>

// ============================================================
// CONFIGURATION & PINS
// ============================================================
const char* AP_SSID     = "KES Space Mission";
const char* AP_PASSWORD = "kes12345";

const uint8_t BUZZER_PIN     = 15;
const uint8_t RELAY_CW_PIN   = 26; // Motor Up (Lift)
const uint8_t RELAY_CCW_PIN  = 27; // Motor Down (Return)
const uint8_t RELAY_SAT_PIN  = 14; // Satellite Orbit Motor
const uint8_t LED_PIN        = 2;  // Status LED

WebServer server(80);

// ============================================================
// TIMINGS
// ============================================================
unsigned long FULL_TRAVEL_TIME = 5000;   // 5 seconds travel time (configurable)
const unsigned long SHORT_BEEP_TIME  = 120;
const unsigned long LONG_BEEP_TIME   = 1800;
const unsigned long FINAL_BEEP_GAP   = 700;
const unsigned long FINAL_BEEP_TIME  = 100;

// ============================================================
// MISSION STATES
// ============================================================
enum MissionState {
  READY,
  COUNTDOWN,
  LAUNCHING,       // Rocket going UP
  PAUSED_LAUNCH,
  HOLDING,         // At peak
  LANDING,         // Rocket coming DOWN
  PAUSED_LANDING,
  LANDED,          // Touchdown complete
  SATELLITE_ORBIT  // Satellite in orbit
};

MissionState state = READY;

// ============================================================
// BUZZER ENGINE STATES
// ============================================================
enum BuzzerPhase {
  BUZZER_IDLE,
  BUZZER_COUNTDOWN,
  BUZZER_LONG,
  BUZZER_GAP,
  BUZZER_FINAL
};

BuzzerPhase buzzerPhase = BUZZER_IDLE;
unsigned long buzzerStarted  = 0;
unsigned long buzzerDuration = 0;

// Countdown variables
int countdownValue = 0;
unsigned long countdownStarted = 0;

// Rocket position (0.0% = bottom, 100.0% = top)
float rocketPosition = 0.0;
unsigned long movementStarted = 0;
float movementStartPosition = 0.0;
float movementTargetPosition = 0.0;
unsigned long movementDuration = 0;

// Satellite State & Orbit
bool satelliteActive = false;
float satelliteAngle = 0.0;
float satelliteSpeed = 1.0;
int satelliteDirection = 1; // 1 = Prograde, -1 = Retrograde
bool satellitePaused = false;
unsigned long lastSatUpdate = 0;

// Telemetry Metrics
float teleSpeed = 0;
float teleAltitude = 0;
float teleVelocity = 0;
float teleGForce = 1.0;
int teleThrust = 0;

// ============================================================
// BUZZER CONTROL FUNCTIONS
// ============================================================
void startBuzzer(unsigned int frequency, unsigned long duration, BuzzerPhase phase) {
  tone(BUZZER_PIN, frequency);
  buzzerStarted = millis();
  buzzerDuration = duration;
  buzzerPhase = phase;
}

void stopBuzzer() {
  noTone(BUZZER_PIN);
  buzzerPhase = BUZZER_IDLE;
  buzzerStarted = 0;
  buzzerDuration = 0;
}

void updateBuzzer() {
  if (buzzerPhase == BUZZER_IDLE) return;
  if (millis() - buzzerStarted < buzzerDuration) return;

  // 1. Long beep finished -> enter 700ms silent gap
  if (buzzerPhase == BUZZER_LONG) {
    noTone(BUZZER_PIN);
    Serial.println("LONG IGNITION BEEP FINISHED -> 700ms SILENT GAP");
    buzzerStarted = millis();
    buzzerDuration = FINAL_BEEP_GAP;
    buzzerPhase = BUZZER_GAP;
    return;
  }

  // 2. Silent gap finished -> final short beep
  if (buzzerPhase == BUZZER_GAP) {
    Serial.println("FINAL HIGH-PITCH BEEP");
    startBuzzer(1800, FINAL_BEEP_TIME, BUZZER_FINAL);
    return;
  }

  // 3. Final beep finished -> GO! Start Rocket Ascent!
  if (buzzerPhase == BUZZER_FINAL) {
    noTone(BUZZER_PIN);
    buzzerPhase = BUZZER_IDLE;
    Serial.println("FINAL BEEP FINISHED -> GO! LIFTOFF & ASCENT");
    startLaunchMovement();
    return;
  }

  // 4. Countdown beep finished
  if (buzzerPhase == BUZZER_COUNTDOWN) {
    noTone(BUZZER_PIN);
    buzzerPhase = BUZZER_IDLE;
    return;
  }
}

// ============================================================
// MOTOR HARDWARE CONTROL (RELAY)
// ============================================================
void motorStop() {
  digitalWrite(RELAY_CW_PIN, LOW);
  digitalWrite(RELAY_CCW_PIN, LOW);
}

void motorClockwise() {
  motorStop();
  delay(50);
  digitalWrite(RELAY_CW_PIN, HIGH);
  digitalWrite(RELAY_CCW_PIN, LOW);
}

void motorAnticlockwise() {
  motorStop();
  delay(50);
  digitalWrite(RELAY_CW_PIN, LOW);
  digitalWrite(RELAY_CCW_PIN, HIGH);
}

void satMotorOn() {
  digitalWrite(RELAY_SAT_PIN, HIGH);
}

void satMotorOff() {
  digitalWrite(RELAY_SAT_PIN, LOW);
}

// ============================================================
// MOVEMENT CONTROLLER
// ============================================================
void stopMovement() {
  movementStarted = 0;
  movementDuration = 0;
  movementStartPosition = rocketPosition;
  movementTargetPosition = rocketPosition;
  motorStop();
}

void startLaunchMovement() {
  if (rocketPosition >= 100.0) {
    rocketPosition = 100.0;
    state = HOLDING;
    stopMovement();
    return;
  }

  state = LAUNCHING;
  teleThrust = 7607;
  movementStartPosition = rocketPosition;
  movementTargetPosition = 100.0;

  unsigned long remaining = (unsigned long)(FULL_TRAVEL_TIME * ((100.0 - rocketPosition) / 100.0));
  if (remaining < 1) remaining = 1;

  movementDuration = remaining;
  movementStarted = millis();

  Serial.println("ROCKET ASCENT: MOTOR CW (LIFTING UP)");
  motorClockwise();
}

void startLandingMovement() {
  if (rocketPosition <= 0.0) {
    rocketPosition = 0.0;
    state = LANDED;
    stopMovement();
    return;
  }

  state = LANDING;
  movementStartPosition = rocketPosition;
  movementTargetPosition = 0.0;

  unsigned long remaining = (unsigned long)(FULL_TRAVEL_TIME * (rocketPosition / 100.0));
  if (remaining < 1) remaining = 1;

  movementDuration = remaining;
  movementStarted = millis();

  Serial.println("ROCKET DESCENT: MOTOR CCW (COMING DOWN)");
  motorAnticlockwise();
}

void updateMovement() {
  if (state != LAUNCHING && state != LANDING) return;
  if (movementStarted == 0) return;

  unsigned long elapsed = millis() - movementStarted;
  float progress = (float)elapsed / (float)movementDuration;

  if (progress >= 1.0) {
    rocketPosition = movementTargetPosition;
    stopMovement();

    // 1. Reached Top -> Immediately start Descent after short pause
    if (state == LAUNCHING) {
      state = HOLDING;
      Serial.println("ROCKET REACHED TOP -> INITIATING RETURN DESCENT");
      delay(400);
      startLandingMovement();
    }
    // 2. Reached Bottom -> Landed! Activate Satellite Orbit!
    else if (state == LANDING) {
      state = SATELLITE_ORBIT;
      satelliteActive = true;
      teleThrust = 0;
      satMotorOn();
      Serial.println("ROCKET TOUCHDOWN -> SATELLITE ORBIT MOTOR ACTIVE");
    }
    return;
  }

  // Interpolate position and calculate live telemetry
  if (state == LAUNCHING) {
    rocketPosition = movementStartPosition + ((100.0 - movementStartPosition) * progress);
    teleAltitude = (rocketPosition / 100.0) * 78.5;
    teleSpeed = (rocketPosition / 100.0) * 5600;
    teleVelocity = (rocketPosition / 100.0) * 2.1;
    teleGForce = 1.0 + sin(progress * 3.1415) * 2.4;
  } else if (state == LANDING) {
    rocketPosition = movementStartPosition - (movementStartPosition * progress);
    teleAltitude = (rocketPosition / 100.0) * 78.5;
    teleSpeed = (rocketPosition / 100.0) * 5600;
    teleVelocity = (rocketPosition / 100.0) * 2.1;
    teleGForce = 1.0 + sin(rocketPosition / 100.0 * 3.1415) * 1.5;
  }
}

// ============================================================
// COUNTDOWN SEQUENCE UPDATE
// ============================================================
void updateCountdown() {
  if (state != COUNTDOWN) return;
  if (millis() - countdownStarted < 1000) return;

  countdownStarted = millis();

  // 5 -> 4 -> 3 -> 2 -> 1
  if (countdownValue > 1) {
    countdownValue--;
    Serial.print("COUNTDOWN: ");
    Serial.println(countdownValue);
    startBuzzer(1200, SHORT_BEEP_TIME, BUZZER_COUNTDOWN);
    return;
  }

  // 1 -> Long Ignition Beep
  if (countdownValue == 1) {
    countdownValue = 0;
    Serial.println("COUNTDOWN: 1 -> LONG IGNITION BEEP (900Hz)");
    startBuzzer(900, LONG_BEEP_TIME, BUZZER_LONG);
    return;
  }
}

// ============================================================
// SATELLITE ROTATION SIMULATOR
// ============================================================
void updateSatellite() {
  if (!satelliteActive || satellitePaused) return;
  if (millis() - lastSatUpdate < 30) return;
  lastSatUpdate = millis();

  satelliteAngle += (1.5 * satelliteSpeed * satelliteDirection);
  if (satelliteAngle >= 360.0) satelliteAngle -= 360.0;
  if (satelliteAngle < 0.0) satelliteAngle += 360.0;
}

// ============================================================
// STATUS HELPERS
// ============================================================
const char* stateName() {
  switch (state) {
    case READY:           return "READY";
    case COUNTDOWN:       return "COUNTDOWN";
    case LAUNCHING:       return "LAUNCHING";
    case PAUSED_LAUNCH:   return "PAUSED LAUNCH";
    case HOLDING:         return "HOLDING";
    case LANDING:         return "LANDING";
    case PAUSED_LANDING:  return "PAUSED LANDING";
    case LANDED:          return "LANDED";
    case SATELLITE_ORBIT: return "SATELLITE_ORBIT";
  }
  return "UNKNOWN";
}

const char* directionName() {
  switch (state) {
    case LAUNCHING: return "CLOCKWISE";
    case LANDING:   return "ANTICLOCKWISE";
    default:        return "STOP";
  }
}

// ============================================================
// REST API HANDLERS
// ============================================================
void handleStatus() {
  String json;
  json.reserve(320);

  json += "{";
  json += "\"state\":\"" + String(stateName()) + "\",";
  json += "\"position\":" + String(rocketPosition, 1) + ",";
  json += "\"countdown\":" + String(countdownValue) + ",";
  json += "\"direction\":\"" + String(directionName()) + "\",";
  json += "\"speed\":" + String(teleSpeed, 0) + ",";
  json += "\"altitude\":" + String(teleAltitude, 1) + ",";
  json += "\"velocity\":" + String(teleVelocity, 1) + ",";
  json += "\"gForce\":" + String(teleGForce, 1) + ",";
  json += "\"thrust\":" + String(teleThrust) + ",";
  json += "\"satState\":\"" + String(satelliteActive ? "ORBITING" : "OFF") + "\",";
  json += "\"satAngle\":" + String(satelliteAngle, 1) + ",";
  json += "\"satSpeed\":" + String(satelliteSpeed, 1) + ",";
  json += "\"satDir\":\"" + String(satelliteDirection == 1 ? "PROGRADE" : "RETROGRADE") + "\"";
  json += "}";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json; charset=utf-8", json);
}

void handleCommand() {
  if (!server.hasArg("cmd")) {
    server.send(400, "text/plain; charset=utf-8", "Missing command parameter");
    return;
  }

  String command = server.arg("cmd");
  Serial.print("COMMAND RECEIVED: ");
  Serial.println(command);

  // --- 1. LAUNCH ---
  if (command == "launch") {
    if (state == READY || state == LANDED || state == SATELLITE_ORBIT) {
      rocketPosition = 0.0;
      countdownValue = 5;
      state = COUNTDOWN;
      countdownStarted = millis();
      satelliteActive = false;
      satMotorOff();
      stopBuzzer();

      Serial.println("\n================================");
      Serial.println("LAUNCH SEQUENCE STARTED (T-5s)");
      startBuzzer(1200, SHORT_BEEP_TIME, BUZZER_COUNTDOWN);

      server.sendHeader("Access-Control-Allow-Origin", "*");
      server.send(200, "text/plain; charset=utf-8", "Launch sequence initiated");
      return;
    }

    if (state == PAUSED_LAUNCH) {
      startLaunchMovement();
      server.send(200, "text/plain; charset=utf-8", "Launch continued");
      return;
    }

    if (state == PAUSED_LANDING) {
      startLaunchMovement();
      server.send(200, "text/plain; charset=utf-8", "Launch resumed");
      return;
    }
  }

  // --- 2. STOP ---
  if (command == "stop") {
    if (state == COUNTDOWN) {
      state = READY;
      countdownValue = 0;
      stopBuzzer();
      server.send(200, "text/plain; charset=utf-8", "Countdown stopped");
      return;
    }

    if (state == LAUNCHING) {
      state = PAUSED_LAUNCH;
      stopMovement();
      server.send(200, "text/plain; charset=utf-8", "Launch paused");
      return;
    }

    if (state == LANDING) {
      state = PAUSED_LANDING;
      stopMovement();
      server.send(200, "text/plain; charset=utf-8", "Landing paused");
      return;
    }

    if (state == SATELLITE_ORBIT) {
      satelliteActive = false;
      satMotorOff();
      server.send(200, "text/plain; charset=utf-8", "Satellite orbit stopped");
      return;
    }
  }

  // --- 3. LAND ---
  if (command == "land") {
    if (state == HOLDING || state == LAUNCHING || state == PAUSED_LAUNCH) {
      startLandingMovement();
      server.send(200, "text/plain; charset=utf-8", "Landing started");
      return;
    }
    if (state == PAUSED_LANDING) {
      startLandingMovement();
      server.send(200, "text/plain; charset=utf-8", "Landing continued");
      return;
    }
  }

  // --- 4. SATELLITE SPEED CONTROL ---
  if (command == "sat_speed" && server.hasArg("val")) {
    satelliteSpeed = server.arg("val").toFloat();
    server.send(200, "text/plain; charset=utf-8", "Satellite speed updated");
    return;
  }

  // --- 5. SATELLITE DIRECTION CONTROL ---
  if (command == "sat_dir") {
    satelliteDirection *= -1;
    server.send(200, "text/plain; charset=utf-8", "Satellite direction reversed");
    return;
  }

  // --- 6. SATELLITE PAUSE CONTROL ---
  if (command == "sat_pause") {
    satellitePaused = !satellitePaused;
    server.send(200, "text/plain; charset=utf-8", "Satellite pause toggled");
    return;
  }

  // --- 7. RESET ---
  if (command == "reset") {
    stopMovement();
    stopBuzzer();
    satMotorOff();
    state = READY;
    rocketPosition = 0.0;
    satelliteActive = false;
    satelliteAngle = 0.0;
    teleSpeed = 0;
    teleAltitude = 0;
    teleVelocity = 0;
    teleGForce = 1.0;
    teleThrust = 0;
    server.send(200, "text/plain; charset=utf-8", "System reset to READY");
    return;
  }

  server.send(400, "text/plain; charset=utf-8", "Unknown command");
}

// ============================================================
// LITTLEFS STATIC FILE SERVER
// ============================================================
bool loadFromLittleFS(String path) {
  String dataType = "text/plain";
  if (path.endsWith("/")) path += "index.html";

  if (path.endsWith(".html")) dataType = "text/html";
  else if (path.endsWith(".css")) dataType = "text/css";
  else if (path.endsWith(".js"))  dataType = "application/javascript";
  else if (path.endsWith(".jpg") || path.endsWith(".jpeg")) dataType = "image/jpeg";
  else if (path.endsWith(".png")) dataType = "image/png";
  else if (path.endsWith(".svg")) dataType = "image/svg+xml";

  if (LittleFS.exists(path)) {
    File file = LittleFS.open(path, "r");
    server.streamFile(file, dataType);
    file.close();
    return true;
  }
  return false;
}

void handleNotFound() {
  if (loadFromLittleFS(server.uri())) return;
  server.send(404, "text/plain; charset=utf-8", "404 Not Found");
}

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(100);

  // Pin Modes
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RELAY_CW_PIN, OUTPUT);
  pinMode(RELAY_CCW_PIN, OUTPUT);
  pinMode(RELAY_SAT_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);

  motorStop();
  satMotorOff();
  noTone(BUZZER_PIN);
  digitalWrite(LED_PIN, HIGH);

  // Initialize LittleFS
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS Mount: FAILED");
  } else {
    Serial.println("LittleFS Mount: SUCCESS");
  }

  // Start SoftAP
  WiFi.mode(WIFI_AP);
  bool apStarted = WiFi.softAP(AP_SSID, AP_PASSWORD);

  Serial.println("\n========================================");
  Serial.println("   VIKRAM-1 / KES SPACE MISSION (ESP32) ");
  Serial.println("========================================");
  Serial.print("SoftAP Status: ");
  Serial.println(apStarted ? "ACTIVE" : "FAILED");
  Serial.print("SSID         : ");
  Serial.println(AP_SSID);
  Serial.print("Password     : ");
  Serial.println(AP_PASSWORD);
  Serial.print("Web Server IP: ");
  Serial.println(WiFi.softAPIP());

  // Web Server Routes
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/command", HTTP_GET, handleCommand);
  server.onNotFound(handleNotFound);

  server.begin();
  Serial.println("HTTP Server: STARTED (Port 80)");
  Serial.println("Access Dashboards at: http://192.168.4.1\n");

  // Startup Buzzer Beep
  startBuzzer(1500, 200, BUZZER_COUNTDOWN);
}

// ============================================================
// MAIN LOOP
// ============================================================
void loop() {
  server.handleClient();
  updateBuzzer();
  updateCountdown();
  updateMovement();
  updateSatellite();
}
