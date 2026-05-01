# MineProof · 雷证

> **[中文](README.md)**

Minesweeper with boundary dual-verification auto-flagging. No guessing — only proving.

## How to Play

1. Click any cell to start (first click is always safe).
2. After revealing numbers, the system automatically finds and flags provable mines on the boundary.
3. Dual verification = at least two numbers each independently prove the same candidate is a mine, confirmed by local constraint enumeration over all valid solutions.
4. Consecutive auto-flags trigger acceleration — the performance speeds up with no upper limit within 12 seconds.
5. Manual flags are for your own notes only and do not participate in auto-reasoning.

## Difficulty

| Level  | Board  | Mines |
|--------|--------|-------|
| Easy   | 9×9    | 10    |
| Medium | 12×14  | 28    |
| Hard   | 16×18  | 54    |

## Features

- **Dual-verification auto-flagging**: No probability — every step is proven.
- **Accelerating performance**: Consecutive flags trigger a speed ramp that keeps getting faster.
- **Audio system**: Each number maps to a musical scale; flagging produces chord feedback.
- **Pure frontend**: Zero dependencies — just open `index.html`.

## Quick Start

```bash
git clone <repo-url>
cd MineProof
# Open in browser
open index.html      # macOS
start index.html     # Windows
xdg-open index.html  # Linux
```

## Project Structure

```
├── index.html      # Page structure
├── styles.css      # Styles & animations
├── app.js          # Game logic, rendering, audio, speed control
└── README.md       # Project docs
```

## License

MIT

---

> This project is a Vibe Coding product, generated with the assistance of Claude Opus 4.7.
