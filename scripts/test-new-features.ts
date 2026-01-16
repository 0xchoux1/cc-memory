#!/usr/bin/env npx ts-node
/**
 * 動作テストスクリプト - タチコマ並列化 & DIKW知恵昇華機能
 */

import { SqliteStorage } from '../src/storage/SqliteStorage.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_DATA_PATH = join(process.cwd(), '.test-new-features');

// テスト用ストレージの準備
function setupTestStorage(): SqliteStorage {
  if (existsSync(TEST_DATA_PATH)) {
    rmSync(TEST_DATA_PATH, { recursive: true });
  }
  mkdirSync(TEST_DATA_PATH, { recursive: true });

  return new SqliteStorage({ dataPath: TEST_DATA_PATH });
}

// クリーンアップ
function cleanup() {
  if (existsSync(TEST_DATA_PATH)) {
    rmSync(TEST_DATA_PATH, { recursive: true });
  }
}

async function runTests() {
  console.log('🚀 新機能動作テスト開始\n');
  console.log('='.repeat(60));

  const storage = setupTestStorage();
  await storage.initialize();

  let passed = 0;
  let failed = 0;

  // ============================================================================
  // テスト 1: タチコマ初期化
  // ============================================================================
  console.log('\n📦 テスト 1: タチコマ初期化');
  try {
    const profile = storage.initTachikoma('tachi-alpha', 'タチコマ-アルファ');
    console.log('  ✅ ID:', profile.id);
    console.log('  ✅ Name:', profile.name);
    console.log('  ✅ SyncSeq:', profile.syncSeq);
    console.log('  ✅ SyncVector:', JSON.stringify(profile.syncVector));
    passed++;
  } catch (error) {
    console.log('  ❌ エラー:', (error as Error).message);
    failed++;
  }

  // ============================================================================
  // テスト 2: タチコマステータス
  // ============================================================================
  console.log('\n📦 テスト 2: タチコマステータス取得');
  try {
    const status = storage.getTachikomaProfile();
    if (status) {
      console.log('  ✅ ステータス取得成功');
      console.log('  ✅ LastSyncAt:', status.lastSyncAt || 'なし');
      passed++;
    } else {
      console.log('  ❌ ステータスがnull');
      failed++;
    }
  } catch (error) {
    console.log('  ❌ エラー:', (error as Error).message);
    failed++;
  }

  // ============================================================================
  // テスト 3: エージェント登録
  // ============================================================================
  console.log('\n👤 テスト 3: エージェント登録');
  try {
    const frontendAgent = storage.createAgent({
      name: 'Frontend Agent',
      role: 'frontend',
      specializations: ['React', 'TypeScript', 'CSS'],
      capabilities: ['UI実装', 'パフォーマンス最適化'],
      knowledgeDomains: ['Web開発', 'UX'],
    });
    console.log('  ✅ フロントエンドエージェント登録:', frontendAgent.id);

    const backendAgent = storage.createAgent({
      name: 'Backend Agent',
      role: 'backend',
      specializations: ['Node.js', 'PostgreSQL', 'Redis'],
      capabilities: ['API設計', 'DB設計'],
      knowledgeDomains: ['サーバーサイド', 'インフラ'],
    });
    console.log('  ✅ バックエンドエージェント登録:', backendAgent.id);

    const agents = storage.listAgents();
    console.log('  ✅ 登録エージェント数:', agents.length);
    passed++;
  } catch (error) {
    console.log('  ❌ エラー:', (error as Error).message);
    failed++;
  }

  // ============================================================================
  // テスト 4: パターン作成（DIKW Level 2）
  // ============================================================================
  console.log('\n🔍 テスト 4: パターン作成（DIKW Level 2）');
  try {
    const pattern1 = storage.createPattern({
      pattern: 'APIレスポンスが大きい場合、ページネーションを実装すべき',
      supportingEpisodes: [],
      relatedTags: ['API', 'パフォーマンス'],
      confidence: 0.8,
    });
    console.log('  ✅ パターン1作成:', pattern1.id);
    console.log('    - パターン:', pattern1.pattern.substring(0, 40) + '...');
    console.log('    - 信頼度:', pattern1.confidence);
    console.log('    - ステータス:', pattern1.status);

    const pattern2 = storage.createPattern({
      pattern: 'エラーハンドリングは早期リターンパターンを使用',
      relatedTags: ['エラーハンドリング', 'コード品質'],
      confidence: 0.9,
    });
    console.log('  ✅ パターン2作成:', pattern2.id);

    // パターン確認
    storage.updatePatternStatus(pattern1.id, 'confirmed');
    const confirmedPattern = storage.getPattern(pattern1.id);
    console.log('  ✅ パターン確認後ステータス:', confirmedPattern?.status);

    passed++;
  } catch (error) {
    console.log('  ❌ エラー:', (error as Error).message);
    failed++;
  }

  // ============================================================================
  // テスト 5: インサイト作成（DIKW Level 3）
  // ============================================================================
  console.log('\n💡 テスト 5: インサイト作成（DIKW Level 3）');
  try {
    const patterns = storage.listPatterns();
    const insight = storage.createInsight({
      insight: 'フロントエンドとバックエンド両方で無制限データ取得は問題を引き起こす',
      reasoning: '複数のパターンから、大量データ取得がUI固まりとDBコネクション枯渇の両方を引き起こすことが判明',
      sourcePatterns: patterns.map(p => p.id),
      domains: ['API設計', 'パフォーマンス'],
      confidence: 0.85,
    });
    console.log('  ✅ インサイト作成:', insight.id);
    console.log('    - インサイト:', insight.insight.substring(0, 40) + '...');
    console.log('    - 元パターン数:', insight.sourcePatterns.length);
    console.log('    - ステータス:', insight.status);

    // インサイト検証
    storage.updateInsightStatus(insight.id, 'validated');
    const validatedInsight = storage.getInsight(insight.id);
    console.log('  ✅ 検証後ステータス:', validatedInsight?.status);

    passed++;
  } catch (error) {
    console.log('  ❌ エラー:', (error as Error).message);
    failed++;
  }

  // ============================================================================
  // テスト 6: 知恵の昇華（DIKW Level 4）
  // ============================================================================
  console.log('\n🧠 テスト 6: 知恵の昇華（DIKW Level 4）');
  try {
    const insights = storage.listInsights();
    const patterns = storage.listPatterns();

    const wisdom = storage.createWisdom({
      name: 'API設計におけるデフォルト制限の原則',
      principle: 'すべてのコレクション取得APIは、デフォルトでページネーション、フィルタリング、フィールド選択をサポートし、無制限取得を禁止すべきである',
      description: '大量データ取得はフロントエンドのUI固まりとバックエンドのリソース枯渇の両方を引き起こす。これを防ぐために、APIは設計段階からデフォルト制限を持つべき。',
      derivedFromInsights: insights.map(i => i.id),
      derivedFromPatterns: patterns.map(p => p.id),
      applicableDomains: ['API設計', 'マイクロサービス', 'REST API'],
      applicableContexts: ['新規API開発', 'API改善', 'コードレビュー'],
      limitations: ['内部専用APIでは適用不要な場合がある', 'ストリーミングAPIには別のアプローチが必要'],
      tags: ['API', 'パフォーマンス', '設計原則'],
    });

    console.log('  ✅ 知恵の昇華成功:', wisdom.id);
    console.log('    - 名前:', wisdom.name);
    console.log('    - 原則:', wisdom.principle.substring(0, 50) + '...');
    console.log('    - 適用ドメイン:', wisdom.applicableDomains.join(', '));
    console.log('    - 信頼度:', wisdom.confidenceScore);

    // 知恵の適用記録
    const application = storage.recordWisdomApplication({
      wisdomId: wisdom.id,
      context: '新規ユーザー一覧APIの設計レビュー',
      result: 'success',
      feedback: 'ページネーションを実装し、パフォーマンス問題を未然に防止',
    });
    console.log('  ✅ 知恵適用記録:', application.id);

    // 更新後の知恵を取得
    const updatedWisdom = storage.getWisdom(wisdom.id);
    console.log('  ✅ 適用後の検証カウント:', updatedWisdom?.validationCount);
    console.log('  ✅ 成功適用数:', updatedWisdom?.successfulApplications);

    passed++;
  } catch (error) {
    console.log('  ❌ エラー:', (error as Error).message);
    failed++;
  }

  // ============================================================================
  // テスト 7: デルタエクスポート
  // ============================================================================
  console.log('\n📤 テスト 7: デルタエクスポート');
  try {
    const exportData = storage.exportDelta();
    console.log('  ✅ エクスポート成功');
    console.log('    - フォーマット:', exportData.format);
    console.log('    - タチコマID:', exportData.tachikomaId);
    console.log('    - タチコマ名:', exportData.tachikomaName);
    console.log('    - Working Memory数:', exportData.delta.working.length);
    console.log('    - Episodic Memory数:', exportData.delta.episodic.length);
    console.log('    - Semantic Entities数:', exportData.delta.semantic.entities.length);
    console.log('    - Semantic Relations数:', exportData.delta.semantic.relations.length);
    console.log('    - SyncVector:', JSON.stringify(exportData.syncVector));

    passed++;
  } catch (error) {
    console.log('  ❌ エラー:', (error as Error).message);
    failed++;
  }

  // ============================================================================
  // テスト 8: 別タチコマへのインポート（シミュレーション）
  // ============================================================================
  console.log('\n📥 テスト 8: 別タチコマへのインポート（シミュレーション）');
  try {
    // 別のストレージを作成（タチコマBをシミュレート）
    const storage2Path = join(process.cwd(), '.test-new-features-2');
    if (existsSync(storage2Path)) {
      rmSync(storage2Path, { recursive: true });
    }
    mkdirSync(storage2Path, { recursive: true });

    const storage2 = new SqliteStorage({ dataPath: storage2Path });
    await storage2.initialize();

    // タチコマBを初期化
    storage2.initTachikoma('tachi-beta', 'タチコマ-ベータ');
    console.log('  ✅ タチコマB初期化完了');

    // タチコマAからエクスポート
    const exportData = storage.exportDelta();

    // タチコマBにインポート
    const importResult = storage2.importDelta(exportData, {
      strategy: 'merge_learnings',
      autoResolve: true,
    });

    console.log('  ✅ インポート成功:', importResult.success);
    console.log('    - マージされたWorking:', importResult.merged.working);
    console.log('    - マージされたEpisodic:', importResult.merged.episodic);
    console.log('    - マージされたSemantic Entities:', importResult.merged.semantic.entities);
    console.log('    - マージされたSemantic Relations:', importResult.merged.semantic.relations);
    console.log('    - スキップ数:', importResult.skipped);
    console.log('    - 競合数:', importResult.conflicts.length);
    console.log('    - 更新後SyncVector:', JSON.stringify(importResult.syncVector));

    // クリーンアップ
    storage2.close();
    rmSync(storage2Path, { recursive: true });

    passed++;
  } catch (error) {
    console.log('  ❌ エラー:', (error as Error).message);
    failed++;
  }

  // ============================================================================
  // テスト 9: 知恵の検索
  // ============================================================================
  console.log('\n🔎 テスト 9: 知恵の検索');
  try {
    const wisdomList = storage.listWisdom({
      query: 'API',
      limit: 10,
    });
    console.log('  ✅ 検索結果:', wisdomList.length, '件');
    wisdomList.forEach((w, i) => {
      console.log(`    ${i + 1}. ${w.name} (信頼度: ${w.confidenceScore})`);
    });

    passed++;
  } catch (error) {
    console.log('  ❌ エラー:', (error as Error).message);
    failed++;
  }

  // ============================================================================
  // テスト 10: 同期履歴
  // ============================================================================
  console.log('\n📜 テスト 10: 同期履歴');
  try {
    const history = storage.listSyncHistory(5);
    console.log('  ✅ 同期履歴:', history.length, '件');
    history.forEach((h, i) => {
      console.log(`    ${i + 1}. ${h.syncType} - ${h.remoteTachikomaId} (${h.itemsCount}件)`);
    });

    passed++;
  } catch (error) {
    console.log('  ❌ エラー:', (error as Error).message);
    failed++;
  }

  // ============================================================================
  // 結果サマリー
  // ============================================================================
  console.log('\n' + '='.repeat(60));
  console.log('📊 テスト結果サマリー');
  console.log('='.repeat(60));
  console.log(`  ✅ 成功: ${passed}`);
  console.log(`  ❌ 失敗: ${failed}`);
  console.log(`  📈 成功率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  // クリーンアップ
  storage.close();
  cleanup();

  console.log('\n🧹 クリーンアップ完了');

  if (failed > 0) {
    process.exit(1);
  }
}

// 実行
runTests().catch((error) => {
  console.error('テスト実行エラー:', error);
  cleanup();
  process.exit(1);
});
