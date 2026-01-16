---
title: "cc-memory v1.1: Server Instructionsで「設定不要」を実現"
emoji: "🚀"
type: "tech"
topics: ["claude", "mcp", "ai", "typescript"]
published: false
---

## TL;DR

- cc-memory に **MCP Server Instructions** 機能を追加
- Claude Code が cc-memory の使い方を**自動的に理解**するように
- CLAUDE.md への手動設定が不要に

---

## 何が変わったのか

### Before: 手動設定が必要だった

以前は cc-memory を使うために、CLAUDE.md に使い方のルールを手動で記述する必要がありました。

```markdown
# CLAUDE.md に書いていた内容

## セッション開始時
1. memory_recall でユーザーの発言に関連する記憶を検索
2. semantic_search でユーザーの好みを確認
...
```

これには以下の問題がありました：

- プロジェクトごとに CLAUDE.md を設定する手間
- 設定を忘れると記憶機能が活用されない
- バージョンアップ時に CLAUDE.md の更新が必要

### After: 設定なしで動作

MCP の `instructions` 機能を使い、サーバー側から Claude に使い方を伝えるようにしました。

```typescript
// src/index.ts
const server = new McpServer({
  name: 'cc-memory',
  version: '1.0.0',
}, {
  instructions: SERVER_INSTRUCTIONS,  // ← 追加
});
```

これにより：

- **設定不要**: MCP サーバーを登録するだけで OK
- **常に最新**: サーバー更新で instructions も更新される
- **一貫性**: どのプロジェクトでも同じ使い方

---

## 技術的な仕組み

### MCP Server Instructions とは

MCP (Model Context Protocol) では、サーバーが `instructions` フィールドを通じてクライアント（Claude）にガイダンスを提供できます。

```typescript
const server = new McpServer(
  { name: 'cc-memory', version: '1.0.0' },
  { instructions: '...' }  // Claude に送られる指示
);
```

Claude Code がサーバーに接続すると、この instructions を読み取り、サーバーの適切な使い方を理解します。

### 提供している Instructions

cc-memory では以下の内容を Claude に伝えています：

1. **セッション開始時の行動**
   - `memory_recall` で関連記憶を検索
   - `semantic_search` でユーザーの好みを確認

2. **記憶の保存タイミング**
   - 好み・設定を学んだ → `semantic_create`
   - タスク完了 → `episode_record`
   - エラー解決 → `episode_record`

3. **重要度の目安**
   - 8-10: 絶対に覚えておくべき
   - 5-7: 一般的な記憶
   - 1-4: 軽微な記憶

4. **自動学習の指示**
   - 「覚えて」と言われなくても重要な情報は自主的に記憶

---

## アップデート方法

既存ユーザーは以下でアップデートできます：

```bash
cd cc-memory
git pull
npm install
npm run build
```

Claude Code を再起動すれば、自動的に新しい instructions が適用されます。

---

## その他の変更

### テストの修正

semantic memory のテストで、全文検索の対象となるテキストを使用するよう修正しました。

```diff
- const result = manager.recall('security', { ... });
+ const result = manager.recall('HTTPS', { ... });
```

タグは全文検索の対象外のため、description に含まれるテキストを使用する必要があります。

---

## まとめ

| 項目 | Before | After |
|------|--------|-------|
| 初期設定 | CLAUDE.md に記述が必要 | 不要 |
| バージョン更新時 | CLAUDE.md の更新が必要 | 不要 |
| プロジェクト間の一貫性 | 手動で維持 | 自動で保証 |

MCP Server Instructions を活用することで、「インストールするだけで動く」体験を実現しました。

---

## リンク

- **リポジトリ**: https://github.com/0xchoux1/cc-memory
- **前回記事**: [「持続的記憶」を実装する ― cc-memory の設計と実装](https://zenn.dev/tshpaper/articles/...)
