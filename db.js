const mysql = require('mysql2/promise');

function sanitizeDbName(raw) {
  const name = (raw || 'birthday_draw').replace(/[^a-zA-Z0-9_]/g, '');
  if (!name || name.length > 64) {
    throw new Error('Invalid DB_NAME: only alphanumeric and underscores allowed (max 64 chars)');
  }
  return name;
}

const DB_NAME = sanitizeDbName(process.env.DB_NAME);

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function initDatabase() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  });

  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
  await conn.end();

  // users 테이블 (개인정보 AES-256 암호화)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '사용자 고유 식별자',
      email_hash      VARCHAR(64)     NOT NULL COMMENT '이메일 검색용 HMAC-SHA256 해시',
      email           TEXT            NOT NULL COMMENT '이메일 (AES-256-CBC 암호화)',
      password_hash   VARCHAR(255)    NOT NULL COMMENT '비밀번호 (bcrypt 해시)',
      display_name    TEXT            NOT NULL COMMENT '표시 이름 (AES-256-CBC 암호화)',
      is_active       BOOLEAN         NOT NULL DEFAULT TRUE COMMENT '계정 활성화 여부',
      created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '가입일시',
      updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '정보 수정일시',
      UNIQUE KEY uk_users_email_hash (email_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // events 테이블
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '이벤트 고유 식별자',
      user_id           INT UNSIGNED    NOT NULL COMMENT '이벤트 생성자 (users.id 참조)',
      slug              VARCHAR(80)     NOT NULL COMMENT '공개 URL용 고유 슬러그',
      title             VARCHAR(200)    NOT NULL COMMENT '참가자 페이지에 표시되는 이벤트 제목',
      board_text        VARCHAR(60)     NOT NULL COMMENT '뽑기판 카드 배치 텍스트 (글자 모양으로 카드 배치)',
      board_color       VARCHAR(7)      NOT NULL DEFAULT '#FFFFFF' COMMENT '뽑기판 카드 색상 (#RRGGBB)',
      access_password   VARCHAR(100)    NULL COMMENT '참가자 접근 비밀번호 (NULL이면 비밀번호 없음)',
      status            ENUM('draft','active','closed') NOT NULL DEFAULT 'draft' COMMENT '이벤트 상태 (준비중/진행중/종료)',
      rank_count        TINYINT UNSIGNED NOT NULL DEFAULT 6 COMMENT '등수 개수 (2~6)',
      distribution_mode ENUM('auto','manual') NOT NULL DEFAULT 'auto' COMMENT '등수 배분 방식 (자동/수동)',
      prize_config      JSON            NULL COMMENT '수동 배분 설정 [{"rank":1,"count":1},...]',
      is_deleted        BOOLEAN         NOT NULL DEFAULT FALSE COMMENT '삭제 여부 (소프트 삭제)',
      created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '이벤트 생성일시',
      updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '이벤트 수정일시',
      deleted_at        DATETIME        NULL COMMENT '삭제일시',
      UNIQUE KEY uk_events_slug (slug),
      KEY idx_events_user_id (user_id),
      KEY idx_events_status (status, is_deleted),
      CONSTRAINT fk_events_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // cards 테이블
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '카드 고유 식별자',
      event_id        INT UNSIGNED    NOT NULL COMMENT '소속 이벤트 (events.id 참조)',
      position        INT UNSIGNED    NOT NULL COMMENT '뽑기판 내 카드 위치 번호',
      prize_rank      TINYINT UNSIGNED NOT NULL COMMENT '당첨 등수 (1~6등)',
      page            VARCHAR(10)     NOT NULL COMMENT '뽑기판 탭 이름 (공백 기준 분리)',
      is_drawn        BOOLEAN         NOT NULL DEFAULT FALSE COMMENT '추첨 완료 여부',
      drawn_at        DATETIME        NULL COMMENT '추첨 일시',
      UNIQUE KEY uk_cards_event_position (event_id, position),
      KEY idx_cards_event_drawn (event_id, is_drawn),
      KEY idx_cards_event_rank (event_id, prize_rank),
      CONSTRAINT fk_cards_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('Database initialized successfully');
}

module.exports = { pool, initDatabase };
