# Changelog

## v3.0.0 (unreleased)

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
