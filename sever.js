/**
 * SVEC Relief Fund - Backend with SQLite Database
 */
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'svec_secret_key_2026';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

// ─── 1. DATABASE INITIALIZATION ──────────────────────────────
const dbPath = path.join(__dirname, 'relief_fund.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Database connection error:", err.message);
    else console.log("Connected to SQLite Database: relief_fund.db");
});

// Create Tables & Seed Data
db.serialize(() => {
    // 1. Emergency Requests Table
    db.run(`
        CREATE TABLE IF NOT EXISTS fund_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            roll TEXT NOT NULL,
            dept TEXT NOT NULL,
            hospital TEXT NOT NULL,
            amount INTEGER NOT NULL,
            category TEXT NOT NULL,
            phone TEXT NOT NULL,
            status TEXT DEFAULT 'Pending Verification',
            description TEXT,
            doctor_contact TEXT,
            photo TEXT,
            document TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 2. Contributors Table
    db.run(`
        CREATE TABLE IF NOT EXISTS contributors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            dept TEXT NOT NULL,
            student TEXT NOT NULL,
            amount INTEGER NOT NULL,
            app TEXT NOT NULL,
            is_anonymous INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Seed initial cases if empty
    db.get("SELECT COUNT(*) as count FROM fund_requests", (err, row) => {
        if (row && row.count === 0) {
            console.log("Seeding initial verified database records...");
            const insertRequest = db.prepare(`
                INSERT INTO fund_requests (name, roll, dept, hospital, amount, category, phone, status, description, photo)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            insertRequest.run(
                'K. Sai Teja', '21A81A05XX', 'CSE (3rd Yr)', 'Apollo, Eluru', 250000,
                'Road Accident', '9876543210', 'Approved',
                'Sai Teja met with a major road accident returning home from campus. Needs assistance for emergency orthopedic surgery.',
                'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=600&auto=format&fit=crop&q=80'
            );

            insertRequest.run(
                'V. Anusha', '22A81A04XX', 'ECE (2nd Yr)', 'Government Hospital, Eluru', 120000,
                'Orthopedic Care', '9123456789', 'Approved',
                'Anusha suffered multiple fractures in a two-wheeler accident near Tadepalligudem. Requires funds for urgent surgery.',
                'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&auto=format&fit=crop&q=80'
            );

            insertRequest.run(
                'M. Rajesh', '20A81A02XX', 'EEE (4th Yr)', 'City Care Emergency', 180000,
                'Emergency Surgery', '9012345678', 'Pending Verification',
                'Rajesh experienced trauma-related injuries needing immediate medical treatment and ICU stay.',
                'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&auto=format&fit=crop&q=80'
            );
            insertRequest.finalize();

            // Seed initial contributors
            const insertContrib = db.prepare(`
                INSERT INTO contributors (name, dept, student, amount, app)
                VALUES (?, ?, ?, ?, ?)
            `);
            insertContrib.run('S. K. Verma', 'Alumnus', 'K. Sai Teja', 5000, 'GPay');
            insertContrib.run('Vasavi Batch 2022', 'ECE 2nd Yr', 'V. Anusha', 8500, 'PhonePe');
            insertContrib.run('Anonymous Vasavian', 'CSE 3rd Yr', 'K. Sai Teja', 1000, 'Paytm');
            insertContrib.run('Faculty Club SVEC', 'Faculty', 'V. Anusha', 15000, 'GPay');
            insertContrib.finalize();
        }
    });
});

// ─── 2. FILE UPLOAD CONFIG ───────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e5)}`;
        cb(null, `${file.fieldname}-${unique}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ─── 3. AUTH MIDDLEWARE ──────────────────────────────────────
function requireAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Token required.' });
    }
    try {
        const token = authHeader.split(' ')[1];
        req.admin = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }
}

// ─── 4. DATABASE API ENDPOINTS ───────────────────────────────

// GET Dashboard Stats
app.get('/api/stats', (req, res) => {
    db.get(`
        SELECT 
            (SELECT COUNT(*) FROM fund_requests WHERE status = 'Approved') as activeCampaigns,
            (SELECT IFNULL(SUM(amount), 0) FROM contributors) as totalRaised,
            (SELECT COUNT(*) FROM contributors) as totalContributors
    `, (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: row });
    });
});

// GET Approved Campaigns for Public Landing Page
app.get('/api/campaigns', (req, res) => {
    db.all("SELECT * FROM fund_requests WHERE status = 'Approved' ORDER BY id DESC", (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: rows });
    });
});

// POST New Emergency Relief Request (Inserts into Database)
app.post('/api/requests', upload.fields([
    { name: 'student_photo', maxCount: 1 },
    { name: 'attachment', maxCount: 1 }
]), (req, res) => {
    const b = req.body;
    const photoUrl = req.files?.student_photo ? `/uploads/${req.files.student_photo[0].filename}` : b.photo_base64 || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=80';
    const docUrl = req.files?.attachment ? `/uploads/${req.files.attachment[0].filename}` : null;

    const sql = `
        INSERT INTO fund_requests (name, roll, dept, hospital, amount, category, phone, description, doctor_contact, photo, document, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Verification')
    `;

    db.run(sql, [
        b['Student Name'],
        b['Roll Number'],
        `${b['Department']} (${b['Year of Study']})`,
        b['Hospital Name'],
        parseInt(b['Requested Amount (INR)']) || 0,
        b['Emergency Category'],
        b['Phone Number'],
        b['Emergency Description'],
        b['Doctor Contact Details'] || '',
        photoUrl,
        docUrl
    ], function (err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: 'Request submitted and saved to Database successfully!', id: this.lastID });
    });
});

// GET Live Contributor Feed
app.get('/api/contributors', (req, res) => {
    db.all("SELECT * FROM contributors ORDER BY id DESC", (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: rows });
    });
});

// POST Add Contribution Record
app.post('/api/contributors', (req, res) => {
    const { name, dept, student, amount, app: upiApp, is_anonymous } = req.body;
    const sql = `INSERT INTO contributors (name, dept, student, amount, app, is_anonymous) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, [name, dept, student, parseInt(amount) || 0, upiApp || 'UPI', is_anonymous ? 1 : 0], function (err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: 'Contribution recorded into database!', id: this.lastID });
    });
});

// POST Admin Login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'hemachandra' && password === 'srivasavi') {
        const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
        return res.json({ success: true, token });
    }
    res.status(401).json({ success: false, message: 'Invalid Admin Credentials' });
});

// GET All Requests for Admin Dashboard
app.get('/api/admin/requests', requireAdmin, (req, res) => {
    db.all("SELECT * FROM fund_requests ORDER BY id DESC", (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: rows });
    });
});

// PATCH Update Request Status (Approve / Reject)
app.patch('/api/admin/requests/:id', requireAdmin, (req, res) => {
    const { status } = req.body;
    db.run("UPDATE fund_requests SET status = ? WHERE id = ?", [status, req.params.id], function (err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: `Status updated to ${status}` });
    });
});

// Catch-all route to serve the frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 SVEC Relief Fund Server running at: http://localhost:${PORT}`);
});