
const mqtt = require("mqtt");


const BROKER_URL = process.env.BROKER_URL || "mqtt://broker.hivemq.com";
const BASE = "korompis/smart-garage"; 
const DEVICE_ID = "esp32-001";

const TOPIC_TELEMETRY = `${BASE}/${DEVICE_ID}/telemetry`; 
const TOPIC_ACTUATOR = `${BASE}/${DEVICE_ID}/actuator`;   
const TOPIC_COMMAND = `${BASE}/${DEVICE_ID}/command`;     
// Daftar tag RFID simulasi (UHF RFID Reader membaca tag di kendaraan)
const RFID_TAGS = [
  "E200-0001-AAAA", // terdaftar
  "E200-0002-BBBB", // terdaftar
  "E200-9999-ZZZZ", // TIDAK terdaftar (untuk uji penolakan)
];

let doorState = "closed"; // "open" | "closed" (kondisi stepper/relay)
let moving = false;

const client = mqtt.connect(BROKER_URL, { connectTimeout: 10_000, reconnectPeriod: 2_000 });
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// ---- Simulasi pembacaan OBD-II lewat BLE ----
function readObd() {
  const engineOn = Math.random() < 0.6;
  return {
    vin: "MHFXX0000TEST0001",
    engineOn,
    speedKmh: engineOn ? (Math.random() < 0.7 ? rand(0, 4) : rand(5, 30)) : 0,
    rpm: engineOn ? rand(700, 2500) : 0,
    coolantC: rand(60, 95),
  };
}

// ---- Simulasi aktuator (stepper & relay) ----
function actuate(action) {
  if (moving) return console.log("⏳ Aktuator masih bergerak, perintah diabaikan");
  const target = action === "open" ? "open" : action === "close" ? "closed" : null;
  if (!target) return console.log("❓ Perintah tidak dikenal:", action);
  if (doorState === target) return console.log(`ℹ️  Pintu sudah ${target}`);

  moving = true;
  console.log(`⚙️  Stepper/relay bergerak -> ${target} ...`);
  setTimeout(() => {
    doorState = target;
    moving = false;
    publishActuator("done");
  }, 2000);
}

function publishActuator(event) {
  const payload = { deviceId: DEVICE_ID, doorState, event, timestamp: new Date().toISOString() };
  client.publish(TOPIC_ACTUATOR, JSON.stringify(payload), { qos: 0 });
  console.log("🔧 Actuator status:", JSON.stringify(payload));
}

client.on("connect", () => {
  console.log(`✅ ESP32 (${DEVICE_ID}) connected to broker:`, BROKER_URL);

  client.subscribe(TOPIC_COMMAND, (err) => {
    if (err) console.error("❌ Subscribe error:", err.message);
    else console.log("👂 Menunggu perintah di:", TOPIC_COMMAND);
  });

  publishActuator("boot");

  // Setiap 5 detik: tag RFID terbaca (atau tidak ada) + data OBD-II
  setInterval(() => {
    const tagDetected = Math.random() < 0.6;
    const payload = {
      deviceId: DEVICE_ID,
      rfid: tagDetected ? { tagId: RFID_TAGS[rand(0, RFID_TAGS.length - 1)], rssi: rand(-70, -40) } : null,
      obd: readObd(),
      doorState,
      timestamp: new Date().toISOString(),
    };
    client.publish(TOPIC_TELEMETRY, JSON.stringify(payload), { qos: 0 }, (err) => {
      if (err) console.error("❌ Publish error:", err.message);
      else console.log("📤 Telemetry:", JSON.stringify(payload));
    });
  }, 5000);
});

// Perintah dari Gateway -> jalankan aktuator
client.on("message", (topic, message) => {
  if (topic !== TOPIC_COMMAND) return;
  try {
    const cmd = JSON.parse(message.toString());
    console.log("📥 Command diterima:", JSON.stringify(cmd));
    actuate(cmd.action);
  } catch {
    console.error("❌ Command bukan JSON valid");
  }
});

client.on("reconnect", () => console.log("🔄 Reconnecting..."));
client.on("error", (err) => console.error("❌ MQTT error:", err.message));
client.on("close", () => console.log("🔌 Connection closed"));