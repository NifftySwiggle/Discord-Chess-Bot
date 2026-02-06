const { Chess } = require('chess.js');
const { renderBoard } = require('./renderBoard');
const { getProfile } = require('./profiles');

async function startGame(white, black, threadId) {
  const chess = new Chess();
  const whiteProfile = await getProfile(white);
  return {
    chess,
    white,
    black,
    threadId,
    currentTurn: white,
    boardTheme: whiteProfile.boardTheme || 'default'
  };
}

async function makeMove(game, piece, to) {
  const moves = game.chess.moves({ square: piece, verbose: true });
  const move = moves.find(m => m.to === to);
  if (!move) return { valid: false };

  game.chess.move(move);
  game.currentTurn = game.chess.turn() === 'w' ? game.white : game.black;
  const profile = await getProfile(game.currentTurn);
  game.boardTheme = profile.boardTheme || 'default';

  return {
    valid: true,
    checkmate: game.chess.game_over() && game.chess.in_checkmate(),
    draw: game.chess.in_draw() || game.chess.in_stalemate() || game.chess.in_threefold_repetition(),
    check: game.chess.in_check()
  };
}

async function offerDraw(game, userId) {
  game.drawOfferedBy = userId;
}

async function acceptDraw(game) {
  // Draw accepted
}

async function declineDraw(game) {
  game.drawOfferedBy = null;
}

async function surrender(game, userId) {
  const winner = userId === game.white ? game.black : game.white;
  return { winner, surrendered: true };
}

export { startGame, makeMove, offerDraw, acceptDraw, declineDraw, surrender };
