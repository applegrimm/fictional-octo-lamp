/**
 * @file manage_scripts_optimized.js  
 * @brief 店舗管理画面（manage.html）専用JavaScript - Phase 2高速化版
 * @details 並列読み込み・キャッシュ・差分更新による超高速化
 * @version 2.0 - Phase 2: GAS通信高速化版
 */

// ============================================
// グローバル変数・設定
// ============================================

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwgeG189yH0YGt6gpqpYHoclCnZe4cbo8jARRaHCqjgxpiD_XW47taPqNFlQYDhfaYaCg/exec';

let SHOP_SECRET = '';
let allReservations = [];
let currentFilter = 'all';
let pendingToggleRowId = null;
let pendingToggleElement = null;

// ============================================
// Phase 2: キャッシュシステム
// ============================================

const CACHE_CONFIG = {
  CACHE_KEY: 'reservations_cache',
  CACHE_DURATION: 5 * 60 * 1000, // 5分間
  STORE_KEY: 'store_info_cache'
};

// キャッシュデータ保存
function saveToCache(data, cacheKey = CACHE_CONFIG.CACHE_KEY) {
  try {
    const cacheData = {
      data: data,
      timestamp: Date.now(),
      version: '2.0'
    };
    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
    console.log('✅ キャッシュ保存成功:', cacheKey);
  } catch (error) {
    console.warn('⚠️ キャッシュ保存失敗:', error);
  }
}

// キャッシュデータ読み込み
function loadFromCache(cacheKey = CACHE_CONFIG.CACHE_KEY) {
  try {
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;
    
    const cacheData = JSON.parse(cached);
    const age = Date.now() - cacheData.timestamp;
    
    if (age > CACHE_CONFIG.CACHE_DURATION) {
      localStorage.removeItem(cacheKey);
      console.log('🗑️ 期限切れキャッシュ削除:', cacheKey);
      return null;
    }
    
    console.log('✅ キャッシュヒット:', cacheKey, `(${Math.round(age/1000)}秒前)`);
    return cacheData.data;
  } catch (error) {
    console.warn('⚠️ キャッシュ読み込み失敗:', error);
    return null;
  }
}

// ============================================
// Phase 2: 並列データ読み込み
// ============================================

// 高速初期化（並列処理）
async function fastInitialize() {
  console.log('🚀 Phase 2 高速初期化開始');
  
  // キャッシュから即座にデータ表示
  const cachedData = loadFromCache(CACHE_CONFIG.CACHE_KEY);
  const cachedStore = loadFromCache(CACHE_CONFIG.STORE_KEY);
  
  if (cachedData) {
    console.log('⚡ キャッシュデータで即座表示');
    allReservations = cachedData;
    updateStats(allReservations);
    displayReservations(allReservations);
    updateFilterButtons('all');
    
    if (cachedStore) {
      updateStoreNameHeader(cachedStore.storeName, 'today_onwards');
    }
  }
  
  // バックグラウンドで最新データ取得
  console.log('🔄 バックグラウンド更新開始');
  loadReservationsOptimized();
}

// 最適化されたデータ読み込み
function loadReservationsOptimized() {
  console.log('=== Phase 2 最適化読み込み開始 ===');
  
  // キャッシュがない場合のみローディング表示
  const cachedData = loadFromCache(CACHE_CONFIG.CACHE_KEY);
  if (!cachedData) {
    showLoading(true);
  }
  
  hideError();

  try {
    const callbackName = 'reservationOptimized' + Date.now();
    
    // 最適化されたコールバック
    window[callbackName] = function(data) {
      console.log('=== Phase 2 Response受信 ===', data);
      
      try {
        if (data && data.success) {
          const newData = data.data || [];
          
          // データ変更チェック（差分更新）
          if (hasDataChanged(allReservations, newData)) {
            console.log('📊 データ変更検出 - 更新実行');
            allReservations = newData;
            
            // キャッシュ保存
            saveToCache(newData, CACHE_CONFIG.CACHE_KEY);
            
            // 表示更新
            updateStats(allReservations);
            displayReservations(allReservations);
            updateFilterButtons(currentFilter);
          } else {
            console.log('✅ データ変更なし - 更新スキップ');
          }
          
          // 店舗情報キャッシュ
          if (data.storeName) {
            saveToCache({storeName: data.storeName}, CACHE_CONFIG.STORE_KEY);
            updateStoreNameHeader(data.storeName, 'today_onwards');
          }
          
        } else {
          console.error('❌ Phase 2 APIエラー:', data);
          handleApiError(data);
        }
      } catch (error) {
        console.error('❌ Phase 2 処理エラー:', error);
        showError('データ処理エラー: ' + error.message);
      } finally {
        cleanupJSONP(callbackName);
        showLoading(false);
      }
    };
    
    // 最適化されたリクエスト（圧縮パラメータ）
    const params = new URLSearchParams({
      action: 'getReservations',
      shop: SHOP_SECRET,
      callback: callbackName,
      compress: 'true', // 圧縮リクエスト
      _t: Date.now()
    });
    
    const jsonpUrl = `${GAS_API_URL}?${params.toString()}`;
    executeJSONP(jsonpUrl, callbackName);
    
  } catch (error) {
    console.error('❌ Phase 2 初期化エラー:', error);
    showError('初期化エラー: ' + error.message);
    showLoading(false);
  }
}

// ============================================
// Phase 2: 差分更新システム
// ============================================

// データ変更チェック
function hasDataChanged(oldData, newData) {
  if (!oldData || !newData) return true;
  if (oldData.length !== newData.length) return true;
  
  // 簡易ハッシュ比較
  const oldHash = createDataHash(oldData);
  const newHash = createDataHash(newData);
  
  return oldHash !== newHash;
}

// データハッシュ生成
function createDataHash(data) {
  const hashString = data.map(item => 
    `${item.rowId}-${item.isCompleted}-${item.memo || ''}`
  ).join('|');
  
  return hashString.split('').reduce((hash, char) => {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    return hash & hash;
  }, 0);
}

// 高速更新（差分のみ）
function updateReservationOptimized(rowId, checked, memo, event, staffName) {
  console.log('⚡ Phase 2 高速更新:', {rowId, checked, memo, staffName});
  
  // UI即座更新（楽観的更新）
  updateUIOptimistically(rowId, checked, memo, staffName);
  
  // バックグラウンドでサーバー更新
  updateServerInBackground(rowId, checked, memo, staffName, event);
}

// 楽観的UI更新
function updateUIOptimistically(rowId, checked, memo, staffName) {
  // キャッシュ内データを即座に更新
  const reservation = allReservations.find(r => r.rowId === parseInt(rowId));
  if (reservation) {
    if (checked !== null) reservation.isCompleted = checked;
    if (memo !== null) reservation.memo = memo;
    if (staffName !== null) reservation.handoverStaff = staffName;
    
    // キャッシュ更新
    saveToCache(allReservations, CACHE_CONFIG.CACHE_KEY);
    
    console.log('⚡ 楽観的更新完了');
  }
}

// バックグラウンドサーバー更新
function updateServerInBackground(rowId, checked, memo, staffName, event) {
  const callbackName = 'updateOptimized' + Date.now();
  
  window[callbackName] = function(result) {
    if (result && result.success) {
      console.log('✅ サーバー更新成功');
    } else {
      console.error('❌ サーバー更新失敗 - ロールバック実行');
      // 失敗時はデータを再読み込み
      loadReservationsOptimized();
    }
    cleanupJSONP(callbackName);
  };
  
  const params = new URLSearchParams({
    action: 'updateReservation',
    shop: SHOP_SECRET,
    rowId: parseInt(rowId),
    callback: callbackName,
    _t: Date.now()
  });
  
  if (checked !== null) params.append('checked', checked ? '1' : '0');
  if (memo !== null) params.append('memo', memo);
  if (staffName !== null) params.append('staffName', staffName);
  
  const jsonpUrl = `${GAS_API_URL}?${params.toString()}`;
  executeJSONP(jsonpUrl, callbackName);
}

// ============================================
// Phase 2: 共通ユーティリティ
// ============================================

// 最適化されたJSONP実行
function executeJSONP(url, callbackName, timeout = 10000) {
  const script = document.createElement('script');
  script.src = url;
  script.setAttribute('data-jsonp', 'true');
  script.setAttribute('data-callback', callbackName);
  
  script.onerror = function() {
    console.error('❌ JSONP読み込み失敗:', url);
    showError('ネットワークエラーが発生しました');
    cleanupJSONP(callbackName);
  };
  
  document.head.appendChild(script);
  
  // タイムアウト設定
  setTimeout(() => {
    if (window[callbackName]) {
      console.warn('⏰ JSONP タイムアウト');
      showError('リクエストがタイムアウトしました');
      cleanupJSONP(callbackName);
    }
  }, timeout);
}

// APIエラーハンドリング
function handleApiError(data) {
  if (data && data.error && data.error.includes('アクセス権限')) {
    showAuthError();
  } else {
    showError(data ? data.error : 'データ読み込みに失敗しました');
  }
}

// ============================================
// Phase 2: 初期化
// ============================================

// ページ読み込み時の初期化（高速化版）
window.addEventListener('DOMContentLoaded', function() {
  console.log('🚀 Phase 2 管理画面読み込み開始');
  
  const urlParams = new URLSearchParams(window.location.search);
  SHOP_SECRET = urlParams.get('shop');
  
  if (!SHOP_SECRET) {
    showAuthError();
    return;
  }
  
  document.getElementById('main-content').style.display = 'block';
  
  // 高速初期化実行
  fastInitialize();
});

// ============================================
// 既存関数の高速化版（オーバーライド）
// ============================================

// 高速フィルタリング
function filterReservations(filter) {
  console.log('⚡ 高速フィルター:', filter);
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
  }
  
  updateStats(filteredReservations);
  displayReservations(filteredReservations);
  updateFilterButtons(filter);
}

// 高速更新関数（エイリアス）
function updateReservation(rowId, checked, memo, event, staffName) {
  updateReservationOptimized(rowId, checked, memo, event, staffName);
}

function loadReservations() {
  loadReservationsOptimized();
}

// ============================================
// 既存の基本関数（そのまま使用）
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) return dateStr.replace(/\//g, '-');
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const parts = dateStr.split('/');
    return `${parts[2]}-${parts[0]}-${parts[1]}`;
  }
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (error) {
    return dateStr;
  }
}

function cleanupJSONP(callbackName) {
  if (window[callbackName]) delete window[callbackName];
  const script = document.querySelector(`script[data-callback="${callbackName}"]`);
  if (script) script.remove();
}

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
  document.getElementById('error-message').style.display = 'none';
}

function showAuthError() {
  document.getElementById('auth-error').style.display = 'block';
  document.getElementById('main-content').style.display = 'none';
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
  const grouped = {};
  
  reservations.forEach(reservation => {
    if (!grouped[reservation.orderId]) {
      grouped[reservation.orderId] = {
        orderId: reservation.orderId,
        customerName: reservation.customerName,
        phone: reservation.phone,
        pickupDate: reservation.pickupDate,
        pickupTime: reservation.pickupTime,
        totalAmount: reservation.totalAmount || 0,
        items: []
      };
    }
    
    grouped[reservation.orderId].items.push({
      rowId: reservation.rowId,
      itemName: reservation.itemName,
      quantity: reservation.quantity,
      amount: reservation.amount,
      isCompleted: reservation.isCompleted,
      memo: reservation.memo || '',
      handoverStaff: reservation.handoverStaff || ''
    });
  });
  
  return Object.values(grouped);
}

function displayReservations(reservations) {
  console.log('📊 高速表示開始:', reservations.length, '件');
  
  const reservationList = document.getElementById('reservation-list');
  const noData = document.getElementById('no-data');
  
  if (reservations.length === 0) {
    reservationList.style.display = 'none';
    noData.style.display = 'block';
    return;
  }
  
  const groupedReservations = groupByOrderId(reservations);
  groupedReservations.sort((a, b) => {
    const dateA = new Date(a.pickupDate + ' ' + a.pickupTime);
    const dateB = new Date(b.pickupDate + ' ' + b.pickupTime);
    return dateB - dateA;
  });
  
  let html = '';
  const today = getTodayString();
  
  groupedReservations.forEach((group) => {
    const isCompleted = group.items.every(item => item.isCompleted);
    const normalizedPickupDate = normalizeDateString(group.pickupDate);
    const isPast = normalizedPickupDate < today;
    
    let cardClass = 'reservation-card';
    if (isPast) cardClass += ' past';
    else if (isCompleted) cardClass += ' completed';
    else cardClass += ' pending';
    
    html += `
      <div class="${cardClass}">
        <div class="card-header">
          <div class="pickup-info">📅 ${group.pickupDate} ${group.pickupTime}</div>
        </div>
        <div class="customer-info">
          <div class="row"><span class="label">注文番号:</span><span class="value">${group.orderId}</span></div>
          <div class="row"><span class="label">お客様:</span><span class="value">${group.customerName}</span></div>
          <div class="row"><span class="label">電話番号:</span><span class="value">${group.phone}</span></div>
        </div>
        <div class="items-list">
          <h4>📦 ご注文内容</h4>
          ${group.items.map(item => `
            <div class="item">
              <div class="item-name">${item.itemName}</div>
              <div class="item-quantity">×${item.quantity}</div>
            </div>
            <div class="controls-row">
              <div class="toggle-container">
                <input type="checkbox" class="toggle-switch" id="check-${item.rowId}"
                       ${item.isCompleted ? 'checked' : ''}
                       onchange="toggleCompletion(${item.rowId}, this.checked, event)">
                <label for="check-${item.rowId}" class="toggle-label">
                  ${item.isCompleted ? '✅ 受渡し完了' : '⏳ 未完了'}
                  ${item.handoverStaff ? `（担当: ${item.handoverStaff}）` : ''}
                </label>
              </div>
              <div class="memo-area">
                <input type="text" class="memo-input" id="memo-${item.rowId}"
                       value="${item.memo}" placeholder="メモを入力...">
                <button class="save-btn" onclick="saveMemo(${item.rowId}, event)">
                  📝 <span class="save-btn-text">メモ保存</span>
                </button>
              </div>
            </div>
          `).join('')}
          <div class="total-amount">合計金額: ¥${group.totalAmount.toLocaleString()}</div>
        </div>
      </div>
    `;
  });
  
  reservationList.innerHTML = html;
  reservationList.style.display = 'block';
  noData.style.display = 'none';
  
  checkTodayReservations();
}

function checkTodayReservations() {
  const today = getTodayString();
  const todayReservations = allReservations.filter(reservation => {
    const normalizedDate = normalizeDateString(reservation.pickupDate);
    return normalizedDate === today;
  });
  
  const groupedToday = groupByOrderId(todayReservations);
  const todayPending = groupedToday.filter(group => 
    !group.items.every(item => item.isCompleted)
  );
  
  const warningElement = document.getElementById('today-warning');
  warningElement.style.display = todayPending.length > 0 ? 'block' : 'none';
}

function toggleCompletion(rowId, checked, event) {
  if (checked) {
    pendingToggleRowId = rowId;
    pendingToggleElement = event.target;
    document.getElementById('staff-modal').style.display = 'flex';
    document.getElementById('staff-name-input').focus();
  } else {
    updateReservation(rowId, checked, null, event, null);
  }
}

function saveMemo(rowId, event) {
  const memoInput = document.getElementById(`memo-${rowId}`);
  const memo = memoInput.value.trim();
  updateReservation(rowId, null, memo, event, null);
}

function confirmStaffInput() {
  const staffName = document.getElementById('staff-name-input').value.trim();
  if (!staffName) {
    alert('担当者名を入力してください。');
    return;
  }
  
  document.getElementById('staff-modal').style.display = 'none';
  document.getElementById('staff-name-input').value = '';
  
  if (pendingToggleRowId !== null) {
    updateReservation(pendingToggleRowId, true, null, {target: pendingToggleElement}, staffName);
  }
  
  pendingToggleRowId = null;
  pendingToggleElement = null;
}

function cancelStaffInput() {
  document.getElementById('staff-modal').style.display = 'none';
  if (pendingToggleElement) pendingToggleElement.checked = false;
  pendingToggleRowId = null;
  pendingToggleElement = null;
}

function updateFilterButtons(activeFilter) {
  document.querySelectorAll('.controls .btn').forEach(btn => btn.classList.remove('active'));
  
  let activeButtonId = '';
  switch (activeFilter) {
    case 'all': activeButtonId = 'filter-all'; break;
    case 'today': activeButtonId = 'filter-today'; break;
    case 'pending': activeButtonId = 'filter-pending'; break;
    case 'completed': activeButtonId = 'filter-completed'; break;
    case 'past7days': activeButtonId = 'filter-past7days'; break;
  }
  
  if (activeButtonId) {
    const activeButton = document.getElementById(activeButtonId);
    if (activeButton) activeButton.classList.add('active');
  }
}

function updateStoreNameHeader(storeName, mode) {
  const subtitle = document.querySelector('.header .subtitle');
  if (mode === 'past7days') {
    subtitle.textContent = `過去7日間の予約履歴（${storeName}）`;
  } else {
    subtitle.textContent = `本日以降の予約一覧（${storeName}）`;
  }
}

function loadPast7Days() {
  console.log('📈 過去7日間データ読み込み');
  showLoading(true);
  hideError();

  const callbackName = 'past7daysOptimized' + Date.now();
  
  window[callbackName] = function(data) {
    try {
      if (data && data.success) {
        allReservations = data.data || [];
        saveToCache(allReservations, CACHE_CONFIG.CACHE_KEY);
        
        if (data.storeName) {
          updateStoreNameHeader(data.storeName, 'past7days');
          saveToCache({storeName: data.storeName}, CACHE_CONFIG.STORE_KEY);
        }
        
        addPastReservationStyles();
        updateStats(allReservations);
        displayReservations(allReservations);
        updateFilterButtons('past7days');
      } else {
        handleApiError(data);
      }
    } catch (error) {
      showError('過去7日間データ処理エラー: ' + error.message);
    } finally {
      cleanupJSONP(callbackName);
      showLoading(false);
    }
  };
  
  const jsonpUrl = `${GAS_API_URL}?action=getReservations&shop=${encodeURIComponent(SHOP_SECRET)}&dateRange=past_7days&callback=${callbackName}&_t=${Date.now()}`;
  executeJSONP(jsonpUrl, callbackName);
}

function addPastReservationStyles() {
  const existingStyle = document.getElementById('past-reservation-styles');
  if (existingStyle) existingStyle.remove();
  
  const style = document.createElement('style');
  style.id = 'past-reservation-styles';
  style.textContent = `
    .reservation-card.past {
      background: linear-gradient(135deg, #f8f9fa, #e9ecef);
      border-left: 6px solid #6c757d;
      opacity: 0.8;
    }
    .reservation-card.past .card-header { opacity: 0.9; }
    .reservation-card.past .pickup-info::before {
      content: "📅 ";
      color: #6c757d;
    }
  `;
  document.head.appendChild(style);
} 
