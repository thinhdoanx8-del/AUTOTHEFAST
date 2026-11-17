'use strict';
/* Kho Nick: máy chủ web con. Chỉ dùng module có sẵn của Node.js (từ bản 18), không cần cài thêm gì. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------- đọc .env ---------- */
(function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();
const env = process.env;
const mother = require('./mother');
const payos = require('./payos');

const baseCfg = {
  port: parseInt(env.PORT, 10) || 3000,
  rate: parseFloat(env.RATE) || 1.5,                 // giá 1 like (đồng)
  minLikes: parseInt(env.MIN_LIKES, 10) || 1000,
  maxLikes: parseInt(env.MAX_LIKES, 10) || 1000000,
  discountCode: (env.DISCOUNT_CODE || '').trim().toUpperCase(),
  discountPct: parseFloat(env.DISCOUNT_PCT) || 0,
  demo: env.DEMO_MODE === '1',
  adminKey: env.ADMIN_KEY || '',
  cookieSecure: env.COOKIE_SECURE === '1',
  trustProxy: env.TRUST_PROXY === '1',
  dataFile: env.DATA_FILE || path.join(__dirname, 'data.json'),
  bank: { name: env.BANK_NAME || '', number: env.BANK_NUMBER || '', owner: env.BANK_OWNER || '', qrId: env.BANK_QR_ID || '', qrFallback: env.QR_FALLBACK_URL || '' },
  wallet: { name: env.WALLET_NAME || '', number: env.WALLET_NUMBER || '', owner: env.WALLET_OWNER || '' },
};

/* ---------- lưu dữ liệu (file JSON, ghi an toàn & tương thích ngược) ---------- */
let db = { users: [], sessions: {}, orders: [], topups: [], transactions: [], adminLogs: [], siteConfig: null, seq: 1 };
try {
  const raw = JSON.parse(fs.readFileSync(baseCfg.dataFile, 'utf8'));
  db = Object.assign(db, raw);
  if (!Array.isArray(db.users)) db.users = [];
  if (!db.sessions || typeof db.sessions !== 'object') db.sessions = {};
  if (!Array.isArray(db.orders)) db.orders = [];
  if (!Array.isArray(db.topups)) db.topups = [];
  if (!Array.isArray(db.transactions)) db.transactions = [];
  if (!Array.isArray(db.adminLogs)) db.adminLogs = [];
} catch (e) { /* lần chạy đầu chưa có file */ }

const cfg = Object.assign({}, baseCfg, {
  bank: Object.assign({}, baseCfg.bank),
  wallet: Object.assign({}, baseCfg.wallet),
});

function applySavedSiteConfig() {
  const sc = db.siteConfig;
  if (!sc || typeof sc !== 'object') return;
  if (typeof sc.rate === 'number' && sc.rate > 0) cfg.rate = sc.rate;
  if (Number.isInteger(sc.minLikes) && sc.minLikes >= 1) cfg.minLikes = sc.minLikes;
  if (Number.isInteger(sc.maxLikes) && sc.maxLikes >= cfg.minLikes) cfg.maxLikes = sc.maxLikes;
  if (typeof sc.discountCode === 'string') cfg.discountCode = sc.discountCode.trim().toUpperCase();
  if (typeof sc.discountPct === 'number' && sc.discountPct >= 0 && sc.discountPct <= 100) cfg.discountPct = sc.discountPct;
  if (typeof sc.demo === 'boolean') cfg.demo = sc.demo;
  if (sc.bank && typeof sc.bank === 'object') {
    cfg.bank = Object.assign({}, cfg.bank, {
      name: String(sc.bank.name ?? cfg.bank.name),
      number: String(sc.bank.number ?? cfg.bank.number),
      owner: String(sc.bank.owner ?? cfg.bank.owner),
      qrId: String(sc.bank.qrId ?? cfg.bank.qrId),
      qrFallback: String(sc.bank.qrFallback ?? cfg.bank.qrFallback),
    });
  }
  if (sc.wallet && typeof sc.wallet === 'object') {
    cfg.wallet = Object.assign({}, cfg.wallet, {
      name: String(sc.wallet.name ?? cfg.wallet.name),
      number: String(sc.wallet.number ?? cfg.wallet.number),
      owner: String(sc.wallet.owner ?? cfg.wallet.owner),
    });
  }
}
applySavedSiteConfig();

function save() {
  const tmp = cfg.dataFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, cfg.dataFile);
}
const r2 = n => Math.round(n * 100) / 100;
const nextId = (prefix) => prefix + String(db.seq++).padStart(5, '0');
const userById = id => db.users.find(u => u.id === id);

/* ---------- ghi nhận giao dịch & nhật ký quản trị ---------- */
function recordTx({ userId, type, amount, before, after, note, refId }) {
  const u = userById(userId);
  const tx = {
    id: nextId('GD'),
    userId,
    userName: u ? u.name : ('#' + userId),
    type, // 'topup' | 'admin_add' | 'admin_sub' | 'order_pay' | 'order_refund'
    amount: r2(amount),
    balanceBefore: r2(before),
    balanceAfter: r2(after),
    note: String(note || ''),
    refId: refId || '',
    createdAt: Date.now(),
  };
  db.transactions.push(tx);
  if (db.transactions.length > 5000) db.transactions = db.transactions.slice(-5000);
  return tx;
}

function recordAdminLog({ action, target, before, after, reason }) {
  const entry = {
    id: nextId('LOG'),
    actor: 'Admin (ADMIN_KEY)',
    action,
    target: String(target || ''),
    before: before !== undefined ? String(before) : '',
    after: after !== undefined ? String(after) : '',
    reason: String(reason || ''),
    createdAt: Date.now(),
  };
  db.adminLogs.push(entry);
  if (db.adminLogs.length > 5000) db.adminLogs = db.adminLogs.slice(-5000);
  return entry;
}

/* ---------- giới hạn số lần thử ---------- */
const hits = new Map();
function limited(ip, key, max, windowMs) {
  const k = key + '|' + ip, now = Date.now();
  let h = hits.get(k);
  if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(k, h); }
  h.n++;
  return h.n > max;
}
setInterval(() => { const n = Date.now(); for (const [k, h] of hits) if (h.reset < n) hits.delete(k); }, 60000).unref();

/* ---------- mật khẩu, phiên đăng nhập ---------- */
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function samePw(pw, user) {
  const a = Buffer.from(hashPw(pw, user ? user.salt : 'x'.repeat(32)), 'hex');
  const b = Buffer.from(user ? user.hash : '0'.repeat(128), 'hex');
  return user && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function currentUser(req) {
  const tok = parseCookies(req).sid; if (!tok) return null;
  const s = db.sessions[sha(tok)];
  if (!s || s.exp < Date.now()) return null;
  const u = userById(s.userId) || null;
  if (u && u.locked) return null;
  return u;
}
function startSession(res, user) {
  const tok = crypto.randomBytes(32).toString('hex');
  db.sessions[sha(tok)] = { userId: user.id, exp: Date.now() + 30 * 864e5 };
  for (const k of Object.keys(db.sessions)) if (db.sessions[k].exp < Date.now()) delete db.sessions[k];
  save();
  res.setHeader('Set-Cookie', `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${cfg.cookieSecure ? '; Secure' : ''}`);
}
const pubUser = u => ({ id: u.id, name: u.name, balance: u.balance, code: u.code });

/* ---------- tiện ích HTTP ---------- */
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
const fail = (res, status, msg) => send(res, status, { error: msg });
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 100000) { reject(new Error('big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('json')); } });
    req.on('error', reject);
  });
}
function clientIp(req) {
  if (cfg.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}
const adminOk = req => {
  if (!cfg.adminKey) return false;
  const a = Buffer.from(sha(String(req.headers['x-admin-key'] || ''))), b = Buffer.from(sha(cfg.adminKey));
  return crypto.timingSafeEqual(a, b);
};

/* ---------- đơn hàng ---------- */
const ACTIVE = o => o.status === 'wait' || o.status === 'running';
function refundRest(o) {            // hoàn lại phần chưa chạy của đơn (một lần duy nhất)
  if (o.refunded) return;
  o.refunded = true;
  const u = userById(o.userId);
  const rest = r2(o.cost * (o.likes - (o.done || 0)) / o.likes);
  if (u && rest > 0) {
    const before = u.balance;
    u.balance = r2(u.balance + rest);
    recordTx({
      userId: u.id,
      type: 'order_refund',
      amount: rest,
      before,
      after: u.balance,
      note: `Hoàn tiền đơn hàng ${o.id}`,
      refId: o.id,
    });
  }
  o.refundAmount = rest;
}
function applyStatus(o, st) {
  if (!st) return;
  if (typeof st.done === 'number') o.done = Math.max(0, Math.min(o.likes, Math.round(st.done)));
  if (st.state === 'done') { o.status = 'ok'; o.done = o.likes; }
  else if (st.state === 'failed') { o.status = 'fail'; refundRest(o); }
  else if (st.state === 'canceled') { o.status = 'cancel'; refundRest(o); }
}
async function syncOrder(o) {
  if (o.status !== 'running' || !o.motherId) return;
  const now = Date.now();
  if (now - (o.lastCheck || 0) < 8000) return;
  o.lastCheck = now;
  try { applyStatus(o, await mother.getStatus(o.motherId, o)); }
  catch (e) { console.error('[getStatus]', o.id, e.message); }
}
const pubOrder = o => ({ id: o.id, code: o.code, likes: o.likes, cost: o.cost, note: o.note, status: o.status, done: o.done || 0, createdAt: o.createdAt, refundAmount: o.refundAmount || 0 });
const pubTopup = t => ({ id: t.id, amount: t.amount, method: t.method, status: t.status, createdAt: t.createdAt });

/* ---------- tiện ích thống kê & hợp nhất dữ liệu cho Admin ---------- */
function dayKey(ts) {
  const d = new Date(ts || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getAllTransactions() {
  const recorded = db.transactions.slice();
  const recordedRefs = new Set(recorded.map(x => `${x.type}:${x.refId}`).filter(x => !x.endsWith(':')));
  const legacy = [];
  for (const t of db.topups) {
    if (t.status === 'ok' && !recordedRefs.has(`topup:${t.id}`)) {
      const u = userById(t.userId);
      legacy.push({
        id: 'GD-' + t.id,
        userId: t.userId,
        userName: u ? u.name : ('#' + t.userId),
        type: 'topup',
        amount: r2(t.amount),
        balanceBefore: null,
        balanceAfter: null,
        note: `Nạp tiền (${t.method === 'wallet' ? 'Ví điện tử' : 'Ngân hàng'})`,
        refId: t.id,
        createdAt: t.doneAt || t.createdAt,
      });
    }
  }
  for (const o of db.orders) {
    if (!recordedRefs.has(`order_pay:${o.id}`)) {
      const u = userById(o.userId);
      legacy.push({
        id: 'GD-PAY-' + o.id,
        userId: o.userId,
        userName: u ? u.name : ('#' + o.userId),
        type: 'order_pay',
        amount: -r2(o.cost),
        balanceBefore: null,
        balanceAfter: null,
        note: `Thanh toán đơn hàng ${o.id} (${o.code})`,
        refId: o.id,
        createdAt: o.createdAt,
      });
    }
    if ((o.refundAmount || 0) > 0 && !recordedRefs.has(`order_refund:${o.id}`)) {
      const u = userById(o.userId);
      legacy.push({
        id: 'GD-REF-' + o.id,
        userId: o.userId,
        userName: u ? u.name : ('#' + o.userId),
        type: 'order_refund',
        amount: r2(o.refundAmount),
        balanceBefore: null,
        balanceAfter: null,
        note: `Hoàn tiền đơn hàng ${o.id}`,
        refId: o.id,
        createdAt: o.createdAt,
      });
    }
  }
  return [...recorded, ...legacy].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function inDateRange(ts, fromStr, toStr) {
  if (!fromStr && !toStr) return true;
  const k = dayKey(ts);
  if (fromStr && k < fromStr) return false;
  if (toStr && k > toStr) return false;
  return true;
}

/* ---------- gửi mã OTP qua Gmail (nodemailer) ---------- */
let mailTransport = null;
async function sendOtpEmail(to, otp) {
  const user = env.SMTP_USER || '', pass = (env.SMTP_PASS || '').replace(/\s+/g, '');
  const generic = new Error('Không thể gửi email OTP lúc này, hãy thử lại sau.');   // khách chỉ thấy câu này, chi tiết lỗi in ở cửa sổ chạy
  if (!user || !pass) { console.error('[SMTP] Chưa điền SMTP_USER hoặc SMTP_PASS trong .env'); throw generic; }
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch (e) { console.error('[SMTP] Thiếu nodemailer. Chạy: npm install nodemailer'); throw generic; }
  if (!mailTransport) {
    const port = parseInt(env.SMTP_PORT, 10) || 465;
    mailTransport = nodemailer.createTransport({
      host: env.SMTP_HOST || 'smtp.gmail.com', port,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE !== 'false' : port === 465,
      auth: { user, pass },
    });
  }
  try {
    await mailTransport.sendMail({
      from: env.MAIL_FROM || user, to,
      subject: `${otp} là mã OTP đặt lại mật khẩu Kho Nick`,
      text: `Mã OTP của bạn là: ${otp}\n\nMã có hiệu lực 5 phút. Không chia sẻ mã này cho bất kỳ ai.\nNếu không phải bạn yêu cầu, hãy bỏ qua email này.`,
    });
  } catch (e) { console.error('[SMTP]', e.message); throw generic; }
}

/* ---------- nạp tiền tự động qua payOS ---------- */
function creditTopup(t, note) {          // cộng tiền cho khách đúng một lần (gọi lại cũng không cộng thêm)
  if (t.status !== 'wait') return false;
  const u = userById(t.userId); if (!u) return false;
  const before = r2(u.balance || 0);
  u.balance = r2(before + t.amount); t.status = 'ok'; t.doneAt = Date.now();
  recordTx({ userId: u.id, type: 'topup', amount: t.amount, before, after: u.balance, note, refId: t.id });
  return true;
}
async function syncPayos(t) {            // hỏi payOS đơn nạp này đã trả tiền hay chưa (chạy được cả khi chưa có webhook)
  if (t.method !== 'payos' || t.status !== 'wait' || !t.payos) return;
  const now = Date.now();
  if (now - (t.lastCheck || 0) < 4000) return;
  t.lastCheck = now;
  try {
    const p = await payos.getPayment(t.payos.orderCode);
    const got = p.amountPaid || p.amount;
    if (p.status === 'PAID' && got >= t.amount) creditTopup(t, `Nạp tiền PayOS ${t.id}`);
    else if (p.status === 'CANCELLED' || p.status === 'EXPIRED') {
      t.status = 'reject'; t.doneAt = now; t.rejectReason = p.status === 'EXPIRED' ? 'Hết hạn thanh toán' : 'Khách hủy thanh toán';
    }
  } catch (e) { console.error('[payOS sync]', t.id, e.message); }
}

/* ---------- các đường dẫn API ---------- */
async function api(req, res, url) {
  const method = req.method, p = url.pathname, ip = clientIp(req);
  if (method === 'POST' && !String(req.headers['content-type'] || '').includes('application/json')) return fail(res, 415, 'Yêu cầu không hợp lệ');
  let body = {};
  if (method === 'POST') { try { body = await readBody(req); } catch (e) { return fail(res, 400, 'Dữ liệu gửi lên không hợp lệ'); } }

  if (method === 'GET' && p === '/api/config') {
    return send(res, 200, {
      rate: cfg.rate, minLikes: cfg.minLikes, maxLikes: cfg.maxLikes, demo: cfg.demo,
      discount: cfg.discountCode ? { pct: cfg.discountPct } : null,
      bank: cfg.bank, wallet: cfg.wallet.number ? cfg.wallet : null, mock: mother.MOCK,
    });
  }

  if (method === 'POST' && p === '/api/discount') {
    if (limited(ip, 'disc', 30, 60e3)) return fail(res, 429, 'Bạn thao tác quá nhanh, hãy thử lại sau');
    const dc = String(body.code || '').trim().toUpperCase();
    if (cfg.discountCode && dc === cfg.discountCode) return send(res, 200, { pct: cfg.discountPct });
    return fail(res, 400, 'Mã giảm giá không hợp lệ hoặc đã hết hạn.');
  }

  /* ----- webhook payOS: payOS báo khách đã chuyển tiền (không cần đăng nhập, bảo vệ bằng chữ ký) ----- */
  if (method === 'POST' && p === '/api/payos/webhook') {
    if (limited(ip, 'payos-wh', 300, 60e3)) return fail(res, 429, 'Quá nhiều yêu cầu');
    const data = payos.verifyWebhook(body);
    if (!data) return fail(res, 400, 'Chữ ký không hợp lệ');
    if (String(body.code) === '00' && String(data.code || '00') === '00') {
      const t = db.topups.find(x => x.payos && Number(x.payos.orderCode) === Number(data.orderCode));
      if (t && t.status === 'wait') {
        if (Number(data.amount) !== t.amount) console.error('[payOS webhook] sai số tiền', t.id, data.amount, 'khác', t.amount);
        else {
          try {
            const pm = await payos.getPayment(t.payos.orderCode);          // đối chiếu lại trực tiếp với payOS trước khi cộng tiền
            if (pm.status === 'PAID') { if (creditTopup(t, `Nạp tiền PayOS ${t.id}`)) save(); }
            else console.error('[payOS webhook] payOS chưa báo PAID', t.id, pm.status);
          } catch (e) { console.error('[payOS webhook]', e.message); return send(res, 500, { error: 1, message: 'thử lại sau' }); }
        }
      }
    }
    return send(res, 200, { error: 0, message: 'ok' });   // luôn 200 khi chữ ký đúng (kể cả webhook thử của payOS với đơn không tồn tại)
  }

  /* ----- tài khoản ----- */
  if (method === 'POST' && p === '/api/check-email') {
    if (limited(ip, 'chk-email', 40, 60e3)) return fail(res, 429, 'Bạn thao tác quá nhanh, hãy thử lại sau');
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return fail(res, 400, 'Địa chỉ Gmail không hợp lệ.');
    const exists = db.users.some(u => u.email && u.email.toLowerCase() === email);
    return send(res, 200, { exists });
  }
  if (method === 'POST' && p === '/api/register') {
    if (limited(ip, 'reg', 10, 3600e3)) return fail(res, 429, 'Bạn thao tác quá nhiều, hãy thử lại sau');
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const pw = String(body.password || '');
    if (!/^[A-Za-z0-9_.-]{3,24}$/.test(name)) return fail(res, 400, 'Tên đăng nhập cần 3 đến 24 ký tự (chữ không dấu, số, _ . -), không có dấu cách.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return fail(res, 400, 'Địa chỉ Gmail không hợp lệ.');
    if (pw.length < 6 || pw.length > 100) return fail(res, 400, 'Mật khẩu cần tối thiểu 6 ký tự.');
    if (db.users.some(u => u.name.toLowerCase() === name.toLowerCase())) return fail(res, 409, 'Tên đăng nhập này đã có người dùng. Hãy chọn tên khác.');
    if (db.users.some(u => u.email && u.email.toLowerCase() === email)) return fail(res, 409, 'Gmail này đã được sử dụng cho tài khoản khác.');
    const salt = crypto.randomBytes(16).toString('hex');
    const id = db.seq++;
    const user = { id, name, email, salt, hash: hashPw(pw, salt), balance: 0, code: 'NAP' + id.toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase(), createdAt: Date.now() };
    db.users.push(user); startSession(res, user); save();
    return send(res, 200, { user: pubUser(user) });
  }
  if (method === 'POST' && p === '/api/login') {
    if (limited(ip, 'login', 15, 15 * 60e3)) return fail(res, 429, 'Bạn đăng nhập sai quá nhiều lần, hãy thử lại sau 15 phút');
    const name = String(body.name || '').trim().toLowerCase();
    const user = db.users.find(u => u.name.toLowerCase() === name);
    if (!samePw(String(body.password || ''), user)) return fail(res, 401, 'Sai tên đăng nhập hoặc mật khẩu.');
    startSession(res, user);
    return send(res, 200, { user: pubUser(user) });
  }
  if (method === 'POST' && p === '/api/forgot-password') {
    if (limited(ip, 'forgot-ip', 6, 300e3)) return fail(res, 429, 'Bạn yêu cầu quá nhiều lần, hãy thử lại sau 5 phút.');
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return fail(res, 400, 'Địa chỉ Gmail không hợp lệ.');
    if (limited(email, 'forgot-mail', 4, 300e3)) return fail(res, 429, 'Gmail này đã yêu cầu OTP quá nhiều lần, vui lòng đợi 5 phút.');

    const user = db.users.find(u => u.email && u.email.toLowerCase() === email);
    if (user) {
      const now = Date.now();
      if (user.resendOtpAfter && user.resendOtpAfter > now) {
        const waitSec = Math.ceil((user.resendOtpAfter - now) / 1000);
        return fail(res, 429, `Vui lòng đợi ${waitSec} giây trước khi gửi lại mã OTP.`);
      }
      const otp = String(crypto.randomInt(100000, 1000000));
      user.resetOtpHash = sha(otp);
      user.resetOtpExp = now + 5 * 60 * 1000;
      user.resetAttempts = 0;
      user.resendOtpAfter = now + 60 * 1000;
      user.resetTokenHash = null;
      user.resetTokenExp = null;
      save();

      try {
        await sendOtpEmail(user.email, otp);
      } catch (e) {
        user.resetOtpHash = null;
        user.resetOtpExp = null;
        user.resendOtpAfter = 0;
        save();
        console.error('[SMTP]', e.message);
        return fail(res, 500, e.message || 'Không thể gửi email OTP lúc này.');
      }
    }
    return send(res, 200, { ok: true, message: 'Nếu Gmail đã đăng ký trên hệ thống, mã OTP đã được gửi.' });
  }
  if (method === 'POST' && p === '/api/verify-reset-otp') {
    if (limited(ip, 'verify-otp', 15, 300e3)) return fail(res, 429, 'Bạn thử quá nhiều lần, vui lòng đợi 5 phút.');
    const email = String(body.email || '').trim().toLowerCase();
    const otp = String(body.otp || '').trim();
    if (!email || !/^\d{6}$/.test(otp)) return fail(res, 400, 'Mã OTP không hợp lệ.');

    const user = db.users.find(u => u.email && u.email.toLowerCase() === email);
    if (!user || !user.resetOtpHash || !user.resetOtpExp) return fail(res, 400, 'Mã OTP không chính xác hoặc đã hết hạn.');

    const now = Date.now();
    if (user.resetOtpExp < now) {
      user.resetOtpHash = null;
      user.resetOtpExp = null;
      save();
      return fail(res, 400, 'Mã OTP đã hết hạn. Vui lòng yêu cầu gửi lại mã mới.');
    }
    if ((user.resetAttempts || 0) >= 5) {
      user.resetOtpHash = null;
      user.resetOtpExp = null;
      save();
      return fail(res, 400, 'Bạn đã nhập sai OTP quá 5 lần. Mã hiện tại đã bị vô hiệu hóa.');
    }

    const a = Buffer.from(sha(otp), 'hex');
    const b = Buffer.from(user.resetOtpHash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      user.resetAttempts = (user.resetAttempts || 0) + 1;
      if (user.resetAttempts >= 5) {
        user.resetOtpHash = null;
        user.resetOtpExp = null;
        save();
        return fail(res, 400, 'Bạn đã nhập sai OTP 5 lần. Mã OTP đã bị vô hiệu hóa.');
      }
      save();
      return fail(res, 400, `Mã OTP không chính xác (còn ${5 - user.resetAttempts} lần thử).`);
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetTokenHash = sha(resetToken);
    user.resetTokenExp = now + 10 * 60 * 1000;
    user.resetOtpHash = null;
    user.resetOtpExp = null;
    user.resetAttempts = 0;
    save();
    return send(res, 200, { resetToken });
  }
  if (method === 'POST' && p === '/api/reset-password') {
    if (limited(ip, 'reset-pw', 10, 300e3)) return fail(res, 429, 'Bạn thao tác quá nhiều lần, vui lòng thử lại sau.');
    const resetToken = String(body.resetToken || '').trim();
    const pw = String(body.password || '');
    if (!resetToken || resetToken.length !== 64) return fail(res, 400, 'Phiên khôi phục mật khẩu không hợp lệ.');
    if (pw.length < 6 || pw.length > 100) return fail(res, 400, 'Mật khẩu mới cần tối thiểu 6 ký tự.');

    const tokHash = sha(resetToken);
    const user = db.users.find(u => u.resetTokenHash && u.resetTokenHash === tokHash);
    if (!user || !user.resetTokenExp || user.resetTokenExp < Date.now()) {
      return fail(res, 400, 'Phiên đặt lại mật khẩu đã hết hạn hoặc không hợp lệ.');
    }

    const salt = crypto.randomBytes(16).toString('hex');
    user.salt = salt;
    user.hash = hashPw(pw, salt);
    user.resetTokenHash = null;
    user.resetTokenExp = null;
    user.resetOtpHash = null;
    user.resetOtpExp = null;
    user.resetAttempts = 0;

    for (const k of Object.keys(db.sessions)) {
      if (db.sessions[k].userId === user.id) delete db.sessions[k];
    }
    save();
    return send(res, 200, { ok: true, message: 'Đổi mật khẩu thành công' });
  }
  if (method === 'POST' && p === '/api/logout') {
    const tok = parseCookies(req).sid; if (tok) { delete db.sessions[sha(tok)]; save(); }
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return send(res, 200, { ok: true });
  }
  if (method === 'GET' && p === '/api/me') {
    const u = currentUser(req);
    return send(res, 200, { user: u ? pubUser(u) : null });
  }

  /* ----- quản trị (khóa riêng X-Admin-Key) ----- */
  if (p.startsWith('/api/admin/')) {
    if (limited(ip, 'admin', 300, 15 * 60e3)) return fail(res, 429, 'Quá nhiều yêu cầu');
    if (!adminOk(req)) return fail(res, 403, 'Sai khóa quản trị');

    /* 1. Tổng quan Dashboard */
    if (method === 'GET' && p === '/api/admin/overview') {
      const totalUsers = db.users.length;
      const totalOrders = db.orders.length;
      const waitOrders = db.orders.filter(o => o.status === 'wait').length;
      const runningOrders = db.orders.filter(o => o.status === 'running').length;
      const okOrders = db.orders.filter(o => o.status === 'ok').length;
      const failOrders = db.orders.filter(o => o.status === 'fail').length;
      const cancelOrders = db.orders.filter(o => o.status === 'cancel').length;
      const totalTopupAmount = r2(db.topups.filter(t => t.status === 'ok').reduce((s, t) => s + (Number(t.amount) || 0), 0));
      const totalRevenue = r2(db.orders.reduce((s, o) => s + Math.max(0, (Number(o.cost) || 0) - (Number(o.refundAmount) || 0)), 0));
      const totalUserBalance = r2(db.users.reduce((s, u) => s + (Number(u.balance) || 0), 0));
      const pendingTopups = db.topups.filter(t => t.status === 'wait').length;

      // Chuỗi 14 ngày gần nhất từ dữ liệu thật
      const days = [];
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        days.push({
          date: dayKey(d.getTime()),
          label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
          revenue: 0,
          orders: 0,
          users: 0,
        });
      }
      const mapDay = new Map(days.map(d => [d.date, d]));
      for (const o of db.orders) {
        const item = mapDay.get(dayKey(o.createdAt));
        if (item) {
          item.orders += 1;
          item.revenue = r2(item.revenue + Math.max(0, (Number(o.cost) || 0) - (Number(o.refundAmount) || 0)));
        }
      }
      for (const u of db.users) {
        const item = mapDay.get(dayKey(u.createdAt));
        if (item) item.users += 1;
      }

      return send(res, 200, {
        stats: {
          totalUsers,
          totalOrders,
          waitOrders,
          runningOrders,
          okOrders,
          failOrders,
          cancelOrders,
          totalTopupAmount,
          totalRevenue,
          totalUserBalance,
          pendingTopups,
        },
        charts: {
          daily: days,
          statusBreakdown: {
            wait: waitOrders,
            running: runningOrders,
            ok: okOrders,
            fail: failOrders,
            cancel: cancelOrders,
          },
        },
      });
    }

    /* 2. Quản lý người dùng */
    if (method === 'GET' && p === '/api/admin/users') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const status = String(url.searchParams.get('status') || '').trim();
      const list = db.users
        .map(u => {
          const uOrders = db.orders.filter(o => o.userId === u.id);
          const uTopups = db.topups.filter(t => t.userId === u.id && t.status === 'ok');
          return {
            id: u.id,
            name: u.name,
            code: u.code,
            balance: r2(u.balance || 0),
            createdAt: u.createdAt || 0,
            orderCount: uOrders.length,
            totalTopup: r2(uTopups.reduce((s, t) => s + (Number(t.amount) || 0), 0)),
            locked: !!u.locked,
            lockReason: u.lockReason || '',
          };
        })
        .filter(u => {
          if (q && !u.name.toLowerCase().includes(q) && String(u.id) !== q && !(u.code || '').toLowerCase().includes(q)) return false;
          if (status === 'active' && u.locked) return false;
          if (status === 'locked' && !u.locked) return false;
          if (status === 'has_balance' && u.balance <= 0) return false;
          return true;
        })
        .sort((a, b) => b.id - a.id);
      return send(res, 200, { users: list });
    }

    let mUser = p.match(/^\/api\/admin\/users\/(\d+)$/);
    if (method === 'GET' && mUser) {
      const uid = parseInt(mUser[1], 10);
      const u = userById(uid);
      if (!u) return fail(res, 404, 'Không tìm thấy người dùng');
      const uOrders = db.orders.filter(o => o.userId === u.id).slice().reverse().map(pubOrder);
      const uTopups = db.topups.filter(t => t.userId === u.id).slice().reverse().map(t => ({
        ...pubTopup(t),
        doneAt: t.doneAt || null,
      }));
      const uTxs = getAllTransactions().filter(x => x.userId === u.id).slice(0, 100);
      return send(res, 200, {
        user: {
          id: u.id,
          name: u.name,
          code: u.code,
          balance: r2(u.balance || 0),
          createdAt: u.createdAt || 0,
          locked: !!u.locked,
          lockReason: u.lockReason || '',
          orderCount: uOrders.length,
          totalTopup: r2(db.topups.filter(t => t.userId === u.id && t.status === 'ok').reduce((s, t) => s + (Number(t.amount) || 0), 0)),
        },
        orders: uOrders,
        topups: uTopups,
        transactions: uTxs,
      });
    }

    let mUserBal = p.match(/^\/api\/admin\/users\/(\d+)\/balance$/);
    if (method === 'POST' && mUserBal) {
      const uid = parseInt(mUserBal[1], 10);
      const u = userById(uid);
      if (!u) return fail(res, 404, 'Không tìm thấy người dùng');
      const kind = body.kind === 'sub' ? 'sub' : (body.kind === 'add' ? 'add' : '');
      const amount = r2(Number(body.amount));
      const reason = String(body.reason || '').trim().slice(0, 200);
      if (!kind) return fail(res, 400, 'Loại điều chỉnh không hợp lệ');
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) return fail(res, 400, 'Số tiền điều chỉnh phải lớn hơn 0');
      if (!reason || reason.length < 2) return fail(res, 400, 'Vui lòng nhập lý do điều chỉnh số dư');
      const before = r2(u.balance || 0);
      if (kind === 'sub' && before < amount) return fail(res, 400, `Số dư hiện tại (${before.toLocaleString('vi-VN')}đ) không đủ để trừ ${amount.toLocaleString('vi-VN')}đ`);
      const after = kind === 'add' ? r2(before + amount) : r2(before - amount);
      u.balance = after;
      const tx = recordTx({
        userId: u.id,
        type: kind === 'add' ? 'admin_add' : 'admin_sub',
        amount: kind === 'add' ? amount : -amount,
        before,
        after,
        note: `${kind === 'add' ? 'Admin cộng tiền' : 'Admin trừ tiền'}: ${reason}`,
        refId: '',
      });
      recordAdminLog({
        action: kind === 'add' ? 'Cộng tiền tài khoản' : 'Trừ tiền tài khoản',
        target: `${u.name} (ID #${u.id})`,
        before: `${before.toLocaleString('vi-VN')}đ`,
        after: `${after.toLocaleString('vi-VN')}đ`,
        reason,
      });
      save();
      return send(res, 200, { ok: true, balance: after, transaction: tx });
    }

    let mUserLock = p.match(/^\/api\/admin\/users\/(\d+)\/lock$/);
    if (method === 'POST' && mUserLock) {
      const uid = parseInt(mUserLock[1], 10);
      const u = userById(uid);
      if (!u) return fail(res, 404, 'Không tìm thấy người dùng');
      const locked = Boolean(body.locked);
      const reason = String(body.reason || '').trim().slice(0, 200);
      if (locked && reason.length < 2) return fail(res, 400, 'Vui lòng nhập lý do khóa tài khoản');
      const prev = !!u.locked;
      if (prev === locked) return fail(res, 409, locked ? 'Tài khoản đã ở trạng thái khóa' : 'Tài khoản đang hoạt động');
      u.locked = locked;
      u.lockReason = locked ? reason : '';
      if (locked) {
        for (const k of Object.keys(db.sessions)) {
          if (db.sessions[k].userId === u.id) delete db.sessions[k];
        }
      }
      recordAdminLog({
        action: locked ? 'Khóa tài khoản' : 'Mở khóa tài khoản',
        target: `${u.name} (ID #${u.id})`,
        before: prev ? 'Đã khóa' : 'Hoạt động',
        after: locked ? 'Đã khóa' : 'Hoạt động',
        reason: reason || 'Mở khóa bởi Admin',
      });
      save();
      return send(res, 200, { ok: true, locked: u.locked });
    }

    /* 3. Quản lý đơn hàng */
    if (method === 'GET' && p === '/api/admin/orders') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const status = String(url.searchParams.get('status') || '').trim();
      const from = String(url.searchParams.get('from') || '').trim();
      const to = String(url.searchParams.get('to') || '').trim();
      const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
      const pageSize = Math.min(100, Math.max(5, parseInt(url.searchParams.get('pageSize'), 10) || 20));

      const filtered = db.orders
        .slice()
        .reverse()
        .map(o => {
          const u = userById(o.userId);
          return {
            id: o.id,
            userId: o.userId,
            userName: u ? u.name : ('#' + o.userId),
            code: o.code,
            likes: o.likes,
            cost: r2(o.cost || 0),
            done: o.done || 0,
            status: o.status,
            note: o.note || '',
            motherId: o.motherId || '',
            error: o.error || '',
            refundAmount: r2(o.refundAmount || 0),
            createdAt: o.createdAt || 0,
          };
        })
        .filter(o => {
          if (q && !o.id.toLowerCase().includes(q) && !o.userName.toLowerCase().includes(q) && !o.code.toLowerCase().includes(q)) return false;
          if (status && o.status !== status) return false;
          if (!inDateRange(o.createdAt, from, to)) return false;
          return true;
        });

      const total = filtered.length;
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const safePage = Math.min(page, pages);
      const items = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
      return send(res, 200, { orders: items, total, page: safePage, pages, pageSize });
    }

    /* 4. Quản lý nạp tiền */
    if (method === 'GET' && p === '/api/admin/topups') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const status = String(url.searchParams.get('status') || '').trim();
      const from = String(url.searchParams.get('from') || '').trim();
      const to = String(url.searchParams.get('to') || '').trim();

      const list = db.topups
        .slice()
        .reverse()
        .map(t => {
          const u = userById(t.userId);
          return {
            ...pubTopup(t),
            userId: t.userId,
            user: u ? u.name : ('#' + t.userId),
            content: u ? u.code : '',
            doneAt: t.doneAt || null,
            rejectReason: t.rejectReason || '',
          };
        })
        .filter(t => {
          if (status && t.status !== status) return false;
          if (q && !t.id.toLowerCase().includes(q) && !(t.user || '').toLowerCase().includes(q) && !(t.content || '').toLowerCase().includes(q)) return false;
          if (!inDateRange(t.createdAt, from, to)) return false;
          return true;
        });
      return send(res, 200, { topups: list });
    }

    let m = p.match(/^\/api\/admin\/topups\/([A-Z0-9]+)\/(approve|reject)$/);
    if (method === 'POST' && m) {
      const t = db.topups.find(x => x.id === m[1]);
      if (!t) return fail(res, 404, 'Không thấy yêu cầu nạp');
      if (t.status !== 'wait') return fail(res, 409, 'Yêu cầu này đã được xử lý');
      const u = userById(t.userId);
      if (!u) return fail(res, 404, 'Không tìm thấy tài khoản người dùng');
      const reason = String(body.reason || '').trim().slice(0, 200);
      if (m[2] === 'approve') {
        const before = r2(u.balance || 0);
        u.balance = r2(before + t.amount);
        t.status = 'ok';
        t.doneAt = Date.now();
        recordTx({
          userId: u.id,
          type: 'topup',
          amount: t.amount,
          before,
          after: u.balance,
          note: `Duyệt yêu cầu nạp ${t.id} (${t.method === 'wallet' ? 'Ví điện tử' : 'Ngân hàng'})`,
          refId: t.id,
        });
        recordAdminLog({
          action: 'Duyệt nạp tiền',
          target: `${t.id} - ${u.name}`,
          before: `Chờ duyệt (${before.toLocaleString('vi-VN')}đ)`,
          after: `Đã duyệt (+${t.amount.toLocaleString('vi-VN')}đ -> ${u.balance.toLocaleString('vi-VN')}đ)`,
          reason: reason || 'Đối chiếu chuyển khoản hợp lệ',
        });
      } else {
        t.status = 'reject';
        t.doneAt = Date.now();
        t.rejectReason = reason;
        recordAdminLog({
          action: 'Từ chối nạp tiền',
          target: `${t.id} - ${u.name}`,
          before: 'Chờ duyệt',
          after: 'Từ chối',
          reason: reason || 'Không khớp thông tin chuyển khoản',
        });
      }
      save();
      return send(res, 200, { ok: true });
    }

    /* 5. Quản lý số dư */
    if (method === 'GET' && p === '/api/admin/balances') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const users = db.users
        .map(u => ({
          id: u.id,
          name: u.name,
          code: u.code,
          balance: r2(u.balance || 0),
          locked: !!u.locked,
        }))
        .sort((a, b) => b.balance - a.balance);
      const totalBalance = r2(users.reduce((s, u) => s + u.balance, 0));
      const topUser = users.length ? users[0] : null;
      const filteredUsers = q ? users.filter(u => u.name.toLowerCase().includes(q) || String(u.id) === q) : users;
      const allTxs = getAllTransactions();
      const addHistory = allTxs.filter(x => x.type === 'topup' || x.type === 'admin_add').slice(0, 100);
      const subHistory = allTxs.filter(x => x.type === 'admin_sub' || x.type === 'order_pay').slice(0, 100);
      const refundHistory = allTxs.filter(x => x.type === 'order_refund').slice(0, 100);

      return send(res, 200, {
        summary: {
          totalBalance,
          userCount: users.length,
          topUser,
        },
        users: filteredUsers,
        history: {
          add: addHistory,
          sub: subHistory,
          refund: refundHistory,
        },
      });
    }

    /* 6. Lịch sử giao dịch tổng hợp */
    if (method === 'GET' && p === '/api/admin/transactions') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const type = String(url.searchParams.get('type') || '').trim();
      const from = String(url.searchParams.get('from') || '').trim();
      const to = String(url.searchParams.get('to') || '').trim();
      const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
      const pageSize = Math.min(100, Math.max(5, parseInt(url.searchParams.get('pageSize'), 10) || 25));

      const all = getAllTransactions().filter(tx => {
        if (type && tx.type !== type) return false;
        if (q && !tx.id.toLowerCase().includes(q) && !(tx.userName || '').toLowerCase().includes(q) && !(tx.note || '').toLowerCase().includes(q) && !(tx.refId || '').toLowerCase().includes(q)) return false;
        if (!inDateRange(tx.createdAt, from, to)) return false;
        return true;
      });
      const total = all.length;
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const safePage = Math.min(page, pages);
      const items = all.slice((safePage - 1) * pageSize, safePage * pageSize);
      return send(res, 200, { transactions: items, total, page: safePage, pages, pageSize });
    }

    /* 7. Cấu hình website */
    if (method === 'GET' && p === '/api/admin/settings') {
      return send(res, 200, {
        settings: {
          rate: cfg.rate,
          minLikes: cfg.minLikes,
          maxLikes: cfg.maxLikes,
          discountCode: cfg.discountCode,
          discountPct: cfg.discountPct,
          demo: cfg.demo,
          bank: cfg.bank,
          wallet: cfg.wallet,
          mockMother: mother.MOCK,
        },
      });
    }

    if (method === 'POST' && p === '/api/admin/settings') {
      const rate = Number(body.rate);
      const minLikes = parseInt(body.minLikes, 10);
      const maxLikes = parseInt(body.maxLikes, 10);
      const discountCode = String(body.discountCode || '').trim().toUpperCase().slice(0, 32);
      const discountPct = Number(body.discountPct || 0);
      const demo = Boolean(body.demo);
      const bankIn = body.bank && typeof body.bank === 'object' ? body.bank : {};
      const walletIn = body.wallet && typeof body.wallet === 'object' ? body.wallet : {};

      if (!Number.isFinite(rate) || rate <= 0 || rate > 1000000) return fail(res, 400, 'Giá mỗi like không hợp lệ');
      if (!Number.isInteger(minLikes) || minLikes < 1 || minLikes > 100000000) return fail(res, 400, 'Số like tối thiểu không hợp lệ');
      if (!Number.isInteger(maxLikes) || maxLikes < minLikes || maxLikes > 100000000) return fail(res, 400, 'Số like tối đa phải lớn hơn hoặc bằng tối thiểu');
      if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 90) return fail(res, 400, 'Phần trăm giảm giá từ 0 đến 90%');

      const prevSummary = `Giá: ${cfg.rate}đ | Min/Max: ${cfg.minLikes}/${cfg.maxLikes} | Giảm giá: ${cfg.discountCode || 'Không'} (${cfg.discountPct}%) | Demo: ${cfg.demo ? 'Bật' : 'Tắt'} | Bank: ${cfg.bank.name} ${cfg.bank.number}`;

      db.siteConfig = {
        rate: r2(rate),
        minLikes,
        maxLikes,
        discountCode,
        discountPct: r2(discountPct),
        demo,
        bank: {
          name: String(bankIn.name || '').trim().slice(0, 80),
          number: String(bankIn.number || '').trim().slice(0, 40),
          owner: String(bankIn.owner || '').trim().slice(0, 80),
          qrId: String(bankIn.qrId || '').trim().slice(0, 30),
          qrFallback: String(bankIn.qrFallback || '').trim().slice(0, 300),
        },
        wallet: {
          name: String(walletIn.name || '').trim().slice(0, 80),
          number: String(walletIn.number || '').trim().slice(0, 40),
          owner: String(walletIn.owner || '').trim().slice(0, 80),
        },
        updatedAt: Date.now(),
      };
      applySavedSiteConfig();

      const nextSummary = `Giá: ${cfg.rate}đ | Min/Max: ${cfg.minLikes}/${cfg.maxLikes} | Giảm giá: ${cfg.discountCode || 'Không'} (${cfg.discountPct}%) | Demo: ${cfg.demo ? 'Bật' : 'Tắt'} | Bank: ${cfg.bank.name} ${cfg.bank.number}`;
      recordAdminLog({
        action: 'Cập nhật cấu hình website',
        target: 'Cấu hình vận hành',
        before: prevSummary,
        after: nextSummary,
        reason: String(body.reason || '').trim().slice(0, 200) || 'Admin lưu thay đổi cấu hình',
      });
      save();
      return send(res, 200, { ok: true });
    }

    /* 8. Nhật ký hoạt động Admin (chỉ đọc) */
    if (method === 'GET' && p === '/api/admin/logs') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const action = String(url.searchParams.get('action') || '').trim();
      const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
      const pageSize = Math.min(100, Math.max(5, parseInt(url.searchParams.get('pageSize'), 10) || 25));

      const filtered = db.adminLogs
        .slice()
        .reverse()
        .filter(l => {
          if (action && l.action !== action) return false;
          if (q && !l.action.toLowerCase().includes(q) && !l.target.toLowerCase().includes(q) && !l.reason.toLowerCase().includes(q)) return false;
          return true;
        });
      const total = filtered.length;
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const safePage = Math.min(page, pages);
      const items = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
      return send(res, 200, { logs: items, total, page: safePage, pages, pageSize });
    }

    return fail(res, 404, 'Không tìm thấy');
  }

  /* ----- từ đây cần đăng nhập ----- */
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'Bạn cần đăng nhập');

  if (method === 'GET' && p === '/api/orders') {
    const mine = db.orders.filter(o => o.userId === user.id);
    await Promise.all(mine.filter(ACTIVE).map(syncOrder));
    save();
    return send(res, 200, { balance: user.balance, orders: mine.slice(-500).reverse().map(pubOrder) });
  }

  if (method === 'POST' && p === '/api/check-target') {
    if (limited(ip, 'chk', 30, 60e3)) return fail(res, 429, 'Bạn thao tác quá nhanh, hãy thử lại sau ít phút');
    try { return send(res, 200, { player: await mother.lookup(body.code) }); }
    catch (e) {
      if (e.status === 400 || e.status === 404) return fail(res, 404, 'Không tìm thấy tài khoản game này. Hãy kiểm tra lại UID hoặc Tên Game.');
      console.error('[check-target]', e.message);
      return fail(res, 502, 'Hệ thống đang bận, hãy thử lại sau ít phút.');
    }
  }

  if (method === 'POST' && p === '/api/orders') {
    if (limited(ip, 'order', 60, 60e3)) return fail(res, 429, 'Bạn thao tác quá nhanh, hãy thử lại sau ít phút');
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return fail(res, 400, 'Hãy nhập ít nhất một Uid hoặc Tên Game.');
    if (items.length > 50) return fail(res, 400, 'Mỗi lần tạo tối đa 50 dòng.');
    const note = String(body.note || '').trim().slice(0, 25);
    let pct = 0; const dc = String(body.discount || '').trim().toUpperCase();
    if (dc) { if (cfg.discountCode && dc === cfg.discountCode) pct = cfg.discountPct; else return fail(res, 400, 'Mã giảm giá không hợp lệ hoặc đã hết hạn.'); }
    const unit = r2(cfg.rate * (1 - pct / 100));
    const clean = [];
    for (let i = 0; i < items.length; i++) {
      const code = String((items[i] || {}).code || '').trim(), likes = Number((items[i] || {}).likes);
      if (code.length < 1 || code.length > 40 || !Number.isInteger(likes) || likes < cfg.minLikes || likes > cfg.maxLikes)
        return fail(res, 400, `Dòng ${i + 1} sai định dạng. Uid hoặc Tên Game tối đa 40 ký tự, số like từ ${cfg.minLikes.toLocaleString('vi-VN')} đến ${cfg.maxLikes.toLocaleString('vi-VN')}.`);
      clean.push({ code, likes, cost: r2(likes * unit) });
    }
    const total = r2(clean.reduce((t, x) => t + x.cost, 0));
    if (user.balance < total) return fail(res, 402, `Không đủ số dư. Cần ${total.toLocaleString('vi-VN')}đ, bạn có ${user.balance.toLocaleString('vi-VN')}đ.`);
    const balBefore = user.balance;
    user.balance = r2(user.balance - total);       // trừ tiền trước, lỗi thì hoàn lại
    const created = clean.map(x => ({ id: nextId('BH'), userId: user.id, code: x.code, likes: x.likes, cost: x.cost, note, status: 'wait', done: 0, createdAt: Date.now() }));
    let runningBal = balBefore;
    for (const o of created) {
      const b0 = runningBal;
      runningBal = r2(runningBal - o.cost);
      recordTx({
        userId: user.id,
        type: 'order_pay',
        amount: -o.cost,
        before: b0,
        after: runningBal,
        note: `Thanh toán đơn hàng ${o.id} (${o.code})`,
        refId: o.id,
      });
    }
    db.orders.push(...created); save();
    for (const o of created) {
      try {
        const r = await mother.createOrder({ uid: o.code, likes: o.likes, note: o.note, orderId: o.id });
        o.motherId = String(r.motherId); o.status = 'running';
      } catch (e) {
        console.error('[createOrder]', o.id, e.message);
        o.status = 'fail'; o.error = e.message; refundRest(o);
      }
      save();
    }
    return send(res, 200, { balance: user.balance, orders: created.map(pubOrder) });
  }

  let m = p.match(/^\/api\/orders\/([A-Z0-9]+)\/cancel$/);
  if (method === 'POST' && m) {
    const o = db.orders.find(x => x.id === m[1] && x.userId === user.id);
    if (!o) return fail(res, 404, 'Không thấy đơn hàng');
    if (!ACTIVE(o)) return fail(res, 409, 'Đơn này không thể hủy nữa');
    try {
      const st = await mother.getStatus(o.motherId, o);
      if (st && st.done > 0) { applyStatus(o, st); save(); return fail(res, 409, 'Đơn đã bắt đầu chạy nên không hủy được'); }
      await mother.cancelOrder(o.motherId, o);
    } catch (e) { console.error('[cancel]', o.id, e.message); return fail(res, 409, 'Không hủy được đơn này lúc này'); }
    o.status = 'cancel'; refundRest(o); save();
    return send(res, 200, { balance: user.balance, order: pubOrder(o) });
  }

  /* ----- nạp tiền (duyệt bằng tay hoặc chế độ thử) ----- */
  if (method === 'GET' && p === '/api/topups') {
    const mine = db.topups.filter(t => t.userId === user.id);
    await Promise.all(mine.filter(t => t.method === 'payos' && t.status === 'wait' && Date.now() - t.createdAt < 3 * 864e5).slice(-5).map(syncPayos));
    save();
    return send(res, 200, { balance: user.balance, topups: mine.slice(-200).reverse().map(t => ({ ...pubTopup(t), payUrl: (t.method === 'payos' && t.status === 'wait' && t.payos) ? t.payos.checkoutUrl : '' })) });
  }
  if (method === 'POST' && p === '/api/topups/create-payos') {
    if (limited(ip, 'payos-create', 10, 60e3)) return fail(res, 429, 'Bạn thao tác quá nhanh, hãy thử lại sau ít phút');
    if (!payos.configured()) return fail(res, 503, 'Nạp tiền tự động chưa được bật. Hãy dùng chuyển khoản thủ công.');
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount < 10000 || amount > 50000000) return fail(res, 400, 'Số tiền nạp từ 10.000đ đến 50.000.000đ.');
    if (db.topups.filter(t => t.userId === user.id && t.method === 'payos' && t.status === 'wait').length >= 5) return fail(res, 429, 'Bạn đang có quá nhiều link thanh toán chưa hoàn tất. Hãy thanh toán hoặc đợi chúng hết hạn.');
    let orderCode;
    do { orderCode = Date.now() * 1000 + crypto.randomInt(0, 1000); } while (db.topups.some(x => x.payos && x.payos.orderCode === orderCode));
    const base = (env.SITE_URL || '').replace(/\/+$/, '') || `http://localhost:${cfg.port}`;
    const expiresAt = Date.now() + 10 * 60e3;            // mã QR có hiệu lực 15 phút
    let link;
    try {
      link = await payos.createLink({ orderCode, amount, description: String(user.code).slice(0, 9), returnUrl: `${base}/nap-tien?status=success`, cancelUrl: `${base}/nap-tien?status=cancel`, expiredAt: Math.floor(expiresAt / 1000) });
    } catch (e) { console.error('[payOS create]', e.message); return fail(res, 502, 'Không tạo được link thanh toán, hãy thử lại sau ít phút.'); }
    const t = { id: nextId('NT'), userId: user.id, amount, method: 'payos', status: 'wait', createdAt: Date.now(), payos: { orderCode, paymentLinkId: link.paymentLinkId, checkoutUrl: link.checkoutUrl } };
    db.topups.push(t); save();
    // thông tin để trang tự vẽ mã QR ngay trên web (khách không bị chuyển sang trang khác)
    const qr = { id: t.id, amount, bin: link.bin, accountNumber: link.accountNumber, accountName: link.accountName, description: link.description, checkoutUrl: link.checkoutUrl, expiresAt };
    return send(res, 200, { checkoutUrl: link.checkoutUrl, qr, topup: pubTopup(t) });
  }
  if (method === 'POST' && p === '/api/topups') {
    const amount = Number(body.amount), method2 = body.method === 'wallet' ? 'wallet' : 'bank';
    if (!Number.isInteger(amount) || amount < 10000 || amount > 50000000) return fail(res, 400, 'Số tiền nạp từ 10.000đ đến 50.000.000đ.');
    if (db.topups.filter(t => t.userId === user.id && t.status === 'wait').length >= 10) return fail(res, 429, 'Bạn đang có quá nhiều yêu cầu chờ duyệt.');
    const t = { id: nextId('NT'), userId: user.id, amount, method: method2, status: 'wait', createdAt: Date.now() };
    db.topups.push(t); save();
    return send(res, 200, { topup: pubTopup(t) });
  }
  m = p.match(/^\/api\/topups\/([A-Z0-9]+)\/demo-approve$/);
  if (method === 'POST' && m) {
    if (!cfg.demo) return fail(res, 403, 'Chế độ thử đang tắt');
    const t = db.topups.find(x => x.id === m[1] && x.userId === user.id);
    if (!t || t.status !== 'wait') return fail(res, 404, 'Không thấy yêu cầu nạp');
    const before = user.balance;
    user.balance = r2(user.balance + t.amount); t.status = 'ok'; t.doneAt = Date.now();
    recordTx({
      userId: user.id,
      type: 'topup',
      amount: t.amount,
      before,
      after: user.balance,
      note: `Nạp tiền demo ${t.id}`,
      refId: t.id,
    });
    save();
    return send(res, 200, { balance: user.balance });
  }

  return fail(res, 404, 'Không tìm thấy');
}

/* ---------- file giao diện ---------- */
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
const PARTIALS = path.join(__dirname, 'partials');
const SECURITY = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };
const SITE_URL = (env.SITE_URL || '').replace(/\/+$/, '');
const PUBLIC_PAGES = ['/', '/dang-ky'];   // trang cho công cụ tìm kiếm lập chỉ mục (đưa vào sitemap.xml)

/* Ghép phần dùng chung (partials/*.html) vào trang: sửa menu hoặc chân trang một chỗ, mọi trang đổi theo */
function renderPage(html, reqPath) {
  const origin = SITE_URL || '';
  return html
    .replace(/<!--include:(\w+)-->/g, (m, name) => {
      try {
        return fs.readFileSync(path.join(PARTIALS, name + '.html'), 'utf8')
          .replace(/\{\{cur:([^}]+)\}\}/g, (mm, p) => p === reqPath ? 'aria-current="page"' : '');
      } catch (e) { return ''; }
    })
    .replace(/\{\{SITE_URL\}\}/g, origin);
}

function serveStatic(req, res, url) {
  if (url.pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(`User-agent: *\nDisallow: /api/\nDisallow: /admin\nDisallow: /don-hang\nDisallow: /nap-tien\n` + (SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ''));
  }
  if (url.pathname === '/sitemap.xml') {
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    return res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC_PAGES.map(p => `  <url><loc>${SITE_URL}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
  let cleanPath = rel;
  if (rel === '/') rel = '/index.html';
  else if (rel.endsWith('.html')) { res.writeHead(301, { Location: rel.slice(0, -5) || '/' }); return res.end(); }   // một địa chỉ cho mỗi trang
  else if (!path.extname(rel)) rel += '.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY });
      return res.end('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Không tìm thấy trang | Kho Nick</title><p style="font:16px sans-serif;padding:40px">Không tìm thấy trang. <a href="/">Về trang chủ</a></p>');
    }
    const ext = path.extname(file);
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', ...SECURITY };
    if (ext === '.html') { headers['Cache-Control'] = 'no-cache'; data = renderPage(data.toString('utf8'), cleanPath); }
    else headers['Cache-Control'] = 'no-cache';   // máy chạy local: luôn lấy bản mới nhất khi sửa code
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url);
  } catch (e) {
    console.error('[lỗi]', e);
    if (!res.headersSent) fail(res, 500, 'Máy chủ gặp lỗi, thử lại sau');
  }
});
server.listen(cfg.port, () => {
  console.log(`Kho Nick đang chạy tại http://localhost:${cfg.port}`);
  if (process.env.OPEN_BROWSER === '1') {   // do chay.bat / chay.command bật: tự mở trình duyệt
    const u = `http://localhost:${cfg.port}`, cp = require('child_process');
    try {
      if (process.platform === 'win32') cp.exec(`start "" "${u}"`);
      else cp.exec(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} "${u}"`);
    } catch (e) { /* không mở được thì thôi */ }
  }
  console.log(mother.MOCK ? 'Chế độ GIẢ LẬP web mẹ (chưa điền MOTHER_API_URL).' : 'Đã nối web mẹ: ' + env.MOTHER_API_URL);
  if (!cfg.adminKey) console.log('Chưa có ADMIN_KEY: trang quản trị duyệt nạp tiền đang tắt.');
});