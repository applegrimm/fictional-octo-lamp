/**
 * @file stripe-config.js
 * @brief Stripe決済設定ファイル
 * @details Stripe Checkout機能の設定と制御を行う
 */

// Stripe設定
const STRIPE_CONFIG = {
  // 🔑 Stripe公開鍵（テスト用）
  // 本番運用時は pk_live_... に変更してください
  PUBLISHABLE_KEY: 'pk_test_51RVBoUIjwFiP4bNCKXNfgzkwTnmAfRnX4cNFwDVZeO4PewRHOE7Fq7OgjvtbJpWJod7NlQOLROtRZfU0hLRElngH00k1okQ7wq',
  
  // 💰 決済設定
  CURRENCY: 'jpy',
  MODE: 'payment', // one-time payment
  
  // 🛡️ セキュリティ設定
  ALLOW_PROMOTION_CODES: false,
  BILLING_ADDRESS_COLLECTION: 'auto',
  
  // 🌐 リダイレクトURL（GitHub Pages用の正しいURL）
  get SUCCESS_URL() {
    return 'https://applegrimm.github.io/fictional-octo-lamp/success.html?session_id={CHECKOUT_SESSION_ID}&data={RESERVATION_DATA}';
  },
  
  get CANCEL_URL() {
    return 'https://applegrimm.github.io/fictional-octo-lamp/cancel.html?error={ERROR_MESSAGE}';
  },
  
  // 📱 モバイル対応
  MOBILE_OPTIMIZED: true
};

/**
 * Stripe Checkout設定の表示切り替え
 * テスト環境と本番環境の識別
 */
const PAYMENT_MODES = {
  TEST: 'test',
  LIVE: 'live',
  DISABLED: 'disabled'
};

// 現在のモード（本番運用時は LIVE に変更）
const CURRENT_PAYMENT_MODE = PAYMENT_MODES.TEST;

/**
 * 決済機能の有効性をチェック
 * @return {boolean} 決済機能が利用可能かどうか
 */
function isPaymentEnabled() {
  return CURRENT_PAYMENT_MODE !== PAYMENT_MODES.DISABLED;
}

/**
 * テスト環境かどうかをチェック
 * @return {boolean} テスト環境かどうか
 */
function isTestMode() {
  return CURRENT_PAYMENT_MODE === PAYMENT_MODES.TEST;
}

/**
 * Stripe Checkoutセッション作成データの構築
 * @param {Object} orderData - 注文データ
 * @return {Object} Stripe Checkout用のデータ
 */
function buildCheckoutData(orderData) {
  // 合計金額を計算
  const totalAmount = orderData.items.reduce((sum, item) => {
    return sum + (item.price * item.qty);
  }, 0);
  
  // 商品リストを作成（Stripe用）
  const lineItems = [{
    price_data: {
      currency: STRIPE_CONFIG.CURRENCY,
      product_data: {
        name: `テイクアウト予約 - ${orderData.store}`,
        description: generateOrderSummary(orderData),
        images: [] // 商品画像があれば追加
      },
      unit_amount: totalAmount // 日本円なので100倍不要
    },
    quantity: 1
  }];
  
  // 予約データをBase64エンコード（success.htmlで復元用）
  const encodedReservationData = btoa(encodeURIComponent(JSON.stringify(orderData)));
  
  // success_urlを構築
  const successUrl = `https://applegrimm.github.io/fictional-octo-lamp/success.html?session_id={CHECKOUT_SESSION_ID}&data=${encodedReservationData}`;
  console.log('構築されたsuccess_url:', successUrl);
  console.log('エンコードされた予約データ長:', encodedReservationData.length);
  
  return {
    payment_method_types: ['card'],
    line_items: lineItems,
    mode: STRIPE_CONFIG.MODE,
    success_url: successUrl,
    cancel_url: STRIPE_CONFIG.CANCEL_URL.replace('{ERROR_MESSAGE}', encodeURIComponent('決済がキャンセルされました')),
    customer_email: orderData.email,
    
    // 追加のメタデータ
    metadata: {
      customer_name: orderData.name,
      customer_phone: orderData.phone,
      pickup_store: orderData.store,
      pickup_date: orderData.pickup_date,
      pickup_time: orderData.pickup_time,
      order_summary: generateOrderSummary(orderData),
      total_amount: totalAmount.toString()
    },
    
    // 請求先住所の収集
    billing_address_collection: STRIPE_CONFIG.BILLING_ADDRESS_COLLECTION,
    
    // プロモーションコード
    allow_promotion_codes: STRIPE_CONFIG.ALLOW_PROMOTION_CODES
  };
}

/**
 * 注文内容の概要を生成
 * @param {Object} orderData - 注文データ
 * @return {string} 注文概要
 */
function generateOrderSummary(orderData) {
  const items = orderData.items.map(item => 
    `${item.name} x${item.qty}`
  ).join(', ');
  
  return `${items} (受取: ${orderData.pickup_date} ${orderData.pickup_time})`;
}

/**
 * 決済金額の表示用フォーマット
 * @param {number} amount - 金額
 * @return {string} フォーマットされた金額文字列
 */
function formatAmount(amount) {
  return amount.toLocaleString('ja-JP') + '円';
}

/**
 * Stripe Checkoutの開始
 * @param {Object} orderData - 注文データ
 * @return {Promise<void>}
 */
async function startStripeCheckout(orderData) {
  try {
    console.log('Stripe Checkout開始:', orderData);
    
    // 決済機能が無効の場合はエラー
    if (!isPaymentEnabled()) {
      throw new Error('決済機能は現在無効になっています。通常の予約をご利用ください。');
    }
    
    // 合計金額を計算して表示
    const totalAmount = orderData.items.reduce((sum, item) => {
      return sum + (item.price * item.qty);
    }, 0);
    
    console.log('合計金額:', formatAmount(totalAmount));
    
    // テストモードの警告表示
    if (isTestMode()) {
      const confirmed = confirm(
        `⚠️ テストモードで決済を行います\n\n` +
        `合計金額: ${formatAmount(totalAmount)}\n` +
        `※実際の課金は発生しません\n\n` +
        `決済画面に進みますか？`
      );
      
      if (!confirmed) {
        return;
      }
    }
    
    // Stripe Checkoutセッションの作成データ
    const checkoutData = buildCheckoutData(orderData);
    
    console.log('Checkout作成データ:', checkoutData);
    
    // GASにCheckoutセッション作成を依頼
    const response = await createCheckoutSession(checkoutData);
    
    if (response && response.success && response.url) {
      console.log('Checkout URL取得成功:', response.url);
      
      // Stripe Checkoutページにリダイレクト
      window.location.href = response.url;
      
    } else {
      throw new Error(response ? response.error : 'Checkoutセッションの作成に失敗しました');
    }
    
  } catch (error) {
    console.error('Stripe Checkout開始エラー:', error);
    
    // エラーメッセージを表示
    alert(`決済の開始に失敗しました:\n${error.message}\n\n通常の予約をご利用いただくか、しばらく時間を置いてから再度お試しください。`);
    
    throw error;
  }
}

/**
 * GASにCheckoutセッション作成を依頼
 * @param {Object} checkoutData - Checkout作成データ
 * @return {Promise<Object>} GASからの応答
 */
async function createCheckoutSession(checkoutData) {
  return new Promise((resolve, reject) => {
    try {
      console.log('GASにCheckoutセッション作成依頼');
      
      const callbackName = 'checkoutCallback' + Date.now();
      
      // グローバルコールバック関数を定義
      window[callbackName] = function(result) {
        console.log('Checkout作成応答:', result);
        
        try {
          if (typeof result === 'string') {
            result = JSON.parse(result);
          }
          resolve(result);
        } catch (error) {
          reject(new Error('応答の解析に失敗しました'));
        } finally {
          cleanup();
        }
      };
      
      // クリーンアップ関数
      const cleanup = () => {
        const script = document.querySelector(`script[data-callback="${callbackName}"]`);
        if (script && script.parentNode) {
          script.parentNode.removeChild(script);
        }
        if (window[callbackName]) {
          delete window[callbackName];
        }
      };
      
      // データをエンコード
      const jsonString = JSON.stringify(checkoutData);
      const encodedData = btoa(encodeURIComponent(jsonString));
      
      // GAS WebアプリURL（index.htmlと同じ）
      const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwgeG189yH0YGt6gpqpYHoclCnZe4cbo8jARRaHCqjgxpiD_XW47taPqNFlQYDhfaYaCg/exec';
      
      // JSONPリクエストURL作成
      const jsonpUrl = `${GAS_WEB_APP_URL}?action=createCheckoutSession&data=${encodedData}&callback=${callbackName}&_t=${Date.now()}`;
      
      console.log('Checkout JSONP URL:', jsonpUrl.substring(0, 200) + '...');
      
      // スクリプトタグを作成
      const script = document.createElement('script');
      script.src = jsonpUrl;
      script.setAttribute('data-callback', callbackName);
      
      script.onerror = function(error) {
        console.error('Checkout JSONP読み込みエラー:', error);
        cleanup();
        reject(new Error('サーバーとの通信に失敗しました'));
      };
      
      document.head.appendChild(script);
      
      // タイムアウト設定（20秒）
      setTimeout(() => {
        if (window[callbackName]) {
          cleanup();
          reject(new Error('Checkoutセッション作成がタイムアウトしました'));
        }
      }, 20000);
      
    } catch (error) {
      reject(error);
    }
  });
}

// Stripe設定をグローバルに公開
window.STRIPE_CONFIG = STRIPE_CONFIG;
window.PAYMENT_MODES = PAYMENT_MODES;
window.CURRENT_PAYMENT_MODE = CURRENT_PAYMENT_MODE;
window.isPaymentEnabled = isPaymentEnabled;
window.isTestMode = isTestMode;
window.startStripeCheckout = startStripeCheckout;
window.formatAmount = formatAmount; 
