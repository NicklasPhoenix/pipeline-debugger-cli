import { getConfig } from './config.js';

export async function listWorkflows(params: { apiBaseUrl: string }) {
  const cfg = getConfig();
  if (!cfg.token) {
    throw new Error('Not authenticated. Run: pdbg login');
  }

  const res = await fetch(`${params.apiBaseUrl}/api/workflows`, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to list workflows (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { workflows: Array<{ id: string; name: string; yamlPath?: string | null }> };
  return data.workflows;
}
