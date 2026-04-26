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

// التوكن الخاص بنظام Quick Pay
const AUTH_TOKEN = "123456";
let sock;
let qrCodeData = null;
let connectionStatus = "disconnected";

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        // تم حذف printQRInTerminal لحل التنبيه
        logger: pino({ level: 'silent' }),
        browser: ["QuickPay Gateway", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // استلام الـ QR ومعالجته يدوياً كما طلبت المكتبة
        if (qr) {
            qrCodeData = qr;
            console.log("📡 QR Code received and ready for fetch.");
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = "disconnected";
            qrCodeData = null;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            connectionStatus = "connected";
            qrCodeData = null;
            console.log('✅ WhatsApp Connected Successfully');
        }
    });
}

// مسار جلب الـ QR (المسار الذي يطلبه تطبيقك في الصورة)
app.get("/devices/:id/qr", async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${AUTH_TOKEN}`) return res.status(401).json({ error: "Unauthorized" });

    if (connectionStatus === "connected") return res.json({ status: "already_connected" });

    // إذا كان الـ QR جاهزاً، أرسله فوراً
    if (qrCodeData) {
        try {
            const qrImage = await qrcode.toDataURL(qrCodeData);
            return res.json({ qr: qrImage });
        } catch (err) {
            return res.status(500).json({ error: "QR Generation Failed" });
        }
    }

    // إذا لم يجهز بعد، نرسل حالة انتظار بدلاً من 404 لكي لا يظهر خطأ في التطبيق
    res.status(200).json({ status: "loading", message: "Generating QR, try again in 5s" });
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

app.get("/status", (req, res) => res.json({ status: connectionStatus }));

app.listen(process.env.PORT || 3000, () => connectToWhatsApp());
