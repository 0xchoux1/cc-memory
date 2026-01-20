/**
 * ClaudeWorkerAgent - Claude API を使用した WorkerAgent の実装
 *
 * このクラスは Anthropic Claude API を呼び出して実際にタスクを実行します。
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AgentProfile } from '../memory/types.js';
import type { DurableStep, StepExecutionResult, AgentCard, AgentCapability } from '../durable/types.js';
import {
  type WorkerAgent,
  type WorkerAgentConfig,
  type SharedContext,
  type ConversationMessage,
  type ClaudeApiConfig,
  type WorkerAgentTool,
  DEFAULT_API_CONFIG,
  resolveApiKey,
  generateDefaultSystemPrompt,
} from './WorkerAgent.js';

// ============================================================================
// ClaudeWorkerAgent Implementation
// ============================================================================

/**
 * Claude API を使用した WorkerAgent の実装
 */
export class ClaudeWorkerAgent implements WorkerAgent {
  readonly id: string;
  readonly profile: AgentProfile;

  private client: Anthropic;
  private apiConfig: Required<Omit<ClaudeApiConfig, 'apiKey'>> & { apiKey: string };
  private systemPrompt: string;
  private tools: WorkerAgentTool[];
  private sharedMemory: Map<string, unknown>;
  private conversationHistory: ConversationMessage[];
  private maxConversationHistory: number;
  private debug: boolean;
  private initialized: boolean = false;

  constructor(config: WorkerAgentConfig) {
    this.id = config.profile.id;
    this.profile = config.profile;

    // API 設定を解決
    const apiKey = resolveApiKey(config.apiConfig);
    this.apiConfig = {
      apiKey,
      model: config.apiConfig?.model ?? DEFAULT_API_CONFIG.model,
      maxTokens: config.apiConfig?.maxTokens ?? DEFAULT_API_CONFIG.maxTokens,
      baseUrl: config.apiConfig?.baseUrl ?? DEFAULT_API_CONFIG.baseUrl,
      timeout: config.apiConfig?.timeout ?? DEFAULT_API_CONFIG.timeout,
    };

    // Anthropic クライアントを初期化
    this.client = new Anthropic({
      apiKey: this.apiConfig.apiKey,
      baseURL: this.apiConfig.baseUrl,
      timeout: this.apiConfig.timeout,
    });

    this.systemPrompt = config.systemPrompt ?? generateDefaultSystemPrompt(config.profile);
    this.tools = config.tools ?? [];
    this.sharedMemory = new Map();
    this.conversationHistory = [];
    this.maxConversationHistory = config.maxConversationHistory ?? 50;
    this.debug = config.debug ?? false;
  }

  get card(): AgentCard {
    return {
      id: this.id,
      name: this.profile.name,
      role: this.profile.role,
      description: `${this.profile.role} agent: ${this.profile.name}`,
      capabilities: this.profile.capabilities?.map(c => ({
        name: c,
        description: c,
        available: true,
      })) ?? [],
      specializations: this.profile.specializations ?? [],
      knowledgeDomains: this.profile.knowledgeDomains ?? [],
      active: true,
      lastActiveAt: Date.now(),
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // API 接続確認（軽量なリクエスト）
    try {
      // モデルが利用可能かどうかは実際のリクエストでしか確認できないので、
      // ここでは初期化完了とマークするだけ
      this.initialized = true;
      this.log(`Initialized with model: ${this.apiConfig.model}`);
    } catch (error) {
      throw new Error(`Failed to initialize ClaudeWorkerAgent: ${error}`);
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.conversationHistory = [];
    this.sharedMemory.clear();
    this.log('Shutdown complete');
  }

  async execute(step: DurableStep, context: SharedContext): Promise<StepExecutionResult> {
    const startTime = Date.now();

    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // 1. プロンプトを構築
      const prompt = this.buildTaskPrompt(step, context);
      this.log(`Executing step: ${step.name}`);

      // 2. Claude API を呼び出し
      const response = await this.callClaude(prompt);

      // 3. レスポンスを解析
      const output = this.parseResponse(response);

      // 4. 会話履歴に追加
      this.addToHistory('user', prompt);
      this.addToHistory('assistant', typeof output === 'string' ? output : JSON.stringify(output));

      // 5. 共有メモリに結果を保存
      this.writeSharedMemory(`step:${step.id}:output`, output);

      const durationMs = Date.now() - startTime;
      this.log(`Step completed in ${durationMs}ms`);

      return {
        stepId: step.id,
        success: true,
        output,
        durationMs,
        waiting: false,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.log(`Step failed: ${errorMessage}`);

      return {
        stepId: step.id,
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: errorMessage,
          retryable: this.isRetryableError(error),
        },
        durationMs,
        waiting: false,
      };
    }
  }

  readSharedMemory(key: string): unknown | null {
    return this.sharedMemory.get(key) ?? null;
  }

  writeSharedMemory(key: string, value: unknown): void {
    this.sharedMemory.set(key, value);
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  updateCapabilities(capabilities: AgentCapability[]): void {
    this.profile.capabilities = capabilities.map(c => c.name);
  }

  getConversationHistory(): ConversationMessage[] {
    return [...this.conversationHistory];
  }

  clearConversationHistory(): void {
    this.conversationHistory = [];
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * タスク用のプロンプトを構築
   */
  private buildTaskPrompt(step: DurableStep, context: SharedContext): string {
    const parts: string[] = [];

    // ステップ情報
    parts.push(`## タスク: ${step.name}`);
    if (step.input) {
      parts.push(`\n### 入力\n\`\`\`json\n${JSON.stringify(step.input, null, 2)}\n\`\`\``);
    }

    // 前のステップの出力
    if (context.previousOutputs.size > 0) {
      parts.push('\n### 前のステップの出力');
      for (const [stepName, output] of context.previousOutputs) {
        parts.push(`\n#### ${stepName}\n\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\``);
      }
    }

    // ファイル情報
    if (context.files?.length) {
      parts.push(`\n### 関連ファイル\n${context.files.map(f => `- ${f}`).join('\n')}`);
    }

    // プロジェクトパス
    if (context.projectPath) {
      parts.push(`\n### プロジェクトパス\n${context.projectPath}`);
    }

    // 追加コンテキスト
    if (context.additionalContext) {
      parts.push(`\n### 追加情報\n\`\`\`json\n${JSON.stringify(context.additionalContext, null, 2)}\n\`\`\``);
    }

    parts.push('\n### 指示\nこのタスクを実行し、結果を JSON 形式で出力してください。');

    return parts.join('\n');
  }

  /**
   * Claude API を呼び出し
   */
  private async callClaude(prompt: string): Promise<Anthropic.Message> {
    // 会話履歴をメッセージに変換
    const messages: Anthropic.MessageParam[] = this.conversationHistory
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // 新しいユーザーメッセージを追加
    messages.push({
      role: 'user',
      content: prompt,
    });

    // ツールの準備
    const tools: Anthropic.Tool[] = this.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    // API 呼び出し
    const response = await this.client.messages.create({
      model: this.apiConfig.model,
      max_tokens: this.apiConfig.maxTokens,
      system: this.systemPrompt,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
    });

    return response;
  }

  /**
   * レスポンスを解析
   */
  private parseResponse(response: Anthropic.Message): unknown {
    // テキストコンテンツを抽出
    const textContent = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // JSON を抽出して解析を試みる
    const jsonMatch = textContent.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // JSON 解析に失敗した場合はテキストをそのまま返す
      }
    }

    // プレーンな JSON を試みる
    try {
      return JSON.parse(textContent);
    } catch {
      // JSON でない場合はオブジェクトとして返す
      return {
        text: textContent,
        stopReason: response.stop_reason,
      };
    }
  }

  /**
   * 会話履歴に追加
   */
  private addToHistory(role: 'user' | 'assistant' | 'system', content: string): void {
    this.conversationHistory.push({
      role,
      content,
      timestamp: Date.now(),
    });

    // 履歴の上限を超えたら古いものを削除
    while (this.conversationHistory.length > this.maxConversationHistory) {
      this.conversationHistory.shift();
    }
  }

  /**
   * リトライ可能なエラーかどうかを判定
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Anthropic.APIError) {
      // Rate limit や一時的なエラーはリトライ可能
      return error.status === 429 || error.status >= 500;
    }
    return false;
  }

  /**
   * デバッグログ
   */
  private log(message: string): void {
    if (this.debug) {
      console.log(`[ClaudeWorkerAgent:${this.id}] ${message}`);
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * ClaudeWorkerAgent のファクトリ
 */
export class ClaudeWorkerAgentFactory {
  private defaultApiConfig?: ClaudeApiConfig;

  constructor(defaultApiConfig?: ClaudeApiConfig) {
    this.defaultApiConfig = defaultApiConfig;
  }

  /**
   * 新しい ClaudeWorkerAgent を作成
   */
  create(config: WorkerAgentConfig): ClaudeWorkerAgent {
    return new ClaudeWorkerAgent({
      ...config,
      apiConfig: {
        ...this.defaultApiConfig,
        ...config.apiConfig,
      },
    });
  }

  /**
   * ロールに基づいてデフォルト設定で WorkerAgent を作成
   */
  createForRole(
    role: AgentProfile['role'],
    name: string,
    apiConfig?: ClaudeApiConfig
  ): ClaudeWorkerAgent {
    const profile: AgentProfile = {
      id: `${role}-${Date.now()}`,
      name,
      role,
      specializations: [],
      capabilities: [],
      knowledgeDomains: [],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    return this.create({
      profile,
      apiConfig: {
        ...this.defaultApiConfig,
        ...apiConfig,
      },
    });
  }
}
