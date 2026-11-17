'use strict';
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('vi-VN') + 'đ';
  const nf = n => Number(n || 0).toLocaleString('vi-VN');
  const when = t => t ? new Date(t).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  // Khóa quản trị chỉ lưu trong RAM của phiên trang, tuyệt đối không lưu localStorage
  let KEY = '';
  let currentTab = 'overview';

  const TAB_TITLES = {
    overview: 'Tổng quan hệ thống',
    users: 'Quản lý người dùng',
    orders: 'Quản lý đơn hàng',
    topups: 'Quản lý nạp tiền',
    balances: 'Quản lý số dư ví',
    transactions: 'Lịch sử giao dịch',
    settings: 'Cấu hình website',
    logs: 'Nhật ký hoạt động Admin',
  };

  let toastTimer;
  function toast(text) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  async function apiAdmin(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api/admin' + path, {
      method,
      headers: {
        'X-Admin-Key': KEY,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Có lỗi xảy ra');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ---------- Hộp thoại xác nhận & Chi tiết ---------- */
  function closeModal() {
    $('#admin-modal-root').innerHTML = '';
  }

  function confirmDialog({ title, message, requireReason = false, reasonLabel = 'Lý do thực hiện', confirmText = 'Xác nhận', danger = false }) {
    return new Promise(resolve => {
      const root = $('#admin-modal-root');
      root.innerHTML = `
        <div class="admin-modal-backdrop" id="modal-bg">
          <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
            <div class="admin-modal-head">
              <h2 class="admin-modal-title" id="m-title">${esc(title)}</h2>
              <button type="button" class="icon-btn" id="m-close" aria-label="Đóng">✕</button>
            </div>
            <div style="font-size:14px;line-height:1.6">${message}</div>
            ${requireReason ? `
              <div class="field" style="margin-top:14px;margin-bottom:0">
                <label for="m-reason">${esc(reasonLabel)} <span style="color:var(--bad)">*</span></label>
                <input id="m-reason" placeholder="Nhập lý do rõ ràng..." maxlength="200">
              </div>
            ` : ''}
            <div id="m-err" style="margin-top:10px"></div>
            <div class="admin-modal-foot">
              <button type="button" class="btn" id="m-cancel">Hủy bỏ</button>
              <button type="button" class="btn ${danger ? 'admin-btn-danger' : 'primary'}" id="m-ok">${esc(confirmText)}</button>
            </div>
          </div>
        </div>
      `;
      const done = val => { closeModal(); resolve(val); };
      $('#m-close').onclick = () => done(null);
      $('#m-cancel').onclick = () => done(null);
      $('#modal-bg').onclick = e => { if (e.target.id === 'modal-bg') done(null); };
      $('#m-ok').onclick = () => {
        if (requireReason) {
          const r = ($('#m-reason').value || '').trim();
          if (r.length < 2) {
            $('#m-err').innerHTML = '<div class="err" style="margin:0">Vui lòng nhập lý do tối thiểu 2 ký tự.</div>';
            return;
          }
          done({ confirmed: true, reason: r });
        } else {
          done({ confirmed: true, reason: '' });
        }
      };
    });
  }

  function showDetailModal(title, bodyHtml, wide = true) {
    const root = $('#admin-modal-root');
    root.innerHTML = `
      <div class="admin-modal-backdrop" id="modal-bg">
        <div class="admin-modal ${wide ? 'is-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="m-title">
          <div class="admin-modal-head">
            <h2 class="admin-modal-title" id="m-title">${esc(title)}</h2>
            <button type="button" class="icon-btn" id="m-close" aria-label="Đóng">✕</button>
          </div>
          <div>${bodyHtml}</div>
          <div class="admin-modal-foot">
            <button type="button" class="btn primary" id="m-ok">Đóng</button>
          </div>
        </div>
      </div>
    `;
    $('#m-close').onclick = closeModal;
    $('#m-ok').onclick = closeModal;
    $('#modal-bg').onclick = e => { if (e.target.id === 'modal-bg') closeModal(); };
  }

  /* ---------- Biểu đồ SVG thuần (tuân thủ CSP) ---------- */
  function renderBarChart(items, valueKey, color, isMoney) {
    const W = 620, H = 200, padL = 56, padR = 14, padT = 16, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxVal = Math.max(1, ...items.map(x => Number(x[valueKey]) || 0));
    const bw = plotW / Math.max(1, items.length);

    const gridLines = [0, 0.5, 1].map(ratio => {
      const y = padT + plotH - ratio * plotH;
      const v = Math.round(maxVal * ratio);
      const label = isMoney ? (v >= 1000 ? Math.round(v / 1000) + 'k' : v + 'đ') : nf(v);
      return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--line)" stroke-dasharray="3 3"/>
              <text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="var(--muted)" font-size="11">${esc(label)}</text>`;
    }).join('');

    const bars = items.map((d, i) => {
      const val = Number(d[valueKey]) || 0;
      const h = (val / maxVal) * plotH;
      const x = padL + i * bw + bw * 0.18;
      const w = Math.max(4, bw * 0.64);
      const y = padT + plotH - h;
      const tip = `${d.label}: ${isMoney ? fmt(val) : nf(val)}`;
      return `<g>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="4" fill="${color}" opacity="0.88"><title>${esc(tip)}</title></rect>
        ${i % 2 === 0 ? `<text x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="var(--muted)" font-size="10.5">${esc(d.label)}</text>` : ''}
      </g>`;
    }).join('');

    return `<div class="admin-svg-wrap"><svg viewBox="0 0 ${W} ${H}" role="img">${gridLines}${bars}</svg></div>`;
  }

  function renderDonutChart(breakdown) {
    const parts = [
      { key: 'ok', label: 'Hoàn thành', val: breakdown.ok || 0, color: '#0b7a63' },
      { key: 'running', label: 'Đang chạy', val: breakdown.running || 0, color: '#2563eb' },
      { key: 'wait', label: 'Đang chờ', val: breakdown.wait || 0, color: '#d97706' },
      { key: 'fail', label: 'Thất bại', val: breakdown.fail || 0, color: '#b3261e' },
      { key: 'cancel', label: 'Đã hủy', val: breakdown.cancel || 0, color: '#64748b' },
    ];
    const total = parts.reduce((s, p) => s + p.val, 0);
    const R = 56, C = 2 * Math.PI * R;
    let offset = 0;

    const circles = total > 0
      ? parts.filter(p => p.val > 0).map(p => {
          const len = (p.val / total) * C;
          const el = `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${p.color}" stroke-width="20" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 80 80)"/>`;
          offset += len;
          return el;
        }).join('')
      : `<circle cx="80" cy="80" r="${R}" fill="none" stroke="var(--line)" stroke-width="20"/>`;

    const legend = parts.map(p => {
      const pct = total ? Math.round((p.val / total) * 100) : 0;
      return `<div class="admin-legend-item">
        <div class="admin-legend-left"><span class="admin-dot" style="background:${p.color}"></span><span>${esc(p.label)}</span></div>
        <strong>${nf(p.val)} (${pct}%)</strong>
      </div>`;
    }).join('');

    return `<div class="admin-donut-box">
      <svg viewBox="0 0 160 160" width="160" height="160">
        ${circles}
        <text x="80" y="77" text-anchor="middle" fill="var(--fg)" font-size="18" font-weight="700">${nf(total)}</text>
        <text x="80" y="95" text-anchor="middle" fill="var(--muted)" font-size="11">Tổng đơn</text>
      </svg>
      <div class="admin-legend">${legend}</div>
    </div>`;
  }

  /* ---------- Badge helper ---------- */
  function orderStatusBadge(st) {
    const map = {
      wait: '<span class="admin-badge wait">Đang chờ</span>',
      running: '<span class="admin-badge wait">Đang chạy</span>',
      ok: '<span class="admin-badge ok">Hoàn thành</span>',
      fail: '<span class="admin-badge bad">Thất bại</span>',
      cancel: '<span class="admin-badge muted">Đã hủy</span>',
    };
    return map[st] || `<span class="admin-badge muted">${esc(st)}</span>`;
  }

  function txTypeBadge(type) {
    const map = {
      topup: '<span class="admin-badge ok">Nạp tiền</span>',
      admin_add: '<span class="admin-badge ok">Cộng thủ công</span>',
      admin_sub: '<span class="admin-badge bad">Trừ thủ công</span>',
      order_pay: '<span class="admin-badge wait">Thanh toán đơn</span>',
      order_refund: '<span class="admin-badge muted">Hoàn tiền đơn</span>',
    };
    return map[type] || `<span class="admin-badge muted">${esc(type)}</span>`;
  }

  /* ============================================================
   *  1. DASHBOARD TỔNG QUAN
   * ============================================================ */
  async function renderOverview() {
    const box = $('#admin-content');
    box.innerHTML = '<div class="admin-loading">Đang tải dữ liệu thống kê...</div>';
    const d = await apiAdmin('/overview');
    const s = d.stats;
    updateTopupBadge(s.pendingTopups);

    box.innerHTML = `
      <div class="admin-kpi-grid">
        <div class="admin-kpi"><span class="admin-kpi-label">Tổng số người dùng</span><span class="admin-kpi-val">${nf(s.totalUsers)}</span><span class="admin-kpi-sub">Tài khoản đã đăng ký</span></div>
        <div class="admin-kpi"><span class="admin-kpi-label">Tổng số đơn hàng</span><span class="admin-kpi-val">${nf(s.totalOrders)}</span><span class="admin-kpi-sub">Tất cả trạng thái</span></div>
        <div class="admin-kpi"><span class="admin-kpi-label">Đơn hàng đang chờ</span><span class="admin-kpi-val is-warn">${nf(s.waitOrders)}</span><span class="admin-kpi-sub">Chờ gửi/xử lý</span></div>
        <div class="admin-kpi"><span class="admin-kpi-label">Đơn hàng đang chạy</span><span class="admin-kpi-val is-warn">${nf(s.runningOrders)}</span><span class="admin-kpi-sub">Đang đồng bộ tiến độ</span></div>
        <div class="admin-kpi"><span class="admin-kpi-label">Đơn hàng hoàn thành</span><span class="admin-kpi-val is-accent">${nf(s.okOrders)}</span><span class="admin-kpi-sub">Chạy đủ số lượng</span></div>
        <div class="admin-kpi"><span class="admin-kpi-label">Đơn hàng thất bại / hủy</span><span class="admin-kpi-val is-bad">${nf(s.failOrders)} / ${nf(s.cancelOrders)}</span><span class="admin-kpi-sub">Thất bại / Đã hủy</span></div>
        <div class="admin-kpi"><span class="admin-kpi-label">Tổng tiền nạp</span><span class="admin-kpi-val is-accent">${fmt(s.totalTopupAmount)}</span><span class="admin-kpi-sub">Các yêu cầu đã duyệt</span></div>
        <div class="admin-kpi"><span class="admin-kpi-label">Tổng doanh thu</span><span class="admin-kpi-val is-accent">${fmt(s.totalRevenue)}</span><span class="admin-kpi-sub">Doanh thu đơn sau hoàn</span></div>
        <div class="admin-kpi"><span class="admin-kpi-label">Tổng số dư ví khách</span><span class="admin-kpi-val">${fmt(s.totalUserBalance)}</span><span class="admin-kpi-sub">Khả dụng toàn hệ thống</span></div>
        <div class="admin-kpi"><span class="admin-kpi-label">Yêu cầu nạp chờ duyệt</span><span class="admin-kpi-val is-warn">${nf(s.pendingTopups)}</span><span class="admin-kpi-sub">Cần Admin đối chiếu</span></div>
      </div>

      <div class="admin-charts-grid">
        <section class="admin-card">
          <div class="admin-card-head"><h2 class="admin-card-title">Doanh thu theo ngày (14 ngày gần nhất)</h2><span class="admin-card-sub">Dữ liệu thực tế</span></div>
          ${renderBarChart(d.charts.daily, 'revenue', '#0b7a63', true)}
        </section>
        <section class="admin-card">
          <div class="admin-card-head"><h2 class="admin-card-title">Số lượng đơn hàng theo ngày</h2><span class="admin-card-sub">14 ngày gần nhất</span></div>
          ${renderBarChart(d.charts.daily, 'orders', '#2563eb', false)}
        </section>
        <section class="admin-card">
          <div class="admin-card-head"><h2 class="admin-card-title">Người dùng đăng ký theo ngày</h2><span class="admin-card-sub">14 ngày gần nhất</span></div>
          ${renderBarChart(d.charts.daily, 'users', '#7c3aed', false)}
        </section>
        <section class="admin-card">
          <div class="admin-card-head"><h2 class="admin-card-title">Tỷ lệ trạng thái đơn hàng</h2><span class="admin-card-sub">Toàn thời gian</span></div>
          ${renderDonutChart(d.charts.statusBreakdown)}
        </section>
      </div>
    `;
  }

  /* ============================================================
   *  2. QUẢN LÝ NGƯỜI DÙNG
   * ============================================================ */
  const userState = { q: '', status: '' };
  async function renderUsers() {
    const box = $('#admin-content');
    box.innerHTML = `
      <section class="admin-card">
        <div class="admin-card-head">
          <h2 class="admin-card-title">Danh sách tài khoản khách hàng</h2>
        </div>
        <div class="admin-toolbar">
          <input class="admin-input" id="u-q" placeholder="Tìm theo tên đăng nhập, ID hoặc mã nạp..." value="${esc(userState.q)}">
          <select class="admin-select" id="u-status">
            <option value="" ${userState.status === '' ? 'selected' : ''}>Tất cả trạng thái</option>
            <option value="active" ${userState.status === 'active' ? 'selected' : ''}>Đang hoạt động</option>
            <option value="locked" ${userState.status === 'locked' ? 'selected' : ''}>Đã khóa</option>
            <option value="has_balance" ${userState.status === 'has_balance' ? 'selected' : ''}>Có số dư &gt; 0</option>
          </select>
          <button type="button" class="btn primary" id="u-search">Tìm kiếm</button>
        </div>
        <div id="u-table"><div class="admin-loading">Đang tải danh sách người dùng...</div></div>
      </section>
    `;

    async function loadList() {
      const qs = new URLSearchParams({ q: userState.q, status: userState.status });
      const d = await apiAdmin('/users?' + qs.toString());
      $('#u-table').innerHTML = d.users.length
        ? `<div class="admin-table-wrap"><table class="admin-table">
            <thead><tr><th>ID</th><th>Tên đăng nhập</th><th>Mã nạp</th><th>Số dư hiện tại</th><th>Ngày đăng ký</th><th>Tổng đơn</th><th>Tổng đã nạp</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
            <tbody>${d.users.map(u => `
              <tr>
                <td><strong>#${esc(u.id)}</strong></td>
                <td><strong>${esc(u.name)}</strong></td>
                <td><code>${esc(u.code)}</code></td>
                <td class="pos">${fmt(u.balance)}</td>
                <td>${when(u.createdAt)}</td>
                <td>${nf(u.orderCount)}</td>
                <td>${fmt(u.totalTopup)}</td>
                <td>${u.locked ? `<span class="admin-badge bad" title="${esc(u.lockReason)}">Đã khóa</span>` : '<span class="admin-badge ok">Hoạt động</span>'}</td>
                <td>
                  <div class="admin-btn-group">
                    <button type="button" class="btn sm" data-u-detail="${esc(u.id)}">Chi tiết</button>
                    <button type="button" class="btn sm primary" data-u-bal="${esc(u.id)}" data-u-name="${esc(u.name)}" data-u-cur="${u.balance}">Số dư</button>
                    <button type="button" class="btn sm ${u.locked ? '' : 'admin-btn-danger'}" data-u-lock="${esc(u.id)}" data-u-name="${esc(u.name)}" data-u-locked="${u.locked ? '1' : '0'}">${u.locked ? 'Mở khóa' : 'Khóa'}</button>
                  </div>
                </td>
              </tr>`).join('')}
            </tbody>
          </table></div>`
        : '<div class="empty">Không tìm thấy tài khoản phù hợp.</div>';
    }

    $('#u-search').onclick = () => {
      userState.q = $('#u-q').value.trim();
      userState.status = $('#u-status').value;
      loadList().catch(e => toast(e.message));
    };
    $('#u-q').onkeydown = e => { if (e.key === 'Enter') $('#u-search').click(); };
    $('#u-status').onchange = () => $('#u-search').click();

    $('#u-table').onclick = async e => {
      const detBtn = e.target.closest('[data-u-detail]');
      const balBtn = e.target.closest('[data-u-bal]');
      const lockBtn = e.target.closest('[data-u-lock]');
      try {
        if (detBtn) {
          const info = await apiAdmin('/users/' + encodeURIComponent(detBtn.dataset.uDetail));
          const u = info.user;
          showDetailModal(`Chi tiết tài khoản: ${u.name} (#${u.id})`, `
            <div class="admin-detail-grid">
              <div class="admin-detail-item"><span>ID tài khoản</span><strong>#${esc(u.id)}</strong></div>
              <div class="admin-detail-item"><span>Tên đăng nhập</span><strong>${esc(u.name)}</strong></div>
              <div class="admin-detail-item"><span>Số dư hiện tại</span><strong class="pos">${fmt(u.balance)}</strong></div>
              <div class="admin-detail-item"><span>Nội dung chuyển khoản</span><strong><code>${esc(u.code)}</code></strong></div>
              <div class="admin-detail-item"><span>Ngày đăng ký</span><strong>${when(u.createdAt)}</strong></div>
              <div class="admin-detail-item"><span>Trạng thái</span><strong>${u.locked ? 'Đã khóa (' + esc(u.lockReason) + ')' : 'Đang hoạt động'}</strong></div>
              <div class="admin-detail-item"><span>Tổng số đơn hàng</span><strong>${nf(u.orderCount)} đơn</strong></div>
              <div class="admin-detail-item"><span>Tổng tiền đã nạp</span><strong>${fmt(u.totalTopup)}</strong></div>
            </div>
            <h3 style="font-size:15px;margin:0 0 8px">Lịch sử nạp tiền (${info.topups.length})</h3>
            ${info.topups.length ? `<div class="admin-table-wrap" style="margin-bottom:14px"><table class="admin-table" style="min-width:460px">
              <thead><tr><th>Mã</th><th>Số tiền</th><th>Phương thức</th><th>Trạng thái</th><th>Thời gian</th></tr></thead>
              <tbody>${info.topups.slice(0, 15).map(t => `<tr><td>${esc(t.id)}</td><td>${fmt(t.amount)}</td><td>${t.method === 'wallet' ? 'Ví điện tử' : 'Ngân hàng'}</td><td>${t.status === 'ok' ? '<span class="admin-badge ok">Đã duyệt</span>' : t.status === 'reject' ? '<span class="admin-badge bad">Từ chối</span>' : '<span class="admin-badge wait">Chờ duyệt</span>'}</td><td>${when(t.createdAt)}</td></tr>`).join('')}</tbody>
            </table></div>` : '<p style="color:var(--muted);font-size:13px">Chưa có lịch sử nạp tiền.</p>'}
            <h3 style="font-size:15px;margin:0 0 8px">Lịch sử đơn hàng (${info.orders.length})</h3>
            ${info.orders.length ? `<div class="admin-table-wrap"><table class="admin-table" style="min-width:460px">
              <thead><tr><th>Mã đơn</th><th>UID / Tên Game</th><th>Số like</th><th>Chi phí</th><th>Trạng thái</th><th>Thời gian</th></tr></thead>
              <tbody>${info.orders.slice(0, 15).map(o => `<tr><td>${esc(o.id)}</td><td>${esc(o.code)}</td><td>${nf(o.likes)}</td><td>${fmt(o.cost)}</td><td>${orderStatusBadge(o.status)}</td><td>${when(o.createdAt)}</td></tr>`).join('')}</tbody>
            </table></div>` : '<p style="color:var(--muted);font-size:13px">Chưa có đơn hàng nào.</p>'}
          `);
        } else if (balBtn) {
          openBalanceAdjustModal({ id: balBtn.dataset.uBal, name: balBtn.dataset.uName, balance: Number(balBtn.dataset.uCur) }, () => loadList());
        } else if (lockBtn) {
          const isLocked = lockBtn.dataset.uLocked === '1';
          const res = await confirmDialog({
            title: isLocked ? `Mở khóa tài khoản ${lockBtn.dataset.uName}` : `Khóa tài khoản ${lockBtn.dataset.uName}`,
            message: isLocked
              ? `Xác nhận mở khóa cho tài khoản <strong>${esc(lockBtn.dataset.uName)}</strong> (#${esc(lockBtn.dataset.uLock)})?`
              : `Tài khoản <strong>${esc(lockBtn.dataset.uName)}</strong> (#${esc(lockBtn.dataset.uLock)}) sẽ bị đăng xuất ngay lập tức và không thể đăng nhập cho đến khi mở khóa.`,
            requireReason: !isLocked,
            reasonLabel: 'Lý do khóa tài khoản',
            confirmText: isLocked ? 'Mở khóa ngay' : 'Xác nhận khóa',
            danger: !isLocked,
          });
          if (!res) return;
          await apiAdmin(`/users/${encodeURIComponent(lockBtn.dataset.uLock)}/lock`, {
            method: 'POST',
            body: { locked: !isLocked, reason: res.reason },
          });
          toast(isLocked ? 'Đã mở khóa tài khoản' : 'Đã khóa tài khoản');
          await loadList();
        }
      } catch (err) {
        toast(err.message);
      }
    };

    await loadList();
  }

  function openBalanceAdjustModal(user, onDone) {
    const root = $('#admin-modal-root');
    root.innerHTML = `
      <div class="admin-modal-backdrop" id="modal-bg">
        <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
          <div class="admin-modal-head">
            <h2 class="admin-modal-title" id="m-title">Điều chỉnh số dư: ${esc(user.name)} (#${esc(user.id)})</h2>
            <button type="button" class="icon-btn" id="m-close" aria-label="Đóng">✕</button>
          </div>
          <p style="margin:0 0 12px;font-size:14px">Số dư hiện tại: <strong class="pos">${fmt(user.balance)}</strong></p>
          <div class="field">
            <label for="adj-kind">Loại điều chỉnh</label>
            <select id="adj-kind" class="admin-select" style="width:100%">
              <option value="add">Cộng tiền vào tài khoản (+)</option>
              <option value="sub">Trừ tiền khỏi tài khoản (-)</option>
            </select>
          </div>
          <div class="field">
            <label for="adj-amt">Số tiền điều chỉnh (VNĐ)</label>
            <input id="adj-amt" type="number" min="1" step="1" placeholder="Ví dụ: 50000">
          </div>
          <div class="field" style="margin-bottom:0">
            <label for="adj-reason">Lý do điều chỉnh <span style="color:var(--bad)">*</span></label>
            <input id="adj-reason" maxlength="200" placeholder="Ví dụ: Bù tiền giao dịch lỗi / Thu hồi cộng nhầm...">
          </div>
          <div id="adj-err" style="margin-top:10px"></div>
          <div class="admin-modal-foot">
            <button type="button" class="btn" id="m-cancel">Hủy</button>
            <button type="button" class="btn primary" id="m-next">Tiếp tục xác nhận</button>
          </div>
        </div>
      </div>
    `;
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
    $('#modal-bg').onclick = e => { if (e.target.id === 'modal-bg') closeModal(); };
    $('#m-next').onclick = async () => {
      const kind = $('#adj-kind').value;
      const amount = Number($('#adj-amt').value);
      const reason = ($('#adj-reason').value || '').trim();
      if (!Number.isFinite(amount) || amount <= 0) {
        $('#adj-err').innerHTML = '<div class="err" style="margin:0">Vui lòng nhập số tiền hợp lệ lớn hơn 0.</div>';
        return;
      }
      if (kind === 'sub' && amount > user.balance) {
        $('#adj-err').innerHTML = '<div class="err" style="margin:0">Số tiền trừ vượt quá số dư hiện tại của khách.</div>';
        return;
      }
      if (reason.length < 2) {
        $('#adj-err').innerHTML = '<div class="err" style="margin:0">Vui lòng nhập lý do điều chỉnh số dư.</div>';
        return;
      }
      const after = kind === 'add' ? user.balance + amount : user.balance - amount;
      const ok = await confirmDialog({
        title: 'Xác nhận thay đổi số dư',
        message: `Tài khoản: <strong>${esc(user.name)} (#${esc(user.id)})</strong><br>
          Thao tác: <strong>${kind === 'add' ? 'Cộng +' + fmt(amount) : 'Trừ -' + fmt(amount)}</strong><br>
          Số dư: ${fmt(user.balance)} → <strong>${fmt(after)}</strong><br>
          Lý do: <em>${esc(reason)}</em>`,
        confirmText: 'Thực hiện ngay',
        danger: kind === 'sub',
      });
      if (!ok) return;
      try {
        await apiAdmin(`/users/${encodeURIComponent(user.id)}/balance`, {
          method: 'POST',
          body: { kind, amount, reason },
        });
        toast('Đã cập nhật số dư và ghi lịch sử giao dịch');
        if (onDone) await onDone();
      } catch (err) {
        toast(err.message);
      }
    };
  }

  /* ============================================================
   *  3. QUẢN LÝ ĐƠN HÀNG
   * ============================================================ */
  const orderState = { q: '', status: '', from: '', to: '', page: 1 };
  async function renderOrders() {
    const box = $('#admin-content');
    box.innerHTML = `
      <section class="admin-card">
        <div class="admin-card-head">
          <h2 class="admin-card-title">Tất cả đơn hàng hệ thống</h2>
          <span class="admin-card-sub">Giám sát tiến độ và hoàn tiền tự động</span>
        </div>
        <div class="admin-toolbar">
          <input class="admin-input" id="o-q" placeholder="Tìm mã đơn (BH...), tên khách hoặc UID..." value="${esc(orderState.q)}">
          <select class="admin-select" id="o-status">
            <option value="" ${orderState.status === '' ? 'selected' : ''}>Tất cả trạng thái</option>
            <option value="wait" ${orderState.status === 'wait' ? 'selected' : ''}>Đang chờ</option>
            <option value="running" ${orderState.status === 'running' ? 'selected' : ''}>Đang chạy</option>
            <option value="ok" ${orderState.status === 'ok' ? 'selected' : ''}>Hoàn thành</option>
            <option value="fail" ${orderState.status === 'fail' ? 'selected' : ''}>Thất bại</option>
            <option value="cancel" ${orderState.status === 'cancel' ? 'selected' : ''}>Đã hủy</option>
          </select>
          <input type="date" class="admin-input admin-input-date" id="o-from" value="${esc(orderState.from)}" title="Từ ngày">
          <input type="date" class="admin-input admin-input-date" id="o-to" value="${esc(orderState.to)}" title="Đến ngày">
          <button type="button" class="btn primary" id="o-filter">Lọc dữ liệu</button>
        </div>
        <div id="o-table"><div class="admin-loading">Đang tải danh sách đơn hàng...</div></div>
      </section>
    `;

    let lastItems = [];
    async function loadOrders() {
      const qs = new URLSearchParams({
        q: orderState.q,
        status: orderState.status,
        from: orderState.from,
        to: orderState.to,
        page: String(orderState.page),
        pageSize: '20',
      });
      const d = await apiAdmin('/orders?' + qs.toString());
      lastItems = d.orders;
      $('#o-table').innerHTML = d.orders.length
        ? `<div class="admin-table-wrap"><table class="admin-table">
            <thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>UID / Tên Game</th><th>Số like</th><th>Chi phí</th><th>Tiến độ</th><th>Trạng thái</th><th>Thời gian tạo</th><th></th></tr></thead>
            <tbody>${d.orders.map((o, idx) => {
              const pct = o.likes ? Math.round((o.done / o.likes) * 100) : 0;
              return `<tr>
                <td><strong>${esc(o.id)}</strong></td>
                <td>${esc(o.userName)}</td>
                <td><code>${esc(o.code)}</code></td>
                <td>${nf(o.likes)}</td>
                <td>${fmt(o.cost)}${o.refundAmount > 0 ? `<br><small class="neg">Hoàn: ${fmt(o.refundAmount)}</small>` : ''}</td>
                <td><div style="min-width:110px"><div style="font-size:12px;color:var(--muted)">${pct}% (${nf(o.done)}/${nf(o.likes)})</div><div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div></div></td>
                <td>${orderStatusBadge(o.status)}</td>
                <td>${when(o.createdAt)}</td>
                <td><button type="button" class="btn sm" data-o-idx="${idx}">Chi tiết</button></td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
          <div class="pager">
            <span>Tổng ${nf(d.total)} đơn hàng · Trang ${d.page}/${d.pages}</span>
            <div>
              <button type="button" class="btn sm" id="o-prev" ${d.page <= 1 ? 'disabled' : ''}>Trước</button>
              <button type="button" class="btn sm" id="o-next" ${d.page >= d.pages ? 'disabled' : ''}>Sau</button>
            </div>
          </div>`
        : '<div class="empty">Không có đơn hàng nào khớp điều kiện lọc.</div>';

      const prev = $('#o-prev'), next = $('#o-next');
      if (prev) prev.onclick = () => { orderState.page--; loadOrders(); };
      if (next) next.onclick = () => { orderState.page++; loadOrders(); };
    }

    $('#o-filter').onclick = () => {
      orderState.q = $('#o-q').value.trim();
      orderState.status = $('#o-status').value;
      orderState.from = $('#o-from').value;
      orderState.to = $('#o-to').value;
      orderState.page = 1;
      loadOrders().catch(e => toast(e.message));
    };
    $('#o-q').onkeydown = e => { if (e.key === 'Enter') $('#o-filter').click(); };

    $('#o-table').onclick = e => {
      const btn = e.target.closest('[data-o-idx]');
      if (!btn) return;
      const o = lastItems[Number(btn.dataset.oIdx)];
      if (!o) return;
      showDetailModal(`Chi tiết đơn hàng ${o.id}`, `
        <div class="admin-detail-grid">
          <div class="admin-detail-item"><span>Mã đơn hàng</span><strong>${esc(o.id)}</strong></div>
          <div class="admin-detail-item"><span>Khách hàng</span><strong>${esc(o.userName)} (ID #${esc(o.userId)})</strong></div>
          <div class="admin-detail-item"><span>UID / Tên Game</span><strong><code>${esc(o.code)}</code></strong></div>
          <div class="admin-detail-item"><span>Mã đơn web mẹ</span><strong>${esc(o.motherId || 'Chưa có')}</strong></div>
          <div class="admin-detail-item"><span>Số lượng like</span><strong>${nf(o.likes)} like</strong></div>
          <div class="admin-detail-item"><span>Tiến độ hoàn thành</span><strong>${nf(o.done)} / ${nf(o.likes)} (${o.likes ? Math.round(o.done / o.likes * 100) : 0}%)</strong></div>
          <div class="admin-detail-item"><span>Chi phí đơn hàng</span><strong>${fmt(o.cost)}</strong></div>
          <div class="admin-detail-item"><span>Số tiền đã hoàn</span><strong class="${o.refundAmount > 0 ? 'neg' : ''}">${fmt(o.refundAmount)}</strong></div>
          <div class="admin-detail-item"><span>Trạng thái</span><strong>${orderStatusBadge(o.status)}</strong></div>
          <div class="admin-detail-item"><span>Thời gian tạo đơn</span><strong>${when(o.createdAt)}</strong></div>
          <div class="admin-detail-item" style="grid-column:1/-1"><span>Ghi chú khách hàng</span><strong>${esc(o.note || 'Không có')}</strong></div>
          ${o.error ? `<div class="admin-detail-item" style="grid-column:1/-1"><span>Thông báo lỗi hệ thống</span><strong class="neg">${esc(o.error)}</strong></div>` : ''}
        </div>
      `, false);
    };

    await loadOrders();
  }

  /* ============================================================
   *  4. QUẢN LÝ NẠP TIỀN
   * ============================================================ */
  const topupState = { status: 'wait', q: '', from: '', to: '' };
  async function renderTopups() {
    const box = $('#admin-content');
    box.innerHTML = `
      <section class="admin-card">
        <div class="admin-card-head">
          <h2 class="admin-card-title">Quản lý yêu cầu nạp tiền</h2>
          <span class="admin-card-sub">Đối chiếu giao dịch thực tế trước khi duyệt cộng tiền</span>
        </div>
        <div class="admin-tabs" id="t-tabs">
          <button type="button" class="admin-tab ${topupState.status === 'wait' ? 'is-active' : ''}" data-t-st="wait">Đang chờ duyệt</button>
          <button type="button" class="admin-tab ${topupState.status === 'ok' ? 'is-active' : ''}" data-t-st="ok">Đã duyệt</button>
          <button type="button" class="admin-tab ${topupState.status === 'reject' ? 'is-active' : ''}" data-t-st="reject">Đã từ chối</button>
          <button type="button" class="admin-tab ${topupState.status === '' ? 'is-active' : ''}" data-t-st="">Tất cả</button>
        </div>
        <div class="admin-toolbar">
          <input class="admin-input" id="t-q" placeholder="Tìm mã yêu cầu (NT...), tài khoản hoặc nội dung CK..." value="${esc(topupState.q)}">
          <input type="date" class="admin-input admin-input-date" id="t-from" value="${esc(topupState.from)}">
          <input type="date" class="admin-input admin-input-date" id="t-to" value="${esc(topupState.to)}">
          <button type="button" class="btn primary" id="t-filter">Tìm kiếm</button>
        </div>
        <div id="t-table"><div class="admin-loading">Đang tải danh sách nạp tiền...</div></div>
      </section>
    `;

    async function loadTopups() {
      const qs = new URLSearchParams({
        status: topupState.status,
        q: topupState.q,
        from: topupState.from,
        to: topupState.to,
      });
      const d = await apiAdmin('/topups?' + qs.toString());
      if (topupState.status === 'wait') updateTopupBadge(d.topups.length);

      $('#t-table').innerHTML = d.topups.length
        ? `<div class="admin-table-wrap"><table class="admin-table">
            <thead><tr><th>Mã yêu cầu</th><th>Tài khoản</th><th>Nội dung CK</th><th>Số tiền</th><th>Phương thức</th><th>Thời gian tạo</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
            <tbody>${d.topups.map(t => `
              <tr>
                <td><strong>${esc(t.id)}</strong></td>
                <td>${esc(t.user)}</td>
                <td><code>${esc(t.content)}</code></td>
                <td class="pos">${fmt(t.amount)}</td>
                <td>${t.method === 'wallet' ? 'Ví điện tử' : 'Ngân hàng'}</td>
                <td>${when(t.createdAt)}</td>
                <td>${t.status === 'ok' ? '<span class="admin-badge ok">Đã duyệt</span>' : t.status === 'reject' ? `<span class="admin-badge bad" title="${esc(t.rejectReason)}">Đã từ chối</span>` : '<span class="admin-badge wait">Chờ duyệt</span>'}</td>
                <td>
                  ${t.status === 'wait' ? `<div class="admin-btn-group">
                    <button type="button" class="btn sm primary" data-t-act="approve" data-t-id="${esc(t.id)}" data-t-user="${esc(t.user)}" data-t-amt="${t.amount}">Duyệt</button>
                    <button type="button" class="btn sm admin-btn-danger" data-t-act="reject" data-t-id="${esc(t.id)}" data-t-user="${esc(t.user)}" data-t-amt="${t.amount}">Từ chối</button>
                  </div>` : `<small style="color:var(--muted)">${t.doneAt ? 'Xử lý: ' + when(t.doneAt) : 'Đã hoàn tất'}</small>`}
                </td>
              </tr>`).join('')}
            </tbody>
          </table></div>`
        : '<div class="empty">Không có yêu cầu nạp tiền nào trong mục này.</div>';
    }

    $('#t-tabs').onclick = e => {
      const tab = e.target.closest('[data-t-st]');
      if (!tab) return;
      topupState.status = tab.dataset.tSt;
      document.querySelectorAll('#t-tabs .admin-tab').forEach(b => b.classList.toggle('is-active', b === tab));
      loadTopups().catch(err => toast(err.message));
    };
    $('#t-filter').onclick = () => {
      topupState.q = $('#t-q').value.trim();
      topupState.from = $('#t-from').value;
      topupState.to = $('#t-to').value;
      loadTopups().catch(err => toast(err.message));
    };
    $('#t-q').onkeydown = e => { if (e.key === 'Enter') $('#t-filter').click(); };

    $('#t-table').onclick = async e => {
      const btn = e.target.closest('[data-t-act]');
      if (!btn || btn.disabled) return;
      const act = btn.dataset.tAct;
      const id = btn.dataset.tId;
      const user = btn.dataset.tUser;
      const amt = Number(btn.dataset.tAmt);
      const isApprove = act === 'approve';

      const ok = await confirmDialog({
        title: isApprove ? `Duyệt yêu cầu nạp ${id}` : `Từ chối yêu cầu nạp ${id}`,
        message: isApprove
          ? `Xác nhận cộng <strong>${fmt(amt)}</strong> vào tài khoản <strong>${esc(user)}</strong>?<br><small style="color:var(--muted)">Hệ thống đảm bảo mỗi yêu cầu chỉ được duyệt và cộng tiền một lần duy nhất.</small>`
          : `Xác nhận từ chối yêu cầu nạp <strong>${fmt(amt)}</strong> của tài khoản <strong>${esc(user)}</strong>?`,
        requireReason: !isApprove,
        reasonLabel: 'Lý do từ chối',
        confirmText: isApprove ? 'Duyệt & Cộng tiền' : 'Từ chối yêu cầu',
        danger: !isApprove,
      });
      if (!ok) return;

      btn.disabled = true;
      try {
        await apiAdmin(`/topups/${encodeURIComponent(id)}/${act}`, {
          method: 'POST',
          body: { reason: ok.reason },
        });
        toast(isApprove ? `Đã duyệt ${id} và cộng ${fmt(amt)}` : `Đã từ chối yêu cầu ${id}`);
        await loadTopups();
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    };

    await loadTopups();
  }

  /* ============================================================
   *  5. QUẢN LÝ SỐ DƯ
   * ============================================================ */
  const balState = { q: '', histTab: 'add' };
  async function renderBalances() {
    const box = $('#admin-content');
    box.innerHTML = '<div class="admin-loading">Đang tải dữ liệu ví khách hàng...</div>';
    const d = await apiAdmin('/balances?q=' + encodeURIComponent(balState.q));
    const top = d.summary.topUser;

    function renderHistTable(rows) {
      if (!rows.length) return '<div class="empty">Chưa có dữ liệu biến động trong mục này.</div>';
      return `<div class="admin-table-wrap"><table class="admin-table">
        <thead><tr><th>Mã GD</th><th>Tài khoản</th><th>Loại</th><th>Số tiền</th><th>Số dư trước</th><th>Số dư sau</th><th>Nội dung</th><th>Thời gian</th></tr></thead>
        <tbody>${rows.map(tx => `<tr>
          <td><strong>${esc(tx.id)}</strong></td>
          <td>${esc(tx.userName)}</td>
          <td>${txTypeBadge(tx.type)}</td>
          <td class="${tx.amount >= 0 ? 'pos' : 'neg'}">${tx.amount >= 0 ? '+' : ''}${fmt(tx.amount)}</td>
          <td>${tx.balanceBefore !== null ? fmt(tx.balanceBefore) : '—'}</td>
          <td>${tx.balanceAfter !== null ? fmt(tx.balanceAfter) : '—'}</td>
          <td>${esc(tx.note)}</td>
          <td>${when(tx.createdAt)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    }

    box.innerHTML = `
      <div class="admin-kpi-grid">
        <div class="admin-kpi"><span class="admin-kpi-label">Tổng số dư toàn hệ thống</span><span class="admin-kpi-val is-accent">${fmt(d.summary.totalBalance)}</span><span class="admin-kpi-sub">Tổng ví của ${nf(d.summary.userCount)} tài khoản</span></div>
        <div class="admin-kpi"><span class="admin-kpi-label">Tài khoản số dư cao nhất</span><span class="admin-kpi-val">${top ? fmt(top.balance) : '0đ'}</span><span class="admin-kpi-sub">${top ? `${esc(top.name)} (ID #${top.id})` : 'Chưa có tài khoản'}</span></div>
      </div>

      <section class="admin-card">
        <div class="admin-card-head"><h2 class="admin-card-title">Danh sách số dư từng tài khoản</h2></div>
        <div class="admin-toolbar">
          <input class="admin-input" id="b-q" placeholder="Tìm tên tài khoản hoặc ID..." value="${esc(balState.q)}">
          <button type="button" class="btn primary" id="b-search">Tìm kiếm</button>
        </div>
        ${d.users.length ? `<div class="admin-table-wrap"><table class="admin-table">
          <thead><tr><th>ID</th><th>Tài khoản</th><th>Mã nạp</th><th>Số dư hiện tại</th><th>Trạng thái</th><th>Thao tác nhanh</th></tr></thead>
          <tbody>${d.users.map(u => `<tr>
            <td><strong>#${esc(u.id)}</strong></td>
            <td><strong>${esc(u.name)}</strong></td>
            <td><code>${esc(u.code)}</code></td>
            <td class="pos">${fmt(u.balance)}</td>
            <td>${u.locked ? '<span class="admin-badge bad">Đã khóa</span>' : '<span class="admin-badge ok">Hoạt động</span>'}</td>
            <td><button type="button" class="btn sm primary" data-b-adj="${esc(u.id)}" data-b-name="${esc(u.name)}" data-b-cur="${u.balance}">Cộng / Trừ tiền</button></td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">Không tìm thấy tài khoản nào.</div>'}
      </section>

      <section class="admin-card">
        <div class="admin-card-head"><h2 class="admin-card-title">Lịch sử biến động số dư</h2></div>
        <div class="admin-tabs" id="b-tabs">
          <button type="button" class="admin-tab ${balState.histTab === 'add' ? 'is-active' : ''}" data-bh="add">Lịch sử cộng tiền (${d.history.add.length})</button>
          <button type="button" class="admin-tab ${balState.histTab === 'sub' ? 'is-active' : ''}" data-bh="sub">Lịch sử trừ tiền (${d.history.sub.length})</button>
          <button type="button" class="admin-tab ${balState.histTab === 'refund' ? 'is-active' : ''}" data-bh="refund">Lịch sử hoàn tiền (${d.history.refund.length})</button>
        </div>
        <div id="b-hist-box">${renderHistTable(d.history[balState.histTab] || [])}</div>
      </section>
    `;

    $('#b-search').onclick = () => {
      balState.q = $('#b-q').value.trim();
      renderBalances().catch(e => toast(e.message));
    };
    $('#b-q').onkeydown = e => { if (e.key === 'Enter') $('#b-search').click(); };

    $('#b-tabs').onclick = e => {
      const tab = e.target.closest('[data-bh]');
      if (!tab) return;
      balState.histTab = tab.dataset.bh;
      document.querySelectorAll('#b-tabs .admin-tab').forEach(b => b.classList.toggle('is-active', b === tab));
      $('#b-hist-box').innerHTML = renderHistTable(d.history[balState.histTab] || []);
    };

    box.onclick = e => {
      const btn = e.target.closest('[data-b-adj]');
      if (!btn) return;
      openBalanceAdjustModal(
        { id: btn.dataset.bAdj, name: btn.dataset.bName, balance: Number(btn.dataset.bCur) },
        () => renderBalances()
      );
    };
  }

  /* ============================================================
   *  6. LỊCH SỬ GIAO DỊCH TỔNG HỢP
   * ============================================================ */
  const txState = { q: '', type: '', from: '', to: '', page: 1 };
  async function renderTransactions() {
    const box = $('#admin-content');
    box.innerHTML = `
      <section class="admin-card">
        <div class="admin-card-head">
          <h2 class="admin-card-title">Lịch sử giao dịch toàn hệ thống</h2>
          <span class="admin-card-sub">Ghi nhận tự động từ dữ liệu thật</span>
        </div>
        <div class="admin-toolbar">
          <input class="admin-input" id="tx-q" placeholder="Tìm mã GD, tên người dùng hoặc nội dung..." value="${esc(txState.q)}">
          <select class="admin-select" id="tx-type">
            <option value="" ${txState.type === '' ? 'selected' : ''}>Tất cả loại giao dịch</option>
            <option value="topup" ${txState.type === 'topup' ? 'selected' : ''}>Nạp tiền</option>
            <option value="admin_add" ${txState.type === 'admin_add' ? 'selected' : ''}>Cộng tiền thủ công</option>
            <option value="admin_sub" ${txState.type === 'admin_sub' ? 'selected' : ''}>Trừ tiền thủ công</option>
            <option value="order_pay" ${txState.type === 'order_pay' ? 'selected' : ''}>Thanh toán đơn hàng</option>
            <option value="order_refund" ${txState.type === 'order_refund' ? 'selected' : ''}>Hoàn tiền đơn hàng</option>
          </select>
          <input type="date" class="admin-input admin-input-date" id="tx-from" value="${esc(txState.from)}">
          <input type="date" class="admin-input admin-input-date" id="tx-to" value="${esc(txState.to)}">
          <button type="button" class="btn primary" id="tx-filter">Lọc dữ liệu</button>
        </div>
        <div id="tx-table"><div class="admin-loading">Đang tải lịch sử giao dịch...</div></div>
      </section>
    `;

    async function loadTx() {
      const qs = new URLSearchParams({
        q: txState.q,
        type: txState.type,
        from: txState.from,
        to: txState.to,
        page: String(txState.page),
        pageSize: '25',
      });
      const d = await apiAdmin('/transactions?' + qs.toString());
      $('#tx-table').innerHTML = d.transactions.length
        ? `<div class="admin-table-wrap"><table class="admin-table">
            <thead><tr><th>Mã giao dịch</th><th>Người dùng</th><th>Loại giao dịch</th><th>Số tiền</th><th>Số dư trước</th><th>Số dư sau</th><th>Nội dung</th><th>Thời gian</th></tr></thead>
            <tbody>${d.transactions.map(tx => `<tr>
              <td><strong>${esc(tx.id)}</strong></td>
              <td>${esc(tx.userName)}</td>
              <td>${txTypeBadge(tx.type)}</td>
              <td class="${tx.amount >= 0 ? 'pos' : 'neg'}">${tx.amount >= 0 ? '+' : ''}${fmt(tx.amount)}</td>
              <td>${tx.balanceBefore !== null ? fmt(tx.balanceBefore) : '—'}</td>
              <td>${tx.balanceAfter !== null ? fmt(tx.balanceAfter) : '—'}</td>
              <td>${esc(tx.note)}</td>
              <td>${when(tx.createdAt)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
          <div class="pager">
            <span>Tổng ${nf(d.total)} giao dịch · Trang ${d.page}/${d.pages}</span>
            <div>
              <button type="button" class="btn sm" id="tx-prev" ${d.page <= 1 ? 'disabled' : ''}>Trước</button>
              <button type="button" class="btn sm" id="tx-next" ${d.page >= d.pages ? 'disabled' : ''}>Sau</button>
            </div>
          </div>`
        : '<div class="empty">Không có giao dịch nào phù hợp.</div>';

      const prev = $('#tx-prev'), next = $('#tx-next');
      if (prev) prev.onclick = () => { txState.page--; loadTx(); };
      if (next) next.onclick = () => { txState.page++; loadTx(); };
    }

    $('#tx-filter').onclick = () => {
      txState.q = $('#tx-q').value.trim();
      txState.type = $('#tx-type').value;
      txState.from = $('#tx-from').value;
      txState.to = $('#tx-to').value;
      txState.page = 1;
      loadTx().catch(e => toast(e.message));
    };
    $('#tx-q').onkeydown = e => { if (e.key === 'Enter') $('#tx-filter').click(); };

    await loadTx();
  }

  /* ============================================================
   *  7. CẤU HÌNH WEBSITE
   * ============================================================ */
  async function renderSettings() {
    const box = $('#admin-content');
    box.innerHTML = '<div class="admin-loading">Đang tải cấu hình vận hành...</div>';
    const d = await apiAdmin('/settings');
    const s = d.settings;

    box.innerHTML = `
      <form id="cfg-form" class="admin-card">
        <div class="admin-card-head">
          <h2 class="admin-card-title">Thông số vận hành website</h2>
          <span class="admin-card-sub">Chỉ áp dụng khi Admin bấm Lưu cấu hình</span>
        </div>

        <div class="admin-form-grid">
          <div class="admin-form-group">
            <label for="cfg-rate">Giá mỗi like (VNĐ)</label>
            <input id="cfg-rate" class="admin-input" type="number" step="0.01" min="0.01" value="${esc(s.rate)}" required>
            <small>Đơn giá áp dụng cho mỗi like khách đặt.</small>
          </div>
          <div class="admin-form-group">
            <label for="cfg-demo">Chế độ Demo nạp tiền</label>
            <label class="admin-switch-row">
              <input id="cfg-demo" type="checkbox" ${s.demo ? 'checked' : ''}>
              <span>Bật nút "Duyệt thử" trên trang nạp tiền của khách</span>
            </label>
          </div>
          <div class="admin-form-group">
            <label for="cfg-min">Số like tối thiểu</label>
            <input id="cfg-min" class="admin-input" type="number" min="1" step="1" value="${esc(s.minLikes)}" required>
          </div>
          <div class="admin-form-group">
            <label for="cfg-max">Số like tối đa</label>
            <input id="cfg-max" class="admin-input" type="number" min="1" step="1" value="${esc(s.maxLikes)}" required>
          </div>
          <div class="admin-form-group">
            <label for="cfg-dcode">Mã giảm giá</label>
            <input id="cfg-dcode" class="admin-input" maxlength="32" placeholder="Để trống nếu không dùng" value="${esc(s.discountCode)}">
          </div>
          <div class="admin-form-group">
            <label for="cfg-dpct">Phần trăm giảm giá (%)</label>
            <input id="cfg-dpct" class="admin-input" type="number" min="0" max="90" step="0.1" value="${esc(s.discountPct)}">
          </div>
        </div>

        <hr style="border:0;border-top:1px solid var(--line);margin:20px 0">
        <h3 style="font-size:16px;margin:0 0 12px">Thông tin tài khoản ngân hàng nhận tiền</h3>
        <div class="admin-form-grid">
          <div class="admin-form-group">
            <label for="cfg-bname">Tên ngân hàng</label>
            <input id="cfg-bname" class="admin-input" value="${esc(s.bank.name)}">
          </div>
          <div class="admin-form-group">
            <label for="cfg-bnum">Số tài khoản</label>
            <input id="cfg-bnum" class="admin-input" value="${esc(s.bank.number)}">
          </div>
          <div class="admin-form-group">
            <label for="cfg-bowner">Chủ tài khoản</label>
            <input id="cfg-bowner" class="admin-input" value="${esc(s.bank.owner)}">
          </div>
          <div class="admin-form-group">
            <label for="cfg-bqrid">Mã VietQR ngân hàng (VD: MB, VCB, TCB)</label>
            <input id="cfg-bqrid" class="admin-input" value="${esc(s.bank.qrId)}">
          </div>
          <div class="admin-form-group is-full">
            <label for="cfg-bqrfb">Link ảnh QR dự phòng</label>
            <input id="cfg-bqrfb" class="admin-input" value="${esc(s.bank.qrFallback)}">
          </div>
        </div>

        <hr style="border:0;border-top:1px solid var(--line);margin:20px 0">
        <h3 style="font-size:16px;margin:0 0 12px">Thông tin ví điện tử (để trống nếu không dùng)</h3>
        <div class="admin-form-grid">
          <div class="admin-form-group">
            <label for="cfg-wname">Tên ví (VD: MoMo, ZaloPay)</label>
            <input id="cfg-wname" class="admin-input" value="${esc(s.wallet.name)}">
          </div>
          <div class="admin-form-group">
            <label for="cfg-wnum">Số điện thoại / Số ví</label>
            <input id="cfg-wnum" class="admin-input" value="${esc(s.wallet.number)}">
          </div>
          <div class="admin-form-group">
            <label for="cfg-wowner">Chủ ví điện tử</label>
            <input id="cfg-wowner" class="admin-input" value="${esc(s.wallet.owner)}">
          </div>
          <div class="admin-form-group">
            <label for="cfg-reason">Ghi chú thay đổi cấu hình</label>
            <input id="cfg-reason" class="admin-input" placeholder="Nhập lý do lưu cấu hình...">
          </div>
        </div>

        <div style="margin-top:20px;display:flex;justify-content:flex-end;gap:10px">
          <button type="submit" class="btn primary">Lưu cấu hình</button>
        </div>
      </form>
    `;

    $('#cfg-form').onsubmit = async e => {
      e.preventDefault();
      const payload = {
        rate: Number($('#cfg-rate').value),
        minLikes: parseInt($('#cfg-min').value, 10),
        maxLikes: parseInt($('#cfg-max').value, 10),
        discountCode: $('#cfg-dcode').value.trim(),
        discountPct: Number($('#cfg-dpct').value || 0),
        demo: $('#cfg-demo').checked,
        bank: {
          name: $('#cfg-bname').value.trim(),
          number: $('#cfg-bnum').value.trim(),
          owner: $('#cfg-bowner').value.trim(),
          qrId: $('#cfg-bqrid').value.trim(),
          qrFallback: $('#cfg-bqrfb').value.trim(),
        },
        wallet: {
          name: $('#cfg-wname').value.trim(),
          number: $('#cfg-wnum').value.trim(),
          owner: $('#cfg-wowner').value.trim(),
        },
        reason: $('#cfg-reason').value.trim(),
      };

      const ok = await confirmDialog({
        title: 'Xác nhận lưu cấu hình website',
        message: 'Các thông số mới sẽ áp dụng ngay cho toàn bộ khách hàng đặt đơn và nạp tiền. Bạn có chắc chắn muốn lưu?',
        confirmText: 'Lưu thay đổi',
      });
      if (!ok) return;

      try {
        await apiAdmin('/settings', { method: 'POST', body: payload });
        toast('Đã lưu cấu hình website thành công');
        await renderSettings();
      } catch (err) {
        toast(err.message);
      }
    };
  }

  /* ============================================================
   *  8. NHẬT KÝ HOẠT ĐỘNG ADMIN
   * ============================================================ */
  const logState = { q: '', action: '', page: 1 };
  async function renderLogs() {
    const box = $('#admin-content');
    box.innerHTML = `
      <section class="admin-card">
        <div class="admin-card-head">
          <h2 class="admin-card-title">Nhật ký hoạt động quản trị (Audit Log)</h2>
          <span class="admin-card-sub">Dữ liệu chỉ đọc — không cho phép chỉnh sửa hoặc xóa</span>
        </div>
        <div class="admin-toolbar">
          <input class="admin-input" id="l-q" placeholder="Tìm đối tượng tác động hoặc lý do..." value="${esc(logState.q)}">
          <select class="admin-select" id="l-act">
            <option value="" ${logState.action === '' ? 'selected' : ''}>Tất cả hành động</option>
            <option value="Duyệt nạp tiền" ${logState.action === 'Duyệt nạp tiền' ? 'selected' : ''}>Duyệt nạp tiền</option>
            <option value="Từ chối nạp tiền" ${logState.action === 'Từ chối nạp tiền' ? 'selected' : ''}>Từ chối nạp tiền</option>
            <option value="Cộng tiền tài khoản" ${logState.action === 'Cộng tiền tài khoản' ? 'selected' : ''}>Cộng tiền tài khoản</option>
            <option value="Trừ tiền tài khoản" ${logState.action === 'Trừ tiền tài khoản' ? 'selected' : ''}>Trừ tiền tài khoản</option>
            <option value="Khóa tài khoản" ${logState.action === 'Khóa tài khoản' ? 'selected' : ''}>Khóa tài khoản</option>
            <option value="Mở khóa tài khoản" ${logState.action === 'Mở khóa tài khoản' ? 'selected' : ''}>Mở khóa tài khoản</option>
            <option value="Cập nhật cấu hình website" ${logState.action === 'Cập nhật cấu hình website' ? 'selected' : ''}>Cập nhật cấu hình website</option>
          </select>
          <button type="button" class="btn primary" id="l-filter">Lọc nhật ký</button>
        </div>
        <div id="l-table"><div class="admin-loading">Đang tải nhật ký hoạt động...</div></div>
      </section>
    `;

    async function loadLogs() {
      const qs = new URLSearchParams({
        q: logState.q,
        action: logState.action,
        page: String(logState.page),
        pageSize: '25',
      });
      const d = await apiAdmin('/logs?' + qs.toString());
      $('#l-table').innerHTML = d.logs.length
        ? `<div class="admin-table-wrap"><table class="admin-table">
            <thead><tr><th>Mã Log</th><th>Hành động</th><th>Đối tượng</th><th>Giá trị trước</th><th>Giá trị sau</th><th>Lý do</th><th>Thời gian</th></tr></thead>
            <tbody>${d.logs.map(l => `<tr>
              <td><code>${esc(l.id)}</code></td>
              <td><strong>${esc(l.action)}</strong></td>
              <td>${esc(l.target)}</td>
              <td style="color:var(--muted)">${esc(l.before || '—')}</td>
              <td>${esc(l.after || '—')}</td>
              <td>${esc(l.reason || '—')}</td>
              <td>${when(l.createdAt)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
          <div class="pager">
            <span>Tổng ${nf(d.total)} bản ghi · Trang ${d.page}/${d.pages}</span>
            <div>
              <button type="button" class="btn sm" id="l-prev" ${d.page <= 1 ? 'disabled' : ''}>Trước</button>
              <button type="button" class="btn sm" id="l-next" ${d.page >= d.pages ? 'disabled' : ''}>Sau</button>
            </div>
          </div>`
        : '<div class="empty">Chưa có nhật ký hoạt động quản trị nào.</div>';

      const prev = $('#l-prev'), next = $('#l-next');
      if (prev) prev.onclick = () => { logState.page--; loadLogs(); };
      if (next) next.onclick = () => { logState.page++; loadLogs(); };
    }

    $('#l-filter').onclick = () => {
      logState.q = $('#l-q').value.trim();
      logState.action = $('#l-act').value;
      logState.page = 1;
      loadLogs().catch(e => toast(e.message));
    };
    $('#l-q').onkeydown = e => { if (e.key === 'Enter') $('#l-filter').click(); };

    await loadLogs();
  }

  /* ============================================================
   *  ĐIỀU HƯỚNG & XÁC THỰC PHIÊN ADMIN
   * ============================================================ */
  function updateTopupBadge(count) {
    const b = $('#nav-topup-badge');
    if (!b) return;
    if (count > 0) {
      b.textContent = String(count);
      b.hidden = false;
    } else {
      b.hidden = true;
    }
  }

  function closeSidebarMobile() {
    $('#admin-sidebar').classList.remove('is-open');
    $('#sb-overlay').hidden = true;
  }

  async function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#admin-nav [data-tab]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.tab === tab);
    });
    $('#admin-view-title').textContent = TAB_TITLES[tab] || 'Quản trị';
    closeSidebarMobile();

    try {
      if (tab === 'overview') await renderOverview();
      else if (tab === 'users') await renderUsers();
      else if (tab === 'orders') await renderOrders();
      else if (tab === 'topups') await renderTopups();
      else if (tab === 'balances') await renderBalances();
      else if (tab === 'transactions') await renderTransactions();
      else if (tab === 'settings') await renderSettings();
      else if (tab === 'logs') await renderLogs();
    } catch (err) {
      if (err.status === 403) {
        logoutAdmin('Phiên xác thực quản trị không hợp lệ.');
      } else {
        $('#admin-content').innerHTML = `<div class="err">${esc(err.message)}</div>`;
      }
    }
  }

  function logoutAdmin(notice) {
    KEY = '';
    $('#key').value = '';
    $('#admin-app').hidden = true;
    $('#admin-auth').hidden = false;
    $('#auth-msg').innerHTML = notice ? `<div class="okmsg">${esc(notice)}</div>` : '';
  }

  $('#auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const candidate = $('#key').value.trim();
    if (!candidate) return;
    const btn = $('#auth-btn');
    btn.disabled = true;
    btn.textContent = 'Đang xác thực...';
    KEY = candidate;
    try {
      await apiAdmin('/overview');
      $('#auth-msg').innerHTML = '';
      $('#admin-auth').hidden = true;
      $('#admin-app').hidden = false;
      await switchTab('overview');
    } catch (err) {
      KEY = '';
      $('#auth-msg').innerHTML = `<div class="err" role="alert">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Truy cập quản trị';
    }
  });

  $('#admin-nav').addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (btn) switchTab(btn.dataset.tab);
  });

  $('#admin-global-refresh').addEventListener('click', () => {
    switchTab(currentTab).then(() => toast('Đã làm mới dữ liệu'));
  });

  $('#admin-logout').addEventListener('click', () => {
    logoutAdmin('Đã đăng xuất khỏi khu vực quản trị.');
  });

  $('#sb-toggle').addEventListener('click', () => {
    const sb = $('#admin-sidebar');
    const open = !sb.classList.contains('is-open');
    sb.classList.toggle('is-open', open);
    $('#sb-overlay').hidden = !open;
  });

  $('#sb-overlay').addEventListener('click', closeSidebarMobile);
})();
