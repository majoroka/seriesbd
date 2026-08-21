import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => {
  const resetPasswordForEmail = vi.fn();
  const updateUser = vi.fn();

  return {
    resetPasswordForEmail,
    updateUser,
    client: {
      auth: {
        resetPasswordForEmail,
        updateUser,
      },
    },
  };
});

vi.mock('./supabase', () => ({
  getSupabaseClient: () => mocked.client,
  isSupabaseConfigured: () => true,
}));

import { requestPasswordResetEmail, updateCurrentUserPassword } from './auth';

describe('password recovery auth helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.resetPasswordForEmail.mockResolvedValue({ error: null });
    mocked.updateUser.mockResolvedValue({ error: null });
  });

  it('requests a recovery email that identifies the password recovery callback', async () => {
    await requestPasswordResetEmail('member@example.com');

    expect(mocked.resetPasswordForEmail).toHaveBeenCalledWith('member@example.com', {
      redirectTo: `${window.location.origin}/?password_recovery=1`,
    });
  });

  it('updates only the password in the authenticated recovery session', async () => {
    await updateCurrentUserPassword('new-secure-password');

    expect(mocked.updateUser).toHaveBeenCalledWith({ password: 'new-secure-password' });
  });

  it('propagates a provider error when the recovery email cannot be requested', async () => {
    mocked.resetPasswordForEmail.mockResolvedValueOnce({ error: new Error('Rate limit exceeded') });

    await expect(requestPasswordResetEmail('member@example.com')).rejects.toThrow('Rate limit exceeded');
  });
});
