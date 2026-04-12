// ==================== PUZZLE GAME ====================

let gridSize = 3;
let pieces = [];
let selectedPiece = null;
let moves = 0;
let timerInterval = null;
let startTime = null;
let puzzleImage = null;
let isComplete = false;

// Generate a colorful demo image using canvas
function generateDemoImage(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#1565C0');
  gradient.addColorStop(0.3, '#E53935');
  gradient.addColorStop(0.6, '#FFD600');
  gradient.addColorStop(1, '#2E7D32');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Draw a star pattern
  ctx.save();
  ctx.translate(size / 2, size / 2);
  const starRadius = size * 0.35;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const x = Math.cos(angle) * starRadius;
    const y = Math.sin(angle) * starRadius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Draw concentric circles
  for (let r = size * 0.4; r > 0; r -= size * 0.08) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + (size * 0.4 - r) / (size * 0.8)})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Title text
  ctx.fillStyle = 'white';
  ctx.font = `bold ${size * 0.08}px "Be Vietnam Pro", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Text shadow
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 10;
  ctx.fillText('VIỆT NAM', size / 2, size * 0.35);

  ctx.font = `bold ${size * 0.15}px "Be Vietnam Pro", Arial, sans-serif`;
  ctx.fillText('★', size / 2, size / 2);

  ctx.font = `bold ${size * 0.06}px "Be Vietnam Pro", Arial, sans-serif`;
  ctx.fillText('QUIZ GAME', size / 2, size * 0.65);

  // Decorative elements
  ctx.shadowBlur = 0;
  const colors = ['#E53935', '#FFD600', '#1565C0', '#2E7D32', '#FF9800'];
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    ctx.globalAlpha = 0.3 + Math.random() * 0.3;
    ctx.beginPath();
    ctx.arc(x, y, 3 + Math.random() * 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  return canvas;
}

function startPuzzle(size) {
  gridSize = size;
  moves = 0;
  isComplete = false;
  selectedPiece = null;

  // Remove any completion overlay
  const existing = document.querySelector('.puzzle-complete');
  if (existing) existing.remove();

  // Generate image if not pre-loaded
  if (!puzzleImage) {
    const imgSize = 600;
    puzzleImage = generateDemoImage(imgSize);
  }

  // Show preview canvas
  const previewCanvas = document.getElementById('previewCanvas');
  previewCanvas.width = puzzleImage.width;
  previewCanvas.height = puzzleImage.height;
  previewCanvas.getContext('2d').drawImage(puzzleImage, 0, 0);

  // Create pieces
  pieces = [];
  for (let i = 0; i < gridSize * gridSize; i++) {
    pieces.push({
      id: i,
      currentPos: i,
      correctPos: i
    });
  }

  // Shuffle
  for (let i = pieces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // Swap currentPos
    const temp = pieces[i].currentPos;
    pieces[i].currentPos = pieces[j].currentPos;
    pieces[j].currentPos = temp;
  }

  renderBoard();
  startTimer();

  document.getElementById('puzzleTimer').style.display = 'block';
  document.getElementById('movesDisplay').textContent = `Lượt: 0`;
}

function renderBoard() {
  const board = document.getElementById('puzzleBoard');
  board.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;

  const boardSize = Math.min(window.innerWidth * 0.85, window.innerHeight * 0.6, 600);
  board.style.width = boardSize + 'px';
  board.style.height = boardSize + 'px';

  // Sort by currentPos for display
  const sorted = [...pieces].sort((a, b) => a.currentPos - b.currentPos);

  board.innerHTML = sorted.map(piece => {
    const correctRow = Math.floor(piece.correctPos / gridSize);
    const correctCol = piece.correctPos % gridSize;

    // Create canvas for each piece
    const bgPosX = -(correctCol * (100 / (gridSize - 1)));
    const bgPosY = -(correctRow * (100 / (gridSize - 1)));
    const isCorrect = piece.currentPos === piece.correctPos;

    return `
      <div class="puzzle-piece ${isCorrect ? 'correct' : ''} ${selectedPiece === piece.id ? 'selected' : ''}"
           onclick="clickPiece(${piece.id})"
           id="piece-${piece.id}"
           style="background-image: url(${puzzleImage.toDataURL()});
                  background-size: ${gridSize * 100}%;
                  background-position: ${correctCol * (100 / (gridSize - 1))}% ${correctRow * (100 / (gridSize - 1))}%;">
      </div>
    `;
  }).join('');
}

function clickPiece(pieceId) {
  if (isComplete) return;

  if (selectedPiece === null) {
    selectedPiece = pieceId;
    document.getElementById(`piece-${pieceId}`).classList.add('selected');
  } else if (selectedPiece === pieceId) {
    selectedPiece = null;
    document.getElementById(`piece-${pieceId}`).classList.remove('selected');
  } else {
    // Swap pieces
    const piece1 = pieces.find(p => p.id === selectedPiece);
    const piece2 = pieces.find(p => p.id === pieceId);

    const tempPos = piece1.currentPos;
    piece1.currentPos = piece2.currentPos;
    piece2.currentPos = tempPos;

    moves++;
    document.getElementById('movesDisplay').textContent = `Lượt: ${moves}`;

    selectedPiece = null;
    renderBoard();
    checkComplete();
  }
}

function checkComplete() {
  const allCorrect = pieces.every(p => p.currentPos === p.correctPos);

  if (allCorrect) {
    isComplete = true;
    clearInterval(timerInterval);

    setTimeout(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;

      const overlay = document.createElement('div');
      overlay.className = 'puzzle-complete';
      overlay.innerHTML = `
        <h1>HOÀN THÀNH!</h1>
        <p>Thời gian: ${minutes}:${seconds.toString().padStart(2, '0')} | Lượt đổi: ${moves}</p>
        <button class="btn btn-primary" onclick="this.parentElement.remove()">ĐÓNG</button>
        <div style="margin-top:1rem;">
          <button class="btn btn-accent" onclick="this.parentElement.parentElement.remove(); startPuzzle(${gridSize})">CHƠI LẠI</button>
        </div>
      `;
      document.body.appendChild(overlay);
      launchConfetti();
    }, 500);
  }
}

function startTimer() {
  clearInterval(timerInterval);
  startTime = Date.now();

  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    document.getElementById('timerDisplay').textContent =
      `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, 1000);
}

function showPreview() {
  if (!puzzleImage) {
    puzzleImage = generateDemoImage(600);
    const previewCanvas = document.getElementById('previewCanvas');
    previewCanvas.width = puzzleImage.width;
    previewCanvas.height = puzzleImage.height;
    previewCanvas.getContext('2d').drawImage(puzzleImage, 0, 0);
  }
  const modal = document.getElementById('previewModal');
  modal.style.display = 'flex';
}

function launchConfetti() {
  const colors = ['#E53935', '#FFD600', '#1565C0', '#2E7D32', '#FF9800', '#9C27B0'];
  for (let i = 0; i < 80; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'confetti';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.width = (Math.random() * 10 + 5) + 'px';
      el.style.height = (Math.random() * 10 + 5) + 'px';
      el.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
      el.style.animationDuration = (Math.random() * 3 + 2) + 's';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 5000);
    }, i * 30);
  }
}

// Load configured puzzle settings from quiz data, then auto-start
window.addEventListener('load', async () => {
  let configGridSize = 4;
  let configImage = null;

  try {
    const res = await fetch('/api/quiz');
    const data = await res.json();
    if (data && data.puzzle) {
      configGridSize = data.puzzle.gridSize || 4;
      configImage = data.puzzle.image || null;
    }
  } catch (e) { }

  if (configImage) {
    // Load the configured image instead of generating demo
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 600;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      // Resize
      const ratio = Math.min(size / img.width, size / img.height);
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const dx = Math.round((size - w) / 2);
      const dy = Math.round((size - h) / 2);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, w, h);
      puzzleImage = canvas;
      startPuzzle(configGridSize);
    };
    img.onerror = () => startPuzzle(configGridSize);
    img.src = configImage;
  } else {
    startPuzzle(configGridSize);
  }
});
