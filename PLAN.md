# 📝 Dự án Quiz Game - Kế hoạch & Tiến độ

## ✅ Những việc đã hoàn thành (Done)

### 1. Hệ thống Thử nghiệm (Testing System)
- [x] **One-Click Testing**: Tạo 2 đường dẫn trực tiếp (Quiz, Puzzle) trong Admin Panel (Đã loại bỏ Obstacle).
- [x] **Ephemeral Rooms**: Cơ chế tự động tạo phòng tạm thời (prefix `TEST_`) khi truy cập link test, không cần Admin tạo thủ công.
- [x] **Auto-Simulation**: Tự động hóa luồng chơi cho tester (tự đếm ngược, tự chuyển câu hỏi trong vòng Quiz).
- [x] **Randomized Subset**: Tự động chọn ngẫu nhiên 4 câu hỏi (vòng Quiz) từ bộ đề gốc để test nhanh.
- [x] **Bypass Flow**: Tester vào thẳng phòng chờ, có nút "Bắt đầu ngay" để kích hoạt game mà không cần nhập tên/chọn logo.
- [x] **Test Replay**: Thêm nút "Chơi lại" ở màn hình kết quả cuối cùng cho các phiên test.

### 2. Quản lý Dữ liệu & Đề thi
- [x] **Real-time Setup**: Trang Setup luôn đọc dữ liệu câu hỏi mới nhất trực tiếp từ file `quizdata.json`.
- [x] **Bộ đề mẫu**: Cập nhật bộ đề câu hỏi chất lượng cao, hỗ trợ hình ảnh minh họa sinh động.
- [x] **Xáo trộn đề**: Tích hợp thuật toán Fisher-Yates để xáo trộn câu hỏi mỗi khi bắt đầu phiên thi đấu chính thức hoặc test.

### 3. Cải thiện độ ổn định (Stability) & Luồng điều khiển
- [x] **Fix Crash**: Xử lý lỗi `TypeError` bằng các chốt chặn (Guard Clauses) khi người chơi thoát game đột ngột.
- [x] **Defensive Socket Logic**: Kiểm tra trạng thái kết nối socket trước khi gửi các sự kiện tự động trong chế độ test.
- [x] **Case-Insensitive Rooms**: Sửa lỗi không tìm thấy phòng khi nhập mã hoặc ID không đúng định dạng hoa/thường.
- [x] **Unified Control (Next-Only)**: Thay thế cụm nút chọn vòng bằng một nút "Tiếp theo" duy nhất và thông minh, tự động chuyển đổi giữa Câu hỏi, Bảng xếp hạng và các Vòng thi.
- [x] **Admin Logic Update**: Tối ưu hóa luồng Đăng nhập và Kết nối lại cho Admin, đảm bảo không bị hiện màn hình trắng khi mất phiên làm việc.

### 4. Tối ưu hóa Luồng chơi & Dọn dẹp (Streamlining)
- [x] **Loại bỏ vòng Chướng ngại vật**: Xóa bỏ hoàn toàn mã nguồn, giao diện và logic liên quan đến vòng chướng ngại vật để tập trung vào Quiz và Puzzle (đúng tinh thần 1 game 2 giai đoạn).
- [x] **Cập nhật Luồng Admin**: Nút "Next Step" tự động chuyển từ bảng xếp hạng câu hỏi cuối cùng của Quiz sang trực tiếp vòng Puzzle.
- [x] **Làm sạch Codebase**: 
    - Xóa các thư mục kiến trúc cũ/rỗng (`routes`, `services`, `repositories`).
    - Xóa các biến/thuộc tính dư thừa (`revealedHints`, `hint` trong câu hỏi).
    - Tối ưu hóa imports và logic server.
- [x] **Cải tiến Tính điểm**: Cập nhật công thức tính điểm (Scoring) tỷ lệ nghịch với thời gian trả lời dựa trên `maxPoints`, đảm bảo tính công bằng và chuyên nghiệp.

## 🚀 Những việc nên làm tiếp theo (To-Do / Backlog)

### 1. Tính năng Nâng cao (Features)
- [ ] **Multi-Admin Support**: Cho phép nhiều admin cùng quản lý một phòng thi (hiện tại chỉ support 1 admin chính).
- [ ] **Team Mode**: Thêm chế độ thi đấu theo đội (hiện tại đang là cá nhân - mỗi socket là 1 thí sinh).
- [ ] **Background Music**: Thêm nhạc nền động cho từng vòng chơi (Quiz hồi hộp, Puzzle thư giãn).

### 2. Trải nghiệm Người dùng (UX/UI)
- [ ] **Dark Mode Toggle**: Cho phép chuyển đổi giao diện Sáng/Tối linh hoạt.
- [ ] **Mobile Admin**: Tối ưu giao diện Admin để có thể điều khiển trận đấu mượt mà trên điện thoại.
- [ ] **Lobby Mini-games**: Thêm các trò chơi nhỏ trong lúc chờ đợi thí sinh tham gia đủ (VD: quay số may mắn).

### 3. Kỹ thuật & Hạ tầng (DevOps)
- [ ] **Database Integration**: Chuyển đổi từ file JSON sang một Database thực thụ (SQLite hoặc MongoDB) nếu số lượng đề thi và lịch sử trận đấu tăng lên lớn.
- [ ] **Rate Limiting**: Thêm giải pháp chống spam request ở trang Setup và API upload ảnh.
- [ ] **Unit Testing**: Viết các bản test tự động cho logic tính điểm và xáo trộn đề thi.

---
*Cập nhật lần cuối: 28/03/2026 (11:35 AM)*
