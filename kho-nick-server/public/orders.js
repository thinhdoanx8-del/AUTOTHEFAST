'use strict';
/* Trang Đơn hàng: tạo đơn (cột trái) và danh sách đơn (cột phải). Giao diện nằm trong don-hang.html. */
(async function () {
  if (!(await initPage('required'))) return;

  const LABEL = {
    wait: '<span class="st wait">Đang chờ</span>', running: '<span class="st wait">Đang chạy</span>', ok: '<span class="st ok">Thành công</span>',
    cancel: '<span class="st no">Đã hủy</span>', fail: '<span class="st no">Thất bại, đã hoàn tiền</span>',
  };
  const PAGE_SIZE = 25;
  const buff = { likes: '', codes: '', note: '', discText: '', pct: 0 };
  const flt = { q: '', status: '', pay: '' };
  let ORDERS = [], page = 1, firstPaint = true;

  /* ----- điền cấu hình từ máy chủ vào giao diện ----- */
  $('#b-likes').placeholder = `Nhập số like (tối thiểu ${nf(CONFIG.minLikes)})`;
  const cfgText = { min: nf(CONFIG.minLikes), rate: fmt(CONFIG.rate), example: fmt(r2(2000 * CONFIG.rate)) };
  document.querySelectorAll('[data-cfg]').forEach(el => { el.textContent = cfgText[el.dataset.cfg]; });
  if (CONFIG.discount) $('#disc-row').hidden = false;

  /* ----- đọc ô nhập: mỗi dòng là Uid hoặc Tên Game, có thể thêm |số like riêng ----- */
  const unitPrice = () => r2(CONFIG.rate * (1 - buff.pct / 100));
  function parseInput() {
    const lines = buff.codes.split('\n').map(x => x.trim()).filter(Boolean);
    const def = parseInt(buff.likes, 10) || 0;
    const items = [], bad = []; let needLikes = false;
    lines.forEach((ln, i) => {
      let code = ln, likes = def, own = false; const k = ln.lastIndexOf('|');
      if (k >= 0) {
        code = ln.slice(0, k).trim(); const q = ln.slice(k + 1).trim();
        if (q !== '') { own = true; likes = /^\d+$/.test(q) ? parseInt(q, 10) : 0; }
      }
      if (!own && def < CONFIG.minLikes) needLikes = true;
      if (code.length < 1 || code.length > 40 || likes < CONFIG.minLikes || likes > CONFIG.maxLikes) bad.push(i + 1); else items.push({ code, likes });
    });
    return { lines, items, bad, needLikes, def };
  }
  function renderSummary() {
    const unit = unitPrice(), inp = parseInput();
    const likes = inp.items.length ? inp.items.reduce((t, x) => t + x.likes, 0) : Math.min(inp.def, CONFIG.maxLikes);
    const total = r2(inp.items.length ? inp.items.reduce((t, x) => t + r2(x.likes * unit), 0) : likes * unit);
    $('#sum').innerHTML = `<div class="sumrow"><span>Giá đơn: ${buff.pct ? `<s>${fmt(CONFIG.rate)}</s> ` : ''}<b>${fmt(unit)}</b> / like${buff.pct ? ` (Giảm giá -${buff.pct}%)` : ''}</span><span>Số dư ví: <b>${fmt(ME.balance)}</b></span></div>
    <p class="sumgood">${!inp.items.length && inp.def > 0 && inp.def < CONFIG.minLikes ? `Số like tối thiểu là ${nf(CONFIG.minLikes)}.` : likes > 0 ? `Thành tiền: ${fmt(total)} cho ${nf(likes)} like.` : 'Nhập số like để xem thành tiền.'}</p>`;
  }
  function setMsg(kind, html) { $('#msg').innerHTML = html ? `<div class="${kind === 'ok' ? 'okmsg' : 'err'}" role="alert">${html}</div>` : ''; }

  /* ----- danh sách đơn ----- */
  function filtered() {
    const q = flt.q.trim().toLowerCase();
    return ORDERS.filter(o =>
      (!q || o.code.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)) &&
      (!flt.status || (flt.status === 'wait' ? (o.status === 'wait' || o.status === 'running') : o.status === flt.status)) &&
      (!flt.pay || (flt.pay === 'refund' ? (o.status === 'cancel' || o.status === 'fail') : (o.status !== 'cancel' && o.status !== 'fail'))));
  }
  function renderList() {
    const active = ORDERS.filter(o => o.status === 'wait' || o.status === 'running').length;
    $('#stats').textContent = `Đơn đang chạy: ${active} · Đơn đã thành công: ${ORDERS.filter(o => o.status === 'ok').length}`;
    const rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (page > pages) page = pages;
    const view = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const body = view.map((o, i) => {
      const pct = o.likes ? Math.round(o.done / o.likes * 100) : 0;
      const paid = r2(o.cost - (o.refundAmount || 0));
      return `<tr style="--i:${i}">
        <td><div class="codecell">${esc(o.code)}<button class="icon-btn" data-act="copy" data-v="${esc(o.code)}" title="Sao chép" aria-label="Sao chép ${esc(o.code)}">Chép</button></div><span class="code">${esc(o.id)}${o.note ? ' · ' + esc(o.note) : ''}</span></td>
        <td>${LABEL[o.status] || ''}</td>
        <td><div class="prog"><div class="prog-top"><span>${pct}%</span><span>${nf(o.done)}/${nf(o.likes)} like</span></div><div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div><small>Mua ${nf(o.likes)} like</small></div></td>
        <td>${fmt(o.cost)}</td><td class="pos">${fmt(paid)}</td><td>${fmt(0)}</td><td>${when(o.createdAt)}</td>
        <td>${o.status === 'wait' || o.status === 'running' ? `<div class="acts"><button class="btn sm" data-act="cancel" data-id="${esc(o.id)}">Hủy đơn</button></div>` : ''}</td></tr>`;
    }).join('');
    const from = rows.length ? (page - 1) * PAGE_SIZE + 1 : 0;
    const anim = firstPaint ? ' class="anim"' : '';
    firstPaint = false;   // chỉ chạy hiệu ứng lần đầu, các lần cập nhật sau không nháy
    $('#list').innerHTML = `<div class="listhead"><h3>Danh sách đơn hàng (${rows.length})</h3></div>
      ${rows.length ? `<div class="tw tall"><table><thead><tr><th>Uid / Tên Game</th><th>Trạng thái</th><th>Tiến độ</th><th>Giá trị</th><th>Đã thanh toán</th><th>Còn thiếu</th><th>Ngày tạo</th><th><span class="sr">Thao tác</span></th></tr></thead><tbody${anim}>${body}</tbody></table></div>
      <div class="pager"><span>${from}–${from + view.length - 1} / ${rows.length}</span><div><button class="btn sm" data-act="prev" ${page <= 1 ? 'disabled' : ''}>Trước</button><span>Trang ${page} / ${pages}</span><button class="btn sm" data-act="next" ${page >= pages ? 'disabled' : ''}>Sau</button></div></div>`
      : `<div class="empty">${ORDERS.length ? 'Không có đơn nào khớp bộ lọc.' : 'Bạn chưa có đơn hàng nào. Nhập Uid hoặc Tên Game ở bên trái để tạo đơn đầu tiên.'}</div>`}`;
  }
  async function loadOrders() {
    const d = await api('/orders');
    ME.balance = d.balance; ORDERS = d.orders;
    renderAcct(); renderSummary(); renderList();
  }

  /* ----- sự kiện ----- */
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'b-codes') { buff.codes = t.value; renderSummary(); }
    if (t.id === 'b-note') buff.note = t.value;
    if (t.id === 'b-likes') { t.value = t.value.replace(/\D/g, '').slice(0, 7); buff.likes = t.value; renderSummary(); }
    if (t.id === 'b-disc') { buff.discText = t.value; if (buff.pct) { buff.pct = 0; renderSummary(); } }
    if (t.id === 'f-q') { flt.q = t.value; page = 1; renderList(); }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'f-status') { flt.status = t.value; page = 1; renderList(); }
    if (t.id === 'f-pay') { flt.pay = t.value; page = 1; renderList(); }
  });
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el || el.dataset.act === 'logout') return;
    const a = el.dataset.act;
    try {
      if (a === 'refresh') { await loadOrders(); toast('Đã làm mới'); }
      else if (a === 'prev') { page--; renderList(); }
      else if (a === 'next') { page++; renderList(); }
      else if (a === 'copy') {
        (navigator.clipboard ? navigator.clipboard.writeText(el.dataset.v) : Promise.reject()).then(() => toast('Đã sao chép')).catch(() => toast('Trình duyệt không cho sao chép, hãy chọn và chép tay'));
      }
      else if (a === 'disc') {
        const c = buff.discText.trim();
        if (!c) { buff.pct = 0; renderSummary(); return setMsg('err', 'Hãy nhập mã giảm giá trước khi kiểm tra.'); }
        try { const d = await api('/discount', { method: 'POST', body: { code: c } }); buff.pct = d.pct; renderSummary(); setMsg('ok', `Áp dụng mã thành công, giảm thêm ${d.pct}%.`); }
        catch (err) { buff.pct = 0; renderSummary(); setMsg('err', esc(err.message)); }
      }
      else if (a === 'go') {
        const inp = parseInput();
        if (!inp.lines.length) return setMsg('err', 'Hãy nhập ít nhất một Uid hoặc Tên Game.');
        if (inp.needLikes) return setMsg('err', buff.likes === '' ? 'Hãy nhập số like.' : `Số like tối thiểu là ${nf(CONFIG.minLikes)}.`);
        if (inp.bad.length) return setMsg('err', `Dòng ${inp.bad.join(', ')} sai định dạng. Uid hoặc Tên Game tối đa 40 ký tự, số like từ ${nf(CONFIG.minLikes)} đến ${nf(CONFIG.maxLikes)}. Chưa có đơn nào được tạo.`);
        el.disabled = true;
        try {
          const d = await api('/orders', { method: 'POST', body: { items: inp.items, note: buff.note.trim(), discount: buff.pct ? buff.discText.trim() : '' } });
          ME.balance = d.balance; buff.codes = ''; $('#b-codes').value = ''; page = 1; firstPaint = true;
          const failed = d.orders.filter(o => o.status === 'fail').length;
          await loadOrders();
          if (failed) setMsg('err', `${failed} đơn không gửi đi được và đã hoàn tiền. Hãy thử lại sau.`);
          else { setMsg('ok', `Đã tạo ${d.orders.length} đơn.`); toast('Đã tạo ' + d.orders.length + ' đơn'); }
        } catch (err) {
          setMsg('err', err.status === 402 ? `${esc(err.message)} <a href="/nap-tien">Nạp thêm tiền</a>` : esc(err.message));
        } finally { el.disabled = false; }
      }
      else if (a === 'cancel') {
        const d = await api(`/orders/${encodeURIComponent(el.dataset.id)}/cancel`, { method: 'POST', body: {} });
        ME.balance = d.balance; await loadOrders(); toast('Đã hủy đơn và hoàn tiền');
      }
    } catch (err) { toast(err.message); }
  });

  /* Tự cập nhật tiến độ khi còn đơn đang chạy */
  setInterval(() => { if (!document.hidden && ORDERS.some(o => o.status === 'wait' || o.status === 'running')) loadOrders().catch(() => {}); }, 8000);

  renderSummary();
  try { await loadOrders(); } catch (err) { $('#list').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
})();