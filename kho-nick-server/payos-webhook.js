'use strict';
/* Đăng ký địa chỉ webhook với payOS. Chạy:  node payos-webhook.js https://ten-mien-cua-ban/api/payos/webhook
 * payOS sẽ gửi thử một webhook tới địa chỉ đó; web của bạn phải đang chạy và truy cập được từ internet. */
const fs = require('fs'), path = require('path');
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* không có .env */ }
const payos = require('./payos');
const url = process.argv[2] || '';
if (!/^https:\/\/.+\/api\/payos\/webhook$/.test(url)) { console.log('Cách dùng: node payos-webhook.js https://ten-mien-cua-ban/api/payos/webhook\n(địa chỉ phải bắt đầu bằng https và kết thúc bằng /api/payos/webhook)'); process.exit(1); }
payos.confirmWebhook(url).then(d => console.log('Đã đăng ký webhook thành công:', d && d.webhookUrl || url), e => { console.log('Lỗi:', e.message); process.exit(1); });
