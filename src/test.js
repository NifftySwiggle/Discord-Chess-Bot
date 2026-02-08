import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  const htmlContent = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
  await page.setContent(htmlContent.replace('{{theme}}', 'default'));
  await page.addScriptTag({ path: path.join(__dirname, '../node_modules/chessboardjs/dist/chessboard-1.0.0.min.js') });
  await page.waitForFunction('typeof Chessboard === "function"', { timeout: 10000 });
  await page.evaluate(({ fen, theme, unicodePieces }) => {
    const board = Chessboard('board', { position: fen });
    document.querySelectorAll('.piece').forEach(pieceElement => {
      const piece = pieceElement.getAttribute('data-piece');
      if (unicodePieces[piece]) {
        pieceElement.innerHTML = `<span class="unicode-piece">${unicodePieces[piece]}</span>`;
        pieceElement.style.backgroundImage = 'none';
      }
    });
    document.getElementById('board').className = 'board-theme-' + theme;
  }, {
    fen: 'rnbqkbnr/pppppppp/5n5/8/8/5N5/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    theme: 'default',
    unicodePieces: {
      'wK': '♔', 'wQ': '♕', 'wR': '♖', 'wB': '♗', 'wN': '♘', 'wP': '♙',
      'bK': '♚', 'bQ': '♛', 'bR': '♜', 'bB': '♝', 'bN': '♞', 'bP': '♟'
    }
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test.png' });
  await browser.close();
})();
