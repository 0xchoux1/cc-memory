#!/usr/bin/env node
/**
 * Migration script for api-keys.json v1.0 to v2.0
 *
 * Usage:
 *   npx ts-node src/scripts/migrate-api-keys.ts [input-file] [output-file]
 *
 * If no files specified, reads from ~/.claude-memory/api-keys.json
 * and writes backup to ~/.claude-memory/api-keys.v1.backup.json
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface ApiKeyInfoV1 {
  clientId: string;
  scopes?: string[];
  createdAt?: number;
}

interface ApiKeyInfoV2 {
  clientId: string;
  permissionLevel: 'manager' | 'worker' | 'observer';
  scopes: string[];
  team: string | null;
  managedAgents?: string[];
  managerId?: string;
  createdAt: number;
}

interface ApiKeysV1 {
  [key: string]: ApiKeyInfoV1;
}

interface TeamConfig {
  managerId: string;
  sharedPoolId: string;
  syncPolicy: {
    mode: 'event-driven' | 'polling';
    batchInterval: number;
    conflictResolution: string;
  };
  createdAt: number;
  description?: string;
}

interface ApiKeysV2 {
  version: '2.0';
  teams: Record<string, TeamConfig>;
  keys: Record<string, ApiKeyInfoV2>;
}

function inferPermissionLevel(scopes: string[]): 'manager' | 'worker' | 'observer' {
  if (scopes.includes('memory:*') || scopes.includes('memory:manage')) {
    return 'manager';
  }
  if (scopes.includes('memory:write') || scopes.includes('memory:share:write')) {
    return 'worker';
  }
  return 'observer';
}

function normalizeScopes(scopes: string[] | undefined, level: 'manager' | 'worker' | 'observer'): string[] {
  if (scopes && scopes.length > 0) {
    return scopes;
  }

  // Default scopes based on permission level
  switch (level) {
    case 'manager':
      return ['memory:read', 'memory:write', 'memory:share:read', 'memory:share:write', 'memory:team:read', 'memory:team:write', 'memory:manage'];
    case 'worker':
      return ['memory:read', 'memory:write', 'memory:share:read', 'memory:share:write'];
    case 'observer':
      return ['memory:read', 'memory:share:read'];
  }
}

function migrateApiKeys(v1Data: ApiKeysV1 | ApiKeysV2): ApiKeysV2 {
  // Check if already v2.0
  if ('version' in v1Data && v1Data.version === '2.0') {
    console.log('File is already in v2.0 format');
    return v1Data as ApiKeysV2;
  }

  const v2Data: ApiKeysV2 = {
    version: '2.0',
    teams: {},
    keys: {},
  };

  const now = Date.now();

  for (const [keyHash, keyInfo] of Object.entries(v1Data)) {
    // Skip version field if present
    if (keyHash === 'version') continue;

    const v1Info = keyInfo as ApiKeyInfoV1;
    const scopes = v1Info.scopes || ['memory:read', 'memory:write'];
    const permissionLevel = inferPermissionLevel(scopes);

    const v2Info: ApiKeyInfoV2 = {
      clientId: v1Info.clientId,
      permissionLevel,
      scopes: normalizeScopes(scopes, permissionLevel),
      team: null, // No team in v1.0 - individual mode
      createdAt: v1Info.createdAt || now,
    };

    v2Data.keys[keyHash] = v2Info;
  }

  return v2Data;
}

function main() {
  const args = process.argv.slice(2);

  const defaultPath = join(homedir(), '.claude-memory', 'api-keys.json');
  const inputPath = args[0] || defaultPath;
  const outputPath = args[1] || inputPath;
  const backupPath = inputPath.replace('.json', '.v1.backup.json');

  console.log('CC-Memory API Keys Migration: v1.0 -> v2.0');
  console.log('==========================================');
  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Backup: ${backupPath}`);
  console.log('');

  // Check if input file exists
  if (!existsSync(inputPath)) {
    console.log(`Input file not found: ${inputPath}`);
    console.log('Nothing to migrate.');
    process.exit(0);
  }

  // Read input file
  let v1Data: ApiKeysV1 | ApiKeysV2;
  try {
    const content = readFileSync(inputPath, 'utf-8');
    v1Data = JSON.parse(content);
  } catch (error) {
    console.error(`Failed to read input file: ${error}`);
    process.exit(1);
  }

  // Check if already migrated
  if ('version' in v1Data && v1Data.version === '2.0') {
    console.log('File is already in v2.0 format. No migration needed.');
    process.exit(0);
  }

  // Create backup
  try {
    copyFileSync(inputPath, backupPath);
    console.log(`Backup created: ${backupPath}`);
  } catch (error) {
    console.error(`Failed to create backup: ${error}`);
    process.exit(1);
  }

  // Migrate
  const v2Data = migrateApiKeys(v1Data);

  // Count keys
  const keyCount = Object.keys(v2Data.keys).length;
  console.log(`Migrated ${keyCount} API key(s)`);

  // Show summary
  const levels = { manager: 0, worker: 0, observer: 0 };
  for (const keyInfo of Object.values(v2Data.keys)) {
    levels[keyInfo.permissionLevel]++;
  }
  console.log(`  - Managers:  ${levels.manager}`);
  console.log(`  - Workers:   ${levels.worker}`);
  console.log(`  - Observers: ${levels.observer}`);
  console.log('');

  // Write output
  try {
    writeFileSync(outputPath, JSON.stringify(v2Data, null, 2) + '\n', 'utf-8');
    console.log(`Migration complete: ${outputPath}`);
  } catch (error) {
    console.error(`Failed to write output file: ${error}`);
    process.exit(1);
  }

  console.log('');
  console.log('Next steps:');
  console.log('  1. Review the migrated file');
  console.log('  2. Add team configurations if needed');
  console.log('  3. Update managedAgents/managerId for team members');
  console.log('');
  console.log('Example team configuration:');
  console.log(JSON.stringify({
    teams: {
      'my-team': {
        managerId: 'manager-client-id',
        sharedPoolId: 'shared-pool-my-team',
        syncPolicy: {
          mode: 'event-driven',
          batchInterval: 5000,
          conflictResolution: 'merge_learnings',
        },
        createdAt: Date.now(),
        description: 'My team description',
      },
    },
  }, null, 2));
}

main();
