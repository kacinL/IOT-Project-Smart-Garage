
const mqtt = require("mqtt");
const crypto = require("crypto");
const fs = require("fs");

const BROKER_URL = process.env.BROKER_URL || "mqtt://broker.hivemq.com";
const BASE = "korompis/smart-garage"; 
const DEVICE_ID = "esp32-001";

const TOPIC_TELEMETRY = `${BASE}/${DEVICE_ID}/telemetry`;
const TOPIC_ACTUATOR = `${BASE}/${DEVICE_ID}/actuator`;
const TOPIC_COMMAND = `${BASE}/${DEVICE_ID}/command`;

const AUTHORIZED_TAGS = new Set(["E200-0001-AAAA", "E200-0002-BBBB"]);
const MAX_SPEED_TO_OPEN_KMH = 5; 


const LEDGER_FILE = "ledger.json";
let chain = [];
try { chain = JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8")); } catch { chain = []; }

function addBlock(event) {
  const prevHash = chain.length ? chain[chain.length - 1].hash : "0".repeat(64);
  const block = { index: chain.length, timestamp: new Date().toISOString(), event, prevHash };
  block.hash = crypto.createHash("sha256").update(JSON.stringify({ ...block })).digest("hex");
  chain.push(block);
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(chain, null, 2));
  console.log(`⛓️  Block #${block.index} tercatat | hash: ${block.hash.slice(0, 16)}...`);
}

// ---------------------------------------------------------------------
const client = mqtt.connect(BROKER_URL, { connectTimeout: 10_000, reconnectPeriod: 2_000 });

function sendCommand(action, reason) {
  client.publish(TOPIC_COMMAND, JSON.stringify({ action, reason, timestamp: new Date().toISOString() }), { qos: 0 });
  console.log(`📨 Command dikirim ke ESP32: ${action} (${reason})`);
}

client.on("connect", () => {
  console.log("✅ Gateway connected:", BROKER_URL);
  client.subscribe([TOPIC_TELEMETRY, TOPIC_ACTUATOR], (err) => {
    if (err) console.error("❌ Subscribe error:", err.message);
    else console.log("👂 Listening on:", TOPIC_TELEMETRY, "&", TOPIC_ACTUATOR);
  });
});

client.on("message", (topic, message) => {
  let data;
  try { data = JSON.parse(message.toString()); }
  catch { return console.error("❌ Payload bukan JSON valid"); }


  if (topic === TOPIC_ACTUATOR) {
    console.log("🔧 Actuator:", data.event, "| pintu:", data.doorState);
    if (data.event === "done") addBlock({ type: "DOOR_STATE", doorState: data.doorState, deviceId: data.deviceId });
    return;
  }

  
  console.log("📥 Received:", message.toString());
  if (!data.rfid) return; // tidak ada tag terbaca

  const { tagId } = data.rfid;
  const speed = data.obd?.speedKmh ?? 0;

  if (!AUTHORIZED_TAGS.has(tagId)) {
    console.log(`🚫 Tag ${tagId} TIDAK terdaftar -> akses ditolak`);
    addBlock({ type: "ACCESS_DENIED", tagId, reason: "unregistered", deviceId: data.deviceId });
    return;
  }
  if (speed > MAX_SPEED_TO_OPEN_KMH) {
    console.log(`⚠️  Tag ${tagId} valid, tapi kecepatan ${speed} km/jam terlalu tinggi -> pintu tidak dibuka`);
    addBlock({ type: "ACCESS_BLOCKED", tagId, reason: "speed", speedKmh: speed, deviceId: data.deviceId });
    return;
  }
  if (data.doorState === "open") return console.log("ℹ️  Pintu sudah terbuka");

  console.log(`✅ Tag ${tagId} valid (VIN ${data.obd?.vin}) -> buka pintu`);
  addBlock({ type: "ACCESS_GRANTED", tagId, vin: data.obd?.vin, speedKmh: speed, deviceId: data.deviceId });
  sendCommand("open", "rfid-authorized");
});

client.on("error", (err) => console.error("❌ MQTT error:", err.message));