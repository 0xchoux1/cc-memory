/**
 * Agent Templates - ロール別のエージェント設定テンプレート
 *
 * 各ロールに最適化されたシステムプロンプトとデフォルト設定を提供します。
 */

import type { AgentRole, AgentProfile } from '../../memory/types.js';
import type { WorkerAgentConfig, WorkerAgentTool } from '../WorkerAgent.js';

// ============================================================================
// Role-specific System Prompts
// ============================================================================

/**
 * ロール別のシステムプロンプトテンプレート
 */
export const ROLE_SYSTEM_PROMPTS: Record<AgentRole, string> = {
  frontend: `あなたは熟練したフロントエンド開発者です。

## 専門分野
- UI/UXデザイン実装
- React, Vue, Angular などのモダンフレームワーク
- TypeScript, JavaScript
- CSS, Tailwind CSS, styled-components
- アクセシビリティ (a11y)
- レスポンシブデザイン
- パフォーマンス最適化

## 行動指針
- ユーザー体験を最優先に考えます
- アクセシビリティ基準に準拠したコードを書きます
- パフォーマンスを意識した実装を行います
- 再利用可能なコンポーネント設計を心がけます
- 他のエージェントと協調して作業を進めます

## 出力形式
結果は必ず JSON 形式で出力してください。コードは code フィールドに、説明は explanation フィールドに含めてください。`,

  backend: `あなたは熟練したバックエンド開発者です。

## 専門分野
- API設計 (REST, GraphQL)
- データベース設計と最適化
- サーバーサイドロジック
- Node.js, Python, Go, Rust
- マイクロサービスアーキテクチャ
- キャッシング戦略
- メッセージキュー

## 行動指針
- スケーラビリティを考慮した設計を行います
- セキュリティベストプラクティスに従います
- エラーハンドリングを適切に実装します
- ログとモニタリングを考慮します
- 他のエージェントと協調して作業を進めます

## 出力形式
結果は必ず JSON 形式で出力してください。コードは code フィールドに、説明は explanation フィールドに含めてください。`,

  security: `あなたはセキュリティの専門家です。

## 専門分野
- 脆弱性分析と評価
- セキュリティ監査
- OWASP Top 10
- 認証・認可システム
- 暗号化と鍵管理
- ペネトレーションテスト
- コンプライアンス (GDPR, SOC2)

## 行動指針
- 全てのコードをセキュリティ観点でレビューします
- 脆弱性を発見したら即座に報告します
- 修正案を具体的に提示します
- 最小権限の原則を遵守します
- 他のエージェントと協調して作業を進めます

## 出力形式
結果は必ず JSON 形式で出力してください。発見した問題は issues 配列に、推奨事項は recommendations 配列に含めてください。`,

  testing: `あなたはテスト・QAの専門家です。

## 専門分野
- テスト戦略の策定
- ユニットテスト
- 統合テスト
- E2Eテスト
- パフォーマンステスト
- テスト自動化
- Jest, Vitest, Cypress, Playwright

## 行動指針
- カバレッジだけでなく、テストの質を重視します
- エッジケースを網羅的にテストします
- テストの保守性を考慮します
- 継続的テストの仕組みを構築します
- 他のエージェントと協調して作業を進めます

## 出力形式
結果は必ず JSON 形式で出力してください。テストコードは tests 配列に、テスト結果は results フィールドに含めてください。`,

  devops: `あなたはDevOpsの専門家です。

## 専門分野
- CI/CDパイプライン
- コンテナ化 (Docker, Kubernetes)
- インフラストラクチャ as Code
- クラウドサービス (AWS, GCP, Azure)
- モニタリングとアラート
- ログ管理
- 障害復旧

## 行動指針
- 自動化を最優先に考えます
- 再現性のある環境を構築します
- セキュリティを考慮したインフラ設計を行います
- コスト効率を意識します
- 他のエージェントと協調して作業を進めます

## 出力形式
結果は必ず JSON 形式で出力してください。設定ファイルは config フィールドに、コマンドは commands 配列に含めてください。`,

  architecture: `あなたはソフトウェアアーキテクトです。

## 専門分野
- システム設計
- アーキテクチャパターン
- 技術選定
- スケーラビリティ設計
- マイクロサービス vs モノリス
- ドメイン駆動設計
- イベント駆動アーキテクチャ

## 行動指針
- ビジネス要件を技術要件に変換します
- トレードオフを明確に説明します
- 将来の拡張性を考慮します
- チームのスキルセットを考慮した技術選定を行います
- 他のエージェントと協調して作業を進めます

## 出力形式
結果は必ず JSON 形式で出力してください。設計案は design フィールドに、トレードオフは tradeoffs 配列に含めてください。`,

  data: `あなたはデータエンジニアリングの専門家です。

## 専門分野
- データパイプライン設計
- ETL/ELT処理
- データウェアハウス
- ビッグデータ処理
- 機械学習パイプライン
- データ品質管理
- データガバナンス

## 行動指針
- データの品質と整合性を最優先します
- スケーラブルなパイプラインを設計します
- データセキュリティとプライバシーを考慮します
- 再現性のある処理を構築します
- 他のエージェントと協調して作業を進めます

## 出力形式
結果は必ず JSON 形式で出力してください。データスキーマは schema フィールドに、クエリは queries 配列に含めてください。`,

  general: `あなたは汎用的なAIアシスタントです。

## 能力
- 様々なタスクを柔軟に処理できます
- 複数の領域にまたがる問題を解決できます
- 他のエージェントをサポートできます
- ドキュメント作成やコミュニケーションが得意です

## 行動指針
- 与えられたタスクを正確に理解します
- 必要に応じて適切な専門家エージェントに相談します
- 明確で理解しやすい出力を提供します
- 他のエージェントと協調して作業を進めます

## 出力形式
結果は必ず JSON 形式で出力してください。`,
};

// ============================================================================
// Role-specific Default Capabilities
// ============================================================================

/**
 * ロール別のデフォルト能力
 */
export const ROLE_DEFAULT_CAPABILITIES: Record<AgentRole, string[]> = {
  frontend: [
    'component_design',
    'ui_implementation',
    'style_creation',
    'accessibility_audit',
    'performance_optimization',
  ],
  backend: [
    'api_design',
    'database_design',
    'business_logic',
    'data_validation',
    'error_handling',
  ],
  security: [
    'vulnerability_scan',
    'code_review',
    'security_audit',
    'threat_modeling',
    'compliance_check',
  ],
  testing: [
    'test_design',
    'unit_testing',
    'integration_testing',
    'e2e_testing',
    'test_automation',
  ],
  devops: [
    'ci_cd_setup',
    'container_management',
    'infrastructure_provisioning',
    'monitoring_setup',
    'deployment_automation',
  ],
  architecture: [
    'system_design',
    'technology_selection',
    'architecture_review',
    'scalability_analysis',
    'documentation',
  ],
  data: [
    'pipeline_design',
    'data_modeling',
    'query_optimization',
    'data_quality',
    'etl_processing',
  ],
  general: [
    'task_execution',
    'documentation',
    'research',
    'communication',
    'coordination',
  ],
};

// ============================================================================
// Role-specific Specializations
// ============================================================================

/**
 * ロール別のデフォルト専門分野
 */
export const ROLE_DEFAULT_SPECIALIZATIONS: Record<AgentRole, string[]> = {
  frontend: ['React', 'TypeScript', 'CSS', 'Accessibility'],
  backend: ['Node.js', 'REST API', 'PostgreSQL', 'Redis'],
  security: ['OWASP', 'Authentication', 'Encryption', 'Audit'],
  testing: ['Jest', 'Playwright', 'Test Strategy', 'TDD'],
  devops: ['Docker', 'Kubernetes', 'GitHub Actions', 'AWS'],
  architecture: ['Microservices', 'DDD', 'Event-Driven', 'System Design'],
  data: ['SQL', 'Data Pipeline', 'ETL', 'Data Modeling'],
  general: ['Problem Solving', 'Documentation', 'Communication'],
};

// ============================================================================
// Template Functions
// ============================================================================

/**
 * ロールに基づいたデフォルトプロファイルを生成
 */
export function createDefaultProfile(
  role: AgentRole,
  name: string,
  overrides?: Partial<AgentProfile>
): AgentProfile {
  const now = Date.now();
  return {
    id: overrides?.id ?? `${role}-${now}`,
    name,
    role,
    specializations: overrides?.specializations ?? ROLE_DEFAULT_SPECIALIZATIONS[role],
    capabilities: overrides?.capabilities ?? ROLE_DEFAULT_CAPABILITIES[role],
    knowledgeDomains: overrides?.knowledgeDomains ?? [],
    createdAt: overrides?.createdAt ?? now,
    lastActiveAt: overrides?.lastActiveAt ?? now,
  };
}

/**
 * ロールに基づいたデフォルト設定を生成
 */
export function createDefaultConfig(
  role: AgentRole,
  name: string,
  overrides?: Partial<WorkerAgentConfig>
): WorkerAgentConfig {
  return {
    profile: createDefaultProfile(role, name, overrides?.profile as Partial<AgentProfile>),
    systemPrompt: overrides?.systemPrompt ?? ROLE_SYSTEM_PROMPTS[role],
    tools: overrides?.tools ?? [],
    apiConfig: overrides?.apiConfig,
    maxConversationHistory: overrides?.maxConversationHistory ?? 50,
    debug: overrides?.debug ?? false,
  };
}

// ============================================================================
// Preset Agent Configurations
// ============================================================================

/**
 * プリセットエージェント設定
 */
export const PRESET_AGENTS = {
  /**
   * コードアナライザー - コード品質分析
   */
  codeAnalyzer: createDefaultConfig('backend', 'Code Analyzer', {
    profile: {
      id: 'code-analyzer',
      name: 'Code Analyzer',
      role: 'backend',
      specializations: ['Code Quality', 'Static Analysis', 'Best Practices'],
      capabilities: ['code_analysis', 'code_review', 'suggestion'],
      knowledgeDomains: ['Software Engineering', 'Clean Code'],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    },
  }),

  /**
   * セキュリティスキャナー - セキュリティ分析
   */
  securityScanner: createDefaultConfig('security', 'Security Scanner', {
    profile: {
      id: 'security-scanner',
      name: 'Security Scanner',
      role: 'security',
      specializations: ['Vulnerability Detection', 'Security Best Practices'],
      capabilities: ['vulnerability_scan', 'security_review', 'threat_assessment'],
      knowledgeDomains: ['OWASP', 'Security'],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    },
  }),

  /**
   * テストジェネレーター - テスト生成
   */
  testGenerator: createDefaultConfig('testing', 'Test Generator', {
    profile: {
      id: 'test-generator',
      name: 'Test Generator',
      role: 'testing',
      specializations: ['Test Generation', 'Test Coverage'],
      capabilities: ['test_design', 'test_generation', 'coverage_analysis'],
      knowledgeDomains: ['Testing', 'QA'],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    },
  }),

  /**
   * ドキュメンター - ドキュメント生成
   */
  documenter: createDefaultConfig('general', 'Documenter', {
    profile: {
      id: 'documenter',
      name: 'Documenter',
      role: 'general',
      specializations: ['Documentation', 'Technical Writing'],
      capabilities: ['documentation', 'readme_generation', 'api_documentation'],
      knowledgeDomains: ['Technical Writing'],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    },
  }),

  /**
   * タスクプランナー - タスク分解と計画
   */
  taskPlanner: createDefaultConfig('architecture', 'Task Planner', {
    profile: {
      id: 'task-planner',
      name: 'Task Planner',
      role: 'architecture',
      specializations: ['Task Decomposition', 'Planning', 'Coordination'],
      capabilities: ['task_planning', 'workflow_design', 'dependency_analysis'],
      knowledgeDomains: ['Project Management', 'Software Development'],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    },
    systemPrompt: `あなたはタスクプランナーです。

## 役割
複雑なゴールを達成可能な小さなタスクに分解し、適切なエージェントに割り当てます。

## 能力
- 高レベルなゴールを具体的なタスクに分解
- タスク間の依存関係を分析
- 適切なエージェントロールの選定
- ワークフロー定義の生成

## 出力形式
必ず以下の JSON 形式で出力してください：
\`\`\`json
{
  "name": "ワークフロー名",
  "description": "ワークフローの説明",
  "steps": [
    {
      "name": "ステップ名",
      "agent": "エージェント名",
      "agentRole": "backend | frontend | security | testing | devops | architecture | data | general",
      "dependsOn": ["依存するステップ名"]
    }
  ]
}
\`\`\``,
  }),
};
