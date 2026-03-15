# Changelog

## Unreleased

- `session_recall` に `project_path` フィルタを追加 — 特定プロジェクトのセッションのみに絞り込み検索可能
- CLI に `serve` コマンドを追加 — MCP サーバーを `cc-memory serve` で起動可能に
- README / docs を v3.2.0 の実態に合わせて修正:
  - "9 API endpoints" → "11 MCP tools"
  - v1→v2 移行表の "8 ツール" → "11 ツール"
  - docs/MULTI_AGENT.md を v3 アーキテクチャに全面書き換え
  - docs/agent-manager-architecture.md を v3 に全面書き換え
  - Deprecated → Current コマンドマッピング表を追加
  - CLI コマンド一覧に `serve` を追加
- `docs/QUICKSTART.md` 追加 — 5分で最初の recall まで到達するガイド

## v3.2.0

### Short-term Memory: `session_recall` ツール

**新機能:**
- `session_recall` ツール追加 — Claude Code セッション JSONL を自動インデックス + ハイブリッド検索
  - `~/.claude/projects/**/*.jsonl` を対象期間（デフォルト7日）で自動スキャン
  - 会話ターン（user + assistant ペア）単位でチャンク化
  - 2000文字超のターンは自動分割
  - 既存 hybrid search（vector 70% + keyword 30%）を再利用、短期記憶向けの強めの時間減衰
  - 対象期間外のチャンクを呼び出し時に自動削除
  - lazy indexing: 初回 `session_recall` 呼び出し時に未インデックスのセッションを検出→インデックス構築
  - subagents ディレクトリは自動除外
  - assistant のストリーミング重複を message.id で自動デデュプ

**新テーブル:**
- `session_chunks` — セッションチャンクの保存（id, session_id, project_path, chunk_index, content, timestamp, indexed_at）
- `vec_session_chunks` — チャンクのベクトル埋め込み（sqlite-vec）

**ファイル追加:**
- `src/session.ts` — JSONL パース、チャンク化、インデックス、検索
- `tests/session.test.ts` — チャンク化・インデックス・検索テスト

## v3.1.0

### Autonomous Memory Skills (PR #10, #12)

**新機能:**
- `/digest [days]` スキル追加 — セッションJSONLから知識を自動抽出し cc-memory に保存
  - python3 による JSONL 前処理（ストリーミング重複のデデュプ、サイズ制限）
  - 処理済みセッションを digest-log で追跡し、再処理を防止
  - 知識カテゴリ: decision / lesson / preference / fact
  - agent role に応じた scope 自動決定（manager→shared, worker→personal）
- `/consolidate` スキル追加 — メモリの重複統合・品質改善（dry-run→承認→実行）
  - MERGE / DELETE / RETAG の3種類の変更操作

**修正:**
- JSONL パース: Claude Code の実フォーマット（`type: "user"/"assistant"`）に対応（PR #12）
- subagents ディレクトリを探索対象から除外（PR #12）

### memory_update 改善 (PR #13, #14)

**新機能:**
- `memory_update` に `tags` パラメータ追加（PR #13）
  - 省略時は既存タグを保持（後方互換）
  - 指定時は既存タグを置換
  - consolidate の RETAG が delete+re-store 不要に
- `memory_update` の `content` を optional に変更（PR #14）
  - tags だけ変更したい場合に content の再送が不要に
  - `content` と `tags` の少なくとも一方が必須（バリデーション）

**リファクタ:**
- `updateMemory` のシグネチャを options object パターンに変更（PR #15）
  - `(id, updatedBy, content?, tags?)` → `(id, updatedBy, { content?, tags? })`

**依存関係:**
- `@huggingface/transformers` を optionalDependencies に追加（PR #15）
  - ベクトル埋め込み生成が有効に（ハイブリッド検索の精度向上）

### Phase 2: Self-Curation

**新機能:**
- `memory_curate` ツール追加 — KNN ベースの重複検出 + 古いメモリのフラグ
- Union-Find アルゴリズムによる重複グルーピング（O(n×k)）
- `dry_run: true`（デフォルト）でレポートのみ、`false` で実際に削除
- 90日以上更新のないメモリを stale としてレポート
- RBAC: manager は全スコープ、worker は自分の personal のみ curate 可能

### Phase 1: Hybrid Semantic Search

**新機能:**
- sqlite-vec によるベクトル検索を統合（オプション、フォールバックあり）
- `memory_store`, `memory_recall`, `memory_update` に `embedding` パラメータ追加
- ハイブリッドランキング: ベクトル類似度（70%）+ キーワードマッチ（30%）+ 時間減衰
- CLI に `migrate-embeddings` コマンド追加（既存メモリへの一括ベクトル生成）
- `cc-memory doctor` で sqlite-vec の状態を表示

**フォールバック設計:**
- sqlite-vec 未インストール時はキーワード検索のみで動作（既存動作と同一）
- `@huggingface/transformers` 未インストール時は embedding 生成をスキップ
- レスポンスの `embedding_status` フィールドで状態を通知（`"stored"` / `"pending"` / `"skipped"`）

**依存関係:**
- `sqlite-vec` を dependencies に追加
- `@huggingface/transformers` は optionalDependencies（将来追加予定）

**内部改善:**
- tools.ts: Zod スキーマで `caller_id` は required なので冗長な null チェックを削除
- storage.ts: `keywordSearch` / `hybridSearch` をプライベートメソッドに分離
- storage.ts: `deleteMemory` で embedding も自動削除

### Phase 0: Environment Repair (merged separately)

- dead code 削除（search.ts, types.ts の未使用 Input interfaces）
- server.ts: version を package.json から動的に取得
- tools.ts: `caller_id` を Zod スキーマで required に修正

## v2.1.1

- 初期リリース（v2 アーキテクチャ）
