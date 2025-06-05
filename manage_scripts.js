/**
 * @file manage_scripts.js
 * @brief 店舗管理画面（manage.html）専用JavaScript
 * @details 予約管理、受渡し管理、メモ機能、フィルタリング機能
 * @version 1.0
 */

// ============================================
// グローバル変数・設定
// ============================================

// GitHub Pages URL: https://applegrimm.github.io/fictional-octo-lamp/
// GASのWebアプリURL（実際のURLに変更してください）
// ⚠️ 重要: 新しいデプロイを作成した場合は、以下のURLを更新してください
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwgeG189yH0YGt6gpqpYHoclCnZe4cbo8jARRaHCqjgxpiD_XW47taPqNFlQYDhfaYaCg/exec';

let SHOP_SECRET = '';
let allReservations = [];
let currentFilter = 'all';

// モーダル関連の変数
let pendingToggleRowId = null;
let pendingToggleElement = null;

// ============================================
// ユーティリティ関数
// ============================================

// 今日の日付を取得する関数
function getTodayString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;
  return todayStr;
}

// 日付を正規化する関数（様々なフォーマットに対応）
function normalizeDateString(dateStr) {
  if (!dateStr) return '';
  
  // 既にYYYY-MM-DD形式の場合
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // YYYY/MM/DD形式の場合
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) {
    return dateStr.replace(/\//g, '-');
  }
  
  // MM/DD/YYYY形式の場合
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const parts = dateStr.split('/');
    return `${parts[2]}-${parts[0]}-${parts[1]}`;
  }
  
  // その他の形式の場合はDateオブジェクトを経由して変換
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

// 本日分の予約をチェックする関数
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

// ページ読み込み時の初期化
window.addEventListener('DOMContentLoaded', function() {
  console.log('=== 管理画面読み込み開始 ===');
  
  // URLパラメータからshopを取得
  const urlParams = new URLSearchParams(window.location.search);
  SHOP_SECRET = urlParams.get('shop');
  
  console.log('Shop Secret:', SHOP_SECRET);
  console.log('GAS API URL:', GAS_API_URL);
  
  if (!SHOP_SECRET) {
    console.log('Shop Secretが見つかりません');
    showAuthError();
    return;
  }
  
  // メイン画面を表示
  document.getElementById('main-content').style.display = 'block';
  
  // 予約一覧を読み込み（JSONP方式）
  console.log('予約データ読み込み開始（JSONP方式）');
  loadReservations();
});

// 認証エラー表示
function showAuthError() {
  document.getElementById('auth-error').style.display = 'block';
  document.getElementById('main-content').style.display = 'none';
}

// ============================================
// データ読み込み・JSONP通信
// ============================================

// JSONP通信のクリーンアップ
function cleanupJSONP(callbackName) {
  // コールバック関数を削除
  if (window[callbackName]) {
    delete window[callbackName];
  }
  
  // スクリプトタグを削除
  const script = document.querySelector(`script[data-callback="${callbackName}"]`);
  if (script) {
    script.remove();
  }
}

// 予約一覧を読み込み（完全JSONP版・CORSエラー0%保証）
function loadReservations() {
  console.log('=== loadReservations開始 ===');
  showLoading(true);
  hideError();

  try {
    // JSONP方式：スクリプトタグでCORSを完全回避
    const callbackName = 'reservationCallback' + Date.now();
    console.log('JSONP Callback名:', callbackName);
    
    // 既存のスクリプトタグを削除（クリーンアップ）
    const existingScripts = document.querySelectorAll('script[data-jsonp="true"]');
    existingScripts.forEach(script => script.remove());
    
    // グローバルコールバック関数を定義
    window[callbackName] = function(data) {
      console.log('=== JSONP Response受信 ===', data);
      
      try {
        if (data && data.success) {
          console.log('予約データ取得成功:', data.data.length + '件');
          allReservations = data.data || [];
          
          // 店舗名をヘッダーに表示
          if (data.storeName) {
            updateStoreNameHeader(data.storeName, 'today_onwards');
          }
          
          // データ構造の詳細ログ
          console.log('=== 受信データ詳細 ===');
          if (allReservations.length > 0) {
            console.log('最初の予約データ:', allReservations[0]);
            console.log('全予約の受取日一覧:', allReservations.map(r => ({
              orderId: r.orderId,
              pickupDate: r.pickupDate,
              pickupTime: r.pickupTime,
              isCompleted: r.isCompleted,
              handoverStaff: r.handoverStaff
            })));
            
            // 担当者名のログ
            allReservations.forEach(r => {
              if (r.handoverStaff && r.handoverStaff.trim() !== '') {
                console.log(`注文${r.orderId}: 担当者名="${r.handoverStaff}"`);
              } else {
                console.log(`注文${r.orderId}: 担当者名なし (${typeof r.handoverStaff})`);
              }
            });
          }
          
          // 統計情報を更新
          updateStats(allReservations);
          
          // 予約一覧を表示
          displayReservations(allReservations);
          
          // フィルターボタンのアクティブ状態を更新
          updateFilterButtons('all');
          
          console.log('表示完了');
          
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
        // クリーンアップ
        cleanupJSONP(callbackName);
        showLoading(false);
      }
    };
    
    // JSONPリクエストURL作成
    const jsonpUrl = `${GAS_API_URL}?action=getReservations&shop=${encodeURIComponent(SHOP_SECRET)}&callback=${callbackName}&_t=${Date.now()}`;
    console.log('JSONP URL:', jsonpUrl);
    
    // スクリプトタグを作成
    const script = document.createElement('script');
    script.src = jsonpUrl;
    script.setAttribute('data-jsonp', 'true');
    script.setAttribute('data-callback', callbackName);
    
    // エラーハンドリング
    script.onerror = function(error) {
      console.error('JSONP読み込みエラー:', error);
      showError('ネットワークエラーが発生しました。GASのURLまたはデプロイを確認してください。');
      cleanupJSONP(callbackName);
      showLoading(false);
    };
    
    script.onload = function() {
      console.log('JSONPスクリプト読み込み完了');
    };
    
    // スクリプトタグを追加してリクエスト実行
    document.head.appendChild(script);
    
    // タイムアウト設定（10秒）
    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('JSONP タイムアウト');
        showError('リクエストがタイムアウトしました。再度お試しください。');
        cleanupJSONP(callbackName);
        showLoading(false);
      }
    }, 10000);
    
  } catch (error) {
    console.error('JSONP初期化エラー:', error);
    showError('データの読み込み初期化に失敗しました: ' + error.message);
    showLoading(false);
  }
}

// ============================================
// UI表示関数
// ============================================

// ローディング表示/非表示
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

// エラー表示
function showError(message) {
  const errorElement = document.getElementById('error-message');
  const errorText = document.getElementById('error-text');
  errorText.textContent = message;
  errorElement.style.display = 'flex';
}

// エラー非表示
function hideError() {
  const errorElement = document.getElementById('error-message');
  errorElement.style.display = 'none';
}

// 統計情報更新
function updateStats(reservations) {
  const total = reservations.length;
  const pending = reservations.filter(r => !r.isCompleted).length;
  const completed = reservations.filter(r => r.isCompleted).length;
  
  document.getElementById('total-count').textContent = total;
  document.getElementById('pending-count').textContent = pending;
  document.getElementById('completed-count').textContent = completed;
}

// 注文IDでグループ化
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

// 予約一覧表示
function displayReservations(reservations) {
  console.log('=== displayReservations開始 ===');
  console.log('表示対象件数:', reservations.length);
  
  const reservationList = document.getElementById('reservation-list');
  const noData = document.getElementById('no-data');
  
  if (reservations.length === 0) {
    reservationList.style.display = 'none';
    noData.style.display = 'block';
    return;
  }
  
  // 注文IDでグループ化
  const groupedReservations = groupByOrderId(reservations);
  console.log('グループ化後:', groupedReservations.length + 'グループ');
  
  // 受取日時でソート（最新が上）
  groupedReservations.sort((a, b) => {
    const dateA = new Date(a.pickupDate + ' ' + a.pickupTime);
    const dateB = new Date(b.pickupDate + ' ' + b.pickupTime);
    return dateB - dateA;
  });
  
  let html = '';
  
  groupedReservations.forEach((group, index) => {
    console.log(`グループ${index + 1}:`, group);
    
    const isCompleted = group.items.every(item => item.isCompleted);
    const isPending = !isCompleted;
    
    // 受取日が過去かどうかをチェック
    const today = getTodayString();
    const normalizedPickupDate = normalizeDateString(group.pickupDate);
    const isPast = normalizedPickupDate < today;
    
    console.log('日付チェック:', {
      pickupDate: group.pickupDate,
      normalizedDate: normalizedPickupDate,
      today: today,
      isPast: isPast
    });
    
    // カードのクラス設定
    let cardClass = 'reservation-card';
    if (isPast) {
      cardClass += ' past';
    } else if (isCompleted) {
      cardClass += ' completed';
    } else {
      cardClass += ' pending';
    }
    
    html += `
      <div class="${cardClass}">
        <div class="card-header">
          <div class="pickup-info">
            📅 ${group.pickupDate} ${group.pickupTime}
          </div>
        </div>
        
        <div class="customer-info">
          <div class="row">
            <span class="label">注文番号:</span>
            <span class="value">${group.orderId}</span>
          </div>
          <div class="row">
            <span class="label">お客様:</span>
            <span class="value">${group.customerName}</span>
          </div>
          <div class="row">
            <span class="label">電話番号:</span>
            <span class="value">${group.phone}</span>
          </div>
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
                <input type="checkbox" 
                       class="toggle-switch" 
                       id="check-${item.rowId}"
                       ${item.isCompleted ? 'checked' : ''}
                       onchange="toggleCompletion(${item.rowId}, this.checked, event)">
                <label for="check-${item.rowId}" class="toggle-label">
                  ${item.isCompleted ? '✅ 受渡し完了' : '⏳ 未完了'}
                  ${item.handoverStaff ? `（担当: ${item.handoverStaff}）` : ''}
                </label>
                <span id="save-msg-${item.rowId}" style="display: none; color: #27ae60; font-weight: bold; margin-left: 8px;">💾 自動保存中...</span>
              </div>
              
              <div class="memo-area">
                <input type="text" 
                       class="memo-input" 
                       id="memo-${item.rowId}"
                       value="${item.memo}"
                       placeholder="メモを入力...">
                <button class="save-btn" onclick="saveMemo(${item.rowId}, event)">
                  📝 <span class="save-btn-text">メモ保存</span>
                </button>
              </div>
            </div>
          `).join('')}
          
          <div class="total-amount">
            合計金額: ¥${group.totalAmount.toLocaleString()}
          </div>
        </div>
      </div>
    `;
  });
  
  reservationList.innerHTML = html;
  reservationList.style.display = 'block';
  noData.style.display = 'none';
  
  // 本日分の予約チェック
  checkTodayReservations();
  
  console.log('表示HTML生成完了');
}

// ============================================
// フィルタリング機能
// ============================================

// 予約フィルタリング
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
  
  // 統計更新（フィルター後のデータで）
  updateStats(filteredReservations);
  
  // 表示更新
  displayReservations(filteredReservations);
  
  // フィルターボタンのアクティブ状態を更新
  updateFilterButtons(filter);
}

// ============================================
// データ更新機能
// ============================================

// 受渡し完了状態切り替え
function toggleCompletion(rowId, checked, event) {
  console.log('=== 受渡し状態切り替え ===', {rowId, checked});
  
  if (checked) {
    // チェックONの場合は担当者名入力を要求
    pendingToggleRowId = rowId;
    pendingToggleElement = event.target;
    document.getElementById('staff-modal').style.display = 'flex';
    document.getElementById('staff-name-input').focus();
  } else {
    // チェックOFFの場合は直接更新
    updateReservation(rowId, checked, null, event, null);
  }
}

// メモ保存
function saveMemo(rowId, event) {
  console.log('=== メモ保存 ===', {rowId});
  const memoInput = document.getElementById(`memo-${rowId}`);
  const memo = memoInput.value.trim();
  
  updateReservation(rowId, null, memo, event, null);
}

// 予約データ更新（統合版）
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
    
    // メモ更新の場合は単一行のみ更新（従来通り）
    updateSingleRow(rowId, checked, memo, originalButton, autoSaveMessage, staffName);
    
  } catch (error) {
    console.error('Update初期化エラー:', error);
    showError('更新処理の初期化に失敗しました: ' + error.message);
    
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
      autoSaveMessage.style.display = 'none';
    }
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
            loadReservations();
          }, 500);
        }
      });
    }, index * 200); // 200ms間隔で順次実行
  });
}

// 単一行更新の内部関数
function updateSingleRowInternal(rowId, checked, memo, staffName, callback) {
  try {
    const callbackName = 'updateCallback' + Date.now() + '_' + rowId;
    console.log('単一行更新開始:', {rowId, callbackName});

    // グローバルコールバック関数を定義
    window[callbackName] = function(result) {
      console.log('=== 単一行Response受信 ===', {rowId, result});
      
      try {
        const success = result && result.success;
        if (success) {
          console.log('単一行更新成功:', rowId);
          console.log('サーバーレスポンス詳細:', result);
        } else {
          console.error('単一行更新失敗:', {rowId, result});
          console.log('エラー詳細:', result ? result.error : 'レスポンスなし');
        }
        if (callback) callback(success);
      } catch (error) {
        console.error('単一行処理エラー:', error);
        if (callback) callback(false);
      } finally {
        cleanupJSONP(callbackName);
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

    script.onerror = function(error) {
      console.error('単一行JSONP読み込みエラー:', {rowId, error});
      if (callback) callback(false);
      cleanupJSONP(callbackName);
    };

    document.head.appendChild(script);

    // タイムアウト設定
    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('単一行JSONP タイムアウト:', rowId);
        if (callback) callback(false);
        cleanupJSONP(callbackName);
      }
    }, 5000);

  } catch (error) {
    console.error('単一行更新初期化エラー:', error);
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
            loadReservations();
          }, 500);
        } else {
          console.error('単一行UI更新失敗:', {rowId, result});
          console.log('エラー詳細:', result ? result.error : 'レスポンスなし');
          showError(result ? result.error : '更新に失敗しました');
        }
      } catch (error) {
        console.error('単一行UI処理エラー:', error);
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

    script.onerror = function(error) {
      console.error('JSONP読み込みエラー:', {rowId, error});
      showError('ネットワークエラーが発生しました');
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
        autoSaveMessage.style.display = 'none';
      }
    };

    document.head.appendChild(script);

    // タイムアウト設定
    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('JSONP タイムアウト');
        showError('リクエストがタイムアウトしました');
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
          autoSaveMessage.style.display = 'none';
        }
      }
    }, 10000);

  } catch (error) {
    console.error('更新初期化エラー:', error);
    showError('更新処理の初期化に失敗しました: ' + error.message);
    
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
      autoSaveMessage.style.display = 'none';
    }
  }
}

// ============================================
// モーダル・担当者名入力
// ============================================

// 担当者名入力確定
function confirmStaffInput() {
  const staffName = document.getElementById('staff-name-input').value.trim();
  
  if (!staffName) {
    alert('担当者名を入力してください。');
    return;
  }
  
  console.log('担当者名確定:', staffName);
  
  // モーダルを閉じる
  document.getElementById('staff-modal').style.display = 'none';
  document.getElementById('staff-name-input').value = '';
  
  // 受渡し完了状態を更新（担当者名付き）
  if (pendingToggleRowId !== null) {
    updateReservation(pendingToggleRowId, true, null, {target: pendingToggleElement}, staffName);
  }
  
  // 変数をクリア
  pendingToggleRowId = null;
  pendingToggleElement = null;
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
}

// ============================================
// 過去7日間データ読み込み
// ============================================

// 過去7日間のデータを読み込み
function loadPast7Days() {
  console.log('=== 過去7日間データ読み込み開始 ===');
  showLoading(true);
  hideError();

  try {
    // JSONP方式：スクリプトタグでCORSを完全回避
    const callbackName = 'past7daysCallback' + Date.now();
    console.log('JSONP Callback名（過去7日間）:', callbackName);
    
    // 既存のスクリプトタグを削除（クリーンアップ）
    const existingScripts = document.querySelectorAll('script[data-jsonp="true"]');
    existingScripts.forEach(script => script.remove());
    
    // グローバルコールバック関数を定義
    window[callbackName] = function(data) {
      console.log('=== 過去7日間 JSONP Response受信 ===', data);
      
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
        // クリーンアップ
        cleanupJSONP(callbackName);
        showLoading(false);
      }
    };
    
    // JSONPリクエストURL作成（dateRange=past_7daysパラメータを追加）
    const jsonpUrl = `${GAS_API_URL}?action=getReservations&shop=${encodeURIComponent(SHOP_SECRET)}&dateRange=past_7days&callback=${callbackName}&_t=${Date.now()}`;
    console.log('過去7日間 JSONP URL:', jsonpUrl);
    
    // スクリプトタグを作成
    const script = document.createElement('script');
    script.src = jsonpUrl;
    script.setAttribute('data-jsonp', 'true');
    script.setAttribute('data-callback', callbackName);
    
    // エラーハンドリング
    script.onerror = function(error) {
      console.error('過去7日間 JSONP読み込みエラー:', error);
      showError('ネットワークエラーが発生しました。GASのURLまたはデプロイを確認してください。');
      cleanupJSONP(callbackName);
      showLoading(false);
    };
    
    script.onload = function() {
      console.log('過去7日間 JSONPスクリプト読み込み完了');
    };
    
    // スクリプトタグを追加してリクエスト実行
    document.head.appendChild(script);
    
    // タイムアウト設定（10秒）
    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('過去7日間 JSONP タイムアウト');
        showError('過去7日間データのリクエストがタイムアウトしました。再度お試しください。');
        cleanupJSONP(callbackName);
        showLoading(false);
      }
    }, 10000);
    
  } catch (error) {
    console.error('過去7日間 JSONP初期化エラー:', error);
    showError('過去7日間データの読み込み初期化に失敗しました: ' + error.message);
    showLoading(false);
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
// ヘルパー関数
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