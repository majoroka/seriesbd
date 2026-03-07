import type { AuthChangeEvent, AuthResponse, Session } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';

export type SignUpInput = {
  email: string;
  password: string;
  displayName?: string;
};

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
  const payload = {
    email: input.email,
    password: input.password,
    options: input.displayName?.trim()
      ? {
          data: {
            full_name: input.displayName.trim(),
          },
        }
      : undefined,
  };
  const { data, error } = await client.auth.signUp(payload);
  if (error) throw error;

  if (data.user && input.displayName?.trim()) {
    const { error: profileError } = await client.from('profiles').upsert(
      {
        id: data.user.id,
        display_name: input.displayName.trim(),
      },
      { onConflict: 'id' }
    );

    if (profileError) {
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
