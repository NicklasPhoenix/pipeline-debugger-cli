// MVP placeholder for device/OAuth login.
// Web integration can be implemented once the web API contract is finalized.

export async function deviceLogin(params: {
  apiBaseUrl: string;
}): Promise<{ token: string; message: string }> {
  const { apiBaseUrl } = params;

  // For now: instruct user how to proceed.
  // Later: request device code, open verification URI, poll for token.
  const token = process.env.PIPELINE_DEBUGGER_TOKEN;
  if (!token) {
    throw new Error(
      `Device login not implemented yet.\n\n` +
        `Set PIPELINE_DEBUGGER_TOKEN in your environment for now, e.g.:\n` +
        `  PIPELINE_DEBUGGER_TOKEN=... pdbg status\n\n` +
        `Planned API base: ${apiBaseUrl}`
    );
  }

  return {
    token,
    message: 'Logged in (token loaded from PIPELINE_DEBUGGER_TOKEN and saved locally).',
  };
}
