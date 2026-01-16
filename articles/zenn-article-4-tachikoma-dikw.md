---
title: "cc-memory v1.2: タチコマ並列化とDIKW知恵昇華 ― AIエージェントの記憶を進化させる"
emoji: "🤖"
type: "tech"
topics: ["claude", "mcp", "ai", "typescript", "memory"]
published: false
---

## TL;DR

- **タチコマ並列化**: 複数のClaudeインスタンス間で記憶を同期（攻殻機動隊のタチコマからインスパイア）
- **DIKW知恵昇華**: 生の経験 → パターン → 洞察 → 知恵へと知識を昇華
- **マルチエージェント協調**: 誰が何を学んだかを追跡

https://github.com/0xchoux1/cc-memory

---

## 背景: なぜこの機能が必要か

[前々回の記事](https://zenn.dev/tshpaper/articles/b849add53f7226)で、AIの自律性向上に必要な4つの要素を挙げました。

```
┌─────────────────────────────────────────────────────────────┐
│ AIエージェントの自律性向上（L0→L4）                         │
├─────────────────────────────────────────────────────────────┤
│ LLMの4つの欠落:                                             │
│ 1. 階層型メモリシステム ← cc-memory 基本機能                │
│ 2. 外部トリガー＋目標管理                                   │
│ 3. 常駐プロセス＋イベントストリーム                         │
│ 4. アクションコストモデル                                   │
└─────────────────────────────────────────────────────────────┘
```

cc-memory は「階層型メモリシステム」を提供していましたが、今回のアップデートでさらに2つの課題を解決します：

1. **知識の孤立**: 複数のClaudeインスタンスが別々に学習しても、その知識は共有されない
2. **経験の未活用**: 個別の経験が蓄積されても、そこから普遍的な原則を抽出できていない

---

## 新機能1: タチコマ並列化

### インスピレーション: 攻殻機動隊のタチコマ

攻殻機動隊に登場するAI搭載戦車「タチコマ」は、毎晩「並列化」を行います。各機体がその日に得た経験を共有し、全機体で同じ記憶を持つようになります。

cc-memoryは、この「並列化」をファイルベースで実現しました。

```
┌─────────────────┐     export     ┌─────────────────┐
│   Tachikoma A   │ ────────────▶  │   memory.json   │
│  (開発環境)      │                │   (共有ファイル)  │
└─────────────────┘                └────────┬────────┘
                                            │ import
                                            ▼
                                   ┌─────────────────┐
                                   │   Tachikoma B   │
                                   │  (テスト環境)    │
                                   └─────────────────┘
```

### 使い方

```typescript
// 各インスタンスを初期化
tachikoma_init({
  id: "tachi-dev",
  name: "Development Tachikoma"
});

// 記憶をエクスポート
const exported = tachikoma_export({
  since_timestamp: lastSyncTime  // 差分のみエクスポート可能
});

// 別インスタンスでインポート
tachikoma_import({
  data: exported,
  strategy: "merge_learnings",  // 競合時の解決戦略
  auto_resolve: true
});
```

### 競合解決戦略

同じ記憶が両方のインスタンスで変更された場合、以下の戦略で解決できます：

| 戦略 | 説明 |
|------|------|
| `newer_wins` | 新しい方を採用 |
| `merge_learnings` | 学習内容をマージ（エピソード記憶向け） |
| `merge_observations` | 観察をマージ（意味記憶向け） |
| `higher_importance` | 重要度が高い方を採用 |
| `higher_confidence` | 信頼度が高い方を採用 |
| `manual` | 手動で解決 |

```typescript
// 競合を確認
const conflicts = tachikoma_conflicts({ unresolved_only: true });

// 手動で解決
tachikoma_resolve_conflict({
  conflict_id: "conflict-123",
  resolution: "local"  // local, remote, merge
});
```

---

## 新機能2: DIKW知恵昇華

### DIKWモデルとは

DIKWは知識管理の階層モデルです：

- **D**ata: 生データ
- **I**nformation: 文脈を持ったデータ
- **K**nowledge: 活用可能な知識
- **W**isdom: 普遍的な原則・判断基準

cc-memoryでは、これを記憶の昇華プロセスとして実装しました：

```
Level 1: Raw Experience（エピソード記憶）
    │
    │  観察・分析
    ▼
Level 2: Pattern（パターン）
    │  「大量APIレスポンスでUIが固まる」
    │
    │  複数パターンの統合
    ▼
Level 3: Insight（洞察）
    │  「フロントエンド・バックエンド両方が無制限データ取得で被害を受ける」
    │
    │  普遍化・原則化
    ▼
Level 4: Wisdom（知恵）
    「すべてのコレクションAPIは、デフォルトでページネーションと制限を持つべき」
```

### 具体例: API設計の知恵への昇華

```typescript
// 1. パターンを記録（Level 2）
pattern_create({
  pattern: "大量のAPIレスポンスがUIをブロックする",
  supporting_episodes: ["ep-123"],  // 根拠となるエピソード
  confidence: 0.8,
  related_tags: ["API", "performance", "frontend"]
});

pattern_create({
  pattern: "無制限クエリがDBコネクションを枯渇させる",
  supporting_episodes: ["ep-456"],
  confidence: 0.85,
  related_tags: ["API", "database", "backend"]
});

// 2. 洞察を生成（Level 3）
insight_create({
  insight: "フロントエンドとバックエンドの両方が無制限データ取得で問題を起こす",
  reasoning: "異なるドメインで同様のパターンが観察された",
  source_patterns: ["pattern-123", "pattern-456"],
  domains: ["API", "Performance"],
  confidence: 0.9
});

// 3. 知恵に昇華（Level 4）
wisdom_create({
  name: "APIデフォルト制限の原則",
  principle: "すべてのコレクション取得APIは、デフォルトでページネーション、フィルタリング、フィールド選択をサポートし、無制限取得を禁止すべきである",
  description: "大量データ取得はフロントエンドのUI固まりとバックエンドのリソース枯渇の両方を引き起こす。これを防ぐために、APIは設計段階からデフォルト制限を持つべき。",
  derived_from_insights: ["insight-789"],
  derived_from_patterns: ["pattern-123", "pattern-456"],
  applicable_domains: ["API設計", "REST", "GraphQL"],
  applicable_contexts: ["新規API開発", "API改善", "コードレビュー"],
  limitations: ["内部専用APIでは適用不要な場合がある"]
});
```

### 知恵の活用と検証

知恵は使うたびにフィードバックを記録し、信頼度が更新されます：

```typescript
// 知恵を検索
const wisdom = wisdom_search({
  query: "API設計",
  domains: ["REST"]
});

// 知恵を適用した結果を記録
wisdom_apply({
  wisdom_id: "wisdom-123",
  context: "新規ユーザー一覧APIの設計",
  result: "success",  // success, failure, partial
  feedback: "ページネーションを実装し、パフォーマンス問題を未然に防止"
});
```

成功率に基づいて信頼度が自動更新され、より信頼性の高い知恵が優先されるようになります。

---

## 新機能3: マルチエージェント協調

### 誰が何を学んだか

複数の専門エージェントが協調して作業する場合、各エージェントの専門性に応じた知識を追跡できます：

```typescript
// エージェントを登録
agent_register({
  name: "Frontend Specialist",
  role: "frontend",
  specializations: ["React", "TypeScript", "CSS"],
  capabilities: ["UI開発", "パフォーマンス最適化"],
  knowledge_domains: ["Web開発", "UX"]
});

agent_register({
  name: "Backend Engineer",
  role: "backend",
  specializations: ["Node.js", "PostgreSQL", "Redis"],
  capabilities: ["API設計", "データベース設計"],
  knowledge_domains: ["サーバーサイド", "インフラ"]
});
```

パターンや洞察には、どのエージェントが発見したかが記録されます。これにより：

- 専門分野ごとの知識の蓄積
- クロスドメインな洞察の発見
- エージェント間の知識共有

---

## テスト結果

今回のアップデートで追加されたテスト：

- **TachikomaParallelization.test.ts**: 15テスト
- **WisdomDIKW.test.ts**: 20テスト
- **動作テストスクリプト**: 10テスト

全138テストがパスしています。

---

## アップデート方法

```bash
cd cc-memory
git pull
npm install
npm run build
```

Claude Codeを再起動すれば、新しいツールが利用可能になります。

---

## まとめ

| 機能 | 解決する課題 | ツール |
|------|-------------|--------|
| タチコマ並列化 | 複数インスタンス間の知識孤立 | `tachikoma_*` |
| DIKW知恵昇華 | 経験から原則を抽出 | `pattern_*`, `insight_*`, `wisdom_*` |
| マルチエージェント | 専門知識の追跡 | `agent_*` |

これらの機能により、cc-memoryは単なる「記憶」から「学習し、知恵を蓄積するシステム」へと進化しました。

---

## 今後の展望

- **自動パターン発見**: エピソードから自動的にパターンを抽出
- **自動洞察生成**: 複数パターンから自動的に洞察を生成
- **統合リコール**: すべての記憶層を横断した智的な検索

---

## リンク

- **リポジトリ**: https://github.com/0xchoux1/cc-memory
- **前回記事**: [cc-memory v1.1: Server Instructionsで「設定不要」を実現](...)
- **最初の記事**: [「持続的記憶」を実装する ― cc-memory の設計と実装](...)
- **背景記事**: [AIを動かすのは簡単、自分で動くAIは難しい](https://zenn.dev/tshpaper/articles/b849add53f7226)
