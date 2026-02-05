import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { type DockerConfig } from './docker-config.js';

export type ActRunParams = {
  workflowPath: string;
  jobId?: string;
  eventName?: string;
  eventPath?: string;
  secretFile?: string;
  varsFile?: string;
  platforms?: string[];
  workdir?: string;
  dockerConfig?: DockerConfig;
  onOutput?: (chunk: string) => void;
};

export async function executeWorkflowWithAct(
  params: ActRunParams
): Promise<{ exitCode: number; log: string }> {
  const {
    workflowPath,
    jobId,
    eventName = 'push',
    eventPath,
    secretFile,
    varsFile,
    platforms,
    workdir,
    dockerConfig,
    onOutput,
  } = params;

  const chunks: string[] = [];
  const push = (s: string) => {
    chunks.push(s);
    try {
      if (onOutput) onOutput(s);
      else process.stdout.write(s);
    } catch {
      // ignore
    }
  };

  const args: string[] = ['-W', workflowPath];
  if (jobId) args.push('-j', jobId);
  if (eventPath) args.push('--eventpath', eventPath);
  if (secretFile) args.push('--secret-file', secretFile);
  if (varsFile) args.push('--var-file', varsFile);
  if (platforms && platforms.length > 0) {
    for (const p of platforms) {
      args.push('-P', p);
    }
  }
  args.push(eventName);

  const env = { ...process.env } as Record<string, string>;
  if (dockerConfig?.dockerHost) env.DOCKER_HOST = dockerConfig.dockerHost;
  if (dockerConfig?.dockerTlsVerify) env.DOCKER_TLS_VERIFY = '1';
  const certPath =
    dockerConfig?.dockerCertPath ??
    (dockerConfig?.dockerKeyPath ? dirname(dockerConfig.dockerKeyPath) : undefined) ??
    (dockerConfig?.dockerCaPath ? dirname(dockerConfig.dockerCaPath) : undefined);
  if (certPath) env.DOCKER_CERT_PATH = certPath;

  const cwd = workdir ?? process.cwd();

  return new Promise((resolve, reject) => {
    let exitCode = 0;

    const proc = spawn('act', args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (buf: Buffer) => push(buf.toString('utf8')));
    proc.stderr?.on('data', (buf: Buffer) => push(buf.toString('utf8')));

    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('act is not installed. Install it from https://github.com/nektos/act'));
        return;
      }
      reject(err);
    });

    proc.on('close', (code) => {
      exitCode = code ?? 0;
      resolve({ exitCode, log: chunks.join('') });
    });
  });
}
