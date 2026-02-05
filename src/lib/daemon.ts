import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { nanoid } from 'nanoid';

import { getConfig, saveConfig } from './config.js';
import { executeWorkflowInDocker, type WorkflowStep } from './docker-executor.js';
import { executeWorkflowWithAct } from './act-executor.js';
import { executeWorkflowWithGitHub } from './gh-executor.js';
import { listProjects, selectProject, getActiveProject, type Project } from './projects.js';
import { scanWorkflows } from './workflow-scan.js';
import { loadWorkflowDoc, pickJob } from './workflow-parse.js';
import { join, resolve } from 'node:path';
import { ensureLocalhostCert } from './tls.js';

export type DaemonConfig = {
  host?: string;
  port?: number;
  allowedOrigins?: string[];
  https?: boolean;

  // Optional Docker remote engine config
  dockerHost?: string;
  dockerTlsVerify?: boolean;
  dockerCertPath?: string;
  dockerKeyPath?: string;
  dockerCaPath?: string;
};

type RunStatus = 'queued' | 'running' | 'success' | 'failed';

type RunEngine = 'builtin' | 'act' | 'github';

type RunRecord = {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: RunStatus;
  engine: RunEngine;

  projectId?: string;
  projectRoot?: string;
  workflowPath?: string;
  jobId?: string;

  eventName?: string;
  eventPath?: string;
  secretFile?: string;
  varsFile?: string;
  platforms?: string[];

  repo?: string;
  ref?: string;
  inputs?: Record<string, string>;

  image?: string;
  steps?: WorkflowStep[];
  exitCode?: number;

  // Combined log output (kept in memory)
  log?: string;
};

type WsClient = {
  send: (data: string) => void;
};

export async function startDaemon(cfg: DaemonConfig = {}) {
  const host = cfg.host ?? '127.0.0.1';
  const port = cfg.port ?? 17889;

  const allowedOrigins = cfg.allowedOrigins ?? [
    'https://pipeline-debugger.vercel.app',
    `http://${host}:${port}`,
    `http://localhost:${port}`,
  ];

  // Ensure we have a local daemon token
  const localCfg = getConfig();
  if (!localCfg.daemonToken) {
    localCfg.daemonToken = nanoid(32);
    saveConfig(localCfg);
  }
  const daemonToken = localCfg.daemonToken;

  const https = cfg.https ?? false;
  const tls = https ? await ensureLocalhostCert() : null;

  const server = Fastify({
    logger: false,
    ...(https && tls ? { https: { key: tls.key, cert: tls.cert } } : {}),
  } as any);

  await server.register(cors, {
    origin: (origin, cb) => {
      // allow non-browser tools
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Origin not allowed'), false);
    },
    credentials: true,
  });

  await server.register(websocket);

  server.addHook('onSend', async (req, reply, payload) => {
    if (req.headers.origin) {
      reply.header('Access-Control-Allow-Private-Network', 'true');
    }
    return payload;
  });

  const runs = new Map<string, RunRecord>();
  const clients = new Set<WsClient>();
  const MAX_LOG_BYTES = 5 * 1024 * 1024;

  function appendLog(run: RunRecord, chunk: string) {
    run.log = `${run.log ?? ''}${chunk}`;
    if (run.log.length > MAX_LOG_BYTES) {
      run.log = run.log.slice(run.log.length - MAX_LOG_BYTES);
    }
    broadcast({ type: 'run.log', id: run.id, chunk });
  }

  function authOrThrow(req: any) {
    const header = (req.headers['x-pdbg-token'] as string | undefined) ?? '';
    if (!header || header !== daemonToken) {
      const err: any = new Error('Unauthorized');
      err.statusCode = 401;
      throw err;
    }
  }

  function broadcast(evt: unknown) {
    const payload = JSON.stringify(evt);
    for (const c of clients) {
      try {
        c.send(payload);
      } catch {
        // ignore
      }
    }
  }

  server.get('/status', async (req, reply) => {
    authOrThrow(req);

    return {
      ok: true,
      version: '0.1.0',
      host,
      port,
      runs: runs.size,
    };
  });

  server.get('/runs', async (req) => {
    authOrThrow(req);
    return {
      runs: Array.from(runs.values()).map((r) => ({
        ...r,
        // don't include full log in list
        log: undefined,
      })).sort((a, b) => b.createdAt - a.createdAt),
    };
  });

  server.get('/runs/:id', async (req: any) => {
    authOrThrow(req);
    const id = String(req.params.id);
    const run = runs.get(id);
    if (!run) return { error: 'not_found' };
    return { run: { ...run, log: undefined }, log: run.log ?? '' };
  });

  server.get('/projects', async (req) => {
    authOrThrow(req);
    return listProjects();
  });

  server.post('/projects/select', async (req: any) => {
    authOrThrow(req);
    const body = (req.body ?? {}) as { projectId?: string };
    if (!body.projectId) {
      return { ok: false, error: 'projectId required' };
    }
    const proj = selectProject(body.projectId);
    return { ok: true, project: proj };
  });

  server.get('/workflows', async (req: any) => {
    authOrThrow(req);
    const active = getActiveProject();
    if (!active) {
      return { workflows: [] as any[], activeProject: null };
    }
    const workflows = await scanWorkflows(active.rootPath);
    return { workflows: workflows.map((w) => ({ path: w.path, fileName: w.fileName })), activeProject: active };
  });

  server.post('/runs', async (req: any) => {
    authOrThrow(req);

    const body = (req.body ?? {}) as {
      engine?: RunEngine;
      image?: string;
      // Either supply explicit steps, OR supply workflowPath + jobId and we'll parse.
      steps?: WorkflowStep[];
      workflowPath?: string;
      jobId?: string;
      projectId?: string;
      eventName?: string;
      eventPath?: string;
      secretFile?: string;
      varsFile?: string;
      platforms?: string[];
      repo?: string;
      ref?: string;
      inputs?: Record<string, string>;
    };

    const id = nanoid(12);
    const engine: RunEngine = body.engine ?? 'act';

    let project: Project | null = null;
    if (body.projectId) {
      project = selectProject(body.projectId);
    } else {
      project = getActiveProject();
    }

    let steps: WorkflowStep[] = body.steps ?? [];
    let workflowPath = body.workflowPath;
    let jobId = body.jobId;

    if (engine === 'builtin') {
      if (steps.length === 0 && workflowPath) {
        if (!project) {
          throw new Error('No active project. Run: pdbg project add <path>');
        }
        const abs = resolve(join(project.rootPath, workflowPath));
        const doc = await loadWorkflowDoc(abs);
        const picked = pickJob(doc, body.jobId);
        steps = (picked.job.steps ?? []) as WorkflowStep[];
        jobId = picked.jobId;
      }
    } else {
      if (!workflowPath) {
        throw new Error('workflowPath is required for act/github engine');
      }
      if (!project) {
        throw new Error('No active project. Run: pdbg project add <path>');
      }
      const abs = resolve(join(project.rootPath, workflowPath));
      const doc = await loadWorkflowDoc(abs);
      const picked = pickJob(doc, body.jobId);
      jobId = picked.jobId;
    }

    const run: RunRecord = {
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'queued',
      engine,
      image: engine === 'builtin' ? body.image ?? 'ubuntu:latest' : undefined,
      steps: engine === 'builtin' ? steps : undefined,
      workflowPath,
      jobId,
      eventName: body.eventName,
      eventPath: body.eventPath,
      secretFile: body.secretFile,
      varsFile: body.varsFile,
      platforms: body.platforms,
      repo: body.repo,
      ref: body.ref,
      inputs: body.inputs,
      projectId: project?.id,
      projectRoot: project?.rootPath,
    };

    runs.set(id, run);
    broadcast({ type: 'run.created', run });

    // fire and forget
    void (async () => {
      run.status = 'running';
      run.updatedAt = Date.now();
      broadcast({ type: 'run.updated', run });

      try {
        const dockerConfig = {
          dockerHost: cfg.dockerHost,
          dockerTlsVerify: cfg.dockerTlsVerify,
          dockerCertPath: cfg.dockerCertPath,
          dockerKeyPath: cfg.dockerKeyPath,
          dockerCaPath: cfg.dockerCaPath,
        };

        const result =
          run.engine === 'act'
            ? await executeWorkflowWithAct({
                workflowPath: run.projectRoot && run.workflowPath
                  ? resolve(join(run.projectRoot, run.workflowPath))
                  : String(run.workflowPath),
                jobId: run.jobId,
                eventName: run.eventName,
                eventPath: run.eventPath,
                secretFile: run.secretFile,
                varsFile: run.varsFile,
                platforms: run.platforms,
                workdir: run.projectRoot,
                dockerConfig,
                onOutput: (chunk) => appendLog(run, chunk),
              })
            : run.engine === 'github'
            ? await executeWorkflowWithGitHub({
                workflowPath: run.projectRoot && run.workflowPath
                  ? resolve(join(run.projectRoot, run.workflowPath))
                  : String(run.workflowPath),
                repo: run.repo,
                ref: run.ref,
                inputs: run.inputs,
                workdir: run.projectRoot,
                onOutput: (chunk) => appendLog(run, chunk),
              })
            : await executeWorkflowInDocker({
                image: run.image ?? 'ubuntu:latest',
                steps: run.steps ?? [],
                workdir: run.projectRoot,
                dockerConfig,
                onOutput: (chunk) => appendLog(run, chunk),
              });

        run.exitCode = result.exitCode;
        if (!run.log) run.log = result.log;
        run.status = result.exitCode === 0 ? 'success' : 'failed';
        run.updatedAt = Date.now();
        broadcast({ type: 'run.finished', run });
      } catch (e) {
        run.exitCode = 1;
        run.status = 'failed';
        run.updatedAt = Date.now();
        broadcast({ type: 'run.finished', run, error: (e as Error).message });
      }
    })();

    return { id };
  });

  server.get('/ws', { websocket: true }, (conn, req) => {
    try {
      authOrThrow(req);
    } catch {
      try {
        conn.socket.close();
      } catch {
        // ignore
      }
      return;
    }

    const client: WsClient = {
      send: (data) => conn.socket.send(data),
    };
    clients.add(client);

    // initial snapshot
    client.send(
      JSON.stringify({
        type: 'hello',
        runs: Array.from(runs.values()).sort((a, b) => b.createdAt - a.createdAt),
      })
    );

    conn.socket.on('close', () => {
      clients.delete(client);
    });
  });

  await server.listen({ host, port });

  return {
    host,
    port,
    token: daemonToken,
    close: async () => {
      await server.close();
    },
  };
}
