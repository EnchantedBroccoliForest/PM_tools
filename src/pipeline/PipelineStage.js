/**
 * Abstract pipeline stage interface.
 *
 * Defines the contract every pipeline stage must satisfy. Inspired by
 * llm-council-governance's GovernanceStructure / Benchmark ABCs, this
 * interface enforces a uniform shape for inputs, outputs, and metadata
 * so stages are:
 *   - self-documenting (name, description, input/output schemas)
 *   - testable (mock implementations can be swapped in)
 *   - composable (the orchestrator can iterate over stages generically)
 *
 * JS doesn't have real abstract classes, so we use a base class with
 * methods that throw on direct invocation. Pipeline modules that adopt
 * this interface extend the class and override `execute()`.
 *
 * Existing pipeline functions (extractClaims, verifyClaims, etc.) are
 * NOT required to extend this class — the interface is additive. New
 * stages and refactored stages can opt in incrementally.
 */

/**
 * @typedef {Object} StageResult
 * @property {*}      data       stage-specific output (claims, verifications, etc.)
 * @property {{promptTokens:number, completionTokens:number, totalTokens:number}|null} usage
 * @property {number|null} wallClockMs
 * @property {{level:'info'|'warn'|'error', message:string}|null} logEntry
 */

/**
 * Base class for pipeline stages. Subclasses MUST override `execute()`.
 *
 * @example
 * class MyStage extends PipelineStage {
 *   get name() { return 'myStage'; }
 *   get description() { return 'Does something useful'; }
 *   async execute(input) {
 *     // ... do work ...
 *     return { data: result, usage: null, wallClockMs: 0, logEntry: null };
 *   }
 * }
 */
export class PipelineStage {
  /**
   * Short, stable identifier for the stage (e.g. 'extractClaims', 'verify').
   * Used as the key in cost accounting and log entries.
   * @returns {string}
   */
  get name() {
    throw new Error(`${this.constructor.name} must override get name()`);
  }

  /**
   * Human-readable description of what this stage does.
   * @returns {string}
   */
  get description() {
    throw new Error(`${this.constructor.name} must override get description()`);
  }

  /**
   * Execute the stage. Implementations must never throw — errors should be
   * returned as a logEntry with level 'error' and partial/empty data.
   *
   * @param {*} input   stage-specific input
   * @returns {Promise<StageResult>}
   */
  async execute(/* input */) {
    throw new Error(`${this.constructor.name} must override execute()`);
  }

  /**
   * Validate that an input object has the shape this stage expects.
   * Returns null if valid, or a string describing what's wrong.
   * Default implementation accepts anything.
   *
   * @param {*} input
   * @returns {string|null}
   */
  validateInput(/* input */) {
    return null;
  }
}

/**
 * Validate that an object satisfies the PipelineStage interface at runtime.
 * Useful in tests and when wiring stages into the orchestrator dynamically.
 *
 * @param {*} obj
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStageInterface(obj) {
  const errors = [];

  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['not an object'] };
  }

  // Check required properties. Use try/catch to handle abstract getters
  // that throw when not overridden (e.g. PipelineStage base class).
  try {
    const name = obj.name;
    if (typeof name !== 'string' || name.length === 0) {
      errors.push('name must be a non-empty string');
    }
  } catch {
    errors.push('name getter threw — subclass must override get name()');
  }

  try {
    const desc = obj.description;
    if (typeof desc !== 'string' || desc.length === 0) {
      errors.push('description must be a non-empty string');
    }
  } catch {
    errors.push('description getter threw — subclass must override get description()');
  }

  if (typeof obj.execute !== 'function') {
    errors.push('execute must be a function');
  }

  if (typeof obj.validateInput !== 'function') {
    errors.push('validateInput must be a function');
  }

  return { valid: errors.length === 0, errors };
}
