const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'svec_emergency_relief_secret_key_2026';

if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

const db = new sqlite3.Database('./svec_relief.db', (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log('Connected to SQLite database.');
});

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            roll TEXT NOT NULL,
            dept TEXT NOT NULL,
            hospital TEXT NOT NULL,
            amount TEXT NOT NULL,
            category TEXT NOT NULL,
            phone TEXT NOT NULL,
            status TEXT DEFAULT 'Pending Verification',
            desc TEXT,
            photo TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS contributors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            dept TEXT NOT NULL,
            student TEXT NOT NULL,
            amount REAL NOT NULL,
            app TEXT NOT NULL,
            time DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.get("SELECT COUNT(*) as count FROM cases", (err, row) => {
        if (row && row.count === 0) {
            const stmt = db.prepare(`INSERT INTO cases (name, roll, dept, hospital, amount, category, phone, status, desc, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run('K. Sai Teja', '21A81A05XX', 'CSE (3rd Yr)', 'Apollo, Eluru', '₹2,50,000', 'Road Accident', '9876543210', 'Approved', 'Sai Teja met with a major road accident returning home from campus. Needs assistance for emergency orthopedic surgery.', 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=600&auto=format&fit=crop&q=80');
            stmt.run('V. Anusha', '22A81A04XX', 'ECE (2nd Yr)', 'Government Hospital, Eluru', '₹1,20,000', 'Orthopedic Care', '9123456789', 'Approved', 'Anusha suffered multiple fractures in a two-wheeler accident near Tadepalligudem. Requires funds for urgent surgery.', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&auto=format&fit=crop&q=80');
            stmt.finalize();
        }
    });

    db.get("SELECT COUNT(*) as count FROM contributors", (err, row) => {
        if (row && row.count === 0) {
            const stmt = db.prepare(`INSERT INTO contributors (name, dept, student, amount, app) VALUES (?, ?, ?, ?, ?)`);
            stmt.run("S. K. Verma", "Alumnus", "K. Sai Teja", 5000, "GPay");
            stmt.run("Vasavi Batch 2022", "ECE (2nd Yr)", "V. Anusha", 8500, "PhonePe");
            stmt.run("Anonymous Vasavian", "CSE (3rd Yr)", "K. Sai Teja", 1000, "Paytm");
            stmt.run("Faculty Club SVEC", "Faculty", "V. Anusha", 15000, "GPay");
            stmt.finalize();
        }
    });
});

const authenticateAdmin = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Access Denied' });
    try {
        req.admin = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
        next();
    } catch {
        res.status(400).json({ error: 'Invalid Token' });
    }
};

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'hemachandra' && password === 'srivasavi') {
        const token = jwt.sign({ role: 'admin', username }, JWT_SECRET, { expiresIn: '8h' });
        return res.json({ success: true, token });
    }
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

app.get('/api/cases/active', (req, res) => {
    db.all("SELECT * FROM cases WHERE status = 'Approved' ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/cases/all', authenticateAdmin, (req, res) => {
    db.all("SELECT * FROM cases ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/cases', upload.fields([{ name: 'student_photo', maxCount: 1 }, { name: 'attachment', maxCount: 1 }]), (req, res) => {
    const b = req.body;
    const photoUrl = req.files['student_photo'] 
        ? `/uploads/${req.files['student_photo'][0].filename}`
        : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=80';

    const deptFormatted = `${b.department || b['Department']} (${b.yearOfStudy || b['Year of Study']})`;
    const rawAmt = b.requestedAmount || b['Requested Amount (INR)'] || 0;
    const amountFormatted = `₹${Number(rawAmt).toLocaleString('en-IN')}`;

    const sql = `INSERT INTO cases (name, roll, dept, hospital, amount, category, phone, status, desc, photo) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending Verification', ?, ?)`;
    const params = [
        b.studentName || b['Student Name'], 
        b.rollNumber || b['Roll Number'], 
        deptFormatted, 
        b.hospitalName || b['Hospital Name'], 
        amountFormatted, 
        b.emergencyCategory || b['Emergency Category'], 
        b.phoneNumber || b['Phone Number'], 
        b.emergencyDescription || b['Emergency Description'], 
        photoUrl
    ];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ success: true, caseId: this.lastID });
    });
});

app.patch('/api/cases/:id/status', authenticateAdmin, (req, res) => {
    db.run("UPDATE cases SET status = ? WHERE id = ?", [req.body.status, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/contributors', (req, res) => {
    db.all("SELECT * FROM contributors ORDER BY id DESC LIMIT 50", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/contributors', (req, res) => {
    const { name, dept, student, amount, app: paymentApp } = req.body;
    db.run(`INSERT INTO contributors (name, dept, student, amount, app) VALUES (?, ?, ?, ?, ?)`, [name, dept, student, amount, paymentApp], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ success: true, id: this.lastID });
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`SVEC Relief Fund Server running at http://localhost:${PORT}`));
