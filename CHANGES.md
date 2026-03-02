# Changelog

## v3.0.0 (unreleased)

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

### memory_update tags 対応 (PR #13)

**新機能:**
- `memory_update` に `tags` パラメータ追加
  - 省略時は既存タグを保持（後方互換）
  - 指定時は既存タグを置換
- consolidate の RETAG が delete+re-store 不要に

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
