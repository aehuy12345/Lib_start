# Lỗi thường gặp

Tóm tắt các lỗi đã gặp trong quá trình làm và cách sửa. Nhóm theo loại lỗi; mới nhất ghi kèm mã tính năng.

## Môi trường Windows / shell

- **Không có Python** (2.1.2): `python` trên máy chỉ là alias mở Microsoft Store. → Dùng script Node (`node script.js`) để sửa file hàng loạt.
- **File trong repo dùng CRLF** (2.1.2): tìm-thay chuỗi nhiều dòng (dùng `\n`) không khớp. → Đổi về LF trước khi thay rồi ghi lại đúng kiểu xuống dòng cũ, hoặc dùng công cụ Edit/Write.
- **Heredoc dài trong Git Bash bị lỗi cú pháp** (2.1.2): `unexpected EOF while looking for matching '`, gặp khi nội dung có nhiều backtick/nháy. → Tạo file bằng công cụ Write thay vì `cat <<'EOF'`.
- **Template literal JS trong `node -e "..."` bị Git Bash thực thi** (2.2.5): backtick và `${...}` trong chuỗi nháy kép bị bash coi là command substitution, đoạn code chèn vào file bị mất. → Đoạn code có backtick thì sửa bằng Edit/Write, không chèn qua `node -e`.
- **Escape trong `sed` hỏng script JS** (2.1.2): `\\r\\n` qua `sed` biến thành ký tự xuống dòng thật. → Không dùng `sed` để chèn chuỗi có escape; viết lại file bằng Write hoặc heredoc.
- **Lệnh Bash treo tới hết 120s** (2.2.2): một `cat > file` thừa ở đầu chuỗi lệnh chờ stdin mãi, các lệnh sau không chạy. → Không để `cat` không có input trong chuỗi lệnh; sửa file bằng Edit/Write.
- **`curl -F 'title=Test Sách'` trong Git Bash lưu thành `Test S�ch`** (2.2.2): tham số dòng lệnh có dấu tiếng Việt bị đổi mã trước khi tới server; server và DB không lỗi. → Gửi dữ liệu tiếng Việt qua file JSON (`-d @file.json`), newman hoặc Playwright, không đặt trực tiếp trong tham số curl.

## Server dev / cổng

- **Server cũ còn chạy chiếm cổng 5000** (2.1.2, gặp lại ở 2.1.3 và 2.2.5): process `node src/index.js` từ phiên trước vẫn chạy code cũ nên route mới trả 404 "Không tìm thấy", còn server mới khởi động không báo lỗi. → Trước khi test API, kiểm tra process đang giữ cổng (`netstat -ano | grep :5000`, sau đó `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"`), dừng nó rồi chạy lại.
- **Vite `--strictPort` thất bại vì 5173 đã có dev server** (2.1.2): server đang chạy vẫn dùng được (Vite tự cập nhật code). → Kiểm tra cổng trước, dùng lại server có sẵn.

## Biến môi trường (`server/.env`)

- **Upload ảnh trả 502 khi test API/E2E** (2.1.3): `server/.env` chưa có `SUPABASE_SERVICE_ROLE_KEY`, nên mọi request tới Storage đều lỗi, các phần khác vẫn chạy bình thường. → Trước khi chạy Postman/E2E cho tính năng có upload, kiểm tra `.env` đã có key (`grep -o '^[A-Z_]*=' .env`), rồi khởi động lại server.
- **`.env` bị ghi đè bằng mẫu của `prisma init`, server thoát với `Thiếu JWT_SECRET trong .env`** (2.1.3): lúc điền key mới, file chỉ còn comment của Prisma + `DATABASE_URL` + key, mất `JWT_SECRET`, `JWT_EXPIRES_IN`, `SUPABASE_URL`, `PORT`, `CLIENT_URL`. → Chỉ thêm hoặc sửa từng dòng, không thay cả file. Sau khi sửa, so tên biến với `server/.env.example` (`grep -o '^[A-Z_]*=' .env`).
- **`JWT_SECRET` không lấy ở Supabase** (2.1.3): app tự ký JWT, không dùng Supabase Auth, nên đây là chuỗi ngẫu nhiên tự tạo: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Tạo chuỗi mới chỉ làm các phiên đang mở hết hạn.
- **Auto mode chặn lệnh đọc secret trong `.env`** (2.1.3): lệnh in host/độ dài của `DATABASE_URL`, hoặc chạy script dùng DB để thử kết nối, bị chặn (`Credential Materialization`). → Chỉ xem tên biến (`grep -o '^[A-Z_]*=' .env`); giá trị thì nhờ người dùng tự kiểm tra hoặc tự điền.

## Logic client (React Router / auth)

- **Đăng xuất làm URL bị gắn `?redirect=` của trang cũ** (2.1.2): state chuyển sang `anonymous` thì `RequireAuth` render `<Navigate to="/login?redirect=...">` trước khi `navigate('/login')` của `logout` có hiệu lực, nên người đăng nhập sau bị đưa về trang của người trước. Lỗi do E2E phát hiện. → Thêm cờ `loggedOut` vào AuthContext; `RequireAuth` thấy cờ này thì về `/login` không kèm redirect. Có unit test cho trường hợp này.
- **Validate khi rời ô (`mode: 'onTouched'`) làm cú click nút Lưu bị trượt** (2.1.3): lúc nhấn chuột, ô đang nhập mất focus, dòng lỗi hiện ra đẩy nút xuống, nên lúc nhả chuột con trỏ không còn trên nút và form không submit. Unit test không bắt được vì jsdom không có layout; lỗi do E2E phát hiện. → Form có nhiều lỗi có thể hiện cùng lúc thì validate khi submit (mặc định của `useForm`); việc này cũng đúng với edge 1 của 2.1.3.

## Viết test (Vitest / Playwright)

- **Handler `dialog` đăng ký quá sớm bắt nhầm hộp thoại** (2.2.5): `window.confirm` chỉ hiện sau khi request `delete-check` trả về, nên handler `page.once('dialog', accept)` thứ hai đã được đăng ký trước khi hộp thoại thứ nhất xuất hiện; cả hai cùng xử lý một hộp thoại → `Cannot accept dialog which is already handled`. → Dùng `const dialog = page.waitForEvent('dialog')`, bấm nút, rồi `await (await dialog).dismiss()`.

- **`mockResolvedValue` dùng cho mọi lần gọi làm test URL sai** (2.2.3): mock trả `pagination.page: 2` cho cả lần gọi sau khi đổi bộ lọc, nên trang tự "sửa" URL về `page=2` như thể server chuyển về trang cuối. → Response chỉ dành cho lần tải đầu thì dùng `mockResolvedValueOnce` và đặt trước khi render.

- **Render trang cần đăng nhập mà không bọc `RequireAuth`** (2.1.3): `AuthProvider` đang ở trạng thái `loading` thì `user` là `null`, nên trang crash với `Cannot read properties of null (reading 'name')`. → Trong test, render trang đúng như route thật: `<RequireAuth roles={[...]}><Page /></RequireAuth>`.
- **E2E chuyển trang ngay sau khi bấm Đăng nhập** (2.1.3): `page.goto()` chạy trước khi request login trả về và token được lưu, nên bị chuyển về `/login`. → Sau khi bấm Đăng nhập, đợi `await expect(page).toHaveURL('/reader')` rồi mới `goto`.
- **Seed không dọn hết dữ liệu test** (2.2.2): test trùng tên (edge 5) tạo sách `test sách ...` chữ thường, còn seed lọc `startsWith: 'Test Sách '` có phân biệt hoa thường nên bỏ sót. → Lọc dữ liệu test với `mode: 'insensitive'`; sau khi chạy test, chạy seed lại và xem số bản ghi đã dọn có khớp không.
- **E2E 2.2.1 hỏng khi chạy chung với E2E 2.2.2** (2.2.2): sách mới thêm vào `Test Có Sách` làm số sách khác 1 mà 2.2.1 đang kiểm tra. → Mỗi tính năng ghi dữ liệu vào thể loại test riêng (`Test Thêm Sách`); chạy cả bộ `npx playwright test` trước khi kết luận.
- **`getByRole('banner')` pass trên jsdom nhưng không tìm thấy trên trình duyệt** (2.1.3): `<header>` nằm trong `<main>` thì Chrome không gán role banner. → Không dựa vào role banner; dùng `page.locator('header')` (E2E) hoặc `document.querySelector('header')` (unit).

## Lint

- **oxlint `react(only-export-components)`** (2.1.3): file component export thêm một hàm helper (`applyServerErrors`). → Tách helper ra file `.js` riêng (`features/profile/formErrors.js`).

## Supabase Storage

- **Test "file cũ đã bị xóa" vẫn nhận 200 sau khi xóa** (2.1.3): URL công khai của ảnh đã được fetch một lần trước đó nên CDN của Supabase trả bản cache, dù `storage.objects` không còn file. → Khi kiểm tra file đã xóa, thêm query bỏ cache (`?nocache=<timestamp>`) hoặc truy vấn `storage.objects` qua Supabase MCP.
- **Upload thỉnh thoảng 502 do `UND_ERR_CONNECT_TIMEOUT`** (2.1.3): mạng máy dev tới Supabase chập chờn, timeout sau 10 giây. Server trả 502 và giữ ảnh cũ, đúng thiết kế. → Xem log server trước khi sửa code; nếu là timeout thì chạy lại.

## MCP

- **Playwright MCP không lưu được screenshot vào scratchpad** (2.2.5): `File access denied ... outside allowed roots`; chỉ được ghi trong repo và `.playwright-mcp/`. → Bỏ `filename` (mặc định lưu vào `.playwright-mcp/`, đã gitignore).
- **Trình duyệt của Playwright MCP còn phiên đăng nhập cũ** (2.2.5): localStorage giữ token từ lần trước nên trang `/login` không hiện form, điền `#email` báo không tìm thấy. → Chụp `browser_snapshot` trước khi thao tác; đã đăng nhập thì vào thẳng trang cần test (nhớ kiểm tra đúng vai trò).
- **Postman MCP `getCollections` treo tới khi hết thời gian chờ (300s)** (2.1.2): lệnh đọc không trả kết quả, nhưng `createCollection` vẫn chạy bình thường. → Không chờ lệnh đọc; tạo collection trực tiếp theo workspace ID (`getWorkspaces`). Chạy test API bằng `npx -y newman@6.2.3 run <file>` (cloud của Postman không gọi được localhost).
