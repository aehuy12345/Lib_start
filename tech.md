# Tech stack — danh sách kiểm tra

Nguồn: PRD Phần 4 + quy trình implement trong `CLAUDE.md`. Cập nhật lần cuối: **2026-10-22** trên máy dev (Windows 10).

Ký hiệu: ✅ đã có · ❌ còn thiếu · ⚠️ cần người dùng thao tác · ➖ tùy chọn

## 1. Công cụ trên máy

| Công cụ | Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|---|
| Node.js | v18+ (PRD) | ✅ v24.21.0 | Đạt yêu cầu |
| npm / npx | đi kèm Node | ✅ 11.19.0 | npm 11 chặn install script chưa duyệt; đã duyệt `prisma`, `@prisma/engines` |
| Git | Version control (PRD) | ✅ 2.55.0 | Đã có repo, nhánh `main`, remote `origin` → GitHub, chưa có commit. Đã cấu hình `user.name` / `user.email` |
| GitHub CLI (`gh`) | Repo + GitHub Actions | ✅ 2.102.0 | Đã đăng nhập (`aehuy12345`) |
| Playwright Chromium | E2E test | ✅ | Đã cài qua `npx playwright install chromium` |
| Google Chrome | Playwright MCP (mặc định dùng Chrome) | ✅ | |
| Supabase CLI | Migration/dev local | ➖ ❌ | Không bắt buộc vì dùng Supabase MCP |
| Vercel CLI | Deploy | ➖ ❌ | Có thể deploy qua GitHub integration |
| psql, Docker | — | ➖ ❌ | Không bắt buộc |

## 2. MCP server (`.mcp.json`)

| MCP | Dùng cho | Trạng thái | Ghi chú |
|---|---|---|---|
| Supabase | Migration, DB | ✅ Connected | Tài khoản **chưa có project nào** |
| Context7 | Tra tài liệu thư viện | ✅ Connected | |
| Playwright (`npx @playwright/mcp@latest`) | E2E test | ✅ Connected | |
| Postman (`https://mcp.postman.com/mcp`) | API test | ✅ Connected | Đã đăng nhập OAuth qua `/mcp` |

## 3. Tài khoản / dịch vụ

| Dịch vụ | Dùng cho | Trạng thái |
|---|---|---|
| Supabase project | PostgreSQL + file storage | ❌ Chưa tạo (sau khi ERD được duyệt) |
| GitHub repo | Lưu code + CI/CD | ❌ Chưa tạo |
| Vercel | Hosting | ❌ Chưa kết nối (cần trước giai đoạn Deployment) |
| Postman | Tài khoản cho Postman MCP | ✅ Đã đăng nhập |

## 4. Thư viện đã cài

### Frontend — `client/` (Vite + React, JavaScript)
| Thư viện | Phiên bản | Vai trò |
|---|---|---|
| react, react-dom | 19.3 | Framework (state dùng Context API có sẵn) |
| vite, @vitejs/plugin-react | 8.3 | Build tool `[Giả định]` |
| tailwindcss, @tailwindcss/vite | 4.3 | Styling (v4, cấu hình qua plugin Vite, `@import "tailwindcss"`) |
| axios | 1.20 | HTTP client |
| react-hook-form | 7.90 | Form |
| dayjs | 1.11 | Xử lý ngày |
| recharts | 3.10 | Biểu đồ báo cáo |
| react-router-dom | 7.18 | Router `[Giả định]` |
| vitest, jsdom, @testing-library/react, jest-dom, user-event | — | Unit test `[Giả định]` |
| @playwright/test | 1.64 | E2E test |
| oxlint | 1.88 | Lint (đi kèm template Vite) |

### Backend — `server/` (Express, JavaScript CommonJS)
| Thư viện | Phiên bản | Vai trò |
|---|---|---|
| express | 5.3 | Framework |
| prisma, @prisma/client | 7.10.1 (ghim) | ORM. Tag `latest` trên npm đang là 8.0.0-rc nên ghim bản ổn định 7.10.1 |
| @prisma/adapter-pg | 7.10.1 | Driver adapter PostgreSQL (Prisma 7 bắt buộc) |
| joi | 18.3 | Validation |
| jsonwebtoken | 9.0 | JWT, phiên 24h |
| bcryptjs | 3.0 | Hash mật khẩu `[Giả định]`. Dùng bản JS thuần thay cho `bcrypt` (bản native cần build tools trên Windows) |
| @supabase/supabase-js | 2.118 | Upload file lên Supabase Storage |
| cors, dotenv | — | CORS, biến môi trường |
| vitest, supertest | — | Unit test + test API nội bộ `[Giả định]` |
| nodemon | 3.1 | Chạy dev |

Ghi chú Prisma: dùng generator `prisma-client-js` vì generator mặc định của Prisma 7 (`prisma-client`) sinh file TypeScript, không hợp với backend JS thuần. Cấu hình kết nối nằm trong `server/prisma.config.ts`; `schema.prisma` chưa có model (chờ ERD được duyệt).

## 5. Việc còn lại (cần người dùng)

1. Commit đầu tiên + push lên GitHub: repo local đã nối `origin` → `https://github.com/aehuy12345/Lib_start.git` (public, còn trống), nhánh chính đã đổi thành `main`, nhưng chưa có commit. Cần làm trước nhánh feature đầu tiên / CI.
2. Tạo Supabase project sau khi ERD được duyệt, rồi điền `server/.env`. ⚠️ `server/.env` hiện là template do `prisma init` sinh ra: chỉ có `DATABASE_URL` giá trị mẫu, **thiếu** `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — chép lại từ `server/.env.example`.
3. Kết nối Vercel trước giai đoạn Deployment.

## 6. Còn thiếu, làm khi tới giai đoạn tương ứng

| Hạng mục | Khi nào | Ghi chú |
|---|---|---|
| `DIRECT_URL` cho Supabase | Lúc migrate | Supabase có connection pooler (port 6543) và kết nối trực tiếp (5432). App trên Vercel nên dùng pooler, Prisma migrate cần kết nối trực tiếp `[Giả định]`. Thêm biến vào `.env.example` khi tạo project |
| CI/CD — `.github/workflows/` | Khi có repo GitHub | Chưa có workflow nào (PRD yêu cầu GitHub Actions): lint + unit test client/server, có thể thêm Playwright |
| Cấu hình deploy Express lên Vercel | Giai đoạn Deployment | Cần `vercel.json` hoặc export `app` làm serverless function; client và server có thể là 2 project Vercel |
| File storage (Supabase Storage) | `[Cần làm rõ]` | PRD Phần 4 nêu Supabase File Storage nhưng không tính năng nào ở Phần 2 có upload file (sách không có ảnh bìa, thanh toán phạt không có ảnh chứng từ). Nếu cần upload thì thêm `multer`; nếu không thì có thể bỏ `@supabase/supabase-js` |
| Xuất CSV (2.6.x) | Phase 6 | Không cần thêm thư viện; nhớ thêm BOM UTF-8 để Excel đọc đúng tiếng Việt |

## Lệnh kiểm tra lại

```bash
node --version; npm --version; git --version; gh auth status
claude mcp list
cd client && npm run build && npm test && npm run test:e2e
cd server && npm test && npx prisma validate
```
