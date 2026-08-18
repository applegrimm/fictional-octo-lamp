#!/usr/bin/env bash
#
# clasp の初期設定。
#   使い方: npm run gas:setup -- <スクリプトID>
#
# スクリプトIDは GASエディタ → プロジェクトの設定 → スクリプト ID で確認できる。
# （WebアプリURLの AKfycb... はデプロイIDであってスクリプトIDではない）
set -euo pipefail

SCRIPT_ID="${1:-}"

if [ -z "$SCRIPT_ID" ]; then
  echo "エラー: スクリプトIDを指定してください" >&2
  echo "  例: npm run gas:setup -- 1AbC...xyz" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

if ! command -v clasp >/dev/null 2>&1 && [ ! -x node_modules/.bin/clasp ]; then
  echo "clasp が見つかりません。先に npm install を実行してください。" >&2
  exit 1
fi

CLASP="$(command -v clasp || echo node_modules/.bin/clasp)"

# .clasp.json を書き換え
cat > .clasp.json <<JSON
{
  "scriptId": "${SCRIPT_ID}",
  "rootDir": "."
}
JSON
echo "✅ .clasp.json を更新しました (scriptId: ${SCRIPT_ID})"

# appsscript.json（マニフェスト）をGAS側から取得する。
# ローカルで捏造するとタイムゾーンやWebアプリの公開設定を壊すため、
# 必ず本物を取ってくる。Code.gs を上書きしないよう一時ディレクトリで受ける。
TMPDIR_PULL="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_PULL"' EXIT

cat > "$TMPDIR_PULL/.clasp.json" <<JSON
{
  "scriptId": "${SCRIPT_ID}",
  "rootDir": "."
}
JSON

echo "GAS からマニフェストを取得中..."
( cd "$TMPDIR_PULL" && "$CLASP" pull >/dev/null )

if [ -f "$TMPDIR_PULL/appsscript.json" ]; then
  cp "$TMPDIR_PULL/appsscript.json" ./appsscript.json
  echo "✅ appsscript.json を取得しました"
else
  echo "⚠️ appsscript.json を取得できませんでした。clasp login とApps Script APIの有効化を確認してください。" >&2
  exit 1
fi

echo ""
echo "セットアップ完了。次のコマンドで反映できます:"
echo "  npm run gas:release   # push してデプロイまで実行"
