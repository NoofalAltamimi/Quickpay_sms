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

// تفعيل CORS للسماح لتطبيق Lovable بالاتصال دون قيود
app.use(cors());
app.use(express.json());

// قراءة التوكن من متغيرات البيئة في هوستنجر أو القيمة الاحتياطية
const AUTH_TOKEN = process.env.AUTH_TOKEN || "d55191dccb450fc81a3f234de626cb07";

let sock;
let qrCodeData = null;
let connectionStatus = "disconnected";

// دالة التحقق من الأمان (التوكن)
const verifyToken = (req) => {
    const authHeader = req.headers['authorization']?.replace('Bearer ', '');
    const queryToken = req.query.token;
    return authHeader === AUTH_TOKEN || queryToken === AUTH_TOKEN;
};

async function connectToWhatsApp() {
    // حفظ الجلسة في مجلد محلي لضمان بقاء الاتصال بعد إعادة تشغيل السيرفر
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["QuickPay Gateway", "Chrome", "1.1.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeData = qr;
            console.log("📡 New QR Generated.");
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = "disconnected";
            qrCodeData = null;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            connectionStatus = "connected";
            qrCodeData = null;
            console.log('✅ WhatsApp Connected!');
        }
    });
}

// المسار الشامل (POST & GET) لحل مشكلة "Cannot POST"
app.all("/devices/:id/qr", async (req, res) => {
    if (!verifyToken(req)) {
        return res.status(401).json({ error: "Unauthorized Access" });
    }

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
    }

    // الرد بحالة 200 لضمان عدم ظهور صفحة خطأ HTML في تطبيقك
    res.status(200).json({ 
        qr: null, 
        status: "loading", 
        message: "Generating QR... Please refresh in 5 seconds." 
    });
});

// مسار إرسال الرسائل (للإشعارات و الـ OTP)
app.post("/send", async (req, res) => {
    if (!verifyToken(req)) return res.status(401).json({ error: "Unauthorized" });

    const { number, message } = req.body;
    if (connectionStatus !== "connected") return res.status(503).json({ error: "Service Disconnected" });

    try {
        const jid = `${number.replace(/\D/g, '')}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ status: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// مسار فحص الحالة للتأكد من عمل السيرفر
app.get("/status", (req, res) => {
    res.json({ status: connectionStatus });
});

// تشغيل السيرفر على المنفذ المحدد
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 QuickPay Gateway running on port ${PORT}`);
    connectToWhatsApp();
});
