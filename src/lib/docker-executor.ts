import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
import { createDocker, type DockerConfig } from './docker-config.js';

export type WorkflowStep = {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
};

type ExecuteWorkflowInDockerParams = {
  image: string;
  steps: WorkflowStep[];
  /** Host path to mount at /work inside the container. */
  workdir?: string;
  /** Optional Docker config for remote engines. */
  dockerConfig?: DockerConfig;
  /** Optional output sink. If omitted, output is written to stdout. */
  onOutput?: (chunk: string) => void;
};

export async function executeWorkflowInDocker(
  params: ExecuteWorkflowInDockerParams
): Promise<{ exitCode: number; log: string }> {
  const { image, steps, onOutput, workdir, dockerConfig } = params;

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
  const binds = workdir ? [`${workdir}:/work`] : undefined;
  if (workdir) {
    push(`Using workspace: ${workdir}\n`);
  }

  const docker = createDocker(dockerConfig);

  // Quick connectivity check so we can fail with a friendly message.
  try {
    await docker.ping();
  } catch (e) {
    const msg = (e as Error).message;
    throw new Error(
      `Docker is not reachable from this machine.\n` +
        `Make sure Docker Desktop / dockerd is running and your user can access the docker socket.\n` +
        `Underlying error: ${msg}`
    );
  }

  // Pull image best-effort
  try {
    push(`Pulling image ${image}...\n`);
    const stream = await docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } catch (e) {
    push(`(warn) failed to pull ${image}; will try local cache. ${(e as Error).message}\n`);
  }

  const container = await docker.createContainer({
    Image: image,
    Cmd: ['bash', '-lc', 'sleep infinity'],
    Tty: false,
    WorkingDir: '/work',
    HostConfig: {
      AutoRemove: true,
      Binds: binds,
    },
  });

  let finalExit = 0;

  try {
    await container.start();
    await exec(container, 'mkdir -p /work');

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const label = step.name ?? step.run ?? step.uses ?? `Step ${i + 1}`;

      if (step.uses && !step.run) {
        push(`\n==> ${label}\n`);
        push(`(skip) action step not supported: uses: ${step.uses}\n`);
        continue;
      }

      if (!step.run) {
        push(`\n==> ${label}\n`);
        push(`(skip) no run command\n`);
        continue;
      }

      push(`\n==> ${label}\n$ ${step.run}\n`);
      const code = await exec(container, step.run, {
        env: step.env,
        onOutput: (chunk) => push(chunk),
      });

      if (code !== 0) {
        push(`\n(step failed) exit code ${code}\n`);
        finalExit = code;
        break;
      }
    }
  } catch (e) {
    push(`Executor error: ${(e as Error).stack ?? (e as Error).message}\n`);
    finalExit = 1;
  } finally {
    try {
      await container.stop({ t: 0 });
    } catch {
      // ignore
    }
  }

  return { exitCode: finalExit, log: chunks.join('') };
}

async function exec(
  container: Docker.Container,
  cmd: string,
  opts?: {
    env?: Record<string, string>;
    onOutput?: (chunk: string) => void;
  }
): Promise<number> {
  const execObj = await container.exec({
    Cmd: ['bash', '-lc', cmd],
    AttachStdout: true,
    AttachStderr: true,
    Env: opts?.env ? Object.entries(opts.env).map(([k, v]) => `${k}=${v}`) : undefined,
  });

  const stream = await execObj.start({ hijack: true, stdin: false });

  await new Promise<void>((resolve, reject) => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();

    stdout.on('data', (buf: Buffer) => opts?.onOutput?.(buf.toString('utf8')));
    stderr.on('data', (buf: Buffer) => opts?.onOutput?.(buf.toString('utf8')));

    container.modem.demuxStream(stream, stdout, stderr);

    stream.on('end', resolve);
    stream.on('error', reject);
  });

  const inspection = await execObj.inspect();
  return inspection.ExitCode ?? 0;
}
