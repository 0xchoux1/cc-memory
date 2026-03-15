# Agent Manager Architecture

> Validated with cc-memory v3.2.0

## 概要

cc-memory はマルチエージェント環境でのメモリ管理を提供する MCP サーバーです。
Manager-Worker モデルにより、共有知識の一貫性と個別知識の専門性を両立します。

```
┌─────────────────────────────────────────────────┐
│                 Claude Code                      │
│          (MCP クライアント)                       │
└───────────────────┬─────────────────────────────┘
                    │ stdio
┌───────────────────┴─────────────────────────────┐
│              cc-memory MCP Server                │
│                                                  │
│  ┌────────────┐  ┌────────────┐  ┌───────────┐  │
│  │ Memory Ops │  │ Session    │  │ Project & │  │
│  │ (6 tools)  │  │ (1 tool)   │  │ Agent Mgmt│  │
│  │            │  │            │  │ (4 tools)  │  │
│  └──────┬─────┘  └──────┬─────┘  └─────┬─────┘  │
│         └───────────────┼───────────────┘        │
│                         │                        │
│              ┌──────────┴──────────┐             │
│              │   SQLite + sqlite-vec│             │
│              │   (ローカル永続化)    │             │
│              └─────────────────────┘             │
└─────────────────────────────────────────────────┘
```

## ロール設計

### Manager
- **Shared Scope** の読み書き権限
- **全 Worker の Personal Scope** の読み取り権限
- プロジェクト全体の知識を管理・統括

### Worker
- **Shared Scope** の読み取りのみ
- **自分の Personal Scope** の読み書き
- 専門知識・作業ログを蓄積

## 利用パターン

### パターン 1: 知識の共有と参照

```
Manager: 規約を shared に保存
  → Worker A: shared を参照して作業
  → Worker B: shared を参照して作業
```

### パターン 2: 作業ログの蓄積と監視

```
Worker A: 作業結果を personal に記録
Worker B: 作業結果を personal に記録
  → Manager: 全 worker の personal を recall で確認
```

### パターン 3: 短期記憶の活用

```
session_recall で直近のセッションログを検索
  → 前回の会話内容・決定事項を即座に参照
```

## v1 からの変更点

| 項目 | v1 | v3 |
|------|---|---|
| メモリモデル | Working / Episodic / Semantic | Shared / Personal |
| ロール | Manager / Worker / Observer | Manager / Worker |
| 通信 | HTTP + WebSocket | stdio MCP |
| 同期 | Tachikoma / CRDT | なし（ローカル完結） |
| 認証 | API キー | RBAC（DB 内） |

v1 のコードは [`v1` ブランチ](https://github.com/0xchoux1/cc-memory/tree/v1) で保全されています。
