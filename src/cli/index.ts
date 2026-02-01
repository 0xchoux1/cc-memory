#!/usr/bin/env node
/**
 * cc-memory CLI - Setup and management tool for cc-memory OODA integration
 *
 * Commands:
 *   setup   - Install OODA skills, commands, and hooks to ~/.claude/
 *   doctor  - Check installation status and diagnose issues
 *   status  - Show current installation status
 *   update  - Update installed files to latest version
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync, statSync, chmodSync } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(message: string, color = colors.reset): void {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message: string): void {
  log(`  [OK] ${message}`, colors.green);
}

function logWarning(message: string): void {
  log(`  [WARN] ${message}`, colors.yellow);
}

function logError(message: string): void {
  log(`  [ERROR] ${message}`, colors.red);
}

function logInfo(message: string): void {
  log(`  [INFO] ${message}`, colors.blue);
}

// Get the package root directory (where templates/ is located)
function getPackageRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // From dist/cli/index.js, go up to package root
  // Or from src/cli/index.ts during development
  let root = dirname(dirname(__dirname));
  if (!existsSync(join(root, 'templates'))) {
    // Try one more level up
    root = dirname(root);
  }
  return root;
}

// Paths
const CLAUDE_DIR = join(homedir(), '.claude');
const SKILLS_DIR = join(CLAUDE_DIR, 'skills');
const COMMANDS_DIR = join(CLAUDE_DIR, 'commands');
const HOOKS_DIR = join(CLAUDE_DIR, 'hooks');
const SETTINGS_FILE = join(CLAUDE_DIR, 'settings.json');
const SETTINGS_LOCAL_FILE = join(CLAUDE_DIR, 'settings.local.json');

interface SetupOptions {
  dryRun: boolean;
  force: boolean;
  skipHooks: boolean;
}

interface InstallResult {
  installed: string[];
  skipped: string[];
  errors: string[];
  backups: string[];
}

// ============================================================================
// Utility Functions
// ============================================================================

function ensureDir(dir: string, dryRun = false): void {
  if (!existsSync(dir)) {
    if (dryRun) {
      logInfo(`Would create directory: ${dir}`);
    } else {
      mkdirSync(dir, { recursive: true });
      logSuccess(`Created directory: ${dir}`);
    }
  }
}

function backupFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup-${timestamp}`;
  copyFileSync(filePath, backupPath);
  return backupPath;
}

function copyDir(src: string, dest: string, dryRun = false, force = false): InstallResult {
  const result: InstallResult = { installed: [], skipped: [], errors: [], backups: [] };

  if (!existsSync(src)) {
    result.errors.push(`Source directory not found: ${src}`);
    return result;
  }

  ensureDir(dest, dryRun);

  const entries = readdirSync(src);
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      const subResult = copyDir(srcPath, destPath, dryRun, force);
      result.installed.push(...subResult.installed);
      result.skipped.push(...subResult.skipped);
      result.errors.push(...subResult.errors);
      result.backups.push(...subResult.backups);
    } else {
      if (existsSync(destPath) && !force) {
        result.skipped.push(destPath);
      } else {
        if (dryRun) {
          logInfo(`Would copy: ${srcPath} -> ${destPath}`);
          result.installed.push(destPath);
        } else {
          if (existsSync(destPath)) {
            const backup = backupFile(destPath);
            if (backup) result.backups.push(backup);
          }
          copyFileSync(srcPath, destPath);
          // Make shell scripts executable
          if (entry.endsWith('.sh')) {
            chmodSync(destPath, 0o755);
          }
          result.installed.push(destPath);
        }
      }
    }
  }

  return result;
}

function mergeSettings(templatePath: string, targetPath: string, dryRun = false): { merged: boolean; backup?: string } {
  if (!existsSync(templatePath)) {
    return { merged: false };
  }

  const templateContent = JSON.parse(readFileSync(templatePath, 'utf-8'));

  let targetContent: Record<string, any> = {};
  let backup: string | undefined;

  if (existsSync(targetPath)) {
    targetContent = JSON.parse(readFileSync(targetPath, 'utf-8'));
    if (!dryRun) {
      backup = backupFile(targetPath) ?? undefined;
    }
  }

  // Deep merge hooks
  if (templateContent.hooks) {
    if (!targetContent.hooks) {
      targetContent.hooks = {};
    }

    for (const [hookType, hookArray] of Object.entries(templateContent.hooks)) {
      if (!targetContent.hooks[hookType]) {
        targetContent.hooks[hookType] = [];
      }

      // Check if cc-memory hooks already exist
      const existingDescriptions = (targetContent.hooks[hookType] as any[]).map((h: any) => h.description);

      for (const hook of hookArray as any[]) {
        if (!existingDescriptions.includes(hook.description)) {
          targetContent.hooks[hookType].push(hook);
        }
      }
    }
  }

  if (dryRun) {
    logInfo(`Would merge hooks into: ${targetPath}`);
    logInfo(`Merged content: ${JSON.stringify(targetContent, null, 2).slice(0, 500)}...`);
  } else {
    writeFileSync(targetPath, JSON.stringify(targetContent, null, 2) + '\n');
    logSuccess(`Merged hooks into: ${targetPath}`);
  }

  return { merged: true, backup };
}

// ============================================================================
// Commands
// ============================================================================

async function setupCommand(options: SetupOptions): Promise<void> {
  log('\n=== cc-memory Setup ===\n', colors.bright + colors.cyan);

  if (options.dryRun) {
    log('Running in dry-run mode. No changes will be made.\n', colors.yellow);
  }

  const packageRoot = getPackageRoot();
  const templatesDir = join(packageRoot, 'templates');

  if (!existsSync(templatesDir)) {
    logError(`Templates directory not found at: ${templatesDir}`);
    logError('Please ensure the package is installed correctly.');
    process.exit(1);
  }

  // Ensure base directories exist
  log('Creating directories...', colors.bright);
  ensureDir(CLAUDE_DIR, options.dryRun);
  ensureDir(SKILLS_DIR, options.dryRun);
  ensureDir(COMMANDS_DIR, options.dryRun);
  ensureDir(HOOKS_DIR, options.dryRun);

  const allResults: InstallResult = { installed: [], skipped: [], errors: [], backups: [] };

  // Copy OODA skills
  log('\nInstalling OODA skills...', colors.bright);
  const skillsTemplateDir = join(templatesDir, 'skills');
  if (existsSync(skillsTemplateDir)) {
    const skillDirs = readdirSync(skillsTemplateDir).filter(d =>
      statSync(join(skillsTemplateDir, d)).isDirectory()
    );

    for (const skillDir of skillDirs) {
      const srcDir = join(skillsTemplateDir, skillDir);
      const destDir = join(SKILLS_DIR, skillDir);
      const result = copyDir(srcDir, destDir, options.dryRun, options.force);

      allResults.installed.push(...result.installed);
      allResults.skipped.push(...result.skipped);
      allResults.errors.push(...result.errors);
      allResults.backups.push(...result.backups);

      if (result.installed.length > 0) {
        logSuccess(`Installed skill: ${skillDir}`);
      } else if (result.skipped.length > 0) {
        logWarning(`Skipped existing skill: ${skillDir} (use --force to overwrite)`);
      }
    }
  } else {
    logWarning('No skills templates found');
  }

  // Copy commands
  log('\nInstalling commands...', colors.bright);
  const commandsTemplateDir = join(templatesDir, 'commands');
  if (existsSync(commandsTemplateDir)) {
    const commandFiles = readdirSync(commandsTemplateDir).filter(f => f.endsWith('.md'));

    for (const cmdFile of commandFiles) {
      const srcPath = join(commandsTemplateDir, cmdFile);
      const destPath = join(COMMANDS_DIR, cmdFile);

      if (existsSync(destPath) && !options.force) {
        allResults.skipped.push(destPath);
        logWarning(`Skipped existing command: ${cmdFile} (use --force to overwrite)`);
      } else {
        if (options.dryRun) {
          logInfo(`Would copy: ${srcPath} -> ${destPath}`);
          allResults.installed.push(destPath);
        } else {
          if (existsSync(destPath)) {
            const backup = backupFile(destPath);
            if (backup) allResults.backups.push(backup);
          }
          copyFileSync(srcPath, destPath);
          allResults.installed.push(destPath);
          logSuccess(`Installed command: ${cmdFile}`);
        }
      }
    }
  } else {
    logWarning('No command templates found');
  }

  // Copy hooks (unless --skip-hooks)
  if (!options.skipHooks) {
    log('\nInstalling hooks...', colors.bright);
    const hooksTemplateDir = join(templatesDir, 'hooks');
    if (existsSync(hooksTemplateDir)) {
      const hookFiles = readdirSync(hooksTemplateDir).filter(f => f.endsWith('.sh'));

      for (const hookFile of hookFiles) {
        const srcPath = join(hooksTemplateDir, hookFile);
        const destPath = join(HOOKS_DIR, hookFile);

        if (existsSync(destPath) && !options.force) {
          allResults.skipped.push(destPath);
          logWarning(`Skipped existing hook: ${hookFile} (use --force to overwrite)`);
        } else {
          if (options.dryRun) {
            logInfo(`Would copy: ${srcPath} -> ${destPath}`);
            allResults.installed.push(destPath);
          } else {
            if (existsSync(destPath)) {
              const backup = backupFile(destPath);
              if (backup) allResults.backups.push(backup);
            }
            copyFileSync(srcPath, destPath);
            chmodSync(destPath, 0o755);
            allResults.installed.push(destPath);
            logSuccess(`Installed hook: ${hookFile}`);
          }
        }
      }

      // Merge hooks settings
      log('\nConfiguring hooks in settings...', colors.bright);
      const settingsTemplate = join(hooksTemplateDir, 'settings.json');
      const mergeResult = mergeSettings(settingsTemplate, SETTINGS_LOCAL_FILE, options.dryRun);
      if (mergeResult.backup) {
        allResults.backups.push(mergeResult.backup);
      }
    } else {
      logWarning('No hook templates found');
    }
  } else {
    log('\nSkipping hooks installation (--skip-hooks)', colors.yellow);
  }

  // Copy CLAUDE.md template
  log('\nInstalling CLAUDE.md template...', colors.bright);
  const claudeTemplate = join(templatesDir, 'CLAUDE.md');
  if (existsSync(claudeTemplate)) {
    const destPath = join(CLAUDE_DIR, 'CLAUDE.md.template');
    if (existsSync(destPath) && !options.force) {
      logWarning(`Skipped existing CLAUDE.md template (use --force to overwrite)`);
    } else {
      if (!options.dryRun) {
        if (existsSync(destPath)) {
          const backup = backupFile(destPath);
          if (backup) allResults.backups.push(backup);
        }
        copyFileSync(claudeTemplate, destPath);
        logSuccess('Installed CLAUDE.md.template');
        logInfo('Copy this template to your project as CLAUDE.md');
      } else {
        logInfo(`Would copy: ${claudeTemplate} -> ${destPath}`);
      }
    }
  }

  // Summary
  log('\n=== Setup Summary ===\n', colors.bright);
  log(`Installed: ${allResults.installed.length} files`, colors.green);
  log(`Skipped: ${allResults.skipped.length} files`, colors.yellow);
  log(`Backups: ${allResults.backups.length} files`, colors.blue);

  if (allResults.errors.length > 0) {
    log(`Errors: ${allResults.errors.length}`, colors.red);
    for (const error of allResults.errors) {
      logError(error);
    }
  }

  if (allResults.backups.length > 0 && !options.dryRun) {
    log('\nBackup files created:', colors.dim);
    for (const backup of allResults.backups) {
      log(`  ${backup}`, colors.gray);
    }
  }

  log('\n=== Next Steps ===\n', colors.bright);
  log('1. Add cc-memory MCP server to your Claude Code configuration', colors.cyan);
  log('2. Copy ~/.claude/CLAUDE.md.template to your project as CLAUDE.md', colors.cyan);
  log('3. Use /observe, /assess, /plan, /execute commands for OODA workflow', colors.cyan);
}

async function doctorCommand(): Promise<void> {
  log('\n=== cc-memory Doctor ===\n', colors.bright + colors.cyan);

  let hasIssues = false;

  // Check directories
  log('Checking directories...', colors.bright);
  const dirs = [
    { path: CLAUDE_DIR, name: '~/.claude' },
    { path: SKILLS_DIR, name: '~/.claude/skills' },
    { path: COMMANDS_DIR, name: '~/.claude/commands' },
    { path: HOOKS_DIR, name: '~/.claude/hooks' },
  ];

  for (const { path, name } of dirs) {
    if (existsSync(path)) {
      logSuccess(`${name} exists`);
    } else {
      logWarning(`${name} does not exist`);
      hasIssues = true;
    }
  }

  // Check OODA skills
  log('\nChecking OODA skills...', colors.bright);
  const skills = ['ooda-observe', 'ooda-assess', 'ooda-plan', 'ooda-execute', 'ooda-escalate'];
  for (const skill of skills) {
    const skillPath = join(SKILLS_DIR, skill, 'SKILL.md');
    if (existsSync(skillPath)) {
      logSuccess(`${skill} installed`);
    } else {
      logWarning(`${skill} not found`);
      hasIssues = true;
    }
  }

  // Check commands
  log('\nChecking OODA commands...', colors.bright);
  const commands = ['observe.md', 'assess.md', 'plan.md', 'execute.md', 'escalate.md'];
  for (const cmd of commands) {
    const cmdPath = join(COMMANDS_DIR, cmd);
    if (existsSync(cmdPath)) {
      logSuccess(`${cmd} installed`);
    } else {
      logWarning(`${cmd} not found`);
      hasIssues = true;
    }
  }

  // Check hooks
  log('\nChecking hooks...', colors.bright);
  const hooks = ['ooda-session-start.sh', 'ooda-error-handler.sh', 'ooda-session-end.sh', 'save-transcript.sh'];
  for (const hook of hooks) {
    const hookPath = join(HOOKS_DIR, hook);
    if (existsSync(hookPath)) {
      logSuccess(`${hook} installed`);
    } else {
      logWarning(`${hook} not found`);
      hasIssues = true;
    }
  }

  // Check settings
  log('\nChecking settings...', colors.bright);
  if (existsSync(SETTINGS_LOCAL_FILE)) {
    try {
      const settings = JSON.parse(readFileSync(SETTINGS_LOCAL_FILE, 'utf-8'));
      if (settings.hooks && Object.keys(settings.hooks).length > 0) {
        logSuccess('Hooks configured in settings.local.json');
      } else {
        logWarning('No hooks configured in settings.local.json');
        hasIssues = true;
      }
    } catch (e) {
      logError('Failed to parse settings.local.json');
      hasIssues = true;
    }
  } else {
    logWarning('settings.local.json not found');
    hasIssues = true;
  }

  // Summary
  log('\n=== Doctor Summary ===\n', colors.bright);
  if (hasIssues) {
    log('Some issues were found. Run `cc-memory setup` to fix them.', colors.yellow);
  } else {
    log('All checks passed! cc-memory is properly configured.', colors.green);
  }
}

async function statusCommand(): Promise<void> {
  log('\n=== cc-memory Status ===\n', colors.bright + colors.cyan);

  const status = {
    skills: [] as string[],
    commands: [] as string[],
    hooks: [] as string[],
    settingsConfigured: false,
  };

  // Check skills
  if (existsSync(SKILLS_DIR)) {
    const entries = readdirSync(SKILLS_DIR);
    for (const entry of entries) {
      if (entry.startsWith('ooda-') && existsSync(join(SKILLS_DIR, entry, 'SKILL.md'))) {
        status.skills.push(entry);
      }
    }
  }

  // Check commands
  if (existsSync(COMMANDS_DIR)) {
    const entries = readdirSync(COMMANDS_DIR);
    const oodaCommands = ['observe.md', 'assess.md', 'plan.md', 'execute.md', 'escalate.md'];
    for (const entry of entries) {
      if (oodaCommands.includes(entry)) {
        status.commands.push(entry);
      }
    }
  }

  // Check hooks
  if (existsSync(HOOKS_DIR)) {
    const entries = readdirSync(HOOKS_DIR);
    for (const entry of entries) {
      if (entry.startsWith('ooda-') || entry === 'save-transcript.sh') {
        status.hooks.push(entry);
      }
    }
  }

  // Check settings
  if (existsSync(SETTINGS_LOCAL_FILE)) {
    try {
      const settings = JSON.parse(readFileSync(SETTINGS_LOCAL_FILE, 'utf-8'));
      status.settingsConfigured = !!(settings.hooks && Object.keys(settings.hooks).length > 0);
    } catch (e) {
      // Ignore
    }
  }

  // Output
  log('Installed OODA Skills:', colors.bright);
  if (status.skills.length > 0) {
    for (const skill of status.skills) {
      log(`  - ${skill}`, colors.green);
    }
  } else {
    log('  (none)', colors.gray);
  }

  log('\nInstalled OODA Commands:', colors.bright);
  if (status.commands.length > 0) {
    for (const cmd of status.commands) {
      log(`  - /${cmd.replace('.md', '')}`, colors.green);
    }
  } else {
    log('  (none)', colors.gray);
  }

  log('\nInstalled Hooks:', colors.bright);
  if (status.hooks.length > 0) {
    for (const hook of status.hooks) {
      log(`  - ${hook}`, colors.green);
    }
  } else {
    log('  (none)', colors.gray);
  }

  log('\nSettings:', colors.bright);
  log(`  Hooks configured: ${status.settingsConfigured ? 'Yes' : 'No'}`, status.settingsConfigured ? colors.green : colors.yellow);

  log('\n', colors.reset);
}

async function updateCommand(options: SetupOptions): Promise<void> {
  log('\n=== cc-memory Update ===\n', colors.bright + colors.cyan);
  log('Updating installed files with --force...\n', colors.blue);

  // Force update
  await setupCommand({ ...options, force: true });
}

// ============================================================================
// Main
// ============================================================================

function parseArgs(args: string[]): { command: string; options: SetupOptions } {
  const command = args[0] || 'help';
  const options: SetupOptions = {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force') || args.includes('-f'),
    skipHooks: args.includes('--skip-hooks'),
  };
  return { command, options };
}

function showHelp(): void {
  log('\n=== cc-memory CLI ===\n', colors.bright + colors.cyan);
  log('Setup and management tool for cc-memory OODA integration\n', colors.dim);

  log('Commands:', colors.bright);
  log('  setup    Install OODA skills, commands, and hooks to ~/.claude/', colors.gray);
  log('  doctor   Check installation status and diagnose issues', colors.gray);
  log('  status   Show current installation status', colors.gray);
  log('  update   Update installed files to latest version', colors.gray);
  log('  help     Show this help message', colors.gray);

  log('\nOptions:', colors.bright);
  log('  --dry-run      Show what would be done without making changes', colors.gray);
  log('  --force, -f    Overwrite existing files', colors.gray);
  log('  --skip-hooks   Skip installing hooks', colors.gray);

  log('\nExamples:', colors.bright);
  log('  cc-memory setup              Install everything', colors.gray);
  log('  cc-memory setup --dry-run    Preview installation', colors.gray);
  log('  cc-memory setup --force      Reinstall and overwrite', colors.gray);
  log('  cc-memory doctor             Check installation', colors.gray);
  log('  cc-memory update             Update to latest version', colors.gray);

  log('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, options } = parseArgs(args);

  switch (command) {
    case 'setup':
      await setupCommand(options);
      break;
    case 'doctor':
      await doctorCommand();
      break;
    case 'status':
      await statusCommand();
      break;
    case 'update':
      await updateCommand(options);
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      log(`Unknown command: ${command}`, colors.red);
      showHelp();
      process.exit(1);
  }
}

main().catch(error => {
  logError(`Fatal error: ${error.message}`);
  if (process.env.DEBUG === 'true') {
    console.error(error);
  }
  process.exit(1);
});
