# Thiết kế Flow nghiệp vụ

Giai đoạn Design, bước 1/3 (flows, ERD, migrate Supabase). Mỗi tính năng trong `PRD.md` có một file gồm: diagram Mermaid (happy case cùng các nhánh lỗi), bảng edge cases, và mục điểm cần làm rõ.

Quy ước: `[Giả định]` là quyết định tạm của người thiết kế; `[Cần làm rõ]` là chỗ PRD chưa nói rõ, cần người dùng chốt.

## Danh mục

| Mã | Tính năng | File |
|----|-----------|------|
| 2.1.1 | Đăng ký | [2.1.1-dang-ky.md](2.1.1-dang-ky.md) |
| 2.1.2 | Đăng nhập | [2.1.2-dang-nhap.md](2.1.2-dang-nhap.md) |
| 2.1.3 | Hồ sơ cá nhân | [2.1.3-ho-so-ca-nhan.md](2.1.3-ho-so-ca-nhan.md) |
| 2.2.1 | Quản lý thể loại sách | [2.2.1-quan-ly-the-loai-sach.md](2.2.1-quan-ly-the-loai-sach.md) |
| 2.2.2 | Thêm sách mới | [2.2.2-them-sach-moi.md](2.2.2-them-sach-moi.md) |
| 2.2.3 | Xem danh sách sách | [2.2.3-xem-danh-sach-sach.md](2.2.3-xem-danh-sach-sach.md) |
| 2.2.4 | Xem chi tiết sách | [2.2.4-xem-chi-tiet-sach.md](2.2.4-xem-chi-tiet-sach.md) |
| 2.2.5 | Sửa và xóa sách | [2.2.5-sua-xoa-sach.md](2.2.5-sua-xoa-sach.md) |
| 2.3.1 | Mượn sách (độc giả) | [2.3.1-muon-sach-doc-gia.md](2.3.1-muon-sach-doc-gia.md) |
| 2.3.2 | Mượn sách (nhân viên) | [2.3.2-muon-sach-nhan-vien.md](2.3.2-muon-sach-nhan-vien.md) |
| 2.3.3 | Lịch sử mượn và gia hạn | [2.3.3-lich-su-muon-sach.md](2.3.3-lich-su-muon-sach.md) |
| 2.4.1 | Yêu cầu trả sách | [2.4.1-yeu-cau-tra-sach.md](2.4.1-yeu-cau-tra-sach.md) |
| 2.4.2 | Xác nhận trả sách | [2.4.2-xac-nhan-tra-sach.md](2.4.2-xac-nhan-tra-sach.md) |
| 2.5.1 | Quản lý mức phạt | [2.5.1-quan-ly-muc-phat.md](2.5.1-quan-ly-muc-phat.md) |
| 2.5.2 | Thanh toán phạt (độc giả) | [2.5.2-thanh-toan-phat-doc-gia.md](2.5.2-thanh-toan-phat-doc-gia.md) |
| 2.5.3 | Xác nhận thanh toán phạt (nhân viên) | [2.5.3-thanh-toan-phat-nhan-vien.md](2.5.3-thanh-toan-phat-nhan-vien.md) |
| 2.6.1 | Danh sách người dùng | [2.6.1-danh-sach-nguoi-dung.md](2.6.1-danh-sach-nguoi-dung.md) |
| 2.6.2 | Gán vai trò | [2.6.2-gan-vai-tro.md](2.6.2-gan-vai-tro.md) |
| 2.7.1 | Dashboard tổng quan | [2.7.1-dashboard-tong-quan.md](2.7.1-dashboard-tong-quan.md) |
| 2.7.2 | Báo cáo chi tiết | [2.7.2-bao-cao-chi-tiet.md](2.7.2-bao-cao-chi-tiet.md) |

## Quyết định đã chốt (2026-10-21)

Người dùng đã **duyệt toàn bộ flows** và **đồng ý mọi `[Giả định]` cùng các đề xuất** trong các file flow và danh sách dưới đây. ERD phải tuân theo các đề xuất này. Riêng điểm 1: xác nhận qua email, Admin vẫn kích hoạt thủ công được.

Các điểm ảnh hưởng trực tiếp tới schema:

1. **Xác nhận tài khoản** (2.1.1): ai xác nhận, qua kênh nào (email hay Admin)? Ảnh hưởng enum `status` và bảng token xác thực.
2. **Soft delete** (2.2.5, 2.5.1): sách và mức phạt đã dùng nên soft delete để giữ lịch sử. Đề xuất: có.
3. **Quản lý kho** (2.2.2, 2.4.2): bộ đếm `total/available/borrowed` trên sách, hay từng bản vật lý riêng? Đề xuất: bộ đếm. Sách hư hỏng có trở lại `available` không?
4. **Trạng thái đơn mượn** (2.3.2 và 2.3.3): thống nhất `Chờ xác nhận`, `Đang mượn`, `Đã trả`, `Bị từ chối`; `Quá hạn` suy ra từ hạn trả.
5. **Mức phạt** (2.5.1): bỏ trường "Ngày phạt" khỏi mức phạt; thêm cột phân loại (trả muộn, hư hỏng, mất)? Phiếu phạt phải lưu bản sao số tiền.
6. **Yêu cầu trả bị từ chối, hủy đơn mượn chờ xác nhận** (2.3.1, 2.4.1): PRD không có, đề xuất bổ sung trạng thái.
7. **Phiếu phạt** (2.5.2): có đính kèm ảnh biên lai (Supabase Storage) không?
8. **Chặn mượn khi đang có sách quá hạn** (2.3.1): ngoài chặn khi còn phiếu phạt?
9. **Phí trả muộn khi Mất** (2.4.2) và cách tính (mức cố định hay theo ngày).
10. **Trả sách trực tiếp tại quầy** không qua yêu cầu của độc giả (2.4.2).
