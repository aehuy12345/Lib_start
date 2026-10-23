# Lỗi thường gặp

Tóm tắt các lỗi đã gặp trong quá trình làm và cách sửa. Nhóm theo loại lỗi; mới nhất ghi kèm mã tính năng.

## Môi trường Windows / shell

- **Không có Python** (2.1.2): `python` trên máy chỉ là alias mở Microsoft Store. → Dùng script Node (`node script.js`) để sửa file hàng loạt.
- **File trong repo dùng CRLF** (2.1.2): tìm-thay chuỗi nhiều dòng (dùng `\n`) không khớp. → Đổi về LF trước khi thay rồi ghi lại đúng kiểu xuống dòng cũ, hoặc dùng công cụ Edit/Write.
- **Heredoc dài trong Git Bash bị lỗi cú pháp** (2.1.2): `unexpected EOF while looking for matching '`, gặp khi nội dung có nhiều backtick/nháy. → Tạo file bằng công cụ Write thay vì `cat <<'EOF'`.
- **Escape trong `sed` hỏng script JS** (2.1.2): `\\r\\n` qua `sed` biến thành ký tự xuống dòng thật. → Không dùng `sed` để chèn chuỗi có escape; viết lại file bằng Write hoặc heredoc.

## Server dev / cổng

- **Server cũ còn chạy chiếm cổng 5000** (2.1.2): process `node src/index.js` từ phiên trước vẫn chạy code cũ nên route mới trả 404 "Không tìm thấy", còn server mới khởi động không báo lỗi. → Trước khi test API, kiểm tra process đang giữ cổng (`netstat -ano | grep :5000`, sau đó `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"`), dừng nó rồi chạy lại.
- **Vite `--strictPort` thất bại vì 5173 đã có dev server** (2.1.2): server đang chạy vẫn dùng được (Vite tự cập nhật code). → Kiểm tra cổng trước, dùng lại server có sẵn.

## Logic client (React Router / auth)

- **Đăng xuất làm URL bị gắn `?redirect=` của trang cũ** (2.1.2): state chuyển sang `anonymous` thì `RequireAuth` render `<Navigate to="/login?redirect=...">` trước khi `navigate('/login')` của `logout` có hiệu lực, nên người đăng nhập sau bị đưa về trang của người trước. Lỗi do E2E phát hiện. → Thêm cờ `loggedOut` vào AuthContext; `RequireAuth` thấy cờ này thì về `/login` không kèm redirect. Có unit test cho trường hợp này.

## MCP

- **Postman MCP `getCollections` treo tới khi hết thời gian chờ (300s)** (2.1.2): lệnh đọc không trả kết quả, nhưng `createCollection` vẫn chạy bình thường. → Không chờ lệnh đọc; tạo collection trực tiếp theo workspace ID (`getWorkspaces`). Chạy test API bằng `npx -y newman@6.2.3 run <file>` (cloud của Postman không gọi được localhost).
