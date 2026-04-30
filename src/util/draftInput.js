const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const OFFSET_DATE_TIME_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function toIsoWithoutMillis(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function normalizeUtcDateTime(value, fallbackTime = '00:00:00') {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';

  if (DATE_ONLY_RE.test(raw)) {
    return toIsoWithoutMillis(new Date(`${raw}T${fallbackTime}Z`));
  }

  if (LOCAL_DATE_TIME_RE.test(raw)) {
    const withSeconds = raw.length === 16 ? `${raw}:00` : raw;
    return toIsoWithoutMillis(new Date(`${withSeconds}Z`));
  }

  if (OFFSET_DATE_TIME_RE.test(raw)) {
    return toIsoWithoutMillis(new Date(raw));
  }

  return '';
}

export function toDateTimeLocalValue(value, fallbackTime = '00:00:00') {
  const iso = normalizeUtcDateTime(value, fallbackTime);
  return iso ? iso.slice(0, 16) : '';
}

export function validateDraftInputs(input, now = Date.now()) {
  const question = typeof input?.question === 'string' ? input.question.trim() : '';
  const startRaw = typeof input?.startDate === 'string' ? input.startDate.trim() : '';
  const endRaw = typeof input?.endDate === 'string' ? input.endDate.trim() : '';
  const startDateUTC = normalizeUtcDateTime(startRaw, '00:00:00');
  const endDateUTC = normalizeUtcDateTime(endRaw, '23:59:59');
  const errors = {};

  if (!question) {
    errors.question = 'Market question is required.';
  }

  if (!startRaw) {
    errors.startDate = 'Start date and time is required.';
  } else if (!startDateUTC) {
    errors.startDate = 'Enter a valid UTC start date and time.';
  } else if (new Date(startDateUTC).getTime() <= now) {
    errors.startDate = 'Start date and time must be in the future.';
  }

  if (!endRaw) {
    errors.endDate = 'End date and time is required.';
  } else if (!endDateUTC) {
    errors.endDate = 'Enter a valid UTC end date and time.';
  }

  if (startDateUTC && endDateUTC) {
    const startMs = new Date(startDateUTC).getTime();
    const endMs = new Date(endDateUTC).getTime();
    if (endMs <= startMs) {
      errors.endDate = 'End date and time must be later than Start.';
    }
  }

  return {
    errors,
    startDateUTC,
    endDateUTC,
    isValid: Object.keys(errors).length === 0,
  };
}

export function validateDatePair(startDate, endDate, now = Date.now()) {
  const result = validateDraftInputs({
    question: 'placeholder',
    startDate,
    endDate,
  }, now);

  const errors = { ...result.errors };
  if (!startDate) delete errors.startDate;
  if (!endDate) delete errors.endDate;
  return errors.startDate || errors.endDate || null;
}
