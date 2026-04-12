# 🏆 Quiz Game - Online Knowledge Competition

A Kahoot-inspired, real-time interactive quiz platform designed for live events, competitions, and classroom engagement. Featuring a **premium Icy Blue Luxury Glassmorphism UI**, this system ensures a seamless and visually stunning experience for both organizers and participants.

---

## ✨ Key Features

### 👑 Powerful Admin Control
- **Question Management**: Create multiple-choice, true/false, and short-answer questions.
- **Dynamic Content**: Upload images, set custom time limits (5s - 120s), and assign variable point values.
- **Stage Display**: Real-time admin dashboard designed for large LED screens/projectors.
- **Live Monitoring**: Track participant status (answered/waiting) and progress in real-time.
- **Export Data**: Download detailed performance reports and leaderboards in `.xlsx` format.

### 🎮 Immersive Gameplay
- **Real-time Interaction**: Synchronized gameplay across all devices using WebSockets (`Socket.io`).
- **NTP-style Time Sync**: High-precision time synchronization between server and all clients (ms accuracy).
- **Independent Game Modes**: Run Quiz or Puzzle rounds completely independently with dedicated start inputs.
- **Premium Testing Suite**: 
    - **One-Click Test Links**: Access individual game phases directly from the Admin panel.
    - **Ephemeral Test Rooms**: Auto-generated rooms (prefix `TEST_`) that don't interfere with live sessions and require zero admin setup.
    - **Auto-Simulation**: Testers skip registration and can trigger game start/next steps directly.
    - **Randomized Testing**: Automatically picks a subset of 4 random questions to keep test cycles fast and varied.
    - **Test Replay**: Instant "Play Again" button on the final results screen for testers.
- **Responsive Player UI**: Optimized for iPads, tablets, and smartphones.
- **Puzzle Round**: Solve a sliding puzzle challenge to complete the competition.
- **Real-time Leaderboard**: Live ranking updates with a podium for top 3 winners.
- **Audio Effects**: Built-in sound effects for countdowns, results, and round transitions.

### 🎨 State-of-the-Art Design
- **"Icy Blue Luxury" Theme**: High-end glassmorphism styling with backdrop filters, animated auroras, and glowing borders.
- **Interactive Visuals**: Confetti celebrations, smooth transitions, and dynamic data visualizations.

---

## 🛠️ Technical Stack

- **Backend**: Node.js (v20+), Express 5, Socket.io 4
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+), Web Audio API
- **Real-time**: WebSocket-based communication
- **Data Persistence**: JSON-based storage (`data/quizdata.json`)
- **Reporting**: Excel generation (`xlsx` library)
- **Deployment**: Multi-stage Distroless Dockerization for security and performance.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v20 or higher)
- [npm](https://www.npmjs.com/) (included with Node.js)

### Installation
1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    cd puzzle
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

### Development
Run the server with automatic reload:
```bash
npm run dev
```

### Testing
Run the test suite:
```bash
npm test
```

### Production
Start the Node.js server directly:
```bash
npm start
```
The application will be available at `http://localhost:3000`.

---

## 🐳 Docker Deployment

The project includes a hardened, multi-stage **Distroless** Dockerfile for production environments.

1.  **Build the image**:
    ```bash
    docker build -t quiz-game .
    ```

2.  **Run the container**:
    ```bash
    docker run -p 3000:3000 quiz-game
    ```

---

## 📖 Main Routes

| Route | Description |
| :--- | :--- |
| `/` | **Home**: Navigation and landing page. **Admin Login Hub** is also located here. |
| `/setup` | **Setup Dashboard**: Create questions and manage active room sessions (Requires Auth). |
| `/admin` | **Admin Screen**: Main game control screen for stage/LED (Requires Auth). |
| `/player` | **Player Screen**: Participant interface (for iPad/Phone). |
| `/puzzle` | **Independent Puzzle**: Standalone sliding puzzle mini-game. |

---

## 🧪 Testing Subsystem

The testing system is designed with **Complete Isolation**. Testers can access specific game phases directly without any interference with live matches. Even if a real competition is ongoing, a tester's actions (starting, answering, resetting) will **never** affect the live room or other players.

### How it works:
- **Ephemeral Rooms**: When using test links, the system auto-creates a private room (prefix `TEST_`).
- **Private Data**: Each test room has its own localized copy of questions and timers.
- **Zero Configuration**: Testers only need to click the **"Start Now"** button to begin their private session.

| Testing URL | Description | Features |
| :--- | :--- | :--- |
| `/player?game=quiz` | **Quiz Test** | Picks **4 random questions** from the database and auto-advances. |
| `/player?game=puzzle` | **Puzzle Test** | Direct access to the puzzle configuration for interaction testing. |

> [!IMPORTANT]
> **Isolation Guarantee**: Tested rooms are completely separated from the global server state. You can safely run tests while a multi-player competition is live without any cross-room leakage.

> [!TIP]
> Use the **"Replay"** button on the final result screen to restart with a new randomized set of questions and a fresh `TEST_` room code.

---

## 📂 Project Structure

```text
puzzle/
├── server.js              # Entry point (Express + Socket.io setup)
├── package.json
├── src/                   # Backend modules
│   ├── config/            # Cấu hình, auth tokens, default quiz data
│   ├── models/            # Room & Player data models
│   ├── services/          # Business logic (room, scoring, data, excel)
│   └── sockets/           # Socket.io handlers (connection, game-logic)
├── views/                 # Nunjucks templates (base.njk, index.njk)
├── public/                # Frontend assets
│   ├── js/                # Client-side logic
│   │   ├── setup.js       # Quản lý đề thi & API
│   │   ├── admin.js       # Điều khiển luồng trận đấu
│   │   ├── player.js      # Socket & UI của người chơi
│   │   └── puzzle.js      # Game xếp hình
│   ├── css/               # Giao diện Icy Blue Glassmorphism
│   └── uploads/           # Ảnh đề bài upload
├── tests/                 # Jest unit & integration tests
├── docs/                  # Tài liệu bổ sung (deploy, hướng dẫn, ...)
├── data/                  # Lưu trữ đề thi (quizdata.json)
├── logo/                  # Logo đại diện các đội thi
└── Dockerfile             # Cấu hình triển khai Cloud (Distroless)
```

---

## 📝 License
This project is licensed under the **ISC License**. Created for professional knowledge competitions and interactive events.
