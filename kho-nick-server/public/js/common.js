'use strict';
/* Phần dùng chung cho mọi trang: tiện ích, gọi API, thanh trên cùng, kiểm tra đăng nhập. */

const $ = s => document.querySelector(s);
const fmt = n => Number(n).toLocaleString('vi-VN') + 'đ';
const nf = n => Number(n).toLocaleString('vi-VN');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round(n * 100) / 100;
const when = t => new Date(t).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

let CONFIG = null;   // cấu hình từ máy chủ (giá, giới hạn, ngân hàng...)
let ME = null;       // tài khoản đang đăng nhập, hoặc null

let toastT;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2800);
}

/* Gọi API của máy chủ. Lỗi được ném ra với nội dung tiếng Việt để hiện cho khách. */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {}; try { data = await res.json(); } catch (e) { /* trống */ }
  if (!res.ok) { const err = new Error(data.error || 'Có lỗi xảy ra, hãy thử lại'); err.status = res.status; throw err; }
  return data;
}

/* Phần tài khoản ở góc phải thanh trên cùng. */
function renderAcct() {
  const acctEl = $('#acct');
  if (!acctEl) return;
  acctEl.innerHTML = ME
    ? `<a class="chip" href="/nap-tien" title="Số dư">${fmt(ME.balance)}</a><span class="uname">${esc(ME.name)}</span><button class="btn sm" data-act="logout">Đăng xuất</button>`
    : `<a class="btn sm" href="/dang-nhap">Đăng nhập</a><a class="btn sm primary" href="/dang-ky">Đăng ký</a>`;
}

document.addEventListener('click', async e => {
  if (!e.target.closest('[data-act="logout"]')) return;
  try { await api('/logout', { method: 'POST', body: {} }); } catch (err) { /* bỏ qua */ }
  location.href = '/';
});

/*
 * Khởi động trang. Mỗi trang gọi hàm này đầu tiên.
 */
async function initPage(auth) {
  try { CONFIG = await api('/config'); ME = (await api('/me')).user; }
  catch (e) {
    const appEl = $('#app');
    if (appEl) appEl.innerHTML = '<div class="empty">Không kết nối được máy chủ. Hãy tải lại trang sau ít phút.</div>';
    return false;
  }
  if (auth === 'required' && !ME) { location.replace('/dang-nhap'); return false; }
  if (auth === 'guest' && ME) { location.replace('/'); return false; }
  renderAcct();
  return true;
}