# Hướng Dẫn Sử Dụng - Quiz Game

## Giới thiệu

Quiz Game là ứng dụng thi đấu kiến thức trực tuyến theo phong cách Kahoot, phục vụ các sự kiện, cuộc thi với nhiều thí sinh cùng lúc. Admin điều khiển trên màn hình lớn (LED sân khấu), thí sinh tham gia qua điện thoại hoặc iPad.

---

## Các vai trò

| Vai trò | Mô tả | Thiết bị |
|---------|--------|----------|
| **Người tổ chức (Admin)** | Tạo câu hỏi, điều khiển game, hiển thị trên màn hình lớn | Máy tính / Laptop |
| **Thí sinh (Player)** | Tham gia trả lời câu hỏi | Điện thoại / iPad / Tablet |

---

## Bước 1: Tạo bộ câu hỏi

### Truy cập trang Setup

1. Mở trình duyệt, truy cập: **http://103.57.222.162:8000/setup**
2. Đăng nhập bằng tài khoản admin (trình duyệt sẽ hiện popup yêu cầu nhập tài khoản & mật khẩu)

### Thêm câu hỏi

1. Ở tab **"Câu hỏi"** bên trái, bấm nút **"Thêm câu hỏi"**
2. Chọn loại câu hỏi:
   - **Trắc nghiệm**: 4 đáp án, chọn 1 đáp án đúng
   - **Đúng/Sai**: 2 lựa chọn Đúng hoặc Sai
   - **Tự luận**: Thí sinh gõ đáp án
3. Điền nội dung câu hỏi
4. Đánh dấu đáp án đúng
5. Tuỳ chỉnh:
   - **Thời gian**: 5 - 120 giây (mặc định 15 giây)
   - **Điểm tối đa**: điểm cho người trả lời đúng nhanh nhất (mặc định 1000)
   - **Hình ảnh**: upload ảnh minh hoạ (tuỳ chọn)
   - **Gợi ý**: gợi ý cho vòng chướng ngại vật (tuỳ chọn)
6. Bấm **"Lưu"**

### Cài đặt chướng ngại vật (tuỳ chọn)

Chướng ngại vật là vòng bonus sau khi hết các câu hỏi chính. Thí sinh được xem các gợi ý đã mở (từ những câu trả lời đúng) để đoán một cụm từ bí ẩn.

1. Chuyển sang tab **"Chướng ngại vật"**
2. Bật công tắc **"Bật chướng ngại vật"**
3. Nhập câu hỏi (VD: "Đây là gì?")
4. Nhập đáp án (VD: "VIỆT NAM")
5. Cài đặt thời gian và điểm thưởng

### Lưu và tạo phòng thi

1. Bấm **"Lưu tất cả"** để lưu bộ câu hỏi
2. Bấm **"Tạo phòng thi"** → hệ thống tạo phòng với mã 6 ký tự (VD: `A1B2C3`)
3. Ghi lại **mã phòng** và **link Admin** hiển thị trên màn hình

---

## Bước 2: Mở phòng thi (Admin)

### Truy cập trang Admin

1. Mở trình duyệt trên máy tính nối màn hình LED/projector
2. Truy cập: **http://103.57.222.162:8000/admin?room=MÃ_PHÒNG**
   (hoặc dùng link Admin từ bước tạo phòng)
3. Đăng nhập bằng tài khoản admin

### Màn hình Lobby (phòng chờ)

Sau khi đăng nhập, bạn sẽ thấy:
- **Mã phòng** hiển thị lớn
- **QR code** để thí sinh quét nhanh
- **Danh sách thí sinh** đang vào phòng (cập nhật liên tục)
- **Số lượng thí sinh** hiện tại

Chờ tất cả thí sinh vào phòng, sau đó bấm **"Bắt đầu"**.

---

## Bước 3: Thí sinh tham gia

### Cách 1: Quét QR code
- Dùng camera điện thoại/iPad quét mã QR trên màn hình lớn
- Trình duyệt tự động mở trang tham gia

### Cách 2: Nhập thủ công
1. Mở trình duyệt, truy cập: **http://103.57.222.162:8000/player**
2. Nhập **mã phòng** (6 ký tự, VD: `A1B2C3`)
3. Nhập **tên** của mình
4. Bấm **"Vào thi"**

### Lưu ý cho thí sinh
- Tên tối đa 30 ký tự
- Giữ màn hình luôn bật, không tắt trình duyệt
- Nếu bị mất kết nối, hệ thống sẽ tự động kết nối lại

---

## Bước 4: Diễn biến cuộc thi

### Luồng mỗi câu hỏi

```
Đếm ngược 3 giây → Hiện câu hỏi → Thí sinh trả lời → Kết quả → Bảng xếp hạng
```

#### Trên màn hình lớn (Admin)
1. **Đếm ngược 3-2-1** trước mỗi câu hỏi
2. **Hiển thị câu hỏi** với 4 ô đáp án màu sắc (đỏ, xanh, vàng, xanh lá) và đồng hồ đếm ngược
3. **Kết quả**: biểu đồ thống kê số người chọn mỗi đáp án, đáp án đúng được đánh dấu
4. **Bảng xếp hạng**: top 3 trên podium + danh sách từ hạng 4

#### Trên thiết bị thí sinh
1. **Đọc câu hỏi** trên màn hình lớn
2. **Chọn đáp án** bằng cách bấm vào ô màu tương ứng
3. **Xem kết quả**: đúng (xanh ✓ + điểm) hoặc sai (đỏ ✗ + đáp án đúng)
4. **Xem xếp hạng** hiện tại

### Cách tính điểm
- Trả lời **đúng và nhanh** = điểm cao hơn
- Trả lời đúng ngay lập tức: **100%** điểm tối đa
- Trả lời đúng ở giữa thời gian: **~75%** điểm
- Trả lời đúng sát hết giờ: **~50%** điểm
- Trả lời sai hoặc hết giờ: **0 điểm**

### Điều khiển game (Admin)

| Nút | Chức năng |
|-----|-----------|
| **Bắt đầu** | Bắt đầu câu hỏi đầu tiên |
| **Kết thúc sớm** | Dừng đồng hồ, chuyển sang kết quả |
| **Bảng xếp hạng** | Hiện bảng xếp hạng giữa trận |
| **Câu tiếp theo** | Chuyển sang câu hỏi tiếp |
| **Theo dõi** | Mở panel xem thí sinh nào đã/chưa trả lời |

---

## Bước 5: Chướng ngại vật (nếu có)

Sau câu hỏi cuối cùng, nếu đã bật chướng ngại vật:

1. Màn hình lớn hiện **câu hỏi chướng ngại vật** + các **gợi ý đã mở**
2. Các gợi ý được mở từ những câu hỏi mà thí sinh trả lời đúng trước đó
3. Thí sinh **gõ đáp án** vào ô nhập trên thiết bị của mình
4. Trả lời đúng được **cộng điểm thưởng**
5. Admin bấm **"Kết thúc"** khi muốn dừng

---

## Bước 6: Kết quả cuối cùng

### Trên màn hình lớn
- **Podium top 3** với hiệu ứng đặc biệt
- Danh sách xếp hạng đầy đủ

### Xuất kết quả Excel
1. Bấm nút **"Xuất Excel"** trên màn hình kết quả
2. File `.xlsx` sẽ được tải về, gồm:
   - **Sheet 1 - Bảng xếp hạng**: hạng, tên, điểm, số câu đúng
   - **Sheet 2 - Chi tiết**: từng câu hỏi, đáp án mỗi thí sinh chọn, đúng/sai, thời gian, điểm

---

## Câu hỏi thường gặp

### Thí sinh bị mất kết nối thì sao?
Hệ thống tự động kết nối lại. Thí sinh sẽ quay lại đúng màn hình hiện tại mà không mất điểm đã có.

### Có giới hạn số thí sinh không?
Hệ thống thiết kế cho khoảng **30 thí sinh** đồng thời. Có thể hỗ trợ nhiều hơn tuỳ cấu hình server.

### Thí sinh có thể dùng thiết bị gì?
Bất kỳ thiết bị nào có trình duyệt web: điện thoại, iPad, tablet, laptop. Khuyến nghị dùng **iPad hoặc tablet** để có trải nghiệm tốt nhất.

### Có cần cài ứng dụng không?
**Không.** Tất cả chạy trên trình duyệt web, không cần cài đặt gì thêm.

### Các thiết bị có cần kết nối cùng mạng WiFi không?
**Có.** Tất cả thiết bị (máy admin, iPad thí sinh) cần kết nối được tới server. Nếu server chạy trên mạng nội bộ thì cần cùng mạng WiFi. Nếu server đã deploy public thì chỉ cần có internet.

### Đồng hồ đếm ngược có đồng bộ giữa các thiết bị không?
**Có.** Hệ thống sử dụng cơ chế đồng bộ thời gian (NTP-style) để đảm bảo đồng hồ trên tất cả thiết bị hiển thị giống nhau, sai lệch tối đa chỉ vài mili-giây.

### Làm sao để chơi lại?
Admin bấm nút **"Chơi lại"** trên màn hình kết quả cuối cùng. Tất cả điểm số sẽ được reset, thí sinh không cần thoát ra vào lại.

---

## Checklist trước khi tổ chức

- [ ] Đã tạo đủ bộ câu hỏi trên trang Setup
- [ ] Đã test thử 1-2 câu hỏi với vài thiết bị
- [ ] Máy tính admin đã kết nối màn hình LED / projector
- [ ] Tất cả iPad/thiết bị thí sinh đã kết nối WiFi
- [ ] Đã tạo phòng thi và ghi lại mã phòng
- [ ] Âm thanh loa đã bật (game có hiệu ứng âm thanh)
- [ ] Đã chuẩn bị QR code hoặc link cho thí sinh quét/nhập
