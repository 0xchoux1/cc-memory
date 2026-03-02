---
name: digest
description: "Extract knowledge from Claude Code session logs and store in cc-memory. Use when the user says /digest, 'digest sessions', 'extract from logs', 'learn from history', or wants to automatically capture knowledge from past conversations."
version: 1.0.0
allowed-tools: Read, Grep, Glob, Bash(find:*, stat:*, python3:*), mcp__cc-memory__*
---

# Session Digest — セッションログからの知識抽出

セッションログを読み取り、有用な知識を抽出して cc-memory に保存する。

**引数**: `$ARGUMENTS` — 対象日数（デフォルト: 3）

## Instructions

### Step 0: エージェント情報と保存先 scope の確認

抽出した知識の保存先 scope を決定するため、自身の role を確認する:

```
agent_list({ project_id: "<現在のproject_id>" })
```

結果から自身の agent_id に対応する role を取得し、以下のルールで scope を決定する:

| role | 保存先 scope | 理由 |
|------|-------------|------|
| manager | `"shared"` | プロジェクト全体で共有すべき知識 |
| worker | `"personal"` | shared への書き込み権限がない |
| 未登録/不明 | `"personal"` | 安全側に倒す |

**未登録の場合**: `memory_store` が失敗するため、先にエージェントを登録する。role はプロジェクトの方針に従って設定すること:

```
agent_register({
  project_id: "<現在のproject_id>",
  agent_id: "<自身のagent_id>",
  role: "<プロジェクトでの役割: manager or worker>"
})
```

この scope を以降の Step で `<保存先scope>` として参照する。

### Step 1: 処理済みセッションの確認

`mcp__cc-memory__memory_list` で personal スコープの全メモリを取得し、`tags` に `"digest-log"` を含むエントリをフィルタする:

```
memory_list({
  scope: "personal",
  agent_id: "<実行エージェントのID>"
})
```

結果から `tags` に `"digest-log"` を含むエントリの content を収集し、処理済みセッションIDのリストを作成する。

**注意**: `memory_recall` の limit ではなく `memory_list` を使うことで、処理済みセッション数が増えても漏れなく取得できる。

### Step 2: セッションファイルの探索

`~/.claude/projects/` 配下のJSONLセッションファイルを列挙する。

```bash
# $ARGUMENTS が空なら DAYS=3、数値なら指定値を使う
DAYS="${ARGUMENTS:-3}"
# subagents/ 配下を除外してメインセッションのみ列挙
find ~/.claude/projects -name "*.jsonl" -not -path "*/subagents/*" -mtime -${DAYS} -type f 2>/dev/null
```

各ファイルのベース名（拡張子なし）がセッションIDとなる。
Step 1 で取得した処理済みセッションIDリストに含まれるものはスキップする。

未処理のセッションがない場合は「すべてのセッションは処理済みです」と報告して終了。

### Step 3: メッセージの抽出

各未処理セッションファイルから user/assistant のテキストを抽出する。
セッションファイルは数MBになることがあるため、python3スクリプトで前処理する。

以下のpython3スクリプトを実行してテキストを抽出（ファイルパスは変数で渡す）:

```bash
python3 -c '
import json, sys

seen_ids = set()
lines = []
with open(sys.argv[1], "r") as f:
    for raw in f:
        raw = raw.strip()
        if not raw:
            continue
        try:
            record = json.loads(raw)
        except json.JSONDecodeError:
            continue

        # Claude Code JSONL: type が "user" / "assistant" でロールを直接示す
        rec_type = record.get("type", "")
        if rec_type not in ("user", "assistant"):
            continue
        role = rec_type

        msg = record.get("message", {})

        # assistant のストリーミング重複を message.id でデデュプ
        msg_id = msg.get("id")
        if msg_id:
            if msg_id in seen_ids:
                continue
            seen_ids.add(msg_id)

        # content からテキスト部分のみ抽出
        content = msg.get("content", "")
        if isinstance(content, list):
            texts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    texts.append(block.get("text", ""))
                elif isinstance(block, str):
                    texts.append(block)
            content = "\n".join(texts)

        if not content.strip():
            continue

        # 長すぎるメッセージは先頭を切り出す
        if len(content) > 3000:
            content = content[:3000] + "... [truncated]"

        prefix = "User" if role == "user" else "Assistant"
        lines.append(f"[{prefix}]: {content}")

# 全体が大きすぎる場合も制限
output = "\n\n".join(lines)
if len(output) > 50000:
    output = output[:50000] + "\n\n... [truncated]"
print(output)
' "$SESSION_FILE"
```

**重要**: 抽出結果が空のセッション（テキストがない）はスキップする。

### Step 4: 知識の識別と保存

抽出テキストを読み、以下のカテゴリに分類できる知識を識別する:

| カテゴリ | tags | 例 |
|---------|------|-----|
| 設計判断・技術的決定 | `["decision"]` | アーキテクチャの選択理由、技術選定 |
| 学んだ教訓・解決したバグ | `["lesson"]` | デバッグ経験、回避策 |
| ユーザーの好み・ワークフロー | `["preference"]` | コーディングスタイル、ツール設定 |
| プロジェクトの事実 | `["fact"]` | API仕様、ディレクトリ構成、依存関係 |

各トピックについて:

1. **既存記憶との照合** — `memory_recall` で類似の記憶がないか検索:
   ```
   memory_recall({
     scope: "all",
     query: "<トピックの要約>",
     caller_id: "claude-code",
     embedding: true,
     limit: 5
   })
   ```

2. **新規の場合** — `memory_store` で保存:
   ```
   memory_store({
     scope: "<Step 0 で決定した保存先scope>",
     agent_id: "<実行エージェントのID>",
     content: "<知識の内容>",
     tags: ["<カテゴリ>", "digest"],
     embedding: true
   })
   ```

3. **既存記憶の更新が必要な場合** — `memory_update` で内容を更新:
   ```
   memory_update({
     memory_id: "<既存のID>",
     content: "<更新された内容>",
     caller_id: "claude-code",
     embedding: true
   })
   ```

**注意**: 些末な情報は保存しない。「次のセッションで役に立つか？」を基準にフィルタする。

### Step 5: 処理済み記録の保存

処理したセッションごとに digest-log を記録する:

```
memory_store({
  scope: "personal",
  agent_id: "<実行エージェントのID>",
  content: "digest-log: session=<セッションID> processed_at=<ISO timestamp> extracted=<抽出した知識の数>",
  tags: ["digest-log"]
})
```

これにより次回の `/digest` 実行時に同じセッションをスキップできる。

### Step 6: 結果サマリー

以下の形式で報告する:

```
## Digest 結果

- 対象期間: 直近 N 日
- スキャンしたセッション: X 件
- スキップ（処理済み）: Y 件
- 処理したセッション: Z 件
- 抽出した知識: N 件
  - decision: A 件
  - lesson: B 件
  - preference: C 件
  - fact: D 件
```

## Notes

- センシティブな情報（APIキー、パスワード、トークン等）は絶対に記憶に保存しない
- 1セッションあたりの抽出知識は最大10件に制限し、重要なものを優先する
- セッションファイルのパスに含まれるプロジェクト情報も文脈として活用する
