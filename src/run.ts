import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { executeWorkflowInDocker } from './lib/docker-executor.js';

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
  image: string;
  jobId?: string;
}): Promise<number> {
  const { workflowPath, image, jobId } = params;

  const content = await readFile(workflowPath, 'utf8');
  const doc = yaml.load(content) as WorkflowDoc;
  const picked = pickJob(doc, jobId);

  const steps = picked.job.steps ?? [];

  console.log(`Workflow: ${doc.name ?? '(unnamed)'} | Job: ${picked.jobId}${picked.job.name ? ` (${picked.job.name})` : ''}`);
  console.log(`Image: ${image}`);

  const result = await executeWorkflowInDocker({
    image,
    steps,
  });

  return result.exitCode;
}
