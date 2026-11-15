import { Language } from '../types/crm';

const CAIRO_TZ = 'Africa/Cairo';

/**
 * Formats any ISO-8601 or raw timestamp consistently in Gregorian calendar
 * and Africa/Cairo timezone using standard Latin digits (0-9) so dates never
 * shift across midnight UTC or render in Hijri calendar on mobile browsers.
 */
export function formatCairoDateTime(
  value?: string | null,
  lang: Language = 'ar',
  options?: { includeTime?: boolean }
): string {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return String(value).slice(0, 16);
  }

  const includeTime = options?.includeTime !== false;

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: CAIRO_TZ,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(dt);

    const map: Record<string, string> = {};
    for (const p of parts) {
      map[p.type] = p.value;
    }

    const datePart = `${map.year}-${map.month}-${map.day}`;
    if (!includeTime) {
      return datePart;
    }

    const rawPeriod = (map.dayPeriod || '').toUpperCase();
    const isPm = rawPeriod.includes('PM') || rawPeriod.includes('P');
    const periodLabel = lang === 'ar' ? (isPm ? 'م' : 'ص') : isPm ? 'PM' : 'AM';
    const hourStr = (map.hour || '12').padStart(2, '0');
    const minStr = (map.minute || '00').padStart(2, '0');

    return `${datePart} · ${hourStr}:${minStr} ${periodLabel}`;
  } catch {
    return dt.toISOString().slice(0, 10);
  }
}

export function formatCairoTimeOnly(value?: string | null, lang: Language = 'ar'): string {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: CAIRO_TZ,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).formatToParts(dt);

    const map: Record<string, string> = {};
    for (const p of parts) {
      map[p.type] = p.value;
    }
    const rawPeriod = (map.dayPeriod || '').toUpperCase();
    const isPm = rawPeriod.includes('PM') || rawPeriod.includes('P');
    const periodLabel = lang === 'ar' ? (isPm ? 'م' : 'ص') : isPm ? 'PM' : 'AM';
    return `${(map.hour || '12').padStart(2, '0')}:${(map.minute || '00').padStart(2, '0')}:${(map.second || '00').padStart(2, '0')} ${periodLabel}`;
  } catch {
    return dt.toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US');
  }
}
