const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require("@whiskeysockets/baileys");
const express = require("express");
const qrcode = require("qrcode");
const cors = require("cors");
const pino = require("pino");

const app = express();

// تفعيل CORS للسماح لتطبيق Lovable بالوصول للخادم
app.use(cors());
app.use(express.json());

// التوكن السري (تأكد من مطابقته في إعدادات التطبيق)
const AUTH_TOKEN = "d55191dccb450fc81a3f234de626cb07";

let sock;
let qrCodeData = null;
let connectionStatus = "disconnected";

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
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

// 1. مسار جلب الـ QR Code (المسار الذي يطلبه التطبيق)
app.get("/devices/:id/qr", async (req, res) => {
    // التحقق من التوكن في الـ Header
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(401).json({ error: "Unauthorized - Token Mismatch" });
    }

    if (connectionStatus === "connected") {
        return res.json({ status: "already_connected" });
    }

    if (qrCodeData) {
        try {
            const qrImage = await qrcode.toDataURL(qrCodeData);
            // إرسال الـ QR كـ Base64 ليعرضه التطبيق فوراً
            return res.json({ qr: qrImage });
        } catch (err) {
            return res.status(500).json({ error: "Failed to generate QR" });
        }
    } else {
        return res.status(404).json({ error: "QR not ready, please wait..." });
    }
});

// 2. مسار إرسال الرسائل
app.post("/send", async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${AUTH_TOKEN}`) return res.status(401).json({ error: "Unauthorized" });

    const { number, message } = req.body;

    if (connectionStatus !== "connected") {
        return res.status(503).json({ error: "WhatsApp not connected" });
    }

    try {
        const cleanNumber = number.replace(/\D/g, '');
        const jid = `${cleanNumber}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ status: "success" });
    } catch (err) {
        res.status(500).json({ status: "error", error: err.message });
    }
});

// مسار فحص الحالة
app.get("/status", (req, res) => {
    res.json({ status: connectionStatus });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Gateway is running on port ${PORT}`);
    connectToWhatsApp();
});
