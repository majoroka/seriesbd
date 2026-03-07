const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}

function normalizeDisplayName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function resolveRequestedName(url) {
  return url.searchParams.get('name') || url.searchParams.get('display_name') || '';
}

async function fetchMatchingProfiles(env, normalizedName) {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase server credentials are missing.');
  }

  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const queryUrl = new URL(`${baseUrl}/rest/v1/profiles`);
  queryUrl.searchParams.set('select', 'id,display_name');
  queryUrl.searchParams.set('display_name', `ilike.${normalizedName}`);
  queryUrl.searchParams.set('limit', '1');

  const response = await fetch(queryUrl.toString(), {
    method: 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Supabase select failed (${response.status}): ${errorBody.slice(0, 300)}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: JSON_HEADERS,
    });
  }

  if (method !== 'GET') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, {
      Allow: 'GET, OPTIONS',
    });
  }

  const url = new URL(request.url);
  const normalizedName = normalizeDisplayName(resolveRequestedName(url));

  if (!normalizedName) {
    return jsonResponse({ ok: false, error: 'Missing name parameter' }, 400);
  }

  if (normalizedName.length < 3) {
    return jsonResponse({ ok: false, error: 'Display name must have at least 3 characters' }, 400);
  }

  if (normalizedName.length > 80) {
    return jsonResponse({ ok: false, error: 'Display name exceeds 80 characters' }, 400);
  }

  try {
    const rows = await fetchMatchingProfiles(env, normalizedName);
    return jsonResponse({
      ok: true,
      normalizedName,
      available: rows.length === 0,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      {
        ok: false,
        error: 'Failed to validate display name',
        details,
      },
      500
    );
  }
}
