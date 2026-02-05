import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { nanoid } from 'nanoid';

import { getConfig, saveConfig } from './config.js';
import { executeWorkflowInDocker, type WorkflowStep } from './docker-executor.js';

export type DaemonConfig = {
  host?: string;
  port?: number;
  allowedOrigins?: string[];
};

type RunStatus = 'queued' | 'running' | 'success' | 'failed';

type RunRecord = {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: RunStatus;
  workflowPath?: string;
  jobId?: string;
  image: string;
  steps: WorkflowStep[];
  exitCode?: number;
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

  const server = Fastify({
    logger: false,
  });

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

  const runs = new Map<string, RunRecord>();
  const clients = new Set<WsClient>();

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
      runs: Array.from(runs.values()).sort((a, b) => b.createdAt - a.createdAt),
    };
  });

  server.post('/runs', async (req: any) => {
    authOrThrow(req);

    const body = (req.body ?? {}) as {
      image?: string;
      steps?: WorkflowStep[];
      workflowPath?: string;
      jobId?: string;
    };

    const id = nanoid(12);
    const image = body.image ?? 'ubuntu:latest';
    const steps = body.steps ?? [];

    const run: RunRecord = {
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'queued',
      image,
      steps,
      workflowPath: body.workflowPath,
      jobId: body.jobId,
    };

    runs.set(id, run);
    broadcast({ type: 'run.created', run });

    // fire and forget
    void (async () => {
      run.status = 'running';
      run.updatedAt = Date.now();
      broadcast({ type: 'run.updated', run });

      try {
        const result = await executeWorkflowInDocker({
          image: run.image,
          steps: run.steps,
        });

        run.exitCode = result.exitCode;
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
