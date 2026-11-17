'use strict';
/*
 * ============================================================
 *  PAYOS.JS  -  NẠP TIỀN TỰ ĐỘNG QUA payOS (không cần cài thư viện)
 * ============================================================
 *  Cấu hình trong .env (lấy ở https://my.payos.vn, mục Kênh thanh toán):
 *    PAYOS_CLIENT_ID=...
 *    PAYOS_API_KEY=...
 *    PAYOS_CHECKSUM_KEY=...
 *  Ba khóa này chỉ để trong .env, không đưa vào HTML hay gửi cho ai.
 *
 *  server.js dùng các hàm:
 *    createLink       tạo link thanh toán (khách bị chuyển sang trang payOS)
 *    getPayment       hỏi payOS một đơn nạp đã thanh toán chưa
 *    verifyWebhook    kiểm tra webhook payOS gửi về có đúng chữ ký không
 *    confirmWebhook   đăng ký địa chỉ webhook với payOS
 */
const crypto = require('crypto');

const API = (process.env.PAYOS_API_URL || 'https://api-merchant.payos.vn').replace(/\/+$/, '');
const conf = () => ({
  id: (process.env.PAYOS_CLIENT_ID || '').trim(),
  key: (process.env.PAYOS_API_KEY || '').trim(),
  checksum: (process.env.PAYOS_CHECKSUM_KEY || '').trim(),
});
const configured = () => { const c = conf(); return !!(c.id && c.key && c.checksum); };

const hmac = text => crypto.createHmac('sha256', conf().checksum).update(text, 'utf8').digest('hex');

/* Chữ ký khi tạo link: 5 trường xếp theo thứ tự chữ cái, nối bằng & */
const signCreate = d => hmac(`amount=${d.amount}&cancelUrl=${d.cancelUrl}&description=${d.description}&orderCode=${d.orderCode}&returnUrl=${d.returnUrl}`);

/* Chữ ký của dữ liệu webhook: mọi trường trong data xếp theo chữ cái, dạng key=value nối bằng & */
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => (o[k] = sortDeep(v[k]), o), {});
  return v;
}
function signData(data) {
  return hmac(Object.keys(data).sort().map(k => {
    let v = data[k];
    if (v === null || v === undefined || v === 'null' || v === 'undefined') v = '';
    else if (typeof v === 'object') v = JSON.stringify(sortDeep(v));
    return `${k}=${v}`;
  }).join('&'));
}

async function request(method, pathname, body) {
  if (!configured()) throw new Error('Chưa điền PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY trong .env');
  const c = conf();
  let res, text;
  try {
    res = await fetch(API + pathname, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-client-id': c.id, 'x-api-key': c.key },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    text = await res.text();
  } catch (e) { const err = new Error('Không kết nối được payOS: ' + e.message); err.network = true; throw err; }
  let data = null; try { data = JSON.parse(text); } catch { /* không phải JSON */ }
  if (!data || (data.code && String(data.code) !== '00')) {
    const err = new Error(`payOS trả lỗi (HTTP ${res.status}): ${(data && (data.desc || data.message)) || text.slice(0, 150)}`);
    err.status = res.status; throw err;
  }
  return data.data;
}

/* Tạo link thanh toán. orderCode phải là số nguyên không trùng; description tối đa 25 ký tự. */
async function createLink({ orderCode, amount, description, returnUrl, cancelUrl, expiredAt }) {
  const body = { orderCode, amount, description, returnUrl, cancelUrl };
  if (expiredAt) body.expiredAt = expiredAt;                      // giây (unix); không nằm trong chữ ký
  body.signature = signCreate(body);
  const d = await request('POST', '/v2/payment-requests', body);
  if (!d || !d.checkoutUrl) throw new Error('payOS không trả đường dẫn thanh toán');
  return {
    checkoutUrl: d.checkoutUrl, paymentLinkId: d.paymentLinkId || '', qrCode: d.qrCode || '',
    bin: String(d.bin || ''), accountNumber: String(d.accountNumber || ''), accountName: String(d.accountName || ''),
    description: String(d.description || description),
  };
}

/* Lấy trạng thái: PENDING, PROCESSING, PAID, CANCELLED, EXPIRED... */
async function getPayment(orderCode) {
  const d = await request('GET', '/v2/payment-requests/' + encodeURIComponent(orderCode));
  return { status: String(d.status || '').toUpperCase(), amount: Number(d.amount) || 0, amountPaid: Number(d.amountPaid) || 0 };
}

/* Webhook hợp lệ khi chữ ký trong body khớp với chữ ký tự tính. Trả về phần data nếu đúng, null nếu sai. */
function verifyWebhook(body) {
  try {
    if (!configured() || !body || typeof body.signature !== 'string' || !body.data || typeof body.data !== 'object') return null;
    const a = Buffer.from(signData(body.data), 'utf8'), b = Buffer.from(body.signature.toLowerCase(), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? body.data : null;
  } catch (e) { return null; }
}

/* Đăng ký địa chỉ webhook (payOS sẽ gửi thử một webhook tới địa chỉ đó) */
async function confirmWebhook(webhookUrl) {
  return request('POST', '/confirm-webhook', { webhookUrl });
}

module.exports = { configured, createLink, getPayment, verifyWebhook, confirmWebhook, signData, signCreate };
