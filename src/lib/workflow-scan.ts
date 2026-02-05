import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export type ScannedWorkflow = {
  path: string; // relative to project root
  absPath: string;
  fileName: string;
};

export async function scanWorkflows(projectRoot: string): Promise<ScannedWorkflow[]> {
  const dir = join(projectRoot, '.github', 'workflows');
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const files = entries
    .filter((f) => f.toLowerCase().endsWith('.yml') || f.toLowerCase().endsWith('.yaml'))
    .sort();

  return files.map((fileName) => ({
    fileName,
    path: join('.github', 'workflows', fileName),
    absPath: join(dir, fileName),
  }));
}
