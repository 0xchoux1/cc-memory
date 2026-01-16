---
title: "cc-memory v1.1: Server Instructionsで「CLAUDE.md設定不要」を実現"
emoji: "🚀"
type: "tech"
topics: ["claude", "mcp", "ai", "typescript"]
published: false
---

## TL;DR

- cc-memory に **MCP Server Instructions** 機能を追加
- Claude Code が cc-memory の使い方を**ガイダンスとして受け取る**ように
- **CLAUDE.md への手動設定が不要**に（MCP サーバー登録は従来通り必要）

---

## 何が変わったのか

### Before: 手動設定が必要だった

以前は cc-memory を使うために、CLAUDE.md に使い方のルールを手動で記述する必要がありました。

```markdown
# CLAUDE.md に書いていた内容

## セッション開始時
1. memory_recall でユーザーの発言に関連する記憶を検索
2. semantic_search でユーザーの好みを確認
3. 検索結果を踏まえて応答する

## 記憶の保存タイミング
- 好み・設定を学んだ → semantic_create (type: preference)
- タスク完了 → episode_record (type: success)
- エラー解決 → episode_record (type: error)
```

これには以下の問題がありました：

- プロジェクトごとに CLAUDE.md を設定する手間
- 設定を忘れると記憶機能が活用されない
- バージョンアップ時に CLAUDE.md の更新が必要

### After: CLAUDE.md への記述が不要に

MCP の `instructions` 機能を使い、サーバー側から Claude に使い方を伝えるようにしました。

```typescript
// src/index.ts
const server = new McpServer({
  name: 'cc-memory',
  version: '1.1.0',
}, {
  instructions: SERVER_INSTRUCTIONS,  // ← 追加
});
```

これにより：

- **CLAUDE.md 設定不要**: MCP サーバーを登録するだけで OK
- **常に最新**: サーバー更新で instructions も更新される
- **一貫性**: どのプロジェクトでも同じ使い方

:::message
**「設定不要」の範囲について**

ここで言う「設定不要」は **CLAUDE.md への手動記述が不要** という意味です。
MCP サーバー登録自体は従来通り必要です（`~/.claude/settings.json` または `.mcp.json`）。
:::

---

## 技術的な仕組み

### MCP Server Instructions とは

MCP (Model Context Protocol) では、サーバーが `instructions` フィールドを通じてクライアント（Claude）にガイダンスを提供できます。

```typescript
const server = new McpServer(
  { name: 'cc-memory', version: '1.1.0' },
  { instructions: '...' }  // Claude に送られるガイダンス
);
```

Claude Code がサーバーに接続すると、この instructions を読み取り、サーバーの使い方のヒントとして活用します。

:::message alert
**注意**: `instructions` は MCP 仕様上「ヒント」として定義されており、クライアント実装によって適用方法が異なる場合があります。本記事の内容は Claude Code での動作確認に基づいています。
:::

### 提供している Instructions（抜粋）

cc-memory では以下のような内容を Claude に伝えています：

```markdown
# cc-memory 使用ルール

## セッション開始時（重要）

新しいセッションでユーザーの最初のメッセージを受け取ったら、必ず以下を実行すること：

1. memory_recall でユーザーの発言に関連する記憶を検索
2. semantic_search(type: "preference") でユーザーの好みを確認
3. 検索結果を踏まえて応答する

## 記憶の保存タイミング

- ユーザーの好み・設定を学んだ → semantic_create (type: preference)
- 重要な事実を学んだ → semantic_create (type: fact)
- タスクが完了した → episode_record (type: success/milestone)
- エラーを解決した → episode_record (type: error)

## importance の目安

- 8-10: 絶対に覚えておくべき（ユーザーの重要な好み、重大なマイルストーン）
- 5-7: 一般的な記憶（通常のタスク完了、学んだ事実）
- 1-4: 軽微な記憶（小さな修正、一時的な情報）
```

---

## アップデート方法

既存ユーザーは以下でアップデートできます：

```bash
cd cc-memory
git pull
npm install
npm run build
```

Claude Code を再起動すれば、新しい instructions が適用されます。

### 動作確認

instructions が正しく適用されているか確認するには：

1. Claude Code を再起動（または cc-memory サーバーへ再接続）
2. Claude に「cc-memory の使い方について、何か instructions を受け取っている？」と質問
3. セッション開始時の行動や記憶の保存タイミングについて説明があれば OK

---

## まとめ

| 項目 | Before | After |
|------|--------|-------|
| 初期設定 | CLAUDE.md に記述が必要 | **不要**（MCP 登録のみ） |
| バージョン更新時 | CLAUDE.md の更新が必要 | **不要** |
| プロジェクト間の一貫性 | 手動で維持 | **自動で保証** |

MCP Server Instructions を活用することで、「MCP サーバーを登録するだけで動く」体験を実現しました。

:::message
**セキュリティについて**: MCP サーバーは信頼できるソースからのみ利用してください。`instructions` はサーバーから Claude への指示として機能するため、悪意あるサーバーは不適切な動作を誘導する可能性があります。
:::

---

## リンク

- **リポジトリ**: https://github.com/0xchoux1/cc-memory
- **前回記事**: [「持続的記憶」を実装する ― cc-memory の設計と実装](https://zenn.dev/tshpaper/articles/cc-memory-design)

---

## Release Notes

### v1.1.0

**機能追加**
- MCP Server Instructions 対応

**修正**
- semantic memory のテストで、全文検索の対象となるテキストを使用するよう修正（タグは全文検索の対象外のため）
