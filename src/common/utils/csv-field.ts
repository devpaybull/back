const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export const csvField = (value: string | number | null): string => {
  const raw = value === null ? '' : String(value);
  const text =
    typeof value === 'string' &&
    FORMULA_START.test(raw) &&
    !PLAIN_NUMBER.test(raw)
      ? `'${raw}`
      : raw;

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
