<!-- BEGIN SHARED CONTINUITY RULES -->

<!-- AUTO-GENERATED FILE -->
<!-- Source: agent-rules/source/agent-log.md -->
<!-- Do not edit directly. -->

# Agent Log 運用ルール

共通 AI エージェント向けの作業ログ運用ルール。正本は `agent-rules/source/agent-log.md`。

## 作業開始時

- プロジェクトルートの `.agent-log/` が存在する場合、最近のログを確認する
- 過去の設計判断・変更理由を尊重する
- AI エージェントが変わっても `.agent-log` を引き継ぐ

## 作業終了時（実変更がある場合）

- `.agent-log/` が無ければ作成する
- ログファイル名: `YYYYMMDD-HHMM-<agent>.md`
- 以下を必ず記録する
  - Agent
  - Date
  - Task
  - Reason（なぜその変更を行ったか）
  - Changes
  - Files Changed
  - Verification
  - Remaining Issues
- 「何を変更したか」だけでなく「なぜ変更したか」を必ず書く
- 未検証事項・残課題を明記する

## 禁止・注意

- 調査・質問回答・コード変更を伴わない作業ではログ不要
- 不要なブランチ作成を避ける
- 既存履歴の破壊（force push / hard reset 等）を避ける
- 通常の個人開発では main への直接変更を許可する
- ブランチを作った場合、特別な理由がなければ作業終了時に main へ反映する
- 未マージ状態を作業完了として扱わない

## 正本について

- ルール変更時は原則 `agent-rules/source/agent-log.md` のみを編集する
- 各プロジェクトへ配布された生成ファイルを直接編集しない

<!-- END SHARED CONTINUITY RULES -->

