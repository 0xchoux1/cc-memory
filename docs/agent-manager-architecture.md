# Agent Manager Architecture

## 概要

```
┌─────────────────────────────────────────────────────────────┐
│                        Human Interface                       │
│  "売上レポートを作成して" → Agent Manager → "完了しました"    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Agent Manager                          │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Task Planner│  │ Orchestrator│  │  Reporter   │         │
│  │ (タスク分解) │  │ (実行管理)  │  │ (進捗報告)  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Shared Memory (cc-memory)                 │
│                                                              │
│  Working Memory │ Episodic Memory │ Semantic Memory         │
│  (実行状態)      │ (タスク履歴)     │ (学習した知識)          │
└─────────────────────────────────────────────────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                      Worker Agents                           │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Research │  │  Coder   │  │ Reviewer │  │ Reporter │   │
│  │  Agent   │  │  Agent   │  │  Agent   │  │  Agent   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│       │              │             │             │          │
│       └──────────────┴─────────────┴─────────────┘          │
│                         │                                    │
│                   Tachikoma Sync                             │
│                 (エージェント間同期)                          │
└─────────────────────────────────────────────────────────────┘
```

## フロー例: "売上レポートを作成して"

### Step 1: Task Planner がタスク分解
```
Goal: 売上レポート作成
  ├─ Task 1: データ収集 (Research Agent)
  ├─ Task 2: 分析スクリプト作成 (Coder Agent)
  ├─ Task 3: 分析実行 (Coder Agent)
  ├─ Task 4: レビュー (Reviewer Agent)
  └─ Task 5: レポート生成 (Reporter Agent)
```

### Step 2: Orchestrator がワークフロー作成
```typescript
const workflow = {
  name: "Sales Report Generation",
  steps: [
    { name: "collect_data", agent: "research", agentRole: "data" },
    { name: "create_script", agent: "coder", agentRole: "backend", dependsOn: ["collect_data"] },
    { name: "run_analysis", agent: "coder", agentRole: "backend", dependsOn: ["create_script"] },
    { name: "review", agent: "reviewer", agentRole: "security", dependsOn: ["run_analysis"] },
    { name: "generate_report", agent: "reporter", dependsOn: ["review"] },
  ]
};
```

### Step 3: 各 Agent が自律実行
- 各エージェントは Claude API を呼び出して実際の作業を行う
- 結果は共有メモリに保存
- 次のエージェントは前のエージェントの出力を参照

### Step 4: Reporter が人間に報告
```
"売上レポートが完了しました。
- データ: 1000件のトランザクションを分析
- 主要な発見: 前月比15%増
- レポート: /reports/sales-2024-01.pdf"
```

## 実装計画

### Phase A: Worker Agent 基盤
```typescript
interface WorkerAgent {
  id: string;
  role: AgentRole;
  capabilities: string[];

  // Claude API を使って実際にタスクを実行
  execute(task: DurableTask, context: SharedContext): Promise<TaskResult>;

  // 他エージェントの結果を読み取る
  readSharedMemory(key: string): Promise<unknown>;

  // 結果を共有メモリに書き込む
  writeSharedMemory(key: string, value: unknown): Promise<void>;
}
```

### Phase B: Agent Manager
```typescript
interface AgentManager {
  // 人間からの指示を受け取る
  receiveInstruction(instruction: string): Promise<void>;

  // タスクを分解してワークフロー作成
  planWorkflow(goal: string): Promise<WorkflowDefinition>;

  // ワークフロー実行を監視
  monitorExecution(workflowId: string): AsyncIterable<ProgressUpdate>;

  // 人間に報告
  reportToHuman(summary: string): Promise<void>;

  // 人間の判断が必要な時に質問
  askHuman(question: string, options?: string[]): Promise<string>;
}
```

### Phase C: Human Interface
```typescript
// CLI での対話例
$ cc-agent "売上レポートを作成して"

Agent Manager: タスクを分解しています...
  ✓ データ収集 (Research Agent)
  ✓ 分析スクリプト作成 (Coder Agent)
  → 分析実行中... (Coder Agent)
  ○ レビュー待ち (Reviewer Agent)
  ○ レポート生成待ち (Reporter Agent)

Agent Manager: 分析が完了しました。レビューを進めますか? [Y/n]
```

## 技術的な実現方法

### Option 1: Claude API + cc-memory
- 各 Worker Agent は Claude API を呼び出す
- cc-memory で状態管理・同期
- Agent Manager も Claude で実装

### Option 2: Claude Code 複数インスタンス
- 複数の Claude Code プロセスを起動
- Tachikoma で同期
- 1つを Manager、他を Worker として役割分担

### Option 3: MCP Server として
- cc-memory を MCP Server として起動
- 複数のクライアント(Claude Desktop等)が接続
- 共有メモリ経由で協調

## 次のステップ

1. **WorkerAgent クラスの実装** - Claude API を呼び出す基盤
2. **AgentManager の実装** - タスク分解と監視ロジック
3. **CLI Interface** - 人間との対話UI
4. **実験** - 実際のタスクで動作確認
