const { Chess } = require('chess.js');

/**
 * Simple AI that makes random legal moves
 * Can be enhanced with better logic later
 */
function makeAIMove(game) {
  const moves = game.chess.moves({ verbose: true });
  
  if (moves.length === 0) {
    return null; // No legal moves (game over)
  }

  // Prioritize captures and checks for slightly smarter play
  const captures = moves.filter(m => m.captured);
  const checks = moves.filter(m => {
    const testChess = new Chess(game.chess.fen());
    testChess.move(m);
    return testChess.in_check();
  });

  let selectedMove;
  if (captures.length > 0 && Math.random() > 0.3) {
    // 70% chance to take a capture if available
    selectedMove = captures[Math.floor(Math.random() * captures.length)];
  } else if (checks.length > 0 && Math.random() > 0.7) {
    // 30% chance to check if available
    selectedMove = checks[Math.floor(Math.random() * checks.length)];
  } else {
    // Otherwise random move
    selectedMove = moves[Math.floor(Math.random() * moves.length)];
  }

  return selectedMove;
}

module.exports = { makeAIMove };
