type Env = {
  HEARTBEAT_URL?: string;
  HEARTBEAT_TOKEN?: string;
};

function buildHeaders(token?: string): HeadersInit {
  const headers: HeadersInit = {
    'User-Agent': 'seriesbd-heartbeat-cron/1.0',
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['x-heartbeat-token'] = token;
  }
  return headers;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const heartbeatUrl = env.HEARTBEAT_URL;
    if (!heartbeatUrl) {
      console.error('[heartbeat-cron] Missing HEARTBEAT_URL env var.');
      return;
    }

    const runPromise = (async () => {
      const startedAt = Date.now();

      try {
        const response = await fetch(heartbeatUrl, {
          method: 'POST',
          headers: buildHeaders(env.HEARTBEAT_TOKEN),
          body: JSON.stringify({
            trigger: 'cloudflare-cron',
            timestamp: new Date().toISOString(),
          }),
        });

        const durationMs = Date.now() - startedAt;
        const responseText = await response.text();

        if (!response.ok) {
          console.error('[heartbeat-cron] Heartbeat endpoint returned non-2xx.', {
            status: response.status,
            durationMs,
            bodyPreview: responseText.slice(0, 300),
          });
          return;
        }

        console.log('[heartbeat-cron] Heartbeat request completed.', {
          status: response.status,
          durationMs,
          bodyPreview: responseText.slice(0, 120),
        });
      } catch (error) {
        console.error('[heartbeat-cron] Failed to call heartbeat endpoint.', {
          error: getErrorMessage(error),
        });
      }
    })();

    ctx.waitUntil(runPromise);
  },
};
