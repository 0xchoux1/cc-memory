#!/usr/bin/env npx tsx
/**
 * cc-agent CLI - マルチエージェントタスク実行ツール
 *
 * 使用例:
 *   npx tsx src/cli/agent-cli.ts run "テストを作成して"
 *   npx tsx src/cli/agent-cli.ts interactive
 */

import * as readline from 'readline';
import { join } from 'path';
import { homedir } from 'os';
import { MemoryManager } from '../memory/MemoryManager.js';
import { StorageAdapter } from '../durable/adapters/StorageAdapter.js';
import { WorkflowManager } from '../durable/WorkflowManager.js';
import { AgentCoordinator } from '../agents/AgentCoordinator.js';
import { AgentManager, type ProgressUpdate } from '../agents/AgentManager.js';
import { WorkerAgentExecutor } from '../agents/WorkerAgentExecutor.js';
import { ClaudeWorkerAgentFactory } from '../agents/ClaudeWorkerAgent.js';
import { ClaudeCodeWorkerAgentFactory } from '../agents/ClaudeCodeWorkerAgent.js';
import { resolveApiKey } from '../agents/WorkerAgent.js';

// ============================================================================
// ANSI Colors
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

function log(message: string, color = colors.reset): void {
  console.log(`${color}${message}${colors.reset}`);
}

function logProgress(update: ProgressUpdate): void {
  const icons: Record<string, string> = {
    workflow_created: '📋',
    workflow_started: '🚀',
    step_started: '▶️',
    step_completed: '✅',
    step_failed: '❌',
    step_waiting: '⏸️',
    workflow_paused: '⏸️',
    workflow_completed: '🎉',
    workflow_failed: '💥',
  };

  const icon = icons[update.type] ?? '•';
  const color =
    update.type.includes('completed') || update.type.includes('success')
      ? colors.green
      : update.type.includes('failed')
        ? colors.red
        : update.type.includes('waiting') || update.type.includes('paused')
          ? colors.yellow
          : colors.cyan;

  log(`${icon} ${update.message}`, color);

  if (update.stepName) {
    log(`   Step: ${update.stepName}`, colors.gray);
  }
}

// ============================================================================
// Setup Functions
// ============================================================================

interface AppContext {
  memoryManager: MemoryManager;
  adapter: StorageAdapter;
  coordinator: AgentCoordinator;
  workflowManager: WorkflowManager;
  agentManager: AgentManager;
}

async function setupApp(): Promise<AppContext> {
  const dataPath = join(homedir(), '.claude-memory', 'agent-cli');

  // MemoryManager を初期化
  const memoryManager = new MemoryManager({
    dataPath,
    sessionId: `cli-${Date.now()}`,
  });
  await memoryManager.ready();

  // StorageAdapter を作成
  const sqliteStorage = (memoryManager as any).storage;
  const adapter = new StorageAdapter(memoryManager, sqliteStorage);

  // AgentCoordinator を初期化
  const coordinator = new AgentCoordinator(adapter);
  await coordinator.initialize('cli-coordinator');

  // API キー vs OAuth トークンでファクトリを選択
  let factory: ClaudeWorkerAgentFactory | ClaudeCodeWorkerAgentFactory;
  let useClaudeCode = false;

  // API キー (sk-ant-api01-...) があるかチェック
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasRealApiKey = apiKey && apiKey.startsWith('sk-ant-api01-');

  if (hasRealApiKey) {
    factory = new ClaudeWorkerAgentFactory();
    log('🔑 API キーモード (Anthropic API)', colors.gray);
  } else {
    // OAuth トークンまたはサブスクリプションモード
    factory = new ClaudeCodeWorkerAgentFactory({ model: 'sonnet' });
    useClaudeCode = true;
    log('🔄 Claude Code モード (サブスクリプション)', colors.gray);
  }

  // AgentManager を作成（循環依存を避けるため、後で executor を設定）
  const agentManager = new AgentManager({
    storage: adapter,
    coordinator,
    workflowManager: null as any, // 後で設定
    factory, // 同じファクトリを使用（API モードまたは Claude Code モード）
    onProgress: logProgress,
    onHumanInput: async question => {
      return await promptUser(question.question);
    },
    debug: process.env.DEBUG === 'true',
  });

  // WorkerAgentExecutor を作成
  const executor = new WorkerAgentExecutor({
    agentManager,
    factory,
    createAgentsOnDemand: true,
    debug: process.env.DEBUG === 'true',
  });

  // WorkflowManager を作成
  const workflowManager = new WorkflowManager({
    storage: adapter,
    executor,
  });

  // AgentManager に WorkflowManager を設定
  (agentManager as any).config.workflowManager = workflowManager;

  // AgentManager を初期化
  await agentManager.initialize();

  return {
    memoryManager,
    adapter,
    coordinator,
    workflowManager,
    agentManager,
  };
}

async function cleanup(context: AppContext): Promise<void> {
  await context.agentManager.shutdown();
  context.memoryManager.close();
}

// ============================================================================
// User Input
// ============================================================================

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(`${colors.bright}${question} ${colors.reset}`, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ============================================================================
// Commands
// ============================================================================

async function runCommand(instruction: string): Promise<void> {
  log('\n🤖 cc-agent - マルチエージェントタスク実行', colors.bright + colors.cyan);
  log('='.repeat(50), colors.gray);

  const context = await setupApp();

  try {
    log(`\n📝 タスク: ${instruction}`, colors.magenta);
    log('', colors.reset);

    // ワークフローを作成・実行
    const workflow = await context.agentManager.handleInstruction(instruction);

    log(`\n📋 ワークフロー作成: ${workflow.name}`, colors.blue);
    log(`   ステップ数: ${workflow.steps.length}`, colors.gray);

    // 進捗を監視
    for await (const update of context.agentManager.monitorExecution(workflow.id)) {
      // 進捗は onProgress コールバックで表示されるので、ここでは何もしない
    }

    // 最終レポート
    log('\n' + '='.repeat(50), colors.gray);
    const report = await context.agentManager.reportToHuman(workflow.id);
    console.log(report);
  } catch (error) {
    log(`\n❌ エラー: ${error instanceof Error ? error.message : String(error)}`, colors.red);
  } finally {
    await cleanup(context);
  }
}

async function interactiveCommand(): Promise<void> {
  log('\n🤖 cc-agent - インタラクティブモード', colors.bright + colors.cyan);
  log('='.repeat(50), colors.gray);
  log('タスクを入力してください。"exit" で終了します。\n', colors.gray);

  const context = await setupApp();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question(`${colors.bright}> ${colors.reset}`, async line => {
      const input = line.trim();

      if (input === 'exit' || input === 'quit') {
        log('\n👋 終了します', colors.cyan);
        await cleanup(context);
        rl.close();
        return;
      }

      if (input === 'help') {
        log('\nコマンド:', colors.yellow);
        log('  <タスク>  - タスクを実行', colors.gray);
        log('  status    - 現在の状態を表示', colors.gray);
        log('  agents    - 登録されているエージェントを表示', colors.gray);
        log('  exit      - 終了', colors.gray);
        log('', colors.reset);
        prompt();
        return;
      }

      if (input === 'status') {
        log('\n📊 ステータス', colors.yellow);
        log(`   エージェント数: ${context.agentManager.listWorkers().length}`, colors.gray);
        log('', colors.reset);
        prompt();
        return;
      }

      if (input === 'agents') {
        log('\n🤖 登録されているエージェント', colors.yellow);
        const workers = context.agentManager.listWorkers();
        if (workers.length === 0) {
          log('   (なし - タスク実行時に自動作成されます)', colors.gray);
        } else {
          for (const worker of workers) {
            log(`   • ${worker.profile.name} (${worker.profile.role})`, colors.gray);
          }
        }
        log('', colors.reset);
        prompt();
        return;
      }

      if (!input) {
        prompt();
        return;
      }

      try {
        const workflow = await context.agentManager.handleInstruction(input);
        log(`\n📋 ワークフロー開始: ${workflow.name}`, colors.blue);

        // 進捗を監視（非同期）
        (async () => {
          for await (const _ of context.agentManager.monitorExecution(workflow.id)) {
            // 進捗は onProgress で表示
          }

          const report = await context.agentManager.reportToHuman(workflow.id);
          log('\n' + report, colors.reset);
          prompt();
        })();
      } catch (error) {
        log(`\n❌ エラー: ${error instanceof Error ? error.message : String(error)}`, colors.red);
        prompt();
      }
    });
  };

  prompt();
}

async function listCommand(): Promise<void> {
  log('\n🤖 cc-agent - 利用可能なエージェントロール', colors.bright + colors.cyan);
  log('='.repeat(50), colors.gray);

  const roles = [
    { role: 'frontend', desc: 'フロントエンド開発（UI/UX、React、CSS）' },
    { role: 'backend', desc: 'バックエンド開発（API、データベース、サーバー）' },
    { role: 'security', desc: 'セキュリティ（脆弱性分析、監査）' },
    { role: 'testing', desc: 'テスト・QA（ユニットテスト、E2E）' },
    { role: 'devops', desc: 'DevOps（CI/CD、インフラ、デプロイ）' },
    { role: 'architecture', desc: 'アーキテクチャ設計（システム設計、技術選定）' },
    { role: 'data', desc: 'データエンジニアリング（ETL、分析、ML）' },
    { role: 'general', desc: '汎用（ドキュメント、コーディネーション）' },
  ];

  for (const { role, desc } of roles) {
    log(`  ${colors.cyan}${role.padEnd(14)}${colors.reset} ${desc}`);
  }

  log('\nタスク実行時に適切なエージェントが自動的に選択・作成されます。', colors.gray);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    log('\n🤖 cc-agent - マルチエージェントタスク実行ツール', colors.bright + colors.cyan);
    log('\n使用方法:', colors.yellow);
    log('  cc-agent run <instruction>  タスクを実行', colors.gray);
    log('  cc-agent interactive        インタラクティブモード', colors.gray);
    log('  cc-agent list               利用可能なエージェントを表示', colors.gray);
    log('  cc-agent help               ヘルプを表示', colors.gray);
    log('\n例:', colors.yellow);
    log('  cc-agent run "テストを作成して"', colors.gray);
    log('  cc-agent run "セキュリティチェックを実行"', colors.gray);
    log('\n環境変数:', colors.yellow);
    log('  ANTHROPIC_API_KEY  Claude API キー（必須）', colors.gray);
    log('  DEBUG=true         デバッグモード', colors.gray);
    return;
  }

  switch (command) {
    case 'run':
      const instruction = args.slice(1).join(' ');
      if (!instruction) {
        log('エラー: タスクを指定してください', colors.red);
        log('使用方法: cc-agent run <instruction>', colors.gray);
        process.exit(1);
      }
      await runCommand(instruction);
      break;

    case 'interactive':
    case 'i':
      await interactiveCommand();
      break;

    case 'list':
    case 'ls':
      await listCommand();
      break;

    default:
      // コマンドなしでタスクが指定された場合は run として扱う
      const fullInstruction = args.join(' ');
      await runCommand(fullInstruction);
  }
}

main().catch(error => {
  log(`\n💥 致命的なエラー: ${error.message}`, colors.red);
  if (process.env.DEBUG === 'true') {
    console.error(error);
  }
  process.exit(1);
});
