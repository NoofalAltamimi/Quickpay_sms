const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay 
} = require("@whiskeysockets/baileys");
const express = require("express");
const qrcode = require("qrcode");
const pino = require("pino");

const app = express();
app.use(express.json());

// التوكن السري - يفضل تغييره أو استخدامه من متغيرات البيئة
const AUTH_TOKEN = process.env.AUTH_TOKEN || "d55191dccb450fc81a3f234de626cb07";

let sock;
let qrCodeData = null;
let connectionStatus = "disconnected";

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }), // تقليل السجلات لزيادة السرعة
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeData = qr;
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = "disconnected";
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            connectionStatus = "connected";
            qrCodeData = null;
            console.log('✅ WhatsApp Connected Successfully');
        }
    });
}

// 1. مسار جلب الـ QR Code كصورة Base64
app.get("/devices/:id/qr", async (req, res) => {
    // التحقق من التوكن
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${AUTH_TOKEN}`) return res.status(401).json({ error: "Unauthorized" });

    if (connectionStatus === "connected") {
        return res.json({ status: "already_connected" });
    }

    if (qrCodeData) {
        try {
            const qrImage = await qrcode.toDataURL(qrCodeData);
            return res.json({ qr: qrImage });
        } catch (err) {
            return res.status(500).json({ error: "Failed to generate QR image" });
        }
    } else {
        return res.status(404).json({ error: "QR not ready yet, please retry in seconds" });
    }
});

// 2. مسار إرسال الرسائل (OTP / Notifications)
app.post("/send", async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${AUTH_TOKEN}`) return res.status(401).json({ error: "Unauthorized" });

    const { number, message } = req.body;

    if (connectionStatus !== "connected") {
        return res.status(503).json({ error: "WhatsApp not connected" });
    }

    try {
        // تهيئة الرقم الدولي (إزالة أي رموز غير رقمية وإضافة JID)
        const cleanNumber = number.replace(/\D/g, '');
        const jid = `${cleanNumber}@s.whatsapp.net`;

        await sock.sendMessage(jid, { text: message });
        res.json({ status: "success", to: cleanNumber });
    } catch (err) {
        res.status(500).json({ status: "error", error: err.message });
    }
});

// مسار لفحص حالة الخادم (Health Check)
app.get("/status", (req, res) => {
    res.json({ status: connectionStatus });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Gateway is running on port ${PORT}`);
    connectToWhatsApp();
});
