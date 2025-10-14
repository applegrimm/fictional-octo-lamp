/**
 * @file stripe-config.js
 * @brief Stripe決済設定ファイル
 * @details Stripe Checkout機能の設定と制御を行う
 * @version 2.1.0 - 金額100倍問題修正版 (2024/12/20)
 */

console.log('🔧 stripe-config.js v2.1.0 読み込み開始 (金額100倍問題修正版)');

// 重複読み込み防止
if (window.STRIPE_CONFIG) {
  console.log('⚠️ STRIPE_CONFIG既に読み込み済み - 重複読み込みをスキップ');
} else {
  // Stripe設定
  window.STRIPE_CONFIG = {
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
  console.log('=== Checkout データ構築開始 ===');
  console.log('入力 orderData:', orderData);
  
  // 合計金額を計算
  const totalAmount = orderData.items.reduce((sum, item) => {
    const itemTotal = item.price * item.qty;
    console.log(`商品: ${item.name} - ${item.price}円 × ${item.qty}個 = ${itemTotal}円`);
    return sum + itemTotal;
  }, 0);
  
  console.log('計算された合計金額:', totalAmount);
  
  // 日本円（JPY）の場合はセント単位への変換は不要
  // JPYは最小通貨単位が1円なので、そのまま使用する
  const stripeAmountForJPY = Math.round(totalAmount);
  console.log('Stripe金額（JPY）:', stripeAmountForJPY);
  
  // デバッグ：送信前の最終チェック
  console.log('=== 重要：最終金額チェック ===');
  console.log('元の合計金額（円）:', totalAmount);
  console.log('Stripeに送信する金額:', stripeAmountForJPY);
  console.log('100倍チェック:', stripeAmountForJPY === totalAmount * 100 ? '❌ 100倍になっています！' : '✅ 正常です');
  console.log('==============================');
  
  // line_itemsを構築
  const lineItems = [
    {
      price_data: {
        currency: 'jpy',
        product_data: {
          name: generateOrderSummary(orderData),
        },
        unit_amount: stripeAmountForJPY, // JPYの場合は円単位でそのまま
      },
      quantity: 1,
    }
  ];
  
  console.log('構築されたlineItems:', lineItems);
  console.log('lineItems[0].price_data.unit_amount:', lineItems[0].price_data.unit_amount);
  
  // successURLにデータを含める（Stripe URLの制限に注意）
  const successUrl = STRIPE_CONFIG.SUCCESS_URL.replace('{CHECKOUT_SESSION_ID}', '{CHECKOUT_SESSION_ID}');
  
  console.log('successUrl:', successUrl);
  
  const checkoutData = {
    payment_method_types: ['card'],
    line_items: lineItems,
    mode: STRIPE_CONFIG.MODE,
    success_url: successUrl,
    cancel_url: STRIPE_CONFIG.CANCEL_URL.replace('{ERROR_MESSAGE}', encodeURIComponent('決済がキャンセルされました')),
    customer_email: orderData.email,
    
    // 追加のメタデータ（予約データをすべてここに格納）
    metadata: {
      customer_name: orderData.name,
      customer_phone: orderData.phone,
      customer_email: orderData.email,
      pickup_store: orderData.store,
      application_store: orderData.applicationStore || '',
      pickup_date: orderData.pickup_date || '',
      pickup_time: orderData.pickup_time || '',
      delivery_method: orderData.deliveryMethod || 'pickup',
      delivery_date: orderData.deliveryDate || '',
      delivery_time_slot: orderData.deliveryTimeSlot || '',
      noshi_option: orderData.noshiOption || 'なし',
      orderer_address: orderData.ordererAddress ? JSON.stringify(orderData.ordererAddress) : '',
      delivery_address: orderData.deliveryAddress ? JSON.stringify(orderData.deliveryAddress) : '',
      pickup_note: orderData.note || '',
      order_summary: generateOrderSummary(orderData),
      order_items: JSON.stringify(orderData.items), // 商品情報もJSONで格納
      total_amount: totalAmount.toString() // 円単位の文字列
    },
    
    // 請求先住所の収集
    billing_address_collection: STRIPE_CONFIG.BILLING_ADDRESS_COLLECTION,
    
    // プロモーションコード
    allow_promotion_codes: STRIPE_CONFIG.ALLOW_PROMOTION_CODES
  };
  
  console.log('最終checkoutData:', checkoutData);
  console.log('metadata.total_amount:', checkoutData.metadata.total_amount);
  console.log('=== Checkout データ構築完了 ===');
  
  return checkoutData;
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

  const isDelivery = orderData.deliveryMethod === 'delivery';
  if (isDelivery) {
    return `${items} (配送: ${orderData.deliveryDate} ${orderData.deliveryTimeSlot} のし:${orderData.noshiOption || 'なし'})`;
  }
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
      const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbz3KjsOwCNdqB3BNNhlJ4xGni7OV1sjlpjVkCuDFWkylORHGwJWl5LU24ML2q6VpiJp/exec';
      
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

/**
 * 請求書（Stripe Invoicing）データの構築
 * @param {Object} orderData - 予約データ
 * @return {Object} 請求書作成用データ
 */
function buildInvoiceData(orderData) {
  const items = orderData.items.map(item => ({
    name: item.name,
    qty: Number(item.qty),
    price: Number(item.price)
  }));

  const totalAmount = items.reduce((sum, it) => sum + (it.price * it.qty), 0);

  const metadata = {
    customer_name: orderData.name,
    customer_phone: orderData.phone,
    customer_email: orderData.email,
    company_name: orderData.companyName || '',
    department_name: orderData.departmentName || '',
    contact_person: orderData.contactPerson || '',
    pickup_store: orderData.store || '',
    application_store: orderData.applicationStore || '',
    pickup_date: orderData.pickup_date || '',
    pickup_time: orderData.pickup_time || '',
    delivery_method: orderData.deliveryMethod || 'delivery',
    delivery_date: orderData.deliveryDate || '',
    delivery_time_slot: orderData.deliveryTimeSlot || '',
    noshi_option: orderData.noshiOption || 'なし',
    orderer_address: orderData.ordererAddress ? JSON.stringify(orderData.ordererAddress) : '',
    delivery_address: orderData.deliveryAddress ? JSON.stringify(orderData.deliveryAddress) : '',
    pickup_note: orderData.note || '',
    order_items: JSON.stringify(items),
    total_amount: String(Math.round(totalAmount))
  };

  return {
    currency: STRIPE_CONFIG.CURRENCY,
    customer: {
      email: orderData.email,
      name: orderData.companyName ? `${orderData.companyName} ${orderData.contactPerson || ''}`.trim() : orderData.name,
      phone: orderData.phone
    },
    items: items,
    metadata: metadata,
    days_until_due: 30
  };
}

/**
 * Stripe Invoicing 開始
 * @param {Object} orderData - 予約データ
 * @return {Promise<Object>} 結果
 */
async function startStripeInvoice(orderData) {
  console.log('Stripe Invoicing開始:', orderData);
  const invoiceData = buildInvoiceData(orderData);
  const response = await createInvoice(invoiceData);
  return response;
}

/**
 * GASに請求書作成を依頼
 * @param {Object} invoiceData - 請求書データ
 * @return {Promise<Object>} GAS応答
 */
async function createInvoice(invoiceData) {
  return new Promise((resolve, reject) => {
    try {
      const callbackName = 'invoiceCallback' + Date.now();

      window[callbackName] = function(result) {
        try {
          if (typeof result === 'string') {
            result = JSON.parse(result);
          }
          resolve(result);
        } catch (err) {
          reject(new Error('応答の解析に失敗しました'));
        } finally {
          const script = document.querySelector(`script[data-callback="${callbackName}"]`);
          if (script && script.parentNode) script.parentNode.removeChild(script);
          if (window[callbackName]) delete window[callbackName];
        }
      };

      const jsonString = JSON.stringify(invoiceData);
      const encodedData = btoa(encodeURIComponent(jsonString));
      const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbz3KjsOwCNdqB3BNNhlJ4xGni7OV1sjlpjVkCuDFWkylORHGwJWl5LU24ML2q6VpiJp/exec';
      const jsonpUrl = `${GAS_WEB_APP_URL}?action=createInvoice&data=${encodedData}&callback=${callbackName}&_t=${Date.now()}`;

      const script = document.createElement('script');
      script.src = jsonpUrl;
      script.setAttribute('data-callback', callbackName);
      script.onerror = function(err) {
        reject(new Error('サーバーとの通信に失敗しました'));
      };
      document.head.appendChild(script);

      setTimeout(() => {
        if (window[callbackName]) {
          const scriptEl = document.querySelector(`script[data-callback="${callbackName}"]`);
          if (scriptEl && scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
          delete window[callbackName];
          reject(new Error('請求書作成がタイムアウトしました'));
        }
      }, 20000);
    } catch (error) {
      reject(error);
    }
  });
}

// グローバル公開
window.startStripeInvoice = startStripeInvoice;

} // 重複読み込み防止のelseブロック終了
