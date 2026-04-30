/**
 * Phase 4 reducer tests for the rigor field.
 *
 * The Phase 1 plumbing relies on three properties of the reducer:
 *
 *   - rigor lands on initialState as 'machine' (the protocol-safe default
 *     so any handler that misses a rigor read still gets the strict path).
 *   - SET_FIELD can move rigor between values (the toggle's only writer).
 *   - RESET restores rigor to 'machine' along with the rest of the
 *     pipeline state, so a Reset always lands the next run on Machine
 *     unless the user explicitly toggles it again.
 *   - RUN_IMPORT (rehydrateFromRun) restores the rigor the run was
 *     originally produced under, falling back to 'machine' for runs
 *     exported before Phase 1 existed.
 */

import { describe, it, expect } from 'vitest';
import { reducer, initialState } from './useMarketReducer.js';
import { createRun } from '../types/run.js';
import { DEFAULT_REVIEW_MODEL_IDS } from '../constants/models.js';

describe('useMarketReducer rigor field', () => {
  it('initialState defaults rigor to machine', () => {
    expect(initialState.rigor).toBe('machine');
  });

  it('SET_FIELD updates rigor to human', () => {
    const next = reducer(initialState, { type: 'SET_FIELD', field: 'rigor', value: 'human' });
    expect(next.rigor).toBe('human');
  });

  it('SET_FIELD updates rigor back to machine', () => {
    const intermediate = reducer(initialState, { type: 'SET_FIELD', field: 'rigor', value: 'human' });
    const next = reducer(intermediate, { type: 'SET_FIELD', field: 'rigor', value: 'machine' });
    expect(next.rigor).toBe('machine');
  });

  it('RESET restores rigor to machine after a Human-mode run', () => {
    const human = reducer(initialState, { type: 'SET_FIELD', field: 'rigor', value: 'human' });
    expect(human.rigor).toBe('human');
    const reset = reducer(human, { type: 'RESET' });
    expect(reset.rigor).toBe('machine');
  });
});

describe('review council defaults', () => {
  it('starts with Gemini 3 Pro and Claude Opus 4.5 as the default council', () => {
    expect(initialState.reviewModels).toEqual([
      'google/gemini-3-pro-preview',
      'anthropic/claude-opus-4.5',
    ]);
    expect(DEFAULT_REVIEW_MODEL_IDS).toEqual(initialState.reviewModels);
  });

  it('adds GPT-5.2 as the third reviewer when expanding the council', () => {
    const next = reducer(initialState, { type: 'ADD_REVIEW_MODEL' });

    expect(next.reviewModels).toEqual([
      'google/gemini-3-pro-preview',
      'anthropic/claude-opus-4.5',
      'openai/gpt-5.2',
    ]);
  });

  it('adds Claude Sonnet 4 as the fourth reviewer when expanding again', () => {
    const three = reducer(initialState, { type: 'ADD_REVIEW_MODEL' });
    const four = reducer(three, { type: 'ADD_REVIEW_MODEL' });

    expect(four.reviewModels).toEqual([
      'google/gemini-3-pro-preview',
      'anthropic/claude-opus-4.5',
      'openai/gpt-5.2',
      'anthropic/claude-sonnet-4',
    ]);
  });

  it('still allows the council to be reduced to one manual reviewer', () => {
    const next = reducer(initialState, { type: 'REMOVE_REVIEW_MODEL', index: 1 });

    expect(next.reviewModels).toEqual(['google/gemini-3-pro-preview']);
  });
});

describe('RUN_IMPORT rehydrates rigor from the run artifact', () => {
  it('imports rigor=human from a run produced under Human mode', () => {
    const importedRun = {
      ...createRun({
        question: 'Q?',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        references: '',
        numberOfOutcomes: '',
        rigor: 'human',
      }),
    };
    const next = reducer(initialState, { type: 'RUN_IMPORT', run: importedRun });
    expect(next.rigor).toBe('human');
    expect(next.currentRun.input.rigor).toBe('human');
  });

  it('imports rigor=machine from a run produced under Machine mode', () => {
    const importedRun = createRun({
      question: 'Q?',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      references: '',
      numberOfOutcomes: '',
      rigor: 'machine',
    });
    const next = reducer(initialState, { type: 'RUN_IMPORT', run: importedRun });
    expect(next.rigor).toBe('machine');
  });

  it('falls back to rigor=machine when imported run input lacks rigor (older runs)', () => {
    // Simulate a run JSON exported before Phase 1 existed.
    const olderRun = createRun({
      question: 'Q?',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      references: '',
      numberOfOutcomes: '',
    });
    delete olderRun.input.rigor;
    const next = reducer(initialState, { type: 'RUN_IMPORT', run: olderRun });
    expect(next.rigor).toBe('machine');
  });
});
