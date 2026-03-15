# 5-Minute Quickstart

> cc-memory v3.2.0 — インストールから最初の recall まで 5 分以内

## TL;DR — 最短3コマンド

```bash
npm install -g cc-memory && cc-memory setup
```

Claude Code で:
```
memory_store を実行: scope="shared", agent_id="me", content="Hello cc-memory!", project_id="default"
memory_recall を実行: scope="shared", query="Hello", caller_id="me", project_id="default"
```

ここまでで動作確認完了。詳細は以下のステップで。

---

## Step 1: インストール（1分）

```bash
npm install -g cc-memory
cc-memory setup
```

期待される出力:
```
Setting up cc-memory v3...
  sqlite-vec: enabled ✅
Database created at: /path/to/cc-memory.db
Setup complete.
```

> sqlite-vec が `not available ⚠️` でも動作します（キーワード検索のみになります）。

## Step 2: Claude Code に接続（1分）

`~/.claude/settings.json` に追加:

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

Claude Code を再起動して、MCP ツールが認識されていることを確認:

```
> cc-memory の memory_store ツールを使えますか？
```

## Step 3: プロジェクト & エージェント登録（1分）

Claude Code 内で以下を依頼:

```
以下のツールを順番に実行してください:

1. project_create: project_id="my-app", description="テスト用プロジェクト"
2. agent_register: project_id="my-app", agent_id="lead", role="manager"
```

期待される出力:
```json
// project_create
{ "success": true, "project_id": "my-app" }

// agent_register
{ "success": true, "agent_id": "lead", "role": "manager", "project_id": "my-app" }
```

## Step 4: メモリを保存（shared + personal）（1分）

### Shared メモリ（チーム共有）

```
memory_store を実行:
  scope: "shared"
  agent_id: "lead"
  content: "本番デプロイは金曜を避ける。週末の障害対応リスクがある。"
  tags: ["deploy", "rule"]
  project_id: "my-app"
```

期待される出力:
```json
{ "success": true, "memory_id": "mem_xxxxx", "scope": "shared" }
```

### Personal メモリ（個人用）

```
memory_store を実行:
  scope: "personal"
  agent_id: "lead"
  content: "Nginx のリバースプロキシ設定で port 3000 → 80 に転送した"
  tags: ["nginx", "infra"]
  project_id: "my-app"
```

## Step 5: メモリを検索（1分）

### memory_recall

```
memory_recall を実行:
  scope: "shared"
  query: "デプロイルール"
  caller_id: "lead"
  project_id: "my-app"
```

期待される出力:
```json
{
  "memories": [
    {
      "id": "mem_xxxxx",
      "content": "本番デプロイは金曜を避ける。週末の障害対応リスクがある。",
      "tags": ["deploy", "rule"],
      "score": 0.85
    }
  ]
}
```

### session_recall（直近のセッションログ検索）

```
session_recall を実行:
  query: "デプロイ"
  caller_id: "lead"
```

> `session_recall` は `~/.claude/projects/` 配下のセッション JSONL を自動インデックスして検索します。
> 初回は未インデックスのセッションがあるためインデックス構築が走ります。

---

## ここまでの成果

5 分で以下が完了:

- [x] cc-memory インストール & DB 初期化
- [x] Claude Code に MCP サーバーとして接続
- [x] プロジェクト作成 & エージェント登録
- [x] Shared / Personal メモリの保存
- [x] memory_recall で検索成功
- [x] session_recall で直近セッション検索

---

## トラブルシューティング

### 1. `cc-memory setup` で `better-sqlite3` エラー

```
Error: Cannot find module 'better-sqlite3'
```

**対処:** Node.js のバージョンを確認（>= 18.0.0 必要）。`npm install -g cc-memory` を再実行。

```bash
node --version  # v18+ であることを確認
npm install -g cc-memory
```

### 2. Claude Code が cc-memory のツールを認識しない

**対処:**
1. `~/.claude/settings.json` の JSON 構文を確認（カンマ漏れ等）
2. Claude Code を完全に再起動
3. `cc-memory doctor` で環境チェック

```bash
cc-memory doctor
```

期待される出力:
```
cc-memory v3 doctor

Node.js: v22.x.x ✅
better-sqlite3: installed ✅
sqlite-vec: installed ✅
Database: /path/to/cc-memory.db ✅
  Projects: 1
  Vector search: enabled
```

### 3. `memory_recall` が結果を返さない

**対処:**
- `project_id` が store 時と recall 時で一致しているか確認
- `scope` が正しいか確認（shared に保存したのに personal で検索していないか）
- `caller_id` に指定したエージェントが `agent_register` で登録済みか確認

---

## 次のステップ

- **マルチエージェント構成:** → [docs/MULTI_AGENT.md](MULTI_AGENT.md)
- **全 API リファレンス:** → [README.md](../README.md#mcp-api-一覧)
- **ベストプラクティス:** → [README.md](../README.md#ベストプラクティス)
