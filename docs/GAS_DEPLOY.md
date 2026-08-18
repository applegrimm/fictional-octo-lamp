# GAS へのデプロイ手順

フロントエンドは GitHub Pages、バックエンドは Google Apps Script (`Code.gs`) で
動いている。`Code.gs` の変更を GAS に反映する手順。

**すべて自分の PC のターミナルで実行する。** `clasp login` はブラウザで Google に
ログインするため、PC 以外では実行できない。

---

## 実行場所

### Windows

1. **Windows キー** を押す
2. `powershell` と入力
3. **Windows PowerShell** をクリック

`PS C:\Users\ユーザー名>` と表示されるので、この後ろにコマンドを入力して Enter。

### macOS

`アプリケーション → ユーティリティ → ターミナル`

---

## 初回のみ

### 1. Node.js と Git を入れる

| ソフト | 入手先 | 備考 |
|---|---|---|
| Node.js | https://nodejs.org/ja | **LTS** 版を選ぶ |
| Git | https://git-scm.com/downloads | 全て既定値でよい |

インストール後、**ターミナルを一度閉じて開き直す**（パスが反映されないため）。

確認:

```
node -v
git --version
```

バージョン番号が2つ出れば成功。`認識されていません` / `command not found` が出たら
インストールできていないか、ターミナルの開き直し忘れ。

### 2. Apps Script API を有効化

https://script.google.com/home/usersettings

**「Google Apps Script API」をオン** にする。これを忘れると手順4で
`User has not enabled the Apps Script API` で失敗する。反映に数分かかることがある。

### 3. リポジトリを PC に取得

Windows:

```
cd $HOME\Documents
git clone https://github.com/applegrimm/fictional-octo-lamp.git
cd fictional-octo-lamp
```

macOS:

```
cd ~/Documents
git clone https://github.com/applegrimm/fictional-octo-lamp.git
cd fictional-octo-lamp
```

### 4. セットアップ

```
npm install
npm run gas:login
npm run gas:setup
```

- `npm install` — 1〜2分。警告が出ても問題ない
- `npm run gas:login` — ブラウザが開く。**スクリプトの所有者アカウント**でログインして「許可」
- `npm run gas:setup` — `.clasp.json` のスクリプトIDを使い、GAS からマニフェストを取得

`✅ appsscript.json を取得しました` が出れば完了。

> スクリプトIDは `.clasp.json` に設定済み。別のプロジェクトに向ける場合のみ
> `npm run gas:setup -- <スクリプトID>` のように引数で渡す。
> スクリプトIDは GASエディタ → プロジェクトの設定 → スクリプト ID で確認できる。
> Web アプリ URL の `AKfycb...` は**デプロイID**であってスクリプトIDではない。

---

## 反映する

```
npm run gas:release
```

`clasp push`（コード反映）と `clasp deploy`（デプロイ更新）を続けて実行する。
**Web アプリ URL は変わらない。**

### 2回目以降

```
cd $HOME\Documents\fictional-octo-lamp     # macOS は cd ~/Documents/fictional-octo-lamp
git pull
npm run gas:release
```

---

## コマンド一覧

| コマンド | 動作 |
|---|---|
| `npm run gas:release` | push + デプロイ更新（通常はこれ） |
| `npm run gas:push` | コード反映のみ |
| `npm run gas:deploy` | デプロイ更新のみ |
| `npm run gas:status` | 差分状態とデプロイ一覧 |
| `npm run gas:logs` | 実行ログを監視 |
| `npm run gas:open` | GASエディタをブラウザで開く |
| `npm run check` | 構文・設定・認証情報混入のチェック |

---

## ⚠️ 「新しいデプロイ」を押さない

新しいデプロイを作ると **Web アプリ URL が変わり**、以下の差し替えが必要になる:

| ファイル | 変数名 |
|---|---|
| `index.html` | `GAS_WEB_APP_URL` |
| `success.html` | `GAS_WEB_APP_URL` |
| `stripe-config.js`（2箇所） | `GAS_WEB_APP_URL` |
| `manage_scripts_phase2.js` | `GAS_API_URL` |

`npm run gas:deploy` は `--deploymentId` で既存デプロイを上書きするため URL は変わらない。
GASエディタで手動更新する場合も
**デプロイ → デプロイを管理 → 鉛筆アイコン → バージョン「新バージョン」→ デプロイ**
の手順を使う。

デプロイIDを変える必要が出た場合:

```
GAS_DEPLOYMENT_ID=AKfycb... npm run gas:deploy
```

Windows PowerShell では:

```
$env:GAS_DEPLOYMENT_ID="AKfycb..."; npm run gas:deploy
```

---

## スクリプトプロパティ

GASエディタ → **プロジェクトの設定 → スクリプト プロパティ**

| キー | 用途 | 未設定時 |
|---|---|---|
| `SPREADSHEET_ID` | 予約記録用スプレッドシートのID | 予約処理が全て失敗 |
| `STRIPE_SECRET_KEY` | Stripe 秘密鍵 (`sk_test_...` / `sk_live_...`) | 決済・決済照会が失敗 |
| `RECAPTCHA_SECRET_KEY` | reCAPTCHA v3 シークレット | 検証がスキップされる（警告ログ） |
| `STORE_SECRETS` | 店舗管理シークレット (JSON) | **全店舗の管理画面が開けない** |

### `STORE_SECRETS` の初期化

手で書く必要はない。GASエディタで関数 `rotateAllStoreSecrets` を選んで
**1回だけ実行する**。

1. `npm run gas:open` で GASエディタを開く
2. 上部の関数プルダウンで **`rotateAllStoreSecrets`** を選択
3. **▶ 実行**
4. 下部の実行ログに24店舗分の管理画面URLが出力される

実行するたびに再発行され、**古いURLは無効になる**。
そのため `gas:release` には含めていない（デプロイのたびに全店舗のURLが
変わってしまうため）。

> 以前この値は `stores.json` に平文で入っていたが、同ファイルは GitHub Pages で
> 誰でも取得できるため、認証情報の置き場所として使ってはいけない。

---

## つまずいた場合

| 症状 | 対処 |
|---|---|
| `npm : 用語 'npm' は認識されていません` | Node.js 未インストール、またはターミナルの開き直し忘れ |
| `User has not enabled the Apps Script API` | 手順2の API 有効化。オンにして数分待つ |
| `Could not read API credentials` | `npm run gas:login` をやり直す |
| `spawnSync clasp ENOENT` | `npm install` を実行していない |
| `このシステムではスクリプトの実行が無効になっている` | PowerShell で `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` → `Y` |
| `set: pipefail: invalid option name` | 古い `.sh` 版の残骸。`git pull` で最新にする |

---

## clasp を使わない場合

手作業でも反映できる。

1. https://github.com/applegrimm/fictional-octo-lamp/blob/main/Code.gs を開く
2. コピーボタンで全文コピー
3. GASエディタの `Code.gs` を全選択して貼り付け
4. デプロイ → デプロイを管理 → 鉛筆 → バージョン「**新バージョン**」→ デプロイ
5. `rotateAllStoreSecrets` を実行（初回のみ）
