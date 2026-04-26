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

// التوكن الخاص بك
const AUTH_TOKEN = "d55191dccb450fc81a3f234de626cb07";
let sock;
let qrCodeData = null;
let connectionStatus = "disconnected";

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["QuickPay Gateway", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrCodeData = qr;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = "disconnected";
            qrCodeData = null;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            connectionStatus = "connected";
            qrCodeData = null;
            console.log('✅ WhatsApp Connected');
        }
    });
}

// دالة التحقق من التوكن (تدعم الـ Header والـ URL)
const verifyToken = (req) => {
    const headerToken = req.headers['authorization']?.replace('Bearer ', '');
    const queryToken = req.query.token;
    return headerToken === AUTH_TOKEN || queryToken === AUTH_TOKEN;
};

// مسار جلب الـ QR
app.get("/devices/:id/qr", async (req, res) => {
    if (!verifyToken(req)) {
        return res.status(401).json({ error: "Unauthorized - Check your Token" });
    }

    if (connectionStatus === "connected") return res.json({ status: "already_connected" });

    if (qrCodeData) {
        try {
            const qrImage = await qrcode.toDataURL(qrCodeData);
            return res.json({ qr: qrImage });
        } catch (err) {
            return res.status(500).json({ error: "QR Fail" });
        }
    }

    // نرسل حالة 200 دائماً مع رسالة انتظار لتجنب 404 في التطبيق
    res.status(200).json({ qr: null, status: "loading", message: "Please wait, generating QR..." });
});

app.get("/status", (req, res) => res.json({ status: connectionStatus }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => connectToWhatsApp());
