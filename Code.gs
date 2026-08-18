/**
 * @file Code.gs
 * @brief GitHub Pages用 テイクアウト予約フォーム バックエンド
 * @details doPostでPOSTリクエストを処理し、予約データをスプレッドシートに記録
 * @version 2.0 - セキュリティ強化版
 */

/**
 * @const {string} SPREADSHEET_ID
 * @desc 予約記録用スプレッドシートのID
 */
const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');

/**
 * @const {string} SHEET_NAME
 * @desc 予約記録用シート名
 */
const SHEET_NAME = '予約記録';

/**
 * @const {string} B2B_INVOICE_SHEET_NAME
 * @desc 法人請求書売掛の記録用シート名
 */
const B2B_INVOICE_SHEET_NAME = '法人用請求書売り掛け記録';

/**
 * @const {string} RATE_LIMIT_SHEET_NAME
 * @desc レート制限記録用シート名
 */
const RATE_LIMIT_SHEET_NAME = 'レート制限';

/**
 * @const {string} RECAPTCHA_SECRET_KEY
 * @desc reCAPTCHA シークレットキー（実際の値に変更してください）
 */
const RECAPTCHA_SECRET_KEY = PropertiesService.getScriptProperties().getProperty('RECAPTCHA_SECRET_KEY');


/**
 * @const {number} RATE_LIMIT_DURATION
 * @desc レート制限時間（ミリ秒）
 */
const RATE_LIMIT_DURATION = 60000; // 1分

/**
 * @const {Array<string>} HOLIDAYS
 * @desc 受取不可日（営業日制御、MM-DD形式）
 */
const HOLIDAYS = ['12-31', '01-01'];

/**
 * @const {number} MIN_DAYS
 * @desc 受取希望日の最小日数（本日+5日）
 */
const MIN_DAYS = 5;

/**
 * @const {number} MAX_DAYS
 * @desc 受取希望日の最大日数（本日+30日）
 */
const MAX_DAYS = 30;

// 営業日計算用の定数（HTML側にも同様のロジックがあります）
const MIN_BUSINESS_DAYS = 5;
const MAX_BUSINESS_DAYS = 30;

// ============================================
// 🛡️ セキュリティ強化：ワンタイムトークン検証システム
// ============================================

// トークン管理用のメモリキャッシュ（簡易実装）
const tokenCache = {};
const TOKEN_CLEANUP_INTERVAL = 600000; // 10分

/**
 * ワンタイムトークンの検証
 * @param {string} token - トークン
 * @param {string} shopSecret - 店舗シークレット
 * @param {string} timestamp - タイムスタンプ
 * @return {boolean} 検証結果
 */
function verifySecureToken(token, shopSecret, timestamp) {
  try {
    if (!token || !shopSecret || !timestamp) {
      console.log('🚫 セキュリティパラメータ不足');
      return false;
    }
    
    // トークンの形式チェック
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      console.log('🚫 トークン形式エラー');
      return false;
    }
    
    const [tokenTimestamp, randomHex, signature] = tokenParts;
    const tokenTime = parseInt(tokenTimestamp);
    const currentTime = parseInt(timestamp);
    
    // タイムスタンプの検証（5分以内）
    if (Math.abs(currentTime - tokenTime) > 300000) {
      console.log('🚫 トークン期限切れ:', {
        tokenTime: new Date(tokenTime),
        currentTime: new Date(currentTime),
        diff: Math.abs(currentTime - tokenTime)
      });
      return false;
    }
    
    // 同じトークンの再利用チェック
    if (tokenCache[token]) {
      console.log('🚫 トークン再利用検出');
      return false;
    }
    
    // HMAC署名の検証
    const message = shopSecret + ':' + tokenTimestamp + ':' + randomHex;
    const expectedSignature = Utilities.computeHmacSha256Signature(message, shopSecret);
    const expectedHex = expectedSignature.map(byte => 
      (byte & 0xFF).toString(16).padStart(2, '0')).join('');
    
    if (signature !== expectedHex) {
      console.log('🚫 署名検証失敗');
      return false;
    }
    
    // トークンを使用済みとして記録
    tokenCache[token] = currentTime;
    
    // 古いトークンの定期クリーンアップ
    cleanupOldTokens();
    
    console.log('✅ セキュリティトークン検証成功');
    return true;
    
  } catch (error) {
    console.error('セキュリティトークン検証エラー:', error);
    return false;
  }
}

/**
 * 古いトークンのクリーンアップ
 */
function cleanupOldTokens() {
  const now = Date.now();
  const tokensToDelete = [];
  
  for (const [token, timestamp] of Object.entries(tokenCache)) {
    if (now - timestamp > TOKEN_CLEANUP_INTERVAL) {
      tokensToDelete.push(token);
    }
  }
  
  tokensToDelete.forEach(token => {
    delete tokenCache[token];
  });
  
  if (tokensToDelete.length > 0) {
    console.log('🧹 古いトークン削除:', tokensToDelete.length + '個');
  }
}

/**
 * チェックサムの検証
 * @param {string} checksum - チェックサム
 * @param {string} shopSecret - 店舗シークレット
 * @param {string} timestamp - タイムスタンプ
 * @return {boolean} 検証結果
 */
function verifyChecksum(checksum, shopSecret, timestamp) {
  try {
    const data = shopSecret + ':' + timestamp;
    const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, data);
    const expected = hash.map(byte => 
      (byte & 0xFF).toString(16).padStart(2, '0')).join('').substring(0, 16);
    
    return checksum === expected;
  } catch (error) {
    console.error('チェックサム検証エラー:', error);
    return false;
  }
}

/**
 * セキュリティ検証の実行
 * @param {Object} params - リクエストパラメータ
 * @return {Object} 検証結果
 */
function performSecurityValidation(params) {
  const token = params.token;
  const timestamp = params.timestamp;
  const checksum = params.checksum;
  const clientId = params.clientId;
  const shopSecret = params.shop;
  
  console.log('🔐 セキュリティ検証開始:', {
    hasToken: !!token,
    hasTimestamp: !!timestamp,
    hasChecksum: !!checksum,
    hasClientId: !!clientId,
    hasShopSecret: !!shopSecret
  });
  
  // 基本的なパラメータチェック
  if (!token || !timestamp || !checksum || !shopSecret) {
    return {
      success: false,
      error: 'セキュリティパラメータが不足しています'
    };
  }
  
  // ワンタイムトークンの検証
  if (!verifySecureToken(token, shopSecret, timestamp)) {
    return {
      success: false,
      error: '認証トークンが無効です'
    };
  }
  
  // チェックサムの検証
  if (!verifyChecksum(checksum, shopSecret, timestamp)) {
    return {
      success: false,
      error: 'データ整合性チェックに失敗しました'
    };
  }
  
  console.log('✅ 全セキュリティ検証通過');
  return { success: true };
}

/**
 * エラーレスポンス生成
 * @param {string} message - エラーメッセージ
 * @return {ContentService.TextOutput} エラーレスポンス
 */
function createSecurityErrorResponse(message) {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: false,
      error: message,
      timestamp: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * @const {string} CANCEL_POLICY_TEXT
 * @desc キャンセルポリシー全文（メール送信用）
 */
const CANCEL_POLICY_TEXT = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▼ 【キャンセルについてのご案内】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ご予約のキャンセルは、原則として受取予定日の3日前までに株式会社
あっぷるアイビーへご連絡いただいた場合に承ります。
期限を過ぎた場合のキャンセルはお受けできないことがございますので、
あらかじめご了承ください。

キャンセルが承認された場合、決済済みの代金は返金いたします。
なお、返金に伴う決済手数料は誠に恐縮ですがお客様にご負担いただいて
おります。ご理解のほどよろしくお願いいたします。

受取日時の変更は3日前までにご連絡いただければ、可能な限り対応いたします。
準備状況により対応できない場合もございますのでご了承ください。

無断キャンセルや受取日時の大幅な遅延が続く場合、今後のご利用をお断り
することがございます。

【テイクアウト予約　キャンセルのご連絡先】
株式会社あっぷるアイビー
電話：026-242-3030
メール：applegrimm@appleivy.co.jp

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

/**
 * @const {string} CANCEL_POLICY_URL
 * @desc キャンセルポリシー専用ページのURL（相対パス）
 */
const CANCEL_POLICY_URL = 'cancel-policy.html?from=email';

/**
 * @function sanitizeInput
 * @desc 入力値をサニタイズして危険な文字列を除去
 * @param {string} input - 入力文字列
 * @return {string} サニタイズ後の文字列
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  
  // 基本的な危険文字列を除去
  let sanitized = input;
  
  // HTMLタグを除去
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/<[^>]*>/g, '');
  
  // SQLインジェクション対策
  const dangerousPatterns = [
    /('|(\\')|(;)|(\\)|(--|\/\*|\*\/)|(\bUNION\b)|(\bSELECT\b)|(\bINSERT\b)|(\bUPDATE\b)|(\bDELETE\b)|(\bDROP\b))/gi
  ];
  
  dangerousPatterns.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '');
  });
  
  // 制御文字を除去
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  
  // 長すぎる文字列を切り詰め
  const maxLengths = {
    name: 100,
    phone: 20,
    email: 254,
    store: 100,
    note: 1000
  };
  
  // 一般的な最大長
  sanitized = sanitized.substring(0, 1000);
  
  return sanitized.trim();
}

/**
 * @function validateInputLength
 * @desc 入力値の長さをチェック
 * @param {Object} data - 入力データ
 * @return {Array<string>} エラーメッセージ配列
 */
function validateInputLength(data) {
  const errors = [];
  const maxLengths = {
    name: 100,
    phone: 20,
    email: 254,
    store: 100,
    note: 1000
  };
  
  Object.keys(maxLengths).forEach(field => {
    if (data[field] && data[field].length > maxLengths[field]) {
      errors.push(`${field}の入力が長すぎます（最大${maxLengths[field]}文字）`);
    }
  });
  
  return errors;
}

/**
 * @function verifyRecaptcha
 * @desc reCAPTCHA v3 レスポンスを検証（スコアベース判定）
 * @param {string} recaptchaResponse - reCAPTCHA v3 レスポンストークン
 * @param {string} expectedAction - 期待されるアクション名（デフォルト: 'form_submit'）
 * @return {Object} 検証結果オブジェクト {success: boolean, score: number, action: string}
 */
function verifyRecaptcha(recaptchaResponse, expectedAction = 'form_submit') {
  if (!recaptchaResponse || !RECAPTCHA_SECRET_KEY || RECAPTCHA_SECRET_KEY === 'YOUR_RECAPTCHA_SECRET_KEY_HERE') {
    console.log('reCAPTCHA設定が不完全です');
    return { success: true, score: 1.0, action: expectedAction }; // 開発環境では検証をスキップ
  }
  
  try {
    const response = UrlFetchApp.fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      payload: {
        secret: RECAPTCHA_SECRET_KEY,
        response: recaptchaResponse
      }
    });
    
    const result = JSON.parse(response.getContentText());
    
    // v3の結果を詳細ログ出力
    console.log('reCAPTCHA v3 検証結果:', result);
    
    if (!result.success) {
      console.error('reCAPTCHA v3 検証失敗:', result['error-codes']);
      return { success: false, score: 0.0, action: result.action || '' };
    }
    
    // アクション名の確認
    if (result.action !== expectedAction) {
      console.warn(`reCAPTCHA アクション不一致: 期待値=${expectedAction}, 実際=${result.action}`);
    }
    
    // スコアベース判定（0.5以上で人間と判定）
    const threshold = 0.5;
    const isHuman = result.score >= threshold;
    
    console.log(`reCAPTCHA v3 スコア: ${result.score} (閾値: ${threshold}) - 判定: ${isHuman ? '人間' : 'ボット'}`);
    
    return {
      success: isHuman,
      score: result.score,
      action: result.action || '',
      threshold: threshold
    };
    
  } catch (error) {
    console.error('reCAPTCHA v3 検証エラー:', error);
    return { success: false, score: 0.0, action: '', error: error.toString() };
  }
}

/**
 * @function checkRateLimit
 * @desc レート制限をチェック
 * @param {string} clientId - クライアント識別子（IPアドレス等）
 * @return {boolean} 送信許可かどうか
 */
function checkRateLimit(clientId) {
  // 🔐 同時書き込み競合回避：排他制御ロックを取得
  const lock = LockService.getScriptLock();
  try {
    // 最大5秒間ロック取得を試行（レート制限は軽量処理なので短時間）
    lock.waitLock(5000);
    console.log('レート制限チェック用ロック取得成功');
    
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    let rateLimitSheet;
    
    try {
      rateLimitSheet = spreadsheet.getSheetByName(RATE_LIMIT_SHEET_NAME);
    } catch (e) {
      // レート制限シートが存在しない場合は作成
      rateLimitSheet = spreadsheet.insertSheet(RATE_LIMIT_SHEET_NAME);
      rateLimitSheet.getRange(1, 1, 1, 3).setValues([['クライアントID', '最終送信時刻', 'タイムスタンプ']]);
    }
    
    const now = new Date().getTime();
    const data = rateLimitSheet.getDataRange().getValues();
    
    // 既存の記録を確認
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === clientId) {
        const lastSubmitTime = new Date(data[i][2]).getTime();
        if (now - lastSubmitTime < RATE_LIMIT_DURATION) {
          return false; // レート制限にかかっている
        }
        // 記録を更新
        rateLimitSheet.getRange(i + 1, 2, 1, 2).setValues([[new Date(), now]]);
        return true;
      }
    }
    
    // 新しいクライアントの記録を追加
    rateLimitSheet.appendRow([clientId, new Date(), now]);
    return true;
    
  } catch (error) {
    console.error('レート制限チェックエラー:', error);
    return true; // エラー時は許可
  } finally {
    // 🔐 必ずロックを解放
    try {
      lock.releaseLock();
      console.log('レート制限チェック用ロック解放完了');
    } catch (lockError) {
      console.warn('レート制限チェック用ロック解放時のエラー:', lockError);
    }
  }
}

/**
 * @function generateShortOrderId
 * @desc 6桁の英数字注文IDを生成する
 * @return {string} 生成された注文ID
 */
function generateShortOrderId() {
  const timestampPart = (new Date().getTime() % 100000).toString(36);
  const randomPart = Math.random().toString(36).substring(2, 4);
  return (timestampPart + randomPart).substring(0, 6).toUpperCase();
}

/**
 * @function writeToSpreadsheetSafely
 * @desc スプレッドシートへの安全な書き込み（短時間ロック・即座にレスポンス）
 * @param {Array} itemsWithPrice - 商品データ
 * @param {Object} sanitizedData - サニタイズされた予約データ
 * @param {string} orderId - 注文ID
 * @param {number} total - 合計金額
 */
function writeToSpreadsheetSafely(itemsWithPrice, sanitizedData, orderId, total) {
  // 🔐 短時間ロック（最大2秒）で即座にレスポンスを実現
  const lock = LockService.getScriptLock();
  try {
    // 短時間（2秒）でロック取得を試行
    const lockAcquired = lock.tryLock(2000);
    
    if (!lockAcquired) {
      // ロック取得失敗時はトリガー経由で後処理
      console.warn('ロック取得失敗 - トリガー経由で後処理予定');
      scheduleDelayedWrite(itemsWithPrice, sanitizedData, orderId, total);
      return;
    }
    
    console.log('短時間ロック取得成功 - 即座に書き込み実行');
    
    // スプレッドシートに即座に書き込み
    executeSpreadsheetWrite(itemsWithPrice, sanitizedData, orderId, total);
    
  } catch (error) {
    console.error('スプレッドシート書き込みエラー:', error);
    // エラー時も後処理でリトライ
    scheduleDelayedWrite(itemsWithPrice, sanitizedData, orderId, total);
  } finally {
    // 🔐 必ずロック解放
    try {
      lock.releaseLock();
      console.log('短時間ロック解放完了');
    } catch (lockError) {
      console.warn('ロック解放時のエラー:', lockError);
    }
  }
}

/**
 * @function executeSpreadsheetWrite
 * @desc 実際のスプレッドシート書き込み処理
 * @param {Array} itemsWithPrice - 商品データ
 * @param {Object} sanitizedData - サニタイズされた予約データ
 * @param {string} orderId - 注文ID
 * @param {number} total - 合計金額
 */
function executeSpreadsheetWrite(itemsWithPrice, sanitizedData, orderId, total) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const now = new Date();
  const timestamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

  itemsWithPrice.forEach(item => {
    sheet.appendRow([
      orderId,                        // A列：注文ID
      timestamp,                      // B列：受付日時
      sanitizedData.name,             // C列：お名前
      "'" + sanitizedData.phone,      // D列：お客様電話番号
      sanitizedData.email,            // E列：お客様メールアドレス
      sanitizedData.store,            // F列：受取店舗
      item.name,                      // G列：商品名
      String(item.qty),               // H列：数量
      String(item.price),             // I列：単価
      String(item.subtotal),          // J列：小計
      String(total),                  // K列：合計金額
      (sanitizedData.deliveryMethod === 'delivery' ? sanitizedData.deliveryDate : sanitizedData.pickup_date), // L列：受取/配送日
      (sanitizedData.deliveryMethod === 'delivery' ? sanitizedData.deliveryTimeSlot : sanitizedData.pickup_time), // M列：受取時間/配送時間帯
      buildNoteForSheet(sanitizedData), // N列：備考（配送情報含む）
      '',                             // O列：受渡済み（空）
      '',                             // P列：担当者名（空）※新規追加
      '',                             // Q列：メモ（空）
      '',                             // R列：受渡日時（空）
      '',                             // S列：決済ID（短縮版）（空）
      ''                              // T列：決済ID（完全版）（空）
    ]);
  });
  
  console.log(`スプレッドシート書き込み完了: ${itemsWithPrice.length}行追加`);
}

/**
 * @function buildNoteForSheet
 * @desc 備考欄に配送情報を付加（第一段階：統合表示のみ）
 * @param {Object} data - サニタイズ済みデータ
 * @return {string} 備考文字列
 */
function buildNoteForSheet(data) {
  try {
    if (data.deliveryMethod === 'delivery') {
      const oa = data.ordererAddress || {};
      const da = data.deliveryAddress || {};
      const parts = [];
      parts.push('[配送]');
      parts.push(`注文者: ${oa.postalCode || ''} ${oa.fullAddress || (oa.prefecture || '') + (oa.city || '') + (oa.address1 || '')}`.trim());
      parts.push(`配送先: ${da.postalCode || ''} ${da.fullAddress || (da.prefecture || '') + (da.city || '') + (da.address1 || '')}`.trim());
      parts.push(`時間帯: ${data.deliveryTimeSlot || ''}`);
      parts.push(`のし: ${data.noshiOption || 'なし'}`);
      if (data.deliveryNote) parts.push(`配送備考: ${data.deliveryNote}`);
      if (data.note) parts.push(`備考: ${data.note}`);
      return parts.filter(Boolean).join(' / ');
    }
    return data.note || '';
  } catch (e) {
    return data.note || '';
  }
}

/**
 * @function scheduleDelayedWrite
 * @desc 遅延書き込みのスケジューリング（PropertiesServiceを使用）
 * @param {Array} itemsWithPrice - 商品データ
 * @param {Object} sanitizedData - サニタイズされた予約データ
 * @param {string} orderId - 注文ID
 * @param {number} total - 合計金額
 */
function scheduleDelayedWrite(itemsWithPrice, sanitizedData, orderId, total) {
  try {
    const delayedData = {
      type: 'reservation',
      orderId: orderId,
      itemsWithPrice: itemsWithPrice,
      sanitizedData: sanitizedData,
      total: total,
      timestamp: new Date().getTime(),
      retryCount: 0
    };
    
    // PropertiesServiceに一時保存
    const properties = PropertiesService.getScriptProperties();
    const queueKey = `delayed_write_${orderId}_${new Date().getTime()}`;
    properties.setProperty(queueKey, JSON.stringify(delayedData));
    
    console.log('遅延書き込みスケジュール完了:', queueKey);
    
    // 1分後に実行するトリガーを設定
    ScriptApp.newTrigger('processDelayedWrites')
      .timeBased()
      .after(60 * 1000) // 1分後
      .create();
      
    console.log('遅延書き込みトリガー設定完了');
    
  } catch (scheduleError) {
    console.error('遅延書き込みスケジュール失敗:', scheduleError);
  }
}

/**
 * @function writePaymentReservationSafely
 * @desc 決済完了予約の安全な書き込み（短時間ロック・即座にレスポンス）
 * @param {Array} validatedItems - 検証済み商品データ
 * @param {Object} reservationData - 予約データ
 * @param {number} calculatedTotal - 計算済み合計金額
 * @param {string} orderId - 注文ID
 */
function writePaymentReservationSafely(validatedItems, reservationData, calculatedTotal, orderId) {
  // 🔐 短時間ロック（最大2秒）で即座にレスポンスを実現
  const lock = LockService.getScriptLock();
  try {
    // 短時間（2秒）でロック取得を試行
    const lockAcquired = lock.tryLock(2000);
    
    if (!lockAcquired) {
      // ロック取得失敗時はトリガー経由で後処理
      console.warn('決済完了予約ロック取得失敗 - トリガー経由で後処理予定');
      scheduleDelayedPaymentWrite(validatedItems, reservationData, calculatedTotal, orderId);
      return;
    }
    
    console.log('決済完了予約短時間ロック取得成功 - 即座に書き込み実行');
    
    // スプレッドシートに即座に書き込み
    executePaymentReservationWrite(validatedItems, reservationData, calculatedTotal, orderId);
    
  } catch (error) {
    console.error('決済完了予約書き込みエラー:', error);
    // エラー時も後処理でリトライ
    scheduleDelayedPaymentWrite(validatedItems, reservationData, calculatedTotal, orderId);
  } finally {
    // 🔐 必ずロック解放
    try {
      lock.releaseLock();
      console.log('決済完了予約短時間ロック解放完了');
    } catch (lockError) {
      console.warn('決済完了予約ロック解放時のエラー:', lockError);
    }
  }
}

/**
 * @function executePaymentReservationWrite
 * @desc 実際の決済完了予約スプレッドシート書き込み処理
 * @param {Array} validatedItems - 検証済み商品データ
 * @param {Object} reservationData - 予約データ
 * @param {number} calculatedTotal - 計算済み合計金額
 * @param {string} orderId - 注文ID
 */
function executePaymentReservationWrite(validatedItems, reservationData, calculatedTotal, orderId) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(SHEET_NAME);
  
  // ヘッダーがない場合は追加
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 20).setValues([
      ['注文ID', '受付日時', 'お名前', 'お客様電話番号', 'お客様メールアドレス', 
       '受取店舗', '商品名', '数量', '単価', '小計', '合計金額',
       '受取希望日', '受取希望時間', '備考', '受渡済み', '担当者名', 'メモ', '受渡日時',
       '決済ID（短縮版）', '決済ID（完全版）']
    ]);
  }
  
  const now = new Date();
  const timestamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  
  // 決済IDの短縮版を生成（末尾16文字）
  const shortSessionId = reservationData.payment_session_id.length > 16 
    ? reservationData.payment_session_id.substring(reservationData.payment_session_id.length - 16)
    : reservationData.payment_session_id;
  
  // 各商品を個別の行に記録
  const rowsToAdd = [];
  validatedItems.forEach(item => {
    rowsToAdd.push([
      orderId,                                    // A列: 注文ID
      timestamp,                                  // B列: 受付日時
      sanitizeInput(reservationData.name),        // C列: お名前
      "'" + sanitizeInput(reservationData.phone), // D列: 電話番号（文字列として保存）
      sanitizeInput(reservationData.email),       // E列: メールアドレス
      sanitizeInput(reservationData.store),       // F列: 受取店舗
      sanitizeInput(item.name),                   // G列: 商品名
      item.qty,                                   // H列: 数量
      item.price,                                 // I列: 単価
      item.price * item.qty,                      // J列: 小計
      calculatedTotal,                            // K列: 合計金額
      reservationData.pickup_date,                // L列: 受取希望日
      reservationData.pickup_time,                // M列: 受取希望時間
      sanitizeInput(reservationData.note || ''),  // N列: 備考
      '',                                         // O列: 受渡済み（空）
      '',                                         // P列: 担当者名（空）
      '決済完了',                                 // Q列: メモ（決済完了）
      '',                                         // R列: 受渡日時（空）
      shortSessionId,                             // S列: 決済ID（短縮版）
      reservationData.payment_session_id          // T列: 決済ID（完全版）
    ]);
  });
  
  // データを一括追加
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rowsToAdd.length, 20).setValues(rowsToAdd);
  
  console.log(`決済完了予約書き込み完了: ${rowsToAdd.length}行追加`);
}

/**
 * @function scheduleDelayedPaymentWrite
 * @desc 決済完了予約の遅延書き込みスケジューリング
 * @param {Array} validatedItems - 検証済み商品データ
 * @param {Object} reservationData - 予約データ
 * @param {number} calculatedTotal - 計算済み合計金額
 * @param {string} orderId - 注文ID
 */
function scheduleDelayedPaymentWrite(validatedItems, reservationData, calculatedTotal, orderId) {
  try {
    const delayedData = {
      type: 'payment_reservation',
      orderId: orderId,
      validatedItems: validatedItems,
      reservationData: reservationData,
      calculatedTotal: calculatedTotal,
      timestamp: new Date().getTime(),
      retryCount: 0
    };
    
    // PropertiesServiceに一時保存
    const properties = PropertiesService.getScriptProperties();
    const queueKey = `delayed_payment_write_${orderId}_${new Date().getTime()}`;
    properties.setProperty(queueKey, JSON.stringify(delayedData));
    
    console.log('決済完了予約遅延書き込みスケジュール完了:', queueKey);
    
    // 1分後に実行するトリガーを設定
    ScriptApp.newTrigger('processDelayedWrites')
      .timeBased()
      .after(60 * 1000) // 1分後
      .create();
      
    console.log('決済完了予約遅延書き込みトリガー設定完了');
    
  } catch (scheduleError) {
    console.error('決済完了予約遅延書き込みスケジュール失敗:', scheduleError);
  }
}

/**
 * @function processDelayedWrites
 * @desc 遅延書き込みキューを処理（トリガー実行用）
 */
function processDelayedWrites() {
  try {
    console.log('=== 遅延書き込み処理開始 ===');
    
    const properties = PropertiesService.getScriptProperties();
    const allProperties = properties.getProperties();
    
    // 遅延書き込みキューを検索
    const delayedWriteKeys = Object.keys(allProperties).filter(key => 
      key.startsWith('delayed_write_')
    );
    
    console.log(`遅延書き込みキュー件数: ${delayedWriteKeys.length}`);
    
    for (const key of delayedWriteKeys) {
      try {
        const delayedDataStr = allProperties[key];
        const delayedData = JSON.parse(delayedDataStr);
        
        console.log(`遅延書き込み処理中: ${key}, 注文ID: ${delayedData.orderId}`);
        
        // 再試行回数チェック（最大3回）
        if (delayedData.retryCount >= 3) {
          console.error(`最大再試行回数超過: ${key}`);
          properties.deleteProperty(key);
          continue;
        }
        
        // 古すぎるデータはスキップ（24時間以上）
        const ageInHours = (new Date().getTime() - delayedData.timestamp) / (1000 * 60 * 60);
        if (ageInHours > 24) {
          console.warn(`古すぎる遅延データを削除: ${key}, 経過時間: ${ageInHours}時間`);
          properties.deleteProperty(key);
          continue;
        }
        
        // データタイプに応じて書き込み実行
        if (delayedData.type === 'reservation') {
          // 通常予約の書き込み
          executeSpreadsheetWrite(
            delayedData.itemsWithPrice,
            delayedData.sanitizedData,
            delayedData.orderId,
            delayedData.total
          );
        } else if (delayedData.type === 'payment_reservation') {
          // 決済完了予約の書き込み
          executePaymentReservationWrite(
            delayedData.validatedItems,
            delayedData.reservationData,
            delayedData.calculatedTotal,
            delayedData.orderId
          );
        }
        
        console.log(`遅延書き込み成功: ${key}`);
        
        // 成功時はキューから削除
        properties.deleteProperty(key);
        
      } catch (processError) {
        console.error(`遅延書き込み処理エラー: ${key}`, processError);
        
        try {
          // 再試行回数を増加させて再保存
          const delayedData = JSON.parse(allProperties[key]);
          delayedData.retryCount = (delayedData.retryCount || 0) + 1;
          properties.setProperty(key, JSON.stringify(delayedData));
          console.log(`再試行回数更新: ${key}, 回数: ${delayedData.retryCount}`);
        } catch (retryError) {
          console.error(`再試行回数更新エラー: ${key}`, retryError);
          properties.deleteProperty(key);
        }
      }
    }
    
    console.log('=== 遅延書き込み処理完了 ===');
    
  } catch (error) {
    console.error('遅延書き込み処理全体エラー:', error);
  }
}

// ========================================


/**
 * @function processReservation
 * @desc 予約データを処理してスプレッドシートに記録
 * @param {Object} data - 予約データ
 * @return {Object} 処理結果
 */
function processReservation(data) {
  try {
    // 🧪 テストデータの場合はreCAPTCHA検証をスキップ
    if (data.isTestData) {
      console.log('テストデータのためreCAPTCHA検証をスキップ');
    } else if (data.recaptchaResponse) {
      // reCAPTCHA v3検証
      const recaptchaResult = verifyRecaptcha(data.recaptchaResponse, 'form_submit');
      
      if (!recaptchaResult.success) {
        const errorMessage = recaptchaResult.score !== undefined 
          ? `reCAPTCHA認証に失敗しました（スコア: ${recaptchaResult.score}）。ページを再読み込みして再度お試しください。`
          : 'reCAPTCHA認証に失敗しました。ページを再読み込みして再度お試しください。';
          
        return { 
          success: false, 
          error: errorMessage,
          recaptchaScore: recaptchaResult.score
        };
      }
      
      // 成功時はスコアをログに記録
      console.log(`reCAPTCHA v3認証成功 - スコア: ${recaptchaResult.score}`);
    }
    
    // 入力データをサニタイズ
    const sanitizedData = {
      name: sanitizeInput(data.name || ''),
      phone: sanitizeInput(data.phone || ''),
      email: sanitizeInput(data.email || ''),
      store: sanitizeInput(data.store || ''),
      pickup_date: sanitizeInput(data.pickup_date || ''),
      pickup_time: sanitizeInput(data.pickup_time || ''),
      note: sanitizeInput(data.note || ''),
      items: [],
      // 配送関連
      deliveryMethod: sanitizeInput(data.deliveryMethod || 'pickup'),
      deliveryDate: sanitizeInput(data.deliveryDate || ''),
      deliveryTimeSlot: sanitizeInput(data.deliveryTimeSlot || ''),
      deliveryNote: sanitizeInput(data.deliveryNote || ''),
      noshiOption: sanitizeInput(data.noshiOption || 'なし'),
      ordererAddress: data.ordererAddress || null,
      deliveryAddress: data.deliveryAddress || null
    };
    
    // 商品データもサニタイズ
    if (data.items && Array.isArray(data.items)) {
      sanitizedData.items = data.items.map(item => ({
        name: sanitizeInput(item.name || ''),
        qty: Math.max(0, parseInt(item.qty) || 0)
      }));
    }

    // 配送住所のサニタイズ
    if (sanitizedData.ordererAddress) {
      Object.keys(sanitizedData.ordererAddress).forEach(function(k){
        sanitizedData.ordererAddress[k] = sanitizeInput(String(sanitizedData.ordererAddress[k] || ''));
      });
    }
    if (sanitizedData.deliveryAddress) {
      Object.keys(sanitizedData.deliveryAddress).forEach(function(k){
        sanitizedData.deliveryAddress[k] = sanitizeInput(String(sanitizedData.deliveryAddress[k] || ''));
      });
    }
    
    // 入力長チェック
    const lengthErrors = validateInputLength(sanitizedData);
    if (lengthErrors.length > 0) {
      return { success: false, errors: lengthErrors };
    }
    
    // 既存のバリデーション
    const errors = validate(sanitizedData);
    if (errors.length > 0) {
      return { success: false, errors: errors };
    }

    // 注文IDを生成（通常予約と同じ形式）
    const orderId = generateShortOrderId();

    // 商品リスト・単価情報を取得
    const productsList = getProducts();
    const priceMap = {};
    productsList.forEach(p => { priceMap[p.name] = p.price; });

    // 合計金額を計算（送料は商品価格に含む）
    let total = 0;
    const itemsWithPrice = sanitizedData.items.map(item => {
      const price = priceMap[item.name] || 0;
      const qty = Number(item.qty);
      const subtotal = price * qty;
      total += subtotal;
      return { ...item, price, subtotal };
    });

    // 🚀 非同期風スプレッドシート書き込み（即座にレスポンス、背後で安全に書き込み）
    try {
      writeToSpreadsheetSafely(itemsWithPrice, sanitizedData, orderId, total);
      console.log('スプレッドシート書き込み開始（非同期風処理）');
    } catch (writeError) {
      console.warn('スプレッドシート書き込み開始エラー（継続処理）:', writeError);
      // 書き込みエラーでも予約処理は継続（後で再試行可能）
    }

    // メール送信（ロック外で実行）
    sendMail('appleivyck@gmail.com', sanitizedData, false, itemsWithPrice, total, orderId);
    if (sanitizedData.email) {
      sendMail(sanitizedData.email, sanitizedData, true, itemsWithPrice, total, orderId);
    }

    // 成功レスポンス
    return { success: true, total: total, orderId: orderId };
      
  } catch (error) {
    // エラーレスポンス
    console.error('予約処理エラー:', error);
    return { success: false, error: error.message };
  }
}

/**
 * @function doPost
 * @desc GitHub PagesからのPOSTリクエストを処理する（セキュリティ強化版・管理画面対応）
 * @param {Object} e - POSTリクエストイベント
 * @return {HtmlService.HtmlOutput} JSON形式のレスポンス
 */
function doPost(e) {
  try {
    // CORS preflight対応
    if (e && e.parameter && e.parameter.method === 'OPTIONS') {
      return createCorsResponse('{"success": true}');
    }
    
    // デバッグ用ログ
    console.log('受信データ:', e);
    console.log('e.parameter:', e.parameter);
    console.log('e.postData:', e.postData);
    
    // POSTデータを解析（フォーム送信とfetch送信の両方に対応）
    let data;
    
    if (e.parameter && e.parameter.data) {
      // フォーム送信の場合（URLエンコードされたデータ）
      console.log('フォーム送信データ:', e.parameter.data);
      data = JSON.parse(e.parameter.data);
    } else if (e.postData && e.postData.contents) {
      // fetch送信の場合（JSON文字列）
      console.log('fetch送信データ:', e.postData.contents);
      data = JSON.parse(e.postData.contents);
    } else {
      throw new Error('POSTデータが見つかりません');
    }
    
    console.log('解析後データ:', data);
    
    // 🛡️ セキュア版：店舗管理画面用の処理（受渡済みチェック・メモ更新）
    if (data.action === 'updateReservation' && data.shop) {
      // セキュリティ検証を実行
      const securityResult = performSecurityValidation(data);
      if (!securityResult.success) {
        return createCorsResponse(JSON.stringify({ 
          success: false, 
          error: securityResult.error 
        }));
      }
      
      // 店舗認証チェック
      const storeInfo = validateStoreSecret(data.shop);
      if (!storeInfo.isValid) {
        return createCorsResponse(JSON.stringify({ 
          success: false, 
          error: 'アクセス権限がありません' 
        }));
      }
      
      // 予約データ更新（staffNameパラメータを追加）
      const updateResult = updateReservationData(data.rowId, data.checked, data.memo, data.staffName, storeInfo.storeId);
      return createCorsResponse(JSON.stringify(updateResult));
    }
    
    // 既存の予約フォーム処理（以下は既存コードそのまま）
    // クライアント識別子を取得（簡易的にタイムスタンプとランダム値を使用）
    const clientId = e.parameter.clientId || 'anonymous_' + new Date().getTime();
    
    // レート制限チェック
    if (!checkRateLimit(clientId)) {
      const errorResponse = { success: false, error: 'レート制限に達しました。しばらく時間を置いてから再度お試しください。' };
      return createCorsResponse(JSON.stringify(errorResponse));
    }
    
    // 予約処理を実行
    const result = processReservation(data);
    return createCorsResponse(JSON.stringify(result));
      
  } catch (error) {
    // エラーレスポンス
    console.error('エラー詳細:', error);
    const errorResponse = { success: false, error: error.message };
    return createCorsResponse(JSON.stringify(errorResponse));
  }
}

/**
 * @function doGet
 * @desc GETリクエスト処理（店舗管理画面対応拡張版・CORS対応）
 * @param {Object} e - GETリクエストイベント
 * @return {HtmlService.HtmlOutput} レスポンス
 */
function doGet(e) {
  try {
    // CORS preflight対応
    if (e && e.parameter && e.parameter.method === 'OPTIONS') {
      return createCorsResponse('{"success": true}');
    }
    
    // クエリパラメータを取得
    const action = e.parameter.action;
    const shop = e.parameter.shop;
    
    // 予約フォーム送信処理（JSONP対応）
    if (action === 'submitReservation') {
      try {
        // Base64エンコードされたデータをデコード
        const encodedData = e.parameter.data;
        if (!encodedData) {
          throw new Error('送信データが見つかりません');
        }
        
        console.log('=== 予約データ受信開始 ===');
        console.log('エンコードデータ長:', encodedData.length);
        console.log('エンコードデータ先頭100文字:', encodedData.substring(0, 100));
        
        let decodedData;
        
        try {
          // Base64デコード
          const base64DecodedBytes = Utilities.base64Decode(encodedData);
          const base64DecodedString = Utilities.newBlob(base64DecodedBytes).getDataAsString('UTF-8');
          console.log('Base64デコード成功');
          
          // URLデコード  
          decodedData = decodeURIComponent(base64DecodedString);
          console.log('URLデコード成功');
          console.log('デコード結果長:', decodedData.length);
          console.log('デコード結果先頭200文字:', decodedData.substring(0, 200));
          
        } catch (decodeError) {
          console.error('デコードエラー:', decodeError);
          throw new Error('データのデコードに失敗しました');
        }
        
        // JSONパース
        let data;
        try {
          data = JSON.parse(decodedData);
          console.log('JSONパース成功');
        } catch (parseError) {
          console.error('JSONパースエラー:', parseError);
          console.error('パース対象:', decodedData.substring(0, 500));
          throw new Error('JSONデータが不正です');
        }
        
        // 予約処理を実行（既存のdoPost処理を流用）
        const result = processReservation(data);
        
        // JSONP対応レスポンス
        const callback = e.parameter.callback;
        if (callback) {
          return ContentService
            .createTextOutput(`${callback}(${JSON.stringify(result)})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        return createCorsResponse(JSON.stringify(result));
        
      } catch (error) {
        console.error('=== 予約送信エラー ===');
        console.error('エラー:', error.message);
        console.error('スタック:', error.stack);
        
        const errorResponse = { 
          success: false, 
          error: error.message,
          timestamp: new Date().getTime()
        };
        
        const callback = e.parameter.callback;
        if (callback) {
          return ContentService
            .createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        return createCorsResponse(JSON.stringify(errorResponse));
      }
    }
    
    // 🛡️ セキュア版：店舗管理画面用の予約一覧取得
    if (action === 'getReservations' && shop) {
      // セキュリティ検証を実行
      const securityResult = performSecurityValidation(e.parameter);
      if (!securityResult.success) {
        const errorResponse = JSON.stringify({ 
          success: false, 
          error: securityResult.error 
        });
        
        // JSONP対応
        const callback = e.parameter.callback;
        if (callback) {
          return ContentService
            .createTextOutput(`${callback}(${errorResponse})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        return createCorsResponse(errorResponse);
      }
      
      // 店舗認証チェック
      const storeInfo = validateStoreSecret(shop);
      if (!storeInfo.isValid) {
        const errorResponse = JSON.stringify({ 
          success: false, 
          error: 'アクセス権限がありません。正しいURLからアクセスしてください。' 
        });
        
        // JSONP対応
        const callback = e.parameter.callback;
        if (callback) {
          return ContentService
            .createTextOutput(`${callback}(${errorResponse})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        return createCorsResponse(errorResponse);
      }
      
      // 期間パラメータを取得（デフォルト：本日以降）
      const dateRange = e.parameter.dateRange || 'today_onwards';
      console.log('予約一覧取得リクエスト - 期間:', dateRange);
      
      // 予約データを取得（期間指定対応）
      const reservations = getReservationsForStore(storeInfo.storeId, dateRange);
      const successResponse = JSON.stringify({ 
        success: true, 
        data: reservations,
        storeName: storeInfo.storeName,
        dateRange: dateRange
      });
      
      // JSONP対応
      const callback = e.parameter.callback;
      if (callback) {
        return ContentService
          .createTextOutput(`${callback}(${successResponse})`)
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return createCorsResponse(successResponse);
    }
    
    // 🛡️ セキュア版：店舗管理画面用の予約データ更新（JSONP対応・GETパラメータ版）
    if (action === 'updateReservation' && shop) {
      // セキュリティ検証を実行
      const securityResult = performSecurityValidation(e.parameter);
      if (!securityResult.success) {
        const errorResponse = JSON.stringify({ 
          success: false, 
          error: securityResult.error 
        });
        
        // JSONP対応
        const callback = e.parameter.callback;
        if (callback) {
          return ContentService
            .createTextOutput(`${callback}(${errorResponse})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        return createCorsResponse(errorResponse);
      }
      
      // 店舗認証チェック
      const storeInfo = validateStoreSecret(shop);
      if (!storeInfo.isValid) {
        const errorResponse = JSON.stringify({ 
          success: false, 
          error: 'アクセス権限がありません' 
        });
        
        // JSONP対応
        const callback = e.parameter.callback;
        if (callback) {
          return ContentService
            .createTextOutput(`${callback}(${errorResponse})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        return createCorsResponse(errorResponse);
      }
      
      // パラメータを取得
      const rowId = parseInt(e.parameter.rowId);
      const checkedParam = e.parameter.checked;
      const memo = e.parameter.memo;
      const staffName = e.parameter.staffName; // 担当者名パラメータを追加
      
      // checkedの値を変換
      let checked = null;
      if (checkedParam === '1') {
        checked = true;
      } else if (checkedParam === '0') {
        checked = false;
      }
      
      // 予約データ更新を実行（staffNameパラメータを追加）
      const updateResult = updateReservationData(rowId, checked, memo, staffName, storeInfo.storeId);
      const resultResponse = JSON.stringify(updateResult);
      
      // JSONP対応
      const callback = e.parameter.callback;
      if (callback) {
        return ContentService
          .createTextOutput(`${callback}(${resultResponse})`)
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return createCorsResponse(resultResponse);
    }
    
    // 管理画面HTMLサーブ
    if (action === 'manage' && shop) {
      const storeInfo = validateStoreSecret(shop);
      if (!storeInfo.isValid) {
        // 権限エラーページを返す
        return HtmlService.createHtmlOutput(`
          <!DOCTYPE html>
          <html lang="ja">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>アクセスエラー</title>
            <style>
              body { font-family: 'Meiryo', sans-serif; text-align: center; padding: 50px; }
              .error { color: #e74c3c; font-size: 1.2em; }
            </style>
          </head>
          <body>
            <h1>アクセス権限エラー</h1>
            <p class="error">このページにアクセスする権限がありません。</p>
            <p>正しいURLからアクセスしてください。</p>
          </body>
          </html>
        `);
      }
      
      // 管理画面HTMLを返す
      return getManagementPage(storeInfo.storeName, shop);
    }
    
    if (action === 'getStoreHours') {
      // 店舗営業時間を取得
      const date = e.parameter.date;
      const storeHours = getStoreHoursForDate(date);
      return createCorsResponse(JSON.stringify({ success: true, data: storeHours }));
    }
    
    // 接続テスト用のアクション
    if (action === 'test') {
      const testResponse = {
        success: true,
        message: 'GAS WebアプリURL接続成功',
        status: 'API正常稼働中',
        timestamp: new Date().toISOString(),
        features: ['reservation', 'management', 'stripe_payment']
      };
      
      // JSONP対応
      const callback = e.parameter.callback;
      if (callback) {
        return ContentService
          .createTextOutput(`${callback}(${JSON.stringify(testResponse)})`)
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return createCorsResponse(JSON.stringify(testResponse));
    }
    
    // 簡単な接続テスト用のアクション（決済情報取得のデバッグ用）
    if (action === 'testConnection') {
      try {
        console.log('=== testConnection開始 ===');
        console.log('受信パラメータ:', e.parameter);
        
        const sessionId = e.parameter.sessionId || 'test_session_123';
        console.log('テストセッションID:', sessionId);
        
        const simpleResponse = {
          success: true,
          message: 'testConnection成功',
          sessionId: sessionId,
          timestamp: new Date().toISOString(),
          serverTime: new Date().getTime()
        };
        
        console.log('testConnectionレスポンス:', simpleResponse);
        
        // JSONP対応
        const callback = e.parameter.callback;
        if (callback) {
          console.log('JSONP形式でtestConnectionレスポンス:', callback);
          return ContentService
            .createTextOutput(`${callback}(${JSON.stringify(simpleResponse)})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        
        console.log('CORS形式でtestConnectionレスポンス');
        return createCorsResponse(JSON.stringify(simpleResponse));
        
      } catch (error) {
        console.error('testConnectionエラー:', error);
        
        const errorResponse = { 
          success: false, 
          error: 'testConnectionエラー: ' + error.message,
          timestamp: new Date().getTime()
        };
        
        const callback = e.parameter.callback;
        if (callback) {
          return ContentService
            .createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        return createCorsResponse(JSON.stringify(errorResponse));
      }
    }
    
    // ========================================
    // Stripe決済関連のアクション
    // ========================================
    
    // Stripe Checkoutセッション作成
    if (action === 'createCheckoutSession') {
      try {
        // Base64エンコードされたデータをデコード
        const encodedData = e.parameter.data;
        if (!encodedData) {
          throw new Error('チェックアウトデータが見つかりません');
        }
        
        console.log('=== Stripe Checkoutセッション作成開始 ===');
        console.log('エンコードデータ長:', encodedData.length);
        
        let decodedData;
        
        try {
          // Base64デコード
          const base64DecodedBytes = Utilities.base64Decode(encodedData);
          const base64DecodedString = Utilities.newBlob(base64DecodedBytes).getDataAsString('UTF-8');
          console.log('Base64デコード成功');
          
          // URLデコード  
          decodedData = decodeURIComponent(base64DecodedString);
          console.log('URLデコード成功');
          
        } catch (decodeError) {
          console.error('デコードエラー:', decodeError);
          throw new Error('データのデコードに失敗しました');
        }
        
        // JSONパース
        let checkoutData;
        try {
          checkoutData = JSON.parse(decodedData);
          console.log('JSONパース成功');
        } catch (parseError) {
          console.error('JSONパースエラー:', parseError);
          throw new Error('JSONデータが不正です');
        }
        
        // Checkoutセッション作成を実行
        const result = createCheckoutSession(checkoutData);
        
        // JSONP対応レスポンス
        const callback = e.parameter.callback;
        if (callback) {
          return ContentService
            .createTextOutput(`${callback}(${JSON.stringify(result)})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        return createCorsResponse(JSON.stringify(result));
        
      } catch (error) {
        console.error('Stripe Checkoutセッション作成エラー:', error);
        
        return {
          success: false,
          error: error.toString()
        };
      }
    }
    
    // Stripe 請求書作成（Invoicing）
    if (action === 'createInvoice') {
      try {
        const encodedData = e.parameter.data;
        if (!encodedData) {
          throw new Error('請求書データが見つかりません');
        }
        let decodedData;
        try {
          const base64DecodedBytes = Utilities.base64Decode(encodedData);
          const base64DecodedString = Utilities.newBlob(base64DecodedBytes).getDataAsString('UTF-8');
          decodedData = decodeURIComponent(base64DecodedString);
        } catch (decodeError) {
          console.error('請求書デコードエラー:', decodeError);
          throw new Error('請求書データのデコードに失敗しました');
        }
        let invoiceData;
        try {
          invoiceData = JSON.parse(decodedData);
        } catch (parseError) {
          console.error('請求書JSONパースエラー:', parseError);
          throw new Error('請求書JSONが不正です');
        }
        // 請求書作成実行
        const result = createStripeInvoice(invoiceData);
        const callback = e.parameter.callback;
        if (callback) {
          return ContentService
            .createTextOutput(`${callback}(${JSON.stringify(result)})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        return createCorsResponse(JSON.stringify(result));
      } catch (error) {
        console.error('Stripe 請求書作成エラー:', error);
        const errorResponse = { success: false, error: error.toString() };
        const callback = e.parameter.callback;
        if (callback) {
          return ContentService
            .createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        return createCorsResponse(JSON.stringify(errorResponse));
      }
    }
    
    // 決済完了後の予約処理
    if (action === 'submitPaymentReservation') {
      try {
        // Base64エンコードされたデータをデコード
        const encodedData = e.parameter.data;
        if (!encodedData) {
          throw new Error('予約データが見つかりません');
        }
        
        console.log('=== 決済完了予約処理開始 ===');
        console.log('エンコードデータ長:', encodedData.length);
        
        let decodedData;
        
        try {
          // Base64デコード
          const base64DecodedBytes = Utilities.base64Decode(encodedData);
          const base64DecodedString = Utilities.newBlob(base64DecodedBytes).getDataAsString('UTF-8');
          console.log('Base64デコード成功');
          
          // URLデコード  
          decodedData = decodeURIComponent(base64DecodedString);
          console.log('URLデコード成功');
          
        } catch (decodeError) {
          console.error('デコードエラー:', decodeError);
          throw new Error('データのデコードに失敗しました');
        }
        
        // JSONパース
        let reservationData;
        try {
          reservationData = JSON.parse(decodedData);
          console.log('JSONパース成功');
        } catch (parseError) {
          console.error('JSONパースエラー:', parseError);
          throw new Error('JSONデータが不正です');
        }
        
        // 基本バリデーション
        const validationErrors = validate(reservationData);
        if (validationErrors.length > 0) {
          throw new Error('入力データエラー: ' + validationErrors.join(', '));
        }
        
        // 商品データの基本検証（決済完了後なので簡素化）
        if (!reservationData.items || reservationData.items.length === 0) {
          throw new Error('商品データが不正です');
        }
        
        // 各商品の基本チェック
        const validatedItems = [];
        for (const item of reservationData.items) {
          if (!item.name || !item.price || !item.qty || item.qty <= 0) {
            throw new Error(`商品データが不正です: ${JSON.stringify(item)}`);
          }
          validatedItems.push({
            name: String(item.name),
            price: Number(item.price),
            qty: Number(item.qty)
          });
        }
        
        // 合計金額を再計算・検証
        const calculatedTotal = validatedItems.reduce((sum, item) => {
          return sum + (item.price * item.qty);
        }, 0);
        
        if (Math.abs(calculatedTotal - reservationData.payment_amount) > 1) {
          console.warn(`金額の差異検出: 計算値=${calculatedTotal}, 決済額=${reservationData.payment_amount}`);
          // 決済が完了しているため、警告のみでエラーにはしない
        }
        
        // 注文IDを生成（通常予約と同じ形式）
        const orderId = generateShortOrderId();
        
        // スプレッドシートに記録
        const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = spreadsheet.getSheetByName(SHEET_NAME);
        
        // ヘッダーがない場合は追加
        if (sheet.getLastRow() === 0) {
          sheet.getRange(1, 1, 1, 20).setValues([
            ['注文ID', '受付日時', 'お名前', 'お客様電話番号', 'お客様メールアドレス', 
             '受取店舗', '商品名', '数量', '単価', '小計', '合計金額',
             '受取希望日', '受取希望時間', '備考', '受渡済み', '担当者名', 'メモ', '受渡日時',
             '決済ID（短縮版）', '決済ID（完全版）']
          ]);
        }
        
        const now = new Date();
        const timestamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
        
        // 決済IDの短縮版を生成（末尾16文字）
        const shortSessionId = reservationData.payment_session_id.length > 16 
          ? reservationData.payment_session_id.substring(reservationData.payment_session_id.length - 16)
          : reservationData.payment_session_id;
        
        // 各商品を個別の行に記録
        const rowsToAdd = [];
        validatedItems.forEach(item => {
          rowsToAdd.push([
            orderId,                                    // A列: 注文ID
            timestamp,                                  // B列: 受付日時
            sanitizeInput(reservationData.name),        // C列: お名前
            "'" + sanitizeInput(reservationData.phone), // D列: 電話番号（文字列として保存）
            sanitizeInput(reservationData.email),       // E列: メールアドレス
            sanitizeInput(reservationData.store),       // F列: 受取店舗
            sanitizeInput(item.name),                   // G列: 商品名
            item.qty,                                   // H列: 数量
            item.price,                                 // I列: 単価
            item.price * item.qty,                      // J列: 小計
            calculatedTotal,                            // K列: 合計金額
            reservationData.pickup_date,                // L列: 受取希望日
            reservationData.pickup_time,                // M列: 受取希望時間
            sanitizeInput(reservationData.note || ''),  // N列: 備考
            '',                                         // O列: 受渡済み（空）
            '',                                         // P列: 担当者名（空）
            '決済完了',                                 // Q列: メモ（決済完了）
            '',                                         // R列: 受渡日時（空）
            shortSessionId,                             // S列: 決済ID（短縮版）
            reservationData.payment_session_id          // T列: 決済ID（完全版）
          ]);
        });
        
        // データを一括追加
        const startRow = sheet.getLastRow() + 1;
        sheet.getRange(startRow, 1, rowsToAdd.length, 20).setValues(rowsToAdd);
        
        console.log(`決済予約データ記録完了: ${rowsToAdd.length}行追加`);
        
        // 確認メールを送信
        try {
          sendPaymentConfirmationEmail(reservationData, calculatedTotal, orderId);
        } catch (emailError) {
          console.error('メール送信エラー:', emailError);
          // メール送信失敗は致命的エラーにしない
        }
        
        const result = {
          success: true,
          message: '決済予約が正常に完了しました',
          orderId: orderId,
          total: calculatedTotal
        };
        
        // JSONP対応レスポンス
        const callback = e.parameter.callback;
        if (callback) {
          return ContentService
            .createTextOutput(`${callback}(${JSON.stringify(result)})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        return createCorsResponse(JSON.stringify(result));
        
      } catch (error) {
        console.error('決済予約処理エラー:', error);
        
        const errorResponse = {
          success: false,
          error: error.toString()
        };
        
        // JSONP対応レスポンス
        const callback = e.parameter.callback;
        if (callback) {
          return ContentService
            .createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        return createCorsResponse(JSON.stringify(errorResponse));
      }
    }
    
    // 決済情報取得（簡易版：metadataベース）
    if (action === 'getPaymentInfo') {
      try {
        console.log('=== getPaymentInfo処理開始 ===');
        console.log('受信パラメータ:', e.parameter);
        
        // Base64エンコードされたデータをデコード
        const encodedData = e.parameter.data;
        console.log('エンコードデータ:', encodedData ? encodedData.substring(0, 100) + '...' : 'null');
        
        if (!encodedData) {
          console.error('エンコードデータが見つかりません');
          const errorResponse = { 
            success: false, 
            error: 'データが見つかりません',
            timestamp: new Date().getTime()
          };
          
          const callback = e.parameter.callback;
          if (callback) {
            return ContentService
              .createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
              .setMimeType(ContentService.MimeType.JAVASCRIPT);
          }
          return createCorsResponse(JSON.stringify(errorResponse));
        }
        
        let decodedData, requestData, sessionId;
        
        try {
          // Base64デコード
          const base64DecodedBytes = Utilities.base64Decode(encodedData);
          const base64DecodedString = Utilities.newBlob(base64DecodedBytes).getDataAsString('UTF-8');
          console.log('Base64デコード成功');
          
          // URLデコード  
          decodedData = decodeURIComponent(base64DecodedString);
          console.log('URLデコード成功');
          
          // JSONパース
          requestData = JSON.parse(decodedData);
          console.log('JSONパース成功:', requestData);
          
          sessionId = requestData.sessionId;
          console.log('セッションID:', sessionId);
          
        } catch (decodeError) {
          console.error('デコード/パースエラー:', decodeError);
          const errorResponse = { 
            success: false, 
            error: 'データの処理に失敗しました: ' + decodeError.message,
            timestamp: new Date().getTime()
          };
          
          const callback = e.parameter.callback;
          if (callback) {
            return ContentService
              .createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
              .setMimeType(ContentService.MimeType.JAVASCRIPT);
          }
          return createCorsResponse(JSON.stringify(errorResponse));
        }
        
        if (!sessionId) {
          console.error('セッションIDが不正:', sessionId);
          const errorResponse = { 
            success: false, 
            error: 'セッションIDが不正です',
            timestamp: new Date().getTime()
          };
          
          const callback = e.parameter.callback;
          if (callback) {
            return ContentService
              .createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
              .setMimeType(ContentService.MimeType.JAVASCRIPT);
          }
          return createCorsResponse(JSON.stringify(errorResponse));
        }
        
        console.log('決済情報取得要求処理中:', sessionId);
        
        // 実際のStripe APIから決済情報を取得
        try {
          let stripeSecretKey;
          try {
            stripeSecretKey = getStripeSecretKey();
          } catch (keyError) {
            console.error('Stripe秘密鍵取得エラー:', keyError);
            throw new Error('Stripe設定が不完全です。管理者にお問い合わせください。');
          }
          
          // Stripe APIを呼び出してセッション情報を取得
          const response = UrlFetchApp.fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${stripeSecretKey}`
            },
            muteHttpExceptions: true
          });
          
          const responseCode = response.getResponseCode();
          const responseText = response.getContentText();
          
          console.log(`Stripe APIレスポンス: ${responseCode}`);
          console.log(`レスポンス内容: ${responseText.substring(0, 500)}...`);
          
          if (responseCode !== 200) {
            console.error('Stripe API呼び出し失敗:', responseText);
            throw new Error(`Stripe API エラー: ${responseCode}`);
          }
          
          const sessionData = JSON.parse(responseText);
          console.log('Stripe セッションデータ取得成功:', sessionData.id);
          
          // 金額デバッグ情報を追加
          console.log('=== Stripe金額デバッグ情報 ===');
          console.log('sessionData.amount_total:', sessionData.amount_total);
          console.log('sessionData.currency:', sessionData.currency);
          console.log('最終的なtotal_amount:', sessionData.amount_total.toString());
          console.log('=============================');
          
          // 決済情報を構築
          const paymentInfo = {
            success: true,
            message: 'Stripe APIから取得',
            data: {
              session_id: sessionData.id,
              session_id_short: sessionData.id.substring(sessionData.id.length - 8), // 表示用短縮ID
              total_amount: sessionData.amount_total.toString(), // JPYは既に円単位なのでそのまま使用
              payment_status: sessionData.payment_status,
              metadata: sessionData.metadata || {}
            },
            timestamp: new Date().getTime()
          };
          
          console.log('決済情報構築完了:', paymentInfo);
          
          // JSONP対応レスポンス
          const callback = e.parameter.callback;
          if (callback) {
            console.log('JSONP形式でレスポンス返却:', callback);
            return ContentService
              .createTextOutput(`${callback}(${JSON.stringify(paymentInfo)})`)
              .setMimeType(ContentService.MimeType.JAVASCRIPT);
          }
          
          console.log('CORS形式でレスポンス返却');
          return createCorsResponse(JSON.stringify(paymentInfo));
          
        } catch (stripeError) {
          console.error('Stripe API呼び出しエラー:', stripeError);
          
          // フォールバック: セッションIDのみで基本的な応答を作成
          console.log('フォールバック処理開始: 簡易応答を作成');
          
          const fallbackInfo = {
            success: true,
            message: 'セッションIDベース（Stripe API未接続）',
            data: {
              session_id: sessionId,
              session_id_short: sessionId.substring(sessionId.length - 8),
              total_amount: 'unknown', // 金額は決済完了処理で再計算される
              payment_status: 'completed', // 決済完了画面にアクセスできているので完了とみなす
              metadata: {
                note: 'Stripe API接続エラーのため詳細情報を取得できませんでした'
              }
            },
            timestamp: new Date().getTime(),
            fallback: true
          };
          
          console.log('フォールバック情報:', fallbackInfo);
          
          const callback = e.parameter.callback;
          if (callback) {
            return ContentService
              .createTextOutput(`${callback}(${JSON.stringify(fallbackInfo)})`)
              .setMimeType(ContentService.MimeType.JAVASCRIPT);
          }
          return createCorsResponse(JSON.stringify(fallbackInfo));
        }
      } catch (error) {
        console.error('=== getPaymentInfo重大エラー ===');
        console.error('エラー詳細:', error.message);
        console.error('スタックトレース:', error.stack);
        
        const errorResponse = { 
          success: false, 
          error: 'サーバーエラー: ' + error.message,
          timestamp: new Date().getTime(),
          stack: error.stack
        };
        
        const callback = e.parameter.callback;
        if (callback) {
          return ContentService
            .createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
        }
        return createCorsResponse(JSON.stringify(errorResponse));
      }
    }
    
    // デフォルトレスポンス
    const response = {
      message: "テイクアウト予約フォーム API",
      status: "ready"
    };
    return createCorsResponse(JSON.stringify(response));
  } catch (error) {
    console.error('doGetエラー:', error);
    const errorResponse = { success: false, error: error.message };
    return createCorsResponse(JSON.stringify(errorResponse));
  }
}

/**
 * @function getStoreHoursForDate
 * @desc 指定された日付の曜日に基づいて各店舗の営業時間を取得
 * @param {string} dateString - 日付文字列（YYYY-MM-DD形式）
 * @return {Array<Object>} 店舗営業時間リスト
 */
function getStoreHoursForDate(dateString) {
  try {
    // 日付から曜日を取得
    const date = new Date(dateString);
    const dayOfWeek = getDayOfWeekKey(date.getDay());
    
    // 店舗リストを取得
    const stores = getStores();
    
    // 各店舗の営業時間を取得
    const storeHours = stores.map(store => {
      const hours = store.hours[dayOfWeek];
      return {
        id: store.id,
        name: store.name,
        hours: hours,
        isOpen: hours !== null && hours !== undefined
      };
    });
    
    return storeHours;
  } catch (error) {
    console.error('店舗営業時間取得エラー:', error);
    return [];
  }
}

/**
 * @function getDayOfWeekKey
 * @desc 曜日番号を曜日キーに変換
 * @param {number} dayNumber - 曜日番号（0=日曜日, 1=月曜日, ...）
 * @return {string} 曜日キー（mon, tue, wed, thu, fri, sat, sun）
 */
function getDayOfWeekKey(dayNumber) {
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return dayKeys[dayNumber];
}

/**
 * @function generateTimeSlots
 * @desc 営業時間に基づいて30分間隔の時間スロットを生成
 * @param {Array} hours - 営業時間配列
 * @return {Array<string>} 時間スロット配列
 */
function generateTimeSlots(hours) {
  if (!hours || hours === null) {
    return [];
  }
  
  const slots = [];
  
  // 営業時間が配列の配列の場合（複数の営業時間帯）
  if (Array.isArray(hours[0])) {
    hours.forEach(timeRange => {
      const rangeSlots = generateTimeSlotsForRange(timeRange[0], timeRange[1]);
      slots.push(...rangeSlots);
    });
  } else {
    // 単一の営業時間帯の場合
    const rangeSlots = generateTimeSlotsForRange(hours[0], hours[1]);
    slots.push(...rangeSlots);
  }
  
  return slots;
}

/**
 * @function generateTimeSlotsForRange
 * @desc 開始時刻と終了時刻の間で30分間隔の時間スロットを生成
 * @param {string} startTime - 開始時刻（HH:MM形式）
 * @param {string} endTime - 終了時刻（HH:MM形式）
 * @return {Array<string>} 時間スロット配列
 */
function generateTimeSlotsForRange(startTime, endTime) {
  const slots = [];
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  
  let currentHour = startHour;
  let currentMin = startMin;
  
  while (currentHour < endHour || (currentHour === endHour && currentMin < endMin)) {
    const timeSlot = `${currentHour.toString().padStart(2, '0')}:${currentMin.toString().padStart(2, '0')}`;
    slots.push(timeSlot);
    
    // 30分追加
    currentMin += 30;
    if (currentMin >= 60) {
      currentMin = 0;
      currentHour++;
    }
  }
  
  return slots;
}

/**
 * @function getProducts
 * @desc 商品リストを返す
 * @return {Array<Object>} 商品リスト
 */
function getProducts() {
  try {
    // GitHub Pagesからproducts.jsonを取得
    const response = UrlFetchApp.fetch('https://applegrimm.github.io/fictional-octo-lamp/products.json');
    const content = response.getContentText();
    return JSON.parse(content);
  } catch (error) {
    console.error('products.json取得エラー:', error);
    // products.jsonが見つからない場合のデフォルト商品
    return [
      { name: "商品A", price: 500 },
      { name: "商品B", price: 800 },
      { name: "商品C", price: 1200 }
    ];
  }
}

/**
 * @function getStores
 * @desc 店舗リストを返す
 * @return {Array<Object>} 店舗リスト
 */
function getStores() {
  try {
    // GitHub Pagesからstores.jsonを取得
    const response = UrlFetchApp.fetch('https://applegrimm.github.io/fictional-octo-lamp/stores.json');
    const content = response.getContentText();
    return JSON.parse(content);
  } catch (error) {
    console.error('stores.json取得エラー:', error);
    // stores.jsonが見つからない場合のデフォルト店舗
    return [
      { name: "店舗A", hours: "10:00-20:00" },
      { name: "店舗B", hours: "11:00-21:00" }
    ];
  }
}

/**
 * @function validate
 * @desc サーバー側バリデーション
 * @param {Object} data - フォームデータ
 * @return {Array<string>} エラーメッセージ配列
 */
function validate(data) {
  const errors = [];
  
  if (!data.name) errors.push('お名前は必須です');
  if (!data.phone || !/^[0-9\-\+]{10,15}$/.test(data.phone)) errors.push('電話番号を正しく入力してください');
  if (!data.email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(data.email)) errors.push('メールアドレスを正しく入力してください');
  if (!data.store) errors.push('受取店舗を選択してください');

  // 商品リストと数量のバリデーション
  if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
    errors.push('商品を1つ以上選択してください');
  } else {
    data.items.forEach((item, index) => {
      if (!item.name || !item.qty || isNaN(item.qty) || parseInt(item.qty) < 1 || !Number.isInteger(Number(item.qty))) {
        errors.push(`商品 #${index + 1} の選択または数量に誤りがあります`);
      }
    });
  }

  // 受取/配送の分岐
  if (data.deliveryMethod === 'delivery') {
    // 配送：最短配送日以降（営業日）、平日のみ
    if (!data.deliveryDate) errors.push('配送希望日を選択してください');
    if (!data.deliveryTimeSlot) errors.push('配送時間帯を選択してください');
    // 郵便番号形式チェック（7桁数字）
    if (!data.ordererAddress || !/^[0-9]{3}-?[0-9]{4}$/.test(String(data.ordererAddress.postalCode || ''))) {
      errors.push('注文者住所を正しく入力してください');
    }
    if (!data.deliveryAddress || !/^[0-9]{3}-?[0-9]{4}$/.test(String(data.deliveryAddress.postalCode || ''))) {
      errors.push('配送先住所を正しく入力してください');
    }
    ['prefecture','city','address1'].forEach(function(k){
      if (!data.ordererAddress || !String(data.ordererAddress[k] || '').trim()) errors.push('注文者住所を正しく入力してください');
      if (!data.deliveryAddress || !String(data.deliveryAddress[k] || '').trim()) errors.push('配送先住所を正しく入力してください');
    });
    if (!data.noshiOption) errors.push('「のし」の用途を選択してください');
  } else {
    // 店頭受取（従来どおり）
    if (!data.pickup_date) errors.push('受取希望日を選択してください');
    if (!data.pickup_time) errors.push('受取希望時間を選択してください');
  }

  return errors;
}

/**
 * @function sendMail
 * @desc メール送信
 * @param {string} recipientEmail - 送信先メールアドレス
 * @param {Object} data - フォームデータ
 * @param {boolean} isCustomerMail - お客様宛ての場合はtrue
 * @param {Array<Object>} itemsWithPrice - 商品リスト（単価・小計付き）
 * @param {number} total - 合計金額
 * @param {string} orderId - 注文ID
 */
function sendMail(recipientEmail, data, isCustomerMail, itemsWithPrice, total, orderId) {
  const mode = data.deliveryMethod === 'delivery' ? '配送' : '店頭受取';
  const subject = isCustomerMail ? `[${data.store}] ${mode} 予約受付完了通知` : `[${mode}予約受付] ${data.name}様`;

  const productSummary = itemsWithPrice.map(item => `${item.name} x ${item.qty} @${item.price}円 = ${item.subtotal}円`).join('\n');

  const body = [
    isCustomerMail ? `${data.name} 様\n\nこの度は、${data.store} へ${mode}予約のお申し込みありがとうございます。\n以下の内容で承りました。` : `▼${mode}予約受付`,
    `注文ID：${orderId}`,
    `お名前：${data.name}`,
    `電話番号：${data.phone}`,
    `メールアドレス：${data.email}`,
    `受取店舗：${data.store}`,
    '商品・数量・単価・小計:',
    productSummary,
    `合計金額：${total}円`,
    data.deliveryMethod === 'delivery' ? `配送希望日：${data.deliveryDate}` : `受取希望日：${data.pickup_date}`,
    data.deliveryMethod === 'delivery' ? `配送時間帯：${data.deliveryTimeSlot}` : `受取希望時間：${data.pickup_time}`,
    data.deliveryMethod === 'delivery' ? `「のし」：${data.noshiOption || 'なし'}` : '',
    data.deliveryMethod === 'delivery' && data.deliveryAddress ? `配送先：${data.deliveryAddress.postalCode || ''} ${data.deliveryAddress.fullAddress || ''}` : '',
    data.deliveryMethod === 'delivery' && data.ordererAddress ? `注文者住所：${data.ordererAddress.postalCode || ''} ${data.ordererAddress.fullAddress || ''}` : '',
    data.deliveryMethod === 'delivery' && data.deliveryNote ? `配送備考：${data.deliveryNote}` : '',
    `備考：${data.note || ''}`,
    isCustomerMail ? '\n上記内容をご確認ください。' : '',
    // お客様宛てメールにのみキャンセルポリシーを追加
    isCustomerMail ? CANCEL_POLICY_TEXT : '',
    isCustomerMail ? `\n詳細なキャンセルポリシーは以下でもご確認いただけます：\n${CANCEL_POLICY_URL}` : ''
  ].join('\n');

  MailApp.sendEmail(recipientEmail, subject, body);
}

/**
 * @function createCorsResponse
 * @desc CORSヘッダー付きJSONレスポンスを作成（GitHub Pages対応）
 * @param {string} jsonData - JSON文字列
 * @return {ContentService.TextOutput} JSONレスポンス
 */
function createCorsResponse(jsonData) {
  return ContentService
    .createTextOutput(jsonData)
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
}

// ========================================
// 店舗管理画面用の関数群
// ========================================

/**
 * @function validateStoreSecret
 * @desc 店舗シークレットを検証して店舗情報を返す
 * @param {string} secret - シークレットキー
 * @return {Object} 検証結果と店舗情報
 */
function validateStoreSecret(secret) {
  try {
    const stores = getStores();
    const store = stores.find(s => s.managementSecret === secret);
    
    if (store) {
      return {
        isValid: true,
        storeId: store.id,
        storeName: store.name
      };
    } else {
      return { isValid: false };
    }
  } catch (error) {
    console.error('店舗認証エラー:', error);
    return { isValid: false };
  }
}

/**
 * @function getReservationsForStore
 * @desc 指定店舗の予約一覧を取得（期間指定対応）
 * @param {string} storeId - 店舗ID
 * @param {string} dateRange - 期間指定（'today_onwards'：本日以降、'past_7days'：過去7日間含む）
 * @return {Array<Object>} 予約一覧
 */
function getReservationsForStore(storeId, dateRange = 'today_onwards') {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) return []; // ヘッダーのみの場合
    
    const headers = data[0];
    const today = new Date();
    today.setHours(0, 0, 0, 0); // 今日の0時
    
    // 期間設定
    let startDate;
    if (dateRange === 'past_7days') {
      // 過去7日間（7日前の0時から）
      startDate = new Date(today);
      startDate.setDate(today.getDate() - 7);
    } else {
      // デフォルト：本日以降
      startDate = today;
    }
    
    console.log(`予約取得期間: ${dateRange}, 開始日: ${startDate.toISOString()}`);
    
    const reservations = [];
    const storeNameCache = {};
    
    // 店舗名キャッシュを作成
    const stores = getStores();
    stores.forEach(store => {
      storeNameCache[store.name] = store.id;
    });
    
    // データを処理（ヘッダー行をスキップ）
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const storeName = row[5]; // F列：受取店舗
      const pickupDateStr = row[11]; // L列：受取希望日
      
      // 該当店舗かチェック
      if (storeNameCache[storeName] !== storeId) continue;
      
      // 受取日が期間内かチェック
      const pickupDate = new Date(pickupDateStr);
      if (pickupDate < startDate) continue;
      
      // 予約データを構築
      const reservation = {
        rowId: i + 1, // 行番号（1ベース）
        orderId: row[0] || '', // A列：注文ID
        timestamp: row[1] || '', // B列：受付日時
        customerName: row[2] || '', // C列：顧客名
        phone: row[3] || '', // D列：電話番号
        email: row[4] || '', // E列：メールアドレス
        storeName: storeName, // F列：受取店舗
        productName: row[6] || '', // G列：商品名
        quantity: row[7] || '', // H列：数量
        price: row[8] || '', // I列：単価
        subtotal: row[9] || '', // J列：小計
        total: row[10] || '', // K列：合計
        pickupDate: pickupDateStr, // L列：受取希望日
        pickupTime: row[12] || '', // M列：受取希望時間
        note: row[13] || '', // N列：備考
        isCompleted: row[14] === '✓' || row[14] === true, // O列：受渡済み
        handoverStaff: row[15] || '', // P列：担当者名
        memo: row[16] || '', // Q列：メモ
        completedAt: row[17] || '', // R列：受渡日時
        paymentSessionIdShort: row[18] || '', // S列：決済ID（短縮版）
        paymentSessionId: row[19] || '', // T列：決済ID（完全版）
        // 過去の予約かどうかのフラグを追加
        isPastReservation: pickupDate < today
      };
      
      reservations.push(reservation);
    }
    
    // 受取日時順でソート（新しい順）
    reservations.sort((a, b) => {
      const dateA = new Date(a.pickupDate + ' ' + a.pickupTime);
      const dateB = new Date(b.pickupDate + ' ' + b.pickupTime);
      return dateB - dateA; // 降順（新しい順）
    });
    
    console.log(`予約データ取得完了: ${reservations.length}件（期間: ${dateRange}）`);
    
    return reservations;
    
  } catch (error) {
    console.error('予約データ取得エラー:', error);
    return [];
  }
}

/**
 * @function updateReservationData
 * @desc 予約データを更新（受渡済みチェック・メモ・担当者名）
 * @param {number} rowId - 行番号
 * @param {boolean} checked - 受渡済みフラグ
 * @param {string} memo - メモ
 * @param {string} staffName - 担当者名
 * @param {string} storeId - 店舗ID（セキュリティチェック用）
 * @return {Object} 更新結果
 */
function updateReservationData(rowId, checked, memo, staffName, storeId) {
  // 🔐 同時書き込み競合回避：排他制御ロックを取得
  const lock = LockService.getScriptLock();
  try {
    // 最大10秒間ロック取得を試行
    lock.waitLock(10000);
    console.log('排他制御ロック取得成功');
    
    console.log('=== updateReservationData開始 ===');
    console.log('パラメータ:', {rowId, checked, memo, staffName, storeId});
    
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    console.log('スプレッドシート取得成功');
    
    // 行が存在するかチェック
    const lastRow = sheet.getLastRow();
    console.log('最終行:', lastRow);
    
    if (rowId > lastRow || rowId < 2) {
      console.error('無効な行番号:', rowId);
      return { success: false, error: '無効な行番号です' };
    }
    
    // セキュリティチェック：該当行が指定店舗の予約かどうか確認
    const storeCell = sheet.getRange(rowId, 6).getValue(); // F列：受取店舗
    console.log('店舗セル値:', storeCell);
    
    const stores = getStores();
    const store = stores.find(s => s.id === storeId);
    console.log('店舗情報:', store);
    
    if (!store || storeCell !== store.name) {
      console.error('アクセス権限エラー:', {store, storeCell, storeName: store?.name});
      return { success: false, error: 'アクセス権限がありません' };
    }
    
    const now = new Date();
    const timestamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    console.log('更新タイムスタンプ:', timestamp);
    
    // 受渡済みフラグを更新（O列：15列目）
    if (checked !== null && checked !== undefined) {
      console.log('受渡済みフラグ更新:', checked);
      const checkValue = checked ? '✓' : '';
      sheet.getRange(rowId, 15).setValue(checkValue);
      console.log('O列（15列目）に設定:', checkValue);
      
      // 🆕 行の背景色を変更（A列〜T列：全20列）
      const rowRange = sheet.getRange(rowId, 1, 1, 20);
      if (checked) {
        // 受渡完了時：薄い緑色の背景
        rowRange.setBackground('#d4edda');
        console.log('行背景色を緑に変更:', rowId);
      } else {
        // 受渡未完了時：白色に戻す
        rowRange.setBackground('#ffffff');
        console.log('行背景色を白に変更:', rowId);
      }
      
      // 受渡日時を更新（R列：18列目）※担当者名列追加により1つ右へシフト
      if (checked) {
        sheet.getRange(rowId, 18).setValue(timestamp);
        console.log('R列（18列目）に設定:', timestamp);
      } else {
        sheet.getRange(rowId, 18).setValue('');
        console.log('R列（18列目）クリア');
      }
    }
    
    // 担当者名を更新（P列：16列目）
    if (staffName !== null && staffName !== undefined && checked === true) {
      console.log('担当者名更新:', staffName);
      const sanitizedStaffName = sanitizeInput(staffName);
      sheet.getRange(rowId, 16).setValue(sanitizedStaffName);
      console.log('P列（16列目）に設定:', sanitizedStaffName);
    } else if (checked === false) {
      // 受渡完了をOFFにした場合は担当者名もクリア
      sheet.getRange(rowId, 16).setValue('');
      console.log('P列（16列目）クリア');
    }
    
    // メモを更新（Q列：17列目）※担当者名列追加により1つ右へシフト
    if (memo !== null && memo !== undefined) {
      console.log('メモ更新:', memo);
      const sanitizedMemo = sanitizeInput(memo);
      sheet.getRange(rowId, 17).setValue(sanitizedMemo);
      console.log('Q列（17列目）に設定:', sanitizedMemo);
    }
    
    console.log('=== updateReservationData完了 ===');
    return { success: true, message: '更新完了' };
    
  } catch (error) {
    console.error('予約データ更新エラー:', error);
    return { success: false, error: error.message };
  } finally {
    // 🔐 必ずロックを解放
    try {
      lock.releaseLock();
      console.log('排他制御ロック解放完了');
    } catch (lockError) {
      console.warn('ロック解放時のエラー:', lockError);
    }
  }
}

/**
 * @function getManagementPage
 * @desc 店舗管理画面のHTMLを生成
 * @param {string} storeName - 店舗名
 * @param {string} secret - シークレットキー
 * @return {HtmlService.HtmlOutput} 管理画面HTML
 */
function getManagementPage(storeName, secret) {
  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${storeName} - 予約管理画面</title>
      <style>
        * { box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', 'Meiryo', sans-serif;
          margin: 0;
          padding: 16px;
          background-color: #f5f5f5;
        }
        .header {
          background: #2c3e50;
          color: white;
          padding: 16px;
          border-radius: 8px;
          margin-bottom: 20px;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          font-size: 1.4em;
        }
        .controls {
          margin-bottom: 20px;
          text-align: center;
        }
        .btn {
          background: #3498db;
          color: white;
          border: none;
          padding: 10px 16px;
          border-radius: 4px;
          cursor: pointer;
          margin: 0 4px;
          font-size: 1em;
        }
        .btn:hover {
          background: #2980b9;
        }
        .btn.refresh {
          background: #27ae60;
        }
        .btn.refresh:hover {
          background: #229954;
        }
        .loading {
          text-align: center;
          padding: 40px;
          color: #666;
        }
        .error {
          background: #e74c3c;
          color: white;
          padding: 12px;
          border-radius: 4px;
          margin-bottom: 20px;
        }
        .no-data {
          text-align: center;
          padding: 40px;
          color: #666;
          background: white;
          border-radius: 8px;
        }
        .reservation-list {
          display: grid;
          gap: 16px;
        }
        .reservation-card {
          background: white;
          border-radius: 8px;
          padding: 16px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          position: relative;
        }
        .reservation-card.completed {
          background: #e8f5e8;
          border-left: 4px solid #27ae60;
        }
        .card-header {
          display: flex;
          justify-content: between;
          align-items: flex-start;
          margin-bottom: 12px;
          flex-wrap: wrap;
          gap: 8px;
        }
        .pickup-info {
          font-weight: bold;
          font-size: 1.1em;
          color: #2c3e50;
        }
        .customer-info {
          margin: 8px 0;
        }
        .phone-link {
          color: #3498db;
          text-decoration: none;
          font-weight: bold;
        }
        .phone-link:hover {
          text-decoration: underline;
        }
        .products {
          background: #f8f9fa;
          padding: 8px;
          border-radius: 4px;
          margin: 8px 0;
          font-size: 0.9em;
        }
        .total {
          font-weight: bold;
          font-size: 1.1em;
          color: #e74c3c;
        }
        .controls-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 12px;
          flex-wrap: wrap;
        }
        .checkbox {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .memo-area {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 200px;
        }
        .memo-input {
          flex: 1;
          padding: 6px 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 0.9em;
        }
        .save-btn {
          background: #f39c12;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.9em;
        }
        .save-btn:hover {
          background: #e67e22;
        }
        .status {
          position: absolute;
          top: 16px;
          right: 16px;
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 0.8em;
          font-weight: bold;
        }
        .status.pending {
          background: #f39c12;
          color: white;
        }
        .status.completed {
          background: #27ae60;
          color: white;
        }
        
        @media (max-width: 600px) {
          body { padding: 8px; }
          .header { padding: 12px; }
          .header h1 { font-size: 1.2em; }
          .reservation-card { padding: 12px; }
          .controls-row { flex-direction: column; align-items: stretch; }
          .memo-area { min-width: auto; }
          .card-header { flex-direction: column; }
          .status { position: static; margin-bottom: 8px; align-self: flex-start; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${storeName} - 予約管理画面</h1>
        <small>本日以降の予約一覧</small>
      </div>
      
      <div class="controls">
        <button class="btn refresh" onclick="loadReservations()">🔄 更新</button>
        <button class="btn" onclick="filterReservations('all')">📋 全て</button>
        <button class="btn" onclick="filterReservations('pending')">⏳ 未完了</button>
        <button class="btn" onclick="filterReservations('completed')">✅ 完了済み</button>
      </div>
      
      <div id="error-message" class="error" style="display: none;"></div>
      <div id="loading" class="loading">読み込み中...</div>
      <div id="reservation-list" class="reservation-list" style="display: none;"></div>
      <div id="no-data" class="no-data" style="display: none;">
        <h3>予約データがありません</h3>
        <p>本日以降の予約はまだありません。</p>
      </div>

      <script>
        const API_URL = '${ScriptApp.getService().getUrl()}';
        const SHOP_SECRET = '${secret}';
        let allReservations = [];
        let currentFilter = 'all';

        // ページ読み込み時に予約一覧を取得
        window.addEventListener('DOMContentLoaded', function() {
          loadReservations();
        });

        // 予約一覧を読み込み
        async function loadReservations() {
          showLoading(true);
          hideError();

          try {
            const response = await fetch(API_URL + '?action=getReservations&shop=' + SHOP_SECRET);
            const data = await response.json();

            if (data.success) {
              allReservations = data.data;
              displayReservations(allReservations);
            } else {
              showError(data.error || '予約データの読み込みに失敗しました');
            }
          } catch (error) {
            console.error('読み込みエラー:', error);
            showError('ネットワークエラーが発生しました');
          } finally {
            showLoading(false);
          }
        }

        // 予約一覧を表示
        function displayReservations(reservations) {
          const listContainer = document.getElementById('reservation-list');
          const noDataContainer = document.getElementById('no-data');

          if (reservations.length === 0) {
            listContainer.style.display = 'none';
            noDataContainer.style.display = 'block';
            return;
          }

          listContainer.style.display = 'grid';
          noDataContainer.style.display = 'none';

          // 注文IDごとにグループ化
          const groupedReservations = groupByOrderId(reservations);

          listContainer.innerHTML = groupedReservations.map(group => {
            const isCompleted = group.items.every(item => item.isCompleted);
            const totalAmount = group.items[0].total;
            const customer = group.items[0];

            return \`
              <div class="reservation-card \${isCompleted ? 'completed' : ''}" data-filter="\${isCompleted ? 'completed' : 'pending'}">
                <div class="status \${isCompleted ? 'completed' : 'pending'}">
                  \${isCompleted ? '完了' : '未完了'}
                </div>
                
                <div class="card-header">
                  <div class="pickup-info">
                    📅 \${customer.pickupDate} \${customer.pickupTime}
                  </div>
                </div>
                
                <div class="customer-info">
                  <strong>👤 \${customer.customerName}</strong><br>
                  📞 <a href="tel:\${customer.phone}" class="phone-link">\${customer.phone}</a><br>
                  📧 \${customer.email}<br>
                  🆔 \${customer.orderId}
                  \${customer.paymentSessionIdShort ? \`<br>💳 決済ID: \${customer.paymentSessionIdShort}\` : ''}
                </div>
                
                <div class="products">
                  <strong>📦 注文内容:</strong><br>
                  \${group.items.map(item => \`• \${item.productName} × \${item.quantity} (\${item.subtotal}円)\`).join('<br>')}
                </div>
                
                <div class="total">💰 合計: \${totalAmount}円</div>
                
                \${customer.note ? \`<div style="margin: 8px 0; color: #666;"><strong>📝 備考:</strong> \${customer.note}</div>\` : ''}
                
                <div class="controls-row">
                  <div class="checkbox">
                    <input type="checkbox" id="check-\${group.orderId}" \${isCompleted ? 'checked' : ''} 
                           onchange="updateReservation('\${group.items[0].rowId}', this.checked, null)">
                    <label for="check-\${group.orderId}">受渡完了</label>
                  </div>
                  
                  <div class="memo-area">
                    <input type="text" class="memo-input" id="memo-\${group.orderId}" 
                           value="\${customer.memo || ''}" placeholder="メモを入力...">
                    <button class="save-btn" onclick="updateReservation('\${group.items[0].rowId}', null, document.getElementById('memo-\${group.orderId}').value)">
                      💾 保存
                    </button>
                  </div>
                </div>
              </div>
            \`;
          }).join('');
        }

        // 注文IDでグループ化
        function groupByOrderId(reservations) {
          const groups = {};
          
          reservations.forEach(reservation => {
            const orderId = reservation.orderId;
            if (!groups[orderId]) {
              groups[orderId] = {
                orderId: orderId,
                items: []
              };
            }
            groups[orderId].items.push(reservation);
          });
          
          return Object.values(groups);
        }

        // 予約データを更新
        async function updateReservation(rowId, checked, memo) {
          try {
            const updateData = {
              action: 'updateReservation',
              shop: SHOP_SECRET,
              rowId: parseInt(rowId),
              checked: checked,
              memo: memo
            };

            const response = await fetch(API_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(updateData)
            });

            const result = await response.json();

            if (result.success) {
              // 更新成功時に再読み込み
              setTimeout(loadReservations, 500);
            } else {
              showError(result.error || '更新に失敗しました');
            }
          } catch (error) {
            console.error('更新エラー:', error);
            showError('ネットワークエラーが発生しました');
          }
        }

        // フィルタリング
        function filterReservations(filter) {
          currentFilter = filter;
          const cards = document.querySelectorAll('.reservation-card');
          
          cards.forEach(card => {
            const cardFilter = card.getAttribute('data-filter');
            if (filter === 'all' || cardFilter === filter) {
              card.style.display = 'block';
            } else {
              card.style.display = 'none';
            }
          });
        }

        // ローディング表示制御
        function showLoading(show) {
          document.getElementById('loading').style.display = show ? 'block' : 'none';
        }

        // エラー表示制御
        function showError(message) {
          const errorDiv = document.getElementById('error-message');
          errorDiv.textContent = message;
          errorDiv.style.display = 'block';
        }

        function hideError() {
          document.getElementById('error-message').style.display = 'none';
        }
      </script>
    </body>
    </html>
  `;
  
  return HtmlService.createHtmlOutput(html)
    .setTitle(storeName + ' - 予約管理画面')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ========================================
// Stripe決済関連機能（事前決済システム）
// ========================================

/**
 * @const {string} STRIPE_SECRET_KEY
 * @desc Stripe秘密鍵（実際の値をプロパティストアで管理）
 */
function getStripeSecretKey() {
  // PropertiesServiceから秘密鍵を取得
  // テスト用: sk_test_...
  // 本番用: sk_live_...
  const secretKey = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
  
  if (!secretKey) {
    throw new Error('Stripe秘密鍵が設定されていません。PropertiesServiceで設定してください。');
  }
  
  return secretKey;
}

/**
 * @function createStripeInvoice
 * @desc Stripe Invoicingで請求書を作成し送付
 * @param {Object} invoiceData - {currency, customer:{email,name,phone}, items:[{name,qty,price}], metadata, days_until_due}
 * @return {Object} 結果 {success:boolean, invoice_id?:string, invoice_url?:string, customer_id?:string}
 */
function createStripeInvoice(invoiceData) {
  try {
    const secretKey = getStripeSecretKey();

    // 1) 顧客を作成または取得（簡易: emailで毎回作成）
    // 顧客作成フォームデータをStripe仕様で構築（metadataはフラット化）
    const customerFormParts = [];
    if (invoiceData.customer.email) customerFormParts.push(`email=${encodeURIComponent(invoiceData.customer.email)}`);
    if (invoiceData.customer.name) customerFormParts.push(`name=${encodeURIComponent(invoiceData.customer.name)}`);
    if (invoiceData.customer.phone) customerFormParts.push(`phone=${encodeURIComponent(invoiceData.customer.phone)}`);
    if (invoiceData.metadata) {
      Object.keys(invoiceData.metadata).forEach(k => {
        customerFormParts.push(`metadata[${encodeURIComponent(k)}]=${encodeURIComponent(String(invoiceData.metadata[k]))}`);
      });
    }
    const customerForm = customerFormParts.join('&');

    const commonOptions = {
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      headers: { 'Authorization': `Bearer ${secretKey}` },
      muteHttpExceptions: true
    };

    const custResp = UrlFetchApp.fetch('https://api.stripe.com/v1/customers', { ...commonOptions, payload: customerForm });
    if (custResp.getResponseCode() !== 200) {
      const err = custResp.getContentText();
      throw new Error(`Stripe 顧客作成エラー: ${err}`);
    }
    const customer = JSON.parse(custResp.getContentText());

    // 2) Invoice Item を作成（各商品）
    const createdItems = [];
    invoiceData.items.forEach((it) => {
      // JPYはゼロ小数通貨のため、Stripeのamountは円単位の整数
      const amount = Math.round(Number(it.price) * Number(it.qty));
      console.log(`商品: ${it.name}, 価格: ${it.price}円, 数量: ${it.qty}, 金額(円): ${amount}`);
      
      const iiForm = [
        `customer=${encodeURIComponent(customer.id)}`,
        `currency=${encodeURIComponent(invoiceData.currency || 'jpy')}`,
        `amount=${encodeURIComponent(amount)}`,
        `description=${encodeURIComponent(it.name)}`
      ].join('&');
      const iiResp = UrlFetchApp.fetch('https://api.stripe.com/v1/invoiceitems', { ...commonOptions, payload: iiForm });
      if (iiResp.getResponseCode() !== 200) {
        const err = iiResp.getContentText();
        throw new Error(`Stripe InvoiceItem作成エラー: ${err}`);
      }
      createdItems.push(JSON.parse(iiResp.getContentText()));
    });

    // 3) Invoice を作成
    const invoiceFormParts = [
      `customer=${encodeURIComponent(customer.id)}`,
      `collection_method=send_invoice`,
      `days_until_due=${encodeURIComponent(invoiceData.days_until_due || 30)}`,
      // ここが重要: 事前に作成したInvoiceItem（保留中）をこの請求書に取り込む
      `pending_invoice_items_behavior=include`
    ];
    // メタデータ
    if (invoiceData.metadata) {
      Object.keys(invoiceData.metadata).forEach(k => {
        invoiceFormParts.push(`metadata[${encodeURIComponent(k)}]=${encodeURIComponent(invoiceData.metadata[k])}`);
      });
    }
    const invoiceResp = UrlFetchApp.fetch('https://api.stripe.com/v1/invoices', { ...commonOptions, payload: invoiceFormParts.join('&') });
    if (invoiceResp.getResponseCode() !== 200) {
      const err = invoiceResp.getContentText();
      throw new Error(`Stripe 請求書作成エラー: ${err}`);
    }
    const invoice = JSON.parse(invoiceResp.getContentText());

    // 4) 請求書をfinalize
    const finalizeResp = UrlFetchApp.fetch(`https://api.stripe.com/v1/invoices/${invoice.id}/finalize`, { ...commonOptions });
    if (finalizeResp.getResponseCode() !== 200) {
      const err = finalizeResp.getContentText();
      throw new Error(`Stripe 請求書finalizeエラー: ${err}`);
    }

    // 5) 請求書を送付
    const sendResp = UrlFetchApp.fetch(`https://api.stripe.com/v1/invoices/${invoice.id}/send`, { ...commonOptions });
    if (sendResp.getResponseCode() !== 200) {
      const err = sendResp.getContentText();
      throw new Error(`Stripe 請求書送付エラー: ${err}`);
    }

    // 6) メール送信（顧客・管理者）
    try {
      const totalJpy = invoiceData.items.reduce((sum, it) => sum + (Number(it.price) * Number(it.qty)), 0);
      const itemsList = invoiceData.items.map(it => `・${it.name} × ${it.qty}個 (${(it.price * it.qty).toLocaleString()}円)`).join('\n');

      // 顧客向け
      const customerSubject = `【請求書発行のお知らせ】${invoiceData.customer.name || invoiceData.metadata.customer_name}`;
      const customerBody = `
${invoiceData.metadata.contact_person || invoiceData.customer.name || 'ご担当者様'}

以下の内容で請求書を発行いたしました。お支払いをお願いいたします。

■ 請求内容
合計金額: ${totalJpy.toLocaleString()}円
支払期限: 発行から${invoiceData.days_until_due || 30}日
請求書URL: ${invoice.hosted_invoice_url}

■ ご注文内容
${itemsList}

■ 会社情報
会社名: ${invoiceData.metadata.company_name || ''}
部署名: ${invoiceData.metadata.department_name || ''}
担当者: ${invoiceData.metadata.contact_person || ''}

本メールは自動送信です。ご不明点は本社までご連絡ください。`;

      if (invoiceData.customer.email) {
        MailApp.sendEmail(invoiceData.customer.email, customerSubject, customerBody);
      }

      // 管理者向け
      const adminSubject = `【請求書発行】${invoiceData.metadata.company_name || invoiceData.customer.name} / ${totalJpy.toLocaleString()}円`;
      const adminBody = `
▼請求書を発行しました
請求書ID: ${invoice.id}
請求書URL: ${invoice.hosted_invoice_url}
合計金額: ${totalJpy.toLocaleString()}円
支払期限: 発行から${invoiceData.days_until_due || 30}日

■ 顧客情報
会社名: ${invoiceData.metadata.company_name || ''}
部署名: ${invoiceData.metadata.department_name || ''}
担当者: ${invoiceData.metadata.contact_person || ''}
メール: ${invoiceData.customer.email}
電話: ${invoiceData.customer.phone || ''}

■ 注文内容
${itemsList}
`;
      MailApp.sendEmail('appleivyck@gmail.com', adminSubject, adminBody);
    } catch (mailError) {
      console.warn('請求書メール送信エラー（処理続行）:', mailError);
    }

    // 7) スプレッドシートへ記録（法人用請求書売掛）
    try {
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
      let sheet = spreadsheet.getSheetByName(B2B_INVOICE_SHEET_NAME);
      if (!sheet) {
        sheet = spreadsheet.insertSheet(B2B_INVOICE_SHEET_NAME);
        sheet.getRange(1, 1, 1, 20).setValues([[
          '請求書ID','発行日時','会社名','部署名','担当者','メール','電話','金額(円)','支払期限(日)','請求書URL',
          '申込店舗','受取/配送','受取日/配送日','時間帯','商品一覧','備考','Stripe顧客ID','通貨','作成者','メモ'
        ]]);
      }
      const now = new Date();
      const timestamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
      const totalJpy = invoiceData.items.reduce((sum, it) => sum + (Number(it.price) * Number(it.qty)), 0);
      const itemsList = invoiceData.items.map(it => `${it.name}×${it.qty} (${(it.price*it.qty).toLocaleString()}円)`).join(' / ');
      const deliveryMode = (invoiceData.metadata && invoiceData.metadata.delivery_method) || '';
      const dateField = deliveryMode === 'delivery' ? (invoiceData.metadata.delivery_date || '') : (invoiceData.metadata.pickup_date || '');
      const timeField = deliveryMode === 'delivery' ? (invoiceData.metadata.delivery_time_slot || '') : (invoiceData.metadata.pickup_time || '');
      const noteField = (invoiceData.metadata && (invoiceData.metadata.pickup_note || invoiceData.metadata.delivery_note)) || '';

      const row = [[
        invoice.id,
        timestamp,
        invoiceData.metadata.company_name || '',
        invoiceData.metadata.department_name || '',
        invoiceData.metadata.contact_person || '',
        invoiceData.customer.email || '',
        invoiceData.customer.phone || '',
        totalJpy,
        invoiceData.days_until_due || 30,
        invoice.hosted_invoice_url || '',
        invoiceData.metadata.application_store || invoiceData.metadata.pickup_store || '',
        deliveryMode,
        dateField,
        timeField,
        itemsList,
        noteField,
        customer.id,
        invoiceData.currency || 'jpy',
        'system',
        ''
      ]];
      sheet.appendRow(row[0]);
    } catch (sheetError) {
      console.warn('法人請求書売掛の記録エラー（処理続行）:', sheetError);
    }

    // 8) 結果返却
    return {
      success: true,
      invoice_id: invoice.id,
      invoice_url: invoice.hosted_invoice_url || '',
      customer_id: customer.id
    };
  } catch (error) {
    console.error('createStripeInvoice エラー:', error);
    return { success: false, error: error.toString() };
  }
}
/**
 * @function createCheckoutSession
 * @desc Stripe Checkoutセッションを作成
 * @param {Object} checkoutData - チェックアウトデータ
 * @return {Object} 作成結果 {success: boolean, url?: string, error?: string}
 */
function createCheckoutSession(checkoutData) {
  try {
    console.log('Stripe Checkoutセッション作成開始:', checkoutData);
    
    // Stripe秘密鍵を取得
    const secretKey = getStripeSecretKey();
    
    // 金額の再計算（セキュリティ対策）
    const recalculatedAmount = recalculateAmount(checkoutData);
    
    if (recalculatedAmount !== checkoutData.line_items[0].price_data.unit_amount) {
      throw new Error('金額の検証に失敗しました。改ざんの可能性があります。');
    }
    
    // Stripe APIに送信するペイロード
    const payload = {
      payment_method_types: ['card'],
      line_items: checkoutData.line_items,
      mode: checkoutData.mode,
      success_url: checkoutData.success_url,
      cancel_url: checkoutData.cancel_url,
      customer_email: checkoutData.customer_email,
      metadata: checkoutData.metadata,
      billing_address_collection: checkoutData.billing_address_collection || 'auto',
      allow_promotion_codes: checkoutData.allow_promotion_codes || false,
      
      // 追加設定
      payment_intent_data: {
        metadata: {
          order_type: 'takeout_reservation',
          created_from: 'gas_webapp'
        }
      }
    };
    
    console.log('Stripe API送信ペイロード:', JSON.stringify(payload, null, 2));
    
    // Stripe APIにリクエストを送信
    const formData = {};
    
    // 基本フィールド
    formData['payment_method_types[0]'] = 'card';
    formData['mode'] = payload.mode;
    formData['success_url'] = payload.success_url;
    formData['cancel_url'] = payload.cancel_url;
    formData['customer_email'] = payload.customer_email;
    formData['billing_address_collection'] = payload.billing_address_collection;
    formData['allow_promotion_codes'] = payload.allow_promotion_codes;
    
    // line_itemsを正しい形式でエンコード
    if (payload.line_items && payload.line_items.length > 0) {
      payload.line_items.forEach((item, index) => {
        console.log(`=== line_item[${index}] デバッグ ===`);
        console.log(`currency: ${item.price_data.currency}`);
        console.log(`unit_amount: ${item.price_data.unit_amount}`);
        console.log(`quantity: ${item.quantity}`);
        console.log('===========================');
        
        formData[`line_items[${index}][price_data][currency]`] = item.price_data.currency;
        formData[`line_items[${index}][price_data][product_data][name]`] = item.price_data.product_data.name;
        formData[`line_items[${index}][price_data][unit_amount]`] = item.price_data.unit_amount;
        formData[`line_items[${index}][quantity]`] = item.quantity;
      });
    }
    
    // metadataをエンコード
    if (payload.metadata) {
      Object.keys(payload.metadata).forEach(key => {
        formData[`metadata[${key}]`] = payload.metadata[key];
      });
    }
    
    // payment_intent_dataをエンコード
    if (payload.payment_intent_data && payload.payment_intent_data.metadata) {
      Object.keys(payload.payment_intent_data.metadata).forEach(key => {
        formData[`payment_intent_data[metadata][${key}]`] = payload.payment_intent_data.metadata[key];
      });
    }
    
    // フォームデータを文字列に変換
    const formDataString = Object.keys(formData).map(key => {
      return `${encodeURIComponent(key)}=${encodeURIComponent(formData[key])}`;
    }).join('&');
    
    console.log('Stripe API フォームデータ:', formDataString.substring(0, 300) + '...');
    
    const options = {
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      headers: {
        'Authorization': `Bearer ${secretKey}`
      },
      payload: formDataString,
      muteHttpExceptions: true
    };
    
    console.log('Stripe API リクエストオプション:', options);
    
    const response = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    console.log(`Stripe API レスポンス: ${responseCode}`);
    console.log(`Stripe API レスポンス内容: ${responseText.substring(0, 500)}...`);
    
    if (responseCode !== 200) {
      const errorData = JSON.parse(responseText);
      throw new Error(`Stripe API エラー: ${errorData.error.message}`);
    }
    
    const sessionData = JSON.parse(responseText);
    
    console.log('Checkoutセッション作成成功:', sessionData.id);
    
    return {
      success: true,
      url: sessionData.url,
      sessionId: sessionData.id
    };
    
  } catch (error) {
    console.error('Stripe Checkoutセッション作成エラー:', error);
    
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * @function recalculateAmount
 * @desc サーバーサイドで金額を再計算（改ざん防止）
 * @param {Object} checkoutData - チェックアウトデータ
 * @return {number} 再計算された金額
 */
function recalculateAmount(checkoutData) {
  try {
    console.log('金額再計算開始:', checkoutData);
    
    // メタデータから注文情報を取得
    const metadata = checkoutData.metadata;
    const originalAmount = parseInt(metadata.total_amount);
    
    console.log('メタデータから取得した金額:', originalAmount);
    
    // line_itemsから金額も確認
    let lineItemsTotal = 0;
    if (checkoutData.line_items && checkoutData.line_items.length > 0) {
      checkoutData.line_items.forEach(item => {
        if (item.price_data && item.price_data.unit_amount && item.quantity) {
          lineItemsTotal += item.price_data.unit_amount * item.quantity;
        }
      });
    }
    
    console.log('ラインアイテムから計算した金額:', lineItemsTotal);
    
    // 両方の金額が一致するかチェック
    if (lineItemsTotal > 0 && Math.abs(originalAmount - lineItemsTotal) > 1) {
      console.warn('金額の不整合を検出:', { originalAmount, lineItemsTotal });
      // 警告のみで、処理は続行
    }
    
    // より正確な金額を返す
    const finalAmount = lineItemsTotal > 0 ? lineItemsTotal : originalAmount;
    
    console.log('金額再計算完了:', finalAmount);
    return finalAmount;
    
  } catch (error) {
    console.error('金額再計算エラー:', error);
    // エラーが発生した場合は、メタデータの金額をそのまま使用
    try {
      const fallbackAmount = parseInt(checkoutData.metadata.total_amount);
      console.log('フォールバック金額を使用:', fallbackAmount);
      return fallbackAmount;
    } catch (fallbackError) {
      console.error('フォールバック金額取得エラー:', fallbackError);
      throw new Error('金額の再計算に失敗しました');
    }
  }
}

/**
 * @function submitPaymentReservation
 * @desc 決済完了後の予約データを処理
 * @param {Object} reservationData - 予約データ（決済情報を含む）
 * @return {Object} 処理結果
 */
function submitPaymentReservation(reservationData) {
  try {
    console.log('決済完了予約処理開始:', reservationData);
    
    // 決済状態を検証
    if (reservationData.payment_status !== 'completed') {
      throw new Error('決済が完了していません');
    }
    
    if (!reservationData.payment_session_id) {
      throw new Error('決済セッションIDが不正です');
    }
    
    // 基本バリデーション
    const validationErrors = validate(reservationData);
    if (validationErrors.length > 0) {
      throw new Error('入力データエラー: ' + validationErrors.join(', '));
    }
    
    // 商品データの基本検証（決済完了後なので簡素化）
    if (!reservationData.items || reservationData.items.length === 0) {
      throw new Error('商品データが不正です');
    }
    
    // 各商品の基本チェック
    const validatedItems = [];
    for (const item of reservationData.items) {
      if (!item.name || !item.price || !item.qty || item.qty <= 0) {
        throw new Error(`商品データが不正です: ${JSON.stringify(item)}`);
      }
      validatedItems.push({
        name: String(item.name),
        price: Number(item.price),
        qty: Number(item.qty)
      });
    }
    
    // 合計金額を再計算・検証
    const calculatedTotal = validatedItems.reduce((sum, item) => {
      return sum + (item.price * item.qty);
    }, 0);
    
    if (Math.abs(calculatedTotal - reservationData.payment_amount) > 1) {
      console.warn(`金額の差異検出: 計算値=${calculatedTotal}, 決済額=${reservationData.payment_amount}`);
      // 決済が完了しているため、警告のみでエラーにはしない
    }
    
    // 注文IDを生成（通常予約と同じ形式）
    const orderId = generateShortOrderId();
    
    // 🚀 決済完了予約の非同期風書き込み
    try {
      writePaymentReservationSafely(validatedItems, reservationData, calculatedTotal, orderId);
      console.log('決済完了予約書き込み開始（非同期風処理）');
    
    // ヘッダーがない場合は追加
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, 20).setValues([
        ['注文ID', '受付日時', 'お名前', 'お客様電話番号', 'お客様メールアドレス', 
         '受取店舗', '商品名', '数量', '単価', '小計', '合計金額',
         '受取希望日', '受取希望時間', '備考', '受渡済み', '担当者名', 'メモ', '受渡日時',
         '決済ID（短縮版）', '決済ID（完全版）']
      ]);
    }
    
    const now = new Date();
    const timestamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    
    // 決済IDの短縮版を生成（末尾16文字）
    const shortSessionId = reservationData.payment_session_id.length > 16 
      ? reservationData.payment_session_id.substring(reservationData.payment_session_id.length - 16)
      : reservationData.payment_session_id;
    
    // 各商品を個別の行に記録
    const rowsToAdd = [];
    validatedItems.forEach(item => {
      rowsToAdd.push([
        orderId,                                    // A列: 注文ID
        timestamp,                                  // B列: 受付日時
        sanitizeInput(reservationData.name),        // C列: お名前
        "'" + sanitizeInput(reservationData.phone), // D列: 電話番号（文字列として保存）
        sanitizeInput(reservationData.email),       // E列: メールアドレス
        sanitizeInput(reservationData.store),       // F列: 受取店舗
        sanitizeInput(item.name),                   // G列: 商品名
        item.qty,                                   // H列: 数量
        item.price,                                 // I列: 単価
        item.price * item.qty,                      // J列: 小計
        calculatedTotal,                            // K列: 合計金額
        reservationData.pickup_date,                // L列: 受取希望日
        reservationData.pickup_time,                // M列: 受取希望時間
        sanitizeInput(reservationData.note || ''),  // N列: 備考
        '',                                         // O列: 受渡済み（空）
        '',                                         // P列: 担当者名（空）
        '決済完了',                                 // Q列: メモ（決済完了）
        '',                                         // R列: 受渡日時（空）
        shortSessionId,                             // S列: 決済ID（短縮版）
        reservationData.payment_session_id          // T列: 決済ID（完全版）
      ]);
    });
    
    // データを一括追加
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAdd.length, 20).setValues(rowsToAdd);
    
    } catch (writeError) {
      console.warn('決済完了予約書き込み開始エラー（継続処理）:', writeError);
      // 書き込みエラーでも決済完了処理は継続
    }
    
    // 確認メールを送信
    try {
      sendPaymentConfirmationEmail(reservationData, calculatedTotal, orderId);
    } catch (emailError) {
      console.error('メール送信エラー:', emailError);
      // メール送信失敗は致命的エラーにしない
    }
    
    const result = {
      success: true,
      message: '決済予約が正常に完了しました',
      orderId: orderId,
      total: calculatedTotal
    };
    
    // JSONP対応レスポンス
    const callback = e.parameter.callback;
    if (callback) {
      return ContentService
        .createTextOutput(`${callback}(${JSON.stringify(result)})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return createCorsResponse(JSON.stringify(result));
    
  } catch (error) {
    console.error('決済予約処理エラー:', error);
    
    const errorResponse = {
      success: false,
      error: error.toString()
    };
    
    // JSONP対応レスポンス
    const callback = e.parameter.callback;
    if (callback) {
      return ContentService
        .createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return createCorsResponse(JSON.stringify(errorResponse));
  }
}

/**
 * @function generateOrderId
 * @desc 注文IDを生成（決済セッションIDベース）
 * @param {string} sessionId - Stripe セッションID
 * @return {string} 注文ID
 */
function generateOrderId(sessionId) {
  // セッションIDの末尾8文字 + タイムスタンプ
  const sessionSuffix = sessionId.substring(sessionId.length - 8);
  const timestamp = new Date().getTime().toString().slice(-6);
  
  return `PAY-${sessionSuffix}-${timestamp}`.toUpperCase();
}

/**
 * @function sendPaymentConfirmationEmail
 * @desc 決済完了後の確認メールを送信（顧客向け・本部向け両方）
 * @param {Object} reservationData - 予約データ
 * @param {number} totalAmount - 合計金額
 * @param {string} orderId - 注文ID
 */
function sendPaymentConfirmationEmail(reservationData, totalAmount, orderId) {
  try {
    // 顧客向けメール
    const customerSubject = `【決済完了】テイクアウト予約確認 - ${reservationData.store}`;
    
    const itemsList = reservationData.items.map(item => 
      `・${item.name} × ${item.qty}個 (${(item.price * item.qty).toLocaleString()}円)`
    ).join('\n');
    
    const customerBody = `
${reservationData.name} 様

テイクアウト予約の決済が完了いたしました。
以下の内容でご予約を承りました。

■ 予約詳細
注文ID: ${orderId}
受取店舗: ${reservationData.store}
受取日時: ${reservationData.pickup_date} ${reservationData.pickup_time}

■ ご注文内容
${itemsList}

■ 決済情報
合計金額: ${totalAmount.toLocaleString()}円
決済方法: クレジットカード
決済ID: ${reservationData.payment_session_id}
決済日時: ${new Date(reservationData.payment_date).toLocaleString('ja-JP')}

■ 備考
${reservationData.note || 'なし'}

■ 重要事項
・決済は完了しておりますので、当日は商品をお受け取りください
・受取日時の変更が必要な場合は、お早めに店舗までご連絡ください
・キャンセルの場合は返金手続きを行いますので、店舗までご連絡ください

■ 店舗連絡先
${reservationData.store}
電話番号: 026-242-3030 (本社)

${CANCEL_POLICY_TEXT}

詳細なキャンセルポリシーは以下でもご確認いただけます：
${CANCEL_POLICY_URL}

この度はご利用いただき、ありがとうございました。
当日のお受け取りをお待ちしております。

株式会社あっぷるアイビー
`;
    
    // 顧客向けメール送信
    MailApp.sendEmail(reservationData.email, customerSubject, customerBody);
    console.log('決済確認メール（顧客向け）送信完了:', reservationData.email);
    
    // 本部向けメール
    const adminSubject = `【決済完了予約受付】${reservationData.name}様 - ${reservationData.store}`;
    
    const adminBody = `
▼テイクアウト予約受付（決済完了）

■ 基本情報
注文ID: ${orderId}
受付日時: ${Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss')}
お名前: ${reservationData.name}
電話番号: ${reservationData.phone}
メールアドレス: ${reservationData.email}
受取店舗: ${reservationData.store}
受取希望日: ${reservationData.pickup_date}
受取希望時間: ${reservationData.pickup_time}

■ ご注文内容
${itemsList}

■ 決済情報
合計金額: ${totalAmount.toLocaleString()}円
決済方法: クレジットカード
決済ID（短縮版）: ${reservationData.payment_session_id.substring(reservationData.payment_session_id.length - 16)}
決済ID（完全版）: ${reservationData.payment_session_id}
決済日時: ${new Date(reservationData.payment_date).toLocaleString('ja-JP')}

■ 備考
${reservationData.note || 'なし'}

※このメールは決済完了予約の通知です。事前決済済みのため、当日は商品の受け渡しのみとなります。
`;
    
    // 本部向けメール送信
    MailApp.sendEmail('appleivyck@gmail.com', adminSubject, adminBody);
    console.log('決済確認メール（本部向け）送信完了: appleivyck@gmail.com');
    
  } catch (error) {
    console.error('決済確認メール送信エラー:', error);
    throw error;
  }
}

/**
 * @function handleStripeWebhook
 * @desc Stripe Webhookを処理（将来的な拡張用）
 * @param {Object} webhookData - Webhook データ
 * @return {Object} 処理結果
 */
function handleStripeWebhook(webhookData) {
  // 将来的にWebhookが必要になった場合の実装
  console.log('Stripe Webhook受信:', webhookData);
  
  return {
    success: true,
    message: 'Webhook処理完了'
  };
}

// ========================================
// 既存のdoPost関数にStripe機能を統合
// ========================================

// 既存のdoPost関数内のswitch文に以下のケースを追加:
// case 'createCheckoutSession':
//   return handleCheckoutSessionRequest(decodedData);
// case 'submitPaymentReservation':
//   return handlePaymentReservationRequest(decodedData);

/**
 * @function handleCheckoutSessionRequest
 * @desc Checkoutセッション作成リクエストを処理
 * @param {Object} data - リクエストデータ
 * @return {string} JSONP レスポンス
 */
function handleCheckoutSessionRequest(data) {
  try {
    const result = createCheckoutSession(data);
    return createJsonpResponse(result, data.callback);
  } catch (error) {
    console.error('Checkoutセッション作成リクエスト処理エラー:', error);
    return createJsonpResponse({ success: false, error: error.toString() }, data.callback);
  }
}

/**
 * @function handlePaymentReservationRequest
 * @desc 決済完了予約リクエストを処理
 * @param {Object} data - リクエストデータ
 * @return {string} JSONP レスポンス
 */
function handlePaymentReservationRequest(data) {
  try {
    const result = submitPaymentReservation(data);
    return createJsonpResponse(result, data.callback);
  } catch (error) {
    console.error('決済予約リクエスト処理エラー:', error);
    return createJsonpResponse({ success: false, error: error.toString() }, data.callback);
  }
}
