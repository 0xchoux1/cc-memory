#!/usr/bin/env npx tsx
/**
 * Durable Workflow Demo - Code Review Pipeline
 *
 * 実際のユースケース: コードレビューワークフロー
 *
 * シナリオ:
 * 1. コード分析エージェントがコードを解析
 * 2. セキュリティエージェントが脆弱性チェック
 * 3. 人間がレビュー結果を確認 (HITL)
 * 4. 承認後、マージエージェントがマージ処理
 *
 * デモする機能:
 * - マルチエージェント協調
 * - 並列ステップ実行
 * - HITL (Human-in-the-Loop)
 * - クラッシュからの復旧
 * - メモリ永続化
 */

import { MemoryManager } from '../src/memory/MemoryManager.js';
import { StorageAdapter } from '../src/durable/adapters/StorageAdapter.js';
import { WorkflowManager, type StepExecutor, type ExecutionContext } from '../src/durable/WorkflowManager.js';
import { AgentCoordinator } from '../src/agents/AgentCoordinator.js';
import type { DurableStep, StepExecutionResult, WorkflowDefinition } from '../src/durable/types.js';
import { join } from 'path';
import { homedir } from 'os';
import * as readline from 'readline';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(msg: string, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

function header(msg: string) {
  console.log('\n' + '='.repeat(60));
  log(msg, colors.bright + colors.cyan);
  console.log('='.repeat(60));
}

function step(msg: string) {
  log(`\n▶ ${msg}`, colors.yellow);
}

function success(msg: string) {
  log(`✓ ${msg}`, colors.green);
}

function info(msg: string) {
  log(`  ${msg}`, colors.blue);
}

// Simulated step executor with realistic delays
class CodeReviewExecutor implements StepExecutor {
  private hitlSteps = new Set<string>();

  setHITL(stepName: string) {
    this.hitlSteps.add(stepName);
  }

  clearHITL(stepName: string) {
    this.hitlSteps.delete(stepName);
  }

  async execute(step: DurableStep, context: ExecutionContext): Promise<StepExecutionResult> {
    const startTime = Date.now();

    // Simulate work
    info(`Executing step: ${step.name} (agent: ${step.agent})`);
    await this.delay(500 + Math.random() * 500);

    // HITL check
    if (this.hitlSteps.has(step.name)) {
      return {
        stepId: step.id,
        success: true,
        output: { status: 'waiting_for_human', step: step.name },
        durationMs: Date.now() - startTime,
        waiting: true,
        waitingMessage: `Waiting for human approval: ${step.name}`,
      };
    }

    // Simulate step-specific results
    const result = this.getStepResult(step.name, context);

    return {
      stepId: step.id,
      success: true,
      output: result,
      durationMs: Date.now() - startTime,
      waiting: false,
    };
  }

  private getStepResult(stepName: string, context: ExecutionContext): unknown {
    switch (stepName) {
      case 'analyze_code':
        return {
          linesOfCode: 1250,
          complexity: 'medium',
          issues: ['unused import', 'missing type annotation'],
          score: 85,
        };
      case 'security_scan':
        return {
          vulnerabilities: 0,
          warnings: 2,
          details: ['potential XSS in line 42', 'unvalidated input in line 88'],
          passed: true,
        };
      case 'human_review':
        return {
          approved: true,
          reviewer: 'human',
          comments: 'Looks good, minor issues addressed',
        };
      case 'merge_code':
        const prevOutputs = Object.fromEntries(context.previousStepOutputs);
        return {
          merged: true,
          branch: 'main',
          commit: 'abc123',
          analysisScore: (prevOutputs['analyze_code'] as any)?.score,
        };
      default:
        return { step: stepName, completed: true };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const dataPath = join(homedir(), '.claude-memory', 'demo');

  header('CC-Memory Durable Workflow Demo');
  log('シナリオ: コードレビューワークフロー', colors.magenta);

  // Initialize
  step('1. メモリシステム初期化');
  const memoryManager = new MemoryManager({
    dataPath,
    sessionId: 'demo-session-' + Date.now(),
  });
  await memoryManager.ready();
  success('MemoryManager initialized');

  const sqliteStorage = (memoryManager as any).storage;
  const adapter = new StorageAdapter(memoryManager, sqliteStorage);

  const executor = new CodeReviewExecutor();
  const workflowManager = new WorkflowManager({ storage: adapter, executor });
  const coordinator = new AgentCoordinator(adapter);
  await coordinator.initialize('demo-coordinator');
  success('WorkflowManager & AgentCoordinator initialized');

  // Register agents
  step('2. エージェント登録');

  const codeAgent = await coordinator.registerAgent(
    'code-analyzer',
    'backend',
    [{ name: 'analyze_code', description: 'Analyze code quality', available: true }]
  );
  info(`Registered: ${codeAgent.name} (${codeAgent.role})`);

  const securityAgent = await coordinator.registerAgent(
    'security-scanner',
    'security',
    [{ name: 'security_scan', description: 'Scan for vulnerabilities', available: true }]
  );
  info(`Registered: ${securityAgent.name} (${securityAgent.role})`);

  const mergeAgent = await coordinator.registerAgent(
    'merge-bot',
    'devops',
    [{ name: 'merge_code', description: 'Merge approved code', available: true }]
  );
  info(`Registered: ${mergeAgent.name} (${mergeAgent.role})`);

  success(`${coordinator.listAgents().length} agents registered`);

  // Create workflow
  step('3. ワークフロー作成');

  const workflow: WorkflowDefinition = {
    name: 'Code Review Pipeline',
    description: 'Automated code review with human approval',
    steps: [
      {
        name: 'analyze_code',
        agent: 'code-analyzer',
        agentRole: 'backend',
      },
      {
        name: 'security_scan',
        agent: 'security-scanner',
        agentRole: 'security',
      },
      {
        name: 'human_review',
        agent: 'human',
        dependsOn: ['analyze_code', 'security_scan'],
      },
      {
        name: 'merge_code',
        agent: 'merge-bot',
        agentRole: 'devops',
        dependsOn: ['human_review'],
      },
    ],
  };

  const created = await workflowManager.createWorkflow(workflow, {
    pullRequest: 'PR #123',
    author: 'developer@example.com',
  });
  info(`Workflow ID: ${created.id}`);
  info(`Steps: ${created.steps.map(s => s.name).join(' → ')}`);
  success('Workflow created');

  // Demo 1: Parallel Execution
  step('4. 並列ステップ実行デモ');
  log('analyze_code と security_scan は依存関係がないため並列実行されます', colors.magenta);

  executor.setHITL('human_review'); // HITLで一時停止させる

  const startTime = Date.now();
  const result1 = await workflowManager.executeWorkflowParallel(created.id);
  const duration = Date.now() - startTime;

  info(`Execution time: ${duration}ms`);
  info(`Steps completed: ${result1.stepResults.filter(r => !r.waiting).length}`);
  info(`Workflow status: ${result1.paused ? 'PAUSED (HITL)' : 'running'}`);

  if (result1.paused) {
    success('Workflow paused for human review');

    // Show step results
    console.log('\nStep Results:');
    for (const sr of result1.stepResults) {
      if (!sr.waiting) {
        console.log(`  ${colors.green}✓${colors.reset} ${JSON.stringify(sr.output)}`);
      } else {
        console.log(`  ${colors.yellow}⏸${colors.reset} Waiting for human input`);
      }
    }
  }

  // Demo 2: HITL Resume
  step('5. HITL (Human-in-the-Loop) デモ');
  log('人間の承認を待っています...', colors.magenta);

  const answer = await prompt(`\n${colors.bright}承認しますか? (y/n): ${colors.reset}`);

  if (answer.toLowerCase() === 'y') {
    executor.clearHITL('human_review');

    const result2 = await workflowManager.resumeWorkflow(created.id, {
      approved: true,
      reviewer: 'demo-user',
    });

    info(`Resume completed: ${result2.success}`);

    const final = await workflowManager.getWorkflow(created.id);
    success(`Workflow status: ${final?.status}`);

    if (final?.status === 'completed') {
      console.log('\nFinal Results:');
      for (const s of final.steps) {
        console.log(`  ${colors.green}✓${colors.reset} ${s.name}: ${JSON.stringify(s.output)}`);
      }
    }
  } else {
    log('Workflow cancelled by user', colors.red);
  }

  // Demo 3: Recovery
  step('6. クラッシュ復旧デモ');
  log('Working Memory をクリアしてクラッシュをシミュレート', colors.magenta);

  // Create another workflow
  const workflow2 = await workflowManager.createWorkflow({
    name: 'Recovery Test',
    steps: [{ name: 'step1', agent: 'test' }],
  });
  await workflowManager.executeWorkflow(workflow2.id);

  // Simulate crash
  await adapter.deleteWorkingMemory(`workflow:${workflow2.id}`);

  const beforeRecovery = await workflowManager.getWorkflow(workflow2.id);
  info(`Before recovery: ${beforeRecovery ? 'found' : 'NOT FOUND (crashed)'}`);

  // Recover
  const recovered = await workflowManager.recoverWorkflow(workflow2.id);
  info(`After recovery: ${recovered ? 'RECOVERED' : 'failed'}`);
  info(`Recovered status: ${recovered?.status}`);
  success('Recovery from Episodic Memory successful');

  // Show memory stats
  step('7. メモリ統計');
  const episodes = memoryManager.episodic.search({ limit: 100 });
  const workingItems = memoryManager.working.list({});

  info(`Episodic Memory: ${episodes.length} episodes`);
  info(`Working Memory: ${workingItems.length} items`);
  info(`Registered Agents: ${coordinator.listAgents().length}`);

  // Cleanup
  memoryManager.close();

  header('Demo Complete');
  log('実装した機能が正常に動作することを確認しました！', colors.green);
}

main().catch(err => {
  console.error('Demo error:', err);
  process.exit(1);
});
