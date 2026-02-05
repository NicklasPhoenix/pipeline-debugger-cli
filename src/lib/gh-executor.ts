import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitHubRunParams = {
  workflowPath: string;
  repo?: string; // owner/repo
  ref?: string;
  inputs?: Record<string, string>;
  workdir?: string;
  onOutput?: (chunk: string) => void;
};

function parseRepoFromRemote(remote: string): string | null {
  const trimmed = remote.trim();
  const httpsMatch = trimmed.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`;
  return null;
}

async function resolveRepo(workdir?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
    cwd: workdir,
  });
  const repo = parseRepoFromRemote(stdout);
  if (!repo) throw new Error('Could not determine GitHub repo from git remote');
  return repo;
}

async function listRuns(repo: string, workflowPath: string): Promise<Array<{ databaseId: number; createdAt: string }>> {
  const { stdout } = await execFileAsync('gh', [
    'run',
    'list',
    '-R',
    repo,
    '-w',
    workflowPath,
    '--json',
    'databaseId,createdAt',
  ]);
  return JSON.parse(stdout || '[]') as Array<{ databaseId: number; createdAt: string }>;
}

async function waitForRunId(repo: string, workflowPath: string, startTime: number): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const runs = await listRuns(repo, workflowPath);
    const recent = runs.find((r) => new Date(r.createdAt).getTime() >= startTime - 60_000);
    if (recent) return recent.databaseId;
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error('Failed to resolve GitHub Actions run ID');
}

export async function executeWorkflowWithGitHub(
  params: GitHubRunParams
): Promise<{ exitCode: number; log: string }> {
  const { workflowPath, repo, ref, inputs, workdir, onOutput } = params;

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

  const resolvedRepo = repo ?? (await resolveRepo(workdir));

  const runArgs = ['workflow', 'run', workflowPath, '-R', resolvedRepo];
  if (ref) runArgs.push('--ref', ref);
  if (inputs) {
    for (const [key, value] of Object.entries(inputs)) {
      runArgs.push('-f', `${key}=${value}`);
    }
  }

  const startTime = Date.now();

  const missingGh = () => Object.assign(
    new Error('gh is not installed. Install it from https://cli.github.com'),
    { code: 'GH_MISSING' }
  );

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('gh', runArgs, { cwd: workdir, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout?.on('data', (buf: Buffer) => push(buf.toString('utf8')));
    proc.stderr?.on('data', (buf: Buffer) => push(buf.toString('utf8')));
    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(missingGh());
        return;
      }
      reject(err);
    });
    proc.on('close', (code) => {
      if (code && code !== 0) {
        reject(new Error(`gh workflow run failed (exit ${code})`));
        return;
      }
      resolve();
    });
  });

  const runId = await waitForRunId(resolvedRepo, workflowPath, startTime);

  const watchArgs = ['run', 'watch', String(runId), '-R', resolvedRepo, '--log', '--exit-status'];

  const exitCode = await new Promise<number>((resolve, reject) => {
    const proc = spawn('gh', watchArgs, { cwd: workdir, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout?.on('data', (buf: Buffer) => push(buf.toString('utf8')));
    proc.stderr?.on('data', (buf: Buffer) => push(buf.toString('utf8')));
    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(missingGh());
        return;
      }
      reject(err);
    });
    proc.on('close', (code) => resolve(code ?? 0));
  });

  return { exitCode, log: chunks.join('') };
}
