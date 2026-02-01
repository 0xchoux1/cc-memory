#!/usr/bin/env npx tsx
/**
 * cc-memory チュートリアル - 対話形式で基本操作を学ぶ
 *
 * 使用方法:
 *   npx tsx src/cli/tutorial.ts
 *   または
 *   cc-memory tutorial
 */

import * as readline from 'readline';
import { join } from 'path';
import { homedir } from 'os';
import { MemoryManager } from '../memory/MemoryManager.js';

// ============================================================================
// ANSI Colors & Styles
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgBlue: '\x1b[44m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

// ============================================================================
// Helper Functions
// ============================================================================

function log(message: string, color = colors.reset): void {
  console.log(`${color}${message}${colors.reset}`);
}

function logHeader(message: string): void {
  console.log();
  log('='.repeat(60), colors.cyan);
  log(`  ${message}`, colors.bright + colors.cyan);
  log('='.repeat(60), colors.cyan);
  console.log();
}

function logStep(step: number, total: number, title: string): void {
  console.log();
  log(`[${'*'.repeat(step)}${'-'.repeat(total - step)}] ステップ ${step}/${total}`, colors.yellow);
  log(`  ${title}`, colors.bright + colors.white);
  console.log();
}

function logSuccess(message: string): void {
  log(`[OK] ${message}`, colors.green);
}

function logInfo(message: string): void {
  log(`[i] ${message}`, colors.blue);
}

function logTip(message: string): void {
  log(`[Tip] ${message}`, colors.magenta);
}

function logBox(lines: string[], color = colors.cyan): void {
  const maxLen = Math.max(...lines.map(l => l.length));
  const border = '+' + '-'.repeat(maxLen + 2) + '+';
  console.log();
  log(border, color);
  for (const line of lines) {
    log(`| ${line.padEnd(maxLen)} |`, color);
  }
  log(border, color);
  console.log();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function typewrite(text: string, delayMs = 30): Promise<void> {
  for (const char of text) {
    process.stdout.write(char);
    await delay(delayMs);
  }
  console.log();
}

// ============================================================================
// User Input
// ============================================================================

async function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(`${colors.yellow}> ${colors.reset}${question} `, answer => {
      resolve(answer.trim());
    });
  });
}

async function askYesNo(rl: readline.Interface, question: string): Promise<boolean> {
  const answer = await askQuestion(rl, `${question} (y/n)`);
  return answer.toLowerCase().startsWith('y');
}

async function pressEnterToContinue(rl: readline.Interface): Promise<void> {
  await askQuestion(rl, `${colors.gray}Enterキーを押して続ける...${colors.reset}`);
}

// ============================================================================
// Tutorial Steps
// ============================================================================

async function step1Welcome(rl: readline.Interface): Promise<void> {
  logHeader('cc-memory チュートリアルへようこそ!');

  await typewrite('このチュートリアルでは、cc-memoryの基本的な使い方を学びます。', 25);
  console.log();

  log('cc-memoryとは?', colors.bright + colors.white);
  console.log();
  log('  cc-memoryは、AIアシスタント(Claude)に「記憶」を持たせるシステムです。', colors.white);
  log('  普段の会話で学んだことを保存し、次回のセッションでも思い出せます。', colors.white);
  console.log();

  logBox([
    'cc-memoryでできること:',
    '',
    '  - 重要な情報を保存する',
    '  - 過去の会話から学んだことを検索する',
    '  - あなたの好みや設定を覚える',
    '  - プロジェクトの知識を蓄積する',
  ]);

  logTip('このチュートリアルは約5分で完了します');

  await pressEnterToContinue(rl);
}

async function step2SaveMemory(
  rl: readline.Interface,
  memoryManager: MemoryManager
): Promise<{ name: string; content: string }> {
  logStep(2, 5, '記憶を保存してみよう');

  log('まずは、何か覚えておきたいことを保存してみましょう。', colors.white);
  console.log();

  logInfo('例えば...');
  log('  - 「コーヒーが好き」(あなたの好み)', colors.gray);
  log('  - 「プロジェクトAはReactを使う」(プロジェクト情報)', colors.gray);
  log('  - 「会議は毎週月曜10時」(重要な事実)', colors.gray);
  console.log();

  const content = await askQuestion(rl, '何を覚えておきたいですか?');

  if (!content) {
    log('何か入力してください。', colors.red);
    return step2SaveMemory(rl, memoryManager);
  }

  // 名前を自動生成または入力
  log('', colors.reset);
  const useAutoName = await askYesNo(rl, '自動で名前をつけますか?');

  let name: string;
  if (useAutoName) {
    // 内容から自動生成
    name = content.slice(0, 30).replace(/[^\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '_') + '_' + Date.now();
  } else {
    name = await askQuestion(rl, 'この記憶に名前をつけてください:');
  }

  console.log();
  log('保存中...', colors.gray);
  await delay(500);

  try {
    // semantic.create()で保存
    const entity = memoryManager.semantic.create({
      name,
      type: 'fact',
      description: content,
      tags: ['tutorial', 'user-input'],
      confidence: 0.9,
    });

    logSuccess('記憶を保存しました!');
    console.log();

    logBox([
      '保存された記憶:',
      '',
      `  名前: ${entity.name}`,
      `  内容: ${entity.description}`,
      `  種類: fact (事実)`,
      `  ID:   ${entity.id.slice(0, 8)}...`,
    ], colors.green);

    logInfo('なぜこれが便利?');
    log('  保存した情報は、次のセッションでも検索して思い出せます。', colors.gray);
    log('  Claudeが会話の中で、あなたの情報を活用できるようになります。', colors.gray);

    await pressEnterToContinue(rl);

    return { name: entity.name, content };
  } catch (error) {
    log(`エラー: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    logTip('もう一度試してみましょう');
    return step2SaveMemory(rl, memoryManager);
  }
}

async function step3SearchMemory(
  rl: readline.Interface,
  memoryManager: MemoryManager,
  savedContent: { name: string; content: string }
): Promise<void> {
  logStep(3, 5, '記憶を検索してみよう');

  log('次は、さっき保存した記憶を検索してみましょう。', colors.white);
  console.log();

  logInfo(`ヒント: 「${savedContent.content.slice(0, 10)}」に関連するキーワードで検索してみてください`);
  console.log();

  const query = await askQuestion(rl, '検索キーワードを入力してください:');

  if (!query) {
    log('キーワードを入力してください。', colors.red);
    return step3SearchMemory(rl, memoryManager, savedContent);
  }

  console.log();
  log('検索中...', colors.gray);
  await delay(500);

  try {
    const result = memoryManager.recall(query, {
      includeWorking: true,
      includeEpisodic: true,
      includeSemantic: true,
      limit: 5,
    });

    const totalFound = result.working.length + result.episodic.length + result.semantic.length;

    if (totalFound > 0) {
      logSuccess(`${totalFound}件の記憶が見つかりました!`);
      console.log();

      if (result.semantic.length > 0) {
        log('見つかった知識:', colors.bright + colors.white);
        for (const entity of result.semantic) {
          log(`  - ${entity.name}: ${entity.description}`, colors.cyan);
        }
      }

      if (result.episodic.length > 0) {
        log('関連するエピソード:', colors.bright + colors.white);
        for (const episode of result.episodic) {
          log(`  - ${episode.summary}`, colors.cyan);
        }
      }

      console.log();
    } else {
      log('検索結果が見つかりませんでした。', colors.yellow);
      log('別のキーワードで試してみてください。', colors.gray);
      console.log();

      const retry = await askYesNo(rl, 'もう一度検索しますか?');
      if (retry) {
        return step3SearchMemory(rl, memoryManager, savedContent);
      }
    }

    logInfo('なぜこれが便利?');
    log('  Claudeは会話の最初に、関連する記憶を自動で検索します。', colors.gray);
    log('  あなたの過去の会話や好みを踏まえて、より良い返答ができます。', colors.gray);

    await pressEnterToContinue(rl);
  } catch (error) {
    log(`エラー: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    await pressEnterToContinue(rl);
  }
}

async function step4OodaCommands(rl: readline.Interface): Promise<void> {
  logStep(4, 5, 'OODAコマンドを覚えよう');

  log('cc-memoryには、作業を効率化する「OODAコマンド」があります。', colors.white);
  console.log();

  log('OODAとは?', colors.bright + colors.white);
  log('  Observe(観察) -> Orient(判断) -> Decide(決定) -> Act(行動)', colors.gray);
  log('  問題解決や意思決定のための考え方です。', colors.gray);
  console.log();

  logBox([
    'OODAコマンド一覧:',
    '',
    '  /observe   - 現状を把握する',
    '               例: ファイル構成を確認、エラーを分析',
    '',
    '  /assess    - 状況を判断する',
    '               例: 問題の原因を特定、優先順位を決める',
    '',
    '  /plan      - 計画を立てる',
    '               例: 作業手順を作成、タスクを分解',
    '',
    '  /execute   - 実行する',
    '               例: コードを書く、設定を変更',
    '',
    '  /escalate  - 問題を報告する',
    '               例: 解決できない問題を人間に相談',
  ]);

  logTip('これらのコマンドはClaudeとの会話中に使えます');
  logInfo('例: 「/observe プロジェクトの構成を確認して」');

  console.log();
  log('実際に使ってみたいコマンドはありますか?', colors.white);
  log('(スキップする場合はEnterキーを押してください)', colors.gray);
  console.log();

  const selectedCommand = await askQuestion(rl, 'コマンド名を入力:');

  if (selectedCommand) {
    const commands: Record<string, string> = {
      observe: '「/observe」は現状把握に使います。プロジェクトの構造、ファイルの内容、エラーの詳細などを確認するときに便利です。',
      assess: '「/assess」は状況判断に使います。集めた情報から問題の原因を特定したり、次のアクションを決めるときに使います。',
      plan: '「/plan」は計画立案に使います。タスクを小さなステップに分解し、実行順序を決めるときに便利です。',
      execute: '「/execute」は実行フェーズに使います。実際にコードを書いたり、設定を変更するときに使います。',
      escalate: '「/escalate」は問題報告に使います。自分では解決できない問題や、人間の判断が必要なときに使います。',
    };

    const normalizedCmd = selectedCommand.replace('/', '').toLowerCase();
    if (commands[normalizedCmd]) {
      console.log();
      log(commands[normalizedCmd], colors.cyan);
    } else {
      log('そのコマンドは一覧にありません。上記のコマンドを試してみてください。', colors.yellow);
    }
  }

  await pressEnterToContinue(rl);
}

async function step5Completion(rl: readline.Interface, memoryManager: MemoryManager): Promise<void> {
  logStep(5, 5, 'おめでとうございます!');

  console.log();
  await typewrite('基本的な使い方をマスターしました!', 30);
  console.log();

  log('[*****] チュートリアル完了!', colors.green + colors.bright);
  console.log();

  // 現在の記憶統計を表示
  const stats = memoryManager.getStats();

  logBox([
    'あなたの記憶システムの状態:',
    '',
    `  保存された知識: ${stats.semantic.entities}件`,
    `  記録されたエピソード: ${stats.episodic.total}件`,
    `  一時的なメモ: ${stats.working.total}件`,
  ], colors.green);

  log('次のステップ:', colors.bright + colors.white);
  console.log();
  log('  1. Claudeとの会話で記憶機能を活用してみましょう', colors.white);
  log('     - 「これを覚えておいて」と言うと記憶されます', colors.gray);
  log('     - 過去の会話を踏まえた返答が得られます', colors.gray);
  console.log();
  log('  2. OODAコマンドを使って作業を効率化しましょう', colors.white);
  log('     - /observe で現状把握', colors.gray);
  log('     - /plan で計画立案', colors.gray);
  console.log();
  log('  3. 詳しいドキュメントを読む', colors.white);
  log('     - https://github.com/anthropics/cc-memory', colors.gray);
  console.log();

  logInfo('ヘルプが必要なときは「cc-memory --help」を実行してください');

  console.log();
  log('ご利用いただきありがとうございました!', colors.bright + colors.cyan);
  console.log();
}

// ============================================================================
// Main Tutorial Flow
// ============================================================================

async function runTutorial(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // 一時的なデータパスを使用（チュートリアル用）
  const dataPath = join(homedir(), '.claude-memory', 'tutorial');

  const memoryManager = new MemoryManager({
    dataPath,
    sessionId: `tutorial-${Date.now()}`,
  });

  await memoryManager.ready();

  try {
    // Step 1: 挨拶と説明
    await step1Welcome(rl);

    // Step 2: 記憶の保存を体験
    const savedContent = await step2SaveMemory(rl, memoryManager);

    // Step 3: 記憶の検索を体験
    await step3SearchMemory(rl, memoryManager, savedContent);

    // Step 4: OODAコマンドの紹介
    await step4OodaCommands(rl);

    // Step 5: 完了
    await step5Completion(rl, memoryManager);
  } catch (error) {
    if (error instanceof Error && error.message.includes('readline was closed')) {
      // ユーザーがCtrl+Cで終了した場合
      console.log();
      log('チュートリアルを中断しました。', colors.yellow);
    } else {
      log(`エラーが発生しました: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    }
  } finally {
    rl.close();
    memoryManager.close();
  }
}

// ============================================================================
// Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    log('\ncc-memory チュートリアル', colors.bright + colors.cyan);
    log('\n対話形式で基本的な使い方を学べます。', colors.white);
    log('\n使用方法:', colors.yellow);
    log('  npx tsx src/cli/tutorial.ts', colors.gray);
    log('  cc-memory tutorial', colors.gray);
    log('\nオプション:', colors.yellow);
    log('  --help, -h    このヘルプを表示', colors.gray);
    log('  --quick       クイックモード(説明を省略)', colors.gray);
    return;
  }

  await runTutorial();
}

main().catch(error => {
  console.error(`エラー: ${error.message}`);
  process.exit(1);
});
