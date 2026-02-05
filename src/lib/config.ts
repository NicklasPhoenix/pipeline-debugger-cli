import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type CliConfig = {
  token?: string;
  /** Local daemon auth token used by the web dashboard to talk to localhost */
  daemonToken?: string;
};

const CONFIG_DIR = join(homedir(), '.pipeline-debugger');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function getConfig(): CliConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw) as CliConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: CliConfig) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

export function setToken(token: string) {
  const cfg = getConfig();
  cfg.token = token;
  saveConfig(cfg);
}

export function clearConfig() {
  saveConfig({});
}
