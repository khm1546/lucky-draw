require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { pool, initDatabase } = require('./db');
const { buildTextLayout, normalizeBoardText, getBoardPages } = require('./public/js/letters');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');
const { encrypt, decrypt, hashEmail } = require('./crypto-util');

const app = express();
app.use(express.json({ limit: '16kb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
  );
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ==================== Constants ====================

const PRIZE_RATIOS = [
  { rank: 1, ratio: 0.01 },
  { rank: 2, ratio: 0.02 },
  { rank: 3, ratio: 0.07 },
  { rank: 4, ratio: 0.10 },
  { rank: 5, ratio: 0.20 },
  { rank: 6, ratio: 0.60 }
];

const MAX_SSE_CLIENTS = 50;

// eventId -> Set of SSE response objects
const eventSseClients = new Map();

// ==================== Rate Limiters ====================

function createRateLimiter(windowMs, maxRequests) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits) {
      if (now - record.start > windowMs) hits.delete(key);
    }
  }, windowMs);

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const record = hits.get(key);
    if (!record || now - record.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    record.count += 1;
    if (record.count > maxRequests) {
      return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
    }
    next();
  };
}

const drawLimiter = createRateLimiter(60 * 1000, 30);
const adminLimiter = createRateLimiter(60 * 1000, 60);

// ==================== Utility Functions ====================

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildPrizeDistribution(total, rankCount = 6) {
  if (total <= 0) return [];

  const ratios = PRIZE_RATIOS.slice(0, rankCount);
  // 비율 재정규화
  const ratioSum = ratios.reduce((s, p) => s + p.ratio, 0);
  const raw = ratios.map(p => ({
    rank: p.rank,
    exact: (p.ratio / ratioSum) * total,
    count: Math.floor((p.ratio / ratioSum) * total)
  }));

  if (raw[0].count === 0) raw[0].count = 1;
  let allocated = raw.reduce((sum, p) => sum + p.count, 0);

  let safety = total * 2;
  while (allocated > total && safety-- > 0) {
    const target = raw
      .slice()
      .reverse()
      .find(p => p.count > 0 && !(p.rank === 1 && p.count === 1));
    if (!target) break;
    target.count -= 1;
    allocated -= 1;
  }

  safety = total * 2;
  while (allocated < total && safety-- > 0) {
    const candidate = raw
      .slice()
      .sort((a, b) => (b.exact - b.count) - (a.exact - a.count))[0];
    candidate.count += 1;
    allocated += 1;
  }

  const prizes = [];
  raw.forEach(({ rank, count }) => {
    for (let i = 0; i < count; i += 1) prizes.push(rank);
  });
  return prizes;
}

function buildManualPrizeDistribution(total, manualRanks) {
  if (!Array.isArray(manualRanks) || manualRanks.length < 2 || manualRanks.length > 6) {
    throw new Error('수동 배분 값이 올바르지 않습니다. (2~6등)');
  }

  const sorted = manualRanks
    .map(item => ({
      rank: parseInt(item.rank, 10),
      count: parseInt(item.count, 10)
    }))
    .sort((a, b) => a.rank - b.rank);

  for (let i = 0; i < sorted.length; i += 1) {
    const expectedRank = i + 1;
    if (sorted[i].rank !== expectedRank) {
      throw new Error('수동 배분 순위 정보가 올바르지 않습니다.');
    }
    if (!Number.isInteger(sorted[i].count) || sorted[i].count < 0) {
      throw new Error('수동 배분 수량은 0 이상의 정수여야 합니다.');
    }
  }

  const sum = sorted.reduce((acc, item) => acc + item.count, 0);
  if (sum !== total) {
    throw new Error(`수동 배분 합계(${sum})가 카드 수(${total})와 같아야 합니다.`);
  }

  const prizes = [];
  sorted.forEach(({ rank, count }) => {
    for (let i = 0; i < count; i += 1) prizes.push(rank);
  });
  return prizes;
}

function isValidHexColor(color) {
  return typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color);
}

function broadcastEventUpdate(eventId, type = 'update') {
  const clients = eventSseClients.get(eventId);
  if (!clients || clients.size === 0) return;
  const payload = JSON.stringify({ type, ts: Date.now() });
  clients.forEach(client => {
    client.write('event: admin-update\n');
    client.write(`data: ${payload}\n\n`);
  });
}

// ==================== Auth Middleware ====================

function authMiddleware(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'JWT_SECRET이 설정되지 않았습니다.' });
  }
  const authHeader = req.headers['authorization'];
  let token;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.query?.token) {
    token = req.query.token;
  }
  if (!token) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
  try {
    const decoded = jwt.verify(token, secret);
    req.user = { id: decoded.id, email: decoded.email, displayName: decoded.displayName };
    next();
  } catch (err) {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
}

// ==================== Event Owner Middleware ====================

async function eventOwnerMiddleware(req, res, next) {
  try {
    const { slug } = req.params;
    const [rows] = await pool.query(
      'SELECT * FROM events WHERE slug = ? AND is_deleted = FALSE',
      [slug]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: '이벤트를 찾을 수 없습니다.' });
    }
    const event = rows[0];
    if (event.user_id !== req.user.id) {
      return res.status(403).json({ error: '접근 권한이 없습니다.' });
    }
    req.event = event;
    next();
  } catch (err) {
    console.error('eventOwnerMiddleware error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}

// ==================== Auth Routes ====================

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: 'email, password, displayName은 필수입니다.' });
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '이메일 형식이 올바르지 않습니다.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });
    }

    const emailH = hashEmail(email);
    const [existing] = await pool.query('SELECT id FROM users WHERE email_hash = ?', [emailH]);
    if (existing.length > 0) {
      return res.status(409).json({ error: '이미 사용 중인 이메일입니다.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const emailEnc = encrypt(email);
    const nameEnc = encrypt(displayName);
    const [result] = await pool.query(
      'INSERT INTO users (email_hash, email, password_hash, display_name) VALUES (?, ?, ?, ?)',
      [emailH, emailEnc, passwordHash, nameEnc]
    );

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'JWT_SECRET이 설정되지 않았습니다.' });

    const token = jwt.sign(
      { id: result.insertId, email, displayName },
      secret,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, user: { id: result.insertId, email, displayName } });
  } catch (err) {
    console.error('POST /api/auth/signup error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email과 password는 필수입니다.' });
    }

    const emailH = hashEmail(email);
    const [rows] = await pool.query(
      'SELECT id, email, password_hash, display_name, is_active FROM users WHERE email_hash = ?',
      [emailH]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const user = rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: '비활성화된 계정입니다.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const decryptedEmail = decrypt(user.email);
    const decryptedName = decrypt(user.display_name);

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'JWT_SECRET이 설정되지 않았습니다.' });

    const token = jwt.sign(
      { id: user.id, email: decryptedEmail, displayName: decryptedName },
      secret,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user.id, email: decryptedEmail, displayName: decryptedName } });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ==================== Event CRUD (auth required) ====================

app.get('/api/events', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, slug, title, board_text, board_color,
              status, distribution_mode, prize_config, created_at, updated_at
       FROM events WHERE user_id = ? AND is_deleted = FALSE
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ events: rows });
  } catch (err) {
    console.error('GET /api/events error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/events', authMiddleware, async (req, res) => {
  try {
    const { title, boardText, boardColor, distributionMode, prizeConfig } = req.body || {};
    if (!title) {
      return res.status(400).json({ error: 'title은 필수입니다.' });
    }
    const finalBoardText = boardText || title;
    if (boardColor && !isValidHexColor(boardColor)) {
      return res.status(400).json({ error: '색상 형식이 올바르지 않습니다. (#RRGGBB)' });
    }

    const slug = nanoid(10);
    const mode = distributionMode === 'manual' ? 'manual' : 'auto';
    const prizeConfigJson = prizeConfig ? JSON.stringify(prizeConfig) : null;

    const [result] = await pool.query(
      `INSERT INTO events (user_id, slug, title, board_text, board_color, distribution_mode, prize_config, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [req.user.id, slug, title, finalBoardText, boardColor || '#FFFFFF', mode, prizeConfigJson]
    );

    const [rows] = await pool.query('SELECT * FROM events WHERE id = ?', [result.insertId]);
    res.status(201).json({ event: rows[0] });
  } catch (err) {
    console.error('POST /api/events error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/events/:slug', authMiddleware, eventOwnerMiddleware, async (req, res) => {
  try {
    res.json({ event: req.event });
  } catch (err) {
    console.error('GET /api/events/:slug error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.put('/api/events/:slug', authMiddleware, eventOwnerMiddleware, async (req, res) => {
  try {
    const { title, boardText, boardColor, distributionMode, prizeConfig, status, accessPassword, rankCount } = req.body || {};

    const fields = [];
    const values = [];

    if (title !== undefined) { fields.push('title = ?'); values.push(title); }
    if (boardText !== undefined) { fields.push('board_text = ?'); values.push(boardText); }
    if (boardColor !== undefined) {
      if (!isValidHexColor(boardColor)) {
        return res.status(400).json({ error: '색상 형식이 올바르지 않습니다. (#RRGGBB)' });
      }
      fields.push('board_color = ?'); values.push(boardColor.toUpperCase());
    }
    if (distributionMode !== undefined) {
      if (!['auto', 'manual'].includes(distributionMode)) {
        return res.status(400).json({ error: 'distributionMode는 auto 또는 manual이어야 합니다.' });
      }
      fields.push('distribution_mode = ?'); values.push(distributionMode);
    }
    if (prizeConfig !== undefined) {
      fields.push('prize_config = ?'); values.push(JSON.stringify(prizeConfig));
    }
    if (rankCount !== undefined) {
      const rc = parseInt(rankCount, 10);
      if (rc < 2 || rc > 6) {
        return res.status(400).json({ error: '등수는 2~6 사이여야 합니다.' });
      }
      fields.push('rank_count = ?'); values.push(rc);
    }
    if (accessPassword !== undefined) {
      // 빈 문자열이면 비밀번호 해제 (NULL)
      fields.push('access_password = ?');
      values.push(accessPassword.trim() || null);
    }
    if (status !== undefined) {
      if (!['draft', 'active', 'closed'].includes(status)) {
        return res.status(400).json({ error: 'status는 draft, active, closed 중 하나여야 합니다.' });
      }
      fields.push('status = ?'); values.push(status);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: '수정할 항목이 없습니다.' });
    }

    values.push(req.event.id);
    await pool.query(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`, values);

    const [rows] = await pool.query('SELECT * FROM events WHERE id = ?', [req.event.id]);
    res.json({ event: rows[0] });
  } catch (err) {
    console.error('PUT /api/events/:slug error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.delete('/api/events/:slug', authMiddleware, eventOwnerMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE events SET is_deleted = TRUE, deleted_at = NOW() WHERE id = ?',
      [req.event.id]
    );
    res.json({ success: true, message: '이벤트가 삭제되었습니다.' });
  } catch (err) {
    console.error('DELETE /api/events/:slug error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ==================== Event Management (auth + owner) ====================

app.post('/api/events/:slug/init', authMiddleware, eventOwnerMiddleware, adminLimiter, async (req, res) => {
  try {
    const event = req.event;
    const text = normalizeBoardText(req.body?.text || event.board_text);
    const boardColor = req.body?.boardColor;
    const distributionMode = req.body?.distributionMode || event.distribution_mode || 'auto';
    const rankCount = parseInt(req.body?.rankCount || event.rank_count, 10) || 6;
    const manualRanks = req.body?.manualRanks;

    if (!text) {
      return res.status(400).json({ error: '보드에 표시할 텍스트를 입력해주세요.' });
    }
    if (boardColor && !isValidHexColor(boardColor)) {
      return res.status(400).json({ error: '색상 형식이 올바르지 않습니다. (#RRGGBB)' });
    }

    const [existing] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM cards WHERE event_id = ?',
      [event.id]
    );
    if (existing[0].cnt > 0) {
      return res.status(400).json({ error: '이미 생성된 뽑기판이 있습니다. 먼저 리셋해주세요.' });
    }

    const layout = buildTextLayout(text);
    if (layout.length === 0) {
      return res.status(400).json({ error: '유효한 텍스트 레이아웃을 만들 수 없습니다.' });
    }
    const pages = getBoardPages(text);
    const pageCellCounts = pages.map(p => buildTextLayout(p).length || 1);
    const count = pageCellCounts.reduce((a, b) => a + b, 0);

    let prizes;
    if (distributionMode === 'manual') {
      const rankSource = manualRanks || (event.prize_config ? JSON.parse(event.prize_config) : null);
      try {
        prizes = shuffle(buildManualPrizeDistribution(count, rankSource));
      } catch (validationErr) {
        return res.status(400).json({ error: validationErr.message });
      }
    } else {
      prizes = shuffle(buildPrizeDistribution(count, rankCount));
    }

    const pageSlots = [];
    pages.forEach((label, i) => {
      for (let n = 0; n < pageCellCounts[i]; n += 1) pageSlots.push(label);
    });
    const values = Array.from({ length: count }, (_, idx) => [event.id, idx, prizes[idx], pageSlots[idx]]);

    await pool.query(
      'INSERT INTO cards (event_id, position, prize_rank, page) VALUES ?',
      [values]
    );

    // Update board text/color on the event
    const updateFields = ['board_text = ?'];
    const updateValues = [text];
    if (boardColor) {
      updateFields.push('board_color = ?');
      updateValues.push(boardColor.toUpperCase());
    }
    updateValues.push(event.id);
    await pool.query(`UPDATE events SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);

    broadcastEventUpdate(event.id, 'init');

    res.json({
      success: true,
      message: `텍스트 "${text}" 기준으로 카드 ${count}개를 생성했습니다. (${distributionMode === 'manual' ? '수동 배분' : '자동 배분'})`
    });
  } catch (err) {
    console.error('POST /api/events/:slug/init error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/events/:slug/reset', authMiddleware, eventOwnerMiddleware, adminLimiter, async (req, res) => {
  try {
    await pool.query('DELETE FROM cards WHERE event_id = ?', [req.event.id]);
    broadcastEventUpdate(req.event.id, 'reset');
    res.json({ success: true, message: '뽑기판 데이터를 리셋했습니다.' });
  } catch (err) {
    console.error('POST /api/events/:slug/reset error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/events/:slug/status', authMiddleware, eventOwnerMiddleware, async (req, res) => {
  try {
    const eventId = req.event.id;
    const [rows] = await pool.query(
      `SELECT prize_rank,
              COUNT(*) AS total,
              SUM(is_drawn = TRUE) AS drawn,
              SUM(is_drawn = FALSE) AS remaining
       FROM cards WHERE event_id = ?
       GROUP BY prize_rank ORDER BY prize_rank`,
      [eventId]
    );
    const [totalRow] = await pool.query(
      'SELECT COUNT(*) AS total, SUM(is_drawn = TRUE) AS drawn FROM cards WHERE event_id = ?',
      [eventId]
    );
    res.json({
      boardText: req.event.board_text,
      boardColor: req.event.board_color,
      prizes: rows,
      summary: totalRow[0]
    });
  } catch (err) {
    console.error('GET /api/events/:slug/status error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/events/:slug/history', authMiddleware, eventOwnerMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, position, page, prize_rank, drawn_at
       FROM cards WHERE event_id = ? AND is_drawn = TRUE
       ORDER BY drawn_at DESC`,
      [req.event.id]
    );
    res.json({ history: rows });
  } catch (err) {
    console.error('GET /api/events/:slug/history error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/events/:slug/board-color', authMiddleware, eventOwnerMiddleware, adminLimiter, async (req, res) => {
  try {
    const color = req.body?.boardColor;
    if (!isValidHexColor(color)) {
      return res.status(400).json({ error: '색상 형식이 올바르지 않습니다. (#RRGGBB)' });
    }
    await pool.query('UPDATE events SET board_color = ? WHERE id = ?', [color.toUpperCase(), req.event.id]);
    broadcastEventUpdate(req.event.id, 'config');
    res.json({ success: true, message: '뽑기판 색상을 저장했습니다.' });
  } catch (err) {
    console.error('POST /api/events/:slug/board-color error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/events/:slug/stream', authMiddleware, eventOwnerMiddleware, (req, res) => {
  const eventId = req.event.id;

  if (!eventSseClients.has(eventId)) {
    eventSseClients.set(eventId, new Set());
  }
  const clients = eventSseClients.get(eventId);

  if (clients.size >= MAX_SSE_CLIENTS) {
    return res.status(503).json({ error: '연결이 너무 많습니다.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  clients.add(res);
  res.write('event: connected\ndata: {"ok":true}\n\n');

  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (clients.size === 0) eventSseClients.delete(eventId);
  });
});

// ==================== Public API ====================

app.get('/api/e/:slug/info', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT title, board_text, board_color, status, access_password
       FROM events WHERE slug = ? AND is_deleted = FALSE`,
      [req.params.slug]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: '이벤트를 찾을 수 없습니다.' });
    }
    const e = rows[0];
    res.json({
      title: e.title,
      boardText: e.board_text,
      boardColor: e.board_color,
      status: e.status,
      hasPassword: !!e.access_password
    });
  } catch (err) {
    console.error('GET /api/e/:slug/info error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/e/:slug/verify-password', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT access_password FROM events WHERE slug = ? AND is_deleted = FALSE',
      [req.params.slug]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: '이벤트를 찾을 수 없습니다.' });
    }
    const event = rows[0];
    if (!event.access_password) {
      return res.json({ success: true });
    }
    const password = req.body?.password;
    if (!password || password !== event.access_password) {
      return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/e/:slug/verify-password error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/e/:slug/cards', async (req, res) => {
  try {
    const [eventRows] = await pool.query(
      `SELECT id, board_text, board_color, status
       FROM events WHERE slug = ? AND is_deleted = FALSE`,
      [req.params.slug]
    );
    if (eventRows.length === 0) {
      return res.status(404).json({ error: '이벤트를 찾을 수 없습니다.' });
    }
    const event = eventRows[0];
    if (event.status !== 'active') {
      return res.status(403).json({ error: '현재 진행 중인 이벤트가 아닙니다.' });
    }

    const pages = getBoardPages(event.board_text);
    const [cards] = await pool.query(
      `SELECT id, position, page, is_drawn, drawn_at,
              CASE WHEN is_drawn = TRUE THEN prize_rank ELSE NULL END AS prize_rank
       FROM cards WHERE event_id = ? ORDER BY position`,
      [event.id]
    );

    res.json({
      boardText: event.board_text,
      boardColor: event.board_color,
      pages,
      cards
    });
  } catch (err) {
    console.error('GET /api/e/:slug/cards error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/e/:slug/draw', drawLimiter, async (req, res) => {
  try {
    const [eventRows] = await pool.query(
      `SELECT id, status FROM events WHERE slug = ? AND is_deleted = FALSE`,
      [req.params.slug]
    );
    if (eventRows.length === 0) {
      return res.status(404).json({ error: '이벤트를 찾을 수 없습니다.' });
    }
    const event = eventRows[0];
    if (event.status !== 'active') {
      return res.status(403).json({ error: '현재 진행 중인 이벤트가 아닙니다.' });
    }

    const cardId = Number(req.body?.cardId);
    if (!Number.isInteger(cardId) || cardId <= 0) {
      return res.status(400).json({ error: 'cardId는 양의 정수여야 합니다.' });
    }

    // Optimistic concurrency: UPDATE WHERE is_drawn=FALSE and check affectedRows
    const [updateResult] = await pool.query(
      'UPDATE cards SET is_drawn = TRUE, drawn_at = NOW() WHERE id = ? AND event_id = ? AND is_drawn = FALSE',
      [cardId, event.id]
    );

    if (updateResult.affectedRows === 0) {
      // Either not found or already drawn
      const [checkRows] = await pool.query(
        'SELECT id, is_drawn FROM cards WHERE id = ? AND event_id = ?',
        [cardId, event.id]
      );
      if (checkRows.length === 0) {
        return res.status(404).json({ error: '카드를 찾을 수 없습니다.' });
      }
      return res.status(400).json({ error: '이미 추첨된 카드입니다.' });
    }

    const [cardRows] = await pool.query(
      'SELECT id, prize_rank FROM cards WHERE id = ?',
      [cardId]
    );

    broadcastEventUpdate(event.id, 'draw');

    res.json({
      success: true,
      cardId,
      prize_rank: cardRows[0].prize_rank
    });
  } catch (err) {
    console.error('POST /api/e/:slug/draw error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ==================== SPA Routing ====================

const spaRoutes = [
  ['/event/:slug/admin', 'event-admin.html'],
  ['/event/:slug', 'event.html'],
  ['/login', 'login.html'],
  ['/signup', 'signup.html'],
  ['/dashboard', 'dashboard.html']
];

for (const [route, file] of spaRoutes) {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', file));
  });
}

// ==================== Server Start ====================

const PORT = process.env.PORT || 3000;
let server;

initDatabase()
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);
  const forceExit = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  // Close all SSE clients
  for (const clients of eventSseClients.values()) {
    clients.forEach(client => client.end());
  }
  eventSseClients.clear();

  if (server) {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
