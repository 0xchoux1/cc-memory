# cc-memory

**Claude Code に「記憶」を与える MCP サーバー**

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io/)

<!-- TODO: デモGIFを追加
![cc-memory demo](./docs/assets/demo.gif)
-->

---

## 概要

cc-memory は、Claude Code（Anthropic の AI コーディングアシスタント）に**長期記憶**を与えるツールです。

### 何ができるか

- **前回の会話を覚えている** - セッションをまたいで、あなたの好みやプロジェクトの情報を記憶
- **過去の経験から学ぶ** - 成功したこと、失敗したこと、学んだことを蓄積
- **知識を整理する** - プロジェクトのルール、手順、パターンを体系的に管理

### 誰のためか

- **プログラマー**: 日々のコーディング作業を Claude Code と一緒に行う方
- **チーム**: 複数の Claude インスタンス間で知識を共有したい方
- **誰でも**: 専門知識がなくても、コマンド一つでセットアップできます

### 特徴

| 機能 | 説明 |
|------|------|
| **3層メモリ** | 短期・経験・知識の3つの記憶層で情報を管理 |
| **OODA ループ** | 観察→状況判断→計画→実行の自律開発サイクル |
| **Tachikoma 同期** | 複数の Claude インスタンス間で記憶を共有 |
| **DIKW ピラミッド** | 経験をパターン→洞察→知恵へと昇華 |

---

## インストール

### 必要なもの

- Node.js 18.0.0 以上
- Claude Code（または MCP 対応クライアント）

### セットアップ

```bash
# グローバルインストール
npm install -g cc-memory

# セットアップウィザードを実行
cc-memory setup
```

これだけで完了です。Claude Code が自動的に cc-memory を認識し、記憶機能を使い始めます。

---

## クイックスタート

初めての方は、対話型チュートリアルで学ぶのがおすすめです。

```bash
cc-memory tutorial
```

<!-- TODO: チュートリアルのスクリーンショットを追加
![Tutorial Screenshot](./docs/assets/tutorial.png)
-->

チュートリアルでは、以下のことが体験できます:

1. 記憶の保存と検索
2. 3層メモリの使い分け
3. OODA ループの実践

---

## OODA コマンド

Claude Code 内で使える特別なコマンド（スラッシュコマンド）です。

| コマンド | 説明 | 使用例 |
|---------|------|--------|
| `/observe` | 現状把握 - 現在の状況を確認し、関連する記憶を呼び出す | 「今のプロジェクトの状態は?」 |
| `/assess` | 状況判断 - 問題点を分析し、過去の経験と照らし合わせる | 「このエラーは前に見たことがある?」 |
| `/plan` | 計画立案 - 次のアクションを決定し、手順を整理する | 「この機能を実装する手順は?」 |
| `/execute` | 実行 - 計画を実行し、結果を記録する | 「計画通りに進めて」 |
| `/escalate` | 問題報告 - 問題が発生した場合、人間に判断を仰ぐ | 「この問題は人間の判断が必要」 |

### OODA ループとは?

OODA ループは、意思決定のフレームワークです:

```
Observe（観察）→ Orient（状況判断）→ Decide（決定）→ Act（実行）
    ↑                                                    ↓
    ←←←←←←←←←←← フィードバック ←←←←←←←←←←←←
```

Claude Code がこのサイクルを回しながら、自律的に開発を進めます。

---

## CLI コマンド

コマンドラインから cc-memory を操作できます。

```bash
# セットアップ（Claude Code の設定を自動更新）
cc-memory setup

# 動作確認（問題がないかチェック）
cc-memory doctor

# 現在の状態を確認
cc-memory status

# 最新版にアップデート
cc-memory update

# 対話型チュートリアル
cc-memory tutorial
```

### チーム向けコマンド

複数人で cc-memory を使う場合:

```bash
# チームを作成
cc-memory-cli team create --team-id my-team --description "開発チーム"

# エージェント（メンバー）を追加
cc-memory-cli agent add --team-id my-team --client-id worker-001 --level worker

# チームメンバーを確認
cc-memory-cli agent list --team-id my-team
```

---

## 3層メモリの説明

cc-memory は、人間の記憶システムにヒントを得た3層構造を採用しています。

### Working Memory（作業記憶）

**今やっていることを覚えている短期記憶**

- 現在のタスクの状態
- 一時的な判断や決定
- セッション中のメモ

```
例: 「今は認証機能を実装中」「このファイルを編集した」
```

自動的に期限が設定され、不要になると消えます。

### Episodic Memory（エピソード記憶）

**経験を覚えている長期記憶**

- 成功した実装の記録
- エラーとその解決方法
- 重要なマイルストーン

```
例: 「2週間前にこのバグを修正した方法」「デプロイが成功した時の手順」
```

過去の経験から学び、同じ問題に効率的に対処できます。

### Semantic Memory（意味記憶）

**知識を整理した長期記憶**

- プロジェクトのルール
- コーディング規約
- あなたの好み・設定

```
例: 「このプロジェクトは TypeScript を使う」「インデントは2スペース」
```

一度覚えた知識は、いつでも参照できます。

### 3層メモリの関係

```
┌─────────────────────────────────────────────────────────┐
│                   Working Memory                         │
│                  （短期・一時的）                          │
│                        ↓                                 │
│    ┌────────────────────────────────────────────┐       │
│    │  重要なことは長期記憶に「固定化」される        │       │
│    └────────────────────────────────────────────┘       │
│                   ↓            ↓                        │
│    ┌──────────────┐    ┌──────────────┐                 │
│    │   Episodic   │    │   Semantic   │                 │
│    │  （経験）     │    │  （知識）     │                 │
│    └──────────────┘    └──────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

---

## 設定

### 環境変数

| 変数 | デフォルト値 | 説明 |
|------|-------------|------|
| `MEMORY_DATA_PATH` | `~/.claude-memory` | データの保存場所 |
| `CC_MEMORY_TACHIKOMA_NAME` | - | Tachikoma インスタンス名 |
| `CC_MEMORY_SYNC_DIR` | - | 同期ファイルの保存場所 |

### Claude Code 設定

`~/.claude/settings.json` に自動追加されます:

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

## よくある質問

### Q: データはどこに保存されますか?

A: デフォルトでは `~/.claude-memory` フォルダに SQLite データベースとして保存されます。クラウドには送信されません。

### Q: 記憶を削除したい場合は?

A: `~/.claude-memory` フォルダを削除すると、すべての記憶がリセットされます。

### Q: 複数の PC で同じ記憶を使いたい

A: Tachikoma 同期機能を使って、記憶をエクスポート/インポートできます。

---

## ライセンス

MIT License - 自由に使用、改変、再配布できます。

---

## English

### What is cc-memory?

cc-memory is an MCP server that gives Claude Code **persistent memory**. It remembers your preferences, learns from past experiences, and organizes knowledge across sessions.

**Key Features:**
- **3-Layer Memory**: Working (short-term), Episodic (experiences), and Semantic (knowledge) memory
- **OODA Loop**: Autonomous development cycle with observe, assess, plan, and execute commands
- **Tachikoma Sync**: Share memories between multiple Claude instances
- **DIKW Hierarchy**: Transform experiences into patterns, insights, and wisdom

### Quick Start

```bash
# Install globally
npm install -g cc-memory

# Run setup wizard
cc-memory setup

# Start tutorial
cc-memory tutorial
```

### Commands

| Command | Description |
|---------|-------------|
| `cc-memory setup` | Configure Claude Code integration |
| `cc-memory doctor` | Check for issues |
| `cc-memory status` | Show current state |
| `cc-memory tutorial` | Interactive learning |

### OODA Slash Commands

Use these in Claude Code:

| Command | Description |
|---------|-------------|
| `/observe` | Assess current situation |
| `/assess` | Analyze problems with past experience |
| `/plan` | Create action plan |
| `/execute` | Execute plan and record results |
| `/escalate` | Request human decision |

### Memory Layers

1. **Working Memory**: Current task state, temporary decisions
2. **Episodic Memory**: Success stories, error resolutions, milestones
3. **Semantic Memory**: Project rules, preferences, patterns

### Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_DATA_PATH` | `~/.claude-memory` | Data storage location |
| `CC_MEMORY_TACHIKOMA_NAME` | - | Tachikoma instance name |
| `CC_MEMORY_SYNC_DIR` | - | Sync file directory |

### License

MIT License

---

## Links

- [GitHub Repository](https://github.com/0xchoux1/cc-memory)
- [MCP Documentation](https://modelcontextprotocol.io/)
- [Claude Code](https://claude.ai/code)
