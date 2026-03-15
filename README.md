# cc-memory

> マルチエージェント開発で、共有知識と専門知識を分離管理するメモリサーバー

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io/)

**[5分でスタート → docs/QUICKSTART.md](docs/QUICKSTART.md)**

---

## cc-memory がない場合 vs ある場合

| | cc-memory なし | cc-memory あり |
|---|---|---|
| **共有知識** | エージェント起動のたびにプロンプトで渡す | Shared Scope に一度書けば全員が参照 |
| **作業ログ** | セッション終了で消える | Personal Scope に永続化 |
| **権限管理** | なし（全員が全部見える） | Role-based（manager/worker） |
| **複数エージェント** | 互いの文脈を知らない | 共有メモリで前提を共有 |

---

## コンセプト

```
Shared Scope（共有層）← 全エージェント読める、manager のみ書ける
  ├── プロジェクト要件
  ├── コーディング規約
  └── 運用ルール

Personal Scope（個人層）← 本人のみ読み書き
  ├── Web AG: Nginx経験、フロント知識
  ├── DB AG: MySQL経験、クエリ最適化
  └── Infra AG: k8s経験、監視設定
```

マネージャーがチーム全体の知識を **Shared Scope** に集約し、各ワーカーは自分だけの経験を **Personal Scope** に蓄積。これにより、知識の一貫性と専門性を両立します。

---

## 特徴

- **スコープモデル** — `shared`（共有）と `personal`（個人）の 2 層でメモリを管理
- **Role-based Access Control** — `manager` は全スコープ読み書き可、`worker` は shared 読み取り＋自分の personal のみ
- **MCP 対応** — Claude Code やその他 MCP クライアントからそのまま使える
- **SQLite** — ローカル保存、クラウド不要、プライバシー重視
- **ハイブリッド検索** — sqlite-vec によるベクトル検索 + キーワード検索のハイブリッド（v3）
- **短期記憶** — セッションJSONLの自動インデックス + ハイブリッド検索（v3.2）
- **11 MCP tools** — シンプルで必要十分な API セット

---

## インストール & セットアップ

```bash
# グローバルインストール
npm install -g cc-memory

# データベース初期化
cc-memory setup
```

### Claude Code で使う

`~/.claude/settings.json` に以下を追加:

```json
{
  "mcpServers": {
    "cc-memory": {
      "command": "cc-memory",
      "args": ["serve"]
    }
  }
}
```

> `cc-memory setup` を実行すると DB ファイルが作成されます。デフォルトパスは `./cc-memory.db`（環境変数 `CC_MEMORY_DB` で変更可）。

---

## MCP API 一覧

### メモリ操作（6 本）

| ツール | 説明 |
|--------|------|
| `memory_store` | メモリを保存。shared スコープは manager のみ書き込み可。`embedding: true` でベクトル保存 |
| `memory_recall` | クエリでメモリを検索。`embedding: true` でハイブリッド検索（ベクトル + キーワード） |
| `memory_list` | スコープ内の全メモリを一覧 |
| `memory_update` | メモリ内容・タグを更新。オーナーまたは manager のみ。`embedding: true` で再ベクトル化 |
| `memory_delete` | メモリを削除。オーナーまたは manager のみ |
| `memory_curate` | 重複・古いメモリを検出・削除。`dry_run: true`（デフォルト）でレポートのみ |

### セッション検索（1 本）

| ツール | 説明 |
|--------|------|
| `session_recall` | 直近セッションログ（短期記憶）をハイブリッド検索。初回呼び出し時にJSONLを自動インデックス |

### プロジェクト管理（2 本）

| ツール | 説明 |
|--------|------|
| `project_create` | 新しいプロジェクトを作成 |
| `project_list` | 全プロジェクトを一覧 |

### エージェント管理（2 本）

| ツール | 説明 |
|--------|------|
| `agent_register` | エージェントをプロジェクトに登録（role: manager / worker） |
| `agent_list` | プロジェクト内の全エージェントを一覧 |

### パラメータ詳細

<details>
<summary><code>memory_store</code></summary>

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `scope` | `"shared" \| "personal"` | ✅ | メモリスコープ |
| `agent_id` | `string` | ✅ | 呼び出し元エージェント ID |
| `content` | `string` | ✅ | メモリ内容 |
| `tags` | `string[]` | - | タグ（検索用） |
| `project_id` | `string` | - | プロジェクト ID（デフォルト: `"default"`） |
| `embedding` | `boolean` | - | `true` でベクトル埋め込みを生成・保存 |

</details>

<details>
<summary><code>memory_recall</code></summary>

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `scope` | `"shared" \| "personal" \| "all"` | ✅ | 検索スコープ |
| `query` | `string` | ✅ | 検索クエリ |
| `caller_id` | `string` | ✅* | 呼び出し元エージェント ID（権限チェック用） |
| `agent_id` | `string` | - | エージェント ID フィルタ（personal スコープ用） |
| `project_id` | `string` | - | プロジェクト ID |
| `limit` | `number` | - | 最大件数（1-100、デフォルト: 10） |
| `embedding` | `boolean` | - | `true` でハイブリッド検索（ベクトル + キーワード） |

> *`caller_id` は権限チェックのため実質必須です。
> `agent_id` は personal スコープのフィルタ用です。shared スコープでは無視されます。

</details>

<details>
<summary><code>memory_list</code></summary>

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `scope` | `"shared" \| "personal"` | ✅ | メモリスコープ |
| `agent_id` | `string` | - | エージェント ID フィルタ（personal スコープ用。shared では無視） |
| `project_id` | `string` | - | プロジェクト ID |

</details>

<details>
<summary><code>memory_update</code></summary>

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `memory_id` | `string` | ✅ | 更新するメモリの ID |
| `content` | `string` | - | 新しい内容（省略時は既存内容を保持） |
| `tags` | `string[]` | - | 新しいタグ（省略時は既存タグを保持） |
| `caller_id` | `string` | ✅* | 呼び出し元エージェント ID |
| `project_id` | `string` | - | プロジェクト ID |
| `embedding` | `boolean` | - | `true` でベクトル埋め込みを再生成 |

</details>

<details>
<summary><code>memory_delete</code></summary>

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `memory_id` | `string` | ✅ | 削除するメモリの ID |
| `caller_id` | `string` | ✅* | 呼び出し元エージェント ID |
| `project_id` | `string` | - | プロジェクト ID |

</details>

<details>
<summary><code>project_create</code></summary>

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `project_id` | `string` | ✅ | プロジェクト ID |
| `description` | `string` | ✅ | プロジェクトの説明 |

</details>

<details>
<summary><code>project_list</code></summary>

パラメータなし。

</details>

<details>
<summary><code>agent_register</code></summary>

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `project_id` | `string` | ✅ | プロジェクト ID |
| `agent_id` | `string` | ✅ | エージェント ID |
| `role` | `"manager" \| "worker"` | ✅ | 役割 |

</details>

<details>
<summary><code>agent_list</code></summary>

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `project_id` | `string` | ✅ | プロジェクト ID |

</details>

<details>
<summary><code>session_recall</code></summary>

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `query` | `string` | ✅ | 検索クエリ |
| `caller_id` | `string` | ✅ | 呼び出し元エージェント ID |
| `days` | `number` | - | 対象日数（1-30、デフォルト: 7） |
| `project_id` | `string` | - | プロジェクト ID（認可チェック用。セッションの検索絞り込みには使用されません） |
| `project_path` | `string` | - | プロジェクトパスでフィルタ（例: `-home-user-myproject`）。省略時は全プロジェクト対象 |
| `limit` | `number` | - | 最大件数（1-50、デフォルト: 10） |
| `embedding` | `boolean` | - | `true` でハイブリッド検索 |

> 初回呼び出し時に `~/.claude/projects/` 配下の JSONL セッションファイルを自動でインデックスします。
> 対象期間を超えた古いチャンクは自動削除されます。

</details>

---

## 使い方（マルチエージェントシナリオ）

### 1. プロジェクト作成

```json
{ "tool": "project_create", "project_id": "my-app", "description": "ECサイト開発" }
```

### 2. エージェント登録

```json
{ "tool": "agent_register", "project_id": "my-app", "agent_id": "lead", "role": "manager" }
{ "tool": "agent_register", "project_id": "my-app", "agent_id": "web-worker", "role": "worker" }
{ "tool": "agent_register", "project_id": "my-app", "agent_id": "db-worker", "role": "worker" }
```

### 3. マネージャーが共有知識を保存

```json
{
  "tool": "memory_store",
  "scope": "shared",
  "agent_id": "lead",
  "content": "TypeScript + Next.js で開発。ESLint strict モード必須。",
  "tags": ["規約", "tech-stack"],
  "project_id": "my-app"
}
```

### 4. ワーカーが共有知識を参照 & 個人メモリに記録

```json
// 共有知識を検索
{ "tool": "memory_recall", "scope": "shared", "query": "tech-stack", "caller_id": "web-worker", "project_id": "my-app" }

// 個人メモリに作業記録を保存
{
  "tool": "memory_store",
  "scope": "personal",
  "agent_id": "web-worker",
  "content": "Nginx リバースプロキシ設定完了。ポート 3000 → 80 に転送。",
  "tags": ["nginx", "infra"],
  "project_id": "my-app"
}
```

---

## スコープと権限

| 操作 | Shared Scope | Personal Scope（自分） | Personal Scope（他人） |
|------|:---:|:---:|:---:|
| **Manager 読み取り** | ✅ | ✅ | ✅ |
| **Manager 書き込み** | ✅ | ✅ | ❌ |
| **Worker 読み取り** | ✅ | ✅ | ❌ |
| **Worker 書き込み** | ❌ | ✅ | ❌ |
| **削除** | Manager のみ | オーナー or Manager | Manager のみ |

---

## CLI コマンド

```bash
cc-memory serve               # MCP サーバー起動（Claude Code 連携用）
cc-memory setup               # DB 初期化
cc-memory doctor              # 環境チェック（sqlite-vec 状態含む）
cc-memory status              # プロジェクト・メモリの統計表示
cc-memory migrate-embeddings  # 既存メモリにベクトル埋め込みを一括生成
```

---

## 設定

### 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `CC_MEMORY_DB` | `cc-memory.db` | SQLite データベースのパス |

### Claude Code 設定

```json
{
  "mcpServers": {
    "cc-memory": {
      "command": "cc-memory",
      "args": ["serve"]
    }
  }
}
```

---

## FAQ

**Q: データはどこに保存されますか？**
A: ローカルの SQLite ファイル（デフォルト: `./cc-memory.db`）。クラウドには送信されません。

**Q: メモリを全削除するには？**
A: DB ファイルを削除して `cc-memory setup` を再実行してください。

**Q: Claude Code 以外でも使えますか？**
A: はい。MCP プロトコルに対応した任意のクライアントから利用できます。

**Q: プロジェクトを指定しないとどうなりますか？**
A: `"default"` プロジェクトが自動的に使用されます（初回起動時に作成済み）。

**Q: プロジェクトごとに DB を分ける必要がありますか？**
A: いいえ。1 つの DB で複数プロジェクトを管理できます。`project_id` でデータが分離されるため、MCP 設定は 1 つのまま複数プロジェクトを扱えます。

---

## ベストプラクティス

### tags を必ずつける

tags はメモリの検索精度を決めます。cc-memory のテキスト検索は `content` と `tags` の両方を対象にするため、短いキーワードを tags に入れておくと recall のヒット率が上がります。

```json
{
  "tool": "memory_store",
  "scope": "shared",
  "agent_id": "lead",
  "content": "本番デプロイは金曜日を避ける。障害対応が週末にずれ込むリスクがある。",
  "tags": ["deploy", "rule", "ops"],
  "project_id": "my-app"
}
```

### store する前に recall する

同じ内容を何度も store すると、recall 時にノイズになります。store する前に recall で既存メモリを確認し、重複があれば `memory_update` で更新してください。

### shared vs personal の判断基準

| 迷ったら | → |
|----------|---|
| チーム全員が知るべき？ | → `shared` |
| 自分の作業ログ・経験？ | → `personal` |
| 迷う？ | → `personal` に入れて、後で manager が shared に昇格 |

### いつ store するか

以下のタイミングで store すると、メモリが自然に蓄積されます：

- **判断・決定を下した時** — なぜその選択をしたか（例: 「PostgreSQL ではなく SQLite を選択。理由: ローカル完結を優先」）
- **バグを直した時** — 何が壊れていて何を直したか
- **教訓を得た時** — 次回同じ失敗をしないために
- **タスク完了時** — 何をやって何が変わったか

### メモリの粒度

1 メモリ = 1 トピック。長い文章を 1 つに詰め込むより、短いメモリを複数 store する方が recall の精度が上がります。

```
❌ 「デプロイ手順を変更した。金曜は避ける。あとDBのバックアップ頻度も変えた。」
✅ 「デプロイは金曜を避けるルールに変更」 + 「DBバックアップを日次から6時間ごとに変更」
```

---

## v1 からの移行

v1 のコードは [`v1` ブランチ](https://github.com/0xchoux1/cc-memory/tree/v1)で保全されています。

### 主な変更点

| | v1 | v2 |
|---|---|---|
| **メモリモデル** | 3 層（Working / Episodic / Semantic） | 2 スコープ（Shared / Personal） |
| **アクセス制御** | チーム・API キーベース | Role-based（manager / worker） |
| **API 数** | 20+ ツール | 11 ツール |
| **同期** | Tachikoma / Git / Cloud | なし（ローカル完結） |
| **設計思想** | 機能豊富 | シンプル・必要十分 |

> ⚠️ v1 と v2 のデータベースには互換性がありません。v2 は新しい DB で始めてください。

---

## English

### What is cc-memory?

A memory server for multi-agent development that separates **shared knowledge** from **personal expertise** using scope-based access control.

### Key Features

- **Scope model** — `shared` (team-wide, manager-writable) and `personal` (agent-private)
- **Role-based access** — `manager` reads/writes all; `worker` reads shared + own personal only
- **MCP compatible** — works with Claude Code and any MCP client
- **SQLite** — local storage, no cloud, privacy-first
- **Hybrid search** — sqlite-vec vector search + keyword search (v3)
- **Short-term memory** — auto-indexes JSONL session logs with hybrid search (v3.2)
- **11 MCP tools** — simple and sufficient

### Quick Start

```bash
npm install -g cc-memory
cc-memory setup
```

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "cc-memory": {
      "command": "cc-memory",
      "args": ["serve"]
    }
  }
}
```

### API

**Memory:** `memory_store`, `memory_recall`, `memory_list`, `memory_update`, `memory_delete`, `memory_curate`
**Session:** `session_recall`
**Projects:** `project_create`, `project_list`
**Agents:** `agent_register`, `agent_list`

### Scope & Permissions

| Action | Shared | Own Personal | Other's Personal |
|--------|:---:|:---:|:---:|
| Manager read | ✅ | ✅ | ✅ |
| Manager write | ✅ | ✅ | ❌ |
| Worker read | ✅ | ✅ | ❌ |
| Worker write | ❌ | ✅ | ❌ |

### Best Practices

- **Always add tags** — improves recall accuracy since search targets both `content` and `tags`
- **Recall before store** — avoid duplicates; use `memory_update` if a memory already exists
- **One topic per memory** — shorter, focused memories rank better than long multi-topic ones
- **shared vs personal** — if the whole team needs it → `shared`; if it's your own log → `personal`; when in doubt → `personal` first, promote to `shared` later

### Migration from v1

v1 is preserved on the [`v1` branch](https://github.com/0xchoux1/cc-memory/tree/v1). v2 databases are not compatible with v1 — start fresh.

---

## ドキュメント検証

このドキュメントは cc-memory **v3.2.0** で検証済みです。

```bash
# 検証手順
npm run build
cc-memory --help          # CLI コマンド一覧
cc-memory doctor          # 環境チェック
```

### Deprecated → Current コマンドマッピング

v1 のドキュメントやチュートリアルに記載されていたコマンドの対応表です。

| v1 コマンド / 機能 | v3 での対応 |
|---|---|
| `cc-memory-cli team create` | `project_create` MCP ツール |
| `cc-memory-cli agent add` | `agent_register` MCP ツール |
| `cc-memory-cli agent list` | `agent_list` MCP ツール |
| `cc-memory-cli apikey regenerate` | 廃止（API キー不要） |
| `npm run start:http` | `cc-memory serve` |
| WebSocket sync | 廃止（ローカル SQLite のみ） |
| Observer ロール | 廃止（manager / worker のみ） |
| Working / Episodic / Semantic | Shared / Personal スコープ |

---

## License

MIT
