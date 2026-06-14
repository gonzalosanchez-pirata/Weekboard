// Configuración de validación y constantes
export const VALID_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type ValidDay = (typeof VALID_DAYS)[number];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const WEEK_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const VALID_DAYS_LIST = VALID_DAYS.join(', ');

// Auxiliares de validación
export function firstError(...errors: (string | null)[]): string | null {
  for (const err of errors) {
    if (err) {
      return err;
    }
  }
  return null;
}

// Validadores de campos individuales
export function validateName(name: unknown): string | null {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return 'name debe tener entre 1 y 100 caracteres';
  }
  if (name.length > 100) {
    return 'name debe tener entre 1 y 100 caracteres';
  }
  return null;
}

export function validateColor(color: unknown): string | null {
  if (color === null || color === undefined) {
    return null;
  }
  if (typeof color !== 'string' || !HEX_COLOR_RE.test(color)) {
    return 'color debe ser null o un hexadecimal #rrggbb';
  }
  return null;
}

export function normalizeColor(color: unknown): string | null {
  if (color === null || color === undefined) {
    return null;
  }
  return color as string;
}

export function validateDays(days: unknown): string | null {
  if (!Array.isArray(days)) {
    return `days debe ser un array con valores: ${VALID_DAYS_LIST}`;
  }
  for (const day of days) {
    if (typeof day !== 'string' || !VALID_DAYS.includes(day as ValidDay)) {
      return `days debe ser un array con valores: ${VALID_DAYS_LIST}`;
    }
  }
  return null;
}

export function validateWeek(week: unknown): string | null {
  if (typeof week !== 'string' || !WEEK_DATE_RE.test(week)) {
    return 'week debe tener formato YYYY-MM-DD válido';
  }
  const date = new Date(`${week}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return 'week debe tener formato YYYY-MM-DD válido';
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  if (`${y}-${m}-${d}` !== week) {
    return 'week debe tener formato YYYY-MM-DD válido';
  }
  return null;
}

export function validateDay(day: unknown): string | null {
  if (typeof day !== 'string' || !VALID_DAYS.includes(day as ValidDay)) {
    return `day debe ser uno de: ${VALID_DAYS_LIST}`;
  }
  return null;
}

// Configuración de límites del cronómetro
export const MIN_DURATION_SECONDS = 1;
/** Máximo 99:59:59 */
export const MAX_DURATION_SECONDS = 99 * 3600 + 59 * 60 + 59;

export function validateDurationSeconds(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return `duration_seconds debe ser un entero entre ${MIN_DURATION_SECONDS} y ${MAX_DURATION_SECONDS}`;
  }
  if (value < MIN_DURATION_SECONDS || value > MAX_DURATION_SECONDS) {
    return `duration_seconds debe ser un entero entre ${MIN_DURATION_SECONDS} y ${MAX_DURATION_SECONDS}`;
  }
  return null;
}

// Validadores de cuerpo de peticiones
export function validateActivityBody(body: {
  name: unknown;
  color: unknown;
  days: unknown;
}): { error: string } | { name: string; color: string | null; days: ValidDay[] } {
  if (body.name === undefined || body.name === null) {
    return { error: 'Faltan datos obligatorios o el formato de days es incorrecto' };
  }
  if (body.days === undefined || body.days === null) {
    return { error: 'Faltan datos obligatorios o el formato de days es incorrecto' };
  }

  const error = firstError(
    validateName(body.name),
    validateColor(body.color),
    validateDays(body.days)
  );
  if (error) {
    return { error };
  }

  return {
    name: body.name as string,
    color: normalizeColor(body.color),
    days: body.days as ValidDay[],
  };
}

// Validador de parámetro :id en rutas
export function validateNumericId(id: unknown): string | null {
  if (typeof id !== 'string' || !/^\d+$/.test(id) || Number(id) === 0) {
    return 'id debe ser un entero positivo';
  }
  return null;
}
