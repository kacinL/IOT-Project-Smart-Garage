// processor.js -> Backend yang menghash data IoT (siap disimpan ke blockchain)
const mqtt = require("mqtt");
const crypto = require("crypto");

// Alamat broker bisa diganti lewat: BROKER_URL=mqtt://localhost:1883
const BROKER_URL = process.env.BROKER_URL || "mqtt://broker.hivemq.com";

// HARUS sama dengan topik di sensor.js
const BASE = "korompis/smart-garage";
const DEVICE_ID = "esp32-001";
const TOPICS = [
  `${BASE}/${DEVICE_ID}/telemetry`, // data RFID + OBD-II
  `${BASE}/${DEVICE_ID}/actuator`,  // status pintu
];

const client = mqtt.connect(BROKER_URL, {
  connectTimeout: 10000,
  reconnectPeriod: 2000,
});

client.on("connect", () => {
  console.log("✅ Backend connected to MQTT broker:", BROKER_URL);
  client.subscribe(TOPICS, (err) => {
    if (err) console.error("❌ Subscribe error:", err.message);
    else console.log("👂 Backend listening on:", TOPICS.join(" & "));
  });
});

client.on("message", (topic, message) => {
  try {
    const raw = message.toString();
    const data = JSON.parse(raw);

    // SHA256 dari pesan asli (persis seperti yang dikirim sensor)
    const hash = crypto.createHash("sha256").update(raw).digest("hex");

    const blockchainReadyPayload = {
      deviceId: data.deviceId,
      type: topic.endsWith("/actuator") ? "ACTUATOR" : "TELEMETRY",
      dataHash: hash,
      receivedAt: new Date().toISOString(),
    };

    console.log("\n📥 Data received from:", topic);
    console.log(data);
    console.log("🔐 SHA256 Hash:", hash);
    console.log("📦 Blockchain-ready payload:", blockchainReadyPayload);
  } catch (err) {
    console.error("❌ Error processing message:", err.message);
    console.error("Raw message:", message.toString());
  }
});

client.on("reconnect", () => console.log("🔄 Reconnecting to broker..."));
client.on("error", (err) => console.error("❌ MQTT error:", err.message));
client.on("close", () => console.log("🔌 Connection closed"));