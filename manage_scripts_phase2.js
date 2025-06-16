/**
 * @file manage_scripts_phase2.js
 * @brief 店舗管理画面（manage.html）Phase2高速化版JavaScript
 * @details GAS通信高速化：並列処理、キャッシュ、差分更新
 * @version 2.0 - Phase 2: GAS通信高速化
 */

// ============================================
// グローバル変数・設定
// ============================================

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwgeG189yH0YGt6gpqpYHoclCnZe4cbo8jARRaHCqjgxpiD_XW47taPqNFlQYDhfaYaCg/exec';

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
  
  console.log('Shop Secret:', SHOP_SECRET);
  console.log('GAS API URL:', GAS_API_URL);
  
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

// GASからデータを読み込み
function loadReservationsFromGAS(isBackgroundUpdate = false) {
  console.log('=== GASからデータ読み込み ===', {isBackgroundUpdate});
  
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
      console.log('=== JSONP Response受信 ===', data);
      
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
          if (data && data.error && data.error.includes('アクセス権限')) {
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
    
    const jsonpUrl = `${GAS_API_URL}?action=getReservations&shop=${encodeURIComponent(SHOP_SECRET)}&callback=${callbackName}&_t=${Date.now()}`;
    console.log('JSONP URL:', jsonpUrl);
    
    const script = document.createElement('script');
    script.src = jsonpUrl;
    script.setAttribute('data-jsonp', 'true');
    script.setAttribute('data-callback', callbackName);
    
    script.onerror = function(error) {
      console.error('JSONP読み込みエラー:', error);
      showError('ネットワークエラーが発生しました。GASのURLまたはデプロイを確認してください。');
      cleanupJSONP(callbackName);
      if (!isBackgroundUpdate) {
        showLoading(false);
      }
    };
    
    script.onload = function() {
      console.log('JSONPスクリプト読み込み完了');
    };
    
    document.head.appendChild(script);
    
    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('JSONP タイムアウト');
        showError('リクエストがタイムアウトしました。再度お試しください。');
        cleanupJSONP(callbackName);
        if (!isBackgroundUpdate) {
          showLoading(false);
        }
      }
    }, 10000);
    
  } catch (error) {
    console.error('JSONP初期化エラー:', error);
    showError('データの読み込み初期化に失敗しました: ' + error.message);
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
            <a href="tel:${customer.phone}" class="phone-link">${customer.phone}</a>
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
              <input type="checkbox" id="check-${group.orderId}" ${isCompleted ? 'checked' : ''} 
                     onchange="handleToggleChange('${group.items[0].rowId}', this)">
              <span class="toggle-slider"></span>
            </label>
            <label for="check-${group.orderId}" class="toggle-label">受渡完了</label>
            ${customer.handoverStaff ? `<span style="color: #666; font-size: 0.9em; margin-left: 8px;">担当: ${escapeHtml(customer.handoverStaff)}</span>` : ''}
            <span class="auto-save-message" id="save-msg-${group.orderId}" style="display: none; color: #27ae60; font-size: 0.9em; margin-left: 8px;">自動保存中...</span>
          </div>
          
          <div class="memo-area">
            <input type="text" class="memo-input" id="memo-${group.orderId}" 
                   value="${escapeHtml(customer.memo || '')}" placeholder="スタッフメモを入力..." maxlength="200">
            <button class="save-btn" onclick="updateReservationPhase2('${group.items[0].rowId}', null, document.getElementById('memo-${group.orderId}').value)">
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
    // チェックOFFの場合は直接更新
    updateReservationPhase2(rowId, checked, null, {target: toggleElement}, null);
  }
}

function saveMemo(rowId, event) {
  console.log('=== メモ保存 ===', {rowId});
  const memoInput = document.getElementById(`memo-${rowId}`);
  const memo = memoInput ? memoInput.value : '';
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
