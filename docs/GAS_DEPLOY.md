# GAS へのデプロイ手順

このリポジトリのフロントエンドは GitHub Pages、バックエンドは Google Apps Script
(`Code.gs`) で動いている。`Code.gs` の変更を GAS に反映する手順をまとめる。

---

## 初回セットアップ（1回だけ）

### 1. Apps Script API を有効化

https://script.google.com/home/usersettings を開き、
**「Google Apps Script API」を「オン」** にする。これを忘れると clasp が
`User has not enabled the Apps Script API` で失敗する。

### 2. 依存関係のインストール

```bash
npm install
```

### 3. Google アカウントで認証

```bash
npm run gas:login
```

ブラウザが開くので、**スクリプトを所有している Google アカウント** でログインする。
認証情報は `~/.clasprc.json` に保存される（このファイルは絶対にコミットしないこと。
`.gitignore` で除外済み）。

### 4. スクリプトIDを設定

GASエディタ → **プロジェクトの設定 → スクリプト ID** をコピーして:

```bash
npm run gas:setup -- <スクリプトID>
```

これで `.clasp.json` が更新され、GAS 側から `appsscript.json`（マニフェスト）を
取得する。マニフェストはローカルで作らず必ず本物を取得する
（タイムゾーンや Web アプリの公開設定が入っているため）。

> **補足**: Web アプリ URL の `/macros/s/AKfycb.../exec` に含まれるのは
> **デプロイID** であって**スクリプトID**ではない。両者は別物。

---

## 日常のデプロイ

```bash
npm run gas:release
```

これは以下を順に実行する:

1. `clasp push` — `Code.gs` を GAS に反映
2. `clasp deploy -i <デプロイID>` — **既存のデプロイを新バージョンで更新**

個別に実行したい場合:

```bash
npm run gas:push     # コードの反映のみ
npm run gas:deploy   # デプロイの更新のみ
npm run gas:status   # 現在の状態とデプロイ一覧
npm run gas:logs     # 実行ログを監視
npm run gas:open     # GASエディタをブラウザで開く
```

---

## ⚠️ 絶対にやってはいけないこと

**GASエディタで「新しいデプロイ」を押さない。**

新しいデプロイを作ると **Web アプリ URL が変わり**、以下すべての差し替えが必要になる:

| ファイル | 変数名 |
|---|---|
| `index.html` | `GAS_WEB_APP_URL` |
| `success.html` | `GAS_WEB_APP_URL` |
| `stripe-config.js`（2箇所） | `GAS_WEB_APP_URL` |
| `manage_scripts_phase2.js` | `GAS_API_URL` |

`npm run gas:deploy` は `--deploymentId` で既存デプロイを指定して上書きするため、
URL は変わらない。手動で行う場合も
**デプロイ → デプロイを管理 → 鉛筆アイコン → バージョン「新バージョン」→ デプロイ**
の手順を使うこと。

デプロイIDを変更する必要が生じた場合は環境変数で上書きできる:

```bash
GAS_DEPLOYMENT_ID=AKfycb... npm run gas:deploy
```

---

## 必要なスクリプトプロパティ

GASエディタ → **プロジェクトの設定 → スクリプト プロパティ** で設定する。

| キー | 用途 | 未設定時の挙動 |
|---|---|---|
| `SPREADSHEET_ID` | 予約記録用スプレッドシートのID | 予約処理が全て失敗する |
| `STRIPE_SECRET_KEY` | Stripe 秘密鍵（`sk_test_...` / `sk_live_...`） | 決済・決済照会が失敗する |
| `RECAPTCHA_SECRET_KEY` | reCAPTCHA v3 シークレット | 検証がスキップされる（警告ログ出力） |
| `STORE_SECRETS` | 店舗管理シークレット（JSON） | **全店舗の管理画面が開けない** |

### `STORE_SECRETS` の初期化

手で書く必要はない。GASエディタで関数 `rotateAllStoreSecrets` を選んで
**1回実行する**だけでよい。

- 全店舗分のシークレットが生成され、`STORE_SECRETS` に保存される
- 実行ログに各店舗の管理画面URLが出力されるので、それを各店舗へ配布する
- 実行するたびに再発行され、**古いURLは無効になる**

> シークレットは以前 `stores.json` に平文で入っていたが、このファイルは
> GitHub Pages 上で誰でも取得できるため、認証情報の置き場所として使わない。

---

## コミット前のチェック

```bash
npm run check
```

`Code.gs` などの構文、JSON/YAML の妥当性、`stores.json` に認証情報が
混入していないかを検査する。
