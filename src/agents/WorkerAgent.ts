/**
 * WorkerAgent - Claude API を呼び出して実際にタスクを実行するエージェント
 *
 * このモジュールは WorkerAgent のインターフェースと関連する型を定義します。
 * 実際の Claude API 実装は ClaudeWorkerAgent で行います。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentRole, AgentProfile } from '../memory/types.js';
import type { DurableStep, StepExecutionResult, AgentCard, AgentCapability } from '../durable/types.js';

// ============================================================================
// API Configuration Types
// ============================================================================

/**
 * Claude API 設定
 */
export interface ClaudeApiConfig {
  /** API キー（環境変数 ANTHROPIC_API_KEY または Claude Code 設定から取得） */
  apiKey?: string;

  /** 使用するモデル */
  model?: string;

  /** 最大出力トークン数 */
  maxTokens?: number;

  /** API ベース URL（オプション） */
  baseUrl?: string;

  /** タイムアウト（ミリ秒） */
  timeout?: number;
}

/**
 * デフォルト設定
 */
export const DEFAULT_API_CONFIG: Required<Omit<ClaudeApiConfig, 'apiKey'>> = {
  model: 'claude-opus-4-5-20251101',
  maxTokens: 4096,
  baseUrl: 'https://api.anthropic.com',
  timeout: 120000,
};

// ============================================================================
// Shared Context Types
// ============================================================================

/**
 * 共有コンテキスト - エージェント間で共有される情報
 */
export interface SharedContext {
  /** ワークフロー ID */
  workflowId: string;

  /** タスク ID（オプション） */
  taskId?: string;

  /** 前のステップからの出力 */
  previousOutputs: Map<string, unknown>;

  /** 共有メモリ（エージェント間で共有） */
  sharedMemory: Map<string, unknown>;

  /** 関連ファイルパス */
  files?: string[];

  /** プロジェクトパス */
  projectPath?: string;

  /** 追加のコンテキスト情報 */
  additionalContext?: Record<string, unknown>;
}

// ============================================================================
// Worker Agent Configuration
// ============================================================================

/**
 * エージェントが使用可能なツール
 */
export interface WorkerAgentTool {
  /** ツール名 */
  name: string;

  /** ツールの説明 */
  description: string;

  /** 入力スキーマ（JSON Schema） */
  inputSchema: Record<string, unknown>;

  /** ツール実行関数 */
  execute: (input: unknown) => Promise<unknown>;
}

/**
 * WorkerAgent の設定
 */
export interface WorkerAgentConfig {
  /** エージェントプロファイル */
  profile: AgentProfile;

  /** Claude API 設定 */
  apiConfig?: ClaudeApiConfig;

  /** システムプロンプト（オプション、デフォルトはロールに基づいて生成） */
  systemPrompt?: string;

  /** 使用可能なツール */
  tools?: WorkerAgentTool[];

  /** 会話履歴の最大長 */
  maxConversationHistory?: number;

  /** デバッグモード */
  debug?: boolean;
}

// ============================================================================
// Execution Result Types
// ============================================================================

/**
 * タスク実行結果の詳細
 */
export interface TaskExecutionDetails {
  /** 成功したかどうか */
  success: boolean;

  /** 出力データ */
  output?: unknown;

  /** エラーメッセージ（失敗時） */
  error?: string;

  /** 生成されたアーティファクト */
  artifacts?: TaskArtifact[];

  /** 使用したトークン数 */
  tokensUsed?: {
    input: number;
    output: number;
  };

  /** 実行時間（ミリ秒） */
  durationMs: number;

  /** モデルの応答（生データ） */
  rawResponse?: unknown;
}

/**
 * タスクのアーティファクト
 */
export interface TaskArtifact {
  /** アーティファクト名 */
  name: string;

  /** タイプ */
  type: 'file' | 'data' | 'report' | 'code';

  /** コンテンツ */
  content: string;

  /** MIME タイプ（オプション） */
  mimeType?: string;
}

// ============================================================================
// Conversation Types
// ============================================================================

/**
 * 会話メッセージ
 */
export interface ConversationMessage {
  /** ロール */
  role: 'user' | 'assistant' | 'system';

  /** コンテンツ */
  content: string;

  /** タイムスタンプ */
  timestamp: number;

  /** ツール呼び出し（アシスタントの場合） */
  toolCalls?: Array<{
    name: string;
    input: unknown;
    output?: unknown;
  }>;
}

// ============================================================================
// WorkerAgent Interface
// ============================================================================

/**
 * WorkerAgent - Claude API を呼び出して実際にタスクを実行するエージェント
 *
 * @example
 * ```typescript
 * const agent = new ClaudeWorkerAgent({
 *   profile: { id: 'backend-1', name: 'Backend Agent', role: 'backend', ... },
 *   apiConfig: { apiKey: process.env.ANTHROPIC_API_KEY },
 * });
 *
 * const result = await agent.execute(step, context);
 * ```
 */
export interface WorkerAgent {
  /** エージェント ID */
  readonly id: string;

  /** エージェントプロファイル */
  readonly profile: AgentProfile;

  /** エージェントカード（A2A 互換） */
  readonly card: AgentCard;

  /**
   * タスクを実行
   *
   * @param step - 実行するステップ
   * @param context - 共有コンテキスト
   * @returns ステップ実行結果
   */
  execute(step: DurableStep, context: SharedContext): Promise<StepExecutionResult>;

  /**
   * 共有メモリから読み取り
   *
   * @param key - キー
   * @returns 値（存在しない場合は null）
   */
  readSharedMemory(key: string): unknown | null;

  /**
   * 共有メモリに書き込み
   *
   * @param key - キー
   * @param value - 値
   */
  writeSharedMemory(key: string, value: unknown): void;

  /**
   * システムプロンプトを取得
   *
   * @returns システムプロンプト
   */
  getSystemPrompt(): string;

  /**
   * エージェントの能力を更新
   *
   * @param capabilities - 新しい能力リスト
   */
  updateCapabilities(capabilities: AgentCapability[]): void;

  /**
   * 会話履歴を取得
   *
   * @returns 会話メッセージの配列
   */
  getConversationHistory(): ConversationMessage[];

  /**
   * 会話履歴をクリア
   */
  clearConversationHistory(): void;

  /**
   * エージェントを初期化（API 接続確認など）
   */
  initialize(): Promise<void>;

  /**
   * エージェントをシャットダウン
   */
  shutdown(): Promise<void>;
}

// ============================================================================
// Factory Types
// ============================================================================

/**
 * WorkerAgent ファクトリ
 */
export interface WorkerAgentFactory {
  /**
   * 新しい WorkerAgent を作成
   *
   * @param config - エージェント設定
   * @returns WorkerAgent インスタンス
   */
  create(config: WorkerAgentConfig): WorkerAgent;

  /**
   * ロールに基づいてデフォルト設定で WorkerAgent を作成
   *
   * @param role - エージェントロール
   * @param name - エージェント名
   * @param apiConfig - API 設定（オプション）
   * @returns WorkerAgent インスタンス
   */
  createForRole(role: AgentRole, name: string, apiConfig?: ClaudeApiConfig): WorkerAgent;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Claude Code の credentials ファイルから API キーを読み取る
 *
 * @returns API キー（見つからない場合は null）
 */
function readClaudeCodeCredentials(): string | null {
  try {
    const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const content = fs.readFileSync(credentialsPath, 'utf-8');
    const credentials = JSON.parse(content);

    // claudeAiOauth.accessToken を取得
    const accessToken = credentials?.claudeAiOauth?.accessToken;
    if (accessToken && typeof accessToken === 'string') {
      return accessToken;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * API キーを取得
 *
 * 優先順位:
 * 1. 引数で渡された apiKey
 * 2. 環境変数 ANTHROPIC_API_KEY
 * 3. Claude Code の設定（~/.claude/.credentials.json）
 *
 * @param config - API 設定
 * @returns API キー
 * @throws API キーが見つからない場合
 */
export function resolveApiKey(config?: ClaudeApiConfig): string {
  // 1. 引数で渡された apiKey
  if (config?.apiKey) {
    return config.apiKey;
  }

  // 2. 環境変数
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    return envKey;
  }

  // 3. Claude Code の credentials ファイル
  const claudeCodeKey = readClaudeCodeCredentials();
  if (claudeCodeKey) {
    return claudeCodeKey;
  }

  throw new Error(
    'API key not found. Set ANTHROPIC_API_KEY environment variable, run "claude setup-token", or pass apiKey in config.'
  );
}

/**
 * ロールに基づいたデフォルトのシステムプロンプトを生成
 *
 * @param profile - エージェントプロファイル
 * @returns システムプロンプト
 */
export function generateDefaultSystemPrompt(profile: AgentProfile): string {
  const roleDescriptions: Record<AgentRole, string> = {
    frontend: 'フロントエンド開発の専門家。UI/UX、React、Vue、CSS、アクセシビリティに精通。',
    backend: 'バックエンド開発の専門家。API設計、データベース、サーバーサイドロジックに精通。',
    security: 'セキュリティの専門家。脆弱性分析、セキュリティ監査、ベストプラクティスに精通。',
    testing: 'テスト・QAの専門家。テスト戦略、自動テスト、品質保証に精通。',
    devops: 'DevOpsの専門家。CI/CD、インフラ、デプロイメント、監視に精通。',
    architecture: 'ソフトウェアアーキテクチャの専門家。システム設計、スケーラビリティ、技術選定に精通。',
    data: 'データエンジニアリングの専門家。データパイプライン、分析、機械学習に精通。',
    general: '汎用エージェント。様々なタスクを柔軟に処理。',
  };

  const specializations = profile.specializations?.length
    ? `\n専門分野: ${profile.specializations.join(', ')}`
    : '';

  const capabilities = profile.capabilities?.length
    ? `\n実行可能なタスク: ${profile.capabilities.join(', ')}`
    : '';

  const knowledge = profile.knowledgeDomains?.length
    ? `\n知識ドメイン: ${profile.knowledgeDomains.join(', ')}`
    : '';

  return `あなたは ${profile.name} です。${roleDescriptions[profile.role]}
${specializations}${capabilities}${knowledge}

## 行動指針
- 他のエージェントと協調して作業を進めます
- 明確で実行可能な出力を提供します
- 不明点があれば質問します
- 作業の進捗と結果を共有メモリに記録します

## 出力形式
タスクの結果は JSON 形式で出力してください。`;
}
