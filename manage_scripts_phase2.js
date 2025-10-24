/**
 * @file manage_scripts_phase2.js
 * @brief 店舗管理画面（manage.html）Phase2高速化版JavaScript
 * @details GAS通信高速化：並列処理、キャッシュ、差分更新
 * @version 2.0 - Phase 2: GAS通信高速化
 */

// ============================================
// グローバル変数・設定
// ============================================

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwQi1nQI1jDspUlagORpKHtpj3NBbQ5RNNkkcXqhsE-WM_j_w10CvO0CAPkVZFT5Vxh/exec';

let SHOP_SECRET = '';
let allReservations = [];
let currentFilter = 'all';

// モーダル関連の変数
let pendingToggleRowId = null;
let pendingToggleElement = null;

// Phase 2: キャッシュ関連変数
let lastDataHash = '';
let cacheTimestamp = 0;
const CACHE_DURATION = 30000; // 30秒キャッシュ
const CACHE_KEY_PREFIX = 'reservation_cache_';

// ============================================
// 🛡️ セキュリティ強化：ワンタイムトークンシステム
// ============================================

// セッション管理変数
let sessionToken = null;
let tokenExpiry = 0;
const TOKEN_VALIDITY = 300000; // 5分間有効

// 管理画面用セッション管理変数（フラグで有効化）
let adminToken = null;
let adminTokenExpiry = 0;
let ADMIN_AUTH_ENABLED = true; // 既定ON（新方式を優先使用）

/**
 * セキュアなワンタイムトークンを生成
 * @return {Object} トークンデータ
 */
async function generateSecureToken() {
  const timestamp = Date.now();
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const randomHex = Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
  
  // 店舗シークレット + タイムスタンプ + ランダム値でHMAC生成
  const message = SHOP_SECRET + ':' + timestamp + ':' + randomHex;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SHOP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const signatureHex = Array.from(new Uint8Array(signature), byte => 
    byte.toString(16).padStart(2, '0')).join('');
  
  return {
    token: `${timestamp}.${randomHex}.${signatureHex}`,
    expiry: timestamp + TOKEN_VALIDITY
  };
}

/**
 * 有効なトークンを取得（期限切れなら新規生成）
 * @return {string} 有効なトークン
 */
async function getValidToken() {
  const now = Date.now();
  
  // トークンが存在し、まだ有効な場合
  if (sessionToken && now < tokenExpiry) {
    return sessionToken;
  }
  
  // 新しいトークンを生成
  const tokenData = await generateSecureToken();
  sessionToken = tokenData.token;
  tokenExpiry = tokenData.expiry;
  
  console.log('🔐 新しいセキュリティトークンを生成しました');
  return sessionToken;
}

/**
 * チェックサム生成（データ整合性確認用）
 * @param {string} secret - 店舗シークレット
 * @param {number} timestamp - タイムスタンプ
 * @return {string} チェックサム
 */
async function generateChecksum(secret, timestamp) {
  const data = `${secret}:${timestamp}`;
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hash), byte => 
    byte.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

/**
 * クライアント固有ID生成
 * @return {string} クライアントID
 */
function generateClientId() {
  if (!localStorage.getItem('clientId')) {
    const randomBytes = new Uint8Array(8);
    crypto.getRandomValues(randomBytes);
    const clientId = Array.from(randomBytes, byte => 
      byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('clientId', clientId);
  }
  return localStorage.getItem('clientId');
}

/**
 * 管理画面用セッション取得
 * @return {Promise<string>} 管理画面トークン
 */
async function getAdminToken() {
  const now = Date.now();
  
  // トークンが存在し、まだ有効な場合
  if (adminToken && now < adminTokenExpiry) {
    return adminToken;
  }
  
  // 新しいセッションを取得
  try {
    const callbackName = 'adminSessionCallback' + Date.now();
    
    window[callbackName] = function(result) {
      console.log('管理画面セッション取得応答:', result);
      
      try {
        if (result && result.success && result.adminToken) {
          adminToken = result.adminToken;
          adminTokenExpiry = Date.now() + result.expiresIn;
          console.log('🔐 管理画面セッション取得成功');
        } else {
          console.error('管理画面セッション取得失敗:', result);
          adminToken = null;
          adminTokenExpiry = 0;
        }
      } catch (error) {
        console.error('管理画面セッション処理エラー:', error);
        adminToken = null;
        adminTokenExpiry = 0;
      } finally {
        cleanupJSONP(callbackName);
      }
    };
    
    const jsonpUrl = `${GAS_API_URL}?action=initAdminSession&shop=${SHOP_SECRET}&callback=${callbackName}&_t=${Date.now()}`;
    console.log('管理画面セッション取得URL(head):', jsonpUrl.slice(0, 160) + '...');
    
    const script = document.createElement('script');
    script.src = jsonpUrl;
    script.setAttribute('data-jsonp', 'true');
    script.setAttribute('data-callback', callbackName);
    
    script.onerror = function() {
      console.error('管理画面セッション取得エラー');
      adminToken = null;
      adminTokenExpiry = 0;
      cleanupJSONP(callbackName);
    };
    
    document.head.appendChild(script);
    
    // 同期処理のため、少し待機
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return adminToken;
    
  } catch (error) {
    console.error('管理画面セッション取得エラー:', error);
    return null;
  }
}

/**
 * セキュアなGASリクエスト用URLを構築（新方式優先）
 * @param {string} action - アクション名
 * @param {string} callbackName - コールバック関数名
 * @param {Object} additionalParams - 追加パラメータ
 * @return {string} セキュアなURL
 */
async function buildSecureUrl(action, callbackName, additionalParams = {}) {
  try {
    // 管理画面トークンを優先取得（フラグ有効時のみ）
    const currentAdminToken = ADMIN_AUTH_ENABLED ? (await getAdminToken()) : null;
    
    if (currentAdminToken) {
      // 新方式（管理画面トークン）を使用
      const baseParams = {
        action: action,
        shop: SHOP_SECRET,
        callback: callbackName,
        adminToken: currentAdminToken,
        _t: Date.now()
      };
      
      const allParams = { ...baseParams, ...additionalParams };
      
      const params = new URLSearchParams();
      Object.entries(allParams).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          params.append(key, value);
        }
      });
      
      console.log('🔐 新方式（管理画面トークン）でURL構築');
      return `${GAS_API_URL}?${params.toString()}`;
    } else {
      // フォールバック：旧方式（クライアント生成トークン）
      const secureToken = await getValidToken();
      const timestamp = Date.now();
      
      const baseParams = {
        action: action,
        shop: SHOP_SECRET,
        callback: callbackName,
        token: secureToken,
        timestamp: timestamp,
        clientId: generateClientId(),
        checksum: await generateChecksum(SHOP_SECRET, timestamp),
        _t: timestamp
      };
      
      const allParams = { ...baseParams, ...additionalParams };
      
      const params = new URLSearchParams();
      Object.entries(allParams).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          params.append(key, value);
        }
      });
      
      const built = `${GAS_API_URL}?${params.toString()}`;
      console.log('🔐 旧方式（クライアント生成トークン）でURL構築(head):', built.slice(0, 180) + '...');
      return built;
    }
    
  } catch (error) {
    console.error('セキュアURL構築エラー:', error);
    throw new Error('セキュリティ検証に失敗しました');
  }
}

// ============================================
// Phase 2: メモリークリーンアップ機能
// ============================================

let cleanupInterval = null;

// 定期的なメモリークリーンアップを開始
function startMemoryCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }
  
  cleanupInterval = setInterval(() => {
    console.log('=== 定期メモリークリーンアップ実行 ===');
    
    // 1. 古いJSONPスクリプトのクリーンアップ
    const oldJsonpScripts = document.querySelectorAll('script[data-jsonp="true"]');
    if (oldJsonpScripts.length > 5) {
      Array.from(oldJsonpScripts).slice(0, oldJsonpScripts.length - 3).forEach(script => {
        try {
          script.remove();
        } catch (e) {
          console.warn('古いJSONPスクリプト削除エラー:', e);
        }
      });
    }
    
    // 2. 古いコールバック関数のクリーンアップ
    const callbackPattern = /^(updateCallback|loadCallback)/;
    Object.keys(window).forEach(key => {
      if (callbackPattern.test(key)) {
        // 古いコールバック（30秒以上前）を削除
        const timestamp = key.match(/\d+$/);
        if (timestamp && (Date.now() - parseInt(timestamp[0]) > 30000)) {
          try {
            delete window[key];
            console.log('古いコールバック削除:', key);
          } catch (e) {
            console.warn('コールバック削除エラー:', key, e);
          }
        }
      }
    });
    
    // 3. キャッシュの整理
    try {
      if (localStorage.length > 50) { // LocalStorageが50個以上の場合
        const keys = Object.keys(localStorage);
        const cacheKeys = keys.filter(key => key.startsWith(CACHE_KEY_PREFIX));
        if (cacheKeys.length > 10) {
          // 古いキャッシュを削除
          cacheKeys.slice(0, cacheKeys.length - 5).forEach(key => {
            localStorage.removeItem(key);
          });
          console.log('古いキャッシュを削除しました');
        }
      }
    } catch (e) {
      console.warn('キャッシュクリーンアップエラー:', e);
    }
    
    console.log('メモリークリーンアップ完了');
    
    // リソース監視も同時実行
    monitorResources();
  }, 300000); // 5分間隔
}

// メモリークリーンアップを停止
function stopMemoryCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('メモリークリーンアップを停止しました');
  }
}

// ページ離脱時のクリーンアップ
window.addEventListener('beforeunload', function() {
  stopMemoryCleanup();
});

// ============================================
// Phase 2: キャッシュ管理システム
// ============================================

// データのハッシュ値計算
function calculateDataHash(data) {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 32bit整数に変換
  }
  return hash.toString();
}

// キャッシュからデータ取得
function getCachedData() {
  try {
    const cacheKey = CACHE_KEY_PREFIX + SHOP_SECRET;
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;
    
    const cacheData = JSON.parse(cached);
    const now = Date.now();
    
    // キャッシュが有効期限内かチェック
    if (now - cacheData.timestamp < CACHE_DURATION) {
      console.log('キャッシュヒット:', cacheData.data.length + '件');
      return cacheData.data;
    } else {
      console.log('キャッシュ期限切れ');
      localStorage.removeItem(cacheKey);
      return null;
    }
  } catch (error) {
    console.warn('キャッシュ読み込みエラー:', error);
    return null;
  }
}

// データをキャッシュに保存
function setCachedData(data) {
  try {
    const cacheKey = CACHE_KEY_PREFIX + SHOP_SECRET;
    const cacheData = {
      data: data,
      timestamp: Date.now(),
      hash: calculateDataHash(data)
    };
    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
    console.log('データキャッシュ保存完了:', data.length + '件');
  } catch (error) {
    console.warn('キャッシュ保存エラー:', error);
  }
}

// ============================================
// ユーティリティ関数
// ============================================

function getTodayString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 店舗名をヘッダーに表示
function updateStoreNameHeader(storeName, mode) {
  const header = document.querySelector('.header');
  const subtitle = document.querySelector('.header .subtitle');
  
  if (mode === 'past7days') {
    subtitle.textContent = `過去7日間の予約履歴（${storeName}）`;
  } else {
    subtitle.textContent = `本日以降の予約一覧（${storeName}）`;
  }
}

function normalizeDateString(dateStr) {
  if (!dateStr) return '';
  
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) {
    return dateStr.replace(/\//g, '-');
  }
  
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const parts = dateStr.split('/');
    return `${parts[2]}-${parts[0]}-${parts[1]}`;
  }
  
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      console.warn('無効な日付形式:', dateStr);
      return dateStr;
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (error) {
    console.warn('日付変換エラー:', dateStr, error);
    return dateStr;
  }
}

function checkTodayReservations() {
  const today = getTodayString();
  
  const todayReservations = allReservations.filter(reservation => {
    const normalizedDate = normalizeDateString(reservation.pickupDate);
    const isToday = normalizedDate === today;
    return isToday;
  });
  
  const groupedToday = groupByOrderId(todayReservations);
  const todayPending = groupedToday.filter(group => 
    !group.items.every(item => item.isCompleted)
  );
  
  const warningElement = document.getElementById('today-warning');
  if (todayPending.length > 0) {
    warningElement.style.display = 'block';
  } else {
    warningElement.style.display = 'none';
  }
}

// ============================================
// 初期化・認証
// ============================================

window.addEventListener('DOMContentLoaded', function() {
  console.log('=== Phase 2 管理画面読み込み開始 ===');
  
  const urlParams = new URLSearchParams(window.location.search);
  SHOP_SECRET = urlParams.get('shop');
  
  try {
    const debug = localStorage.getItem('DEBUG_MANAGE') === '1';
    if (debug) {
      console.log('Shop Secret(head):', (SHOP_SECRET || '').slice(0, 4) + '***');
      console.log('GAS API URL:', GAS_API_URL);
    }
  } catch (e) {
    // 何もしない（本番での安全側）
  }
  
  if (!SHOP_SECRET) {
    console.log('Shop Secretが見つかりません');
    showAuthError();
    return;
  }
  
  document.getElementById('main-content').style.display = 'block';
  
  // Phase 2: 高速化読み込み開始
  console.log('Phase 2 高速データ読み込み開始');
  loadReservationsPhase2();
  
  // メモリークリーンアップ開始
  startMemoryCleanup();
  console.log('メモリークリーンアップ機能を開始しました');
});

function showAuthError() {
  document.getElementById('auth-error').style.display = 'block';
  document.getElementById('main-content').style.display = 'none';
}

// ============================================
// Phase 2: 高速データ読み込み
// ============================================

function cleanupJSONP(callbackName) {
  if (window[callbackName]) {
    delete window[callbackName];
  }
  
  // 既存のスクリプトタグをより確実に削除
  const scripts = document.querySelectorAll(`script[data-callback="${callbackName}"]`);
  scripts.forEach(script => {
    try {
      script.remove();
    } catch (e) {
      console.warn('スクリプト削除エラー:', e);
    }
  });
  
  // 古いスクリプトタグも定期的にクリーンアップ（メモリーリーク対策）
  const allJsonpScripts = document.querySelectorAll('script[data-jsonp="true"]');
  if (allJsonpScripts.length > 10) { // 10個以上溜まったら古いものを削除
    console.warn('JSONP スクリプトが蓄積されています。古いものを削除します。');
    Array.from(allJsonpScripts).slice(0, allJsonpScripts.length - 5).forEach(script => {
      try {
        script.remove();
      } catch (e) {
        console.warn('古いスクリプト削除エラー:', e);
      }
    });
  }
}

// Phase 2: 高速化予約読み込み（キャッシュ優先）
function loadReservationsPhase2() {
  console.log('=== Phase 2 loadReservations開始 ===');
  
  // キャッシュ確認
  const cachedData = getCachedData();
  if (cachedData) {
    console.log('キャッシュからデータ表示開始');
    allReservations = cachedData;
    
    // キャッシュデータを即座に表示
    updateStats(allReservations);
    displayReservations(allReservations);
    updateFilterButtons('all');
    
    // バックグラウンドで最新データをチェック
    setTimeout(() => {
      loadReservationsFromGAS(true); // バックグラウンド更新
    }, 100);
    
    return;
  }
  
  // キャッシュなしの場合は通常読み込み
  showLoading(true);
  hideError();
  loadReservationsFromGAS(false);
}

// 🛡️ セキュア版：GASからデータを読み込み
async function loadReservationsFromGAS(isBackgroundUpdate = false) {
  console.log('=== セキュアGASデータ読み込み ===', {isBackgroundUpdate});
  
  if (!isBackgroundUpdate) {
    showLoading(true);
    hideError();
  }

  try {
    const callbackName = 'reservationCallback' + Date.now();
    console.log('JSONP Callback名:', callbackName);
    
    const existingScripts = document.querySelectorAll('script[data-jsonp="true"]');
    existingScripts.forEach(script => script.remove());
    
    window[callbackName] = function(data) {
      console.log('=== セキュアJSONP Response受信 ===', data);
      
      try {
        if (data && data.success) {
          console.log('予約データ取得成功:', data.data.length + '件');
          
          // GASから受信したデータをそのまま使用（元のmanage.html方式）
          const newData = data.data || [];
          
          // データハッシュ比較（差分チェック）
          const newHash = calculateDataHash(newData);
          if (newHash !== lastDataHash) {
            console.log('データ更新検出 - 画面更新実行');
            lastDataHash = newHash;
            allReservations = newData;
            
            // キャッシュ保存
            setCachedData(newData);
            
            // 店舗名更新
            if (data.storeName) {
              updateStoreNameHeader(data.storeName, 'today_onwards');
            }
            
            // 画面更新
            updateStats(allReservations);
            displayReservations(allReservations);
            updateFilterButtons('all');
          } else {
            console.log('データ変更なし - 画面更新スキップ');
          }
          
        } else {
          console.error('APIエラー:', data);
          if (data && data.error && data.error.includes('認証トークンが無効')) {
            // トークンエラーの場合は再生成して再試行
            console.log('🔐 トークンエラー検出 - トークン再生成');
            sessionToken = null;
            tokenExpiry = 0;
            if (!isBackgroundUpdate) {
              setTimeout(() => loadReservationsFromGAS(isBackgroundUpdate), 1000);
            }
            return;
          } else if (data && data.error && data.error.includes('アクセス権限')) {
            showAuthError();
          } else {
            showError(data ? data.error : '予約データの読み込みに失敗しました');
          }
        }
      } catch (error) {
        console.error('データ処理エラー:', error);
        showError('データの処理中にエラーが発生しました: ' + error.message);
      } finally {
        cleanupJSONP(callbackName);
        if (!isBackgroundUpdate) {
          showLoading(false);
        }
      }
    };
    
    // セキュアURLを構築
    const jsonpUrl = await buildSecureUrl('getReservations', callbackName);
    console.log('🔐 セキュアJSONP URL生成完了');
    
    const script = document.createElement('script');
    script.src = jsonpUrl;
    script.setAttribute('data-jsonp', 'true');
    script.setAttribute('data-callback', callbackName);
    
    script.onerror = function(error) {
      console.error('セキュアJSONP読み込みエラー:', error);
      showError('ネットワークエラーが発生しました。セキュリティ検証をご確認ください。');
      cleanupJSONP(callbackName);
      if (!isBackgroundUpdate) {
        showLoading(false);
      }
    };
    
    script.onload = function() {
      console.log('セキュアJSONPスクリプト読み込み完了');
    };
    
    document.head.appendChild(script);
    
    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('セキュアJSONP タイムアウト');
        showError('リクエストがタイムアウトしました。再度お試しください。');
        cleanupJSONP(callbackName);
        if (!isBackgroundUpdate) {
          showLoading(false);
        }
      }
    }, 10000);
    
  } catch (error) {
    console.error('セキュアJSONP初期化エラー:', error);
    showError('セキュアな通信の初期化に失敗しました: ' + error.message);
    if (!isBackgroundUpdate) {
      showLoading(false);
    }
  }
}

// 外部から呼ばれる更新関数（Phase 2対応）
function loadReservations() {
  console.log('手動更新要求');
  // キャッシュクリア
  const cacheKey = CACHE_KEY_PREFIX + SHOP_SECRET;
  localStorage.removeItem(cacheKey);
  lastDataHash = '';
  
  // 強制更新
  loadReservationsFromGAS(false);
}

// ============================================
// UI表示関数（変更なし）
// ============================================

function showLoading(show) {
  const loading = document.getElementById('loading');
  const reservationList = document.getElementById('reservation-list');
  const noData = document.getElementById('no-data');
  
  if (show) {
    loading.style.display = 'block';
    reservationList.style.display = 'none';
    noData.style.display = 'none';
  } else {
    loading.style.display = 'none';
  }
}

function showError(message) {
  const errorElement = document.getElementById('error-message');
  const errorText = document.getElementById('error-text');
  errorText.textContent = message;
  errorElement.style.display = 'flex';
}

function hideError() {
  const errorElement = document.getElementById('error-message');
  errorElement.style.display = 'none';
}

function updateStats(reservations) {
  const total = reservations.length;
  const pending = reservations.filter(r => !r.isCompleted).length;
  const completed = reservations.filter(r => r.isCompleted).length;
  
  document.getElementById('total-count').textContent = total;
  document.getElementById('pending-count').textContent = pending;
  document.getElementById('completed-count').textContent = completed;
}

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
  
  return Object.values(groups).sort((a, b) => {
    const dateA = new Date(a.items[0].pickupDate + ' ' + a.items[0].pickupTime);
    const dateB = new Date(b.items[0].pickupDate + ' ' + b.items[0].pickupTime);
    return dateA - dateB;
  });
}

// HTMLエスケープ関数
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 日時を読みやすい日本語形式にフォーマット（元のmanage.html方式）
function formatPickupDateTime(dateStr, timeStr) {
  try {
    // 日付を解析
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    // 曜日を取得
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const dayOfWeek = dayNames[date.getDay()];
    
    // 時刻を解析・フォーマット
    let formattedTime = '';
    
    if (timeStr) {
      // ISO形式の場合（例：1899-12-30T03:30:00.000Z）
      if (timeStr.includes('T') && timeStr.includes('Z')) {
        const timeDate = new Date(timeStr);
        const hours = timeDate.getHours().toString().padStart(2, '0');
        const minutes = timeDate.getMinutes().toString().padStart(2, '0');
        formattedTime = `${hours}:${minutes}`;
      }
      // すでにHH:MM形式の場合
      else if (timeStr.match(/^\d{1,2}:\d{2}$/)) {
        formattedTime = timeStr;
      }
      // その他の形式の場合は文字列をそのまま使用
      else {
        formattedTime = timeStr;
      }
    }
    
    return `${year}年${month}月${day}日（${dayOfWeek}） ${formattedTime}`;
    
  } catch (error) {
    console.warn('日時フォーマットエラー:', error, {dateStr, timeStr});
    return `${dateStr} ${timeStr}`;
  }
}

function displayReservations(reservations) {
  console.log('=== displayReservations開始 ===');
  console.log('表示対象件数:', reservations.length);
  
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
    
    // 過去の予約かどうかを判定
    const isPast = customer.isPastReservation || false;
    
    // クラス名を構築
    let cardClasses = 'reservation-card';
    if (isCompleted) {
      cardClasses += ' completed';
    } else {
      cardClasses += ' pending';
    }
    if (isPast) {
      cardClasses += ' past';
    }

    // ID用に安全な値へ変換
    const safeOrderId = String(customer.orderId || '').replace(/[^A-Za-z0-9_-]/g, '_');
    const safePhoneHref = 'tel:' + String(customer.phone || '').replace(/[^0-9+]/g, '');

    return `
      <div class="${cardClasses}" data-filter="${isCompleted ? 'completed' : 'pending'}">
        <div class="card-header">
          <div class="pickup-info">
            ${isPast ? '📅 (過去)' : '📅'} ${formatPickupDateTime(customer.pickupDate, customer.pickupTime)}
          </div>
          <div class="status ${isCompleted ? 'completed' : 'pending'}">
            ${isCompleted ? '完了' : '未完了'}
          </div>
        </div>
        
        <div class="customer-info">
          <div class="row">
            <span class="icon">👤</span>
            <strong>${escapeHtml(customer.customerName)}</strong>
          </div>
          <div class="row">
            <span class="icon">📞</span>
            <a href="${safePhoneHref}" class="phone-link">${escapeHtml(customer.phone)}</a>
          </div>
          <div class="row">
            <span class="icon">📧</span>
            <span>${escapeHtml(customer.email)}</span>
          </div>
          <div class="row">
            <span class="icon">🆔</span>
            <span>${escapeHtml(customer.orderId)}</span>
          </div>
        </div>
        
        <div class="products">
          <div class="title">📦 注文内容</div>
          ${group.items.map(item => `
            <div class="product-item">
              <span class="product-name">${escapeHtml(item.productName)} × ${item.quantity}</span>
              <span class="product-price">${item.subtotal}円</span>
            </div>
          `).join('')}
        </div>
        
        <div class="total">💰 合計金額: ${totalAmount}円</div>
        
        ${customer.note ? `
          <div class="note">
            <div class="title">📝 お客様からの備考</div>
            <div>${escapeHtml(customer.note)}</div>
          </div>
        ` : ''}
        
        <div class="controls-row">
          <div class="toggle-container">
            <label class="toggle-switch">
              <input type="checkbox" id="check-${safeOrderId}" ${isCompleted ? 'checked' : ''} 
                     onchange="handleToggleChange('${group.items[0].rowId}', this)">
              <span class="toggle-slider"></span>
            </label>
            <label for="check-${safeOrderId}" class="toggle-label">受渡完了</label>
            ${customer.handoverStaff ? `<span style="color: #666; font-size: 0.9em; margin-left: 8px;">担当: ${escapeHtml(customer.handoverStaff)}</span>` : ''}
            <span class="auto-save-message" id="save-msg-${group.orderId}" style="display: none; color: #27ae60; font-size: 0.9em; margin-left: 8px;">自動保存中...</span>
          </div>
          
          <div class="memo-area">
            <input type="text" class="memo-input" id="memo-${safeOrderId}" 
                   value="${escapeHtml(customer.memo || '')}" placeholder="スタッフメモを入力..." maxlength="200">
            <button class="save-btn" onclick="showSavingModal(); updateReservationPhase2('${group.items[0].rowId}', null, document.getElementById('memo-${safeOrderId}').value)">
              📝 <span class="save-btn-text">メモ保存</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // 本日分の予約チェック
  checkTodayReservations();
  
  console.log('表示HTML生成完了');
}

// ============================================
// フィルタリング機能（変更なし）
// ============================================

function filterReservations(filter) {
  console.log('フィルター実行:', filter);
  currentFilter = filter;
  
  let filteredReservations = [...allReservations];
  const today = getTodayString();
  
  switch (filter) {
    case 'today':
      filteredReservations = allReservations.filter(reservation => {
        const normalizedDate = normalizeDateString(reservation.pickupDate);
        return normalizedDate === today;
      });
      break;
    case 'pending':
      filteredReservations = allReservations.filter(reservation => !reservation.isCompleted);
      break;
    case 'completed':
      filteredReservations = allReservations.filter(reservation => reservation.isCompleted);
      break;
    case 'all':
    default:
      break;
  }
  
  console.log('フィルター結果:', filteredReservations.length + '件');
  
  updateStats(filteredReservations);
  displayReservations(filteredReservations);
  updateFilterButtons(filter);
}

// ============================================
// Phase 2: 高速データ更新機能
// ============================================

function toggleCompletion(rowId, checked, event) {
  console.log('=== 受渡し状態切り替え ===', {rowId, checked});
  
  if (checked) {
    pendingToggleRowId = rowId;
    pendingToggleElement = event.target;
    document.getElementById('staff-modal').style.display = 'flex';
    document.getElementById('staff-name-input').focus();
  } else {
    // チェックOFF（未完了に戻す）の場合も保存中モーダルを表示
    showSavingModal();
    updateReservationPhase2(rowId, checked, null, event, null);
  }
}

// 元のmanage.htmlのトグル処理関数
function handleToggleChange(rowId, toggleElement) {
  const checked = toggleElement.checked;
  console.log('=== handleToggleChange ===', {rowId, checked});
  
  if (checked) {
    // チェックONの場合は担当者名入力を要求
    pendingToggleRowId = rowId;
    pendingToggleElement = toggleElement;
    document.getElementById('staff-modal').style.display = 'flex';
    document.getElementById('staff-name-input').focus();
  } else {
    // チェックOFFの場合は保存中モーダルを表示して直接更新
    showSavingModal();
    updateReservationPhase2(rowId, checked, null, {target: toggleElement}, null);
  }
}

function saveMemo(rowId, event) {
  console.log('=== メモ保存 ===', {rowId});
  const memoInput = document.getElementById(`memo-${rowId}`);
  const memo = memoInput ? memoInput.value : '';
  showSavingModal();
  updateReservationPhase2(rowId, null, memo, event, null);
}

// ============================================
// Phase 2: リソース監視機能
// ============================================

// リソース使用状況の監視
function monitorResources() {
  if (performance && performance.memory) {
    const memory = performance.memory;
    console.log('=== リソース監視 ===', {
      メモリ使用量: Math.round(memory.usedJSHeapSize / 1024 / 1024) + 'MB',
      メモリ制限: Math.round(memory.jsHeapSizeLimit / 1024 / 1024) + 'MB',
      メモリ比率: Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100) + '%',
      JONPスクリプト数: document.querySelectorAll('script[data-jsonp="true"]').length,
      キャッシュ数: Object.keys(localStorage).filter(key => key.startsWith(CACHE_KEY_PREFIX)).length
    });
    
    // メモリ使用量が80%を超えた場合の警告
    if ((memory.usedJSHeapSize / memory.jsHeapSizeLimit) > 0.8) {
      console.warn('⚠️ メモリ使用量が高くなっています。強制クリーンアップを実行します。');
      forceMemoryCleanup();
    }
  }
}

// 強制メモリークリーンアップ
function forceMemoryCleanup() {
  console.log('🧹 強制メモリークリーンアップ実行');
  
  // 1. 全てのJSONPスクリプトを削除
  document.querySelectorAll('script[data-jsonp="true"]').forEach(script => {
    script.remove();
  });
  
  // 2. 古いコールバック関数を全て削除
  Object.keys(window).forEach(key => {
    if (/^(updateCallback|loadCallback)/.test(key)) {
      delete window[key];
    }
  });
  
  // 3. 古いキャッシュを削除
  const keys = Object.keys(localStorage);
  const cacheKeys = keys.filter(key => key.startsWith(CACHE_KEY_PREFIX));
  if (cacheKeys.length > 3) {
    cacheKeys.slice(0, cacheKeys.length - 2).forEach(key => {
      localStorage.removeItem(key);
    });
  }
  
  console.log('強制メモリークリーンアップ完了');
}

// ============================================
// フィルター・表示機能
// ============================================

// フィルターボタンのアクティブ状態を更新
function updateFilterButtons(activeFilter) {
  // すべてのフィルターボタンからactiveクラスを削除
  document.querySelectorAll('.controls .btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // アクティブなフィルターボタンにactiveクラスを追加
  let activeButtonId = '';
  switch (activeFilter) {
    case 'all':
      activeButtonId = 'filter-all';
      break;
    case 'today':
      activeButtonId = 'filter-today';
      break;
    case 'pending':
      activeButtonId = 'filter-pending';
      break;
    case 'completed':
      activeButtonId = 'filter-completed';
      break;
    case 'past7days':
      activeButtonId = 'filter-past7days';
      break;
  }
  
  if (activeButtonId) {
    const activeButton = document.getElementById(activeButtonId);
    if (activeButton) {
      activeButton.classList.add('active');
    }
  }
}

// 過去の予約カード用のスタイルを追加
function addPastReservationStyles() {
  // 既存のスタイルがあれば削除
  const existingStyle = document.getElementById('past-reservation-styles');
  if (existingStyle) {
    existingStyle.remove();
  }
  
  // 新しいスタイルを追加
  const style = document.createElement('style');
  style.id = 'past-reservation-styles';
  style.textContent = `
    .reservation-card.past {
      background: linear-gradient(135deg, #f8f9fa, #e9ecef);
      border-left: 6px solid #6c757d;
      opacity: 0.8;
    }
    .reservation-card.past .card-header {
      opacity: 0.9;
    }
    .reservation-card.past .pickup-info::before {
      content: "📅 ";
      color: #6c757d;
    }
  `;
  document.head.appendChild(style);
}

// ============================================
// Phase 2: 過去7日間データ読み込み
// ============================================

// 🛡️ セキュア版：過去7日間のデータを読み込み（Phase 2対応）
async function loadPast7Days() {
  console.log('=== セキュア過去7日間データ読み込み開始（Phase 2） ===');
  showLoading(true);
  hideError();

  try {
    // JSONP方式でGASから過去7日間データを取得
    const callbackName = 'past7daysCallback' + Date.now();
    console.log('JSONP Callback名（過去7日間）:', callbackName);
    
    // 既存のスクリプトタグを削除（クリーンアップ）
    const existingScripts = document.querySelectorAll('script[data-jsonp="true"]');
    existingScripts.forEach(script => script.remove());
    
    // グローバルコールバック関数を定義
    window[callbackName] = function(data) {
      console.log('=== セキュア過去7日間 JSONP Response受信 ===', data);
      
      try {
        if (data && data.success) {
          console.log('過去7日間データ取得成功:', data.data.length + '件');
          allReservations = data.data || [];
          
          // 店舗名をヘッダーに表示（過去7日間モード）
          if (data.storeName) {
            updateStoreNameHeader(data.storeName, 'past7days');
          }
          
          // 過去の予約カードに背景色を設定するためのスタイルを追加
          addPastReservationStyles();
          
          // 統計情報を更新
          updateStats(allReservations);
          
          // 予約一覧を表示（過去の予約も含む）
          displayReservations(allReservations);
          
          // フィルターボタンのアクティブ状態を更新
          updateFilterButtons('past7days');
          
          console.log('過去7日間表示完了');
          
        } else {
          console.error('過去7日間データ取得失敗:', data);
          if (data && data.error && data.error.includes('認証トークンが無効')) {
            // トークンエラーの場合は再生成して再試行
            console.log('🔐 過去7日間トークンエラー検出 - トークン再生成');
            sessionToken = null;
            tokenExpiry = 0;
            setTimeout(() => loadPast7Days(), 1000);
            return;
          } else if (data && data.error && data.error.includes('アクセス権限')) {
            showAuthError();
          } else {
            showError(data ? data.error : '過去7日間データの読み込みに失敗しました');
          }
        }
      } catch (error) {
        console.error('過去7日間データ処理エラー:', error);
        showError('過去7日間データの処理中にエラーが発生しました: ' + error.message);
      } finally {
        // クリーンアップ
        cleanupJSONP(callbackName);
        showLoading(false);
      }
    };
    
    // セキュアURLを構築（過去7日間パラメータ付き）
    const jsonpUrl = await buildSecureUrl('getReservations', callbackName, { dateRange: 'past_7days' });
    console.log('🔐 セキュア過去7日間URL生成完了');
    
    // スクリプトタグを作成
    const script = document.createElement('script');
    script.src = jsonpUrl;
    script.setAttribute('data-jsonp', 'true');
    script.setAttribute('data-callback', callbackName);
    
    // エラーハンドリング
    script.onerror = function(error) {
      console.error('セキュア過去7日間 JSONP読み込みエラー:', error);
      showError('ネットワークエラーが発生しました。セキュリティ検証をご確認ください。');
      cleanupJSONP(callbackName);
      showLoading(false);
    };
    
    script.onload = function() {
      console.log('セキュア過去7日間 JSONPスクリプト読み込み完了');
    };
    
    // スクリプトタグを追加してリクエスト実行
    document.head.appendChild(script);
    
    // タイムアウト設定（10秒）
    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('セキュア過去7日間 JSONP タイムアウト');
        showError('過去7日間データのリクエストがタイムアウトしました。再度お試しください。');
        cleanupJSONP(callbackName);
        showLoading(false);
      }
    }, 10000);
    
  } catch (error) {
    console.error('セキュア過去7日間 JSONP初期化エラー:', error);
    showError('セキュアな過去7日間データの読み込み初期化に失敗しました: ' + error.message);
    showLoading(false);
  }
}

// ============================================
// Phase 2: 担当者入力モーダル機能
// ============================================

// 担当者名入力確定
function confirmStaffInput() {
  const staffName = document.getElementById('staff-name-input').value.trim();
  
  if (!staffName) {
    alert('担当者名を入力してください');
    return;
  }
  
  // モーダルを閉じる
  document.getElementById('staff-modal').style.display = 'none';
  
  // 保存中モーダルを表示
  showSavingModal();
  
  // 予約更新を実行
  if (pendingToggleRowId && pendingToggleElement) {
    updateReservationPhase2(pendingToggleRowId, true, null, {target: pendingToggleElement}, staffName);
  }
  
  // 変数をクリア
  pendingToggleRowId = null;
  pendingToggleElement = null;
  document.getElementById('staff-name-input').value = '';
}

// 担当者名入力キャンセル
function cancelStaffInput() {
  // モーダルを閉じる
  document.getElementById('staff-modal').style.display = 'none';
  
  // トグルを元に戻す
  if (pendingToggleElement) {
    pendingToggleElement.checked = false;
  }
  
  // 変数をクリア
  pendingToggleRowId = null;
  pendingToggleElement = null;
  document.getElementById('staff-name-input').value = '';
}

// ============================================
// 保存中モーダル制御
// ============================================

// 保存中モーダルを表示
function showSavingModal() {
  console.log('保存中モーダル表示');
  const modal = document.getElementById('saving-modal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

// 保存中モーダルを非表示
function hideSavingModal() {
  console.log('保存中モーダル非表示');
  const modal = document.getElementById('saving-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// ============================================
// Phase 2: データ更新機能（完全版）
// ============================================

// 予約データ更新（統合版）- Phase 2対応
function updateReservation(rowId, checked, memo, event, staffName) {
  console.log('=== updateReservation開始 ===', {rowId, checked, memo, staffName});
  
  // ボタンの参照を取得
  let originalButton = null;
  let autoSaveMessage = null;
  
  if (event && event.target) {
    originalButton = event.target;
    
    // チェックボックスの場合は自動保存メッセージを表示
    if (checked !== null && event.target.type === 'checkbox') {
      const orderId = event.target.id.replace('check-', '');
      autoSaveMessage = document.getElementById(`save-msg-${orderId}`);
      if (autoSaveMessage) {
        autoSaveMessage.style.display = 'inline';
      }
    }
  }
  
  try {
    // チェックボックス更新の場合は、同一注文IDの全行を更新
    if (checked !== null) {
      // 現在の行から注文IDを取得
      const currentReservation = allReservations.find(r => r.rowId === parseInt(rowId));
      if (currentReservation) {
        // 同一注文IDの全行を更新
        const sameOrderRows = allReservations
          .filter(r => r.orderId === currentReservation.orderId)
          .map(r => r.rowId);
        
        console.log('同一注文ID行一括更新:', {orderId: currentReservation.orderId, rows: sameOrderRows});
        
        // 各行を順次更新
        updateMultipleRows(sameOrderRows, checked, memo, staffName);
        return;
      }
    }
    
    // メモ更新の場合は単一行のみ更新
    updateSingleRow(rowId, checked, memo, originalButton, autoSaveMessage, staffName);
    
  } catch (error) {
    console.error('updateReservation処理エラー:', error);
    hideSavingModal();
    showError('予約データの更新中にエラーが発生しました: ' + error.message);
  }
}

// 複数行を順次更新する関数
function updateMultipleRows(rowIds, checked, memo, staffName) {
  let completedCount = 0;
  let totalCount = rowIds.length;
  let hasError = false;

  console.log('複数行更新開始:', {rowIds, checked, memo, totalCount});

  rowIds.forEach((rowId, index) => {
    setTimeout(() => {
      updateSingleRowInternal(rowId, checked, memo, staffName, (success) => {
        completedCount++;
        if (!success) hasError = true;

        console.log('行更新完了:', {rowId, success, completedCount, totalCount});

        // 全行の更新が完了した場合
        if (completedCount >= totalCount) {
          if (hasError) {
            showError('一部の更新に失敗しました');
          } else {
            console.log('全行更新完了');
          }
                  // 全て完了後にリロード
        setTimeout(() => {
          hideSavingModal();
          loadReservationsPhase2();
        }, 500);
        }
      });
    }, index * 200); // 200ms間隔で順次実行
  });
}

// 単一行更新の内部関数
// 🛡️ セキュア版：単一行更新（内部処理）
async function updateSingleRowInternal(rowId, checked, memo, staffName, callback) {
  try {
    const callbackName = 'updateCallback' + Date.now() + '_' + rowId;
    console.log('🔐 セキュア単一行更新開始:', {rowId, callbackName});

    // グローバルコールバック関数を定義
    window[callbackName] = function(result) {
      console.log('=== セキュア単一行Response受信 ===', {rowId, result});
      
      try {
        const success = result && result.success;
        if (success) {
          console.log('セキュア単一行更新成功:', rowId);
          console.log('サーバーレスポンス詳細:', result);
        } else {
          console.error('セキュア単一行更新失敗:', {rowId, result});
          console.log('エラー詳細:', result ? result.error : 'レスポンスなし');
          
          // トークンエラーの場合は再生成して再試行
          if (result && result.error && result.error.includes('認証トークンが無効')) {
            console.log('🔐 更新時トークンエラー検出 - トークン再生成して再試行');
            sessionToken = null;
            tokenExpiry = 0;
            setTimeout(() => updateSingleRowInternal(rowId, checked, memo, staffName, callback), 1000);
            return;
          }
        }
        if (callback) callback(success);
      } catch (error) {
        console.error('セキュア単一行処理エラー:', error);
        if (callback) callback(false);
      } finally {
        cleanupJSONP(callbackName);
      }
    };

    // 追加パラメータを準備
    const additionalParams = {
      rowId: parseInt(rowId)
    };

    if (checked !== null && checked !== undefined) {
      additionalParams.checked = checked ? '1' : '0';
      console.log('チェック状態送信:', checked ? '1' : '0');
    }
    if (memo !== null && memo !== undefined) {
      additionalParams.memo = memo;
      console.log('メモ送信:', memo);
    }
    if (staffName !== null && staffName !== undefined) {
      additionalParams.staffName = staffName;
      console.log('担当者名送信:', staffName);
    }

    // セキュアURLを構築
    const jsonpUrl = await buildSecureUrl('updateReservation', callbackName, additionalParams);
    console.log('🔐 セキュア更新URL生成完了');

    // スクリプトタグを作成・実行
    const script = document.createElement('script');
    script.src = jsonpUrl;
    script.setAttribute('data-jsonp', 'true');
    script.setAttribute('data-callback', callbackName);
    
    // エラーハンドリング
    script.onerror = function() {
      console.error('セキュアJSONP読み込みエラー:', jsonpUrl);
      if (callback) callback(false);
      cleanupJSONP(callbackName);
    };
    
    document.head.appendChild(script);
    
    // タイムアウト設定
    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('セキュアJSONP タイムアウト:', callbackName);
        if (callback) callback(false);
        cleanupJSONP(callbackName);
      }
    }, 10000);
    
  } catch (error) {
    console.error('セキュア updateSingleRowInternal エラー:', error);
    if (callback) callback(false);
  }
}

// 単一行更新関数（UI付き）
function updateSingleRow(rowId, checked, memo, originalButton, autoSaveMessage, staffName) {
  try {
    // ローディング表示
    if (originalButton) {
      originalButton.disabled = true;
      if (memo !== null) {
        const textSpan = originalButton.querySelector('.save-btn-text');
        if (textSpan) {
          textSpan.textContent = '更新中...';
        } else {
          originalButton.innerHTML = '📝 更新中...';
        }
      }
    }

    const callbackName = 'updateCallback' + Date.now() + '_single';
    console.log('単一行UI更新開始:', {rowId, callbackName});

    // グローバルコールバック関数を定義
    window[callbackName] = function(result) {
      console.log('=== 単一行UI Response受信 ===', {rowId, result});
      
      try {
        if (result && result.success) {
          console.log('単一行UI更新成功:', rowId);
          console.log('サーバーレスポンス詳細:', result);
          // 更新成功時に再読み込み
          setTimeout(() => {
            hideSavingModal();
            loadReservationsPhase2();
          }, 500);
        } else {
          console.error('単一行UI更新失敗:', {rowId, result});
          console.log('エラー詳細:', result ? result.error : 'レスポンスなし');
          hideSavingModal();
          showError(result ? result.error : '更新に失敗しました');
        }
      } catch (error) {
        console.error('単一行UI処理エラー:', error);
        hideSavingModal();
        showError('更新処理中にエラーが発生しました: ' + error.message);
      } finally {
        // クリーンアップ
        cleanupJSONP(callbackName);
        
        // ボタンを元に戻す
        if (originalButton) {
          originalButton.disabled = false;
          if (memo !== null) {
            const textSpan = originalButton.querySelector('.save-btn-text');
            if (textSpan) {
              textSpan.textContent = 'メモ保存';
            } else {
              originalButton.innerHTML = '📝 <span class="save-btn-text">メモ保存</span>';
            }
          }
        }
        
        // 自動保存メッセージを非表示
        if (autoSaveMessage) {
          setTimeout(() => {
            autoSaveMessage.style.display = 'none';
          }, 1000);
        }
      }
    };

    // JSONP URLを作成
    const params = new URLSearchParams({
      action: 'updateReservation',
      shop: SHOP_SECRET,
      rowId: parseInt(rowId),
      callback: callbackName,
      _t: Date.now()
    });

    if (checked !== null && checked !== undefined) {
      params.append('checked', checked ? '1' : '0');
      console.log('チェック状態送信:', checked ? '1' : '0');
    }
    if (memo !== null && memo !== undefined) {
      params.append('memo', memo);
      console.log('メモ送信:', memo);
    }
    if (staffName !== null && staffName !== undefined) {
      params.append('staffName', staffName);
      console.log('担当者名送信:', staffName);
    }

    const jsonpUrl = `${GAS_API_URL}?${params.toString()}`;
    console.log('送信URL:', jsonpUrl);

    // スクリプトタグを作成・実行
    const script = document.createElement('script');
    script.src = jsonpUrl;
    script.setAttribute('data-jsonp', 'true');
    script.setAttribute('data-callback', callbackName);
    
    // エラーハンドリング
    script.onerror = function() {
      console.error('JSONP読み込みエラー:', jsonpUrl);
      hideSavingModal();
      showError('ネットワークエラーが発生しました');
      cleanupJSONP(callbackName);
    };
    
    document.head.appendChild(script);
    
    // タイムアウト設定
    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('JSONP タイムアウト:', callbackName);
        hideSavingModal();
        showError('リクエストがタイムアウトしました');
        cleanupJSONP(callbackName);
      }
    }, 10000);
    
  } catch (error) {
    console.error('updateSingleRow エラー:', error);
    showError('更新処理初期化に失敗しました: ' + error.message);
  }
}

// Phase 2版のデータ更新関数（後方互換性のため保持）
function updateReservationPhase2(rowId, checked, memo, event, staffName) {
  console.log('=== Phase 2: データ更新開始 ===', {rowId, checked, memo, staffName});
  
  // 統合された updateReservation 関数を呼び出し
  updateReservation(rowId, checked, memo, event, staffName);
}
