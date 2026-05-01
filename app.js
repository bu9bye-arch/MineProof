const LEVELS = {
  easy: { rows: 9, cols: 9, mines: 10, cellSize: 38 },
  medium: { rows: 12, cols: 14, mines: 28, cellSize: 34 },
  hard: { rows: 16, cols: 18, mines: 54, cellSize: 30 },
};

const boardEl = document.querySelector("#board");
const gameSurfaceEl = document.querySelector(".game-surface");
const mineCounterEl = document.querySelector("#mineCounter");
const timerEl = document.querySelector("#timer");
const statusTitleEl = document.querySelector("#gameStatus");
const statusTextEl = document.querySelector("#statusText");
const logListEl = document.querySelector("#logList");
const autoFlagToggle = document.querySelector("#autoFlagToggle");
const soundToggle = document.querySelector("#soundToggle");
const newGameButton = document.querySelector("#newGame");
const levelButtons = [...document.querySelectorAll("[data-level]")];
const KEY_ROOTS = [261.63, 293.66, 329.63, 392.0, 440.0];
const MARK_SCALE_RATIOS = [1, 1.125, 1.25, 1.5, 1.667, 2];
const MASTER_VOLUME = 0.55;
const AUTO_ACCELERATION_MS = 12000;

let levelName = "easy";
let config = LEVELS[levelName];
let board = [];
let started = false;
let ended = false;
let timerId = null;
let seconds = 0;
let autoFlagSerial = 0;
let proofNumberKeys = new Set();
let proofTargetKeys = new Set();
let proofInfluenceLevels = new Map();
let directHintNumberKeys = new Set();
let directHintCellKeys = new Set();
let proofTimerIds = [];
let autoSequenceRunning = false;
let pendingAutoMarks = [];
let comboCount = 0;
let comboCelebrationTimer = null;
let boardShakeTimer = null;
let speedRampTimer = null;
let speedRampStartedAt = 0;
let audioContext = null;
let masterGain = null;
let lastToneStartedAt = 0;
let keyStep = 0;
let currentMarkKeyRoot = KEY_ROOTS[0];
let playbackSpeed = 1;

function createGame(nextLevel = levelName) {
  levelName = nextLevel;
  config = LEVELS[levelName];
  board = Array.from({ length: config.rows }, (_, row) =>
    Array.from({ length: config.cols }, (_, col) => ({
      row,
      col,
      mine: false,
      open: false,
      flagged: false,
      auto: false,
      value: 0,
    })),
  );
  started = false;
  ended = false;
  seconds = 0;
  autoFlagSerial = 0;
  comboCount = 0;
  resetPlaybackSpeed();
  clearComboCelebration();
  clearBoardShake();
  clearProofAnimation();
  clearInterval(timerId);
  timerId = null;
  timerEl.textContent = "000";
  statusTitleEl.textContent = "准备开始";
  statusTextEl.textContent = "首点安全。翻开数字后，系统只会在边界数字形成双重验证时自动插旗。";
  logListEl.replaceChildren();
  updateLevelButtons();
  render();
}

function updateLevelButtons() {
  for (const button of levelButtons) {
    button.classList.toggle("is-active", button.dataset.level === levelName);
  }
}

function startTimer() {
  if (timerId) return;
  timerId = setInterval(() => {
    seconds += 1;
    timerEl.textContent = String(seconds).padStart(3, "0");
  }, 1000);
}

function placeMines(safeRow, safeCol) {
  const safeCells = new Set(neighborsOf(safeRow, safeCol).map(keyOf));
  safeCells.add(`${safeRow},${safeCol}`);

  const candidates = [];
  forEachCell((cell) => {
    if (!safeCells.has(keyOf(cell))) candidates.push(cell);
  });

  shuffle(candidates);
  for (const cell of candidates.slice(0, config.mines)) {
    cell.mine = true;
  }

  forEachCell((cell) => {
    cell.value = neighborsOf(cell.row, cell.col).filter((item) => item.mine).length;
  });
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function render() {
  boardEl.style.setProperty("--rows", config.rows);
  boardEl.style.setProperty("--cols", config.cols);
  boardEl.style.setProperty("--cell-size", `${config.cellSize}px`);
  boardEl.replaceChildren();

  forEachCell((cell) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = classForCell(cell);
    button.dataset.row = cell.row;
    button.dataset.col = cell.col;
    button.setAttribute("aria-label", labelForCell(cell));
    button.textContent = textForCell(cell);
    boardEl.append(button);
  });

  const flags = countCells((cell) => cell.flagged);
  mineCounterEl.textContent = String(Math.max(config.mines - flags, 0));
}

function classForCell(cell) {
  const classes = ["cell"];
  if (cell.open) classes.push("is-open");
  if (cell.flagged) classes.push("is-flagged");
  if (cell.auto) classes.push("is-auto");
  if (proofNumberKeys.has(keyOf(cell))) classes.push("is-proof-number");
  if (proofTargetKeys.has(keyOf(cell))) classes.push("is-proof-target");
  if (directHintNumberKeys.has(keyOf(cell))) classes.push("is-direct-hint-number");
  if (!cell.open && !cell.flagged && directHintCellKeys.has(keyOf(cell))) classes.push("is-direct-hint-cell");
  if (!cell.open && !cell.flagged && proofInfluenceLevels.has(keyOf(cell))) {
    classes.push(`is-influence-${proofInfluenceLevels.get(keyOf(cell))}`);
  }
  if (ended && cell.mine) classes.push("is-mine");
  if (cell.open && cell.value > 0) classes.push(`n${cell.value}`);
  return classes.join(" ");
}

function textForCell(cell) {
  if (ended && cell.mine && !cell.flagged) return "✹";
  if (cell.flagged) return cell.auto ? "⚑" : "⚐";
  if (!cell.open) return "";
  return cell.value > 0 ? String(cell.value) : "";
}

function labelForCell(cell) {
  if (cell.flagged) return cell.auto ? "自动标记的雷" : "已标记";
  if (!cell.open) return "未翻开";
  if (cell.value === 0) return "空白安全格";
  return `数字 ${cell.value}`;
}

function handleReveal(row, col) {
  if (ended) return;
  const cell = board[row][col];
  if (cell.open || cell.flagged) return;

  if (!started) {
    placeMines(row, col);
    started = true;
    startTimer();
  }

  if (cell.mine) {
    cell.open = true;
    finish(false);
    return;
  }

  revealFrom(cell);
  runAutoFlagging();
  checkWin();
  render();
}

function revealFrom(startCell) {
  const queue = [startCell];
  const seen = new Set();

  while (queue.length) {
    const cell = queue.shift();
    if (seen.has(keyOf(cell)) || cell.flagged || cell.open) continue;
    seen.add(keyOf(cell));
    cell.open = true;

    if (cell.value === 0) {
      for (const neighbor of neighborsOf(cell.row, cell.col)) {
        if (!neighbor.open && !neighbor.flagged && !neighbor.mine) {
          queue.push(neighbor);
        }
      }
    }
  }
}

function toggleFlag(row, col) {
  if (ended) return;
  const cell = board[row][col];
  if (cell.open) return;
  cell.flagged = !cell.flagged;
  cell.auto = false;
  statusTitleEl.textContent = "手动标记已更新";
  statusTextEl.textContent = "手动旗子只用于玩家记录，不会作为自动推理事实；自动标记仍需双重验证。";
  runAutoFlagging();
  checkWin();
  render();
}

function runAutoFlagging() {
  if (!started || ended || !autoFlagToggle.checked) return;
  if (autoSequenceRunning) return;
  directHintNumberKeys = new Set();
  directHintCellKeys = new Set();
  pendingAutoMarks = [];
  keyStep = 0;
  currentMarkKeyRoot = KEY_ROOTS[0];
  autoSequenceRunning = true;
  playNextAutoFlagStep(0);
}

function playNextAutoFlagStep(markedCount) {
  if (!started || ended || !autoFlagToggle.checked) {
    autoSequenceRunning = false;
    clearProofAnimation();
    if (!autoFlagToggle.checked) resetPlaybackSpeed();
    render();
    return;
  }

  const nextMark = findNextAutoFlagCandidate();
  if (!nextMark) {
    autoSequenceRunning = false;
    resetPlaybackSpeed();
    comboCount = 0;
    proofNumberKeys = new Set();
    proofTargetKeys = new Set();
    proofInfluenceLevels = new Map();
    const hintCount = showDirectBoundaryHints();

    if (hintCount > 0 && markedCount > 0) {
      statusTitleEl.textContent = `自动标记 ${markedCount} 个雷`;
      statusTextEl.textContent = "已完成本轮自动标记，并继续提示当前单数字可直接推出的必雷候选。";
    } else if (markedCount > 0) {
      statusTitleEl.textContent = `自动标记 ${markedCount} 个雷`;
      statusTextEl.textContent = "所有可双验确认的雷点已按顺序标出。";
    } else if (started) {
      if (hintCount === 0) {
        statusTitleEl.textContent = "暂无可自动标记";
        statusTextEl.textContent = "当前边界信息还不够严格，系统不会猜测。";
      }
    }

    checkWin();
    render();
    return;
  }

  animateAutoFlagStep(nextMark, () => {
    const cell = cellFromKey(nextMark.cellKey);
    const validation = cell && !cell.open && !cell.flagged ? validateBoundaryCandidate(cell) : { confirmed: false };

    if (validation.confirmed) {
      cell.flagged = true;
      cell.auto = true;
      addLog(cell, nextMark.evidence, validation.solutionCount);
      statusTitleEl.textContent = `确认 R${cell.row + 1} C${cell.col + 1}`;
      statusTextEl.textContent =
        nextMark.certainty === 1
          ? "单个数字的剩余雷数已经等于未揭示格数量，目标格通过验证后落成自动旗。"
          : "数字依次跳动完成，目标格通过局部解枚举后落成自动旗。";
      render();
      checkWin();
      comboCount += 1;
      replayMarkTones(nextMark.playedFrequencies ?? []);
      if (comboCount >= 2) {
        startPlaybackSpeedRamp();
      }
      if (comboCount >= 3) {
        triggerBoardShake();
      }
      if (comboCount > 3) {
        triggerComboCelebration(comboCount);
      }
      scheduleProofTimer(() => playNextAutoFlagStep(markedCount + 1), replayDelayFor(nextMark.playedFrequencies ?? []));
      return;
    }

    proofNumberKeys = new Set();
    proofTargetKeys = new Set();
    proofInfluenceLevels = new Map();
    directHintNumberKeys = new Set();
    directHintCellKeys = new Set();
    render();
    scheduleProofTimer(() => playNextAutoFlagStep(markedCount), 180);
  });
}

function findNextAutoFlagCandidate() {
  if (pendingAutoMarks.length === 0) {
    pendingAutoMarks = buildAutoFlagCandidates();
  }

  const nextMark = pendingAutoMarks.shift() ?? null;
  if (nextMark) nextMark.keyRoot = nextKeyRoot();
  return nextMark;
}

function buildAutoFlagCandidates() {
  const directEvidence = collectDirectBoundaryEvidence();
  const candidateMap = new Map();

  const directHints = collectDirectBoundaryHints();

  for (const [hintIndex, hint] of directHints.entries()) {
    const evidenceKey = keyOf(hint.numberCell);

    for (const cell of hint.hidden) {
      if (cell.open || cell.flagged) continue;

      const validation = validateBoundaryCandidate(cell);
      if (!validation.confirmed) continue;

      candidateMap.set(keyOf(cell), {
        cell,
        cellKey: keyOf(cell),
        evidence: new Set([evidenceKey]),
        solutionCount: validation.solutionCount,
        smallestInfluence: visibleInfluenceNeighbors(hint.numberCell).length,
        certainty: 1,
        groupRank: hintIndex,
      });
    }
  }

  for (const [cellKey, evidence] of directEvidence.entries()) {
    const cell = cellFromKey(cellKey);
    if (!cell || cell.open || cell.flagged || evidence.size < 2) continue;

    const validation = validateBoundaryCandidate(cell);
    if (validation.confirmed) {
      const orderedEvidence = orderEvidenceByInfluenceSize(evidence);
      const candidate = {
        cell,
        cellKey,
        evidence: new Set(orderedEvidence),
        solutionCount: validation.solutionCount,
        smallestInfluence: visibleInfluenceNeighbors(cellFromKey(orderedEvidence[0])).length,
        certainty: 2,
        groupRank: 1000 + candidateMap.size,
      };

      const current = candidateMap.get(cellKey);
      if (current) {
        for (const evidenceKey of orderedEvidence) {
          current.evidence.add(evidenceKey);
        }
        current.evidence = new Set(orderEvidenceByInfluenceSize(current.evidence));
        current.certainty = Math.max(current.certainty, candidate.certainty);
        current.solutionCount = candidate.solutionCount;
        current.smallestInfluence = Math.min(current.smallestInfluence, candidate.smallestInfluence);
      } else {
        candidateMap.set(cellKey, candidate);
      }
    }
  }

  const candidates = [...candidateMap.values()];
  candidates.sort((a, b) => {
    if (a.groupRank !== b.groupRank) return a.groupRank - b.groupRank;
    if (a.smallestInfluence !== b.smallestInfluence) return a.smallestInfluence - b.smallestInfluence;
    if (a.certainty !== b.certainty) return b.certainty - a.certainty;
    if (a.evidence.size !== b.evidence.size) return a.evidence.size - b.evidence.size;
    return a.cellKey.localeCompare(b.cellKey);
  });

  return candidates;
}

function showDirectBoundaryHints() {
  const hints = collectDirectBoundaryHints();
  directHintNumberKeys = new Set();
  directHintCellKeys = new Set();

  for (const hint of hints) {
    directHintNumberKeys.add(keyOf(hint.numberCell));
    for (const cell of hint.hidden) {
      directHintCellKeys.add(keyOf(cell));
    }
  }

  if (hints.length > 0) {
    const smallestHint = hints[0];
    statusTitleEl.textContent = "直接提示";
    statusTextEl.textContent = `数字 ${smallestHint.numberCell.value} 扣除当前可见旗子后，正好剩 ${smallestHint.hidden.length} 个未揭示格，因此这些格会被提示为必雷候选；自动落旗仍需双重验证。`;
    return hints.reduce((total, hint) => total + hint.hidden.length, 0);
  }

  return 0;
}

function collectDirectBoundaryHints() {
  const hints = [];

  for (const numberCell of boundaryNumberCells()) {
    const hidden = unflaggedHiddenNeighbors(numberCell);
    const flagged = visibleFlaggedNeighbors(numberCell).length;
    const remaining = numberCell.value - flagged;

    if (remaining > 0 && hidden.length === remaining) {
      hints.push({ numberCell, hidden, remaining });
    }
  }

  hints.sort((a, b) => {
    if (a.hidden.length !== b.hidden.length) return a.hidden.length - b.hidden.length;
    return keyOf(a.numberCell).localeCompare(keyOf(b.numberCell));
  });

  return hints;
}

function animateAutoFlagStep(mark, done) {
  const evidenceKeys = getDisplayEvidenceKeys(mark);
  mark.playedFrequencies = [];
  currentMarkKeyRoot = mark.keyRoot ?? currentMarkKeyRoot;
  statusTitleEl.textContent = "边界数字计算中";
  statusTextEl.textContent = "从周围未揭示格最少的数字开始，依次展示影响范围和重叠强度。";

  function pulseEvidence(index) {
    if (!autoSequenceRunning || ended || !autoFlagToggle.checked) return;

    if (index < evidenceKeys.length) {
      const previousInfluenceLevels = proofInfluenceLevels;
      proofNumberKeys = new Set([evidenceKeys[index]]);
      proofTargetKeys = new Set();
      proofInfluenceLevels = buildInfluenceLevels(evidenceKeys.slice(0, index + 1));
      const numberCell = cellFromKey(evidenceKeys[index]);
      const influenceSize = numberCell ? visibleInfluenceNeighbors(numberCell).length : 0;
      const evidenceFrequency = evidenceFrequencyForStep(index);
      mark.playedFrequencies.push(evidenceFrequency);
      if (index > 0 && hasInfluenceOverlap(numberCell, previousInfluenceLevels)) {
        playOverlapChord(evidenceFrequency);
      } else {
        playInfluenceTone(evidenceFrequency);
      }
      statusTitleEl.textContent = numberCell ? `展示 R${numberCell.row + 1} C${numberCell.col + 1}` : "展示边界数字";
      statusTextEl.textContent = `这个数字影响 ${influenceSize} 个未揭示格；重叠格会从绿色递进到蓝色、紫色、金色、红色。`;
      render();
      scheduleProofTimer(() => pulseEvidence(index + 1), 640);
      return;
    }

    proofNumberKeys = new Set(evidenceKeys);
    proofInfluenceLevels = buildInfluenceLevels(evidenceKeys);
    proofTargetKeys = new Set([mark.cellKey]);
    playConfirmTone();
    statusTitleEl.textContent = `显示 R${mark.cell.row + 1} C${mark.cell.col + 1}`;
    statusTextEl.textContent = `${evidenceKeys.length} 个边界数字的影响范围在这里完成双重验证。`;
    render();
    scheduleProofTimer(done, 860);
  }

  pulseEvidence(0);
}

function getDisplayEvidenceKeys(mark) {
  const displayKeys = new Set(mark.evidence);
  const targetCell = cellFromKey(mark.cellKey);

  if (targetCell) {
    for (const numberCell of openNumberNeighbors(targetCell)) {
      displayKeys.add(keyOf(numberCell));
    }
  }

  return orderEvidenceByInfluenceSize(displayKeys);
}

function orderEvidenceByInfluenceSize(evidence) {
  return [...evidence].sort((a, b) => {
    const cellA = cellFromKey(a);
    const cellB = cellFromKey(b);
    const sizeA = cellA ? visibleInfluenceNeighbors(cellA).length : Number.MAX_SAFE_INTEGER;
    const sizeB = cellB ? visibleInfluenceNeighbors(cellB).length : Number.MAX_SAFE_INTEGER;

    if (sizeA !== sizeB) return sizeA - sizeB;
    return a.localeCompare(b);
  });
}

function buildInfluenceLevels(evidenceKeys) {
  const levels = new Map();

  for (const evidenceKey of evidenceKeys) {
    const numberCell = cellFromKey(evidenceKey);
    if (!numberCell) continue;

    for (const neighbor of visibleInfluenceNeighbors(numberCell)) {
      const neighborKey = keyOf(neighbor);
      const nextLevel = Math.min((levels.get(neighborKey) ?? 0) + 1, 5);
      levels.set(neighborKey, nextLevel);
    }
  }

  return levels;
}

function hasInfluenceOverlap(numberCell, previousLevels) {
  if (!numberCell || previousLevels.size === 0) return false;
  return visibleInfluenceNeighbors(numberCell).some((cell) => previousLevels.has(keyOf(cell)));
}

function playInfluenceTone(frequency) {
  if (!soundToggle.checked) return;
  playTone({ frequency, duration: 0.16, volume: 0.038, type: "triangle" });
}

function playConfirmTone() {
  if (!soundToggle.checked) return;
  playTone({ frequency: currentMarkKeyRoot * 1.5, duration: 0.12, volume: 0.035, type: "triangle" });
  playTone({ frequency: currentMarkKeyRoot * 2, duration: 0.18, volume: 0.032, offset: 0.08, type: "sine" });
}

function replayMarkTones(frequencies) {
  if (!soundToggle.checked || frequencies.length === 0) return;
  const uniqueFrequencies = [...new Set(frequencies)];

  for (const [index, frequency] of uniqueFrequencies.entries()) {
    playTone({
      frequency,
      duration: 0.11,
      volume: 0.026,
      offset: 0.14 + index * 0.085,
      type: "sine",
    });
  }

  const confirmOffset = 0.14 + uniqueFrequencies.length * 0.085;
  playTone({
    frequency: currentMarkKeyRoot * 2,
    duration: 0.16,
    volume: 0.03,
    offset: confirmOffset,
    type: "triangle",
  });
}

function replayDelayFor(frequencies) {
  const replayTime = Math.min(new Set(frequencies).size, 8) * 90;
  return 520 + replayTime;
}

function triggerComboCelebration(count) {
  clearComboCelebration();
  const layer = document.createElement("div");
  layer.className = "combo-celebration";
  layer.innerHTML = `<div class="combo-toast">COMBO ×${count}<span>YEAH~</span></div>`;
  layer.append(createFirework("left"));
  layer.append(createFirework("right"));
  gameSurfaceEl.append(layer);
  playYeahTone();

  comboCelebrationTimer = setTimeout(() => {
    layer.remove();
    comboCelebrationTimer = null;
  }, 1700);
}

function createFirework(side) {
  const firework = document.createElement("div");
  firework.className = `firework firework-${side}`;
  const colors = ["#2d7d46", "#2469b2", "#5b4baa", "#c58518", "#d24b3c", "#ffffff"];
  const startAngle = side === "left" ? -78 : -168;
  const endAngle = side === "left" ? -22 : -112;

  for (let index = 0; index < 18; index += 1) {
    const spark = document.createElement("span");
    const angle = ((startAngle + ((endAngle - startAngle) * index) / 17) * Math.PI) / 180;
    const distance = 44 + (index % 4) * 12;
    spark.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    spark.style.setProperty("--y", `${Math.sin(angle) * distance}px`);
    spark.style.setProperty("--spark", colors[index % colors.length]);
    firework.append(spark);
  }

  return firework;
}

function clearComboCelebration() {
  if (comboCelebrationTimer) {
    clearTimeout(comboCelebrationTimer);
    comboCelebrationTimer = null;
  }
  document.querySelectorAll(".combo-celebration").forEach((item) => item.remove());
}

function playYeahTone() {
  if (!soundToggle.checked) return;
  playTone({ frequency: currentMarkKeyRoot, duration: 0.13, volume: 0.035, type: "triangle" });
  playTone({ frequency: currentMarkKeyRoot * 1.25, duration: 0.16, volume: 0.032, offset: 0.07, type: "triangle" });
  playTone({ frequency: currentMarkKeyRoot * 1.5, duration: 0.18, volume: 0.03, offset: 0.14, type: "sine" });
  playTone({ frequency: currentMarkKeyRoot * 2, duration: 0.24, volume: 0.028, offset: 0.22, type: "sine" });
}

function playOverlapChord(root) {
  if (!soundToggle.checked) return;
  playTone({ frequency: root, duration: 0.18, volume: 0.026, type: "triangle" });
  playTone({ frequency: root * 1.25, duration: 0.18, volume: 0.024, offset: 0.055, type: "triangle" });
  playTone({ frequency: root * 1.5, duration: 0.2, volume: 0.022, offset: 0.11, type: "sine" });
}

function nextKeyRoot() {
  const keyIndex = keyStep % KEY_ROOTS.length;
  const octave = Math.floor(keyStep / KEY_ROOTS.length);
  const frequency = KEY_ROOTS[keyIndex] * 2 ** octave;
  keyStep += 1;
  return Math.min(frequency, 880);
}

function evidenceFrequencyForStep(index) {
  const scaleIndex = index % MARK_SCALE_RATIOS.length;
  const octave = Math.floor(index / MARK_SCALE_RATIOS.length);
  return Math.min(currentMarkKeyRoot * MARK_SCALE_RATIOS[scaleIndex] * 2 ** octave, 1320);
}

function playTone({ frequency, duration, volume, type = "sine", offset = 0 }) {
  const context = getAudioContext();
  if (!context) return;

  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const scaledDuration = duration / playbackSpeed;
  const scaledOffset = offset / playbackSpeed;
  const now = Math.max(context.currentTime + scaledOffset, lastToneStartedAt + 0.018 / playbackSpeed);
  const attack = 0.014;
  const releaseStart = Math.max(now + attack + 0.02 / playbackSpeed, now + scaledDuration * 0.62);
  const end = now + scaledDuration;

  lastToneStartedAt = now;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1800, now);
  filter.frequency.exponentialRampToValueAtTime(900, end);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + attack);
  gain.gain.setTargetAtTime(volume * 0.42, now + attack, 0.045);
  gain.gain.exponentialRampToValueAtTime(0.0001, releaseStart + (end - releaseStart));

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  oscillator.start(now);
  oscillator.stop(end + 0.04);
}

function getAudioContext() {
  if (!soundToggle.checked) return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) {
    audioContext = new AudioContextClass();
    const compressor = audioContext.createDynamicsCompressor();
    masterGain = audioContext.createGain();

    compressor.threshold.setValueAtTime(-26, audioContext.currentTime);
    compressor.knee.setValueAtTime(18, audioContext.currentTime);
    compressor.ratio.setValueAtTime(6, audioContext.currentTime);
    compressor.attack.setValueAtTime(0.004, audioContext.currentTime);
    compressor.release.setValueAtTime(0.16, audioContext.currentTime);
    masterGain.gain.setValueAtTime(MASTER_VOLUME, audioContext.currentTime);
    masterGain.connect(compressor);
    compressor.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function scheduleProofTimer(callback, delay) {
  const timerId = setTimeout(() => {
    proofTimerIds = proofTimerIds.filter((item) => item !== timerId);
    callback();
  }, scaledDelay(delay));
  proofTimerIds.push(timerId);
}

function scaledDelay(delay) {
  return Math.max(40, delay / playbackSpeed);
}

function setPlaybackSpeed(nextSpeed) {
  playbackSpeed = Math.max(nextSpeed, 1);
  document.documentElement.style.setProperty("--motion-scale", String(1 / playbackSpeed));
}

function resetPlaybackSpeed() {
  if (speedRampTimer) {
    clearInterval(speedRampTimer);
    speedRampTimer = null;
  }
  speedRampStartedAt = 0;
  setPlaybackSpeed(1);
}

function startPlaybackSpeedRamp() {
  if (speedRampTimer || playbackSpeed >= 2) return;
  speedRampStartedAt = performance.now();
  speedRampTimer = setInterval(updatePlaybackSpeedRamp, 120);
  updatePlaybackSpeedRamp();
}

function updatePlaybackSpeedRamp() {
  const elapsed = performance.now() - speedRampStartedAt;
  const progress = Math.min(elapsed / AUTO_ACCELERATION_MS, 1);
  setPlaybackSpeed(1 + progress);

  if (progress >= 1 && speedRampTimer) {
    clearInterval(speedRampTimer);
    speedRampTimer = null;
  }
}

function triggerBoardShake() {
  clearBoardShake();
  boardEl.classList.add("is-shaking");
  boardShakeTimer = setTimeout(clearBoardShake, scaledDelay(430));
}

function clearBoardShake() {
  if (boardShakeTimer) {
    clearTimeout(boardShakeTimer);
    boardShakeTimer = null;
  }
  boardEl.classList.remove("is-shaking");
}

function clearProofAnimation() {
  for (const timerId of proofTimerIds) {
    clearTimeout(timerId);
  }
  proofTimerIds = [];
  proofNumberKeys = new Set();
  proofTargetKeys = new Set();
  proofInfluenceLevels = new Map();
  directHintNumberKeys = new Set();
  directHintCellKeys = new Set();
  pendingAutoMarks = [];
  keyStep = 0;
  currentMarkKeyRoot = KEY_ROOTS[0];
  autoSequenceRunning = false;
}

function collectDirectBoundaryEvidence() {
  const evidence = new Map();

  for (const numberCell of boundaryNumberCells()) {
    const hidden = hiddenNeighbors(numberCell);
    const flagged = flaggedNeighbors(numberCell).length;
    const remaining = numberCell.value - flagged;

    if (remaining <= 0 || hidden.length === 0 || remaining !== hidden.length) continue;

    for (const candidate of hidden) {
      const candidateKey = keyOf(candidate);
      if (!evidence.has(candidateKey)) evidence.set(candidateKey, new Set());
      evidence.get(candidateKey).add(keyOf(numberCell));
    }
  }

  return evidence;
}

function validateBoundaryCandidate(candidate) {
  const relatedNumbers = openNumberNeighbors(candidate);
  if (relatedNumbers.length === 0) return { confirmed: false, solutionCount: 0 };

  const numberMap = new Map(relatedNumbers.map((cell) => [keyOf(cell), cell]));
  for (const numberCell of relatedNumbers) {
    for (const hidden of hiddenNeighbors(numberCell)) {
      for (const numberNeighbor of openNumberNeighbors(hidden)) {
        numberMap.set(keyOf(numberNeighbor), numberNeighbor);
      }
    }
  }

  const constraints = [...numberMap.values()];
  const variableMap = new Map();

  for (const numberCell of constraints) {
    for (const hidden of hiddenNeighbors(numberCell)) {
      variableMap.set(keyOf(hidden), hidden);
    }
  }

  if (!variableMap.has(keyOf(candidate))) {
    return { confirmed: false, solutionCount: 0 };
  }

  const variables = [...variableMap.values()];
  if (variables.length > 22) {
    return { confirmed: false, solutionCount: 0 };
  }

  const variableIndex = new Map(variables.map((cell, index) => [keyOf(cell), index]));
  const checks = constraints.map((numberCell) => {
    const variableIndexes = hiddenNeighbors(numberCell).map((cell) => variableIndex.get(keyOf(cell)));
    return {
      indexes: variableIndexes,
      target: numberCell.value - flaggedNeighbors(numberCell).length,
    };
  });

  if (checks.some((check) => check.target < 0 || check.target > check.indexes.length)) {
    return { confirmed: false, solutionCount: 0 };
  }

  const candidateIndex = variableIndex.get(keyOf(candidate));
  let solutionCount = 0;
  let candidateTrueInEverySolution = true;
  const assignment = Array(variables.length).fill(false);

  function search(index) {
    if (solutionCount > 3000) return;
    if (!partialConstraintsPossible(index)) return;

    if (index === variables.length) {
      if (!allConstraintsSatisfied()) return;
      solutionCount += 1;
      if (!assignment[candidateIndex]) candidateTrueInEverySolution = false;
      return;
    }

    assignment[index] = false;
    search(index + 1);
    assignment[index] = true;
    search(index + 1);
    assignment[index] = false;
  }

  function partialConstraintsPossible(nextIndex) {
    for (const check of checks) {
      let assignedMines = 0;
      let unassigned = 0;

      for (const variable of check.indexes) {
        if (variable < nextIndex) {
          if (assignment[variable]) assignedMines += 1;
        } else {
          unassigned += 1;
        }
      }

      if (assignedMines > check.target) return false;
      if (assignedMines + unassigned < check.target) return false;
    }
    return true;
  }

  function allConstraintsSatisfied() {
    return checks.every((check) => {
      const mines = check.indexes.reduce((total, variable) => total + (assignment[variable] ? 1 : 0), 0);
      return mines === check.target;
    });
  }

  search(0);

  return {
    confirmed: solutionCount > 0 && candidateTrueInEverySolution,
    solutionCount,
  };
}

function addLog(cell, evidence, solutionCount) {
  autoFlagSerial += 1;
  const item = document.createElement("li");
  const evidenceText = [...evidence]
    .map((item) => cellFromKey(item))
    .filter(Boolean)
    .map((item) => `R${item.row + 1}C${item.col + 1}`)
    .join("、");
  item.innerHTML = `<strong>#${autoFlagSerial}</strong> R${cell.row + 1} C${cell.col + 1}：由 ${evidenceText} 直接推出，${solutionCount} 个局部合法解均为雷。`;
  logListEl.prepend(item);
}

function checkWin() {
  if (!started || ended) return;
  const openedSafeCells = countCells((cell) => cell.open && !cell.mine);
  const totalSafeCells = config.rows * config.cols - config.mines;
  if (openedSafeCells === totalSafeCells) finish(true);
}

function finish(won) {
  ended = true;
  resetPlaybackSpeed();
  clearProofAnimation();
  clearInterval(timerId);
  timerId = null;

  if (won) {
    statusTitleEl.textContent = "成功排雷";
    statusTextEl.textContent = "所有安全格都已翻开，自动标记没有越过双重验证边界。";
  } else {
    statusTitleEl.textContent = "触雷结束";
    statusTextEl.textContent = "本局已展示全部雷点，可以开新局继续测试自动标记规则。";
  }
  render();
}

function boundaryNumberCells() {
  const cells = [];
  forEachCell((cell) => {
    if (cell.open && cell.value > 0 && hiddenNeighbors(cell).length > 0) {
      cells.push(cell);
    }
  });
  return cells;
}

function hiddenNeighbors(cell) {
  return neighborsOf(cell.row, cell.col).filter((item) => !item.open && !(item.flagged && item.auto));
}

function unflaggedHiddenNeighbors(cell) {
  return neighborsOf(cell.row, cell.col).filter((item) => !item.open && !item.flagged);
}

function visibleInfluenceNeighbors(cell) {
  return neighborsOf(cell.row, cell.col).filter((item) => !item.open && !item.flagged);
}

function flaggedNeighbors(cell) {
  return neighborsOf(cell.row, cell.col).filter((item) => item.flagged && item.auto);
}

function visibleFlaggedNeighbors(cell) {
  return neighborsOf(cell.row, cell.col).filter((item) => item.flagged);
}

function openNumberNeighbors(cell) {
  return neighborsOf(cell.row, cell.col).filter((item) => item.open && item.value > 0);
}

function neighborsOf(row, col) {
  const cells = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (nextRow >= 0 && nextRow < config.rows && nextCol >= 0 && nextCol < config.cols) {
        cells.push(board[nextRow][nextCol]);
      }
    }
  }
  return cells;
}

function forEachCell(callback) {
  for (const row of board) {
    for (const cell of row) callback(cell);
  }
}

function countCells(predicate) {
  let count = 0;
  forEachCell((cell) => {
    if (predicate(cell)) count += 1;
  });
  return count;
}

function keyOf(cell) {
  return `${cell.row},${cell.col}`;
}

function cellFromKey(key) {
  const [row, col] = key.split(",").map(Number);
  return board[row]?.[col];
}

boardEl.addEventListener("click", (event) => {
  const button = event.target.closest(".cell");
  if (!button) return;
  handleReveal(Number(button.dataset.row), Number(button.dataset.col));
});

boardEl.addEventListener("contextmenu", (event) => {
  const button = event.target.closest(".cell");
  if (!button) return;
  event.preventDefault();
  toggleFlag(Number(button.dataset.row), Number(button.dataset.col));
});

newGameButton.addEventListener("click", () => createGame());

autoFlagToggle.addEventListener("change", () => {
  if (!autoFlagToggle.checked) {
    resetPlaybackSpeed();
    clearProofAnimation();
  } else {
    runAutoFlagging();
  }
  render();
});

for (const button of levelButtons) {
  button.addEventListener("click", () => createGame(button.dataset.level));
}

createGame();
