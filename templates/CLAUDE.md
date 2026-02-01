# cc-memory 使用ルール

このプロジェクトでは cc-memory MCP サーバーが有効になっています。

## セッション開始時の記憶呼び出し

**重要**: 新しいセッションでユーザーの最初のメッセージを受け取ったら、以下を実行すること：

1. `memory_recall` でユーザーの発言に関連する記憶を検索
2. `semantic_search` でユーザーの好みや設定を確認
3. 検索結果を踏まえて応答する

```
# 例: ユーザーが「認証機能を実装して」と言った場合
memory_recall(query="認証 実装")
semantic_search(type="preference")
```

## 記憶の保存タイミング

以下のタイミングで記憶を保存すること：

| 状況 | 使用ツール | 例 |
|------|-----------|-----|
| ユーザーの好み・設定を学んだ | `semantic_create` (type: preference) | コードスタイル、使用ツール |
| 重要な事実を学んだ | `semantic_create` (type: fact) | プロジェクト構成、API仕様 |
| タスクが完了した | `episode_record` (type: success/milestone) | 機能実装、バグ修正 |
| エラーを解決した | `episode_record` (type: error) | デバッグ経緯、解決策 |
| パターンを発見した | `semantic_create` (type: pattern) | コードパターン、ワークフロー |

## 記憶の優先度

- importance 8-10: 絶対に覚えておくべき（ユーザーの重要な好み、重大なマイルストーン）
- importance 5-7: 一般的な記憶（通常のタスク完了、学んだ事実）
- importance 1-4: 軽微な記憶（小さな修正、一時的な情報）

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

## ワークフロー例

1. ユーザーがタスクを依頼
2. `/observe` で状況を把握
3. `/assess` でオプションを評価
4. `/plan` で実行計画を作成
5. `/execute` で計画を実行
6. 問題が発生したら `/escalate`
