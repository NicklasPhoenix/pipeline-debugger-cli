import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

export type WorkflowStep = {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
};

export type WorkflowJob = {
  name?: string;
  steps?: WorkflowStep[];
};

export type WorkflowDoc = {
  name?: string;
  jobs?: Record<string, WorkflowJob>;
};

export async function loadWorkflowDoc(absPath: string): Promise<WorkflowDoc> {
  const content = await readFile(absPath, 'utf8');
  return yaml.load(content) as WorkflowDoc;
}

export function pickJob(doc: WorkflowDoc, jobId?: string): { jobId: string; job: WorkflowJob } {
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
