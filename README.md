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
- **Responsive Player UI**: Optimized for iPads, tablets, and smartphones.
- **Obstacle Bonus Round**: Unlock hints through correct answers to solve a final grand puzzle.
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
| `/` | **Home**: Navigation and landing page. |
| `/setup` | **Setup Dashboard**: Create questions and configurations. |
| `/admin` | **Admin Screen**: Main game control screen (for stage/LED). |
| `/player` | **Player Screen**: Participant interface (for iPad/Phone). |
| `/puzzle` | **Independent Puzzle**: A standalone sliding puzzle mini-game. |

---

## 📂 Project Structure

```text
puzzle/
├── server.js              # Express + Socket.io Server logic
├── public/                # Frontend assets
│   ├── index.html         # Landing page
│   ├── setup.html         # Admin CRUD & Room creation
│   ├── admin.html         # Stage screen
│   ├── player.html        # Contestant screen
│   ├── js/                # Client-side core logic
│   └── css/               # Glassmorphism & Kahoot-themed styles
├── data/                  # Persistent quiz storage
├── logo/                  # Project assets
└── Dockerfile             # Production deployment config
```

---

## 📝 License
This project is licensed under the **ISC License**. Created for professional knowledge competitions and interactive events.
