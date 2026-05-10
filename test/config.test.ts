import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import { resolveConfig } from '../src/lib/config.js';

describe('resolveConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws when vault path is not configured', () => {
    delete process.env.KG_VAULT_PATH;
    delete process.env.OBSIDIAN_VAULT_PATH;
    expect(() => resolveConfig({})).toThrow(/vault/i);
  });

  it('reads vault path from env var', () => {
    process.env.KG_VAULT_PATH = '/tmp/test-vault';
    const config = resolveConfig({});
    expect(config.vaultPath).toBe('/tmp/test-vault');
  });

  it('falls back to OBSIDIAN_VAULT_PATH', () => {
    delete process.env.KG_VAULT_PATH;
    process.env.OBSIDIAN_VAULT_PATH = '/tmp/obsidian-vault';
    const config = resolveConfig({});
    expect(config.vaultPath).toBe('/tmp/obsidian-vault');
  });

  it('loads ~/.hermes/.env without overwriting exported env vars', () => {
    delete process.env.KG_VAULT_PATH;
    delete process.env.OBSIDIAN_VAULT_PATH;
    const tempHome = mkdtempSync(join(tmpdir(), 'vault-graph-config-'));
    const hermesDir = join(tempHome, '.hermes');
    process.env.HERMES_HOME = hermesDir;
    mkdirSync(hermesDir, { recursive: true });
    writeFileSync(join(hermesDir, '.env'), 'OBSIDIAN_VAULT_PATH="/tmp/hermes-vault"\nKG_DATA_DIR=/tmp/hermes-data\n');

    const config = resolveConfig({});
    expect(config.vaultPath).toBe('/tmp/hermes-vault');
    expect(config.dataDir).toBe('/tmp/hermes-data');

    process.env.KG_VAULT_PATH = '/tmp/exported-vault';
    const exportedConfig = resolveConfig({});
    expect(exportedConfig.vaultPath).toBe('/tmp/exported-vault');
  });

  it('CLI flags override env vars', () => {
    process.env.KG_VAULT_PATH = '/tmp/env-vault';
    const config = resolveConfig({ vaultPath: '/tmp/cli-vault' });
    expect(config.vaultPath).toBe('/tmp/cli-vault');
  });

  it('defaults data dir to XDG_DATA_HOME/vault-graph', () => {
    process.env.KG_VAULT_PATH = '/tmp/vault';
    process.env.XDG_DATA_HOME = '/tmp/xdg';
    delete process.env.KG_DATA_DIR;
    const config = resolveConfig({});
    expect(config.dataDir).toBe('/tmp/xdg/vault-graph');
  });

  it('reads data dir from KG_DATA_DIR env var', () => {
    process.env.KG_VAULT_PATH = '/tmp/vault';
    process.env.KG_DATA_DIR = '/tmp/custom-data';
    const config = resolveConfig({});
    expect(config.dataDir).toBe('/tmp/custom-data');
  });

  it('falls back to ~/.local/share/vault-graph when XDG not set', () => {
    process.env.KG_VAULT_PATH = '/tmp/vault';
    delete process.env.XDG_DATA_HOME;
    delete process.env.KG_DATA_DIR;
    const config = resolveConfig({});
    expect(config.dataDir).toContain('.local/share/vault-graph');
  });
});
