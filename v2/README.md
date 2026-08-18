# v2 — テイクアウト予約システム（Cloudflare Workers + D1）

現行の GAS 版を置き換える新システム。設計は `../docs/MIGRATION.md` を参照。

## 初回セットアップ

```bash
cd v2
npm install
npx wrangler login          # あっぷるアイビーのアカウントで
npm run db:create           # 出力された database_id を wrangler.toml に貼る
npm run setup:local         # スキーマ適用 + マスタ投入（ローカル）
npm run dev                 # http://localhost:8787
```

本番へ反映するとき:

```bash
npm run db:schema:remote
npm run db:seed:remote
npm run deploy
```

## 秘密情報の登録

`wrangler.toml` には書かない。

```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put ADMIN_PASSWORD_HASH
```

## マスタの再生成

現行の `../products.json` / `../stores.json` から seed を作り直す:

```bash
npm run db:seed:build
```

マスタ管理画面が完成したら、この経路は不要になる。

## 構成

```
v2/
├── db/
│   ├── schema.sql      テーブル定義
│   └── seed.sql        自動生成（手で編集しない）
├── scripts/
│   └── build-seed.mjs  現行JSON → seed.sql
├── src/                Worker のコード
└── public/             静的ファイル（フォーム本体）
```
