# Kho Nick (web con)

## Chạy trên máy (không cần cd)

- **Windows:** bấm đúp `chay.bat`.
- **macOS / Linux:** bấm đúp hoặc chạy `chay.command`.

Lần đầu file tự tạo `.env` từ `.env.example`, chạy web và mở trình duyệt. Cần cài Node.js 18 trở lên (https://nodejs.org).
Cách khác, từ bất kỳ thư mục nào: `node đường\dẫn\tới\server.js`.

Mở ADMIN_KEY trong `.env` để dùng trang duyệt nạp tiền tại `/admin`.

## Cấu trúc (mỗi trang một file)

```
server.js            máy chủ + API
mother.js            chỗ nối API web mẹ (tìm "ĐIỀN VÀO ĐÂY")
.env                 cấu hình và khóa bí mật (không đưa lên mạng)
partials/header.html menu chung, sửa một chỗ đổi mọi trang
partials/footer.html chân trang chung
public/
  index.html         Trang chủ (/)
  don-hang.html      Đơn hàng (/don-hang)
  nap-tien.html      Nạp tiền (/nap-tien)
  dang-nhap.html     Đăng nhập
  dang-ky.html       Đăng ký
  admin.html         Duyệt nạp tiền (/admin)
  css/style.css      toàn bộ giao diện và hiệu ứng
  js/common.js       hàm dùng chung
  js/home.js, orders.js, topup.js, auth.js, admin.js   mỗi trang một file
```

- Thêm menu: sửa `partials/header.html`.
- Đổi giá, số like tối thiểu, tài khoản nhận tiền: sửa `.env`, chạy lại.
- Địa chỉ đẹp: `/don-hang` thay vì `/don-hang.html`.

## SEO

Mỗi trang có title, description, Open Graph, `lang="vi"`, một thẻ h1. Trang riêng tư (đơn hàng, nạp tiền, đăng nhập, admin) để `noindex`.
`/robots.txt` và `/sitemap.xml` tự sinh. Khi đưa lên tên miền, điền `SITE_URL=https://tenmien.com` trong `.env` để canonical và sitemap đúng.

## Nối web mẹ

Điền `MOTHER_API_URL`, `MOTHER_API_KEY` trong `.env` và 3 hàm `createOrder`, `getStatus`, `cancelOrder` trong `mother.js`. Khóa chỉ để trong `.env`, không viết vào HTML hay gửi cho ai.
