# Quiz Game - Tai lieu ky thuat chi tiet

## Tong quan

Ung dung Quiz Game la mot he thong thi dau kien thuc thoi gian thuc, lay cam hung tu Kahoot. Duoc thiet ke de phuc vu cuoc thi voi khoang 30 thi sinh tren iPad, admin dieu khien tren man hinh LED san khau.

**Cong nghe:**
- **Backend:** Node.js + Express 5 + Socket.io 4
- **Frontend:** Vanilla HTML/CSS/JS (khong framework)
- **Giao tiep thoi gian thuc:** Socket.io (WebSocket)
- **Luu tru du lieu:** JSON file (`data/quizdata.json`)

---

## Cau truc thu muc

```
demo/
├── server.js              # Server chinh (Express + Socket.io)
├── package.json           # Dependencies va scripts
├── note.md                # Ghi chu yeu cau ban dau
├── data/
│   └── quizdata.json      # Du lieu quiz (tu dong tao)
├── public/
│   ├── index.html         # Trang chu - dieu huong
│   ├── setup.html         # Trang quan ly cau hoi + tao phong
│   ├── admin.html         # Trang admin (man hinh LED)
│   ├── player.html        # Trang thi sinh (iPad)
│   ├── puzzle.html        # Game xep hinh doc lap
│   ├── css/
│   │   ├── style.css      # CSS chinh (Kahoot theme)
│   │   └── setup.css      # CSS rieng cho trang setup
│   ├── js/
│   │   ├── admin.js       # Logic admin
│   │   ├── player.js      # Logic thi sinh
│   │   ├── puzzle.js      # Logic game xep hinh
│   │   └── setup.js       # Logic CRUD cau hoi
│   └── uploads/           # Anh upload (tu dong tao)
```

---

## Luong hoat dong chinh

```
Setup (tao cau hoi) → Tao phong → Admin mo phong → Thi sinh quet QR/nhap ma
     ↓                                ↓                      ↓
  Luu du lieu              Hien thi lobby + QR       Nhap ten + ma phong
                                    ↓                      ↓
                              Bat dau game   ←──────   Cho trong lobby
                                    ↓
                    Countdown 3s → Hien cau hoi → Thi sinh tra loi
                                    ↓
                    Ket qua cau hoi → Bang xep hang → Cau tiep theo
                                    ↓
                    (Lap lai cho den het cau hoi)
                                    ↓
                    Chuong ngai vat (neu bat) → Ket qua cuoi → Xuat Excel
```

---

## 1. Server (`server.js`)

### 1.1 Dependencies

| Package    | Muc dich                           |
|------------|-------------------------------------|
| express@5  | Web server + API routes             |
| socket.io  | Giao tiep thoi gian thuc            |
| multer     | Upload hinh anh                     |
| xlsx       | Xuat ket qua ra file Excel          |
| qrcode     | Tao ma QR cho phong thi             |

### 1.2 API Routes

| Method | Endpoint                    | Mo ta                              |
|--------|-----------------------------|------------------------------------|
| GET    | `/api/quiz`                 | Lay du lieu quiz hien tai          |
| POST   | `/api/quiz`                 | Luu du lieu quiz (JSON body)       |
| POST   | `/api/upload`               | Upload hinh anh (multipart form)   |
| POST   | `/api/room`                 | Tao phong thi moi, tra ve `{code}` |
| GET    | `/api/room/:code`           | Lay thong tin phong                |
| GET    | `/api/room/:code/qr`        | Lay QR code (base64 data URL)      |
| GET    | `/api/room/:code/export`    | Tai file Excel ket qua             |

### 1.3 Clean URL Routing

```
/           → index.html
/admin      → admin.html
/player     → player.html
/puzzle     → puzzle.html
/setup      → setup.html
```

Xu ly bang middleware rewrite truoc `express.static`, khong dung `sendFile` (tranh loi Express 5 + Node 24 voi duong dan tuong doi).

### 1.4 Kien truc Room

Moi cuoc thi la mot "room" doc lap:

```javascript
rooms[code] = {
  code,                    // Ma phong (6 ky tu, VD: "A1B2C3")
  phase,                   // Trang thai: lobby|countdown|question|result|ranking|obstacle|final
  quizData,                // Du lieu quiz cua phong nay
  currentQuestionIndex,    // Cau hoi hien tai (-1 = chua bat dau)
  questionStartTime,       // Timestamp bat dau cau hoi (tinh diem)
  players: {},             // {socketId: {name, score, streak, ...}}
  answers: {},             // {socketId: {option, time, correct, points}}
  timerInterval,           // setInterval ID cho dong ho dem nguoc
  timeLeft,                // Thoi gian con lai
  revealedHints: [],       // Goi y da mo cho chuong ngai vat
  gameHistory: []          // Lich su cau tra loi (de xuat Excel)
}
```

### 1.5 Socket.io Events

**Client → Server:**

| Event                  | Du lieu                       | Mo ta                        |
|------------------------|-------------------------------|------------------------------|
| `player:join`          | `{roomCode, name}`            | Thi sinh tham gia phong      |
| `admin:auth`           | `{password, roomCode}` + cb   | Xac thuc admin (callback)    |
| `admin:join`           | `{roomCode, token}`           | Admin vao phong (co token)   |
| `time:sync`            | `{t0}`                        | Bat dau dong bo thoi gian    |
| `player:answer`        | `{option}` hoac `{text}`      | Thi sinh gui dap an          |
| `player:obstacleAnswer`| `{text}`                      | Tra loi chuong ngai vat      |
| `admin:nextQuestion`   | (khong co)                    | Chuyen cau hoi tiep          |
| `admin:endQuestion`    | (khong co)                    | Ket thuc cau hoi som         |
| `admin:showRanking`    | (khong co)                    | Hien bang xep hang           |
| `admin:endObstacle`    | (khong co)                    | Ket thuc chuong ngai vat     |
| `admin:reset`          | (khong co)                    | Reset ve lobby               |

**Server → Client:**

| Event                  | Mo ta                                                |
|------------------------|------------------------------------------------------|
| `game:state`           | Trang thai hien tai khi moi ket noi                  |
| `players:update`       | Cap nhat danh sach + so luong thi sinh               |
| `game:countdown`       | Bat dau dem nguoc 3 giay truoc cau hoi               |
| `question:show`        | Hien thi cau hoi (loai, lua chon, thoi gian, diem)   |
| `time:sync:reply`      | Tra ve `{t0, t1}` cho dong bo thoi gian              |
| `timer:update`         | Cap nhat dong ho `{timeLeft, serverTimestamp, questionEndTime}` |
| `answer:confirmed`     | Xac nhan da nhan dap an (gui cho thi sinh)           |
| `answers:update`       | So nguoi da tra loi + du lieu monitor (gui cho admin) |
| `question:result`      | Ket qua cau hoi (bieu do, dap an dung, ranking)      |
| `game:ranking`         | Bang xep hang giua tran                              |
| `game:obstacle`        | Bat dau chuong ngai vat (goi y, do dai dap an)       |
| `obstacle:confirmed`   | Xac nhan da nhan dap an chuong ngai vat              |
| `game:final`           | Ket qua cuoi cung + ranking                          |
| `game:reset`           | Reset game ve lobby                                  |
| `error`                | Thong bao loi (VD: phong khong ton tai)              |

### 1.6 Cong thuc tinh diem

```javascript
function calculatePoints(timeTaken, timeLimit, maxPoints) {
  const ratio = 1 - (timeTaken / timeLimit);
  if (ratio <= 0) return Math.round(maxPoints * 0.1);  // Toi thieu 10%
  return Math.round(maxPoints * (0.5 + 0.5 * ratio));  // 50-100% tuy toc do
}
```

- Tra loi ngay lap tuc: 100% diem toi da
- Tra loi o giua thoi gian: ~75% diem
- Tra loi sat het gio: ~50% diem
- Het gio: 10% diem (neu da nhan truoc do)

---

## 2. Trang Setup (`/setup`)

### Files: `setup.html`, `setup.css`, `setup.js`

Giao dien quan ly cuoc thi voi sidebar va 4 tab:

### 2.1 Tab "Cau hoi"
- Danh sach cau hoi dang card, co mau theo loai
- Them/Sua/Xoa cau hoi qua modal
- **Cac loai cau hoi:**
  - `multiple`: Trac nghiem 4 dap an (1 dap an dung)
  - `truefalse`: Dung/Sai (2 lua chon)
  - `text`: Thi sinh go dap an
- Upload hinh anh cho cau hoi (tuy chon)
- Cai dat thoi gian (5-120 giay) va diem toi da cho tung cau
- Goi y cho chuong ngai vat (moi cau 1 goi y)

### 2.2 Tab "Chuong ngai vat"
- Bat/Tat chuong ngai vat
- Nhap cau hoi va dap an (cum tu, VD: "VIET NAM")
- Cai dat thoi gian va diem thuong
- Hien thi danh sach goi y (tu dong lay tu cac cau hoi)

### 2.3 Tab "Xep hinh"
- Upload anh xep hinh
- Chon kich thuoc luoi: 3x3, 4x4, 5x5
- Cai dat thoi gian

### 2.4 Tab "Cai dat"
- Ten cuoc thi

### 2.5 Hanh dong
- **"Luu tat ca"**: Luu du lieu quiz vao server (`POST /api/quiz`)
- **"Tao phong thi"**: Luu + tao phong, hien ma phong va link Admin/Player

---

## 3. Trang Admin (`/admin?room=CODE`)

### Files: `admin.html`, `admin.js`

Trang hien thi tren man hinh LED san khau, admin dieu khien game.

### 3.1 Cac man hinh

| Man hinh         | ID              | Mo ta                                    |
|------------------|-----------------|------------------------------------------|
| Lobby            | `lobbyScreen`   | Ma phong, QR code, danh sach thi sinh    |
| Question         | `questionScreen`| Dong ho, cau hoi, 4 o dap an mau        |
| Result           | `resultScreen`  | Dap an dung, bieu do cot so luong chon   |
| Ranking          | `rankingScreen` | Podium top 3 + danh sach tu hang 4       |
| Obstacle         | `obstacleScreen`| Chuong ngai vat voi goi y va o trong     |
| Final            | `finalScreen`   | Ket qua cuoi cung + nut xuat Excel       |

### 3.2 Lobby Screen
- Hien thi **ma phong** lon (thay cho "QUIZ GAME")
- **QR code** de thi sinh quet bang iPad (tu dong load tu `/api/room/:code/qr`)
- So luong thi sinh kem danh sach ten (animation pop-in)
- Nut "Bat dau"

### 3.3 Question Screen
- Bieu tuong Kahoot: `▲ ◆ ● ■` voi 4 mau: do, xanh duong, vang, xanh la
- Dong ho dem nguoc lon (doi mau vang khi ≤10s, do nhap nhay khi ≤5s)
- Dem so nguoi da tra loi
- **Panel theo doi thi sinh**: nut "Theo doi" mo sidebar ben phai hien trang thai tung nguoi (da tra loi / dang cho)

### 3.4 Result Screen
- Hien dap an dung voi bieu tuong
- Bieu do cot ngang the hien so luong chon tung dap an
- Thong ke: "X / Y tra loi dung — Z / Y da tra loi"
- Nut "Bang xep hang" va "Cau tiep theo"

### 3.5 Ranking Screen
- **Podium top 3**: vang (1st, cao nhat), bac (2nd), dong (3rd)
- Thu tu hien thi: [2nd, 1st, 3rd] giong Kahoot
- Xu ly truong hop < 3 nguoi choi (an slot trong)
- Danh sach tu hang 4 tro xuong

### 3.6 Obstacle Screen
- Hien thi cau hoi chuong ngai vat
- Cac goi y da mo (tu cau hoi truoc do)
- O trong the hien do dai dap an (VD: "VIET NAM" = 8 o)
- Dong ho dem nguoc

### 3.7 Final Screen
- Ket qua cuoi cung voi podium
- Nut **"Xuat Excel"** tai file `.xlsx` gom:
  - Sheet 1: Bang xep hang (hang, ten, diem, so cau dung, streak)
  - Sheet 2: Chi tiet tung cau (cau hoi, ten, dap an chon, dung/sai, thoi gian, diem)
- Hieu ung confetti

### 3.8 Sound Effects (Web Audio API)
- **Countdown**: beep cao (880Hz) moi giay
- **Question show**: 3 note lien tiep (do-mi-sol)
- **Time warning** (≤5s): sawtooth 440Hz
- **Result reveal**: tone 660Hz
- **Final**: hop am tang dan (do-mi-sol-do cao)

---

## 4. Trang Player (`/player?room=CODE`)

### Files: `player.html`, `player.js`

Giao dien thi sinh tren iPad.

### 4.1 Cac man hinh

| Man hinh   | ID               | Mo ta                                |
|------------|------------------|--------------------------------------|
| Join       | `joinScreen`     | Nhap ma phong + ten                  |
| Waiting    | `waitingScreen`  | Da vao phong, cho admin bat dau      |
| Question   | `questionScreen` | Cau hoi + 4 nut tra loi              |
| Answered   | `answeredScreen` | Da tra loi, cho ket qua              |
| Result     | `resultScreen`   | Dung/sai + diem nhan duoc            |
| Ranking    | `rankingScreen`  | Bang xep hang (danh dau "Ban")       |
| Obstacle   | `obstacleScreen` | Goi y + o nhap dap an               |
| Final      | `finalScreen`    | Ket qua cuoi cung                    |

### 4.2 Join Screen
- O nhap **ma phong** (tu dong dien tu URL neu co `?room=CODE`)
- O nhap **ten** (toi da 30 ky tu)
- Nut "Vao thi"
- Bao loi neu phong khong ton tai

### 4.3 Question Screen
- Cau hoi + hinh anh (neu co)
- Dong ho dem nguoc (doi mau khi gan het gio)
- **4 nut tra loi** mau Kahoot (do, xanh, vang, xanh la) voi bieu tuong `▲ ◆ ● ■`
- Layout `grid 2x2` chiem het man hinh iPad (khong can cuon)
- Voi cau hoi dang text: hien o nhap + nut gui

### 4.4 Result Screen
- **Dung**: icon xanh ✓ + diem nhan duoc (VD: +850)
- **Sai**: icon do ✗ + hien dap an dung
- Tong diem hien tai

### 4.5 Sound Effects
- **Click**: tone ngan khi chon dap an
- **Correct**: 2 note (do-sol)
- **Wrong**: sawtooth tram

### 4.6 Reconnect
- Neu mat ket noi, tu dong ket noi lai va gui lai `player:join` voi roomCode va ten da luu

---

## 5. Game Xep Hinh (`/puzzle`)

### Files: `puzzle.html`, `puzzle.js`

### 5.1 Chuc nang
- Xep hinh bang cach **click 2 manh de doi cho** (khong keo tha)
- Ho tro 3 kich thuoc: 3x3 (de), 4x4 (trung binh), 5x5 (kho)
- Dong ho dem thoi gian + dem so luot doi
- Hieu ung confetti khi hoan thanh
- Nut xem anh goc

### 5.2 Tich hop voi Quiz Data
- Khi load trang, tu dong lay cau hinh tu `/api/quiz`:
  - Neu da upload anh trong Setup → dung anh do
  - Neu khong → tu dong tao anh demo bang Canvas API (gradient + ngoi sao + chu)
- Kich thuoc luoi lay tu cau hinh (mac dinh 4x4)

### 5.3 Ky thuat
- Moi manh ghep dung `background-image` + `background-position` de cat phan anh tuong ung
- Anh duoc ve len Canvas 600x600px, chuyen sang `toDataURL()` de dung lam background

---

## 6. CSS Theme (`style.css`)

### 6.1 Bien mau Kahoot

```css
--kahoot-purple: #46178F     /* Mau chinh */
--kahoot-red: #E21B3C        /* Dap an A / Nut nguy hiem */
--kahoot-blue: #1368CE       /* Dap an B / Nut chinh */
--kahoot-yellow: #D89E00     /* Dap an C / Canh bao */
--kahoot-green: #26890C      /* Dap an D / Thanh cong */
```

### 6.2 Background Kahoot
Class `.kahoot-bg` tao nen gradient tim voi 2 "blob" hinh tron bang `::before` va `::after` pseudo-elements dung `radial-gradient`.

### 6.3 Quan ly man hinh
```css
.screen { display: none !important; }
.screen.active { display: block !important; }
```
Chuyen man hinh bang JS: bo `active` toan bo, them `active` cho man hinh moi.

### 6.4 Responsive
- Desktop: layout day du
- iPad/tablet: button lon, grid 2x2 chiem het viewport
- Mobile (≤768px): layout don cot, kich thuoc giam

---

## 7. Cau hinh va chay

### 7.1 Cai dat

```bash
cd demo
npm install
```

### 7.2 Chay server

```bash
# Chay binh thuong
npm start

# Chay voi auto-reload khi thay doi code
npm run dev

# Chi dinh port
PORT=3000 node server.js
```

### 7.3 Truy cap

| Trang   | URL                            |
|---------|--------------------------------|
| Home    | http://localhost:3000           |
| Setup   | http://localhost:3000/setup     |
| Admin   | http://localhost:3000/admin     |
| Player  | http://localhost:3000/player    |
| Puzzle  | http://localhost:3000/puzzle    |

---

## 8. Du lieu Quiz (`quizdata.json`)

### Cau truc:

```json
{
  "title": "Quiz Game",
  "questions": [
    {
      "id": 1,
      "type": "multiple",           // multiple | truefalse | text
      "question": "Cau hoi?",
      "options": ["A", "B", "C", "D"],  // Mang lua chon (trong voi type=text)
      "correct": [1],                // Mang index dap an dung (hoac chuoi voi text)
      "timeLimit": 15,               // Giay
      "points": 1000,                // Diem toi da
      "image": null,                 // URL anh (hoac null)
      "hint": "Goi y"               // Goi y cho chuong ngai vat (hoac null)
    }
  ],
  "obstacleQuestion": {
    "enabled": true,
    "question": "Day la gi?",
    "answer": "VIET NAM",
    "hints": ["Goi y 1", "Goi y 2", null, "Goi y 4", "Goi y 5"],
    "timeLimit": 30,
    "points": 3000
  },
  "puzzle": {
    "image": null,                   // URL anh upload (hoac null = dung anh demo)
    "gridSize": 4,                   // 3, 4, hoac 5
    "timeLimit": 120                 // Giay
  }
}
```

---

## 9. Xuat Excel

Khi ket thuc game, admin co the tai file Excel tai `/api/room/:code/export`.

**Sheet 1 - Bang xep hang:**

| Hang | Ten  | Diem | So cau dung | Streak cao nhat |
|------|------|------|-------------|-----------------|
| 1    | Vanh | 4500 | 4           | 3               |

**Sheet 2 - Chi tiet:**

| Cau | Cau hoi          | Ten  | Dap an chon | Dung/Sai | Thoi gian (s) | Diem |
|-----|------------------|------|-------------|----------|----------------|------|
| 1   | Quoc khanh...    | Vanh | 2/9         | Dung     | 3.2            | 894  |

---

## 10. Chuong ngai vat (Obstacle Question)

### Cach hoat dong:
1. Moi cau hoi quiz co the gan 1 **goi y** (hint)
2. Khi thi sinh tra loi dung, goi y tuong ung se duoc **mo ra**
3. Sau tat ca cau hoi, neu chuong ngai vat duoc bat:
   - Hien thi cau hoi chuong ngai vat + cac goi y da mo
   - Thi sinh nhap dap an (VD: "VIET NAM")
   - Tra loi dung duoc cong diem thuong (mac dinh 3000)
4. Ket thuc chuong ngai vat → chuyen sang man hinh Final

### Vi du:
- Cau 1 hint "Mua thu" → thi sinh tra loi dung → mo goi y "Mua thu"
- Cau 2 hint "Mien Bac" → thi sinh tra loi dung → mo goi y "Mien Bac"
- Cau 3 khong co hint → khong mo them
- Cuoi cung: Hien "Day la gi?" voi goi y ["Mua thu", "Mien Bac"] → dap an: "VIET NAM"

---

## 11. Theo doi thi sinh (Player Monitoring)

Trong man hinh Question cua Admin, bam nut **"Theo doi"** se mo panel ben phai:
- Hien tat ca thi sinh
- Nguoi da tra loi: highlight xanh + cham xanh
- Nguoi chua tra loi: xam
- Sap xep: chua tra loi len truoc, sau do theo diem giam dan
- Cap nhat real-time moi khi co nguoi tra loi

---

## 12. Admin Authentication

### 12.1 Luong xac thuc

```
Admin mo trang → Kiem tra token trong sessionStorage
  ├── Co token → Gui token qua socket "admin:join" → Server kiem tra adminTokens Set
  │     ├── Hop le → Vao lobby
  │     └── Khong hop le → Hien form dang nhap
  └── Khong co token → Hien form dang nhap
        ↓
  Nhap mat khau → Gui qua socket "admin:auth" callback
        ↓
  Server kiem tra mat khau (bcrypt/plain) → Tao token (crypto.randomBytes)
        ↓
  Luu token vao adminTokens Set + tra ve cho client
        ↓
  Client luu token vao sessionStorage → Vao lobby
```

### 12.2 Bao ve cac event admin

Tat ca event admin (`admin:nextQuestion`, `admin:endQuestion`, `admin:showRanking`, `admin:endObstacle`, `admin:reset`) deu kiem tra `isAuthenticated` (socket da xac thuc qua token) truoc khi xu ly.

### 12.3 Token management

- Token duoc tao bang `crypto.randomBytes(32).toString('hex')`
- Luu trong `adminTokens` Set phia server
- Client luu trong `sessionStorage` voi key `admin_token_{roomCode}`
- Token ton tai cho den khi server restart

---

## 13. Time Sync (NTP-style Bayeux/CometD)

### 13.1 Van de

Dong ho cua cac thiet bi (iPad, may tinh admin, server) co the lech nhau vai giay. Neu client dung `Date.now()` cua minh de tinh thoi gian con lai, moi nguoi se thay dong ho khac nhau.

### 13.2 Giai phap

Su dung giao thuc dong bo thoi gian kieu NTP (Network Time Protocol) qua Socket.io, lay cam hung tu Bayeux/CometD:

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

### 13.3 Quy trinh

1. Client gui `time:sync` voi `t0 = Date.now()`
2. Server tra ve `time:sync:reply` voi `{t0, t1: Date.now()}`
3. Client tinh `RTT = t2 - t0` va `offset = t1 - (t0 + RTT/2)`
4. Lap lai 5 lan (SYNC_SAMPLE_COUNT), chon sample co **RTT thap nhat** (chinh xac nhat)
5. Luu `serverTimeOffset` — dung de chuyen `Date.now()` thanh thoi gian server

### 13.4 Su dung

```javascript
function getServerTime() {
  return Date.now() + serverTimeOffset;
}
```

- Dong bo lan dau khi ket noi (`socket.on('connect')`)
- Tu dong dong bo lai moi **30 giay**
- Ap dung cho ca admin.js va player.js

### 13.5 Do chinh xac

- Voi mang LAN (WiFi noi bo): do lech ~1-5ms
- Voi mang WAN: do lech ~10-50ms
- Chon sample co RTT thap nhat giup loai bo nhung lan mang bi tre bat thuong

---

## 14. Server-Side Authoritative Timing

### 14.1 Van de cu

Truoc day, server dung `setInterval` giam `room.timeLeft--` moi giay va gui `timer:update(timeLeft)`. Van de:
- `setInterval` khong chinh xac (co the lech vai ms moi lan, tich luy qua nhieu giay)
- Moi client nhan `timer:update` tai thoi diem khac nhau (do do tre mang)
- Client hien thi timeLeft nhan duoc, nhung luc nhan duoc thi co the da mat them 50-200ms

### 14.2 Giai phap moi

Server luu **timestamp ket thuc** (`questionEndTime`) thay vi dem nguoc:

```javascript
// Server-side
room.questionStartTime = Date.now();
room.questionEndTime = room.questionStartTime + q.timeLimit * 1000;

// Server van gui timer:update moi giay (backward compat) nhung kem them questionEndTime
io.to(room.code).emit('timer:update', {
  timeLeft: Math.ceil((room.questionEndTime - Date.now()) / 1000),
  serverTimestamp: Date.now(),
  questionEndTime: room.questionEndTime
});
```

### 14.3 Client-side local timer

Client dung `requestAnimationFrame` + `setTimeout` de cap nhat dong ho 5 lan/giay:

```javascript
function tickLocalTimer() {
  const serverNow = getServerTime();  // Date.now() + serverTimeOffset
  const remaining = Math.ceil((currentQuestionEndTime - serverNow) / 1000);
  // Cap nhat giao dien...
  if (remaining > 0) {
    localTimerRAF = requestAnimationFrame(() => {
      setTimeout(tickLocalTimer, 200);  // 5x/giay
    });
  }
}
```

### 14.4 Uu diem

- **Dong nhat**: Tat ca client tinh tu cung mot `questionEndTime`
- **Chinh xac**: Khong phu thuoc vao do tre cua `timer:update` event
- **Muot**: Cap nhat 5 lan/giay thay vi 1 lan/giay
- **Tu dong suy giam**: Neu mat mang tam thoi, dong ho van chay dung khi ket noi lai

### 14.5 Backward compatibility

`timer:update` handler chap nhan ca 2 format:
- **Cu**: `timer:update(number)` — dung truc tiep
- **Moi**: `timer:update({timeLeft, serverTimestamp, questionEndTime})` — dung questionEndTime de chay local timer

---

## 15. Bao mat va gioi han

- **Admin authentication**: Mat khau bao ve trang admin, token-based session
- Ten thi sinh duoc loc ky tu `<>` (chong XSS)
- Gioi han ten 30 ky tu
- Upload anh toi da 10MB, chi cho phep image/*
- Chong spam join: flag `hasJoined` tren client + check `players[socket.id]` tren server
- Chong tra loi nhieu lan: check `answers[socket.id]` tren server
- Thoi gian tra loi duoc kiem tra server-side (cho phep sai lech 1 giay)
- Room code la 6 ky tu ngau nhien (base36 uppercase)
- Tat ca admin control events kiem tra xac thuc truoc khi xu ly
