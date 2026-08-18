# テイクアウト予約フォーム 仕様書

現行実装（`index.html` / `Code.gs` / `stripe-config.js` / `manage_scripts_phase2.js`）から
読み取った業務仕様。移行時の要件定義として使う。

**この文書はコードから起こしたものであり、当初の設計意図とは異なる可能性がある。**
実装がそうなっている、という事実の記録として扱うこと。
現行実装のバグ・未使用機能も「現状」として明記している。

- 対象コミット: `main` / 2026-08-18 時点
- 運営: 株式会社あっぷるアイビー（本社 026-242-3030 / applegrimm@appleivy.co.jp）
- 通知先（本部）: `appleivyck@gmail.com`

---

## 1. システム概要

飲食店グループ（6ブランド・24店舗）のテイクアウト商品を、Webフォームから
事前予約・事前決済するシステム。

```
[顧客] → GitHub Pages (静的HTML) → GAS Web App → スプレッドシート「予約記録」
                                       ↓
                                    Stripe / Gmail
[店舗] → 店舗管理画面 ─────────────────┘
```

| 構成要素 | 実体 |
|---|---|
| 顧客向けフォーム | `index.html`（GitHub Pages） |
| 決済完了画面 | `success.html` / `cancel.html` |
| 商品・店舗マスタ | `products.json` / `stores.json`（GitHub Pages 上の静的JSON） |
| バックエンド | `Code.gs`（GAS Web App, JSONP） |
| データストア | Google スプレッドシート「予約記録」 |
| 店舗管理画面 | `manage.html` + `manage_scripts_phase2.js` |
| マスタ管理画面 | `admin.html`（GitHub API 経由で JSON を直接コミット） |

---

## 2. 3つの入口（フォーム種別）

URL の `?type=` で表示項目と挙動が切り替わる。指定なしは `pickup`。

| type | 用途 | 送信ボタン |
|---|---|---|
| `pickup` | 個人・店頭受取 | 通常予約 / カード決済 |
| `delivery` | 個人・宅配便 | 通常予約 / カード決済 |
| `corporate` | 法人・請求書払い | 請求書発行のみ |

### 種別ごとの表示項目

| 項目 | pickup | delivery | corporate |
|---|:--:|:--:|:--:|
| 商品・数量 | ● | ● | ● |
| お名前 | ● | ● | －（担当者名を使用） |
| 電話番号・メール | ● | ● | ●（法人欄） |
| 店舗グループ・受取店舗 | ● | － | － |
| 受取希望日・受取希望時間 | ● | － | － |
| お申し込み店舗グループ・店舗 | － | ● | － |
| 会社名・部署名・担当者名 | － | － | ● |
| 注文者住所 | － | ● | ● |
| 配送先住所 | － | ● | － |
| 配送希望日・配送時間帯 | － | ● | － |
| のし | － | ● | － |
| 備考 | ● | ● | ● |

> **現状の注意**: `corporate` は住所セクションを表示するが配送先住所セクションは
> 出さない。配送日・時間帯も入力しない。請求書発行のみを行う導線になっている。

### 種別ごとのボタン表示

- 通常予約ボタン: `pickup` のみ表示
- カード決済ボタン: `corporate` 以外で表示
- 請求書ボタン: `corporate` のみ表示

---

## 3. マスタデータ

### 3.1 商品マスタ `products.json`

配列。1要素 = 1商品。

| キー | 型 | 用途 | 実装での使用 |
|---|---|---|---|
| `id` | string | 商品ID (`p1`…) | 管理用 |
| `name` | string | 商品名。**注文明細の照合キー** | ● |
| `price` | int | 単価（円・税込） | ● |
| `visible` | bool | `false` なら選択肢に出さない | ● |
| `description` | string | 商品説明（選択時に表示） | ● |
| `imageUrl` | string | 商品画像URL | ● |
| `minDays` | int | 受取までの最短日数 | ● |
| `minType` | string | `business`=営業日 / それ以外=暦日 | ● |
| `cutoff` | string\|null | 当日締切時刻 `HH:MM` | ● |
| `pickupDateRange` | object | 受取可能期間の直接指定 | ● |
| `salesPeriod` | object | 販売期間（注文を受け付ける期間） | ● |
| `storeIds` | array | 取扱店舗ID。空なら全店 | ● ※1 |
| `storeGroups` | array | 取扱店舗グループ。空なら全店 | ● ※1 |
| `deliveryAvailable` | bool | 配送可否 | ● |
| `deliveryMinDays` | int | 配送までの最短営業日数（既定7） | ● |
| `deliveryCutoff` | string\|null | 配送の当日締切（既定 `12:00`） | ● |
| `deliveryDateRange` | object | 配送可能期間の直接指定 | ● |
| `noshiAvailable` | bool | のし対応可否 | △ 参照のみ |
| `noshiOptions` | array | のし種類 | ✗ **未使用**（HTMLに固定値） |
| `deliveryTimeSlots` | object | 配送時間帯 | ✗ **未使用**（HTMLに固定値） |
| `deliveryWeight` | number | 重量(kg) | ✗ **未使用** |
| `deliverySize` | string | サイズ区分 | ✗ **未使用** |
| `deliveryFrozen` | bool | 冷凍品か | ✗ **未使用** |
| `deliveryArea` | string | 配送エリア | ✗ **未使用** |

`salesPeriod` / `pickupDateRange` / `deliveryDateRange` の構造:

```json
{ "enabled": true, "startDate": "2025-10-15", "endDate": "2025-12-02",
  "startTime": "", "endTime": "23:59", "cutoff": "15:00" }
```

※1 コードは対応済みだが、**現行データ（11商品）には1件も設定されていない**。
結果として全商品が全店舗で購入可能な状態。店舗別の出し分けは
「実装済みだが運用されていない」機能。

> **移行時の判断事項**: ✗ の6項目は `admin.html` で入力できるが、
> フォーム側で一切参照されていない。送料計算や配送可否判定に使う想定だった
> と思われるが未実装。新システムで必要かどうか要判断。

### 3.2 店舗マスタ `stores.json`

24店舗・6グループ。

| キー | 型 | 用途 |
|---|---|---|
| `id` | string | 店舗ID (`ag1`, `pz1`…) |
| `name` | string | 店舗名。**予約記録の照合キー** |
| `group` | string | グループID |
| `groupName` | string | グループ表示名 |
| `hours` | object | 曜日別営業時間 `{"mon": ["10:00","21:30"], …}`。`null` は定休日 |
| `unavailable_dates` | array | 臨時休業日 | ✗ **未使用** |

グループ:

| group | groupName |
|---|---|
| `applegrimm` | あっぷるぐりむ |
| `pizzeria` | ピッツェリア |
| `burns` | 焼肉バーンズ |
| `kirabi` / `kirabi_single` | きらび |
| `marutomi` | まるとみ |

> **現状の注意**: `unavailable_dates` は `admin.html` で編集できるが、
> フォーム・バックエンドのどこからも参照されていない。臨時休業日を設定しても
> その日の予約を止められない。**新システムでは実装すべき。**

> **セキュリティ上の変更**: 以前この JSON に `managementSecret`（店舗管理画面の
> 認証キー）が平文で含まれていたが、GitHub Pages 上で誰でも取得できるため削除し、
> GAS のスクリプトプロパティ `STORE_SECRETS` に移した。

---

## 4. 受取日・受取時間の算出ルール

現行実装で最も複雑な部分。**新システムでも同じ挙動を再現する必要がある。**

### 4.1 前提

- 「今日」は JST で判定する（`getTodayJST()`）
- 営業日 = 月〜金（土日を除外）。**祝日は考慮していない**
- 受取希望日は**商品を1つ以上選択するまで入力できない**（`disabled`）

### 4.2 受取可能な最短日（店頭受取）

選択された全商品について個別に算出し、**最も遅い日**を採用する。

**A. `pickupDateRange.enabled` が true の場合**

```
最短日 = max(pickupDateRange.startDate, 今日)
if (pickupDateRange.cutoff があり、現在時刻 > cutoff かつ startDate <= 今日)
    最短日 = 今日 + 1日
```

**B. それ以外（相対日数指定）**

```
if (minType === 'business')
    最短日 = 今日から minDays 営業日後   ← cutoff は考慮されない
else
    if (cutoff があり 現在時刻 > cutoff)
        最短日 = 今日 + minDays + 1日
    else
        最短日 = 今日 + minDays 日
```

> **現状の不整合**: `minType === 'business'` の場合、`cutoff` が設定されていても
> 締切時刻が無視される。商品によって締切の効き方が違う。意図的か不明。

### 4.3 受取可能な最終日

- `pickupDateRange.enabled` なら `endDate`
- それ以外は既定の上限（サーバー側定数 `MAX_DAYS = 30` / フロントは30日相当）

複数商品の場合は**最も早い最終日**を採用。

### 4.4 締切超過時の表示

いずれかの商品が締切を過ぎている場合、日付欄の下に表示:

> ※一部商品は本日の締切時刻を過ぎているため、翌日以降の受取となります。

複数商品選択時は常に表示:

> ※複数の商品を同時にご注文いただく場合、すべての商品が揃う最も遅い受取日以降のみ
> ご指定いただけます。商品ごとに異なる受取日をご希望の場合は、
> お手数ですがご注文を分けてご入力ください。

### 4.5 受取希望時間

**店舗と受取日の両方が選択されて初めて選択可能になる。**

```
1. 受取日の曜日から stores.json の hours[曜日] を引く
2. null なら定休日 → 選択肢なし
3. 営業時間の開始〜終了を 30分間隔でスロット生成
   例: ["10:00","21:30"] → 10:00, 10:30, 11:00, … 21:00
4. 複数時間帯（配列の配列）にも対応
```

> GAS 側にも `getStoreHoursForDate` / `generateTimeSlots` が実装されているが、
> フロントは `allStores` から自前で計算しており、この API を呼んでいない。
> **重複実装。**

### 4.6 配送日（delivery）

```
最短日:
  deliveryDateRange.enabled なら max(startDate, 今日)、cutoff 超過で +1営業日
  それ以外は 今日から deliveryMinDays 営業日後（既定7）
                cutoff（既定 12:00）超過なら さらに +1営業日
最終日:
  deliveryDateRange.enabled なら endDate、それ以外は 今日から30営業日後
最短日・最終日とも、営業日でなければ翌営業日へ繰り上げ
```

配送時間帯は**HTMLの固定値**:
`08:00-12:00` / `14:00-16:00` / `16:00-18:00` / `18:00-20:00`

---

## 5. 注文フロー

### 5.1 通常予約（`pickup` のみ）

```
フォーム送信
 → クライアント検証（同意チェック・reCAPTCHA・入力長）
 → JSONP GET: action=submitReservation&data=<base64(urlencode(JSON))>
 → GAS: reCAPTCHA検証 → サニタイズ → validate() → レート制限
 → 金額を products.json から再計算
 → スプレッドシート「予約記録」に商品ごとに1行
 → メール送信（顧客・本部）
 → 完了モーダル表示、フォームを無効化
```

### 5.2 カード決済（`pickup` / `delivery`）

```
決済ボタン
 → JSONP GET: action=createCheckoutSession&data=...
 → GAS: 金額を products.json から再計算（クライアント申告値は破棄）
        success_url / cancel_url はサーバー側定数を使用
 → Stripe Checkout セッション作成 → URL へリダイレクト
 → 決済後 success.html?session_id=... へ戻る
 → JSONP GET: action=getPaymentInfo → Stripe API で決済状況照会
 → JSONP GET: action=submitPaymentReservation
    → GAS: Stripe に再照会し payment_status === 'paid' を確認
    → 同一 session_id が記録済みなら二重登録しない
    → 明細は Stripe metadata から復元、単価はマスタで引き直す
    → スプレッドシートに記録（メモ欄に「決済完了」、決済IDを保存）
    → 決済確認メール送信
```

> **既知の弱点**: 予約の確定が「顧客が success.html に戻ってくること」に依存している。
> 決済直後にタブを閉じられると入金だけ発生して注文が残らない。
> **新システムでは Stripe Webhook（`checkout.session.completed`）で確定させること。**

### 5.3 請求書払い（`corporate`）

```
請求書ボタン
 → JSONP GET: action=createInvoice&data=...
 → GAS: Stripe Customer 作成 → InvoiceItem 作成 → Invoice 作成
        → finalize → send（Stripeから請求書メールが送られる）
 → 支払期限: 発行から30日（days_until_due）
 → シート「法人用請求書売り掛け記録」に1行追加
 → メール送信（顧客・本部）
```

> **既知の弱点**: 顧客はメールアドレスで毎回新規作成される（重複顧客が増える）。
> 金額はクライアント申告値を使っている（Checkout 側は修正済みだが Invoice 側は未対応）。

---

## 6. データストア（スプレッドシート）

### 6.1 シート「予約記録」

**1注文につき、商品ごとに1行**（同一注文IDで複数行）。

| 列 | 内容 |
|---|---|
| A | 注文ID（6桁英数字、`generateShortOrderId()`） |
| B | 受付日時（`yyyy/MM/dd HH:mm:ss` JST） |
| C | お名前 |
| D | お客様電話番号（先頭に `'` を付け文字列化） |
| E | お客様メールアドレス |
| F | 受取店舗（配送時は申し込み店舗） |
| G | 商品名 |
| H | 数量 |
| I | 単価 |
| J | 小計 |
| K | 合計金額（注文全体・全行同じ値） |
| L | 受取希望日 / 配送希望日 |
| M | 受取希望時間 / 配送時間帯 |
| N | 備考（配送時は住所・時間帯・のしを連結した文字列） |
| O | 受渡済み（`✓` or 空） |
| P | 担当者名 |
| Q | メモ（決済予約は「決済完了」） |
| R | 受渡日時 |
| S | 決済ID（末尾16文字） |
| T | 決済ID（完全版） |

> **移行時の要注意**: 配送情報（注文者住所・配送先住所・のし・配送備考）が
> **N列に文字列連結で押し込まれている**。正規化されていないため、
> 住所での検索・集計ができない。新システムでは別カラム／別テーブルにすること。

受渡完了時、行全体（A〜T）の背景色が薄緑 `#d4edda` に変わる。

### 6.2 シート「法人用請求書売り掛け記録」

請求書ID / 発行日時 / 会社名 / 部署名 / 担当者 / メール / 電話 / 金額 /
支払期限 / 請求書URL / 申込店舗 / 受取or配送 / 日付 / 時間帯 / 商品一覧 /
備考 / Stripe顧客ID / 通貨 / 作成者 / メモ

### 6.3 シート「レート制限」

クライアント識別子 / 最終送信時刻 / タイムスタンプ

---

## 7. 店舗管理画面

`manage.html?shop=<シークレット>` でアクセス。

### 機能

- 本日以降の予約一覧（`past_7days` 指定で過去7日も表示）
- 注文IDでグループ化して表示
- 受渡完了チェック（→ O列に `✓`、R列に日時、行の背景色変更）
- 担当者名の記録（→ P列）
- メモの記録（→ Q列）
- 電話番号のタップ発信

### 認証

- シークレットは GAS のスクリプトプロパティ `STORE_SECRETS`（店舗ID → シークレット）
- 発行・再発行は GAS の `rotateAllStoreSecrets()` を手動実行
- リクエストごとにワンタイムトークンを付与（HMAC-SHA256、5分有効、再利用不可）
  - `token = <timestamp>.<randomHex>.<HMAC(secret, "secret:ts:rand")>`
  - `checksum = SHA256("secret:ts") の先頭16文字`
- 店舗は**自店舗の予約しか読めない・更新できない**（行のF列と照合）

> **現状の不具合**: `manage_scripts_phase2.js` が `action=initAdminSession` を
> 呼んでいるが、`Code.gs` に対応するハンドラが存在しない。
> デフォルト応答が返るだけで、実質的に何もしていない。

---

## 8. マスタ管理画面 `admin.html`

商品・店舗マスタを編集し、**GitHub API 経由で `products.json` / `stores.json` を
直接コミット**する。Stripe の TEST/LIVE 切り替えもここで行う（`stripe-mode.json`）。

> **現状の問題**: 認証がクライアント側 JavaScript のみで、公開ホスティング上では
> 成立しない。GitHub Personal Access Token をブラウザに保持する構成も危うい。
> 現在は GitHub Pages の配信対象から除外し、ローカル専用としている。
> **新システムではDBの管理画面に置き換えること。**

---

## 9. バリデーション

### クライアント側

- プライバシーポリシー同意（必須）
- キャンセルポリシー同意（必須）
- reCAPTCHA v3 トークン取得（取得できなければ送信不可）
- 入力長: 氏名100 / 電話20 / メール254 / 備考1000
- 数量: 1〜100 の整数

### サーバー側（`validate()`）

| 項目 | ルール |
|---|---|
| お名前 | 必須 |
| 電話番号 | `^[0-9\-\+]{10,15}$` |
| メール | 一般的なメール形式 |
| 店舗 | 店頭受取なら受取店舗必須 / 配送なら申し込み店舗必須 |
| 商品 | 1件以上、最大50明細 |
| 数量 | 1以上の整数、1商品あたり最大100 |
| 受取希望日・時間 | 店頭受取時は必須 |
| 配送希望日・時間帯 | 配送時は必須 |
| 郵便番号 | `^[0-9]{3}-?[0-9]{4}$`（注文者・配送先とも） |
| 都道府県・市区町村・番地 | 配送時は必須 |
| のし | 配送時は必須 |
| 希望日の範囲 | 今日+5日 〜 今日+30日 |
| 休業日 | `12-31` / `01-01` は受付不可 |

### レート制限

同一連絡先（メール優先、なければ電話）から**60秒に1回**まで。
識別子はハッシュ化してシートに記録。

---

## 10. メール

| 種別 | 宛先 | 内容 |
|---|---|---|
| 予約受付（顧客） | 注文者 | 注文ID・内容・合計・受取情報・キャンセルポリシー全文 |
| 予約受付（本部） | `appleivyck@gmail.com` | 同上（ポリシーなし） |
| 決済完了（顧客） | 注文者 | 上記＋決済ID・決済日時・重要事項 |
| 決済完了（本部） | `appleivyck@gmail.com` | 同上 |
| 請求書発行（顧客） | 注文者 | 請求書URL・支払期限・会社情報 |
| 請求書発行（本部） | `appleivyck@gmail.com` | 同上 |

**1注文あたり2通送信される。**

> ⚠️ **移行の最大の理由**: GAS の `MailApp` は個人Googleアカウントで
> **1日100通**が上限。1注文2通なので**1日50注文で送信が止まる**。
> 超過してもエラーにならず黙って送られない。
> ピークが年末年始で50件超を見込むなら、現行構成では確実に事故る。

---

## 11. キャンセルポリシー（メール本文・`cancel-policy.html`）

- キャンセルは**受取予定日の3日前まで**
- 期限超過後のキャンセルは受け付けられない場合がある
- 承認された場合は返金。**決済手数料は顧客負担**
- 受取日時の変更も3日前までなら可能な範囲で対応
- 無断キャンセル・大幅な遅延が続く場合は以後の利用を断ることがある
- 連絡先: 026-242-3030 / applegrimm@appleivy.co.jp

---

## 12. API 一覧（現行 GAS）

すべて JSONP（`GET` + `callback` パラメータ）。
データは `base64(encodeURIComponent(JSON))` を `data` パラメータで渡す。

| action | 用途 | 認証 |
|---|---|---|
| `submitReservation` | 通常予約の登録 | reCAPTCHA + レート制限 |
| `createCheckoutSession` | Stripe Checkout セッション作成 | なし |
| `submitPaymentReservation` | 決済完了予約の登録 | Stripe への実照会 |
| `getPaymentInfo` | 決済情報の取得 | なし |
| `createInvoice` | Stripe 請求書の作成・送付 | なし |
| `getReservations` | 店舗の予約一覧 | 店舗シークレット + トークン |
| `updateReservation` | 受渡済み・メモ・担当者の更新 | 店舗シークレット + トークン |
| `manage` | 店舗管理画面HTML（旧版） | 店舗シークレット |
| `getStoreHours` | 店舗営業時間 | なし（**未使用**） |
| `test` / `testConnection` | 疎通確認 | なし |
| （なし） | バージョン情報を返す | なし |

> **JSONP を使っている理由**: GAS の `ContentService` は
> レスポンスヘッダーを一切設定できず、CORS に対応できないため。
> 新システムでは通常の HTTP API にでき、この制約と関連コードは全て不要になる。

---

## 13. 移行時に「直すべき」と判明している点

| # | 内容 | 現行 |
|---|---|---|
| 1 | 決済確定を Webhook で行う | success.html 依存で取りこぼしの可能性 |
| 2 | メール送信を外部サービスへ | 100通/日で停止 |
| 3 | 配送情報を正規化 | N列に文字列連結 |
| 4 | `unavailable_dates`（臨時休業日）を実装 | 定義のみで未使用 |
| 5 | 商品ごとの配送時間帯・のし選択肢を実装 | HTMLに固定値 |
| 6 | 送料・重量・サイズ・配送エリアの活用 | 定義のみで未使用 |
| 7 | 祝日を営業日計算に反映 | 土日のみ除外 |
| 8 | `minType=business` 時の締切時刻 | 無視されている |
| 9 | マスタ管理をDB管理画面へ | GitHub PAT をブラウザ保持 |
| 10 | 請求書の顧客重複 | メールごとに毎回新規作成 |
| 11 | 請求書金額のサーバー再計算 | クライアント申告値を使用 |
| 12 | 予約一覧の取得効率 | 毎回シート全行を読む |
| 13 | 同時書き込み対策 | LockService + 遅延キュー（DBなら不要） |

---

## 14. システム定数（`Code.gs`）

| 定数 | 値 | 意味 |
|---|---|---|
| `MIN_DAYS` | 5 | 希望日の下限（今日+5日） |
| `MAX_DAYS` | 30 | 希望日の上限（今日+30日） |
| `MIN_BUSINESS_DAYS` | 5 | 営業日ベースの下限 |
| `MAX_BUSINESS_DAYS` | 30 | 営業日ベースの上限 |
| `HOLIDAYS` | `12-31`, `01-01` | 受付不可日（MM-DD） |
| `RATE_LIMIT_DURATION` | 60000 ms | 同一連絡先の再送信間隔 |
| `MAX_QTY_PER_ITEM` | 100 | 1商品あたりの最大数量 |
| `MAX_ITEMS_PER_ORDER` | 50 | 1注文あたりの最大明細数 |
| `MASTER_CACHE_SECONDS` | 300 | マスタJSONのキャッシュ保持時間 |
| `days_until_due` | 30 | 請求書の支払期限（日） |

---

## 15. 移行先の推奨構成

| 層 | 推奨 | 理由 |
|---|---|---|
| フロント | Cloudflare Pages | 現行の静的HTMLをほぼそのまま移せる |
| API | Cloudflare Workers | 通常のHTTP、CORS自由、JSONP不要 |
| DB | Cloudflare D1 (SQLite) | 注文を正規化。全行スキャンが消える |
| 決済 | Stripe + Webhook | 取りこぼしゼロ |
| メール | Resend / SendGrid | 無料枠で月3,000通〜。100通/日の壁が消える |
| Excel出力 | 管理画面からダウンロード | 現行の集計フローを維持 |
| デプロイ | `wrangler deploy` | デプロイIDの取り違えが起きない |

商用利用でも無料枠に収まる。スプレッドシートは「DBからの書き出し先」として残せる。
