const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ CONFIG ============
// Demo credentials — override with env vars before any real deployment.
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'SecurePass2026';

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Timing-safe Basic Auth check, shared by the admin page AND every admin API route.
function checkAuth(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) return false;
    let decoded;
    try {
        decoded = Buffer.from(auth.slice(6), 'base64').toString();
    } catch {
        return false;
    }
    const sepIndex = decoded.indexOf(':');
    if (sepIndex === -1) return false;
    const user = decoded.slice(0, sepIndex);
    const pass = decoded.slice(sepIndex + 1);

    const userBuf = Buffer.from(user);
    const passBuf = Buffer.from(pass);
    const expectedUserBuf = Buffer.from(ADMIN_USER);
    const expectedPassBuf = Buffer.from(ADMIN_PASS);

    const userMatch = userBuf.length === expectedUserBuf.length &&
        crypto.timingSafeEqual(userBuf, expectedUserBuf);
    const passMatch = passBuf.length === expectedPassBuf.length &&
        crypto.timingSafeEqual(passBuf, expectedPassBuf);

    return userMatch && passMatch;
}

function requireAuth(req, res, next) {
    if (checkAuth(req)) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).json({ error: 'Authentication required' });
}

// ============ FILE UPLOAD (validated) ============
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '';
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_MIME.has(file.mimetype)) {
            return cb(new Error('Only JPEG, PNG, WEBP, or GIF images are allowed'));
        }
        cb(null, true);
    }
});

// ============ DATABASE ============
const db = new sqlite3.Database(path.join(__dirname, 'tracking.db'));

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        start_lat REAL NOT NULL,
        start_lng REAL NOT NULL,
        end_lat REAL NOT NULL,
        end_lng REAL NOT NULL,
        stops TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS shipments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tracking_number TEXT UNIQUE NOT NULL,
        route_id INTEGER NOT NULL,
        status TEXT DEFAULT 'Pending',
        progress INTEGER DEFAULT 0,
        last_update TEXT,
        product_name TEXT,
        product_image TEXT,
        country_from TEXT,
        country_to TEXT,
        recipient_name TEXT,
        recipient_address TEXT,
        FOREIGN KEY (route_id) REFERENCES routes(id)
    )`);
});

function generateTracking() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'GT-';
    for (let i = 0; i < 10; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

// Server-side error logging, generic message to the client.
function fail(res, status, publicMessage, err) {
    if (err) console.error(err);
    return res.status(status).json({ error: publicMessage });
}

const VALID_STATUSES = new Set(['Pending', 'In Transit', 'Delivered', 'Delayed']);

// ============ PUBLIC API ============
app.get('/api/routes', (req, res) => {
    db.all('SELECT * FROM routes ORDER BY id DESC', (err, rows) => {
        if (err) return fail(res, 500, 'Could not load routes', err);
        res.json(rows);
    });
});

app.get('/api/track/:number', (req, res) => {
    const number = String(req.params.number || '').trim();
    if (!number) return fail(res, 400, 'Tracking number is required');
    db.get(
        `SELECT s.*, r.name as route_name, r.start_lat, r.start_lng, r.end_lat, r.end_lng, r.stops
         FROM shipments s JOIN routes r ON s.route_id = r.id
         WHERE s.tracking_number = ?`,
        [number],
        (err, row) => {
            if (err) return fail(res, 500, 'Lookup failed', err);
            if (!row) return fail(res, 404, 'Tracking number not found');
            res.json(row);
        }
    );
});

// ============ ADMIN API (all require auth) ============
app.post('/api/routes', requireAuth, (req, res) => {
    const { name, start_lat, start_lng, end_lat, end_lng, stops } = req.body || {};
    const lat1 = Number(start_lat), lng1 = Number(start_lng), lat2 = Number(end_lat), lng2 = Number(end_lng);
    if (!name || !String(name).trim()) return fail(res, 400, 'Route name is required');
    if ([lat1, lng1, lat2, lng2].some(n => Number.isNaN(n))) {
        return fail(res, 400, 'Latitude and longitude must be numbers');
    }
    db.run(
        'INSERT INTO routes (name, start_lat, start_lng, end_lat, end_lng, stops) VALUES (?, ?, ?, ?, ?, ?)',
        [String(name).trim(), lat1, lng1, lat2, lng2, JSON.stringify(stops || [])],
        function (err) {
            if (err) return fail(res, 500, 'Could not create route', err);
            res.status(201).json({ id: this.lastID });
        }
    );
});

app.get('/api/admin/shipments', requireAuth, (req, res) => {
    db.all(
        `SELECT s.*, r.name as route_name FROM shipments s
         JOIN routes r ON s.route_id = r.id ORDER BY s.id DESC`,
        (err, rows) => {
            if (err) return fail(res, 500, 'Could not load shipments', err);
            res.json(rows);
        }
    );
});

app.post('/api/admin/shipments', requireAuth, (req, res, next) => {
    upload.single('product_image')(req, res, (err) => {
        if (err) return fail(res, 400, err.message);
        next();
    });
}, (req, res) => {
    const { route_id, product_name, country_from, country_to, recipient_name, recipient_address } = req.body || {};
    const routeId = Number(route_id);
    if (!routeId) return fail(res, 400, 'A route is required');

    db.get('SELECT id FROM routes WHERE id = ?', [routeId], (err, route) => {
        if (err) return fail(res, 500, 'Could not verify route', err);
        if (!route) return fail(res, 400, 'Selected route does not exist');

        const product_image = req.file ? `/uploads/${req.file.filename}` : null;
        const tracking_number = generateTracking();
        const last_update = new Date().toISOString();

        db.run(
            `INSERT INTO shipments
             (tracking_number, route_id, status, progress, last_update, product_name, product_image, country_from, country_to, recipient_name, recipient_address)
             VALUES (?, ?, 'Pending', 0, ?, ?, ?, ?, ?, ?, ?)`,
            [tracking_number, routeId, last_update, product_name || null, product_image,
             country_from || null, country_to || null, recipient_name || null, recipient_address || null],
            function (err) {
                if (err) return fail(res, 500, 'Could not create shipment', err);
                res.status(201).json({ tracking_number, status: 'Pending', progress: 0, last_update });
            }
        );
    });
});

app.put('/api/admin/shipments/:number', requireAuth, (req, res) => {
    const number = String(req.params.number || '').trim();
    const { status, progress } = req.body || {};
    if (status && !VALID_STATUSES.has(status)) return fail(res, 400, 'Invalid status value');
    const progressNum = progress === undefined ? undefined : Number(progress);
    if (progressNum !== undefined && (Number.isNaN(progressNum) || progressNum < 0 || progressNum > 100)) {
        return fail(res, 400, 'Progress must be a number between 0 and 100');
    }
    const last_update = new Date().toISOString();

    db.run(
        `UPDATE shipments SET
            status = COALESCE(?, status),
            progress = COALESCE(?, progress),
            last_update = ?
         WHERE tracking_number = ?`,
        [status || null, progressNum === undefined ? null : progressNum, last_update, number],
        function (err) {
            if (err) return fail(res, 500, 'Could not update shipment', err);
            if (this.changes === 0) return fail(res, 404, 'Shipment not found');
            res.json({ success: true, last_update });
        }
    );
});

app.delete('/api/admin/shipments/:number', requireAuth, (req, res) => {
    const number = String(req.params.number || '').trim();
    db.run('DELETE FROM shipments WHERE tracking_number = ?', [number], function (err) {
        if (err) return fail(res, 500, 'Could not delete shipment', err);
        if (this.changes === 0) return fail(res, 404, 'Shipment not found');
        res.json({ success: true });
    });
});

// ============ ADMIN PAGE (hidden + password protected) ============
app.get('/track-admin', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ============ 404 + ERROR HANDLERS ============
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, () => {
    console.log(`GlobalTrack demo running at http://localhost:${PORT}`);
    console.log(`Admin panel at http://localhost:${PORT}/track-admin (user: ${ADMIN_USER})`);
});
