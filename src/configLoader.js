/**
 * Pipeline configuration loader.
 *
 * Loads pipeline configuration from JSON files in the config/ directory,
 * inspired by llm-council-governance's YAML experiment configs. This
 * decouples pipeline behavior from code, enabling:
 *   - Reproducible runs without code changes
 *   - A/B testing different pipeline configurations
 *   - Easy sharing of configurations between team members
 *   - CLI --config flag support
 *
 * Config files define models (drafter, reviewers, judge) and options
 * (aggregation, escalation, evidence, verifiers, deliberation). Any
 * missing field falls back to the defaults in src/defaults.js.
 *
 * This module is Node-only (uses fs / path). The browser UI does not
 * import it — the React app uses useMarketReducer for state instead.
 *
 * Usage:
 *   import { loadConfig, mergeWithDefaults } from './configLoader.js';
 *   const config = loadConfig('deliberation');
 *   const resolved = mergeWithDefaults(config);
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DRAFTER_MODEL,
  DEFAULT_REVIEWER_MODELS,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_OPTIONS,
} from './defaults.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, '..', 'config');

/**
 * List available configuration names (filenames without .json extension).
 * @returns {string[]}
 */
export function listConfigs() {
  try {
    return readdirSync(CONFIG_DIR)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.schema.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

/**
 * Load a pipeline configuration from a JSON file.
 *
 * @param {string} pathOrName  absolute path, relative path, or just the
 *                             config name (e.g. 'deliberation' → config/deliberation.json)
 * @returns {object} parsed config
 * @throws {Error} if the file cannot be read or parsed
 */
export function loadConfig(pathOrName) {
  let filePath = pathOrName;

  // If it looks like a bare name (no slashes, no .json), resolve from config/
  if (!filePath.includes('/') && !filePath.includes('\\') && !filePath.endsWith('.json')) {
    filePath = join(CONFIG_DIR, `${filePath}.json`);
  }

  // Resolve relative paths
  if (!filePath.startsWith('/')) {
    filePath = resolve(process.cwd(), filePath);
  }

  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Merge a loaded config with defaults. Any field not present in the config
 * falls back to the default value from src/defaults.js.
 *
 * @param {object} config   parsed config (from loadConfig or inline)
 * @returns {{ models: object, options: object }}
 */
export function mergeWithDefaults(config) {
  const models = {
    drafter: config?.models?.drafter || DEFAULT_DRAFTER_MODEL,
    reviewers:
      Array.isArray(config?.models?.reviewers) && config.models.reviewers.length > 0
        ? config.models.reviewers
        : DEFAULT_REVIEWER_MODELS,
    judge: config?.models?.judge || DEFAULT_JUDGE_MODEL,
  };

  const options = {
    aggregation: config?.options?.aggregation || DEFAULT_OPTIONS.aggregation,
    escalation: config?.options?.escalation || DEFAULT_OPTIONS.escalation,
    evidence: config?.options?.evidence || DEFAULT_OPTIONS.evidence,
    verifiers: config?.options?.verifiers || DEFAULT_OPTIONS.verifiers,
    deliberation: config?.options?.deliberation || DEFAULT_OPTIONS.deliberation,
  };

  return { models, options };
}

/**
 * Validate a config object. Returns null if valid, or an array of error
 * strings describing what's wrong.
 *
 * @param {object} config
 * @returns {string[]|null}
 */
export function validateConfig(config) {
  const errors = [];

  if (!config || typeof config !== 'object') {
    return ['config must be an object'];
  }

  // Validate models
  if (config.models) {
    if (config.models.drafter && typeof config.models.drafter !== 'string') {
      errors.push('models.drafter must be a string (OpenRouter model ID)');
    }
    if (config.models.judge && typeof config.models.judge !== 'string') {
      errors.push('models.judge must be a string (OpenRouter model ID)');
    }
    if (config.models.reviewers) {
      if (!Array.isArray(config.models.reviewers)) {
        errors.push('models.reviewers must be an array');
      } else {
        for (let i = 0; i < config.models.reviewers.length; i++) {
          const r = config.models.reviewers[i];
          if (!r.id || typeof r.id !== 'string') {
            errors.push(`models.reviewers[${i}].id must be a non-empty string`);
          }
          if (!r.name || typeof r.name !== 'string') {
            errors.push(`models.reviewers[${i}].name must be a non-empty string`);
          }
        }
      }
    }
  }

  // Validate options
  if (config.options) {
    const validAggregation = ['majority', 'unanimity', 'judge'];
    if (config.options.aggregation && !validAggregation.includes(config.options.aggregation)) {
      errors.push(`options.aggregation must be one of: ${validAggregation.join(', ')}`);
    }

    const validEscalation = ['always', 'selective'];
    if (config.options.escalation && !validEscalation.includes(config.options.escalation)) {
      errors.push(`options.escalation must be one of: ${validEscalation.join(', ')}`);
    }

    const validEvidence = ['none', 'retrieval'];
    if (config.options.evidence && !validEvidence.includes(config.options.evidence)) {
      errors.push(`options.evidence must be one of: ${validEvidence.join(', ')}`);
    }

    const validVerifiers = ['off', 'partial', 'full'];
    if (config.options.verifiers && !validVerifiers.includes(config.options.verifiers)) {
      errors.push(`options.verifiers must be one of: ${validVerifiers.join(', ')}`);
    }

    const validDeliberation = ['off', 'on', 'auto'];
    if (config.options.deliberation && !validDeliberation.includes(config.options.deliberation)) {
      errors.push(`options.deliberation must be one of: ${validDeliberation.join(', ')}`);
    }
  }

  return errors.length > 0 ? errors : null;
}
