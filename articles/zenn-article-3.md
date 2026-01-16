---
title: "「持続的記憶」を実装する ― Claude Code用メモリシステム cc-memory の設計と実装"
emoji: "🧠"
type: "tech"
topics: ["claude", "mcp", "ai", "typescript", "memory"]
published: false
---

## TL;DR

- Claude Codeはセッションが終わると全てを忘れる
- cc-memoryは **セッションを跨いで経験と知識を蓄積**するMCPサーバー
- 人間の記憶モデルに倣った3層構造（Working / Episodic / Semantic）

https://github.com/0xchoux1/cc-memory

---

## 何が解決するのか

Claude Codeで開発していると、こんな「忘却コスト」が頻発します。

- 昨日解決したエラーを、また一から調べ直す
- 前回の設計判断の理由が消えて、手戻りが発生する
- プロジェクト固有の手順やルールを毎回説明し直す

### Before / After

```
# Before（記憶なし）
─────────────────────────────────
セッション1:
  User: PostgreSQLの接続エラーを解決して
  Claude: [調査して解決。プールサイズを50に増加]

セッション2（翌日）:
  User: また同じエラーが出た
  Claude: エラーを見せてください。調査します...
          [また一から調査を開始]
```

```
# After（cc-memory導入後）
─────────────────────────────────
セッション1:
  User: PostgreSQLの接続エラーを解決して
  Claude: [調査して解決]
          [解決方法をエピソード記憶に保存]

セッション2（翌日）:
  User: また同じエラーが出た
  Claude: [過去の記憶を検索]
          「以前同様のエラーを解決しています。
           原因はコネクションプール枯渇で、
           プールサイズを50に増やして解決しました」
```

---

## なぜLLMは「忘れる」のか

[前々回の記事](https://zenn.dev/tshpaper/articles/b849add53f7226)で、AIが自律的に動けない理由として4つの欠落を指摘しました。

1. **持続的な記憶** ← 今回のテーマ
2. 内発的動機
3. 環境との継続的相互作用
4. 身体性/コスト感覚

LLMはコンテキストウィンドウに依存しており、セッションが終われば全てを失います。モデルの重み自体は更新できませんが、**運用時に参照できる形で外部に蓄積する**ことは可能です。cc-memoryはこのアプローチで「持続的記憶」を実現します。

---

## cc-memory の全体像

人間の記憶システムに倣い、3層の階層構造を採用しました。

```
┌─────────────────────────────────────────────┐
│              Claude Code                     │
└─────────────────┬───────────────────────────┘
                  │ MCP Protocol
┌─────────────────▼───────────────────────────┐
│             cc-memory                        │
│  ┌─────────────────────────────────────┐    │
│  │   Working Memory（作業記憶）         │    │
│  │   短期・TTL付き・セッション中の文脈   │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │   Episodic Memory（エピソード記憶）  │    │
│  │   出来事・経験・成功/失敗の記録      │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │   Semantic Memory（意味記憶）        │    │
│  │   事実・手順・パターン・スキル       │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │   SQLite（sql.js / WASM）           │    │
│  │   ~/.claude-memory/memory.db        │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

| 層 | 人間の記憶 | 役割 | 保持期間 |
|----|-----------|------|----------|
| Working | 作業記憶 | 現在のタスク状態、一時的な文脈 | TTL（30分〜24時間） |
| Episodic | エピソード記憶 | 出来事の記録（成功/失敗/インシデント） | 永続 |
| Semantic | 意味記憶 | 事実・手順・パターンの知識 | 永続 |

---

## Quickstart

### インストール

```bash
git clone https://github.com/0xchoux1/cc-memory.git
cd cc-memory
npm install
npm run build
```

### Claude Code設定

`~/.claude/settings.json` に追加：

```json
{
  "mcpServers": {
    "cc-memory": {
      "command": "node",
      "args": ["/path/to/cc-memory/dist/index.js"],
      "env": {
        "MEMORY_DATA_PATH": "/home/yourname/.claude-memory"
      }
    }
  }
}
```

### 動作確認

Claude Codeで以下を試す：

```
何か覚えておいてほしいことはある？と聞いて、
working_set や semantic_create が使えれば成功
```

**データの保存先**: `$MEMORY_DATA_PATH/memory.db`（SQLiteファイル）

---

## 記憶のライフサイクル

### 記憶はどうやって入るのか？

現状は以下の2つの経路があります。

| 経路 | 説明 | 例 |
|------|------|-----|
| **手動記録** | Claude が明示的にAPIを呼ぶ | ユーザーが「覚えて」と言う |
| **ルールベース** | 特定条件で自動記録 | エラー解決時、タスク完了時 |

```typescript
// 例：エラー解決後に自動記録するルール
// Claude Code の振る舞いとして設定
episode_record({
  type: "error",
  summary: "PostgreSQL接続タイムアウト解決",
  details: "プールサイズを10→50に変更",
  outcome: {
    status: "success",
    learnings: ["デフォルトのプールサイズは本番には不足"]
  }
});
```

**将来的な展望**: イベントフック（コミット時、テスト失敗時など）での自動記録を検討中。

### 記憶の統合（Consolidation）

作業記憶の内容を、長期記憶（エピソード/意味記憶）に昇格できます。

```typescript
// 作業結果をエピソード記憶に昇格
memory_consolidate({
  working_key: "task-result",
  target_type: "episodic",
  metadata: {
    episode_type: "success",
    summary: "認証機能の実装完了",
    importance: 8
  }
});
```

**トリガーの設計指針**:
- タスク完了時 → エピソード記憶へ
- 繰り返し使う知識 → 意味記憶へ
- 一時的な文脈 → 作業記憶のまま（TTLで自動削除）

### 想起（Recall）

関連性スコアリングによる横断検索：

```typescript
smart_recall({
  query: "認証 エラー",
  recency_weight: 0.3,
  importance_weight: 0.4,
  confidence_weight: 0.3
});
```

**スコア計算式**:

```
relevance = (text_match × 0.4)
          + (recency_score × recency_weight)
          + (importance_score × importance_weight)
          + (access_boost × 0.1)
```

- `recency_score`: 週ごとに5%減衰（`0.95^週数`）
- `importance_score`: 重要度(1-10)を0-1に正規化
- `access_boost`: アクセス回数 × 0.1（上限1.0）

### 減衰とブースト

人間の記憶と同様に、時間経過で重要度を減衰させ、頻繁にアクセスされる記憶は強化します。

```typescript
// 古い記憶の重要度を減衰
memory_decay({
  decay_factor: 0.95,      // 5%減衰
  older_than_days: 7,
  min_importance: 1        // 下限
});

// 頻繁にアクセスされる記憶を強化
memory_boost({
  boost_factor: 1.1,       // 10%強化
  min_access_count: 5,
  max_importance: 10       // 上限
});
```

---

## 各メモリ層の詳細

:::details Working Memory（作業記憶）

現在のセッションで必要な一時的な情報を保持します。

```typescript
working_set({
  key: "current-task",
  value: { taskId: "auth-impl", step: 2 },
  type: "task_state",
  ttl: 86400000,  // 24時間（ミリ秒）
  priority: "high"
});
```

**タイプ別デフォルトTTL**:

| type | TTL | 用途 |
|------|-----|------|
| `task_state` | 24時間 | タスクの状態 |
| `decision` | 4時間 | 意思決定の記録 |
| `context` | 1時間 | 一般的な文脈 |
| `scratch` | 30分 | 一時メモ |

:::

:::details Episodic Memory（エピソード記憶）

過去の出来事・経験を記録します。

```typescript
episode_record({
  type: "error",
  summary: "PostgreSQL接続タイムアウト",
  details: "ピーク時にコネクションプールが枯渇...",
  outcome: {
    status: "success",
    learnings: [
      "プールサイズ10は本番環境には不足",
      "指数バックオフによるリトライが有効"
    ],
    resolution: "プールサイズを50に増加"
  },
  importance: 8,
  tags: ["database", "performance"]
});
```

**エピソードタイプ**: `incident` | `interaction` | `milestone` | `error` | `success`

:::

:::details Semantic Memory（意味記憶）

事実、手順、パターンなどの知識を構造化して保存します。

```typescript
semantic_create({
  name: "deploy-procedure",
  type: "procedure",
  description: "本番デプロイ手順",
  procedure: {
    steps: ["テスト実行", "ビルド", "イメージプッシュ", "デプロイ"],
    preconditions: ["全テストパス", "mainブランチ"],
    postconditions: ["ヘルスチェック成功"]
  },
  confidence: 0.95,
  tags: ["devops"]
});

// エンティティ間の関係
semantic_relate({
  from: "deploy-procedure",
  to: "rollback-procedure",
  relation_type: "has_fallback",
  strength: 1.0
});
```

**エンティティタイプ**: `procedure` | `fact` | `config` | `preference` | `pattern` | `skill`

:::

---

## 技術的な実装詳細

### なぜ sql.js か

| 選択肢 | メリット | デメリット |
|--------|---------|-----------|
| better-sqlite3 | 高速 | ネイティブコンパイル必要、OS依存 |
| **sql.js** | ポータブル、Win/Mac/Linux対応 | やや低速 |
| JSONファイル | シンプル | 検索非効率、肥大化 |

MCPサーバーは様々な環境で動作する必要があるため、ポータビリティを優先しました。

### 永続化の仕組み

- sql.jsはWASM上でSQLiteを実行
- 操作のたびに `memory.db` ファイルに書き戻し
- デフォルト保存先: `~/.claude-memory/memory.db`
- 環境変数 `MEMORY_DATA_PATH` で変更可能

**サイズが大きくなった場合**:
- `memory_export` で全データをJSONエクスポート
- 古いエピソードの `memory_decay` で重要度を下げる
- 定期的なバックアップを推奨

---

## 制限事項と注意点（Limitations）

### 自動記録の限界

現状は手動/ルールベースでの記録が前提です。完全自動化（「いつ何を記録するか」の判断をAI任せにする）は今後の課題です。

### 記憶の正確性

- エピソード記憶は **Claude が記録した内容**であり、事実との一致を保証しません
- `confidence` で信頼度を管理しますが、誤情報が固定化するリスクはあります
- 定期的なレビューと修正を推奨

### セキュリティ

| 項目 | 現状 | 今後 |
|------|------|------|
| 保存対象 | フィルタなし | 秘密情報の自動除外を検討 |
| 暗号化 | なし | オプションで対応予定 |
| アクセス制御 | ローカルファイル前提 | マルチユーザーは未対応 |

**現時点での推奨**:
- APIキー、パスワード、顧客情報は記録しない運用ルールを設ける
- `~/.claude-memory/` のパーミッションを適切に設定
- チーム共有は非推奨（個人利用前提）

### プロンプトインジェクション

外部入力（ログ、エラーメッセージなど）をそのまま記録すると、悪意あるコンテンツが長期化するリスクがあります。[前回の記事](https://zenn.dev/tshpaper/articles/0f1ce0830f9bfb)で述べた入力汚染対策と組み合わせることを推奨します。

---

## まとめと今後の展望

cc-memoryにより、Claude Codeに「持続的記憶」を追加しました。

**実現したこと**:
- セッションを跨いだ記憶の継続
- 過去の経験からの学習
- 知識のグラフ構造化
- 記憶の自然な減衰と強化

**残る3つの欠落**:

| 欠落 | 対策案 | 状態 |
|------|--------|------|
| 内発的動機 | Goal Scheduler、自己生成タスク | 未着手 |
| 環境との継続的相互作用 | イベントストリーム、Webhook統合 | 検討中 |
| 身体性/コスト感覚 | 実行コストモデル、リスク評価 | 検討中 |

---

## リンク

- **リポジトリ**: https://github.com/0xchoux1/cc-memory
- **前回記事**: [なぜAIは自律的に動けないのか？](https://zenn.dev/tshpaper/articles/b849add53f7226)
- **前々回記事**: [自律的AI運用を実現するアーキテクチャ設計](https://zenn.dev/tshpaper/articles/0f1ce0830f9bfb)

質問やフィードバックがあれば、コメントやIssueでお知らせください。
