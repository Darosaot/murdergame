/* ── State ──────────────────────────────────────────────────────── */
let currentPuzzle = PUZZLES[0];
let selectedSuspect = null;
let placements = {};       // suspectId → [row, col]
let solved = false;
let noteCells = new Set(); // "row,col" strings highlighted by clue notes

// Timer
let timerInterval = null;
let timerSeconds  = 0;
let timerStarted  = false;

// Move counter & undo history
let moveCount   = 0;
let moveHistory = []; // { suspectId, prevPosition, newPosition }

/* ── Boot ───────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  buildPuzzleNav();
  loadPuzzle(0);
});

/* ── Puzzle Navigation ──────────────────────────────────────────── */
function buildPuzzleNav() {
  const nav = document.getElementById("puzzle-nav");
  PUZZLES.forEach((p, i) => {
    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.dataset.index = i;
    btn.innerHTML = `<span>${p.emoji}</span> ${p.title}
      <small class="badge badge-${p.difficulty.toLowerCase()}">${p.difficulty}</small>`;
    btn.addEventListener("click", () => loadPuzzle(i));
    nav.appendChild(btn);
  });
}

function loadPuzzle(index) {
  currentPuzzle = PUZZLES[index];
  selectedSuspect = null;
  solved = false;
  noteCells = new Set();
  moveHistory = [];

  stopTimer();
  timerSeconds = 0;
  timerStarted = false;
  moveCount = 0;
  updateTimerDisplay();
  updateMoveDisplay();

  // Restore saved progress (placements); moveHistory is NOT restored by design
  placements = {};
  restoreProgress(currentPuzzle.id);

  document.querySelectorAll(".nav-btn").forEach((b, i) => {
    b.classList.toggle("active", i === index);
  });

  document.getElementById("puzzle-title").textContent = currentPuzzle.title;
  document.getElementById("story-text").textContent  = currentPuzzle.story;
  document.getElementById("check-btn").disabled      = false;
  document.getElementById("check-btn").textContent   = "🔍 Check Solution";
  document.getElementById("result-banner").className = "result-banner hidden";
  document.getElementById("undo-btn").disabled       = true;

  showBestTime(currentPuzzle.id);
  buildGrid();
  buildSuspects();
  buildClues();
  buildLegend();

  if (Object.keys(placements).length) updateSuspectPanel();
}

/* ── Room Lookup ────────────────────────────────────────────────── */
function buildRoomMap() {
  const map = {};
  currentPuzzle.rooms.forEach((room) => {
    room.cells.forEach(([r, c]) => { map[`${r},${c}`] = room; });
  });
  return map;
}

function getRoomAt(row, col) {
  return currentPuzzle.rooms.find((r) =>
    r.cells.some(([rr, cc]) => rr === row && cc === col)
  );
}

/* ── Grid (built once per puzzle) ───────────────────────────────── */
function buildGrid() {
  const container = document.getElementById("grid-container");
  const size = currentPuzzle.gridSize;
  container.innerHTML = "";

  container.style.gridTemplateColumns = `20px repeat(${size}, 1fr)`;
  container.style.gridTemplateRows    = `20px repeat(${size}, 1fr)`;

  const roomMap = buildRoomMap();

  const roomLabelCell = {};
  currentPuzzle.rooms.forEach((room) => {
    const [r, c] = room.cells[0];
    roomLabelCell[`${r},${c}`] = room;
  });

  container.appendChild(makeLabel(""));
  for (let c = 0; c < size; c++) container.appendChild(makeLabel(c + 1, "col-label"));

  for (let r = 0; r < size; r++) {
    container.appendChild(makeLabel(r + 1, "row-label"));

    for (let c = 0; c < size; c++) {
      const key = `${r},${c}`;
      const room = roomMap[key];
      const isVictim =
        currentPuzzle.victim.position[0] === r &&
        currentPuzzle.victim.position[1] === c;

      const cell = document.createElement("div");
      cell.className = "grid-cell";
      cell.dataset.row = r;
      cell.dataset.col = c;

      if (room) {
        cell.style.backgroundColor = room.color + "bb";
        cell.style.borderColor     = room.color;
        cell.style.color           = room.textColor || "#333";
      }

      if (roomLabelCell[key] && !isVictim) {
        const badge = document.createElement("span");
        badge.className = "room-label-badge";
        badge.textContent = room.name;
        cell.appendChild(badge);
      }

      if (isVictim) {
        cell.classList.add("victim-cell");
        cell.dataset.isVictim = "true";
      }

      container.appendChild(cell);
    }
  }

  container.addEventListener("click", (e) => {
    const cell = e.target.closest(".grid-cell");
    if (!cell || cell.dataset.isVictim) return;
    onCellClick(parseInt(cell.dataset.row), parseInt(cell.dataset.col));
  });

  renderGrid();
}

function makeLabel(text, cls) {
  const el = document.createElement("div");
  el.className = `grid-label ${cls || ""}`;
  el.textContent = text;
  return el;
}

/* ── Cell Click Handler ─────────────────────────────────────────── */
function onCellClick(row, col) {
  if (solved) return;

  const existing = getSuspectAt(row, col);

  if (existing) {
    // Record removal
    moveHistory.push({ suspectId: existing, prevPosition: [row, col], newPosition: null });
    delete placements[existing];
  } else {
    if (!selectedSuspect) return;
    // Record placement (prev may be null if first time, or old position)
    const prevPos = placements[selectedSuspect] ? [...placements[selectedSuspect]] : null;
    moveHistory.push({ suspectId: selectedSuspect, prevPosition: prevPos, newPosition: [row, col] });
    delete placements[selectedSuspect];
    placements[selectedSuspect] = [row, col];
  }

  startTimer();
  moveCount++;
  updateMoveDisplay();
  saveProgress();
  document.getElementById("undo-btn").disabled = false;

  renderGrid();
  updateSuspectPanel();
}

function getSuspectAt(row, col) {
  for (const [id, pos] of Object.entries(placements)) {
    if (pos[0] === row && pos[1] === col) return id;
  }
  return null;
}

/* ── Undo ───────────────────────────────────────────────────────── */
function undoLastMove() {
  if (!moveHistory.length || solved) return;
  const move = moveHistory.pop();

  if (move.newPosition !== null) delete placements[move.suspectId];
  if (move.prevPosition !== null) placements[move.suspectId] = move.prevPosition;

  moveCount = Math.max(0, moveCount - 1);
  updateMoveDisplay();
  saveProgress();
  renderGrid();
  updateSuspectPanel();
  document.getElementById("undo-btn").disabled = moveHistory.length === 0;
}

/* ── Render Grid ────────────────────────────────────────────────── */
function renderGrid() {
  const roomMap = buildRoomMap();

  const roomLabelCell = {};
  currentPuzzle.rooms.forEach((room) => {
    const [r, c] = room.cells[0];
    roomLabelCell[`${r},${c}`] = room;
  });

  const rowCount = {}, colCount = {};
  Object.values(placements).forEach(([r, c]) => {
    rowCount[r] = (rowCount[r] || 0) + 1;
    colCount[c] = (colCount[c] || 0) + 1;
  });
  const conflictRows = new Set(Object.keys(rowCount).filter((k) => rowCount[k] > 1).map(Number));
  const conflictCols = new Set(Object.keys(colCount).filter((k) => colCount[k] > 1).map(Number));

  document.querySelectorAll(".grid-cell").forEach((cell) => {
    const r = parseInt(cell.dataset.row);
    const c = parseInt(cell.dataset.col);
    const key = `${r},${c}`;
    const isVictim = cell.dataset.isVictim === "true";
    const room = roomMap[key];

    cell.className = "grid-cell" + (isVictim ? " victim-cell" : "");
    cell.style.backgroundColor = room ? room.color + "bb" : "";
    cell.style.borderColor     = room ? room.color : "";
    cell.style.color           = room ? (room.textColor || "#333") : "";

    if (isVictim) {
      cell.innerHTML = `<div class="victim-marker">
        <span class="victim-emoji">${currentPuzzle.victim.emoji}</span>
        <span class="victim-name">${currentPuzzle.victim.name}</span>
      </div>`;
      return;
    }

    if (noteCells.has(key)) cell.classList.add("note-highlight");

    const suspectId = getSuspectAt(r, c);
    const suspect   = suspectId ? currentPuzzle.suspects.find((s) => s.id === suspectId) : null;

    const labelRoom = roomLabelCell[key];
    if (labelRoom && !suspect) {
      const badge = document.createElement("span");
      badge.className = "room-label-badge";
      badge.textContent = labelRoom.name;
      cell.appendChild(badge);
    }

    if (suspect) {
      const isConflict = conflictRows.has(r) || conflictCols.has(c);
      cell.classList.add("occupied");
      if (isConflict) cell.classList.add("conflict");
      cell.style.borderColor = suspect.color;
      cell.innerHTML = `<div class="suspect-token" style="--tok-color:${suspect.color}">
        <span class="token-emoji">${suspect.emoji}</span>
        <span class="token-name">${suspect.name.split(" ")[0]}</span>
      </div>`;
    }

    if (selectedSuspect && placements[selectedSuspect]) {
      const [sr, sc] = placements[selectedSuspect];
      if (r === sr && c === sc) cell.classList.add("selected-placement");
    }
  });
}

/* ── Suspects Panel ─────────────────────────────────────────────── */
function buildSuspects() {
  const panel = document.getElementById("suspects-panel");
  panel.innerHTML = "";
  currentPuzzle.suspects.forEach((s) => {
    const card = document.createElement("div");
    card.className = "suspect-card";
    card.dataset.id = s.id;
    card.style.setProperty("--suspect-color", s.color);
    card.innerHTML = `
      <div class="suspect-avatar">${s.emoji}</div>
      <div class="suspect-info">
        <span class="suspect-name">${s.name}</span>
        <span class="suspect-status" id="status-${s.id}">Not placed</span>
      </div>
    `;
    card.addEventListener("click", () => toggleSuspect(s.id));
    panel.appendChild(card);
  });
}

function toggleSuspect(id) {
  if (solved) return;
  selectedSuspect = selectedSuspect === id ? null : id;
  document.querySelectorAll(".suspect-card").forEach((c) => {
    c.classList.toggle("selected", c.dataset.id === selectedSuspect);
  });
  renderGrid();
}

function updateSuspectPanel() {
  currentPuzzle.suspects.forEach((s) => {
    const el = document.getElementById(`status-${s.id}`);
    if (!el) return;
    const pos = placements[s.id];
    if (pos) {
      const room = getRoomAt(pos[0], pos[1]);
      el.textContent = room ? room.name : `Row ${pos[0]+1}, Col ${pos[1]+1}`;
      el.className = "suspect-status placed";
    } else {
      el.textContent = "Not placed";
      el.className = "suspect-status";
    }
  });
}

/* ── Clues Panel ────────────────────────────────────────────────── */
function buildClues() {
  const list = document.getElementById("clues-list");
  list.innerHTML = "";
  currentPuzzle.clues.forEach((clue, i) => {
    const li = document.createElement("li");
    li.className = "clue-item";
    li.innerHTML = `<span class="clue-num">${i + 1}</span><span class="clue-text">${clue.text}</span>`;
    if (clue.highlight) {
      li.classList.add("has-highlight");
      li.title = "Click to highlight grid cells";
      li.addEventListener("click", () => toggleClueHighlight(clue, li));
    }
    list.appendChild(li);
  });
}

function toggleClueHighlight(clue, li) {
  li.classList.toggle("active-clue");
  const h = clue.highlight;
  if (!h) return;
  const size = currentPuzzle.gridSize;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const rowOk = !h.rows || h.rows.includes(r);
      const colOk = !h.cols || h.cols.includes(c);
      if (rowOk && colOk) {
        const k = `${r},${c}`;
        if (noteCells.has(k)) noteCells.delete(k);
        else noteCells.add(k);
      }
    }
  }
  renderGrid();
}

/* ── Legend ─────────────────────────────────────────────────────── */
function buildLegend() {
  const legend = document.getElementById("room-legend");
  legend.innerHTML = "";
  currentPuzzle.rooms.forEach((room) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `<span class="legend-dot" style="background:${room.color}"></span>${room.name}`;
    legend.appendChild(item);
  });
}

/* ── Timer ──────────────────────────────────────────────────────── */
function startTimer() {
  if (timerStarted) return;
  timerStarted = true;
  timerInterval = setInterval(() => {
    timerSeconds++;
    updateTimerDisplay();
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function updateTimerDisplay() {
  document.getElementById("timer-display").textContent = formatTime(timerSeconds);
}

function updateMoveDisplay() {
  document.getElementById("move-display").textContent = moveCount;
}

/* ── localStorage ───────────────────────────────────────────────── */
function saveProgress() {
  try {
    localStorage.setItem(`whodoku_progress_${currentPuzzle.id}`, JSON.stringify(placements));
  } catch (_) {}
}

function restoreProgress(puzzleId) {
  try {
    const raw = localStorage.getItem(`whodoku_progress_${puzzleId}`);
    if (!raw) return;
    const data = JSON.parse(raw);
    const validIds = new Set(currentPuzzle.suspects.map((s) => s.id));
    for (const [id, pos] of Object.entries(data)) {
      if (validIds.has(id) && Array.isArray(pos) && pos.length === 2) {
        placements[id] = pos;
      }
    }
  } catch (_) {}
}

function clearProgress(puzzleId) {
  try { localStorage.removeItem(`whodoku_progress_${puzzleId}`); } catch (_) {}
}

function saveBestTime(puzzleId, seconds) {
  try {
    const key = `whodoku_best_${puzzleId}`;
    const prev = localStorage.getItem(key);
    if (prev === null || seconds < parseInt(prev)) {
      localStorage.setItem(key, String(seconds));
      return true;
    }
  } catch (_) {}
  return false;
}

function showBestTime(puzzleId) {
  try {
    const best = localStorage.getItem(`whodoku_best_${puzzleId}`);
    const item = document.getElementById("best-time-item");
    const disp = document.getElementById("best-time-display");
    if (best !== null) {
      disp.textContent = formatTime(parseInt(best));
      item.style.display = "";
    } else {
      item.style.display = "none";
    }
  } catch (_) {}
}

/* ── Check Solution ─────────────────────────────────────────────── */
document.getElementById("check-btn").addEventListener("click", checkSolution);

document.getElementById("undo-btn").addEventListener("click", undoLastMove);

document.getElementById("reset-btn").addEventListener("click", () => {
  const idx = PUZZLES.findIndex((p) => p.id === currentPuzzle.id);
  clearProgress(currentPuzzle.id);
  loadPuzzle(idx);
});

function hasConflicts() {
  const rowCount = {}, colCount = {};
  for (const [r, c] of Object.values(placements)) {
    rowCount[r] = (rowCount[r] || 0) + 1;
    colCount[c] = (colCount[c] || 0) + 1;
    if (rowCount[r] > 1 || colCount[c] > 1) return true;
  }
  return false;
}

function checkSolution() {
  const numSuspects = currentPuzzle.suspects.length;
  if (Object.keys(placements).length < numSuspects) {
    showBanner("warning", "⚠️ Place all suspects on the grid before checking.");
    return;
  }
  if (hasConflicts()) {
    showBanner("error", "❌ There is a row or column conflict. Each suspect must occupy a unique row and column.");
    return;
  }

  let correct = true;
  for (const [id, pos] of Object.entries(currentPuzzle.solution)) {
    const placed = placements[id];
    if (!placed || placed[0] !== pos[0] || placed[1] !== pos[1]) { correct = false; break; }
  }

  if (correct) {
    solved = true;
    stopTimer();
    const isNewBest = saveBestTime(currentPuzzle.id, timerSeconds);
    clearProgress(currentPuzzle.id);
    showBestTime(currentPuzzle.id);

    const murderer   = currentPuzzle.suspects.find((s) => s.id === currentPuzzle.murderer);
    const murderRoom = getRoomAt(...currentPuzzle.solution[currentPuzzle.murderer]);
    const timeStr    = formatTime(timerSeconds);
    const bestNote   = isNewBest ? " 🏆 New best time!" : "";

    showBanner(
      "success",
      `🎉 Case solved! The murderer is <strong>${murderer.name}</strong> ${murderer.emoji} — alone with the victim in the <em>${murderRoom ? murderRoom.name : "same area"}</em>!
       <br><small>Solved in <strong>${timeStr}</strong> with <strong>${moveCount}</strong> move${moveCount !== 1 ? "s" : ""}${bestNote}</small>`
    );
    document.getElementById("check-btn").disabled = true;
    highlightMurderer();
  } else {
    showBanner("error", "❌ That placement is not correct. Review the clues and try again.");
  }
}

function highlightMurderer() {
  const [mr, mc] = currentPuzzle.solution[currentPuzzle.murderer];
  const cell = document.querySelector(`.grid-cell[data-row="${mr}"][data-col="${mc}"]`);
  if (cell) cell.classList.add("murderer-reveal");
}

function showBanner(type, html) {
  const banner = document.getElementById("result-banner");
  banner.className = `result-banner banner-${type}`;
  banner.innerHTML = html;
}

/* ── Help Modal ─────────────────────────────────────────────────── */
document.getElementById("help-btn").addEventListener("click", () => {
  document.getElementById("help-modal").classList.remove("hidden");
});
document.getElementById("close-help").addEventListener("click", () => {
  document.getElementById("help-modal").classList.add("hidden");
});
document.getElementById("help-modal").addEventListener("click", (e) => {
  if (e.target.id === "help-modal") document.getElementById("help-modal").classList.add("hidden");
});
