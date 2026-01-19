#!/usr/bin/env npx tsx
/**
 * 実用例: 大規模リファクタリングワークフロー
 *
 * Claude Code で大きなリファクタリングを行う際、
 * セッションが切れても途中から再開できる。
 */

import { MemoryManager } from '../src/memory/MemoryManager.js';
import { StorageAdapter } from '../src/durable/adapters/StorageAdapter.js';
import { WorkflowManager, type StepExecutor, type ExecutionContext } from '../src/durable/WorkflowManager.js';
import type { DurableStep, StepExecutionResult, WorkflowDefinition } from '../src/durable/types.js';
import { join } from 'path';
import { homedir } from 'os';

// 実際の作業をシミュレートする Executor
class RefactoringExecutor implements StepExecutor {
  async execute(step: DurableStep, context: ExecutionContext): Promise<StepExecutionResult> {
    console.log(`\n[${step.name}] 実行中...`);

    // ここで実際の作業を行う
    // 例: ファイル読み込み、変換、書き込み等

    await new Promise(r => setTimeout(r, 500));

    return {
      stepId: step.id,
      success: true,
      output: {
        step: step.name,
        filesModified: Math.floor(Math.random() * 10) + 1,
        timestamp: new Date().toISOString()
      },
      durationMs: 500,
      waiting: false,
    };
  }
}

async function main() {
  const workflowId = process.argv[2]; // 既存のワークフローIDを引数で受け取る

  const dataPath = join(homedir(), '.claude-memory', 'refactoring');
  const memoryManager = new MemoryManager({ dataPath, sessionId: 'refactoring' });
  await memoryManager.ready();

  const adapter = new StorageAdapter(memoryManager, (memoryManager as any).storage);
  const executor = new RefactoringExecutor();
  const manager = new WorkflowManager({ storage: adapter, executor });

  if (workflowId) {
    // 既存ワークフローを再開
    console.log(`\n=== ワークフロー再開: ${workflowId} ===`);

    let workflow = await manager.getWorkflow(workflowId);

    if (!workflow) {
      console.log('Working Memory にない。Episodic Memory から復旧中...');
      workflow = await manager.recoverWorkflow(workflowId);
    }

    if (workflow) {
      console.log(`Status: ${workflow.status}`);
      console.log(`Progress: ${workflow.steps.filter(s => s.status === 'completed').length}/${workflow.steps.length}`);

      if (workflow.status === 'pending' || workflow.status === 'paused') {
        const result = await manager.executeWorkflow(workflowId);
        console.log(`\n完了: ${result.success ? '成功' : '失敗'}`);
      }
    } else {
      console.log('ワークフローが見つかりません');
    }
  } else {
    // 新規ワークフロー作成
    console.log('\n=== 新規リファクタリングワークフロー作成 ===');

    const workflow: WorkflowDefinition = {
      name: 'TypeScript Migration',
      description: 'JavaScript から TypeScript への移行',
      steps: [
        { name: 'analyze_codebase', agent: 'claude' },
        { name: 'add_tsconfig', agent: 'claude', dependsOn: ['analyze_codebase'] },
        { name: 'rename_js_to_ts', agent: 'claude', dependsOn: ['add_tsconfig'] },
        { name: 'add_type_annotations', agent: 'claude', dependsOn: ['rename_js_to_ts'] },
        { name: 'fix_type_errors', agent: 'claude', dependsOn: ['add_type_annotations'] },
        { name: 'run_tests', agent: 'claude', dependsOn: ['fix_type_errors'] },
      ],
    };

    const created = await manager.createWorkflow(workflow);
    console.log(`\nワークフローID: ${created.id}`);
    console.log('このIDを保存して、後で再開できます:\n');
    console.log(`  npx tsx scripts/example-refactoring-workflow.ts ${created.id}`);

    // 最初の2ステップだけ実行して中断をシミュレート
    console.log('\n--- 最初の2ステップを実行 (その後中断) ---');

    for (let i = 0; i < 2; i++) {
      const step = created.steps[i];
      step.status = 'completed';
      step.output = { step: step.name, completed: true };
      step.completedAt = Date.now();
    }
    created.currentStepIndex = 2;
    await adapter.setWorkingMemory(`workflow:${created.id}`, created, 'task_state');

    console.log('\n中断しました。再開するには:');
    console.log(`  npx tsx scripts/example-refactoring-workflow.ts ${created.id}`);
  }

  memoryManager.close();
}

main().catch(console.error);
