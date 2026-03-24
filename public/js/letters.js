/**
 * Pixel font maps for A-Z, 0-9 (5x7) and Korean syllables (7x9)
 */

// ==================== English / Number Font (5 cols x 7 rows) ====================

const RAW_FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00001', '00001', '00001', '00001', '10001', '10001', '01110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100']
};

function toCellMap(rawRows) {
  return rawRows.map(r => r.split('').map(v => (v === '1' ? 1 : 0)));
}

const LETTER_MAPS = Object.keys(RAW_FONT).reduce((acc, key) => {
  acc[key] = toCellMap(RAW_FONT[key]);
  return acc;
}, {});

// ==================== Korean Font (7 cols x 9 rows) ====================

// Base consonant patterns (5 cols x 7 rows) - 14 unique shapes
var BASE_CONSONANTS = [
  ['11111','00001','00001','00001','00001','00001','00001'], // 0 ㄱ
  ['10000','10000','10000','10000','10000','10000','11111'], // 1 ㄴ
  ['11111','10000','10000','10000','10000','10000','11111'], // 2 ㄷ
  ['11111','00001','00001','11111','10000','10000','11111'], // 3 ㄹ
  ['11111','10001','10001','10001','10001','10001','11111'], // 4 ㅁ
  ['10001','10001','11111','10001','10001','10001','11111'], // 5 ㅂ
  ['00100','00100','01010','01010','10001','10001','00000'], // 6 ㅅ
  ['01110','10001','10001','10001','10001','10001','01110'], // 7 ㅇ
  ['11111','00100','00100','01010','01010','10001','00000'], // 8 ㅈ
  ['00100','11111','00100','01010','01010','10001','00000'], // 9 ㅊ
  ['11111','00001','01111','00001','00001','00001','00001'], // 10 ㅋ
  ['11111','10000','11111','10000','10000','10000','11111'], // 11 ㅌ
  ['11111','01010','01010','01010','01010','01010','11111'], // 12 ㅍ
  ['00100','11111','00000','01110','10001','10001','01110']  // 13 ㅎ
].map(toCellMap);

// Initial consonant index (cho) → base consonant index
var CHO_BASE = [0,0,1,2,2,3,4,5,5,6,6,7,8,8,9,10,11,12,13];

// Final consonant index (jong) → base consonant index (-1 = none)
var JONG_BASE = [-1,0,0,0,1,1,1,2,3,3,3,3,3,3,3,3,4,5,5,6,6,7,8,9,10,11,12,13];

// Vertical vowel patterns (3 cols x 7 rows)
var VOWEL_V = [
  ['100','100','100','110','100','100','100'], // 0 ㅏ
  ['101','101','101','111','101','101','101'], // 1 ㅐ / ㅔ
  ['100','110','100','110','100','100','100'], // 2 ㅑ
  ['101','111','101','111','101','101','101'], // 3 ㅒ / ㅖ
  ['001','001','001','011','001','001','001'], // 4 ㅓ
  ['001','011','001','011','001','001','001'], // 5 ㅕ
  ['010','010','010','010','010','010','010']  // 6 ㅣ
].map(toCellMap);

// Medial vowel index (jung) → vertical vowel pattern index
var JUNG_V = [0,1,2,3,4,1,5,3,-1,0,1,6,-1,4,1,6,-1,-1,-1,6,6];

// Horizontal vowel patterns (5 cols x 3 rows)
var VOWEL_H = [
  ['00100','00100','11111'], // 0 ㅗ
  ['01010','01010','11111'], // 1 ㅛ
  ['11111','00100','00100'], // 2 ㅜ
  ['11111','01010','01010'], // 3 ㅠ
  ['00000','11111','00000']  // 4 ㅡ
].map(toCellMap);

// Medial vowel index (jung) → horizontal vowel pattern index (-1 = not horizontal)
var JUNG_H = [-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,1,-1,-1,-1,2,3,4,-1,-1];

// Horizontal vowel set (uses top-bottom layout)
var H_VOWEL_SET = {8:1, 12:1, 16:1, 17:1, 18:1};

function isKoreanSyllable(ch) {
  var code = ch.charCodeAt(0);
  return code >= 0xAC00 && code <= 0xD7A3;
}

function decomposeKorean(ch) {
  var code = ch.charCodeAt(0) - 0xAC00;
  return {
    cho: Math.floor(code / 588),
    jung: Math.floor((code % 588) / 28),
    jong: code % 28
  };
}

// Nearest-neighbor scale a 2D cell map to target size
function scaleMap(src, tH, tW) {
  var sH = src.length, sW = src[0].length;
  var out = [];
  for (var r = 0; r < tH; r++) {
    out[r] = [];
    var sr = tH <= 1 ? 0 : Math.min(Math.round(r * (sH - 1) / (tH - 1)), sH - 1);
    for (var c = 0; c < tW; c++) {
      var sc = tW <= 1 ? 0 : Math.min(Math.round(c * (sW - 1) / (tW - 1)), sW - 1);
      out[r][c] = src[sr][sc];
    }
  }
  return out;
}

// Stamp a pattern onto a grid at (startRow, startCol)
function stampGrid(grid, pat, sr, sc) {
  for (var r = 0; r < pat.length; r++) {
    for (var c = 0; c < pat[r].length; c++) {
      if (pat[r][c]) grid[sr + r][sc + c] = 1;
    }
  }
}

// Build an 8-col x 9-row cell map for a Korean syllable
function buildKoreanMap(ch) {
  var d = decomposeKorean(ch);
  var hasFinal = d.jong > 0;
  var isHoriz = H_VOWEL_SET[d.jung] === 1;
  var grid = [];
  for (var i = 0; i < 9; i++) grid[i] = [0,0,0,0,0,0,0,0];

  var cho = BASE_CONSONANTS[CHO_BASE[d.cho]];

  if (isHoriz) {
    var vow = VOWEL_H[JUNG_H[d.jung]];
    if (!hasFinal) {
      stampGrid(grid, scaleMap(cho, 6, 8), 0, 0);
      stampGrid(grid, scaleMap(vow, 3, 8), 6, 0);
    } else {
      var fin = BASE_CONSONANTS[JONG_BASE[d.jong]];
      stampGrid(grid, scaleMap(cho, 4, 8), 0, 0);
      stampGrid(grid, scaleMap(vow, 2, 8), 4, 0);
      stampGrid(grid, scaleMap(fin, 3, 8), 6, 0);
    }
  } else {
    var vi = JUNG_V[d.jung];
    var vow2 = vi >= 0 ? VOWEL_V[vi] : VOWEL_V[6]; // fallback to ㅣ
    if (!hasFinal) {
      stampGrid(grid, scaleMap(cho, 9, 5), 0, 0);
      stampGrid(grid, scaleMap(vow2, 9, 3), 0, 5);
    } else {
      var fin2 = BASE_CONSONANTS[JONG_BASE[d.jong]];
      stampGrid(grid, scaleMap(cho, 6, 5), 0, 0);
      stampGrid(grid, scaleMap(vow2, 6, 3), 0, 5);
      stampGrid(grid, scaleMap(fin2, 3, 8), 6, 0);
    }
  }

  return grid;
}

// ==================== Public API ====================

function normalizeBoardText(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\uAC00-\uD7A3 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getBoardPages(text) {
  var normalized = normalizeBoardText(text);
  if (!normalized) return ['?'];
  return normalized.split(' ').filter(Boolean);
}

/**
 * Build card positions for a text string (supports English, numbers, Korean).
 * Returns array of {row, col, letter, letterIndex, isDecoration}
 */
function buildTextLayout(text) {
  var normalized = normalizeBoardText(text);
  var chars = normalized ? normalized.split('') : ['?'];
  var positions = [];
  var colOffset = 0;

  chars.forEach(function (ch, idx) {
    if (ch === ' ') {
      colOffset += 3;
      return;
    }

    var map;
    if (isKoreanSyllable(ch)) {
      map = buildKoreanMap(ch);
    } else {
      map = LETTER_MAPS[ch] || LETTER_MAPS['?'];
    }

    if (!map || map.length === 0) {
      map = LETTER_MAPS['?'];
    }

    map.forEach(function (row, r) {
      row.forEach(function (cell, c) {
        if (cell === 1) {
          positions.push({
            row: r,
            col: colOffset + c,
            letter: ch,
            letterIndex: idx,
            isDecoration: false
          });
        }
      });
    });
    colOffset += map[0].length + 1;
  });

  return positions;
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LETTER_MAPS, normalizeBoardText, getBoardPages, buildTextLayout };
}
