'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const STATUSES = ['New enquiry', 'Awaiting quote', 'Awaiting advance', 'Confirmed', 'Baking', 'Ready', 'Completed', 'Cancelled'];
const TYPES = ['Custom celebration cake', 'Birthday cake', 'Wedding cake', 'Anniversary cake', 'Baby shower cake', 'Graduation cake', 'Hamper or gift', 'Something else'];
const STATIC = new Set(['index.html', 'styles.css', 'app.js', 'builder.js', 'gallery-data.js', 'baker-bot.js', 'customer-api.js', 'admin.html', 'admin.css', 'admin.js', 'privacy.html']);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
function failure(status, message) { return Object.assign(new Error(message), { status }); }
function businessDay(date = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function text(value, name, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw failure(400, `${name} must be text.`);
  value = value.trim();
  if (value.length > max || (required && !value)) throw failure(400, `Please check ${name}.`);
  return value;
}
function number(value, name, max, nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw failure(400, `Please check ${name}.`);
  return value;
}
function validDay(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value; }
async function passwordHash(password) { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + Buffer.from(await scrypt(password, salt, 64)).toString('hex'); }
async function passwordMatches(password, stored) { const [salt, key] = stored.split(':'); const candidate = Buffer.from(await scrypt(password, salt, 64)); return crypto.timingSafeEqual(candidate, Buffer.from(key, 'hex')); }
function readCookies(req) { const result = {}; for (const part of (req.headers.cookie || '').split(';')) { const at = part.indexOf('='); if (at > 0) result[part.slice(0, at).trim()] = part.slice(at + 1).trim(); } return result; }
async function readJSON(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw failure(415, 'Please send JSON.');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 1100000) throw failure(413, 'This request is too large.'); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch { throw failure(400, 'The request could not be read.'); }
}

async function createBakeryServer(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const publicOrigin = options.publicOrigin || process.env.PUBLIC_ORIGIN || '';
  if (production && (!publicOrigin || new URL(publicOrigin).protocol !== 'https:')) throw new Error('Set PUBLIC_ORIGIN to the HTTPS address of the deployed website.');
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(ROOT, 'data'));
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const secretFile = path.join(dataDir, 'visitor-secret');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  const visitorSecret = fs.readFileSync(secretFile, 'utf8');
  const db = new DatabaseSync(path.join(dataDir, 'bakery.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS visitors (day TEXT NOT NULL, visitor_hash TEXT NOT NULL, PRIMARY KEY(day,visitor_hash));
    CREATE TABLE IF NOT EXISTS metrics (day TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, visitor_hash TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(day,kind,source,visitor_hash));
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
      occasion TEXT NOT NULL, event_date TEXT NOT NULL, design_id TEXT NOT NULL, design_summary TEXT NOT NULL,
      design_reference TEXT NOT NULL, guests INTEGER, portion_grams INTEGER, estimated_kg REAL, preferred_weight TEXT NOT NULL,
      fulfilment TEXT NOT NULL, details TEXT NOT NULL, custom_config TEXT, custom_image BLOB,
      status TEXT NOT NULL DEFAULT 'New enquiry', total_paise INTEGER, advance_requested_paise INTEGER NOT NULL DEFAULT 0,
      advance_received_paise INTEGER NOT NULL DEFAULT 0, owner_notes TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS orders_date ON orders(event_date);
    CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at);
    CREATE TABLE IF NOT EXISTS order_history (id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), created_at TEXT NOT NULL, actor TEXT NOT NULL, summary TEXT NOT NULL);
  `);
  const gallery = JSON.parse(fs.readFileSync(path.join(ROOT, 'gallery-data.js'), 'utf8').replace(/^const galleryDesigns\s*=\s*/, '').replace(/;\s*$/, ''));
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  for (const list of Object.values(os.networkInterfaces())) for (const address of list || []) localHosts.add(address.address.includes(':') ? `[${address.address}]` : address.address);
  const buckets = new Map();
  function rate(key, limit, windowMs) {
    const now = Date.now(); let bucket = buckets.get(key);
    if (!bucket || bucket.until < now) { bucket = { count: 0, until: now + windowMs }; buckets.set(key, bucket); }
    bucket.count += 1;
    if (buckets.size > 10000) for (const [k, b] of buckets) if (b.until < now) buckets.delete(k);
    if (bucket.count > limit) throw failure(429, 'Too many attempts. Please try again later.');
  }
  function cookie(res, name, value, maxAge) { const valueLine = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${production ? '; Secure' : ''}${maxAge === undefined ? '' : '; Max-Age=' + maxAge}`; const existing = res.getHeader('Set-Cookie') || []; res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), valueLine]); }
  function visitor(req, res) { let token = readCookies(req).bakery_visitor; if (!/^[a-f0-9]{48}$/.test(token || '')) { token = crypto.randomBytes(24).toString('hex'); cookie(res, 'bakery_visitor', token, 30 * 86400); } return crypto.createHmac('sha256', visitorSecret).update(token).digest('hex'); }
  function metric(req, res, kind, source) {
    if (session(req)) return; // The signed-in owner's previews must not inflate visitor insights.
    const key = visitor(req, res), day = businessDay();
    db.prepare('INSERT OR IGNORE INTO visitors(day,visitor_hash) VALUES(?,?)').run(day, key);
    db.prepare('INSERT INTO metrics(day,kind,source,visitor_hash,count) VALUES(?,?,?,?,1) ON CONFLICT(day,kind,source,visitor_hash) DO UPDATE SET count=count+1').run(day, kind, source, key);
  }
  function session(req) { const token = readCookies(req).bakery_admin; if (!/^[a-f0-9]{64}$/.test(token || '')) return null; return db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now()) || null; }
  function requireAdmin(req, write = false) { const value = session(req); if (!value) throw failure(401, 'Please sign in to the owner dashboard.'); if (write && req.headers['x-csrf-token'] !== value.csrf) throw failure(403, 'Please refresh the dashboard and try again.'); return value; }
  function trustedRequest(req) {
    const expected = publicOrigin ? new URL(publicOrigin).origin : `http://${req.headers.host}`;
    if (req.headers.origin !== expected || req.headers['sec-fetch-site'] === 'cross-site') throw failure(403, 'This request must come from the bakery website.');
  }
  function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
  function orderPublicRow(row) { if (!row) throw failure(404, 'Order not found.'); const result = { ...row, has_image: Boolean(row.has_image ?? row.custom_image) }; delete result.custom_image; delete result.request_hash; delete result.request_key; if (result.custom_config) result.custom_config = JSON.parse(result.custom_config); return result; }
  async function authenticate(res) { const token = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(24).toString('hex'); db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now()); db.prepare('INSERT INTO sessions(token_hash,csrf,expires_at) VALUES(?,?,?)').run(digest(token), csrf, Date.now() + 8 * 3600000); cookie(res, 'bakery_admin', token); return csrf; }
  const envPassword = options.adminPassword || process.env.ADMIN_PASSWORD;
  if (!db.prepare('SELECT id FROM admins').get() && envPassword) {
    if (envPassword.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
    const username = options.adminUsername || process.env.ADMIN_USERNAME || 'owner';
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) throw new Error('ADMIN_USERNAME must be 3–40 letters, digits, underscores, periods or hyphens.');
    db.prepare('INSERT INTO admins(id,username,password_hash) VALUES(1,?,?)').run(username, await passwordHash(envPassword));
  }
  function validateOrder(body) {
    const name = text(body.name, 'your name', 80, true), phone = text(body.phone, 'phone number', 25, true);
    if (!/^[+0-9() .-]{7,25}$/.test(phone) || phone.replace(/\D/g, '').length < 7) throw failure(400, 'Please enter a valid phone number.');
    const occasion = text(body.type, 'occasion', 50, true);
    if (!TYPES.includes(occasion)) throw failure(400, 'Please choose an occasion.');
    const date = text(body.date, 'celebration date', 10, true);
    if (!validDay(date) || date < businessDay() || Number(date.slice(0, 4)) > new Date().getFullYear() + 10) throw failure(400, 'Please choose a valid future celebration date.');
    const designId = text(body.designId, 'preferred design', 30, true);
    const selected = gallery.find(item => String(item.image) === designId);
    let config = null, summary;
    if (selected) summary = selected.title + ' — ' + selected.label;
    else if (designId === 'custom-build') {
      const c = body.customConfig;
      if (!c || typeof c !== 'object' || Array.isArray(c)) throw failure(400, 'Please select your custom design in the cake builder first.');
      if (!['round', 'heart', 'square'].includes(c.shape) || !['1', '2', '3'].includes(String(c.tiers)) || (c.shape === 'heart' && String(c.tiers) !== '1')) throw failure(400, 'Please check the cake shape and tiers.');
      if (!/^#[a-f0-9]{6}$/i.test(c.colour || '') || !/^#[a-f0-9]{6}$/i.test(c.accent || '') || !['flowers', 'pearls', 'sprinkles', 'minimal'].includes(c.decoration)) throw failure(400, 'Please check the design colours and decoration.');
      config = { shape: c.shape, tiers: String(c.tiers), colour: c.colour, accent: c.accent, decoration: c.decoration, flavour: text(c.flavour, 'flavour wish', 100), message: text(c.message, 'cake message', 32), notes: text(c.notes, 'design notes', 500) };
      summary = `Custom ${config.shape} cake, ${config.tiers} tier(s). Frosting ${config.colour}; ${config.decoration} in ${config.accent}. Flavour wish: ${config.flavour || 'To discuss'}. Message: ${config.message || 'None'}. ${config.notes}`;
    } else if (designId === 'own') summary = 'Customer has their own design / reference';
    else if (designId === 'help') summary = 'Customer would like help choosing a design';
    else throw failure(400, 'Please choose a preferred design.');
    const reference = text(body.reference, 'reference link', 1000);
    if (reference) { let link; try { link = new URL(reference); } catch { throw failure(400, 'Please enter a valid reference link.'); } if (!['http:', 'https:'].includes(link.protocol)) throw failure(400, 'Reference links must use http or https.'); }
    const hamper = occasion === 'Hamper or gift';
    const guests = hamper ? null : number(body.guests, 'guest count', 1000);
    if (!hamper && guests < 1) throw failure(400, 'Please enter at least one guest.');
    const portion = hamper ? null : number(body.portion, 'portion allowance', 150);
    if (!hamper && ![100, 125, 150].includes(portion)) throw failure(400, 'Please choose a portion allowance.');
    const fulfilment = text(body.fulfilment, 'collection or delivery', 80, true);
    if (!['Discuss with the bakery', 'Collection', 'Paid delivery — enquire about area'].includes(fulfilment)) throw failure(400, 'Please choose collection or delivery.');
    let image = null;
    if (body.customImage && config) {
      if (typeof body.customImage !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(body.customImage)) throw failure(400, 'The design picture must be a PNG.');
      image = Buffer.from(body.customImage.slice('data:image/png;base64,'.length), 'base64');
      if (image.length < 33 || image.length > 750000 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || image.toString('ascii', 12, 16) !== 'IHDR' || image.readUInt32BE(16) > 1600 || image.readUInt32BE(20) > 1600 || !image.readUInt32BE(16) || !image.readUInt32BE(20)) throw failure(400, 'Please save a smaller design picture.');
    }
    return { name, phone, occasion, date, designId, summary, reference: reference || selected?.source || '', guests, portion, kg: hamper ? null : Math.ceil(guests * portion / 500) / 2, weight: text(body.size, 'preferred weight', 80), fulfilment, details: text(body.details, 'order details', 1800), config, image };
  }
  function range(url) {
    const days = Number(url.searchParams.get('days') || 30);
    if (![7, 30, 90].includes(days)) throw failure(400, 'Choose 7, 30 or 90 days.');
    const date = new Date(businessDay() + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() - days + 1);
    return { days, from: date.toISOString().slice(0, 10), to: businessDay() };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Content-Security-Policy', CSP); res.setHeader('X-Frame-Options', 'DENY');
    try {
      const parsedHost = new URL(`http://${req.headers.host || ''}`);
      if (publicOrigin ? parsedHost.host !== new URL(publicOrigin).host : !localHosts.has(parsedHost.hostname)) throw failure(400, 'Unrecognised website address.');
      const url = new URL(req.url, publicOrigin || `http://${req.headers.host}`), route = url.pathname;
      const ip = req.socket.remoteAddress || 'unknown';
      if (route.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) trustedRequest(req);
      if (req.method === 'GET' && route === '/api/health') return json(res, 200, { ok: true, service: 'b-for-baking' });
      if (req.method === 'GET' && route === '/api/admin/session') {
        const configured = Boolean(db.prepare('SELECT id FROM admins').get()), auth = session(req);
        return json(res, 200, { configured, authenticated: Boolean(auth), setupAllowed: !production && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip), ...(auth ? { username: db.prepare('SELECT username FROM admins WHERE id=1').get().username, csrf: auth.csrf } : {}) });
      }
      if (req.method === 'POST' && route === '/api/admin/setup') {
        if (production || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) throw failure(403, 'Complete owner setup on localhost, or configure ADMIN_USERNAME and ADMIN_PASSWORD on your host.');
        if (db.prepare('SELECT id FROM admins').get()) throw failure(409, 'An owner account is already configured.');
        rate('setup:' + ip, 5, 900000); const body = await readJSON(req);
        const username = text(body.username, 'username', 40, true), password = text(body.password, 'password', 128, true);
        if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username) || password.length < 12) throw failure(400, 'Use a 3–40 character username and a password of at least 12 characters.');
        const hashed = await passwordHash(password);
        try { db.prepare('INSERT INTO admins(id,username,password_hash) VALUES(1,?,?)').run(username, hashed); } catch { throw failure(409, 'An owner account is already configured.'); }
        return json(res, 201, { ok: true, username, csrf: await authenticate(res) });
      }
      if (req.method === 'POST' && route === '/api/admin/login') {
        rate('login:' + ip, 10, 900000); const body = await readJSON(req), admin = db.prepare('SELECT * FROM admins WHERE id=1').get();
        const username = text(body.username, 'username', 40, true), password = text(body.password, 'password', 128, true);
        if (!admin) throw failure(401, 'Owner setup has not been completed.');
        const matches = await passwordMatches(password, admin.password_hash);
        if (!matches || username !== admin.username) throw failure(401, 'The username or password is incorrect.');
        return json(res, 200, { ok: true, username: admin.username, csrf: await authenticate(res) });
      }
      if (req.method === 'POST' && route === '/api/admin/logout') { const auth = requireAdmin(req, true); db.prepare('DELETE FROM sessions WHERE token_hash=?').run(auth.token_hash); cookie(res, 'bakery_admin', '', 0); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && route === '/api/admin/password') {
        requireAdmin(req, true); rate('password:' + ip, 5, 900000); const body = await readJSON(req), admin = db.prepare('SELECT * FROM admins WHERE id=1').get();
        const oldPassword = text(body.currentPassword, 'current password', 128, true), newPassword = text(body.newPassword, 'new password', 128, true);
        if (newPassword.length < 12) throw failure(400, 'Your new password must contain at least 12 characters.');
        if (!await passwordMatches(oldPassword, admin.password_hash)) throw failure(400, 'Your current password is incorrect.');
        db.prepare('UPDATE admins SET password_hash=? WHERE id=1').run(await passwordHash(newPassword)); db.prepare('DELETE FROM sessions').run(); cookie(res, 'bakery_admin', '', 0);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && route === '/api/metrics') {
        rate('metrics:' + ip, 600, 60000); const body = await readJSON(req);
        if (body.kind !== 'page_view') throw failure(400, 'Unrecognised event.');
        metric(req, res, 'page_view', 'website'); return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && route === '/go/instagram') {
        const target = url.searchParams.get('to') || 'https://www.instagram.com/b_for_baking/'; let destination;
        try { destination = new URL(target); } catch { throw failure(400, 'Invalid Instagram link.'); }
        if (destination.protocol !== 'https:' || !['www.instagram.com', 'instagram.com'].includes(destination.hostname) || destination.username || destination.password || destination.port || !/^\/(?:b_for_baking(?:\/|$)|p\/|reel\/)/.test(destination.pathname)) throw failure(400, 'This link must lead to Instagram.');
        rate('instagram:' + ip, 600, 60000);
        const source = ['profile', 'gallery_post', 'bot'].includes(url.searchParams.get('source')) ? url.searchParams.get('source') : 'profile';
        if (!/prefetch/i.test(String(req.headers['sec-purpose'] || req.headers.purpose || ''))) metric(req, res, 'instagram_click', source);
        res.writeHead(302, { Location: destination.href, 'Cache-Control': 'no-store' }); return res.end();
      }
      if (req.method === 'POST' && route === '/api/orders') {
        rate('orders:' + ip, 100, 3600000); const visitorId = visitor(req, res); rate('orders-visitor:' + visitorId, 10, 3600000);
        const body = await readJSON(req); if (body.website) throw failure(400, 'Please leave the website field empty.');
        const key = text(body.requestKey, 'request identifier', 80, true); if (!/^[a-zA-Z0-9_-]{16,80}$/.test(key)) throw failure(400, 'Please refresh the form and try again.');
        const order = validateOrder(body), hashed = digest(JSON.stringify({ ...order, image: order.image ? digest(order.image) : null }));
        const existing = db.prepare('SELECT reference,request_hash FROM orders WHERE request_key=?').get(key);
        if (existing) { if (existing.request_hash !== hashed) throw failure(409, 'This request changed. Please submit it again.'); return json(res, 200, { reference: existing.reference, status: 'received', duplicate: true }); }
        const id = crypto.randomUUID(), reference = 'BFB-' + crypto.randomBytes(6).toString('hex').toUpperCase(), now = new Date().toISOString();
        db.prepare(`INSERT INTO orders(id,reference,request_key,request_hash,created_at,updated_at,customer_name,phone,occasion,event_date,design_id,design_summary,design_reference,guests,portion_grams,estimated_kg,preferred_weight,fulfilment,details,custom_config,custom_image) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, reference, key, hashed, now, now, order.name, order.phone, order.occasion, order.date, order.designId, order.summary, order.reference, order.guests, order.portion, order.kg, order.weight, order.fulfilment, order.details, order.config ? JSON.stringify(order.config) : null, order.image);
        db.prepare('INSERT INTO order_history(order_id,created_at,actor,summary) VALUES(?,?,?,?)').run(id, now, 'Customer', 'Enquiry received through the website.');
        return json(res, 201, { reference, status: 'received' });
      }
      if (req.method === 'GET' && route === '/api/admin/overview') {
        requireAdmin(req); const period = range(url);
        const aggregate = db.prepare(`SELECT kind,SUM(count) AS count,COUNT(DISTINCT visitor_hash) AS browsers FROM metrics WHERE day BETWEEN ? AND ? GROUP BY kind`).all(period.from, period.to);
        const views = aggregate.find(x => x.kind === 'page_view') || {}, instagram = aggregate.find(x => x.kind === 'instagram_click') || {};
        const visitors = db.prepare('SELECT COUNT(DISTINCT visitor_hash) AS count FROM visitors WHERE day BETWEEN ? AND ?').get(period.from, period.to).count;
        const daily = db.prepare(`SELECT day,SUM(CASE WHEN kind='page_view' THEN count ELSE 0 END) AS views,SUM(CASE WHEN kind='instagram_click' THEN count ELSE 0 END) AS instagram_clicks FROM metrics WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day`).all(period.from, period.to);
        const sources = db.prepare(`SELECT source,SUM(count) AS clicks,COUNT(DISTINCT visitor_hash) AS browsers FROM metrics WHERE kind='instagram_click' AND day BETWEEN ? AND ? GROUP BY source ORDER BY clicks DESC`).all(period.from, period.to);
        const orders = db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN status='New enquiry' THEN 1 ELSE 0 END) AS new_count,SUM(CASE WHEN status IN ('Confirmed','Baking','Ready') THEN 1 ELSE 0 END) AS active_count FROM orders WHERE date(created_at,'+5 hours','+30 minutes') BETWEEN ? AND ?`).get(period.from, period.to);
        return json(res, 200, { period, metrics: { visitors, pageViews: views.count || 0, instagramClicks: instagram.count || 0, instagramBrowsers: instagram.browsers || 0 }, daily, sources, orders: { total: orders.total, new: orders.new_count || 0, active: orders.active_count || 0 }, statuses: STATUSES });
      }
      if (req.method === 'GET' && route === '/api/admin/orders') {
        requireAdmin(req); const search = text(url.searchParams.get('search'), 'search', 100), status = url.searchParams.get('status') || '', offset = Number(url.searchParams.get('offset') || 0);
        if (status && !STATUSES.includes(status)) throw failure(400, 'Unknown order status.');
        if (!Number.isSafeInteger(offset) || offset < 0) throw failure(400, 'Invalid page.');
        const where = [], params = []; if (status) { where.push('status=?'); params.push(status); }
        if (search) { where.push('(instr(lower(customer_name),lower(?))>0 OR instr(phone,?)>0 OR instr(lower(reference),lower(?))>0)'); params.push(search, search, search); }
        const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
        const total = db.prepare('SELECT COUNT(*) AS count FROM orders' + clause).get(...params).count;
        const items = db.prepare(`SELECT id,reference,created_at,customer_name,phone,occasion,event_date,status,total_paise,advance_received_paise,advance_requested_paise,revision FROM orders${clause} ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?`).all(...params, offset);
        return json(res, 200, { items, total, offset, limit: 50 });
      }
      const orderRoute = route.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})(\/image)?$/);
      if (orderRoute) {
        requireAdmin(req, req.method === 'PATCH'); const id = orderRoute[1]; const row = db.prepare('SELECT *,custom_image IS NOT NULL AS has_image FROM orders WHERE id=?').get(id);
        if (!row) throw failure(404, 'Order not found.');
        if (req.method === 'GET' && orderRoute[2]) { if (!row.custom_image) throw failure(404, 'No custom picture for this order.'); res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); return res.end(Buffer.from(row.custom_image)); }
        if (req.method === 'GET') return json(res, 200, { order: orderPublicRow(row), history: db.prepare('SELECT created_at,actor,summary FROM order_history WHERE order_id=? ORDER BY id DESC LIMIT 100').all(id) });
        if (req.method === 'PATCH' && !orderRoute[2]) {
          const body = await readJSON(req), revision = number(body.revision, 'revision', 2147483647);
          const status = text(body.status, 'status', 40, true), notes = text(body.ownerNotes, 'owner notes', 4000);
          if (!STATUSES.includes(status)) throw failure(400, 'Unknown order status.');
          const total = number(body.totalPaise, 'quoted total', 100000000, true), requested = number(body.advanceRequestedPaise, 'advance requested', 100000000), received = number(body.advanceReceivedPaise, 'advance received', 100000000);
          if ((total === null && (requested || received)) || (total !== null && (requested > total || received > total))) throw failure(400, 'Advances cannot exceed the quoted total.');
          if (['Confirmed', 'Baking', 'Ready', 'Completed'].includes(status) && (total === null || received < requested)) throw failure(400, 'Set the quote and record the required advance before confirming the order.');
          const now = new Date().toISOString(); db.exec('BEGIN IMMEDIATE');
          try {
            const result = db.prepare('UPDATE orders SET status=?,total_paise=?,advance_requested_paise=?,advance_received_paise=?,owner_notes=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(status, total, requested, received, notes, now, id, revision);
            if (!result.changes) throw failure(409, 'This order was updated elsewhere. Reopen it to see the latest details.');
            const changes = []; if (status !== row.status) changes.push(`Status: ${row.status} → ${status}`); if (total !== row.total_paise) changes.push(`Quote: ${total === null ? 'not set' : 'INR ' + (total / 100).toFixed(2)}`); if (requested !== row.advance_requested_paise) changes.push(`Advance requested: INR ${(requested / 100).toFixed(2)}`); if (received !== row.advance_received_paise) changes.push(`Manually recorded advance received: INR ${(received / 100).toFixed(2)}`); if (notes !== row.owner_notes) changes.push('Owner notes updated');
            db.prepare('INSERT INTO order_history(order_id,created_at,actor,summary) VALUES(?,?,?,?)').run(id, now, 'Owner', changes.join('; ') || 'Order reviewed'); db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          return json(res, 200, { order: orderPublicRow(db.prepare('SELECT *,custom_image IS NOT NULL AS has_image FROM orders WHERE id=?').get(id)) });
        }
      }
      if (route.startsWith('/api/')) throw failure(404, 'API route not found.');
      if (!['GET', 'HEAD'].includes(req.method)) throw failure(405, 'Method not allowed.');
      const file = route === '/' ? 'index.html' : route === '/admin' || route === '/admin/' ? 'admin.html' : route === '/privacy' ? 'privacy.html' : route.slice(1);
      if (!STATIC.has(file) && !/^assets\/bake-\d+\.jpg$/.test(file)) throw failure(404, 'Page not found.');
      const fullPath = path.join(ROOT, file); if (!fs.existsSync(fullPath)) throw failure(404, 'Page not found.');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': file.startsWith('assets/') ? 'public, max-age=86400' : 'no-cache' });
      if (req.method === 'HEAD') return res.end(); fs.createReadStream(fullPath).pipe(res);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
      else res.end();
      if (!error.status) console.error('Request failed:', error.code || error.name);
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  return { server, db, async close() { await new Promise(resolve => server.close(resolve)); db.close(); } };
}
if (require.main === module) {
  createBakeryServer().then(app => {
    const port = Number(process.env.PORT || 8090), host = process.env.HOST || '0.0.0.0';
    app.server.listen(port, host, () => console.log(`B for Baking: http://localhost:${port}\nOwner dashboard: http://localhost:${port}/admin`));
    app.server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await app.close(); process.exit(0); });
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { createBakeryServer };
