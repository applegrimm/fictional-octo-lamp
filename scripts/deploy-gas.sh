#!/usr/bin/env bash
#
# 既存デプロイを「新バージョン」で更新する。
#
# 重要: 新規デプロイを作るとWebアプリURLが変わり、index.html / success.html /
#       stripe-config.js(2箇所) / manage_scripts_phase2.js の差し替えが必要になる。
#       そのため必ず -i で既存のデプロイIDを指定して上書きする。
set -euo pipefail

cd "$(dirname "$0")/.."

# デプロイID = WebアプリURL /macros/s/<ここ>/exec の部分
DEPLOYMENT_ID="${GAS_DEPLOYMENT_ID:-AKfycbwQi1nQI1jDspUlagORpKHtpj3NBbQ5RNNkkcXqhsE-WM_j_w10CvO0CAPkVZFT5Vxh}"

CLASP="$(command -v clasp || echo node_modules/.bin/clasp)"

DESCRIPTION="${1:-$(git rev-parse --short HEAD) $(date '+%Y-%m-%d %H:%M')}"

echo "デプロイID: ${DEPLOYMENT_ID}"
echo "説明:       ${DESCRIPTION}"
echo ""

"$CLASP" deploy --deploymentId "$DEPLOYMENT_ID" --description "$DESCRIPTION"

echo ""
echo "✅ デプロイ更新完了（WebアプリURLは変わりません）"
echo ""
echo "初回のみ、GASエディタで rotateAllStoreSecrets() を1回実行してください。"
echo "店舗管理シークレットがスクリプトプロパティに登録され、24店舗分の新URLがログに出力されます。"
