#!/usr/bin/env bash
# コミット前の簡易チェック（GASにはJS構文、設定ファイルには妥当性検査）
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cp Code.gs "$tmp/Code.js"
node --check "$tmp/Code.js" && echo "✅ Code.gs" || { echo "❌ Code.gs"; fail=1; }
node --check stripe-config.js && echo "✅ stripe-config.js" || { echo "❌ stripe-config.js"; fail=1; }
node --check manage_scripts_phase2.js && echo "✅ manage_scripts_phase2.js" || { echo "❌ manage_scripts_phase2.js"; fail=1; }

for f in products.json stores.json stripe-mode.json; do
  python3 -c "import json,sys;json.load(open('$f',encoding='utf-8'))" \
    && echo "✅ $f" || { echo "❌ $f"; fail=1; }
done

python3 -c "import yaml;yaml.safe_load(open('_config.yml',encoding='utf-8'))" \
  && echo "✅ _config.yml" || { echo "❌ _config.yml"; fail=1; }

# stores.json に認証情報が混入していないか
if grep -q "managementSecret" stores.json; then
  echo "❌ stores.json に managementSecret が含まれています（公開ファイルに認証情報を置かないこと）"
  fail=1
else
  echo "✅ stores.json に認証情報なし"
fi

exit $fail
