const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require("@whiskeysockets/baileys");
const express = require("express");
const qrcode = require("qrcode");
const cors = require("cors");
const pino = require("pino");
const path = require("path"); // إضافة مكتبة المسارات

const app = express();
app.use(cors());
app.use(express.json());

const AUTH_TOKEN = process.env.AUTH_TOKEN || "d55191dccb450fc81a3f234de626cb07";
let sock;
let qrCodeData = null;
let connectionStatus = "disconnected";

// تحديد مسار تخزين الجلسة بشكل مطلق لضمان عمله في هوستنجر
const SESSION_PATH = path.join(__dirname, 'auth_info_baileys');

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
        
        sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'debug' }), // تفعيل الديبيج لمراقبة الخلل في الـ Logs
            browser: ["QuickPay Gateway", "Chrome", "1.1.0"],
            printQRInTerminal: false,
            syncFullHistory: false 
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrCodeData = qr;
                console.log("✅ QR Code Updated");
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
                connectionStatus = "disconnected";
                qrCodeData = null;
                console.log("❌ Connection closed, reconnecting:", shouldReconnect);
                if (shouldReconnect) connectToWhatsApp();
            } else if (connection === 'open') {
                connectionStatus = "connected";
                qrCodeData = null;
                console.log("✅ WhatsApp Connected!");
            }
        });
    } catch (err) {
        console.error("🔥 Connection Error:", err);
    }
}

const verifyToken = (req) => {
    const authHeader = req.headers['authorization']?.replace('Bearer ', '');
    const queryToken = req.query.token;
    return authHeader === AUTH_TOKEN || queryToken === AUTH_TOKEN;
};

app.all("/devices/:id/qr", async (req, res) => {
    if (!verifyToken(req)) return res.status(200).json({ error: "unauthorized" });

    if (connectionStatus === "connected") return res.status(200).json({ status: "already_connected" });

    // إذا لم يتولد الـ QR بعد، نحاول إعادة تشغيل الاتصال للتنشيط
    if (!qrCodeData && connectionStatus === "disconnected") {
        console.log("🔄 Triggering new connection for QR...");
        // connectToWhatsApp(); // اختياري: إذا أردت إجبار الاتصال
    }

    // انتظار بسيط للاستجابة
    let attempts = 0;
    while (!qrCodeData && attempts < 10) { // رفع المحاولات لـ 10 ثوانٍ
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
    }

    if (qrCodeData) {
        try {
            const qrImage = await qrcode.toDataURL(qrCodeData);
            return res.status(200).json({ qr: qrImage, status: "success" });
        } catch (err) {
            return res.status(200).json({ error: "qr_gen_fail" });
        }
    }

    return res.status(200).json({ 
        qr: null, 
        status: "loading", 
        message: "QR generation taking longer than expected. Please refresh in 15 seconds." 
    });
});

app.get("/status", (req, res) => res.json({ status: connectionStatus }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server on port ${PORT}`);
    connectToWhatsApp();
});
