---
name: improve
description: "Pick the next improvement from ROADMAP.md and implement it. Use when the user says /improve, 'improve cc-memory', 'next improvement', or wants to work on the roadmap."
version: 1.0.0
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, mcp__cc-memory__*, Agent, EnterPlanMode, ExitPlanMode
---

# Improve — cc-memory の継続的改善

ROADMAP.md の最優先項目を選び、実装→テスト→PR→ROADMAP更新の一連フローを実行する。

**引数**: `$ARGUMENTS` — 特定の項目を指定（省略時は Now セクションの先頭を選択）

## Instructions

### Step 1: 現状把握

1. `ROADMAP.md` を読み、現在の優先事項を把握
2. cc-memory の記憶から過去の改善コンテキストを取得:
   ```
   memory_recall({
     scope: "all",
     query: "cc-memory improvement roadmap",
     caller_id: "claude-code",
     embedding: true,
     limit: 5
   })
   ```
3. コード健全性チェック:
   ```bash
   echo "=== Code Health ===" && find src -name "*.ts" | xargs wc -l | tail -1 && find src -name "*.ts" | wc -l && echo "files"
   ```

### Step 2: 項目選択

- `$ARGUMENTS` が指定されていれば、ROADMAP.md から該当項目を探す
- 未指定なら **Now** セクションの先頭項目を選択
- 選択した項目が src/ の行数リミット（2,000行）内で実装可能か事前評価

### Step 3: 実装計画

EnterPlanMode を使って実装計画をユーザーに提示:

- 変更ファイル一覧
- 想定行数増分
- テスト方針
- リスク・トレードオフ

**ユーザーの承認を得てから実装に着手すること。**

### Step 4: 実装

1. feature ブランチを作成: `git checkout -b feat/<slug>`
2. コード実装
3. テスト追加・全 pass 確認: `npx vitest run`
4. README 更新（API 追加・変更があれば）
5. CHANGES.md に記録
6. コード健全性の再チェック

### Step 5: PR 作成

```bash
git add <files>
git commit -m "feat: <description>"
git push -u origin feat/<slug>
gh pr create --title "<title>" --body "<body>"
```

### Step 6: ROADMAP.md 更新

- 完了した項目を **Done** セクションに移動（チェック付き）
- 必要に応じて **Now** に次の項目を昇格

### Step 7: 記憶に記録

```
memory_store({
  scope: "shared",
  agent_id: "claude-code",
  content: "cc-memory improvement: <実装内容の要約>",
  tags: ["improvement", "roadmap"],
  embedding: true
})
```

## Notes

- src/ の総行数 2,000行リミットを厳守
- 1ファイル 500行を超えたら分割を検討
- 「この機能、本当に cc-memory の責務か？」を自問
- テストなしの変更は禁止
- CLAUDE.md のエンジニアリング標準に従うこと
