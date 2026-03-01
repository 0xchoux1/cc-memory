---
name: consolidate
description: "Deduplicate and improve cc-memory quality. Use when the user says /consolidate, 'clean up memories', 'deduplicate memories', 'merge memories', 'improve memory quality', or wants to organize and optimize stored knowledge."
version: 1.0.0
allowed-tools: mcp__cc-memory__*
---

# Memory Consolidate — メモリの品質改善

cc-memory に保存された記憶を分析し、重複の統合・品質改善を行う。
デフォルトは dry-run（変更案の提示のみ）。ユーザー承認後に実行する。

## Instructions

### Step 1: 全メモリの取得

`memory_list` で両スコープのメモリを取得する:

```
memory_list({ scope: "shared" })
memory_list({ scope: "personal" })
```

### Step 2: AIによる分析

取得したメモリを以下の観点で分析する:

**分析対象外**: `tags` に `"digest-log"` を含むエントリは分析をスキップする。

#### 2a. 重複の検出

同じことを別の表現で記述している記憶ペアを特定する。

例:
- 記憶A: 「TypeScript strict modeを使う」
- 記憶B: 「tsconfig.jsonでstrict: trueを設定すること」
→ これらは統合可能

#### 2b. 統合候補の検出

関連する断片的な記憶を1つにまとめられるケースを特定する。

例:
- 記憶A: 「APIのベースURLは /api/v2」
- 記憶B: 「APIの認証はBearer token」
- 記憶C: 「APIのレスポンスはJSON」
→ これらは「API仕様」として1つに統合可能

#### 2c. タグの問題検出

- タグがない、または不適切な記憶
- より適切なタグへの変更が必要な記憶

#### 2d. 陳腐化した記憶の検出

- 明らかに古い情報（矛盾する新しい記憶がある）
- もはや無関係な記憶

### Step 3: 変更案の提示（dry-run）

分析結果を以下の形式で一覧表示する:

```
## Consolidate 分析結果

### MERGE（統合）
1. [記憶A ID] + [記憶B ID]
   - 現在: 「...」 + 「...」
   - 統合後: 「...」
   - 理由: ...

### DELETE（削除）
1. [記憶ID]
   - 内容: 「...」
   - 理由: ...

### RETAG（タグ修正）
1. [記憶ID]
   - 内容: 「...」
   - 現在のタグ: [...]
   - 推奨タグ: [...]
   - 理由: ...

---
合計: MERGE X件 / DELETE Y件 / RETAG Z件

変更を実行しますか？ (y/n)
```

変更案がない場合は「メモリは良好な状態です。変更の必要はありません。」と報告して終了。

### Step 4: 実行（ユーザー承認後）

ユーザーが承認したら、以下の順序で変更を実行する:

#### MERGE の実行

1. 残す方の記憶を `memory_update` で更新:
   ```
   memory_update({
     memory_id: "<残すID>",
     content: "<統合後の内容>",
     caller_id: "claude-code",
     embedding: true
   })
   ```

2. 冗長な方を `memory_delete` で削除:
   ```
   memory_delete({
     memory_id: "<削除するID>",
     caller_id: "claude-code"
   })
   ```

#### DELETE の実行

```
memory_delete({
  memory_id: "<削除するID>",
  caller_id: "claude-code"
})
```

#### RETAG の実行

`memory_update` は tags を変更できないため、delete → re-store で対応する:

1. 元の記憶を削除:
   ```
   memory_delete({
     memory_id: "<元のID>",
     caller_id: "claude-code"
   })
   ```

2. 元の記憶と同じ scope / agent_id で再保存:
   ```
   memory_store({
     scope: "<元のscope>",
     agent_id: "<元のagent_id>",
     content: "<元のcontent>",
     tags: ["<新しいタグ>"],
     embedding: true
   })
   ```
   **重要**: agent_id は元の記憶のオーナーをそのまま使うこと。ハードコードしない。

### Step 5: 結果サマリー

```
## Consolidate 完了

- MERGE: X 件実行
- DELETE: Y 件実行
- RETAG: Z 件実行
- 変更前メモリ数: N 件
- 変更後メモリ数: M 件
```

## Notes

- `memory_update` は tags フィールドを受け付けないため、RETAG は delete + re-store で実施する
- digest-log エントリ（処理済みセッション記録）は分析対象外とする
- 変更は必ずユーザーの承認を得てから実行する（dry-run がデフォルト）
- 大量の変更がある場合は、カテゴリごとに分けて段階的に承認を求める
