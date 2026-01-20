/**
 * AgentManager - マルチエージェントシステムの中央管理
 *
 * タスク分解、ワークフロー作成、エージェント調整、人間への報告を担当します。
 */

import type { AgentRole } from '../memory/types.js';
import type { WorkflowDefinition, DurableWorkflow, WorkflowExecutionResult } from '../durable/types.js';
import type { WorkflowManager } from '../durable/WorkflowManager.js';
import type { StorageAdapter } from '../durable/adapters/StorageAdapter.js';
import type { AgentCoordinator } from './AgentCoordinator.js';
import type { WorkerAgent, WorkerAgentConfig, ClaudeApiConfig, SharedContext } from './WorkerAgent.js';
import type { AgentFactory } from './WorkerAgentExecutor.js';
import { ClaudeWorkerAgentFactory } from './ClaudeWorkerAgent.js';
import { PRESET_AGENTS, createDefaultConfig } from './templates/index.js';

// ============================================================================
// Progress Update Types
// ============================================================================

/**
 * 進捗更新の種類
 */
export type ProgressUpdateType =
  | 'workflow_created'
  | 'workflow_started'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'step_waiting'
  | 'workflow_paused'
  | 'workflow_completed'
  | 'workflow_failed';

/**
 * 進捗更新
 */
export interface ProgressUpdate {
  /** 更新タイプ */
  type: ProgressUpdateType;

  /** ワークフロー ID */
  workflowId: string;

  /** ステップ名（ステップ関連の更新の場合） */
  stepName?: string;

  /** エージェント名（ステップ関連の更新の場合） */
  agentName?: string;

  /** メッセージ */
  message: string;

  /** タイムスタンプ */
  timestamp: number;

  /** 詳細情報 */
  details?: unknown;
}

/**
 * 人間への質問
 */
export interface HumanQuestion {
  /** 質問 ID */
  id: string;

  /** 質問内容 */
  question: string;

  /** 選択肢（オプション） */
  options?: string[];

  /** コンテキスト情報 */
  context?: string;

  /** 緊急度 */
  urgent: boolean;
}

// ============================================================================
// AgentManager Configuration
// ============================================================================

/**
 * AgentManager 設定
 */
export interface AgentManagerConfig {
  /** ストレージアダプタ */
  storage: StorageAdapter;

  /** AgentCoordinator */
  coordinator: AgentCoordinator;

  /** WorkflowManager */
  workflowManager: WorkflowManager;

  /** Claude API 設定 */
  apiConfig?: ClaudeApiConfig;

  /** エージェントファクトリ（オプション、デフォルトは ClaudeWorkerAgentFactory） */
  factory?: AgentFactory;

  /** 進捗コールバック */
  onProgress?: (update: ProgressUpdate) => void;

  /** 人間への質問コールバック */
  onHumanInput?: (question: HumanQuestion) => Promise<string>;

  /** デバッグモード */
  debug?: boolean;
}

// ============================================================================
// AgentManager Interface
// ============================================================================

/**
 * AgentManager インターフェース
 */
export interface IAgentManager {
  /**
   * 人間からの指示を受け取り、ワークフローを作成・実行
   */
  handleInstruction(instruction: string): Promise<DurableWorkflow>;

  /**
   * ゴールからワークフロー定義を生成
   */
  planWorkflow(goal: string): Promise<WorkflowDefinition>;

  /**
   * ワークフロー実行を監視
   */
  monitorExecution(workflowId: string): AsyncGenerator<ProgressUpdate, void, undefined>;

  /**
   * 人間に報告
   */
  reportToHuman(workflowId: string): Promise<string>;

  /**
   * 人間に質問
   */
  askHuman(question: string, options?: string[]): Promise<string>;

  /**
   * ワーカーエージェントを登録
   */
  registerWorker(agent: WorkerAgent): void;

  /**
   * ワーカーエージェントを取得
   */
  getWorker(roleOrId: AgentRole | string): WorkerAgent | undefined;

  /**
   * 全ワーカーをリスト
   */
  listWorkers(): WorkerAgent[];

  /**
   * 初期化（デフォルトエージェントの登録など）
   */
  initialize(): Promise<void>;

  /**
   * シャットダウン
   */
  shutdown(): Promise<void>;
}

// ============================================================================
// AgentManager Implementation
// ============================================================================

/**
 * AgentManager の実装
 */
export class AgentManager implements IAgentManager {
  private config: AgentManagerConfig;
  private workers: Map<string, WorkerAgent> = new Map();
  private workersByRole: Map<AgentRole, WorkerAgent[]> = new Map();
  private plannerAgent: WorkerAgent | null = null;
  private factory: AgentFactory;
  private initialized: boolean = false;

  constructor(config: AgentManagerConfig) {
    this.config = config;
    // ファクトリが指定されていない場合は ClaudeWorkerAgentFactory を使用
    this.factory = config.factory ?? new ClaudeWorkerAgentFactory(config.apiConfig);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // タスクプランナーエージェントを作成
    this.plannerAgent = this.factory.create(PRESET_AGENTS.taskPlanner);
    await this.plannerAgent.initialize();

    this.initialized = true;
    this.log('AgentManager initialized');
  }

  async shutdown(): Promise<void> {
    // 全エージェントをシャットダウン
    for (const worker of this.workers.values()) {
      await worker.shutdown();
    }
    if (this.plannerAgent) {
      await this.plannerAgent.shutdown();
    }

    this.workers.clear();
    this.workersByRole.clear();
    this.initialized = false;
    this.log('AgentManager shutdown complete');
  }

  async handleInstruction(instruction: string): Promise<DurableWorkflow> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.log(`Handling instruction: ${instruction}`);

    // 1. ゴールを分析してワークフローを計画
    const definition = await this.planWorkflow(instruction);
    this.log(`Planned workflow: ${definition.name} with ${definition.steps.length} steps`);

    // 2. ワークフローを作成
    const workflow = await this.config.workflowManager.createWorkflow(
      definition,
      { instruction },
      { initiator: 'human', priority: 'high' }
    );

    this.emitProgress({
      type: 'workflow_created',
      workflowId: workflow.id,
      message: `ワークフロー "${workflow.name}" を作成しました`,
      timestamp: Date.now(),
      details: { steps: workflow.steps.map(s => s.name) },
    });

    // 3. 非同期で実行開始
    this.executeWorkflowAsync(workflow.id);

    return workflow;
  }

  async planWorkflow(goal: string): Promise<WorkflowDefinition> {
    if (!this.plannerAgent) {
      throw new Error('AgentManager not initialized');
    }

    // 利用可能なエージェント情報を収集
    const availableAgents = this.listWorkers().map(w => ({
      name: w.profile.name,
      role: w.profile.role,
      capabilities: w.profile.capabilities,
    }));

    const prompt = `
## ゴール
${goal}

## 利用可能なエージェント
${availableAgents.length > 0
  ? availableAgents.map(a => `- ${a.name} (${a.role}): ${a.capabilities?.join(', ') ?? 'general'}`).join('\n')
  : '※ 現在登録されているエージェントはありません。必要なエージェントロールを指定してください。'}

## 指示
上記のゴールを達成するためのワークフローを設計してください。
各ステップには適切なエージェントロール（backend, frontend, security, testing, devops, architecture, data, general）を割り当ててください。
`;

    const context: SharedContext = {
      workflowId: 'planning',
      previousOutputs: new Map(),
      sharedMemory: new Map(),
    };

    const result = await this.plannerAgent.execute(
      {
        id: 'plan-step',
        name: 'plan_workflow',
        agent: 'task-planner',
        status: 'pending',
        input: { goal },
      },
      context
    );

    if (!result.success) {
      throw new Error(`Failed to plan workflow: ${result.error?.message}`);
    }

    return this.parseWorkflowDefinition(result.output);
  }

  async *monitorExecution(workflowId: string): AsyncGenerator<ProgressUpdate, void, undefined> {
    let lastStatus = '';
    let lastStepIndex = -1;

    while (true) {
      const workflow = await this.config.workflowManager.getWorkflow(workflowId);
      if (!workflow) {
        yield {
          type: 'workflow_failed',
          workflowId,
          message: 'ワークフローが見つかりません',
          timestamp: Date.now(),
        };
        break;
      }

      // ステータス変更を検出
      if (workflow.status !== lastStatus) {
        const update = this.createStatusUpdate(workflow);
        if (update) {
          yield update;
        }
        lastStatus = workflow.status;
      }

      // ステップ進捗を検出
      if (workflow.currentStepIndex !== lastStepIndex && workflow.currentStepIndex >= 0) {
        const currentStep = workflow.steps[workflow.currentStepIndex];
        if (currentStep) {
          yield {
            type: 'step_started',
            workflowId,
            stepName: currentStep.name,
            agentName: currentStep.agent,
            message: `ステップ "${currentStep.name}" を開始`,
            timestamp: Date.now(),
          };
        }
        lastStepIndex = workflow.currentStepIndex;
      }

      // 完了状態をチェック
      if (
        workflow.status === 'completed' ||
        workflow.status === 'failed' ||
        workflow.status === 'cancelled'
      ) {
        break;
      }

      // ポーリング間隔
      await this.delay(1000);
    }
  }

  async reportToHuman(workflowId: string): Promise<string> {
    const workflow = await this.config.workflowManager.getWorkflow(workflowId);
    if (!workflow) {
      return 'ワークフローが見つかりません';
    }

    const completedSteps = workflow.steps.filter(s => s.status === 'completed');
    const failedSteps = workflow.steps.filter(s => s.status === 'failed');
    const pendingSteps = workflow.steps.filter(s => s.status === 'pending');

    const lines: string[] = [
      `## ワークフローレポート: ${workflow.name}`,
      '',
      `**ステータス**: ${this.translateStatus(workflow.status)}`,
      `**進捗**: ${completedSteps.length}/${workflow.steps.length} ステップ完了`,
      '',
    ];

    if (completedSteps.length > 0) {
      lines.push('### 完了したステップ');
      for (const step of completedSteps) {
        lines.push(`- ✅ ${step.name}`);
      }
      lines.push('');
    }

    if (failedSteps.length > 0) {
      lines.push('### 失敗したステップ');
      for (const step of failedSteps) {
        lines.push(`- ❌ ${step.name}: ${step.error?.message ?? '不明なエラー'}`);
      }
      lines.push('');
    }

    if (pendingSteps.length > 0) {
      lines.push('### 未完了のステップ');
      for (const step of pendingSteps) {
        lines.push(`- ⏳ ${step.name}`);
      }
      lines.push('');
    }

    if (workflow.output) {
      lines.push('### 結果');
      lines.push('```json');
      lines.push(JSON.stringify(workflow.output, null, 2));
      lines.push('```');
    }

    return lines.join('\n');
  }

  async askHuman(question: string, options?: string[]): Promise<string> {
    if (!this.config.onHumanInput) {
      throw new Error('Human input callback not configured');
    }

    const questionObj: HumanQuestion = {
      id: `q-${Date.now()}`,
      question,
      options,
      urgent: false,
    };

    return this.config.onHumanInput(questionObj);
  }

  registerWorker(agent: WorkerAgent): void {
    this.workers.set(agent.id, agent);

    // ロール別インデックスに追加
    const roleAgents = this.workersByRole.get(agent.profile.role) ?? [];
    roleAgents.push(agent);
    this.workersByRole.set(agent.profile.role, roleAgents);

    this.log(`Registered worker: ${agent.profile.name} (${agent.profile.role})`);
  }

  getWorker(roleOrId: AgentRole | string): WorkerAgent | undefined {
    // ID で検索
    const byId = this.workers.get(roleOrId);
    if (byId) return byId;

    // ロールで検索
    const byRole = this.workersByRole.get(roleOrId as AgentRole);
    return byRole?.[0];
  }

  listWorkers(): WorkerAgent[] {
    return Array.from(this.workers.values());
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * ワークフローを非同期で実行
   */
  private async executeWorkflowAsync(workflowId: string): Promise<void> {
    try {
      this.emitProgress({
        type: 'workflow_started',
        workflowId,
        message: 'ワークフローの実行を開始',
        timestamp: Date.now(),
      });

      const result = await this.config.workflowManager.executeWorkflowParallel(workflowId);

      if (result.success) {
        this.emitProgress({
          type: 'workflow_completed',
          workflowId,
          message: 'ワークフローが完了しました',
          timestamp: Date.now(),
          details: result.output,
        });
      } else if (result.paused) {
        this.emitProgress({
          type: 'workflow_paused',
          workflowId,
          message: '人間の入力を待っています',
          timestamp: Date.now(),
        });
      } else {
        this.emitProgress({
          type: 'workflow_failed',
          workflowId,
          message: `ワークフローが失敗しました: ${result.error?.message}`,
          timestamp: Date.now(),
          details: result.error,
        });
      }
    } catch (error) {
      this.emitProgress({
        type: 'workflow_failed',
        workflowId,
        message: `実行エラー: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * ワークフロー定義を解析
   */
  private parseWorkflowDefinition(output: unknown): WorkflowDefinition {
    this.log(`Parsing workflow definition: ${JSON.stringify(output).slice(0, 500)}`);

    if (typeof output === 'object' && output !== null) {
      let obj = output as Record<string, unknown>;

      // ネストされた workflow フィールドがあれば展開
      if (obj.workflow && typeof obj.workflow === 'object') {
        obj = obj.workflow as Record<string, unknown>;
      }

      // 必須フィールドの検証
      if (typeof obj.name !== 'string' || !Array.isArray(obj.steps)) {
        throw new Error(`Invalid workflow definition: missing name or steps. Got: ${JSON.stringify(obj).slice(0, 200)}`);
      }

      return {
        name: obj.name,
        description: typeof obj.description === 'string' ? obj.description : undefined,
        steps: obj.steps.map((step: unknown, index: number) => {
          if (typeof step !== 'object' || step === null) {
            throw new Error(`Invalid step at index ${index}`);
          }
          const s = step as Record<string, unknown>;
          return {
            name: String(s.name ?? `step-${index}`),
            agent: String(s.agent ?? 'general'),
            agentRole: (s.agentRole as AgentRole) ?? 'general',
            dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : undefined,
          };
        }),
      };
    }

    throw new Error('Invalid workflow definition output');
  }

  /**
   * ステータス変更の更新を作成
   */
  private createStatusUpdate(workflow: DurableWorkflow): ProgressUpdate | null {
    const typeMap: Record<string, ProgressUpdateType> = {
      running: 'workflow_started',
      paused: 'workflow_paused',
      completed: 'workflow_completed',
      failed: 'workflow_failed',
    };

    const type = typeMap[workflow.status];
    if (!type) return null;

    return {
      type,
      workflowId: workflow.id,
      message: `ワークフロー ${this.translateStatus(workflow.status)}`,
      timestamp: Date.now(),
    };
  }

  /**
   * ステータスを日本語に変換
   */
  private translateStatus(status: string): string {
    const translations: Record<string, string> = {
      pending: '待機中',
      running: '実行中',
      paused: '一時停止',
      completed: '完了',
      failed: '失敗',
      cancelled: 'キャンセル',
    };
    return translations[status] ?? status;
  }

  /**
   * 進捗を通知
   */
  private emitProgress(update: ProgressUpdate): void {
    if (this.config.onProgress) {
      this.config.onProgress(update);
    }
  }

  /**
   * 遅延
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * デバッグログ
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[AgentManager] ${message}`);
    }
  }
}
