'use strict';
/* Trang chủ: hiện giá từ cấu hình máy chủ vào thẻ dịch vụ. */
(async function () {
  if (!(await initPage('any'))) return;
  $('#price').textContent = `${fmt(r2(CONFIG.rate * CONFIG.minLikes))} / ${nf(CONFIG.minLikes)} like`;
})();
