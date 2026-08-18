-- テイクアウト予約システム D1 スキーマ
-- 適用: npm run db:schema:local / npm run db:schema:remote

PRAGMA foreign_keys = ON;

-- ============================================================
-- マスタ
-- ============================================================

CREATE TABLE IF NOT EXISTS stores (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  group_id    TEXT NOT NULL,
  group_name  TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- 曜日ごとの営業時間。1店舗1曜日に複数行（中休みなど）を許す
CREATE TABLE IF NOT EXISTS store_hours (
  store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=日
  open_time   TEXT NOT NULL,   -- 'HH:MM'
  close_time  TEXT NOT NULL,
  PRIMARY KEY (store_id, weekday, open_time)
);

-- 店舗ごとの臨時休業日（現行システムでは未実装だった）
CREATE TABLE IF NOT EXISTS store_closures (
  store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  closed_on   TEXT NOT NULL,   -- 'YYYY-MM-DD'
  reason      TEXT,
  PRIMARY KEY (store_id, closed_on)
);

-- 全社休業日・祝日。営業日計算に使う（現行は土日のみ除外していた）
CREATE TABLE IF NOT EXISTS holidays (
  holiday_on  TEXT PRIMARY KEY,  -- 'YYYY-MM-DD'
  label       TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  price              INTEGER NOT NULL CHECK (price >= 0),  -- 円・税込
  description        TEXT,
  image_url          TEXT,
  visible            INTEGER NOT NULL DEFAULT 1,
  sort_order         INTEGER NOT NULL DEFAULT 0,

  -- 店頭受取の日付制御
  min_days           INTEGER NOT NULL DEFAULT 5,
  min_type           TEXT    NOT NULL DEFAULT 'business'
                     CHECK (min_type IN ('business', 'calendar')),
  cutoff             TEXT,            -- 'HH:MM'。business でも有効にする（現行はバグで無視）
  pickup_start       TEXT,            -- 期間直接指定。NULL なら min_days による相対指定
  pickup_end         TEXT,

  -- 販売期間（注文を受け付ける期間）
  sales_start        TEXT,
  sales_end          TEXT,
  sales_start_time   TEXT,
  sales_end_time     TEXT,

  -- 配送
  delivery_available INTEGER NOT NULL DEFAULT 0,
  delivery_min_days  INTEGER NOT NULL DEFAULT 7,
  delivery_cutoff    TEXT DEFAULT '12:00',
  delivery_start     TEXT,
  delivery_end       TEXT,

  noshi_available    INTEGER NOT NULL DEFAULT 0
);

-- 商品の取扱店舗。1件も無ければ「全店で取扱い」とみなす
CREATE TABLE IF NOT EXISTS product_stores (
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id    TEXT NOT NULL REFERENCES stores(id)   ON DELETE CASCADE,
  PRIMARY KEY (product_id, store_id)
);

-- ============================================================
-- 注文
-- ============================================================

CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no          TEXT NOT NULL UNIQUE,
  form_type         TEXT NOT NULL CHECK (form_type IN ('pickup','delivery','corporate')),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','cancelled','fulfilled')),

  customer_name     TEXT NOT NULL,
  customer_phone    TEXT NOT NULL,
  customer_email    TEXT NOT NULL,
  company_name      TEXT,
  department_name   TEXT,
  contact_person    TEXT,

  store_id          TEXT REFERENCES stores(id),
  pickup_date       TEXT,
  pickup_time       TEXT,
  delivery_date     TEXT,
  delivery_slot     TEXT,
  noshi_option      TEXT,
  note              TEXT,
  delivery_note     TEXT,

  total_amount      INTEGER NOT NULL CHECK (total_amount >= 0),

  payment_method    TEXT CHECK (payment_method IN ('card','invoice','onsite')),
  payment_status    TEXT NOT NULL DEFAULT 'unpaid'
                    CHECK (payment_status IN ('unpaid','paid','refunded')),
  -- UNIQUE により二重登録がDBレベルで不可能（現行はコードで防いでいた）
  stripe_session_id TEXT UNIQUE,
  stripe_invoice_id TEXT,
  paid_at           TEXT,

  fulfilled_at      TEXT,
  fulfilled_by      TEXT,
  staff_memo        TEXT,

  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_store_pickup  ON orders(store_id, pickup_date);
CREATE INDEX IF NOT EXISTS idx_orders_created       ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status        ON orders(status);

-- 商品名・単価は注文時点の値を保存する。
-- マスタを変更しても過去の注文金額が変わらないようにするため。
CREATE TABLE IF NOT EXISTS order_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    TEXT REFERENCES products(id),
  product_name  TEXT NOT NULL,
  unit_price    INTEGER NOT NULL,
  qty           INTEGER NOT NULL CHECK (qty >= 1),
  subtotal      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- 住所を独立テーブルに持つ（現行は備考欄に文字列連結していた）
CREATE TABLE IF NOT EXISTS order_addresses (
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('orderer','delivery')),
  postal_code  TEXT,
  prefecture   TEXT,
  city         TEXT,
  address1     TEXT,
  PRIMARY KEY (order_id, kind)
);

-- ============================================================
-- 運用
-- ============================================================

-- 店舗管理画面のアクセストークン。生の値は保存せずハッシュのみ
CREATE TABLE IF NOT EXISTS store_tokens (
  store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  issued_at   TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT,
  PRIMARY KEY (store_id, token_hash)
);
CREATE INDEX IF NOT EXISTS idx_store_tokens_hash ON store_tokens(token_hash);

-- 送信メールの記録。上限監視と再送判断に使う
CREATE TABLE IF NOT EXISTS email_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  to_address   TEXT NOT NULL,
  subject      TEXT NOT NULL,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('sent','failed')),
  provider_id  TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at);

-- 送信の連投防止（現行のレート制限相当）
CREATE TABLE IF NOT EXISTS rate_limits (
  key_hash     TEXT PRIMARY KEY,
  last_sent_at TEXT NOT NULL
);
