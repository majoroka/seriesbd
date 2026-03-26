import type { AuthChangeEvent, AuthResponse, Session } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';

export type SignUpInput = {
  email: string;
  password: string;
  displayName?: string;
};

export type DisplayNameAvailability = {
  available: boolean;
  normalizedName?: string;
};

export type ProfileUpdateInput = {
  displayName: string;
  password?: string;
};

function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function isDisplayNameConflictError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  const joined = [
    typeof candidate.code === 'string' ? candidate.code : '',
    typeof candidate.message === 'string' ? candidate.message : '',
    typeof candidate.details === 'string' ? candidate.details : '',
    typeof candidate.hint === 'string' ? candidate.hint : '',
  ].join(' ');
  return /23505|display_name_normalized|profiles_display_name_normalized_unique_idx/i.test(joined);
}

function throwFriendlyDisplayNameConflict(): never {
  throw new Error('Este nome a apresentar já existe. Escolha outro nome.');
}

export async function checkDisplayNameAvailability(displayName: string): Promise<DisplayNameAvailability> {
  const normalized = normalizeDisplayName(displayName);
  if (!normalized) return { available: false, normalizedName: normalized };

  const response = await fetch(`/api/auth/display-name-available?name=${encodeURIComponent(normalized)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `HTTP error! status: ${response.status}`;
    throw new Error(message);
  }

  const available =
    typeof payload === 'object' &&
    payload !== null &&
    'available' in payload &&
    (payload as { available?: unknown }).available === true;

  const normalizedName =
    typeof payload === 'object' &&
    payload !== null &&
    'normalizedName' in payload &&
    typeof (payload as { normalizedName?: unknown }).normalizedName === 'string'
      ? (payload as { normalizedName: string }).normalizedName
      : normalized;

  return { available, normalizedName };
}

export async function getCurrentSession(): Promise<Session | null> {
  if (!isSupabaseConfigured()) return null;

  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function subscribeToAuthState(
  callback: (event: AuthChangeEvent, session: Session | null) => void
): () => void {
  if (!isSupabaseConfigured()) return () => {};

  const client = getSupabaseClient();
  const { data } = client.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });

  return () => data.subscription.unsubscribe();
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResponse> {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { data, error: null };
}

export async function signUpWithPassword(input: SignUpInput): Promise<AuthResponse> {
  const client = getSupabaseClient();
  const emailRedirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
  const payload = {
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo,
      data: input.displayName?.trim()
        ? {
            full_name: input.displayName.trim(),
          }
        : undefined,
    },
  };
  const { data, error } = await client.auth.signUp(payload);
  if (error) {
    if (isDisplayNameConflictError(error)) {
      throwFriendlyDisplayNameConflict();
    }
    throw error;
  }

  if (data.user && input.displayName?.trim()) {
    const { error: profileError } = await client.from('profiles').upsert(
      {
        id: data.user.id,
        display_name: input.displayName.trim(),
      },
      { onConflict: 'id' }
    );

    if (profileError) {
      if (isDisplayNameConflictError(profileError)) {
        throwFriendlyDisplayNameConflict();
      }
      console.warn('[auth] Não foi possível atualizar o display_name no perfil.', profileError);
    }
  }

  return { data, error: null };
}

export async function signOutCurrentUser(): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function updateCurrentUserProfile(input: ProfileUpdateInput): Promise<void> {
  const client = getSupabaseClient();
  const normalizedDisplayName = normalizeDisplayName(input.displayName);
  const password = String(input.password || '').trim();

  const updatePayload: {
    password?: string;
    data?: {
      full_name?: string;
    };
  } = {};

  if (normalizedDisplayName) {
    updatePayload.data = {
      full_name: normalizedDisplayName,
    };
  }

  if (password) {
    updatePayload.password = password;
  }

  if (Object.keys(updatePayload).length > 0) {
    const { error } = await client.auth.updateUser(updatePayload);
    if (error) throw error;
  }

  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError) throw userError;
  if (!user) throw new Error('Sessão inválida para atualizar perfil.');

  if (normalizedDisplayName) {
    const { error: profileError } = await client.from('profiles').upsert(
      {
        id: user.id,
        display_name: normalizedDisplayName,
      },
      { onConflict: 'id' }
    );

    if (profileError) {
      if (isDisplayNameConflictError(profileError)) {
        throwFriendlyDisplayNameConflict();
      }
      throw profileError;
    }
  }
}
