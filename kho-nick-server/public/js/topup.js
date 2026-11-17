'use strict';
(async function () {
  if (!(await initPage('required'))) return;

  const AMOUNTS = [10000, 20000, 50000, 100000, 200000];
  const MIN_TOPUP = 10000;
  const topup = { amount: 100000, custom: '' };
  let TOPUPS = [];
  let qrSession = null, pollTimer = null, tickTimer = null;
  const payosIntro = ($('#payos-box') || {}).innerHTML || '';

  /* ----- mã QR payOS hiện ngay trong trang, tự kiểm tra đến khi khách trả tiền ----- */
  function stopQr() { clearInterval(pollTimer); clearInterval(tickTimer); pollTimer = tickTimer = null; qrSession = null; }
  function vietQrUrl(q) {
    return `https://img.vietqr.io/image/${encodeURIComponent(q.bin)}-${encodeURIComponent(q.accountNumber)}-compact2.png?amount=${q.amount}&addInfo=${encodeURIComponent(q.description)}&accountName=${encodeURIComponent(q.accountName)}`;
  }
  function qrHtml() {
    const q = qrSession, canImg = q.bin && q.accountNumber;
    return `${canImg ? `<div class="qrbox"><img id="payos-qr" alt="Mã QR thanh toán" width="300" height="300" src="${esc(vietQrUrl(q))}"></div>
      <dl class="kv"><dt>Số tiền</dt><dd>${fmt(q.amount)}</dd><dt>Số tài khoản</dt><dd>${esc(q.accountNumber)}</dd><dt>Chủ tài khoản</dt><dd>${esc(q.accountName)}</dd><dt>Nội dung</dt><dd>${esc(q.description)}</dd></dl>` : `<p>Số tiền cần thanh toán: <strong>${fmt(q.amount)}</strong></p>`}
      <p id="payos-state" style="margin:10px 0">Đang chờ thanh toán, còn <strong id="payos-left">15:00</strong>. Tiền tự cộng vào số dư ngay khi chuyển xong, bạn không cần tải lại trang.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn sm" href="${esc(q.checkoutUrl)}" target="_blank" rel="noopener">Mở trang PayOS</a><button class="btn sm" data-act="qr-close">Đóng</button></div>`;
  }
  function showQr() {
    const box = $('#payos-box'); if (!box) return;
    box.style.display = 'block'; box.innerHTML = qrHtml();
    const img = $('#payos-qr');
    if (img) img.onerror = () => { const n = document.createElement('p'); n.textContent = 'Không tải được mã QR. Hãy bấm "Mở trang PayOS" để thanh toán.'; img.replaceWith(n); };
  }
  function qrFinish(html, msg) {
    stopQr();
    const box = $('#payos-box'); if (box) box.innerHTML = html;
    if (msg) toast(msg);
  }
  async function pollQr() {
    if (!qrSession) return;
    try {
      const d = await api('/topups'); ME.balance = d.balance; TOPUPS = d.topups; renderHist();
      const t = TOPUPS.find(x => x.id === qrSession.id);
      if (t && t.status === 'ok') qrFinish(`<strong>Nạp tiền thành công!</strong><br>Đã cộng ${fmt(qrSession.amount)} vào số dư của bạn.`, 'Nạp tiền thành công');
      else if (t && t.status === 'reject') qrFinish('Giao dịch đã bị hủy hoặc hết hạn. Hãy tạo mã mới nếu bạn vẫn muốn nạp.', 'Giao dịch đã hủy');
    } catch (e) { /* mất mạng tạm thời: lần sau thử lại */ }
  }
  function startQr(q) {
    stopQr(); qrSession = q; showQr();
    pollTimer = setInterval(pollQr, 3000);
    const tick = () => {
      const left = Math.max(0, Math.round((q.expiresAt - Date.now()) / 1000)), el = $('#payos-left');
      if (el) el.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
      if (left <= 0) { pollQr().finally(() => { if (qrSession && qrSession.id === q.id) qrFinish('Mã QR đã hết hạn. Hãy bấm tạo mã mới để nạp.', ''); }); }
    };
    tick(); tickTimer = setInterval(tick, 1000);
  }

  const amountNow = () => topup.custom !== '' ? parseInt(topup.custom, 10) || 0 : topup.amount;

  function renderAmounts() {
    $('#amounts').innerHTML = AMOUNTS.map(a => `<button class="amt" data-act="amt" data-v="${a}" aria-pressed="${topup.custom === '' && topup.amount === a}">${fmt(a)}</button>`).join('');
  }

  function renderGo() {
    const amt = amountNow(), b = $('#go');
    b.disabled = amt < MIN_TOPUP;
    b.textContent = 'Thanh toán ngay qua PayOS ' + (amt >= MIN_TOPUP ? fmt(amt) : '');
  }

  function renderInfo() {
    const payosBox = $('#payos-box');
    if (payosBox) {
      payosBox.style.display = 'block';
      payosBox.innerHTML = qrSession ? qrHtml() : payosIntro;
      const img = $('#payos-qr');
      if (img) img.onerror = () => img.replaceWith(Object.assign(document.createElement('p'), { textContent: 'Không tải được mã QR. Hãy bấm "Mở trang PayOS" để thanh toán.' }));
    }
  }

  function renderHist() {
    $('#bal').textContent = fmt(ME.balance);
    if (typeof renderAcct === 'function') renderAcct();
    $('#hist').innerHTML = TOPUPS.length
      ? `<div class="tw"><table><thead><tr><th>Mã</th><th>Hình thức</th><th>Số tiền</th><th>Trạng thái</th><th><span class="sr">Thao tác</span></th></tr></thead><tbody>${TOPUPS.map(t => `<tr><td><strong>${esc(t.id)}</strong><br><span class="code">${when(t.createdAt)}</span></td><td>PayOS</td><td>${fmt(t.amount)}</td><td>${t.status === 'ok' ? '<span class="st ok">Đã cộng tiền</span>' : t.status === 'reject' ? '<span class="st no">Từ chối</span>' : '<span class="st wait">Chờ thanh toán</span>'}</td><td>${t.payUrl ? `<a class="btn sm primary" href="${esc(t.payUrl)}" rel="noopener">Thanh toán</a> ` : ''}${t.status === 'wait' && CONFIG.demo ? `<button class="btn sm" data-act="approve" data-id="${esc(t.id)}">Duyệt thử (demo)</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty" style="border:0">Chưa có yêu cầu nạp tiền nào.</div>';
  }

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el || el.dataset.act === 'logout') return;
    const a = el.dataset.act;
    try {
      if (a === 'qr-close') { stopQr(); renderInfo(); }
      else if (a === 'amt') {
        stopQr(); topup.amount = +el.dataset.v; topup.custom = ''; $('#custom').value = '';
        renderAmounts(); renderGo(); renderInfo();
      }
      else if (a === 'go') {
        const amt = amountNow(); if (amt < MIN_TOPUP) return;
        const btn = $('#go'); btn.disabled = true;
        try {
          const d = await api('/topups/create-payos', { method: 'POST', body: { amount: amt } });
          if (!d.qr) throw new Error('Không nhận được mã thanh toán từ PayOS.');
          TOPUPS.unshift(d.topup); renderHist(); startQr(d.qr);
        } finally { renderGo(); }
      }
      else if (a === 'approve') {
        const d = await api(`/topups/${encodeURIComponent(el.dataset.id)}/demo-approve`, { method: 'POST', body: {} });
        ME.balance = d.balance; const t = TOPUPS.find(x => x.id === el.dataset.id); if (t) t.status = 'ok';
        renderHist(); toast('Đã cộng tiền (chế độ thử)');
      }
    } catch (err) { toast(err.message); }
  });

  $('#custom')?.addEventListener('input', e => {
    if (qrSession) { stopQr(); renderInfo(); }
    topup.custom = e.target.value.replace(/\D/g, '').slice(0, 9); e.target.value = topup.custom;
    renderGo();
    document.querySelectorAll('.amt').forEach(x => x.setAttribute('aria-pressed', 'false'));
  });

  renderAmounts(); renderGo(); renderInfo(); renderHist();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('status') === 'success') {
    toast('Thanh toán thành công!');
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (urlParams.get('status') === 'cancel') {
    toast('Đã hủy giao dịch.');
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  try { const d = await api('/topups'); ME.balance = d.balance; TOPUPS = d.topups; renderHist(); } catch (err) { toast(err.message); }
})();