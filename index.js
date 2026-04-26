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
app.use(cors());
app.use(express.json());

const AUTH_TOKEN = "d55191dccb450fc81a3f234de626cb07";
let sock;
let qrCodeData = null;
let connectionStatus = "disconnected";

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        // تم إزالة printQRInTerminal لتجنب التنبيه
        logger: pino({ level: 'silent' }),
        browser: ["QuickPay Gateway", "Chrome", "1.0.0"] // تعريف المتصفح لتجنب الحظر
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // هنا نقوم بالاستماع للـ QR يدوياً كما طلبت المكتبة
        if (qr) {
            qrCodeData = qr;
            console.log('📡 New QR Code generated, waiting for scan...');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = "disconnected";
            qrCodeData = null;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            connectionStatus = "connected";
            qrCodeData = null;
            console.log('✅ WhatsApp Connected Successfully!');
        }
    });
}
// مسار الـ QR المعدل (انتظار الاستجابة)
app.get("/devices/:id/qr", async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${AUTH_TOKEN}`) return res.status(401).json({ error: "Unauthorized" });

    if (connectionStatus === "connected") return res.json({ status: "already_connected" });

    // إذا لم يتوفر QR بعد، سننتظر 3 ثوانٍ قبل الرد بـ 404
    if (!qrCodeData) {
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (qrCodeData) {
        try {
            const qrImage = await qrcode.toDataURL(qrCodeData);
            return res.json({ qr: qrImage });
        } catch (err) {
            return res.status(500).json({ error: "QR Error" });
        }
    }

    // بدلاً من 404 الصريح، سنرسل 200 مع رسالة "قيد التجهيز"
    res.status(200).json({ qr: null, status: "loading", message: "Please refresh in 5 seconds" });
});

app.post("/send", async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${AUTH_TOKEN}`) return res.status(401).json({ error: "Unauthorized" });
    const { number, message } = req.body;
    if (connectionStatus !== "connected") return res.status(503).json({ error: "Disconnected" });

    try {
        const jid = `${number.replace(/\D/g, '')}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ status: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(process.env.PORT || 3000, () => {
    connectToWhatsApp();
});
