# Quiz Game - Tài liệu kỹ thuật chi tiết

## Tổng quan

Ứng dụng Quiz Game là một hệ thống thi đấu kiến thức thời gian thực, lấy cảm hứng từ Kahoot. Được thiết kế để phục vụ cuộc thi với khoảng 30 thí sinh trên iPad, admin điều khiển trên màn hình LED sân khấu.

## 📝 Nhật ký cập nhật (Tháng 3/2026)

### Loại bỏ vòng "Vượt chướng ngại vật"
- **Đơn giản hóa luồng chơi**: Cấu trúc game rút gọn còn 2 giai đoạn chính: **Vòng Quiz (Trắc nghiệm)** và **Vòng Xếp hình (Puzzle)**.
- **Tự động hóa điều hướng**: Admin có thể chuyển trực tiếp từ bảng xếp hạng câu hỏi cuối cùng sang vòng Xếp hình chỉ bằng một lần nhấn nút.
- **Giao diện sạch sẽ**: Loại bỏ các tab và trường dữ liệu không còn sử dụng (như Gợi ý, Chướng ngại vật) trong trang Setup và Player.
- **Tối ưu Backend**: Xóa bỏ các sự kiện socket dư thừa (`admin:startObstacle`, `player:obstacleAnswer`) giúp server nhẹ hơn.

### Cải tiến hệ thống điểm (Authoritative Scoring)
- **Công thức mới**: Điểm số được tính toán chính xác dựa trên tỷ lệ thời gian còn lại so với tổng thời gian, đảm bảo công bằng tuyệt đối.
- **Đồng bộ thời gian**: Hệ thống NTP-style đảm bảo mọi thí sinh thấy cùng một mốc thời gian server, tránh sai số do độ trễ mạng.

---

**Công nghệ:**
- **Backend:** Node.js + Express 5 + Socket.io 4
- **Frontend:** Vanilla HTML/CSS/JS (không framework)
- **Giao tiếp thời gian thực:** Socket.io (WebSocket)
- **Lưu trữ dữ liệu:** JSON file (`data/quizdata.json`)

---

## Cấu trúc thư mục

```
demo/
├── server.js              # Server chính (Express + Socket.io)
├── package.json           # Dependencies và scripts
├── note.md                # Ghi chú yêu cầu ban đầu
├── data/
│   └── quizdata.json      # Dữ liệu quiz (tự động tạo)
├── public/
│   ├── index.html         # Trang chủ - điều hướng
│   ├── setup.html         # Trang quản lý câu hỏi + tạo phòng
│   ├── admin.html         # Trang admin (màn hình LED)
│   ├── player.html        # Trang thí sinh (iPad)
│   ├── puzzle.html        # Game xếp hình độc lập
│   ├── css/
│   │   ├── style.css      # CSS chính (Kahoot theme)
│   │   └── setup.css      # CSS riêng cho trang setup
│   ├── js/
│   │   ├── admin.js       # Logic admin
│   │   ├── player.js      # Logic thí sinh
│   │   ├── puzzle.js      # Logic game xếp hình
│   │   └── setup.js       # Logic CRUD câu hỏi
│   └── uploads/           # Ảnh upload (tự động tạo)
```

---

## Luồng hoạt động chính

```
Setup (tạo câu hỏi) → Tạo phòng → Admin mở phòng → Thí sinh quét QR/nhập mã
     ↓                                ↓                      ↓
  Lưu dữ liệu              Hiển thị lobby + QR       Nhập tên + mã phòng
                                    ↓                      ↓
                              Bắt đầu game   ←──────   Chờ trong lobby
                                    ↓
                    Countdown 3s → Hiển câu hỏi → Thí sinh trả lời
                                    ↓
                    Kết quả câu hỏi → Bảng xếp hạng → Câu tiếp theo
                                    ↓
                    (Lặp lại cho đến hết câu hỏi)
                                    ↓
                    Kết quả cuối → Xuất Excel
```

---

## 1. Server (`server.js`)

### 1.1 Dependencies

| Package    | Mục đích                           |
|------------|-------------------------------------|
| express@5  | Web server + API routes             |
| socket.io  | Giao tiếp thời gian thực            |
| multer     | Upload hình ảnh                     |
| xlsx       | Xuất kết quả ra file Excel          |
| qrcode     | Tạo mã QR cho phòng thi             |

### 1.2 API Routes

| Method | Endpoint                    | Mô tả                              |
|--------|-----------------------------|------------------------------------|
| GET    | `/api/quiz`                 | Lấy dữ liệu quiz hiện tại          |
| POST   | `/api/quiz`                 | Lưu dữ liệu quiz (JSON body)       |
| POST   | `/api/upload`               | Upload hình ảnh (multipart form)   |
| POST   | `/api/room`                 | Tạo phòng thi mới, trả về `{code}` |
| GET    | `/api/room/:code`           | Lấy thông tin phòng                |
| GET    | `/api/room/:code/qr`        | Lấy QR code (base64 data URL)      |
| GET    | `/api/room/:code/export`    | Tải file Excel kết quả             |

### 1.3 Clean URL Routing

```
/           → index.html
/admin      → admin.html
/player     → player.html
/puzzle     → puzzle.html
/setup      → setup.html
```

Xử lý bằng middleware rewrite trước `express.static`, không dùng `sendFile` (tránh lỗi Express 5 + Node 24 với đường dẫn tương đối).

### 1.4 Kiến trúc Room

Mỗi cuộc thi là một "room" độc lập:

```javascript
rooms[code] = {
  code,                    // Mã phòng (6 ký tự, VD: "A1B2C3")
  phase,                   // Trạng thái: lobby|countdown|question|result|ranking|puzzle|final
  quizData,                // Dữ liệu quiz của phòng này
  currentQuestionIndex,    // Câu hỏi hiện tại (-1 = chưa bắt đầu)
  questionStartTime,       // Timestamp bắt đầu câu hỏi (tính điểm)
  players: {},             // {socketId: {name, score, streak, ...}}
  answers: {},             // {socketId: {option, time, correct, points}}
  timerInterval,           // setInterval ID cho đồng hồ đếm ngược
  timeLeft,                // Thời gian còn lại
  gameHistory: []          // Lịch sử câu trả lời (để xuất Excel)
}
```

### 1.5 Socket.io Events

**Client → Server:**

| Event           | Dữ liệu                    | Mô tả                     |
|-----------------|----------------------------|---------------------------|
| `player:join`   | `{roomCode, name}`         | Thí sinh tham gia phòng   |
| `admin:auth`    | `{password, roomCode}` + cb| Xác thực admin (callback) |
| `admin:join`    | `{roomCode, token}`        | Admin vào phòng (có token)|
| `time:sync`     | `{t0}`                     | Bắt đầu đồng bộ thời gian |
| `player:answer` | `{option}` hoặc `{text}`   | Thí sinh gửi đáp án       |
| `admin:nextQuestion`| (không có)             | Chuyển câu hỏi tiếp       |
| `admin:endQuestion` | (không có)             | Kết thúc câu hỏi sớm      |
| `admin:showRanking` | (không có)             | Hiện bảng xếp hạng        |
| `admin:reset`   | (không có)                 | Reset về lobby            |

**Server → Client:**

| Event           | Mô tả                                                |
|-----------------|------------------------------------------------------|
| `game:state`    | Trạng thái hiện tại khi mới kết nối                  |
| `players:update`| Cập nhật danh sách + số lượng thí sinh               |
| `game:countdown`| Bắt đầu đếm ngược 3 giây trước câu hỏi               |
| `question:show` | Hiển thị câu hỏi (loại, lựa chọn, thời gian, điểm)   |
| `time:sync:reply`| Trả về `{t0, t1}` cho đồng bộ thời gian              |
| `timer:update`  | Cập nhật đồng hồ `{timeLeft, serverTimestamp, questionEndTime}` |
| `answer:confirmed`| Xác nhận đã nhận đáp án (gửi cho thí sinh)           |
| `answers:update`| Số người đã trả lời + dữ liệu monitor (gửi cho admin)|
| `question:result`| Kết quả câu hỏi (biểu đồ, đáp án đúng, ranking)      |
| `game:ranking`  | Bảng xếp hạng giữa trận                              |
| `game:final`    | Kết quả cuối cùng + ranking                          |
| `game:reset`    | Reset game về lobby                                  |
| `error`         | Thông báo lỗi (VD: phòng không tồn tại)              |

### 1.6 Công thức tính điểm

```javascript
function calculatePoints(timeTaken, timeLimit, maxPoints) {
  const ratio = 1 - (timeTaken / timeLimit);
  if (ratio <= 0) return Math.round(maxPoints * 0.1);  // Tối thiểu 10%
  return Math.round(maxPoints * (0.5 + 0.5 * ratio));  // 50-100% tuỳ tốc độ
}
```

- Trả lời ngay lập tức: 100% điểm tối đa
- Trả lời ở giữa thời gian: ~75% điểm
- Trả lời sát hết giờ: ~50% điểm
- Hết giờ: 10% điểm (nếu đã nhấn trước đó)

---

## 2. Trang Setup (`/setup`)

### Files: `setup.html`, `setup.css`, `setup.js`

Giao diện quản lý cuộc thi với sidebar và 3 tab:

### 2.1 Tab "Câu hỏi"
- Danh sách câu hỏi dạng card, có màu theo loại
- Thêm/Sửa/Xoá câu hỏi qua modal
- **Các loại câu hỏi:**
  - `multiple`: Trắc nghiệm 4 đáp án (1 đáp án đúng)
  - `truefalse`: Đúng/Sai (2 lựa chọn)
  - `text`: Thí sinh gõ đáp án
- Upload hình ảnh cho câu hỏi (tuỳ chọn)
- Cài đặt thời gian (5-120 giây) và điểm tối đa cho từng câu

### 2.2 Tab "Xếp hình"
- Upload ảnh xếp hình
- Chọn kích thước lưới: 3x3, 4x4, 5x5
- Cài đặt thời gian

### 2.3 Tab "Cài đặt"
- Tên cuộc thi

### 2.4 Hành động
- **"Lưu tất cả"**: Lưu dữ liệu quiz vào server (`POST /api/quiz`)
- **"Tạo phòng thi"**: Lưu + tạo phòng, hiện mã phòng và link Admin/Player

---

## 3. Trang Admin (`/admin?room=CODE`)

### Files: `admin.html`, `admin.js`

Trang hiển thị trên màn hình LED sân khấu, admin điều khiển game.

### 3.1 Các màn hình

| Màn hình | ID              | Mô tả                                  |
|----------|-----------------|----------------------------------------|
| Lobby    | `lobbyScreen`   | Mã phòng, QR code, danh sách thí sinh  |
| Question | `questionScreen`| Đồng hồ, câu hỏi, 4 ô đáp án màu      |
| Result   | `resultScreen`  | Đáp án đúng, biểu đồ cột số lượng chọn |
| Ranking  | `rankingScreen` | Podium top 3 + danh sách từ hạng 4     |
| Puzzle   | `puzzleScreen`  | Vòng xếp hình                          |
| Final    | `finalScreen`   | Kết quả cuối cùng + nút xuất Excel     |

### 3.2 Lobby Screen
- Hiển thị **mã phòng** lớn (thay cho "QUIZ GAME")
- **QR code** để thí sinh quét bằng iPad (tự động load từ `/api/room/:code/qr`)
- Số lượng thí sinh kèm danh sách tên (animation pop-in)
- Nút "Bắt đầu"

### 3.3 Question Screen
- Biểu tượng Kahoot: `▲ ◆ ● ■` với 4 màu: đỏ, xanh dương, vàng, xanh lá
- Đồng hồ đếm ngược lớn (đổi màu vàng khi ≤10s, đỏ nhấp nháy khi ≤5s)
- Đếm số người đã trả lời
- **Panel theo dõi thí sinh**: nút "Theo dõi" mở sidebar bên phải hiện trạng thái từng người (đã trả lời / đang chờ)

### 3.4 Result Screen
- Hiện đáp án đúng với biểu tượng
- Biểu đồ cột ngang thể hiện số lượng chọn từng đáp án
- Thống kê: "X / Y trả lời đúng — Z / Y đã trả lời"
- Nút "Bảng xếp hạng" và "Câu tiếp theo"

### 3.5 Ranking Screen
- **Podium top 3**: vàng (1st, cao nhất), bạc (2nd), đồng (3rd)
- Thứ tự hiển thị: [2nd, 1st, 3rd] giống Kahoot
- Xử lý trường hợp < 3 người chơi (ẩn slot trống)
- Danh sách từ hạng 4 trở xuống

### 3.6 Final Screen
- Kết quả cuối cùng với podium
- Nút **"Xuất Excel"** tải file `.xlsx` gồm:
  - Sheet 1: Bảng xếp hạng (hạng, tên, điểm, số câu đúng, streak)
  - Sheet 2: Chi tiết từng câu (câu hỏi, tên, đáp án chọn, đúng/sai, thời gian, điểm)
- Hiệu ứng confetti

### 3.7 Hiệu ứng âm thanh (Web Audio API)
- **Countdown**: beep cao (880Hz) mỗi giây
- **Question show**: 3 note liên tiếp (đô-mi-sol)
- **Time warning** (≤5s): sawtooth 440Hz
- **Result reveal**: tone 660Hz
- **Final**: hợp âm tăng dần (đô-mi-sol-đô cao)

---

## 4. Trang Player (`/player?room=CODE`)

### Files: `player.html`, `player.js`

Giao diện thí sinh trên iPad.

### 4.1 Các màn hình

| Màn hình | ID               | Mô tả                             |
|----------|------------------|-----------------------------------|
| Join     | `joinScreen`     | Nhập mã phòng + tên               |
| Waiting  | `waitingScreen`  | Đã vào phòng, chờ admin bắt đầu   |
| Question | `questionScreen` | Câu hỏi + 4 nút trả lời           |
| Answered | `answeredScreen` | Đã trả lời, chờ kết quả           |
| Result   | `resultScreen`   | Đúng/sai + điểm nhận được         |
| Ranking  | `rankingScreen`  | Bảng xếp hạng (đánh dấu "Bạn")    |
| Puzzle   | `puzzleScreen`   | Vòng xếp hình                     |
| Final    | `finalScreen`    | Kết quả cuối cùng                 |

### 4.2 Join Screen
- Ô nhập **mã phòng** (tự động điền từ URL nếu có `?room=CODE`)
- Ô nhập **tên** (tối đa 30 ký tự)
- Nút "Vào thi"
- Báo lỗi nếu phòng không tồn tại

### 4.3 Question Screen
- Câu hỏi + hình ảnh (nếu có)
- Đồng hồ đếm ngược (đổi màu khi gần hết giờ)
- **4 nút trả lời** màu Kahoot (đỏ, xanh, vàng, xanh lá) với biểu tượng `▲ ◆ ● ■`
- Layout `grid 2x2` chiếm hết màn hình iPad (không cần cuộn)
- Với câu hỏi dạng text: hiện ô nhập + nút gửi

### 4.4 Result Screen
- **Đúng**: icon xanh ✓ + điểm nhận được (VD: +850)
- **Sai**: icon đỏ ✗ + hiện đáp án đúng
- Tổng điểm hiện tại

### 4.5 Hiệu ứng âm thanh
- **Click**: tone ngắn khi chọn đáp án
- **Correct**: 2 note (đô-sol)
- **Wrong**: sawtooth trầm

### 4.6 Reconnect
- Nếu mất kết nối, tự động kết nối lại và gửi lại `player:join` với roomCode và tên đã lưu

---

## 5. Game Xếp Hình (`/puzzle`)

### Files: `puzzle.html`, `puzzle.js`

### 5.1 Chức năng
- Xếp hình bằng cách **click 2 mảnh để đổi chỗ** (không kéo thả)
- Hỗ trợ 3 kích thước: 3x3 (dễ), 4x4 (trung bình), 5x5 (khó)
- Đồng hồ đếm thời gian + đếm số lượt đổi
- Hiệu ứng confetti khi hoàn thành
- Nút xem ảnh gốc

### 5.2 Tích hợp với Quiz Data
- Khi load trang, tự động lấy cấu hình từ `/api/quiz`:
  - Nếu đã upload ảnh trong Setup → dùng ảnh đó
  - Nếu không → tự động tạo ảnh demo bằng Canvas API (gradient + ngôi sao + chữ)
- Kích thước lưới lấy từ cấu hình (mặc định 4x4)

### 5.3 Kỹ thuật
- Mỗi mảnh ghép dùng `background-image` + `background-position` để cắt phần ảnh tương ứng
- Ảnh được vẽ lên Canvas 600x600px, chuyển sang `toDataURL()` để dùng làm background

---

## 6. CSS Theme (`style.css`)

### 6.1 Biến màu Kahoot

```css
--kahoot-purple: #46178F     /* Màu chính */
--kahoot-red: #E21B3C        /* Đáp án A / Nút nguy hiểm */
--kahoot-blue: #1368CE       /* Đáp án B / Nút chính */
--kahoot-yellow: #D89E00     /* Đáp án C / Cảnh báo */
--kahoot-green: #26890C      /* Đáp án D / Thành công */
```

### 6.2 Background Kahoot
Class `.kahoot-bg` tạo nền gradient tím với 2 "blob" hình tròn bằng `::before` và `::after` pseudo-elements dùng `radial-gradient`.

### 6.3 Quản lý màn hình
```css
.screen { display: none !important; }
.screen.active { display: block !important; }
```
Chuyển màn hình bằng JS: bỏ `active` toàn bộ, thêm `active` cho màn hình mới.

### 6.4 Responsive
- Desktop: layout đầy đủ
- iPad/tablet: button lớn, grid 2x2 chiếm hết viewport
- Mobile (≤768px): layout đơn cột, kích thước giảm

---

## 7. Cấu hình và chạy

### 7.1 Cài đặt

```bash
cd demo
npm install
```

### 7.2 Chạy server

```bash
# Chạy bình thường
npm start

# Chạy với auto-reload khi thay đổi code
npm run dev

# Chỉ định port
PORT=3000 node server.js
```

### 7.3 Truy cập

| Trang | URL                            |
|-------|--------------------------------|
| Home  | http://localhost:3000           |
| Setup | http://localhost:3000/setup     |
| Admin | http://localhost:3000/admin     |
| Player| http://localhost:3000/player    |
| Puzzle| http://localhost:3000/puzzle    |

---

## 8. Dữ liệu Quiz (`quizdata.json`)

### Cấu trúc:

```json
{
  "title": "Quiz Game",
  "questions": [
    {
      "id": 1,
      "type": "multiple",           // multiple | truefalse | text
      "question": "Câu hỏi?",
      "options": ["A", "B", "C", "D"],  // Mảng lựa chọn (trống với type=text)
      "correct": [1],                // Mảng index đáp án đúng (hoặc chuỗi với text)
      "timeLimit": 15,               // Giây
      "points": 1000,                // Điểm tối đa
      "image": null                  // URL ảnh (hoặc null)
    }
  ],
  "puzzle": {
    "image": null,                   // URL ảnh upload (hoặc null = dùng ảnh demo)
    "gridSize": 4,                   // 3, 4, hoặc 5
    "timeLimit": 120                 // Giây
  }
}
```

---

## 9. Xuất Excel

Khi kết thúc game, admin có thể tải file Excel tại `/api/room/:code/export`.

**Sheet 1 - Bảng xếp hạng:**

| Hạng | Tên  | Điểm | Số câu đúng | Streak cao nhất |
|------|------|------|-------------|-----------------|
| 1    | Vạnh | 4500 | 4           | 3               |

**Sheet 2 - Chi tiết:**

| Câu | Câu hỏi       | Tên  | Đáp án chọn | Đúng/Sai | Thời gian (s) | Điểm |
|-----|---------------|------|-------------|----------|---------------|------|
| 1   | Quốc khánh... | Vạnh | 2/9         | Đúng     | 3.2           | 894  |

---

## 11. Theo dõi thí sinh (Player Monitoring)

Trong màn hình Question của Admin, bấm nút **"Theo dõi"** sẽ mở panel bên phải:
- Hiện tất cả thí sinh
- Người đã trả lời: highlight xanh + chấm xanh
- Người chưa trả lời: xám
- Sắp xếp: chưa trả lời lên trước, sau đó theo điểm giảm dần
- Cập nhật real-time mỗi khi có người trả lời

---

## 12. Admin Authentication

### 12.1 Luồng xác thực

```
Admin mở trang → Kiểm tra token trong sessionStorage
  ├── Có token → Gửi token qua socket "admin:join" → Server kiểm tra adminTokens Set
  │     ├── Hợp lệ → Vào lobby
  │     └── Không hợp lệ → Hiện form đăng nhập
  └── Không có token → Hiện form đăng nhập
        ↓
  Nhập mật khẩu → Gửi qua socket "admin:auth" callback
        ↓
  Server kiểm tra mật khẩu (bcrypt/plain) → Tạo token (crypto.randomBytes)
        ↓
  Lưu token vào adminTokens Set + trả về cho client
        ↓
  Client lưu token vào sessionStorage → Vào lobby
```

### 12.2 Bảo vệ các event admin

Tất cả event admin (`admin:nextQuestion`, `admin:endQuestion`, `admin:showRanking`, `admin:reset`) đều kiểm tra `isAuthenticated` (socket đã xác thực qua token) trước khi xử lý.

### 12.3 Token management

- Token được tạo bằng `crypto.randomBytes(32).toString('hex')`
- Lưu trong `adminTokens` Set phía server
- Client lưu trong `sessionStorage` with key `admin_token_{roomCode}`
- Token tồn tại cho đến khi server restart

---

## 13. Time Sync (NTP-style Bayeux/CometD)

### 13.1 Vấn đề

Đồng hồ của các thiết bị (iPad, máy tính admin, server) có thể lệch nhau vài giây. Nếu client dùng `Date.now()` của mình để tính thời gian còn lại, mỗi người sẽ thấy đồng hồ khác nhau.

### 13.2 Giải pháp

Sử dụng giao thức đồng bộ thời gian kiểu NTP (Network Time Protocol) qua Socket.io, lấy cảm hứng từ Bayeux/CometD:

```
Client                          Server
  |  ---- time:sync {t0} ---->   |
  |                               |  t1 = Date.now()
  |  <-- time:sync:reply {t0,t1} |
  |  t2 = Date.now()              |
  |                               |
  |  RTT = t2 - t0               |
  |  offset = t1 - (t0 + RTT/2)  |
```

### 13.3 Quy trình

1. Client gửi `time:sync` với `t0 = Date.now()`
2. Server trả lời lại với `{t0, t1: Date.now()}`
3. Client tính `RTT = t2 - t0` và `offset = t1 - (t0 + RTT/2)`
4. Lặp lại 5 lần (SYNC_SAMPLE_COUNT), chọn sample có **RTT thấp nhất** (chính xác nhất)
5. Lưu `serverTimeOffset` — dùng để chuyển `Date.now()` thành thời gian server

### 13.4 Sử dụng

```javascript
function getServerTime() {
  return Date.now() + serverTimeOffset;
}
```

- Đồng bộ lần đầu khi kết nối (`socket.on('connect')`)
- Tự động đồng bộ lại mỗi **30 giây**
- Áp dụng cho cả admin.js và player.js

---

## 14. Server-Side Authoritative Timing

### 14.1 Vấn đề cũ

Trước đây, server dùng `setInterval` giảm `room.timeLeft--` mỗi giây và gửi `timer:update(timeLeft)`. Vấn đề:
- `setInterval` không chính xác
- Mỗi client nhận `timer:update` tại thời điểm khác nhau (do độ trễ mạng)

### 14.2 Giải pháp mới

Server lưu **timestamp kết thúc** (`questionEndTime`) thay vì đếm ngược:

```javascript
// Server-side
room.questionStartTime = Date.now();
room.questionEndTime = room.questionStartTime + q.timeLimit * 1000;

// Server vẫn gửi timer:update mỗi giây
io.to(room.code).emit('timer:update', {
  timeLeft: Math.ceil((room.questionEndTime - Date.now()) / 1000),
  serverTimestamp: Date.now(),
  questionEndTime: room.questionEndTime
});
```

### 14.3 Client-side local timer

Client dùng `requestAnimationFrame` + `setTimeout` để cập nhật đồng hồ 5 lần/giây:

```javascript
function tickLocalTimer() {
  const serverNow = getServerTime();
  const remaining = Math.ceil((currentQuestionEndTime - serverNow) / 1000);
  if (remaining > 0) {
    localTimerRAF = requestAnimationFrame(() => {
      setTimeout(tickLocalTimer, 200);
    });
  }
}
```

---

## 16. Hệ thống Thử nghiệm (Testing System)

Hệ thống được thiết kế để tester có thể kiểm tra từng vòng chơi một cách độc lập.

### 16.1 Ephemeral Rooms (Phòng thi tạm thời)

- Khi truy cập URL có tham số `game=...` mà không có mã phòng, client tự động tạo một mã phòng có tiền tố `TEST_`.
- Server nhận diện các mã `TEST_` này và tự động khởi tạo dữ liệu phòng thi từ file `quizdata.json`.
- Các phòng này có dữ liệu `quizData` được xáo trộn và chỉ lấy một tập con gồm **4 câu hỏi** để tối ưu thời gian test.

### 16.2 Luồng Test (Auto-Simulation)

- **Quiz Test**: Server tự động đếm ngược, hiện câu hỏi, nhận đáp án và tự động chuyển sang câu tiếp theo.
- **Puzzle Test**: Server gửi ngay dữ liệu câu đố và bộ đếm thời gian local.
- **Join Flow**: Tester bỏ qua bước nhập tên và chọn logo. Một nút **"Bắt đầu ngay"** xuất hiện.
- **Replay**: Sau khi kết thúc, nút **"Chơi lại"** xuất hiện.

### 16.3 Các điểm truy cập Test

- `/player?game=quiz`: Test vòng trắc nghiệm (ngẫu nhiên 4 câu).
- `/player?game=puzzle`: Test vòng xếp hình.

---

## 17. Bảo trì và Khắc phục sự cố

- **Lỗi undefined testQStart**: Đã xử lý bằng cách thêm chốt chặn (guard clause).
- **Đồng bộ Setup**: Trang Setup gọi trực tiếp API `/api/quiz` để đọc file `quizdata.json`.
- **Reset Game**: Hệ thống tự động xóa dữ liệu tạm của các phòng Test.
