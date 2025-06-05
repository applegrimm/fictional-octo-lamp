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
  
  const script = document.querySelector(`script[data-callback="${callbackName}"]`);
  if (script) {
    script.remove();
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

// 日付時刻フォーマット関数
function formatPickupDateTime(pickupDate, pickupTime) {
  try {
    console.log('日付フォーマット入力:', {pickupDate, pickupTime});
    
    // 日付をフォーマット
    let formattedDate = pickupDate;
    if (pickupDate && pickupDate.includes('-')) {
      const dateParts = pickupDate.split('-');
      if (dateParts.length === 3) {
        formattedDate = `${dateParts[0]}年${parseInt(dateParts[1])}月${parseInt(dateParts[2])}日`;
      }
    }
    
    // 時刻をフォーマット（時間のバリデーション追加）
    let formattedTime = pickupTime;
    if (pickupTime && pickupTime.includes(':')) {
      const timeParts = pickupTime.split(':');
      if (timeParts.length >= 2) {
        let hour = parseInt(timeParts[0]);
        let minute = parseInt(timeParts[1]);
        
        // 時間の範囲チェック（0-23時）
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
          formattedTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        } else {
          console.warn('無効な時刻:', {hour, minute, original: pickupTime});
          // 異常な時刻の場合は元の値をそのまま使用
          formattedTime = pickupTime;
        }
      }
    }
    
    const result = `${formattedDate} ${formattedTime}`;
    console.log('日付フォーマット結果:', result);
    return result;
  } catch (error) {
    console.warn('日付フォーマットエラー:', error);
    return `${pickupDate} ${pickupTime}`;
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
  const memo = memoInput.value.trim();
  
  updateReservationPhase2(rowId, null, memo, event, null);
}

// Phase 2: 高速更新（キャッシュ無効化 + 楽観的更新）
function updateReservationPhase2(rowId, checked, memo, event, staffName) {
  console.log('=== Phase 2 updateReservation開始 ===', {rowId, checked, memo, staffName});
  
  // キャッシュ無効化
  const cacheKey = CACHE_KEY_PREFIX + SHOP_SECRET;
  localStorage.removeItem(cacheKey);
  
  let originalButton = null;
  let autoSaveMessage = null;
  
  if (event && event.target) {
    originalButton = event.target;
    
    if (checked !== null && event.target.type === 'checkbox') {
      const orderId = event.target.id.replace('check-', '');
      autoSaveMessage = document.getElementById(`save-msg-${orderId}`);
      if (autoSaveMessage) {
        autoSaveMessage.style.display = 'inline';
      }
    }
  }
  
  try {
    if (checked !== null) {
      const currentReservation = allReservations.find(r => r.rowId === parseInt(rowId));
      if (currentReservation) {
        const sameOrderRows = allReservations
          .filter(r => r.orderId === currentReservation.orderId)
          .map(r => r.rowId);
        
        console.log('同一注文ID行一括更新:', {orderId: currentReservation.orderId, rows: sameOrderRows});
        
        updateMultipleRowsPhase2(sameOrderRows, checked, memo, staffName);
        return;
      }
    }
    
    updateSingleRowPhase2(rowId, checked, memo, originalButton, autoSaveMessage, staffName);
    
  } catch (error) {
    console.error('Update初期化エラー:', error);
    showError('更新処理の初期化に失敗しました: ' + error.message);
    
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
    
    if (autoSaveMessage) {
      autoSaveMessage.style.display = 'none';
    }
  }
}

function updateMultipleRowsPhase2(rowIds, checked, memo, staffName) {
  let completedCount = 0;
  let totalCount = rowIds.length;
  let hasError = false;

  console.log('Phase 2 複数行更新開始:', {rowIds, checked, memo, totalCount});

  rowIds.forEach((rowId, index) => {
    setTimeout(() => {
      updateSingleRowInternal(rowId, checked, memo, staffName, (success) => {
        completedCount++;
        if (!success) hasError = true;

        console.log('行更新完了:', {rowId, success, completedCount, totalCount});

        if (completedCount >= totalCount) {
          if (hasError) {
            showError('一部の更新に失敗しました');
          } else {
            console.log('全行更新完了');
          }
          // Phase 2: 高速リロード
          setTimeout(() => {
            loadReservationsPhase2();
          }, 200); // 短縮
        }
      });
    }, index * 100); // 間隔短縮
  });
}

function updateSingleRowInternal(rowId, checked, memo, staffName, callback) {
  try {
    const callbackName = 'updateCallback' + Date.now() + '_' + rowId;
    console.log('単一行更新開始:', {rowId, callbackName});

    window[callbackName] = function(result) {
      console.log('=== 単一行Response受信 ===', {rowId, result});
      
      try {
        const success = result && result.success;
        if (success) {
          console.log('単一行更新成功:', rowId);
        } else {
          console.error('単一行更新失敗:', {rowId, result});
        }
        if (callback) callback(success);
      } catch (error) {
        console.error('単一行処理エラー:', error);
        if (callback) callback(false);
      } finally {
        cleanupJSONP(callbackName);
      }
    };

    const params = new URLSearchParams({
      action: 'updateReservation',
      shop: SHOP_SECRET,
      rowId: parseInt(rowId),
      callback: callbackName,
      _t: Date.now()
    });

    if (checked !== null && checked !== undefined) {
      params.append('checked', checked ? '1' : '0');
    }
    if (memo !== null && memo !== undefined) {
      params.append('memo', memo);
    }
    if (staffName !== null && staffName !== undefined) {
      params.append('staffName', staffName);
    }

    const jsonpUrl = `${GAS_API_URL}?${params.toString()}`;

    const script = document.createElement('script');
    script.src = jsonpUrl;
    script.setAttribute('data-jsonp', 'true');
    script.setAttribute('data-callback', callbackName);

    script.onerror = function(error) {
      console.error('単一行JSONP読み込みエラー:', {rowId, error});
      if (callback) callback(false);
      cleanupJSONP(callbackName);
    };

    document.head.appendChild(script);

    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('単一行JSONP タイムアウト:', rowId);
        if (callback) callback(false);
        cleanupJSONP(callbackName);
      }
    }, 3000); // タイムアウト短縮

  } catch (error) {
    console.error('単一行更新初期化エラー:', error);
    if (callback) callback(false);
  }
}

function updateSingleRowPhase2(rowId, checked, memo, originalButton, autoSaveMessage, staffName) {
  try {
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

    window[callbackName] = function(result) {
      console.log('=== Phase 2 単一行UI Response受信 ===', {rowId, result});
      
      try {
        if (result && result.success) {
          console.log('単一行UI更新成功:', rowId);
          // Phase 2: 高速リロード
          setTimeout(() => {
            loadReservationsPhase2();
          }, 200);
        } else {
          console.error('単一行UI更新失敗:', {rowId, result});
          showError(result ? result.error : '更新に失敗しました');
        }
      } catch (error) {
        console.error('単一行UI処理エラー:', error);
        showError('更新処理中にエラーが発生しました: ' + error.message);
      } finally {
        cleanupJSONP(callbackName);
        
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
        
        if (autoSaveMessage) {
          setTimeout(() => {
            autoSaveMessage.style.display = 'none';
          }, 1000);
        }
      }
    };

    const params = new URLSearchParams({
      action: 'updateReservation',
      shop: SHOP_SECRET,
      rowId: parseInt(rowId),
      callback: callbackName,
      _t: Date.now()
    });

    if (checked !== null && checked !== undefined) {
      params.append('checked', checked ? '1' : '0');
    }
    if (memo !== null && memo !== undefined) {
      params.append('memo', memo);
    }
    if (staffName !== null && staffName !== undefined) {
      params.append('staffName', staffName);
    }

    const jsonpUrl = `${GAS_API_URL}?${params.toString()}`;

    const script = document.createElement('script');
    script.src = jsonpUrl;
    script.setAttribute('data-jsonp', 'true');
    script.setAttribute('data-callback', callbackName);

    script.onerror = function(error) {
      console.error('JSONP読み込みエラー:', {rowId, error});
      showError('ネットワークエラーが発生しました');
      cleanupJSONP(callbackName);
      
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
      
      if (autoSaveMessage) {
        autoSaveMessage.style.display = 'none';
      }
    };

    document.head.appendChild(script);

    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('JSONP タイムアウト');
        showError('リクエストがタイムアウトしました');
        cleanupJSONP(callbackName);
        
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
        
        if (autoSaveMessage) {
          autoSaveMessage.style.display = 'none';
        }
      }
    }, 5000); // タイムアウト短縮

  } catch (error) {
    console.error('更新初期化エラー:', error);
    showError('更新処理の初期化に失敗しました: ' + error.message);
    
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
    
    if (autoSaveMessage) {
      autoSaveMessage.style.display = 'none';
    }
  }
}

// ============================================
// モーダル・担当者名入力（変更なし）
// ============================================

function confirmStaffInput() {
  const staffName = document.getElementById('staff-name-input').value.trim();
  
  if (!staffName) {
    alert('担当者名を入力してください。');
    return;
  }
  
  console.log('担当者名確定:', staffName);
  
  document.getElementById('staff-modal').style.display = 'none';
  document.getElementById('staff-name-input').value = '';
  
  if (pendingToggleRowId !== null) {
    updateReservationPhase2(pendingToggleRowId, true, null, {target: pendingToggleElement}, staffName);
  }
  
  pendingToggleRowId = null;
  pendingToggleElement = null;
}

function cancelStaffInput() {
  document.getElementById('staff-modal').style.display = 'none';
  
  if (pendingToggleElement) {
    pendingToggleElement.checked = false;
  }
  
  pendingToggleRowId = null;
  pendingToggleElement = null;
}

// ============================================
// Phase 2: 過去7日間データ高速読み込み
// ============================================

function loadPast7Days() {
  console.log('=== Phase 2 過去7日間データ読み込み開始 ===');
  
  // 過去7日間専用キャッシュチェック
  const past7daysCache = localStorage.getItem(CACHE_KEY_PREFIX + SHOP_SECRET + '_past7days');
  if (past7daysCache) {
    try {
      const cacheData = JSON.parse(past7daysCache);
      if (Date.now() - cacheData.timestamp < CACHE_DURATION) {
        console.log('過去7日間キャッシュヒット');
        allReservations = cacheData.data;
        updateStats(allReservations);
        displayReservations(allReservations);
        updateFilterButtons('past7days');
        addPastReservationStyles();
        
        // バックグラウンド更新
        setTimeout(() => {
          loadPast7DaysFromGAS(true);
        }, 100);
        return;
      }
    } catch (error) {
      console.warn('過去7日間キャッシュエラー:', error);
    }
  }
  
  showLoading(true);
  hideError();
  loadPast7DaysFromGAS(false);
}

function loadPast7DaysFromGAS(isBackgroundUpdate = false) {
  try {
    const callbackName = 'past7daysCallback' + Date.now();
    
    const existingScripts = document.querySelectorAll('script[data-jsonp="true"]');
    existingScripts.forEach(script => script.remove());
    
    window[callbackName] = function(data) {
      console.log('=== Phase 2 過去7日間Response受信 ===', data);
      
      try {
        if (data && data.success) {
          console.log('過去7日間データ取得成功:', data.data.length + '件');
          allReservations = data.data || [];
          
          // 過去7日間キャッシュ保存
          const cacheData = {
            data: allReservations,
            timestamp: Date.now()
          };
          localStorage.setItem(CACHE_KEY_PREFIX + SHOP_SECRET + '_past7days', JSON.stringify(cacheData));
          
          if (data.storeName) {
            updateStoreNameHeader(data.storeName, 'past7days');
          }
          
          addPastReservationStyles();
          updateStats(allReservations);
          displayReservations(allReservations);
          updateFilterButtons('past7days');
          
        } else {
          console.error('過去7日間データ取得失敗:', data);
          if (data && data.error && data.error.includes('アクセス権限')) {
            showAuthError();
          } else {
            showError(data ? data.error : '過去7日間データの読み込みに失敗しました');
          }
        }
      } catch (error) {
        console.error('過去7日間データ処理エラー:', error);
        showError('過去7日間データの処理中にエラーが発生しました: ' + error.message);
      } finally {
        cleanupJSONP(callbackName);
        if (!isBackgroundUpdate) {
          showLoading(false);
        }
      }
    };
    
    const jsonpUrl = `${GAS_API_URL}?action=getReservations&shop=${encodeURIComponent(SHOP_SECRET)}&dateRange=past_7days&callback=${callbackName}&_t=${Date.now()}`;
    
    const script = document.createElement('script');
    script.src = jsonpUrl;
    script.setAttribute('data-jsonp', 'true');
    script.setAttribute('data-callback', callbackName);
    
    script.onerror = function(error) {
      console.error('過去7日間JSONP読み込みエラー:', error);
      showError('ネットワークエラーが発生しました。GASのURLまたはデプロイを確認してください。');
      cleanupJSONP(callbackName);
      if (!isBackgroundUpdate) {
        showLoading(false);
      }
    };
    
    document.head.appendChild(script);
    
    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('過去7日間JSONP タイムアウト');
        showError('過去7日間データのリクエストがタイムアウトしました。再度お試しください。');
        cleanupJSONP(callbackName);
        if (!isBackgroundUpdate) {
          showLoading(false);
        }
      }
    }, 8000); // タイムアウト短縮
    
  } catch (error) {
    console.error('過去7日間JSONP初期化エラー:', error);
    showError('過去7日間データの読み込み初期化に失敗しました: ' + error.message);
    if (!isBackgroundUpdate) {
      showLoading(false);
    }
  }
}

function addPastReservationStyles() {
  const existingStyle = document.getElementById('past-reservation-styles');
  if (existingStyle) {
    existingStyle.remove();
  }
  
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
// ヘルパー関数（変更なし）
// ============================================

function updateFilterButtons(activeFilter) {
  document.querySelectorAll('.controls .btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
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

function updateStoreNameHeader(storeName, mode) {
  const subtitle = document.querySelector('.header .subtitle');
  
  if (mode === 'past7days') {
    subtitle.textContent = `過去7日間の予約履歴（${storeName}）`;
  } else {
    subtitle.textContent = `本日以降の予約一覧（${storeName}）`;
  }
} 
