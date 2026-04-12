/**
 * Unit tests for src/pipeline/PipelineStage.js.
 *
 * Tests the abstract base class contract and the runtime interface validator.
 */

import { describe, it, expect } from 'vitest';
import { PipelineStage, validateStageInterface } from './PipelineStage.js';

describe('PipelineStage base class', () => {
  it('throws on direct get name()', () => {
    const stage = new PipelineStage();
    expect(() => stage.name).toThrow(/must override/);
  });

  it('throws on direct get description()', () => {
    const stage = new PipelineStage();
    expect(() => stage.description).toThrow(/must override/);
  });

  it('throws on direct execute()', async () => {
    const stage = new PipelineStage();
    await expect(stage.execute()).rejects.toThrow(/must override/);
  });

  it('validateInput returns null by default (accepts anything)', () => {
    const stage = new PipelineStage();
    expect(stage.validateInput({})).toBeNull();
    expect(stage.validateInput(null)).toBeNull();
  });
});

describe('PipelineStage subclass', () => {
  class TestStage extends PipelineStage {
    get name() { return 'testStage'; }
    get description() { return 'A test stage'; }
    async execute(input) {
      return {
        data: input?.value * 2,
        usage: null,
        wallClockMs: 0,
        logEntry: null,
      };
    }
    validateInput(input) {
      if (!input || typeof input.value !== 'number') {
        return 'input.value must be a number';
      }
      return null;
    }
  }

  it('returns correct name and description', () => {
    const stage = new TestStage();
    expect(stage.name).toBe('testStage');
    expect(stage.description).toBe('A test stage');
  });

  it('executes with valid input', async () => {
    const stage = new TestStage();
    const result = await stage.execute({ value: 21 });
    expect(result.data).toBe(42);
  });

  it('validates input correctly', () => {
    const stage = new TestStage();
    expect(stage.validateInput({ value: 5 })).toBeNull();
    expect(stage.validateInput({})).toBe('input.value must be a number');
    expect(stage.validateInput(null)).toBe('input.value must be a number');
  });
});

describe('validateStageInterface', () => {
  it('validates a proper PipelineStage subclass', () => {
    class GoodStage extends PipelineStage {
      get name() { return 'good'; }
      get description() { return 'A good stage'; }
      async execute() { return { data: null, usage: null, wallClockMs: 0, logEntry: null }; }
    }
    const result = validateStageInterface(new GoodStage());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects non-objects', () => {
    expect(validateStageInterface(null).valid).toBe(false);
    expect(validateStageInterface('string').valid).toBe(false);
    expect(validateStageInterface(42).valid).toBe(false);
  });

  it('rejects objects missing execute', () => {
    const obj = { name: 'test', description: 'test', validateInput: () => null };
    const result = validateStageInterface(obj);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('execute must be a function');
  });

  it('rejects objects missing validateInput', () => {
    const obj = { name: 'test', description: 'test', execute: async () => {} };
    const result = validateStageInterface(obj);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('validateInput must be a function');
  });

  it('validates plain objects that satisfy the interface', () => {
    const obj = {
      name: 'plain',
      description: 'A plain stage',
      execute: async () => {},
      validateInput: () => null,
    };
    const result = validateStageInterface(obj);
    expect(result.valid).toBe(true);
  });
});
