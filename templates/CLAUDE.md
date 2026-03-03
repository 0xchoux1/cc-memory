# cc-memory 使用ルール

このプロジェクトでは cc-memory MCP サーバーが有効になっています。

## セッション開始時の記憶呼び出し

**重要**: 新しいセッションでユーザーの最初のメッセージを受け取ったら、以下を実行すること：

1. `memory_recall` でユーザーの発言に関連する長期記憶を検索
2. `session_recall` で直近セッションの関連コンテキストを検索
3. 検索結果を踏まえて応答する

```
# 例: ユーザーが「認証機能を実装して」と言った場合
memory_recall(scope="all", query="認証 実装", caller_id="claude-code", embedding=true)
session_recall(query="認証 実装", caller_id="claude-code", embedding=true)
```

> **注意**: `memory_recall` / `session_recall` は caller_id のエージェントがプロジェクトに登録済みである必要があります。未登録の場合は先に `agent_register` を実行してください。

## 記憶の保存タイミング

以下のタイミングで `memory_store` を使って記憶を保存すること：

| 状況 | tags | 例 |
|------|------|-----|
| ユーザーの好み・設定を学んだ | `["preference"]` | コードスタイル、使用ツール |
| 重要な事実を学んだ | `["fact"]` | プロジェクト構成、API仕様 |
| タスクが完了した | `["milestone"]` | 機能実装、バグ修正 |
| エラーを解決した | `["lesson"]` | デバッグ経緯、解決策 |
| 設計判断を下した | `["decision"]` | アーキテクチャ選定、技術選定 |

保存時は `embedding: true` を指定してベクトル検索を有効にすること。

---

# OODA ワークフロー

このプロジェクトでは OODA (Observe, Orient, Decide, Act) ワークフローが有効になっています。

## OODA コマンド

- `/observe` - 状況を観察し、コンテキストを収集
- `/assess` - 状況を分析し、オプションを生成
- `/plan` - 意思決定と実行計画の作成
- `/execute` - 計画を実行し、進捗を追跡
- `/escalate` - ブロッカーを報告し、ガイダンスを要求

## メモリコマンド

- `/recall <query>` - すべてのメモリレイヤーを検索
- `/remember <info>` - 重要な情報を保存
- `/reflect` - パターンと洞察を分析
- `/memory-status` - メモリ統計を確認

## 自律メモリスキル

- `/digest [days]` — セッションログから知識を抽出してcc-memoryに保存（デフォルト: 直近3日）
- `/consolidate` — メモリの重複整理・品質改善（デフォルトdry-run、承認後に実行）
- `/improve [項目]` — ROADMAP.md の次の改善項目を実装（branch → 実装 → テスト → PR → ROADMAP更新）

## ワークフロー例

1. ユーザーがタスクを依頼
2. `/observe` で状況を把握
3. `/assess` でオプションを評価
4. `/plan` で実行計画を作成
5. `/execute` で計画を実行
6. 問題が発生したら `/escalate`
