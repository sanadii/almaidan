export const JOIN_NAME_MAX_LENGTH = 30;
export const JOIN_NAME_MESSAGE = 'اكتب اسمك (حتى 30 حرفاً).';

export function normalizePlayerDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) return undefined;
  const name = value.trim().normalize('NFC');
  return Array.from(name).length <= JOIN_NAME_MAX_LENGTH && /[\p{L}\p{N}]/u.test(name)
    ? name
    : undefined;
}
