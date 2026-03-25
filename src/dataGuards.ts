export const MAX_IMPORT_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_LIBRARY_SNAPSHOT_SIZE_BYTES = 4 * 1024 * 1024;
export const MAX_USER_NOTES_LENGTH = 5000;

export function clampUserNotes(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.slice(0, MAX_USER_NOTES_LENGTH);
}

export function clampProgressPercent(input: unknown): number | undefined {
  const parsed = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getSerializedJsonSizeBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function assertSerializedJsonLimit(value: unknown, maxBytes: number, label: string): void {
  const sizeBytes = getSerializedJsonSizeBytes(value);
  if (sizeBytes > maxBytes) {
    throw new Error(`${label} excede o tamanho máximo suportado.`);
  }
}
