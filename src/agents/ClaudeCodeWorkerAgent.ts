/**
 * ClaudeCodeWorkerAgent - Claude Code CLI を使用した WorkerAgent の実装
 *
 * サブスクリプションモデルを使用してタスクを実行します。
 * 追加の API コストなしで Claude を利用できます。
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentProfile } from '../memory/types.js';
import type { DurableStep, StepExecutionResult, AgentCard, AgentCapability } from '../durable/types.js';
import {
  type WorkerAgent,
  type WorkerAgentConfig,
  type SharedContext,
  type ConversationMessage,
  generateDefaultSystemPrompt,
} from './WorkerAgent.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Claude Code CLI 設定
 */
export interface ClaudeCodeConfig {
  /** 使用するモデル（オプション） */
  model?: 'sonnet' | 'opus' | 'haiku';

  /** タイムアウト（ミリ秒） */
  timeout?: number;

  /** デバッグモード */
  debug?: boolean;

  /** 追加の許可ツール */
  allowedTools?: string[];
}

/**
 * デフォルト設定
 */
export const DEFAULT_CLAUDE_CODE_CONFIG: Required<ClaudeCodeConfig> = {
  model: 'sonnet',
  timeout: 300000, // 5分
  debug: false,
  allowedTools: [],
};

// ============================================================================
// ClaudeCodeWorkerAgent Implementation
// ============================================================================

/**
 * Claude Code CLI を使用した WorkerAgent の実装
 *
 * サブスクリプションモデルを使用するため、追加の API コストがかかりません。
 */
export class ClaudeCodeWorkerAgent implements WorkerAgent {
  readonly id: string;
  readonly profile: AgentProfile;

  private config: Required<ClaudeCodeConfig>;
  private systemPrompt: string;
  private sharedMemory: Map<string, unknown>;
  private conversationHistory: ConversationMessage[];
  private initialized: boolean = false;

  constructor(agentConfig: WorkerAgentConfig, claudeCodeConfig?: ClaudeCodeConfig) {
    this.id = agentConfig.profile.id;
    this.profile = agentConfig.profile;

    this.config = {
      ...DEFAULT_CLAUDE_CODE_CONFIG,
      ...claudeCodeConfig,
    };

    this.systemPrompt = agentConfig.systemPrompt ?? generateDefaultSystemPrompt(agentConfig.profile);
    this.sharedMemory = new Map();
    this.conversationHistory = [];
  }

  get card(): AgentCard {
    return {
      id: this.id,
      name: this.profile.name,
      role: this.profile.role,
      description: `${this.profile.role} agent (Claude Code): ${this.profile.name}`,
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

    // Claude Code CLI が利用可能か確認
    try {
      await this.executeClaudeCode('--version');
      this.initialized = true;
      this.log('Initialized with Claude Code CLI');
    } catch (error) {
      throw new Error(`Claude Code CLI not available: ${error}`);
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

      // 2. Claude Code CLI を呼び出し
      const response = await this.callClaudeCode(prompt);

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
          retryable: true,
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

    // システムプロンプトの要約
    parts.push(`あなたは ${this.profile.name} (${this.profile.role}) です。`);

    // ステップ情報
    parts.push(`\n## タスク: ${step.name}`);
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

    parts.push('\n### 指示');
    parts.push('このタスクを実行し、結果を JSON 形式で出力してください。');
    parts.push('```json');
    parts.push('{ "result": "...", "details": "..." }');
    parts.push('```');

    return parts.join('\n');
  }

  /**
   * Claude Code CLI を呼び出し
   */
  private async callClaudeCode(prompt: string): Promise<string> {
    const args = [
      '-p', // print mode
      '--output-format', 'text',
      '--model', this.config.model,
      '--permission-mode', 'bypassPermissions', // 非インタラクティブモードで許可確認をスキップ
      '--system-prompt', this.systemPrompt,
    ];

    // 許可ツールがあれば追加
    if (this.config.allowedTools.length > 0) {
      args.push('--allowedTools', this.config.allowedTools.join(','));
    }

    // プロンプトを追加
    args.push(prompt);

    return this.executeClaudeCode(...args);
  }

  /**
   * Claude Code CLI を実行
   */
  private executeClaudeCode(...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      // 環境変数を継承し、CLAUDE_CODE_OAUTH_TOKEN を確保
      const env = { ...process.env };

      // OAuth トークンが設定されていない場合、credentials ファイルから読み取り
      if (!env.CLAUDE_CODE_OAUTH_TOKEN) {
        try {
          const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
          const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
          if (creds?.claudeAiOauth?.accessToken) {
            env.CLAUDE_CODE_OAUTH_TOKEN = creds.claudeAiOauth.accessToken;
          }
        } catch {
          // 無視 - 環境変数が既に設定されているか、認証エラーになる
        }
      }

      this.log(`Spawning claude with args: ${args.slice(0, 5).join(' ')} ...`);
      this.log(`CLAUDE_CODE_OAUTH_TOKEN set: ${!!env.CLAUDE_CODE_OAUTH_TOKEN}`);

      const proc = spawn('claude', args, {
        stdio: ['ignore', 'pipe', 'pipe'], // stdin を ignore にしないとハングする
        env,
      });

      // タイムアウトを手動で管理
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Claude Code timed out after ${this.config.timeout}ms`));
      }, this.config.timeout);

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Claude Code exited with code ${code}: ${stderr || stdout}`));
        }
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * レスポンスを解析
   */
  private parseResponse(response: string): unknown {
    // JSON ブロックを抽出
    const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // JSON 解析に失敗した場合はテキストをそのまま返す
      }
    }

    // プレーンな JSON を試みる
    try {
      return JSON.parse(response);
    } catch {
      // JSON でない場合はオブジェクトとして返す
      return {
        text: response,
        format: 'text',
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

    // 履歴の上限（50件）
    while (this.conversationHistory.length > 50) {
      this.conversationHistory.shift();
    }
  }

  /**
   * デバッグログ
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[ClaudeCodeWorkerAgent:${this.id}] ${message}`);
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * ClaudeCodeWorkerAgent のファクトリ
 */
export class ClaudeCodeWorkerAgentFactory {
  private defaultConfig?: ClaudeCodeConfig;

  constructor(defaultConfig?: ClaudeCodeConfig) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * 新しい ClaudeCodeWorkerAgent を作成
   */
  create(agentConfig: WorkerAgentConfig, claudeCodeConfig?: ClaudeCodeConfig): ClaudeCodeWorkerAgent {
    return new ClaudeCodeWorkerAgent(agentConfig, {
      ...this.defaultConfig,
      ...claudeCodeConfig,
    });
  }

  /**
   * ロールに基づいてデフォルト設定で WorkerAgent を作成
   */
  createForRole(
    role: AgentProfile['role'],
    name: string,
    claudeCodeConfig?: ClaudeCodeConfig
  ): ClaudeCodeWorkerAgent {
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

    return this.create({ profile }, {
      ...this.defaultConfig,
      ...claudeCodeConfig,
    });
  }
}
