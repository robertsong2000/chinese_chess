// 棋规函数(走法生成、合法性、applyMove、将军检测等)。
// 与 src/constants.js 相同,通过 <script> 标签或 vm 共享词法环境,
// 被 app.js 引用。本文件必须在 constants.js 之后、app.js 之前加载。
//
// 说明:livePieces 的默认参数 board = state.board 中的 state 由 app.js 在
// 顶层 let state = createGame(...) 时初始化;默认参数仅在调用时求值,
// 因此即便 rules.js 加载时 state 尚未定义也不出错。

function livePieces(board = state.board) {
  return board.filter((piece) => piece.alive);
}

function boardIndex(board) {
  let index = BOARD_INDEX_CACHE.get(board);
  if (!index) {
    index = Array(90).fill(null);
    for (const piece of board) {
      if (piece.alive) index[piece.y * 9 + piece.x] = piece;
    }
    BOARD_INDEX_CACHE.set(board, index);
  }
  return index;
}

function pieceAt(board, x, y) {
  if (!inBoard(x, y)) return null;
  return boardIndex(board)[y * 9 + x];
}

function inBoard(x, y) {
  return x >= 0 && x <= 8 && y >= 0 && y <= 9;
}

function opposite(side) {
  return side === SIDES.RED ? SIDES.BLACK : SIDES.RED;
}

function sideName(side) {
  return side === SIDES.RED ? "红方" : "黑方";
}

function palaceContains(side, x, y) {
  if (x < 3 || x > 5) return false;
  return side === SIDES.RED ? y >= 7 && y <= 9 : y >= 0 && y <= 2;
}

function crossedRiver(side, y) {
  return side === SIDES.RED ? y <= 4 : y >= 5;
}

function rawMovesForPiece(board, piece, attacksOnly = false, includeFriendlyTargets = false) {
  if (!piece.alive) return [];
  const moves = [];
  const push = (x, y) => {
    if (!inBoard(x, y)) return;
    const target = pieceAt(board, x, y);
    if (!target || target.side !== piece.side || includeFriendlyTargets) moves.push(makeCandidate(piece, x, y, target));
  };

  if (piece.type === TYPES.CHARIOT || piece.type === TYPES.CANNON) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let x = piece.x + dx;
      let y = piece.y + dy;
      let screens = 0;
      while (inBoard(x, y)) {
        const target = pieceAt(board, x, y);
        if (piece.type === TYPES.CHARIOT) {
          if (!target) moves.push(makeCandidate(piece, x, y, null));
          else {
            if (target.side !== piece.side || includeFriendlyTargets) moves.push(makeCandidate(piece, x, y, target));
            break;
          }
        } else if (!target) {
          if (screens === 0 && !attacksOnly) moves.push(makeCandidate(piece, x, y, null));
        } else {
          screens += 1;
          if (screens === 2) {
            if (target.side !== piece.side || includeFriendlyTargets) moves.push(makeCandidate(piece, x, y, target));
            break;
          }
        }
        x += dx;
        y += dy;
      }
    }
  }

  if (piece.type === TYPES.HORSE) {
    [
      [1, 2, 0, 1],
      [-1, 2, 0, 1],
      [1, -2, 0, -1],
      [-1, -2, 0, -1],
      [2, 1, 1, 0],
      [2, -1, 1, 0],
      [-2, 1, -1, 0],
      [-2, -1, -1, 0],
    ].forEach(([dx, dy, lx, ly]) => {
      if (!pieceAt(board, piece.x + lx, piece.y + ly)) push(piece.x + dx, piece.y + dy);
    });
  }

  if (piece.type === TYPES.ELEPHANT) {
    [[2, 2], [2, -2], [-2, 2], [-2, -2]].forEach(([dx, dy]) => {
      const x = piece.x + dx;
      const y = piece.y + dy;
      const eyeX = piece.x + dx / 2;
      const eyeY = piece.y + dy / 2;
      const ownSide = piece.side === SIDES.RED ? y >= 5 : y <= 4;
      if (ownSide && !pieceAt(board, eyeX, eyeY)) push(x, y);
    });
  }

  if (piece.type === TYPES.ADVISOR) {
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dx, dy]) => {
      const x = piece.x + dx;
      const y = piece.y + dy;
      if (palaceContains(piece.side, x, y)) push(x, y);
    });
  }

  if (piece.type === TYPES.GENERAL) {
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      const x = piece.x + dx;
      const y = piece.y + dy;
      if (palaceContains(piece.side, x, y)) push(x, y);
    });
    const enemyGeneral = board.find((p) => p.alive && p.type === TYPES.GENERAL && p.side !== piece.side);
    if (enemyGeneral && enemyGeneral.x === piece.x && countBetween(board, piece.x, piece.y, enemyGeneral.y) === 0) {
      moves.push(makeCandidate(piece, enemyGeneral.x, enemyGeneral.y, enemyGeneral));
    }
  }

  if (piece.type === TYPES.SOLDIER) {
    const forward = piece.side === SIDES.RED ? -1 : 1;
    push(piece.x, piece.y + forward);
    if (crossedRiver(piece.side, piece.y)) {
      push(piece.x - 1, piece.y);
      push(piece.x + 1, piece.y);
    }
  }

  return moves;
}

function makeCandidate(piece, x, y, captured) {
  return {
    pieceId: piece.id,
    side: piece.side,
    pieceType: piece.type,
    fromX: piece.x,
    fromY: piece.y,
    toX: x,
    toY: y,
    capturedPieceId: captured ? captured.id : null,
  };
}

function countBetween(board, x, y1, y2) {
  const min = Math.min(y1, y2) + 1;
  const max = Math.max(y1, y2);
  let count = 0;
  for (let y = min; y < max; y += 1) {
    if (pieceAt(board, x, y)) count += 1;
  }
  return count;
}

function countLineBetween(board, x1, y1, x2, y2) {
  if (x1 === x2) return countBetween(board, x1, y1, y2);
  if (y1 !== y2) return Infinity;
  const min = Math.min(x1, x2) + 1;
  const max = Math.max(x1, x2);
  let count = 0;
  for (let x = min; x < max; x += 1) {
    if (pieceAt(board, x, y1)) count += 1;
  }
  return count;
}

function generalsFacing(board) {
  const red = board.find((p) => p.alive && p.type === TYPES.GENERAL && p.side === SIDES.RED);
  const black = board.find((p) => p.alive && p.type === TYPES.GENERAL && p.side === SIDES.BLACK);
  return red && black && red.x === black.x && countBetween(board, red.x, red.y, black.y) === 0;
}

function cloneBoard(board) {
  return board.map((piece) => ({ ...piece }));
}

function applyMoveToBoard(board, move) {
  const next = cloneBoard(board);
  const moving = next.find((piece) => piece.id === move.pieceId);
  const captured = next.find((piece) => piece.alive && piece.x === move.toX && piece.y === move.toY);
  if (captured) captured.alive = false;
  moving.x = move.toX;
  moving.y = move.toY;
  return next;
}

function isInCheck(board, side) {
  const general = board.find((p) => p.alive && p.side === side && p.type === TYPES.GENERAL);
  if (!general) return true;
  return livePieces(board)
    .filter((piece) => piece.side !== side)
    .some((piece) => pieceAttacksSquare(board, piece, general.x, general.y));
}

function pieceAttacksSquare(board, piece, x, y) {
  const dx = x - piece.x;
  const dy = y - piece.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (piece.type === TYPES.CHARIOT) {
    return (dx === 0 || dy === 0) && countLineBetween(board, piece.x, piece.y, x, y) === 0;
  }
  if (piece.type === TYPES.CANNON) {
    return (dx === 0 || dy === 0) && countLineBetween(board, piece.x, piece.y, x, y) === 1;
  }
  if (piece.type === TYPES.HORSE) {
    if (absX === 1 && absY === 2) return !pieceAt(board, piece.x, piece.y + Math.sign(dy));
    if (absX === 2 && absY === 1) return !pieceAt(board, piece.x + Math.sign(dx), piece.y);
    return false;
  }
  if (piece.type === TYPES.ELEPHANT) {
    const ownSide = piece.side === SIDES.RED ? y >= 5 : y <= 4;
    return absX === 2 && absY === 2 && ownSide && !pieceAt(board, piece.x + dx / 2, piece.y + dy / 2);
  }
  if (piece.type === TYPES.ADVISOR) {
    return absX === 1 && absY === 1 && palaceContains(piece.side, x, y);
  }
  if (piece.type === TYPES.GENERAL) {
    const adjacent = absX + absY === 1 && palaceContains(piece.side, x, y);
    const flyingGeneral = dx === 0 && countBetween(board, piece.x, piece.y, y) === 0;
    return adjacent || flyingGeneral;
  }
  if (piece.type === TYPES.SOLDIER) {
    const forward = piece.side === SIDES.RED ? -1 : 1;
    return (dx === 0 && dy === forward)
      || (dy === 0 && absX === 1 && crossedRiver(piece.side, piece.y));
  }
  return false;
}

function legalMovesForPiece(board, piece) {
  return rawMovesForPiece(board, piece).filter((move) => {
    const next = applyMoveToBoard(board, move);
    return !generalsFacing(next) && !isInCheck(next, piece.side);
  });
}

function allLegalMoves(board, side) {
  return livePieces(board)
    .filter((piece) => piece.side === side)
    .flatMap((piece) => legalMovesForPiece(board, piece));
}
