# Multi-Agent Memory Sharing Guide

> Validated with cc-memory v3.2.0

マルチエージェント環境で cc-memory を使い、共有知識と個人知識を分離管理する方法を解説します。

## アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│              Project: my-app                     │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────┐                                │
│  │   Manager    │  ← shared 読み書き + 全員の     │
│  │   (lead)     │    personal 読み取り可           │
│  └──────┬───────┘                                │
│         │ manages                                │
│  ┌──────┴───────┬──────────────┐                 │
│  │              │              │                 │
│  │ Worker       │ Worker       │                 │
│  │ (web-ag)     │ (db-ag)      │                 │
│  │ shared:R     │ shared:R     │                 │
│  │ personal:RW  │ personal:RW  │                 │
│  └──────────────┴──────────────┘                 │
│                                                  │
│  ┌─────────────────────────────────────────┐     │
│  │         Shared Scope（共有層）            │     │
│  │  プロジェクト要件、コーディング規約、etc.   │     │
│  └─────────────────────────────────────────┘     │
│                                                  │
│  ┌──────────────┐  ┌──────────────┐              │
│  │ web-ag       │  │ db-ag        │              │
│  │ personal     │  │ personal     │              │
│  │ scope        │  │ scope        │              │
│  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────┘
```

## 権限モデル（2 ロール）

| 操作 | Manager | Worker |
|------|:---:|:---:|
| Shared 読み取り | ✅ | ✅ |
| Shared 書き込み | ✅ | ❌ |
| 自分の Personal 読み書き | ✅ | ✅ |
| 他人の Personal 読み取り | ✅ | ❌ |
| メモリ削除 | オーナー or 自身 | 自分のみ |

> **v1 との違い:** v1 には Observer ロールがありましたが、v3 では manager / worker の 2 ロールに簡素化されています。

## セットアップ手順

### 1. プロジェクト作成

```json
{ "tool": "project_create", "project_id": "my-app", "description": "ECサイト開発" }
```

### 2. エージェント登録

```json
{ "tool": "agent_register", "project_id": "my-app", "agent_id": "lead", "role": "manager" }
{ "tool": "agent_register", "project_id": "my-app", "agent_id": "web-ag", "role": "worker" }
{ "tool": "agent_register", "project_id": "my-app", "agent_id": "db-ag", "role": "worker" }
```

### 3. 共有知識を保存（Manager）

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

### 4. 共有知識を参照 & 個人メモリに記録（Worker）

```json
// 共有知識を検索
{
  "tool": "memory_recall",
  "scope": "shared",
  "query": "tech-stack",
  "caller_id": "web-ag",
  "project_id": "my-app"
}

// 個人メモリに作業記録を保存
{
  "tool": "memory_store",
  "scope": "personal",
  "agent_id": "web-ag",
  "content": "Nginx リバースプロキシ設定完了。ポート 3000 → 80 に転送。",
  "tags": ["nginx", "infra"],
  "project_id": "my-app"
}
```

### 5. Manager が全体を把握

```json
// 全 worker の personal メモリを閲覧可能
{
  "tool": "memory_recall",
  "scope": "all",
  "query": "作業進捗",
  "caller_id": "lead",
  "project_id": "my-app"
}
```

## ベストプラクティス

- **Manager は 1 プロジェクトに 1 人** — 権限の明確化
- **tags を活用** — recall の精度が上がる
- **shared vs personal の判断** — チーム全体に必要 → shared、個人の経験 → personal
- **recall → store** — 保存前に既存メモリを確認して重複を避ける
- **1 メモリ = 1 トピック** — 粒度が細かい方が検索精度が高い

## Deprecated → Current コマンドマッピング

v1 のドキュメントに記載されていた以下のコマンド・機能は v3 では廃止されています。

| v1 コマンド / 機能 | v3 での対応 |
|---|---|
| `cc-memory-cli team create` | `project_create` MCP ツール |
| `cc-memory-cli agent add` | `agent_register` MCP ツール |
| `cc-memory-cli agent list` | `agent_list` MCP ツール |
| `cc-memory-cli apikey regenerate` | 廃止（API キー不要） |
| `npm run start:http` | `cc-memory serve`（stdio MCP） |
| WebSocket sync (`/sync`) | 廃止（ローカル SQLite のみ） |
| CRDT conflict resolution | 廃止 |
| Observer ロール | 廃止（manager / worker のみ） |
| HTTP API (`/mcp`, `/register`) | 廃止（stdio MCP のみ） |
| `~/.claude-memory/api-keys.json` | 廃止（RBAC は DB 内で管理） |
| Working / Episodic / Semantic メモリ | Shared / Personal スコープ |
