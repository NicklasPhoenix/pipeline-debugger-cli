import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { executeWorkflowInDocker } from './lib/docker-executor.js';
import { executeWorkflowWithAct } from './lib/act-executor.js';
import { type DockerConfig } from './lib/docker-config.js';

type WorkflowStep = {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
};

type WorkflowJob = {
  name?: string;
  steps?: WorkflowStep[];
};

type WorkflowDoc = {
  name?: string;
  jobs?: Record<string, WorkflowJob>;
};

function pickJob(doc: WorkflowDoc, jobId?: string): { jobId: string; job: WorkflowJob } {
  if (!doc.jobs || Object.keys(doc.jobs).length === 0) {
    throw new Error('No jobs found in workflow YAML.');
  }

  if (jobId) {
    const job = doc.jobs[jobId];
    if (!job) throw new Error(`Job '${jobId}' not found in workflow.`);
    return { jobId, job };
  }

  const first = Object.keys(doc.jobs)[0]!;
  return { jobId: first, job: doc.jobs[first]! };
}

export async function runWorkflowFile(params: {
  workflowPath: string;
  image?: string;
  jobId?: string;
  engine?: 'builtin' | 'act';
  eventName?: string;
  eventPath?: string;
  secretFile?: string;
  varsFile?: string;
  platforms?: string[];
  workdir?: string;
  dockerConfig?: DockerConfig;
}): Promise<number> {
  const {
    workflowPath,
    image,
    jobId,
    engine = 'builtin',
    eventName,
    eventPath,
    secretFile,
    varsFile,
    platforms,
  } = params;

  const content = await readFile(workflowPath, 'utf8');
  const doc = yaml.load(content) as WorkflowDoc;
  const picked = pickJob(doc, jobId);

  console.log(`Workflow: ${doc.name ?? '(unnamed)'} | Job: ${picked.jobId}${picked.job.name ? ` (${picked.job.name})` : ''}`);

  const workdir = params.workdir ?? process.cwd();

  if (engine === 'act') {
    const result = await executeWorkflowWithAct({
      workflowPath,
      jobId: picked.jobId,
      eventName,
      eventPath,
      secretFile,
      varsFile,
      platforms,
      workdir,
      dockerConfig: params.dockerConfig,
    });

    return result.exitCode;
  }

  const steps = picked.job.steps ?? [];
  const resolvedImage = image ?? 'ubuntu:latest';

  console.log(`Image: ${resolvedImage}`);

  const result = await executeWorkflowInDocker({
    image: resolvedImage,
    steps,
    workdir,
    dockerConfig: params.dockerConfig,
  });

  return result.exitCode;
}
