/**
 * WorkerAgentExecutor - WorkflowManager の StepExecutor 実装
 *
 * WorkerAgent を使用してワークフローステップを実行します。
 */

import type { DurableStep, StepExecutionResult } from '../durable/types.js';
import type { StepExecutor, ExecutionContext } from '../durable/WorkflowManager.js';
import type { WorkerAgent, SharedContext, WorkerAgentConfig } from './WorkerAgent.js';
import type { IAgentManager } from './AgentManager.js';
import type { AgentRole } from '../memory/types.js';
import { createDefaultConfig } from './templates/index.js';

/**
 * エージェントファクトリのインターフェース
 */
export interface AgentFactory {
  create(config: WorkerAgentConfig): WorkerAgent;
}

// ============================================================================
// WorkerAgentExecutor
// ============================================================================

/**
 * WorkerAgentExecutor 設定
 */
export interface WorkerAgentExecutorConfig {
  /** AgentManager インスタンス */
  agentManager: IAgentManager;

  /** 動的にエージェントを作成するかどうか */
  createAgentsOnDemand?: boolean;

  /** エージェントファクトリ（動的作成時に使用） */
  factory?: AgentFactory;

  /** デバッグモード */
  debug?: boolean;
}

/**
 * WorkerAgent を使用して StepExecutor を実装
 *
 * WorkflowManager と WorkerAgent を統合し、ワークフローステップを
 * 適切なエージェントに委譲して実行します。
 */
export class WorkerAgentExecutor implements StepExecutor {
  private config: WorkerAgentExecutorConfig;
  private dynamicAgents: Map<string, WorkerAgent> = new Map();

  constructor(config: WorkerAgentExecutorConfig) {
    this.config = {
      createAgentsOnDemand: true,
      ...config,
    };
  }

  /**
   * ステップを実行
   */
  async execute(step: DurableStep, context: ExecutionContext): Promise<StepExecutionResult> {
    const startTime = Date.now();

    try {
      // 1. 適切なエージェントを取得または作成
      const agent = await this.resolveAgent(step);

      if (!agent) {
        return this.createErrorResult(step.id, startTime, {
          code: 'AGENT_NOT_FOUND',
          message: `Agent not found for step: ${step.name} (agent: ${step.agent}, role: ${step.agentRole})`,
          retryable: false,
        });
      }

      this.log(`Executing step "${step.name}" with agent "${agent.profile.name}"`);

      // 2. SharedContext を構築
      const sharedContext: SharedContext = {
        workflowId: context.workflowId,
        taskId: step.id,
        previousOutputs: context.previousStepOutputs,
        sharedMemory: new Map(),
        additionalContext: {
          contextId: context.contextId,
          metadata: context.metadata,
        },
      };

      // 3. ステップ入力を設定
      if (step.input) {
        sharedContext.sharedMemory.set('input', step.input);
      }

      // 4. エージェントで実行
      const result = await agent.execute(step, sharedContext);

      this.log(`Step "${step.name}" ${result.success ? 'completed' : 'failed'} in ${result.durationMs}ms`);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`Step "${step.name}" threw error: ${errorMessage}`);

      return this.createErrorResult(step.id, startTime, {
        code: 'EXECUTION_ERROR',
        message: errorMessage,
        retryable: true,
      });
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * ステップに適切なエージェントを解決
   */
  private async resolveAgent(step: DurableStep): Promise<WorkerAgent | null> {
    // 1. エージェント名で検索
    let agent = this.config.agentManager.getWorker(step.agent);
    if (agent) return agent;

    // 2. ロールで検索
    if (step.agentRole) {
      agent = this.config.agentManager.getWorker(step.agentRole);
      if (agent) return agent;
    }

    // 3. 動的に作成（設定されている場合）
    if (this.config.createAgentsOnDemand && this.config.factory) {
      return this.createDynamicAgent(step);
    }

    return null;
  }

  /**
   * 動的にエージェントを作成
   */
  private async createDynamicAgent(step: DurableStep): Promise<WorkerAgent> {
    const role: AgentRole = step.agentRole ?? 'general';
    const agentKey = `dynamic-${role}-${step.agent}`;

    // キャッシュをチェック
    const cached = this.dynamicAgents.get(agentKey);
    if (cached) return cached;

    // 新しいエージェントを作成
    const config = createDefaultConfig(role, step.agent);
    const agent = this.config.factory!.create(config);

    await agent.initialize();

    // キャッシュに保存
    this.dynamicAgents.set(agentKey, agent);

    // AgentManager にも登録
    this.config.agentManager.registerWorker(agent);

    this.log(`Created dynamic agent: ${agent.profile.name} (${role})`);

    return agent;
  }

  /**
   * エラー結果を作成
   */
  private createErrorResult(
    stepId: string,
    startTime: number,
    error: { code: string; message: string; retryable: boolean }
  ): StepExecutionResult {
    return {
      stepId,
      success: false,
      error,
      durationMs: Date.now() - startTime,
      waiting: false,
    };
  }

  /**
   * デバッグログ
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[WorkerAgentExecutor] ${message}`);
    }
  }

  /**
   * 動的に作成したエージェントをクリーンアップ
   */
  async cleanup(): Promise<void> {
    for (const agent of this.dynamicAgents.values()) {
      await agent.shutdown();
    }
    this.dynamicAgents.clear();
  }
}

// ============================================================================
// HITL Executor Wrapper
// ============================================================================

/**
 * HITL (Human-in-the-Loop) をサポートする Executor ラッパー
 */
export class HITLExecutorWrapper implements StepExecutor {
  private baseExecutor: StepExecutor;
  private hitlSteps: Set<string>;
  private humanInputCallback?: (stepName: string, context: unknown) => Promise<unknown>;

  constructor(
    baseExecutor: StepExecutor,
    options?: {
      hitlSteps?: string[];
      onHumanInput?: (stepName: string, context: unknown) => Promise<unknown>;
    }
  ) {
    this.baseExecutor = baseExecutor;
    this.hitlSteps = new Set(options?.hitlSteps ?? []);
    this.humanInputCallback = options?.onHumanInput;
  }

  /**
   * HITL ステップを追加
   */
  addHITLStep(stepName: string): void {
    this.hitlSteps.add(stepName);
  }

  /**
   * HITL ステップを削除
   */
  removeHITLStep(stepName: string): void {
    this.hitlSteps.delete(stepName);
  }

  /**
   * ステップを実行
   */
  async execute(step: DurableStep, context: ExecutionContext): Promise<StepExecutionResult> {
    // HITL ステップかどうかをチェック
    if (this.hitlSteps.has(step.name)) {
      return {
        stepId: step.id,
        success: true,
        output: { status: 'waiting_for_human', step: step.name },
        durationMs: 0,
        waiting: true,
        waitingMessage: `人間の承認を待っています: ${step.name}`,
      };
    }

    // 通常のステップは基底の Executor に委譲
    return this.baseExecutor.execute(step, context);
  }
}

// ============================================================================
// Mock Executor (for testing)
// ============================================================================

/**
 * テスト用のモック Executor
 */
export class MockStepExecutor implements StepExecutor {
  private results: Map<string, Partial<StepExecutionResult>> = new Map();
  private defaultDelay: number;

  constructor(options?: { defaultDelay?: number }) {
    this.defaultDelay = options?.defaultDelay ?? 100;
  }

  /**
   * ステップの結果を設定
   */
  setResult(stepName: string, result: Partial<StepExecutionResult>): void {
    this.results.set(stepName, result);
  }

  /**
   * ステップを実行
   */
  async execute(step: DurableStep, context: ExecutionContext): Promise<StepExecutionResult> {
    const startTime = Date.now();

    // 遅延をシミュレート
    await new Promise(resolve => setTimeout(resolve, this.defaultDelay));

    // カスタム結果があれば使用
    const customResult = this.results.get(step.name);
    if (customResult) {
      return {
        stepId: step.id,
        success: customResult.success ?? true,
        output: customResult.output ?? { step: step.name, mocked: true },
        error: customResult.error,
        durationMs: Date.now() - startTime,
        waiting: customResult.waiting ?? false,
        waitingMessage: customResult.waitingMessage,
      };
    }

    // デフォルトの成功結果
    return {
      stepId: step.id,
      success: true,
      output: {
        step: step.name,
        agent: step.agent,
        previousOutputs: Object.fromEntries(context.previousStepOutputs),
        timestamp: new Date().toISOString(),
      },
      durationMs: Date.now() - startTime,
      waiting: false,
    };
  }
}
