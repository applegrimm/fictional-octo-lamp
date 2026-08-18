# 移行計画

現行の GAS + スプレッドシート構成から、Cloudflare 上の構成へ作り直す。

**前提: 完全再現はしない。** 現行の未使用機能とバグは移植しない。
現行実装の調査結果は `docs/SPEC.md` を参照。

---

## 1. 移行する理由

| # | 理由 | 深刻度 |
|---|---|---|
| 1 | `MailApp` が個人アカウントで**1日100通**。1注文2通なので**50注文/日で送信停止**。超過してもエラーにならず黙って落ちる | 🔴 年末年始に確実に事故る |
| 2 | 決済確定が「顧客が success.html に戻ること」に依存。タブを閉じられると入金だけ残り注文が消える | 🔴 金銭事故 |
| 3 | GAS は CORS 非対応。全通信が JSONP（GET + URLにBase64）。URL長制限・エラー処理の困難さ・大量の回避コード | 🟠 保守コスト |
| 4 | スプレッドシートをDBとして使用。予約一覧のたびに全行読み込み。6分実行制限に向かって劣化 | 🟠 いずれ停止 |
| 5 | 同時書き込み対策に LockService + 遅延キュー + トリガー再スケジュールが必要。ここに実際バグがあった | 🟠 複雑性 |

**1が単独で移行の決定理由。** 目標が「1日50注文超」でピークが年末年始なので、
現行構成のままでは目標を達成した瞬間に止まる。

---

## 2. 新システムの構成

| 層 | 技術 | 備考 |
|---|---|---|
| フロント | Cloudflare Pages | 現行の静的HTMLを移植・整理 |
| API | Cloudflare Workers (Hono) | 通常のHTTP。JSONP不要 |
| DB | Cloudflare D1 (SQLite) | 注文を正規化 |
| 決済 | Stripe Checkout + Invoicing + **Webhook** | 確定はWebhookで |
| メール | Resend | 無料枠 3,000通/月・100通/日 → 有料でも月$20で50,000通 |
| ファイル | R2（必要なら商品画像） | |
| 管理画面 | Workers 上の管理UI | GitHub PAT 方式を廃止 |
| Excel出力 | 管理画面からダウンロード（SheetJS） | 現行の集計フローを維持 |
| デプロイ | `wrangler deploy` | |

**コスト: 月0円**（Cloudflare 無料枠は商用可。Resend も無料枠内なら0円）
メール送信が月3,000通を超えたら Resend $20/月。

> **メール上限の比較**
> 現行: 100通/日 = **50注文/日**
> 新: 無料枠でも 100通/日 だが、有料化で 50,000通/月 = **800注文/日**
> まずは無料枠で開始し、繁忙期前に有料へ切り替える運用でよい。

---

## 3. スコープ

### 3.1 作るもの

| 機能 | 備考 |
|---|---|
| 予約フォーム（店頭受取 / 配送 / 法人） | 3入口は維持 |
| 商品・数量の選択 | **数量の初期値を1にする**（現行のUX不具合対策） |
| 受取日・受取時間の算出 | 営業日・締切・日付範囲・複数商品の合流ロジックを移植 |
| 配送日・配送時間帯 | |
| のし | |
| カード決済（Stripe Checkout） | **確定はWebhook** |
| 法人請求書（Stripe Invoicing） | 顧客の重複作成をやめる |
| 予約完了メール（顧客・本部） | Resend |
| 店舗管理画面 | 予約一覧・受渡チェック・担当者・メモ |
| マスタ管理画面 | 商品・店舗・休業日 |
| **Excelダウンロード** | 受注集計用 |
| 臨時休業日 `store_closures` | **現行は未実装。新規に実装** |
| 祝日の考慮 | **現行は土日のみ。新規に実装** |

### 3.2 作らないもの（現行にあるが移植しない）

| 項目 | 理由 |
|---|---|
| `deliveryWeight` / `deliverySize` / `deliveryFrozen` / `deliveryArea` | 定義のみで未使用。送料計算が未実装 |
| 商品ごとの `deliveryTimeSlots` / `noshiOptions` | HTMLに固定値。データ側の設定が効いていない。固定値のまま持つ |
| GAS 内蔵の旧管理画面（`action=manage`） | `manage.html` と重複 |
| `getStoreHours` API | フロントが自前計算しており未使用 |
| `initAdminSession` | 呼ばれているがサーバー側にハンドラが無い |
| JSONP 関連の全コード | HTTPで不要 |
| 遅延書き込みキュー・トリガー機構 | DBなら不要 |
| `admin.html` の GitHub PAT 方式 | DB管理画面に置換 |
| `sanitizeInput` の文字除去 | 出力時エスケープに統一 |

### 3.3 直すもの（現行のバグ）

| 項目 | 現行 | 新 |
|---|---|---|
| `minType=business` で締切無視 | バグ | 営業日指定でも締切を効かせる |
| 数量ゼロで日付欄が無効・説明なし | UX不具合 | 数量初期値1 + 状態の明示 |
| 配送情報が備考欄に文字列連結 | 検索・集計不可 | 正規化して別テーブル |
| 決済取りこぼし | success.html依存 | Webhook |
| 請求書金額がクライアント申告値 | 改ざん可 | サーバー再計算 |
| 店舗別出し分けが未設定 | 全商品全店舗 | テーブルで管理・UIから設定 |

---

## 4. データモデル（D1 / SQLite）

```sql
-- 店舗
CREATE TABLE stores (
  id            TEXT PRIMARY KEY,        -- 'ag1'
  name          TEXT NOT NULL,
  group_id      TEXT NOT NULL,           -- 'applegrimm'
  group_name    TEXT NOT NULL,           -- 'あっぷるぐりむ'
  active        INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

-- 営業時間（曜日ごと・複数時間帯に対応）
CREATE TABLE store_hours (
  store_id      TEXT NOT NULL REFERENCES stores(id),
  weekday       INTEGER NOT NULL,        -- 0=日 … 6=土
  open_time     TEXT NOT NULL,           -- 'HH:MM'
  close_time    TEXT NOT NULL,
  PRIMARY KEY (store_id, weekday, open_time)
);

-- 臨時休業日（現行は未実装）
CREATE TABLE store_closures (
  store_id      TEXT NOT NULL REFERENCES stores(id),
  closed_on     TEXT NOT NULL,           -- 'YYYY-MM-DD'
  reason        TEXT,
  PRIMARY KEY (store_id, closed_on)
);

-- 全社休業日・祝日（営業日計算に使用）
CREATE TABLE holidays (
  holiday_on    TEXT PRIMARY KEY,        -- 'YYYY-MM-DD'
  label         TEXT
);

-- 商品
CREATE TABLE products (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  price               INTEGER NOT NULL,  -- 円・税込
  description         TEXT,
  image_url           TEXT,
  visible             INTEGER NOT NULL DEFAULT 1,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  -- 受取
  min_days            INTEGER NOT NULL DEFAULT 5,
  min_type            TEXT NOT NULL DEFAULT 'business',  -- 'business' | 'calendar'
  cutoff              TEXT,              -- 'HH:MM'（business でも有効にする）
  pickup_start        TEXT,              -- 日付範囲指定（NULLなら相対日数）
  pickup_end          TEXT,
  -- 販売期間
  sales_start         TEXT,
  sales_end           TEXT,
  sales_start_time    TEXT,
  sales_end_time      TEXT,
  -- 配送
  delivery_available  INTEGER NOT NULL DEFAULT 0,
  delivery_min_days   INTEGER NOT NULL DEFAULT 7,
  delivery_cutoff     TEXT DEFAULT '12:00',
  delivery_start      TEXT,
  delivery_end        TEXT,
  noshi_available     INTEGER NOT NULL DEFAULT 0
);

-- 商品の取扱店舗（空なら全店）
CREATE TABLE product_stores (
  product_id    TEXT NOT NULL REFERENCES products(id),
  store_id      TEXT NOT NULL REFERENCES stores(id),
  PRIMARY KEY (product_id, store_id)
);

-- 注文
CREATE TABLE orders (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no           TEXT NOT NULL UNIQUE,     -- 表示用
  form_type          TEXT NOT NULL,            -- 'pickup'|'delivery'|'corporate'
  status             TEXT NOT NULL,            -- 'pending'|'confirmed'|'cancelled'|'fulfilled'
  -- 顧客
  customer_name      TEXT NOT NULL,
  customer_phone     TEXT NOT NULL,
  customer_email     TEXT NOT NULL,
  company_name       TEXT,
  department_name    TEXT,
  contact_person     TEXT,
  -- 受渡
  store_id           TEXT REFERENCES stores(id),
  pickup_date        TEXT,
  pickup_time        TEXT,
  delivery_date      TEXT,
  delivery_slot      TEXT,
  noshi_option       TEXT,
  note               TEXT,
  delivery_note      TEXT,
  -- 金額
  total_amount       INTEGER NOT NULL,
  -- 決済
  payment_method     TEXT,                     -- 'card'|'invoice'|'onsite'
  payment_status     TEXT,                     -- 'unpaid'|'paid'|'refunded'
  stripe_session_id  TEXT UNIQUE,              -- 二重登録防止
  stripe_invoice_id  TEXT,
  paid_at            TEXT,
  -- 受渡管理
  fulfilled_at       TEXT,
  fulfilled_by       TEXT,
  staff_memo         TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_orders_store_date ON orders(store_id, pickup_date);
CREATE INDEX idx_orders_created    ON orders(created_at);

-- 注文明細
CREATE TABLE order_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id),
  product_id    TEXT REFERENCES products(id),
  product_name  TEXT NOT NULL,     -- 注文時点の名称を保存
  unit_price    INTEGER NOT NULL,  -- 注文時点の単価を保存
  qty           INTEGER NOT NULL,
  subtotal      INTEGER NOT NULL
);

-- 住所（正規化。現行は備考欄に文字列連結していた）
CREATE TABLE order_addresses (
  order_id      INTEGER NOT NULL REFERENCES orders(id),
  kind          TEXT NOT NULL,     -- 'orderer' | 'delivery'
  postal_code   TEXT,
  prefecture    TEXT,
  city          TEXT,
  address1      TEXT,
  PRIMARY KEY (order_id, kind)
);

-- 店舗管理画面のアクセストークン
CREATE TABLE store_tokens (
  store_id      TEXT NOT NULL REFERENCES stores(id),
  token_hash    TEXT NOT NULL,     -- 生の値は保存しない
  issued_at     TEXT NOT NULL,
  revoked_at    TEXT,
  PRIMARY KEY (store_id, token_hash)
);

-- 送信メールの記録（上限監視・再送用）
CREATE TABLE email_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER REFERENCES orders(id),
  to_address    TEXT NOT NULL,
  subject       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  status        TEXT NOT NULL,     -- 'sent'|'failed'
  provider_id   TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**現行との主な違い**

- 1注文 = orders 1行 + order_items N行（現行は商品ごとに全項目を重複させた行）
- 住所が独立テーブル（現行はN列に文字列連結）
- 単価・商品名を注文時点の値で保存（マスタ変更で過去注文の金額が変わらない）
- `stripe_session_id` に UNIQUE 制約（二重登録がDBレベルで不可能）
- メール送信を記録（上限に近づいたら検知できる）

---

## 5. API 設計

すべて通常の HTTP。JSONP なし。

| メソッド | パス | 用途 | 認証 |
|---|---|---|---|
| GET | `/api/masters` | 商品・店舗・休業日をまとめて返す | なし |
| POST | `/api/orders` | 注文作成（店頭受取の通常予約） | Turnstile |
| POST | `/api/checkout` | Stripe Checkout セッション作成 | Turnstile |
| POST | `/api/invoice` | Stripe 請求書作成 | Turnstile |
| POST | `/api/stripe/webhook` | **決済確定** | Stripe署名検証 |
| GET | `/api/store/orders` | 店舗の予約一覧 | 店舗トークン |
| PATCH | `/api/store/orders/:id` | 受渡・メモ・担当者の更新 | 店舗トークン |
| GET | `/api/admin/export.xlsx` | 受注集計のExcel出力 | 管理者 |
| CRUD | `/api/admin/products` 等 | マスタ管理 | 管理者 |

**reCAPTCHA は Cloudflare Turnstile に置き換える**（同一プラットフォームで完結、無料）。

**金額は必ずサーバーで算出する。** クライアントから受け取るのは
`{product_id, qty}` のみ。単価も合計もリクエストに含めない。

---

## 6. 進め方（フェーズ）

| # | 内容 | 完了条件 |
|---|---|---|
| 1 | 環境構築・D1スキーマ・マスタ移行 | 現行 JSON を D1 に投入完了 |
| 2 | 受取日/配送日の算出ロジック + テスト | 現行の挙動をテストで固定（バグは修正版で） |
| 3 | 予約フォーム（3入口）+ 注文作成API | 店頭受取の通常予約が通る |
| 4 | Stripe Checkout + **Webhook** | カード決済が確定する。タブを閉じても記録される |
| 5 | Stripe Invoicing（法人） | 請求書が発行・送付される |
| 6 | メール（Resend） | 顧客・本部に届く |
| 7 | 店舗管理画面 | 一覧・受渡チェック・メモ |
| 8 | マスタ管理画面 + Excel出力 | 商品・店舗・休業日の編集、集計DL |
| 9 | 並行稼働・切り替え | 旧システム停止 |

**フェーズ2を最優先で固める。** ここが業務ロジックの中核で、
現行の複雑さのほとんどがここに集中している。先にテストで挙動を固定しておけば、
以降の作り込みで壊れても検出できる。

---

## 7. 未確定事項

| # | 論点 | 影響 |
|---|---|---|
| A | 稼働開始の目標時期 | フェーズの並べ方 |
| B | 店舗管理画面の認証方式（現行のシークレットURL継続か、ID/パスワード） | 認証設計 |
| C | Excel出力の列構成（現行の受注集計に合わせる必要があるか） | 出力仕様 |
| D | 旧データ（スプレッドシートの既存予約）を移行するか | 移行手順 |
| E | 独自ドメインを使うか（現行は github.io） | DNS・Stripe設定 |
