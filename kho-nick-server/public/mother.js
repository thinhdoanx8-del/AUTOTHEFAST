'use strict';
/*
 * ============================================================
 *  MOTHER.JS  -  NỐI WEB MẸ QUATUWU (Buff Like Liên Quân)
 * ============================================================
 *  Web con (server.js) chỉ gọi các hàm ở file này:
 *    createOrder    gửi đơn sang web mẹ
 *    getStatus      hỏi web mẹ đơn chạy tới đâu
 *    cancelOrder    hủy đơn bên web mẹ
 *    validateTarget kiểm tra Uid khách nhập có đúng dạng web mẹ nhận không
 *
 *  Cấu hình trong .env (khóa chỉ nằm ở máy chủ, không bao giờ đưa vào HTML):
 *    MOTHER_API_URL=https://quatuwu.com        (địa chỉ gốc trong tài liệu API)
 *    MOTHER_API_KEY=khoa-api-cua-ban
 *    MOTHER_CONCURRENCY=10                      (tùy chọn, số luồng 10 đến 50)
 *
 *  MOTHER_API_URL để trống = CHẾ ĐỘ GIẢ LẬP (đơn tự chạy xong sau vài chục giây).
 *
 *  Tài liệu: POST /api/lq-buff/check-target, POST /api/lq-buff/start,
 *            GET /api/lq-buff/history, POST /api/lq-buff/stop/:jobId
 *  Xác thực: header X-API-Key.
 */

const BASE = (process.env.MOTHER_API_URL || '').trim().replace(/\/+$/, '');
const KEY = (process.env.MOTHER_API_KEY || '').trim();
const MOCK = !BASE;
const MIN_AMOUNT = 500;                                           // web mẹ nhận tối thiểu 500 like/đơn
const CONCURRENCY = Math.min(50, Math.max(10, parseInt(process.env.MOTHER_CONCURRENCY, 10) || 10));

/* Tên mã lỗi của web mẹ -> câu cho chủ web đọc trong cửa sổ chạy (khách không thấy các câu này). */
const ERR_VI = {
  INVALID_PARAMS: 'Tham số sai (Uid hoặc số like không hợp lệ)',
  INVALID_API_KEY: 'API Key sai hoặc thiếu, kiểm tra MOTHER_API_KEY trong .env',
  INSUFFICIENT_BALANCE: 'Ví bên web mẹ hết tiền, hãy nạp thêm',
  BANNED_USER: 'Tài khoản bên web mẹ bị khóa',
  MAINTENANCE: 'Web mẹ đang bảo trì',
};

/* Gọi API chung. Chỉ GET mới thử lại 1 lần khi lỗi mạng; POST tạo đơn không bao giờ gửi lại (tránh trừ tiền hai lần). */
async function request(pathname, { method = 'GET', body, timeout = 15000 } = {}) {
  if (!KEY) throw new Error('Thiếu MOTHER_API_KEY trong .env');
  const url = BASE + pathname;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = null; }
      if (!res.ok || (data && data.success === false)) {
        const code = data && (data.error || data.code);
        const why = ERR_VI[code] || (data && (data.message || data.error)) || text.slice(0, 150);
        const err = new Error(`Web mẹ trả lỗi ${res.status}: ${why}`);
        err.status = res.status; err.code = code;
        throw err;
      }
      return data || {};
    } catch (e) {
      const network = !e.status;                                   // lỗi mạng hoặc quá thời gian, không phải web mẹ từ chối
      if (method === 'GET' && network && attempt === 0) continue;
      if (network) e.network = true;
      throw e;
    }
  }
}

/* ---------- Khách nhập UID, OpenID hoặc Tên Game: gửi nguyên cho web mẹ tra cứu qua check-target ---------- */
function normalizeTarget(s) { return String(s || '').trim(); }

/* Kết quả check-target nhớ 20 giây: kiểm tra lúc khách bấm tạo đơn và lúc mở job dùng chung một lần gọi */
const checkCache = new Map();
async function checkTarget(target) {
  const hit = checkCache.get(target);
  if (hit && Date.now() - hit.at < 20000) return hit.data;
  const data = await request('/api/lq-buff/check-target', { method: 'POST', body: { target } });
  checkCache.set(target, { at: Date.now(), data });
  if (checkCache.size > 200) for (const [k, v] of checkCache) if (Date.now() - v.at > 20000) checkCache.delete(k);
  return data;
}

/* server.js gọi hàm này TRƯỚC khi trừ tiền khách. Trả về chuỗi lỗi cho khách đọc, hoặc '' nếu ổn. */
async function validateTarget(code) {
  if (MOCK) return '';
  const t = normalizeTarget(code);
  if (!t || t.length > 40 || /[\u0000-\u001f]/.test(t)) return 'UID hoặc Tên Game không hợp lệ.';
  try { await checkTarget(t); return ''; }
  catch (e) {
    if (e.status === 400 || e.status === 404) return 'Không tìm thấy tài khoản game này. Hãy kiểm tra lại UID hoặc Tên Game.';
    console.error('[validateTarget]', e.message);                   // lỗi phía mình (key sai, ví hết, bảo trì, mạng): khách chỉ thấy câu chung
    return 'Hệ thống đang bận, hãy thử lại sau ít phút.';
  }
}

/* ---------- Lịch sử job: gộp các lần gọi trong 4 giây thành một (nhiều đơn cùng hỏi trạng thái) ---------- */
let histCache = { at: 0, jobs: null, pending: null };
async function history(force) {
  if (!force && histCache.jobs && Date.now() - histCache.at < 4000) return histCache.jobs;
  if (!force && histCache.pending) return histCache.pending;
  const p = request('/api/lq-buff/history').then(d => {
    histCache = { at: Date.now(), jobs: Array.isArray(d.jobs) ? d.jobs : [], pending: null };
    return histCache.jobs;
  }, e => { histCache.pending = null; throw e; });
  histCache.pending = p;
  return p;
}

/* ------------------------------------------------------------
 * 1) Tạo đơn: kiểm tra Uid và hạn mức trong ngày, rồi mở job buff.
 *    Lỗi (throw) -> web con tự hoàn tiền cho khách.
 * ---------------------------------------------------------- */
async function createOrder({ uid, likes, note, orderId }) {
  if (MOCK) return { motherId: 'MOCK-' + orderId };

  const input = normalizeTarget(uid);
  if (!input) throw new Error('Thiếu UID hoặc Tên Game');
  if (likes < MIN_AMOUNT) throw new Error(`Web mẹ nhận tối thiểu ${MIN_AMOUNT} like mỗi đơn`);

  // Bước 1: kiểm tra Uid, hạn mức like còn lại hôm nay và số dư ví bên web mẹ
  const chk = await checkTarget(input);
  const target = (chk.player && chk.player.uid) ? String(chk.player.uid) : input;   // nhập tên thì dùng UID web mẹ tra ra
  if (typeof chk.available_today === 'number' && likes > chk.available_today)
    throw new Error(`Tài khoản game này hôm nay chỉ nhận thêm tối đa ${chk.available_today} like (đơn xin ${likes})`);
  if (typeof chk.max_payable_likes === 'number' && likes > chk.max_payable_likes)
    throw new Error(`Ví bên web mẹ không đủ tiền cho ${likes} like (còn đủ ${chk.max_payable_likes}). Hãy nạp thêm ví web mẹ.`);

  // Bước 2: mở job. Không gửi lại khi lỗi mạng; nếu quá thời gian thì kiểm tra xem job đã được tạo chưa.
  const startedAt = Date.now() - 5000;
  let d;
  try {
    d = await request('/api/lq-buff/start', { method: 'POST', body: { target, amount: likes, concurrency: CONCURRENCY }, timeout: 30000 });
  } catch (e) {
    if (!e.network) throw e;
    const jobs = await history(true).catch(() => []);
    const found = jobs.find(j => String(j.target) === target && Number(j.amount) === likes && new Date(j.created_at).getTime() >= startedAt);
    if (!found) throw e;                                           // chắc chắn chưa tạo được, an toàn để hoàn tiền
    return { motherId: String(found.id) };
  }
  if (!d.jobId) throw new Error('Web mẹ không trả mã job');
  histCache.at = 0;                                                // lần hỏi trạng thái tới lấy dữ liệu mới
  return { motherId: String(d.jobId) };
}

/* ------------------------------------------------------------
 * 2) Trạng thái: running -> running, done -> done, stopped -> canceled.
 *    Không thấy job trong lịch sử thì trả null (giữ nguyên trạng thái, hỏi lại lần sau).
 * ---------------------------------------------------------- */
async function getStatus(motherId, order) {
  if (MOCK) {
    const durationMs = Math.max(20000, (order.likes / 50) * 1000);
    const p = Math.min(1, (Date.now() - order.createdAt) / durationMs);
    return { state: p >= 1 ? 'done' : 'running', done: Math.floor(p * order.likes) };
  }
  const jobs = await history();
  const j = jobs.find(x => String(x.id) === String(motherId));
  if (!j) return null;
  const added = Math.max(0, Number(j.added_like) || 0);
  switch (String(j.status).toLowerCase()) {
    case 'done': return { state: 'done', done: order.likes };
    case 'stopped': return { state: 'canceled', done: added };
    case 'failed': case 'error': return { state: 'failed', done: added };
    default: return { state: 'running', done: added };
  }
}

/* ------------------------------------------------------------
 * 3) Hủy đơn: dừng job bên web mẹ (web mẹ hoàn phần chưa chạy vào ví của bạn).
 *    Sau khi dừng, ghi số like đã chạy thật vào order.done để web con hoàn đúng phần tiền còn lại cho khách.
 * ---------------------------------------------------------- */
async function cancelOrder(motherId, order) {
  if (MOCK) return;
  await request('/api/lq-buff/stop/' + encodeURIComponent(motherId), { method: 'POST' });
  try {
    const j = (await history(true)).find(x => String(x.id) === String(motherId));
    if (j) order.done = Math.max(0, Math.min(order.likes, Number(j.added_like) || 0));
  } catch (e) { /* không lấy được số liệu mới thì dùng số cũ */ }
}

module.exports = { createOrder, getStatus, cancelOrder, validateTarget, MOCK };
