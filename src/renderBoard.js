
import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getProfile } from './profiles.js';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function renderBoard(fen, userId) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    const profile = await getProfile(userId);
    const theme = profile.boardTheme || 'default';
    const pieceTheme = profile.pieceTheme || 'unicode';

    // Validate FEN
    const fenParts = fen.split(' ');
    if (fenParts.length !== 6) {
      throw new Error(`Invalid FEN: ${fen}`);
    }

    // Create a temporary directory and copy piece images there if using PNG pieces
    let tempDir = null;
    let pieceImageMap = {};
    
    if (pieceTheme !== 'unicode') {
      const pieceNames = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'];
      for (const piece of pieceNames) {
        const sourcePath = path.join(__dirname, `../assets/${pieceTheme}/${piece}.png`);
        try {
          // Read the image file and convert to base64 data URI
          const imageBuffer = await fs.readFile(sourcePath);
          const base64Image = imageBuffer.toString('base64');
          pieceImageMap[piece] = `data:image/png;base64,${base64Image}`;
        } catch (error) {
          console.error(`Failed to load piece ${piece}:`, error.message);
          throw new Error(`Missing piece image: ${sourcePath}`);
        }
      }
    }

    // Read required files
    const jqueryPath = path.join(__dirname, '../node_modules/chessboardjs/www/js/jquery-1.10.1.min.js');
    const chessboardJsPath = path.join(__dirname, '../node_modules/chessboardjs/www/releases/0.1.0/js/chessboard-0.1.0.min.js');
    const chessboardCssPath = path.join(__dirname, '../node_modules/chessboardjs/www/releases/0.1.0/css/chessboard-0.1.0.min.css');
    
    const jqueryContent = await fs.readFile(jqueryPath, 'utf8');
    const chessboardJsContent = await fs.readFile(chessboardJsPath, 'utf8');
    const chessboardCssContent = await fs.readFile(chessboardCssPath, 'utf8');

    // Create HTML with inline scripts and styles
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Chess Board</title>
        <style>
          ${chessboardCssContent}
          
          /* Default theme - Classic brown/beige */
          .board-theme-default .white-1e1d7 {
            background-color: #f0d9b5 !important;
          }
          .board-theme-default .black-3c85d {
            background-color: #b58863 !important;
          }
          
          /* Blue theme */
          .board-theme-blue .white-1e1d7 {
            background-color: #e8f4f8 !important;
          }
          .board-theme-blue .black-3c85d {
            background-color: #4a90a4 !important;
          }
          
          /* Wood theme */
          .board-theme-wood .white-1e1d7 {
            background-color: #d4a574 !important;
          }
          .board-theme-wood .black-3c85d {
            background-color: #5c3a1e !important;
          }
          
          /* Green theme */
          .board-theme-green .white-1e1d7 {
            background-color: #ffffdd !important;
          }
          .board-theme-green .black-3c85d {
            background-color: #86a666 !important;
          }
          
          /* Purple theme */
          .board-theme-purple .white-1e1d7 {
            background-color: #e8d4f8 !important;
          }
          .board-theme-purple .black-3c85d {
            background-color: #8b5aa8 !important;
          }
          
          /* Red theme */
          .board-theme-red .white-1e1d7 {
            background-color: #ffd4d4 !important;
          }
          .board-theme-red .black-3c85d {
            background-color: #c74444 !important;
          }
          
          /* Marble theme */
          .board-theme-marble .white-1e1d7 {
            background-color: #f5f5f5 !important;
          }
          .board-theme-marble .black-3c85d {
            background-color: #888888 !important;
          }
          
          /* Neon theme */
          .board-theme-neon .white-1e1d7 {
            background-color: #00ff88 !important;
          }
          .board-theme-neon .black-3c85d {
            background-color: #ff00ff !important;
          }
          
          .unicode-piece { 
            font-size: 48px !important; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            height: 100%; 
            width: 100%;
            opacity: 1.0 !important;
            color: #000 !important;
          }
          /* Ensure no transparency on pieces */
          img[data-piece] { opacity: 1.0 !important; }
          [data-piece] { opacity: 1.0 !important; }
        </style>
      </head>
      <body>
        <div id="board" style="width: 400px;"></div>
        <script>${jqueryContent}</script>
        <script>${chessboardJsContent}</script>
      </body>
      </html>
    `;

    await page.setContent(html);

    // Wait for libraries to load
    await page.waitForFunction('typeof jQuery !== "undefined" && typeof ChessBoard === "function"', { timeout: 10000 })
      .catch(err => {
        throw new Error('Chess libraries failed to load');
      });

    await page.evaluate(({ fen, theme, pieceTheme, pieceImageMap }) => {
      try {
        const unicodePieces = {
          'wK': '♔', 'wQ': '♕', 'wR': '♖', 'wB': '♗', 'wN': '♘', 'wP': '♙',
          'bK': '♚', 'bQ': '♛', 'bR': '♜', 'bB': '♝', 'bN': '♞', 'bP': '♟'
        };
        
        // Convert FEN to position object that ChessBoard.js understands
        function fenToPosition(fen) {
          const position = {};
          const ranks = fen.split(' ')[0].split('/');
          const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
          
          ranks.forEach((rank, rankIndex) => {
            let fileIndex = 0;
            for (let char of rank) {
              if (isNaN(char)) {
                // It's a piece
                const square = files[fileIndex] + (8 - rankIndex);
                const color = char === char.toUpperCase() ? 'w' : 'b';
                const piece = color + char.toUpperCase();
                position[square] = piece;
                fileIndex++;
              } else {
                // It's a number of empty squares
                fileIndex += parseInt(char);
              }
            }
          });
          
          return position;
        }
        
        const position = fenToPosition(fen);
        
        document.getElementById('board').className = 'board-theme-' + theme;
        
        // Initialize board WITH a pieceTheme (required for pieces to be created)
        const board = ChessBoard('board', { 
          position: position,
          draggable: false,
          // Use a data URI for a 1x1 transparent pixel as placeholder
          pieceTheme: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
        });
        
        if (!board) {
          throw new Error('Chessboard initialization failed');
        }
        
        // Wait for board to render all piece elements
        return new Promise(resolve => {
          setTimeout(() => {
            // First, remove ALL images from the entire document
            document.querySelectorAll('img').forEach(img => img.remove());
            
            // Now find all square divs and add pieces (unicode or PNG)
            const squares = document.querySelectorAll('[data-square]');
            
            // Get the position from the board
            const boardElement = document.querySelector('.board-b72b1');
            if (!boardElement) {
              resolve();
              return;
            }
            
            // Add pieces to occupied squares
            squares.forEach(square => {
              const squareName = square.getAttribute('data-square');
              if (position[squareName]) {
                const piece = position[squareName];
                
                if (pieceTheme === 'unicode' && unicodePieces[piece]) {
                  // Use unicode pieces
                  const unicodeDiv = document.createElement('div');
                  unicodeDiv.style.cssText = 'font-size: 48px; font-weight: normal; text-align: center; line-height: 49px; width: 49px; height: 49px; display: flex; align-items: center; justify-content: center; position: absolute; top: 0; left: 0; opacity: 1.0 !important; color: #000 !important;';
                  unicodeDiv.textContent = unicodePieces[piece];
                  unicodeDiv.setAttribute('data-piece', piece);
                  unicodeDiv.className = 'unicode-piece';
                  square.appendChild(unicodeDiv);
                } else if (pieceImageMap[piece]) {
                  // Use PNG images
                  const img = document.createElement('img');
                  img.src = pieceImageMap[piece];
                  img.style.cssText = 'width: 100%; height: 100%; position: absolute; top: 0; left: 0; object-fit: contain;';
                  img.setAttribute('data-piece', piece);
                  square.appendChild(img);
                }
              }
            });
            
            resolve();
          }, 100);
        });
        
      } catch (err) {
        throw new Error('Chessboard evaluation error: ' + err.message);
      }
    }, { fen, theme, pieceTheme, pieceImageMap });

    // Wait briefly for rendering
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const boardElement = await page.$('#board');
    if (!boardElement) {
      throw new Error('Board element not found');
    }
    
    const screenshot = await boardElement.screenshot({
      type: 'png'
    });
    
    if (!screenshot) {
      throw new Error('Screenshot returned null or undefined');
    }
    
    return Buffer.from(screenshot);
  } catch (error) {
    console.error('RenderBoard Error:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

export { renderBoard };
