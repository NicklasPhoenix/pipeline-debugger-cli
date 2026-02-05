import { basename, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { getConfig, saveConfig, type CliConfig } from './config.js';
import { nanoid } from 'nanoid';

export type Project = {
  id: string;
  name: string;
  rootPath: string;
  addedAt: number;
  lastUsedAt?: number;
};

type ProjectsConfig = CliConfig & {
  projects?: Project[];
  activeProjectId?: string;
};

function readCfg(): ProjectsConfig {
  return getConfig() as ProjectsConfig;
}

function writeCfg(cfg: ProjectsConfig) {
  saveConfig(cfg);
}

export function listProjects(): { projects: Project[]; activeProjectId?: string } {
  const cfg = readCfg();
  return {
    projects: cfg.projects ?? [],
    activeProjectId: cfg.activeProjectId,
  };
}

export function addProject(rootPath: string): Project {
  const p = resolve(rootPath);
  if (!existsSync(p)) {
    throw new Error(`Project path does not exist: ${p}`);
  }

  const cfg = readCfg();
  const projects = cfg.projects ?? [];

  const existing = projects.find((x) => resolve(x.rootPath) === p);
  if (existing) {
    cfg.activeProjectId = existing.id;
    existing.lastUsedAt = Date.now();
    writeCfg({ ...cfg, projects });
    return existing;
  }

  const proj: Project = {
    id: nanoid(10),
    name: basename(p),
    rootPath: p,
    addedAt: Date.now(),
    lastUsedAt: Date.now(),
  };

  projects.push(proj);
  cfg.projects = projects;
  cfg.activeProjectId = proj.id;
  writeCfg(cfg);
  return proj;
}

export function removeProject(id: string) {
  const cfg = readCfg();
  const projects = (cfg.projects ?? []).filter((p) => p.id !== id);
  cfg.projects = projects;
  if (cfg.activeProjectId === id) cfg.activeProjectId = projects[0]?.id;
  writeCfg(cfg);
}

export function selectProject(id: string) {
  const cfg = readCfg();
  const projects = cfg.projects ?? [];
  const proj = projects.find((p) => p.id === id);
  if (!proj) throw new Error(`Project not found: ${id}`);
  proj.lastUsedAt = Date.now();
  cfg.activeProjectId = id;
  writeCfg({ ...cfg, projects });
  return proj;
}

export function getActiveProject(): Project | null {
  const { projects, activeProjectId } = listProjects();
  if (!activeProjectId) return null;
  return projects.find((p) => p.id === activeProjectId) ?? null;
}
