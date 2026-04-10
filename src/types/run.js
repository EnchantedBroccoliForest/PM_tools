/**
 * Run artifact schema.
 *
 * A Run is the canonical, claim-level record of everything the PM_tools
 * pipeline produces for one market-drafting session: drafts, criticisms,
 * claims, evidence, verification results, aggregation decisions, final JSON,
 * cost accounting, and a structured event log.
 *
 * Later phases hang rigor features off of these structures: Phase 2 populates
 * Aggregation, Phase 3 populates Verification, Phase 4 populates Evidence,
 * Phase 5 reads claim uncertainty to route, Phase 6 diffs runs across
 * ablations. Phase 1 only needs to build the skeleton without changing
 * observable behaviour.
 *
 * JSDoc typedefs are the source of truth for the types; zod schemas below
 * mirror them and are used for parse-time validation (LLM JSON output in
 * Phase 1, imported run files via the Run trace panel).
 */

import { z } from 'zod';

// ------------------------------------------------------------------ typedefs

/**
 * @typedef {Object} Claim
 * @property {string} id                  stable id, e.g. "claim.outcome.0.resolutionCriteria"
 * @property {'question'|'outcome_win'|'outcome_criterion'|'edge_case'|'source'|'timestamp'|'threshold'|'other'} category
 * @property {string} text                the atomic claim, one sentence
 * @property {string[]} sourceRefs        ids into evidence[] (populated in Phase 3)
 */

/**
 * @typedef {Object} Criticism
 * @property {string} id
 * @property {string} reviewerModel
 * @property {string} claimId             which claim this targets (or 'global')
 * @property {'blocker'|'major'|'minor'|'nit'} severity
 * @property {'mece'|'objectivity'|'source'|'timing'|'ambiguity'|'manipulation'|'atomicity'|'other'} category
 * @property {string} rationale
 */

/**
 * @typedef {Object} Vote
 * @property {string} reviewerModel
 * @property {'yes'|'no'|'unsure'} verdict
 * @property {string} rationale
 */

/**
 * @typedef {Object} ChecklistItem
 * @property {string} id                  e.g. "mece", "objective_source"
 * @property {string} question
 * @property {Vote[]} votes
 * @property {'pass'|'fail'|'escalate'} decision
 */

/**
 * @typedef {Object} Aggregation
 * @property {'majority'|'unanimity'|'judge'} protocol
 * @property {ChecklistItem[]} checklist
 * @property {string|null} judgeRationale  only for protocol === 'judge'
 * @property {'pass'|'fail'|'needs_escalation'} overall
 */

/**
 * @typedef {Object} Verification
 * @property {string} claimId
 * @property {'entailed'|'contradicted'|'not_covered'|'not_applicable'} entailment
 * @property {number|null} consistencyScore  SelfCheckGPT-style, 0..1, higher = more consistent
 * @property {string|null} toolOutput
 * @property {boolean} citationResolves
 * @property {'pass'|'soft_fail'|'hard_fail'} verdict
 */

/**
 * @typedef {Object} RunCost
 * @property {number} totalTokensIn
 * @property {number} totalTokensOut
 * @property {number} wallClockMs
 * @property {Object<string, number>} byStage  per-stage token totals (in+out)
 */

/**
 * @typedef {Object} DraftRecord
 * @property {string} model
 * @property {string} content
 * @property {number} timestamp
 * @property {'initial'|'updated'} kind
 */

/**
 * @typedef {Object} LogEntry
 * @property {string} stage
 * @property {'info'|'warn'|'error'} level
 * @property {string} message
 * @property {number} ts
 */

/**
 * @typedef {Object} Evidence
 * @property {string} id
 * @property {string} claimId
 * @property {string} url
 * @property {string} title
 * @property {string} excerpt
 * @property {number} fetchedAt
 * @property {number} rank
 */

/**
 * @typedef {Object} Run
 * @property {string} runId
 * @property {number} startedAt
 * @property {{question:string, startDate:string, endDate:string, references:string}} input
 * @property {DraftRecord[]} drafts
 * @property {Criticism[]} criticisms
 * @property {Claim[]} claims
 * @property {Evidence[]} evidence
 * @property {Verification[]} verification
 * @property {Aggregation|null} aggregation
 * @property {Object|null} finalJson
 * @property {RunCost} cost
 * @property {LogEntry[]} log
 */

// ------------------------------------------------------------------- schemas

export const ClaimCategoryEnum = z.enum([
  'question',
  'outcome_win',
  'outcome_criterion',
  'edge_case',
  'source',
  'timestamp',
  'threshold',
  'other',
]);

export const ClaimSchema = z.object({
  id: z.string().min(1),
  category: ClaimCategoryEnum,
  text: z.string().min(1),
  sourceRefs: z.array(z.string()).default([]),
});

export const ClaimArraySchema = z.array(ClaimSchema);

export const CriticismSchema = z.object({
  id: z.string(),
  reviewerModel: z.string(),
  claimId: z.string(),
  severity: z.enum(['blocker', 'major', 'minor', 'nit']),
  category: z.enum([
    'mece',
    'objectivity',
    'source',
    'timing',
    'ambiguity',
    'manipulation',
    'atomicity',
    'other',
  ]),
  rationale: z.string(),
});

export const VoteSchema = z.object({
  reviewerModel: z.string(),
  verdict: z.enum(['yes', 'no', 'unsure']),
  rationale: z.string(),
});

export const ChecklistItemSchema = z.object({
  id: z.string(),
  question: z.string(),
  votes: z.array(VoteSchema),
  decision: z.enum(['pass', 'fail', 'escalate']),
});

export const AggregationSchema = z.object({
  protocol: z.enum(['majority', 'unanimity', 'judge']),
  checklist: z.array(ChecklistItemSchema),
  judgeRationale: z.string().nullable(),
  overall: z.enum(['pass', 'fail', 'needs_escalation']),
});

export const VerificationSchema = z.object({
  claimId: z.string(),
  entailment: z.enum(['entailed', 'contradicted', 'not_covered', 'not_applicable']),
  consistencyScore: z.number().min(0).max(1).nullable(),
  toolOutput: z.string().nullable(),
  citationResolves: z.boolean(),
  verdict: z.enum(['pass', 'soft_fail', 'hard_fail']),
});

export const EvidenceSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  url: z.string(),
  title: z.string(),
  excerpt: z.string(),
  fetchedAt: z.number(),
  rank: z.number(),
});

export const RunCostSchema = z.object({
  totalTokensIn: z.number(),
  totalTokensOut: z.number(),
  wallClockMs: z.number(),
  byStage: z.record(z.string(), z.number()),
});

export const DraftRecordSchema = z.object({
  model: z.string(),
  content: z.string(),
  timestamp: z.number(),
  kind: z.enum(['initial', 'updated']),
});

export const LogEntrySchema = z.object({
  stage: z.string(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
  ts: z.number(),
});

export const RunSchema = z.object({
  runId: z.string(),
  startedAt: z.number(),
  input: z.object({
    question: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    references: z.string(),
  }),
  drafts: z.array(DraftRecordSchema),
  criticisms: z.array(CriticismSchema),
  claims: z.array(ClaimSchema),
  evidence: z.array(EvidenceSchema),
  verification: z.array(VerificationSchema),
  aggregation: AggregationSchema.nullable(),
  finalJson: z.record(z.string(), z.unknown()).nullable(),
  cost: RunCostSchema,
  log: z.array(LogEntrySchema),
});

// ------------------------------------------------------------------ factories

/**
 * Cheap, collision-resistant-enough run id. Crypto random would be better,
 * but for client-side runs indexed by human inspection this is sufficient.
 */
function generateRunId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `run_${ts}_${rand}`;
}

/**
 * Create an empty cost record. `byStage` is a plain object that accumulates
 * token totals per named stage (draft / review / update / accept / etc).
 * @returns {RunCost}
 */
export function createEmptyCost() {
  return {
    totalTokensIn: 0,
    totalTokensOut: 0,
    wallClockMs: 0,
    byStage: {},
  };
}

/**
 * Construct a fresh Run from the drafting inputs.
 * @param {{question:string, startDate:string, endDate:string, references:string}} input
 * @returns {Run}
 */
export function createRun(input) {
  return {
    runId: generateRunId(),
    startedAt: Date.now(),
    input: {
      question: input?.question || '',
      startDate: input?.startDate || '',
      endDate: input?.endDate || '',
      references: input?.references || '',
    },
    drafts: [],
    criticisms: [],
    claims: [],
    evidence: [],
    verification: [],
    aggregation: null,
    finalJson: null,
    cost: createEmptyCost(),
    log: [],
  };
}

/**
 * Parse a previously-exported run from arbitrary JSON input. Returns the
 * validated Run on success or null on failure — callers typically want to
 * display a toast if the return is null rather than crashing the UI.
 * @param {unknown} raw
 * @returns {Run|null}
 */
export function parseRun(raw) {
  const result = RunSchema.safeParse(raw);
  return result.success ? result.data : null;
}
