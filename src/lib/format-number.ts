const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
const persianDigits = '۰۱۲۳۴۵۶۷۸۹';

export function westernDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/gu, digit => String(Math.max(arabicDigits.indexOf(digit), persianDigits.indexOf(digit))));
}

export function formatNumber(value: number | bigint | string) {
  return typeof value === 'string' ? westernDigits(value) : String(value);
}

export function formatSeconds(seconds: number) {
  return `${formatNumber(seconds)} ثانية`;
}
