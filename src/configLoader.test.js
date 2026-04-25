/**
 * Unit tests for src/configLoader.js.
 *
 * Tests config loading, merging with defaults, and validation.
 */

import { describe, it, expect } from 'vitest';
import { loadConfig, mergeWithDefaults, validateConfig, listConfigs } from './configLoader.js';

describe('listConfigs', () => {
  it('returns an array of available config names', () => {
    const configs = listConfigs();
    expect(Array.isArray(configs)).toBe(true);
    expect(configs).toContain('default');
    expect(configs).toContain('deliberation');
    expect(configs).toContain('fast');
  });
});

describe('loadConfig', () => {
  it('loads a config by name', () => {
    const config = loadConfig('default');
    expect(config).toBeDefined();
    expect(config.models).toBeDefined();
    expect(config.options).toBeDefined();
  });

  it('loads the deliberation config', () => {
    const config = loadConfig('deliberation');
    expect(config.options.deliberation).toBe('auto');
    expect(config.models.reviewers.length).toBeGreaterThan(1);
  });

  it('loads the fast config', () => {
    const config = loadConfig('fast');
    expect(config.options.evidence).toBe('none');
    expect(config.options.verifiers).toBe('partial');
  });

  it('throws on nonexistent config', () => {
    expect(() => loadConfig('nonexistent_config_xyz')).toThrow();
  });
});

describe('mergeWithDefaults', () => {
  it('fills in all defaults for empty config', () => {
    const result = mergeWithDefaults({});
    expect(result.models.drafter).toBe('openai/gpt-5.2');
    expect(result.models.reviewers).toHaveLength(1);
    expect(result.options.aggregation).toBe('majority');
    expect(result.options.deliberation).toBe('off');
  });

  it('preserves explicit config values', () => {
    const config = {
      models: {
        drafter: 'custom/model',
        reviewers: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      },
      options: {
        aggregation: 'unanimity',
        deliberation: 'on',
      },
    };
    const result = mergeWithDefaults(config);
    expect(result.models.drafter).toBe('custom/model');
    expect(result.models.reviewers).toHaveLength(2);
    expect(result.options.aggregation).toBe('unanimity');
    expect(result.options.deliberation).toBe('on');
    // Defaults for unspecified fields
    expect(result.options.escalation).toBe('always');
    expect(result.options.evidence).toBe('retrieval');
  });

  it('handles null config', () => {
    const result = mergeWithDefaults(null);
    expect(result.models.drafter).toBeTruthy();
    expect(result.options.aggregation).toBeTruthy();
  });
});

describe('validateConfig', () => {
  it('returns null for a valid config', () => {
    const config = loadConfig('default');
    expect(validateConfig(config)).toBeNull();
  });

  it('returns null for the deliberation config', () => {
    const config = loadConfig('deliberation');
    expect(validateConfig(config)).toBeNull();
  });

  it('returns errors for non-object input', () => {
    const errors = validateConfig(null);
    expect(errors).toContain('config must be an object');
  });

  it('returns errors for invalid aggregation', () => {
    const errors = validateConfig({ options: { aggregation: 'invalid' } });
    expect(errors).not.toBeNull();
    expect(errors[0]).toMatch(/aggregation/i);
  });

  it('returns errors for invalid deliberation', () => {
    const errors = validateConfig({ options: { deliberation: 'maybe' } });
    expect(errors).not.toBeNull();
    expect(errors[0]).toMatch(/deliberation/i);
  });

  it('returns errors for reviewer with missing id', () => {
    const errors = validateConfig({
      models: { reviewers: [{ name: 'No ID' }] },
    });
    expect(errors).not.toBeNull();
    expect(errors[0]).toMatch(/reviewers\[0\]\.id/);
  });

  it('returns null for minimal valid config', () => {
    expect(validateConfig({})).toBeNull();
  });

  it('returns errors for non-object reviewer entries (null)', () => {
    const errors = validateConfig({
      models: { reviewers: [null, 42, 'string'] },
    });
    expect(errors).not.toBeNull();
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/reviewers\[0\] must be an object/);
    expect(errors[1]).toMatch(/reviewers\[1\] must be an object/);
    expect(errors[2]).toMatch(/reviewers\[2\] must be an object/);
  });
});
