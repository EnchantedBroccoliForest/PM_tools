function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasReservedOutcomeTokenPrefix(name) {
  return typeof name === 'string' && name.trim().startsWith('OT');
}

export function validateFinalMarketJson(finalJson) {
  if (!isPlainObject(finalJson) || 'raw' in finalJson) {
    return { valid: true, errors: [] };
  }

  const errors = [];
  if (Array.isArray(finalJson.outcomes)) {
    finalJson.outcomes.forEach((outcome, index) => {
      if (hasReservedOutcomeTokenPrefix(outcome?.name)) {
        errors.push(`outcomes[${index}].name must not begin with reserved "OT" token prefix`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}
