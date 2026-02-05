import open from 'open';

type DeviceStartResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

export async function deviceLogin(params: {
  apiBaseUrl: string;
}): Promise<{ token: string; message: string }> {
  const { apiBaseUrl } = params;

  const startRes = await fetch(`${apiBaseUrl}/api/auth/cli/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!startRes.ok) {
    const text = await startRes.text().catch(() => '');
    throw new Error(`Failed to start device auth (${startRes.status}). ${text}`);
  }

  const start = (await startRes.json()) as DeviceStartResponse;

  // Print instructions
  process.stdout.write(`\nTo authenticate Pipeline Debugger CLI:\n`);
  process.stdout.write(`1) Open: ${start.verification_uri}\n`);
  process.stdout.write(`2) Enter code: ${start.user_code}\n\n`);

  // Best-effort open browser to the pre-filled URL.
  try {
    await open(start.verification_uri_complete);
  } catch {
    // ignore
  }

  const deadline = Date.now() + start.expires_in * 1000;
  const intervalMs = Math.max(1000, start.interval * 1000);

  while (Date.now() < deadline) {
    await sleep(intervalMs);

    const pollRes = await fetch(`${apiBaseUrl}/api/auth/cli-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: start.device_code }),
    });

    if (pollRes.ok) {
      const data = (await pollRes.json()) as { token: string; token_type: string };
      return {
        token: data.token,
        message: 'Logged in successfully.',
      };
    }

    // Expected pending response: 428
    if (pollRes.status === 428) {
      continue;
    }

    const err = (await pollRes.json().catch(() => null)) as { error?: string } | null;
    throw new Error(`Login failed: ${err?.error ?? pollRes.statusText} (${pollRes.status})`);
  }

  throw new Error('Login timed out. Please run `pdbg login` again.');
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
