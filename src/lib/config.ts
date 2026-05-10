import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface KGConfig {
  vaultPath: string;
  dataDir: string;
  dbPath: string;
}

export interface ConfigOverrides {
  vaultPath?: string;
  dataDir?: string;
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const normalized = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;
    const eq = normalized.indexOf('=');
    if (eq <= 0) continue;

    const key = normalized.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;

    process.env[key] = unquoteEnvValue(normalized.slice(eq + 1));
  }
}

function loadDefaultEnvFiles(): void {
  loadEnvFile(join(process.cwd(), '.env'));
  loadEnvFile(join(process.env.HERMES_HOME ?? join(homedir(), '.hermes'), '.env'));
}

export function resolveConfig(overrides: ConfigOverrides): KGConfig {
  loadDefaultEnvFiles();

  const vaultPath = overrides.vaultPath
    ?? process.env.KG_VAULT_PATH
    ?? process.env.OBSIDIAN_VAULT_PATH;

  if (!vaultPath) {
    throw new Error(
      'Vault path not configured. Set KG_VAULT_PATH, OBSIDIAN_VAULT_PATH, or pass --vault-path.'
    );
  }

  const xdgData = process.env.XDG_DATA_HOME
    ?? join(homedir(), '.local', 'share');

  const dataDir = overrides.dataDir
    ?? process.env.KG_DATA_DIR
    ?? join(xdgData, 'vault-graph');

  return {
    vaultPath,
    dataDir,
    dbPath: join(dataDir, 'kg.db'),
  };
}
