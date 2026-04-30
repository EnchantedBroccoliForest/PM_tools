import { useReducer } from 'react';
import {
  DEFAULT_DRAFT_MODEL,
  DEFAULT_REVIEW_MODEL,
  DEFAULT_REVIEW_MODEL_IDS,
  REVIEW_MODEL_ADD_ORDER,
} from '../constants/models';
import { createRun } from '../types/run';

// Exported for direct testing of state transitions. Production code should
// continue to use `useMarketReducer()` below — this re-export only widens
// the surface for unit tests, it does not change the public hook.
export const initialState = {
  // Mode
  mode: 'draft', // 'draft' | 'review' | 'ideating'

  // Rigor governs prompt tone and the post-finalize humanizer:
  // 'machine' = full reviewer rigor, no humanizer pass.
  // 'human'   = softened reviewer prompts + humanizer applied to the final card.
  // Snapshotted onto the Run artifact at draft time so any mid-flow toggle
  // does not leak into stages that have already started.
  rigor: 'machine', // 'machine' | 'human'

  // Input
  question: '',
  startDate: '',
  endDate: '',
  references: '',
  // Optional hard restriction on the outcome-set cardinality. Stored as a
  // string because it comes straight from a text input; empty string means
  // "no restriction — let the drafter choose". When non-empty, every
  // drafter / reviewer / finalizer prompt receives it as a hard rule.
  numberOfOutcomes: '',
  selectedModel: DEFAULT_DRAFT_MODEL,
  reviewModels: [...DEFAULT_REVIEW_MODEL_IDS],
  humanReviewInput: '',
  pastedDraft: '',

  // Phase 2: aggregation protocol used when rolling up per-item reviewer
  // votes into Aggregation.overall. 'majority' | 'unanimity' | 'judge'.
  // 'judge' makes one extra LLM call using the first review model.
  aggregationProtocol: 'majority',

  // Ideating
  ideatingInput: '',
  ideatingModel: DEFAULT_DRAFT_MODEL,
  ideatingContent: null,

  // Processing
  loading: null, // null | 'draft' | 'review' | 'update' | 'accept' | 'early-resolution' | 'source-accessibility' | 'ideate'
  loadingMeta: null, // { models: string[], startTime: number } | null
  error: null,
  dateError: null,
  touchedFields: {
    question: false,
    startDate: false,
    endDate: false,
  },

  // Content
  draftContent: null,
  draftVersions: [],     // Array of { content, timestamp, source: 'draft' | 'pasted' | 'update' }
  viewingVersionIndex: 0, // Which version the user is currently viewing
  draftJustUpdated: false, // Transient flag to trigger scroll + flash after an update
  reviews: [],           // Array of { model, modelName, content }
  deliberatedReview: null, // Synthesized review after deliberation
  lastReviewConfig: null,  // { reviewModels: string[], aggregationProtocol: string } for the current reviews
  finalContent: null,
  hasUpdated: false,

  // Early-resolution gate (runs between Update and Finalize).
  // HIGH risk blocks Accept until the user explicitly acknowledges.
  earlyResolutionRisk: null,         // raw analyst text
  earlyResolutionRiskLevel: null,    // 'low' | 'medium' | 'high' | 'unknown' | null
  earlyResolutionAcknowledged: false,

  // Phase 5: routing-based Accept gate. Any `blocking` routing item (or
  // global blocker criticism) blocks finalize until the user explicitly
  // acknowledges that they accept the risk. Re-running the pipeline with
  // a fresh draft resets this to false.
  routingAcknowledged: false,

  // Pre-finalize data-source accessibility gate. Runs after the
  // early-resolution check and before Accept & Finalize: harvests the
  // specific data-source URLs referenced in the resolution rule and
  // probes each with a short no-cors fetch. Any unreachable source
  // blocks Accept until the user explicitly acknowledges (or re-runs
  // Update after fixing the sources).
  /** @type {import('../pipeline/checkSources').SourceCheckResult|null} */
  sourceAccessibility: null,
  sourceAccessibilityAcknowledged: false,

  // Phase 1: canonical Run artifact. Every handler that performs an LLM call
  // appends to this in parallel with the legacy view-state fields. The
  // view-state fields (draftContent, reviews, deliberatedReview, finalContent)
  // stay in place during Phase 1 so existing UI keeps working unchanged; in
  // later phases they become derived views of currentRun.
  /** @type {import('../types/run').Run|null} */
  currentRun: null,

  // UI
  copiedId: null,
  runTraceOpen: false,
};

function clearEarlyResolution(state) {
  return {
    ...state,
    earlyResolutionRisk: null,
    earlyResolutionRiskLevel: null,
    earlyResolutionAcknowledged: false,
    // Phase 5: a new draft always resets the routing acknowledgement so
    // the user has to re-confirm any surviving blocking claims.
    routingAcknowledged: false,
    // Source-accessibility gate is per-draft: a fresh draft invalidates
    // any prior reachability check and drops any prior acknowledgement.
    sourceAccessibility: null,
    sourceAccessibilityAcknowledged: false,
  };
}

export function reducer(state, action) {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };

    case 'SET_DATE': {
      return {
        ...state,
        [action.field]: action.value,
        dateError: action.dateError,
      };
    }

    case 'SET_DATE_ERROR':
      return { ...state, dateError: action.dateError ?? null };

    case 'TOUCH_FIELD':
      return {
        ...state,
        touchedFields: {
          ...state.touchedFields,
          [action.field]: true,
        },
      };

    case 'TOUCH_DRAFT_REQUIRED_FIELDS':
      return {
        ...state,
        touchedFields: {
          ...state.touchedFields,
          question: true,
          startDate: true,
          endDate: true,
        },
      };

    case 'ADD_REVIEW_MODEL':
      return {
        ...state,
        reviewModels: [
          ...state.reviewModels,
          REVIEW_MODEL_ADD_ORDER.find((id) => !state.reviewModels.includes(id)) || DEFAULT_REVIEW_MODEL,
        ],
      };

    case 'REMOVE_REVIEW_MODEL':
      if (state.reviewModels.length <= 1) return state;
      return {
        ...state,
        reviewModels: state.reviewModels.filter((_, i) => i !== action.index),
      };

    case 'SET_REVIEW_MODEL':
      return {
        ...state,
        reviewModels: state.reviewModels.map((m, i) =>
          i === action.index ? action.value : m
        ),
      };

    case 'START_LOADING':
      return {
        ...state,
        loading: action.phase,
        loadingMeta: { models: action.models || [], startTime: Date.now() },
        error: null,
      };

    case 'STOP_LOADING':
      return { ...state, loading: null, loadingMeta: null };

    case 'SET_ERROR':
      return { ...state, loading: null, loadingMeta: null, error: action.error };

    case 'SUBMIT_PASTED_DRAFT':
      return clearEarlyResolution({
        ...state,
        draftContent: action.content,
        draftVersions: [{ content: action.content, timestamp: Date.now(), source: 'pasted' }],
        viewingVersionIndex: 0,
        draftJustUpdated: false,
        reviews: [],
        deliberatedReview: null,
        lastReviewConfig: null,
        humanReviewInput: '',
        finalContent: null,
        hasUpdated: false,
      });

    case 'DRAFT_SUCCESS':
      return clearEarlyResolution({
        ...state,
        loading: null,
        loadingMeta: null,
        draftContent: action.content,
        draftVersions: [{ content: action.content, timestamp: Date.now(), source: 'draft' }],
        viewingVersionIndex: 0,
        draftJustUpdated: false,
        reviews: [],
        deliberatedReview: null,
        lastReviewConfig: null,
        humanReviewInput: '',
        finalContent: null,
        hasUpdated: false,
      });

    case 'REVIEW_SUCCESS':
      return {
        ...state,
        loading: null,
        loadingMeta: null,
        reviews: action.reviews,
        deliberatedReview: action.deliberatedReview || null,
        lastReviewConfig: action.reviewConfig || null,
      };

    case 'UPDATE_SUCCESS': {
      // Clear stale risk from any previous update; handleUpdate immediately
      // chains into START_EARLY_RESOLUTION to recompute against the new draft.
      const newVersions = [
        ...state.draftVersions,
        { content: action.content, timestamp: Date.now(), source: 'update' },
      ];
      return clearEarlyResolution({
        ...state,
        loading: null,
        loadingMeta: null,
        draftContent: action.content,
        draftVersions: newVersions,
        viewingVersionIndex: newVersions.length - 1,
        draftJustUpdated: true,
        hasUpdated: true,
      });
    }

    case 'SET_VIEWING_VERSION':
      return { ...state, viewingVersionIndex: action.index };

    case 'CLEAR_DRAFT_JUST_UPDATED':
      return { ...state, draftJustUpdated: false };

    case 'FINALIZE_SUCCESS':
      return { ...state, loading: null, loadingMeta: null, finalContent: action.content };

    case 'IDEATE_SUCCESS':
      return { ...state, loading: null, loadingMeta: null, ideatingContent: action.content };

    case 'USE_IDEA_FOR_DRAFT':
      // Switch to Draft Market mode and populate the question, references,
      // and dates from an ideate suggestion so the user can immediately
      // refine and draft. Dates are derived from the idea's suggested
      // timeframe (start defaults to tomorrow, end from the timeframe text).
      // Use ?? (not ||) so that missing payload dates preserve any
      // user-entered values rather than silently wiping them to ''.
      return {
        ...state,
        mode: 'draft',
        question: action.question || '',
        references: action.references || '',
        startDate: action.startDate ?? state.startDate,
        endDate: action.endDate ?? state.endDate,
        dateError: null,
        touchedFields: {
          question: false,
          startDate: false,
          endDate: false,
        },
        error: null,
      };

    case 'START_EARLY_RESOLUTION':
      return {
        ...state,
        loading: 'early-resolution',
        loadingMeta: { models: action.models || [], startTime: Date.now() },
        earlyResolutionRisk: null,
        earlyResolutionRiskLevel: null,
        earlyResolutionAcknowledged: false,
      };

    case 'EARLY_RESOLUTION_SUCCESS':
      return {
        ...state,
        loading: null,
        loadingMeta: null,
        earlyResolutionRisk: action.content,
        earlyResolutionRiskLevel: action.level,
        earlyResolutionAcknowledged: false,
      };

    case 'EARLY_RESOLUTION_ERROR':
      // Treat analysis failure as 'unknown' so the gate does NOT block finalize
      // (we only block on confirmed HIGH risk); surface the error in the UI.
      return {
        ...state,
        loading: null,
        loadingMeta: null,
        earlyResolutionRisk: `Early resolution analysis failed: ${action.error}`,
        earlyResolutionRiskLevel: 'unknown',
        earlyResolutionAcknowledged: false,
      };

    case 'ACKNOWLEDGE_EARLY_RESOLUTION':
      return { ...state, earlyResolutionAcknowledged: true };

    case 'START_SOURCE_ACCESSIBILITY':
      return {
        ...state,
        loading: 'source-accessibility',
        loadingMeta: { models: [], startTime: Date.now() },
        sourceAccessibility: null,
        sourceAccessibilityAcknowledged: false,
      };

    case 'SOURCE_ACCESSIBILITY_SUCCESS':
      return {
        ...state,
        loading: null,
        loadingMeta: null,
        sourceAccessibility: action.result,
        sourceAccessibilityAcknowledged: false,
      };

    case 'SOURCE_ACCESSIBILITY_ERROR':
      return {
        ...state,
        loading: null,
        loadingMeta: null,
        sourceAccessibility: {
          status: 'error',
          sources: [],
          checkedAt: Date.now(),
          wallClockMs: 0,
          error: action.error,
          logEntry: {
            level: 'error',
            message: `Source accessibility: ${action.error}`,
          },
        },
        // Errors do NOT block Accept — we only block on confirmed
        // unreachable sources. The UI surfaces the error message.
        sourceAccessibilityAcknowledged: false,
      };

    case 'ACKNOWLEDGE_SOURCE_ACCESSIBILITY':
      return { ...state, sourceAccessibilityAcknowledged: true };

    // ----- Phase 1: Run artifact plumbing ------------------------------
    //
    // Every RUN_* action operates on state.currentRun. They are additive to
    // the legacy view-state fields above (draftContent, reviews, ...) so
    // that ignoring the Run panel leaves the UI unchanged.

    case 'RUN_START':
      // Starts a fresh run from the current input. Called at the top of
      // handleDraft. Clears any previous run in progress.
      return { ...state, currentRun: createRun(action.input) };

    case 'RUN_APPEND_DRAFT': {
      if (!state.currentRun) return state;
      const draft = {
        model: action.model,
        content: action.content,
        timestamp: Date.now(),
        kind: action.kind || 'initial', // 'initial' | 'updated'
      };
      return {
        ...state,
        currentRun: {
          ...state.currentRun,
          drafts: [...state.currentRun.drafts, draft],
        },
      };
    }

    case 'RUN_APPEND_CRITICISMS': {
      if (!state.currentRun) return state;
      // Accepts an array of Criticism objects; replaces nothing, only appends.
      return {
        ...state,
        currentRun: {
          ...state.currentRun,
          criticisms: [...state.currentRun.criticisms, ...(action.criticisms || [])],
        },
      };
    }

    case 'RUN_SET_CLAIMS': {
      if (!state.currentRun) return state;
      // Claims are replaced (not appended) — the latest draft's claim set
      // is the canonical one for downstream verifiers.
      return {
        ...state,
        currentRun: {
          ...state.currentRun,
          claims: action.claims || [],
        },
      };
    }

    case 'RUN_SET_AGGREGATION': {
      if (!state.currentRun) return state;
      return {
        ...state,
        currentRun: {
          ...state.currentRun,
          aggregation: action.aggregation || null,
        },
      };
    }

    case 'RUN_SET_VERIFICATION': {
      if (!state.currentRun) return state;
      return {
        ...state,
        currentRun: {
          ...state.currentRun,
          verification: action.verification || [],
        },
      };
    }

    case 'RUN_SET_EVIDENCE': {
      if (!state.currentRun) return state;
      // Evidence is replaced wholesale — the harvester is deterministic on
      // the current references + claims and there is no value in appending
      // stale URLs from a previous extraction round.
      return {
        ...state,
        currentRun: {
          ...state.currentRun,
          evidence: action.evidence || [],
        },
      };
    }

    case 'RUN_SET_ROUTING': {
      if (!state.currentRun) return state;
      // Routing is fully derived from claims + verification + criticisms,
      // so we replace it wholesale every time any of those inputs change.
      // Recomputing routing also resets any prior acknowledgement — if the
      // user had acked a blocking set and then ran review/update again,
      // the fresh routing might have new blockers they haven't seen.
      return {
        ...state,
        currentRun: {
          ...state.currentRun,
          routing: action.routing || null,
        },
        routingAcknowledged: false,
      };
    }

    case 'ACKNOWLEDGE_ROUTING':
      return { ...state, routingAcknowledged: true };

    case 'RUN_SET_FINAL': {
      if (!state.currentRun) return state;
      return {
        ...state,
        currentRun: {
          ...state.currentRun,
          finalJson: action.finalJson || null,
        },
      };
    }

    case 'RUN_LOG': {
      if (!state.currentRun) return state;
      const entry = {
        stage: action.stage || 'unknown',
        level: action.level || 'info',
        message: action.message || '',
        ts: Date.now(),
      };
      return {
        ...state,
        currentRun: {
          ...state.currentRun,
          log: [...state.currentRun.log, entry],
        },
      };
    }

    case 'RUN_COST': {
      if (!state.currentRun) return state;
      // Accumulate token and wall-clock totals for a named stage. Callers
      // pass { stage, tokensIn, tokensOut, wallClockMs }.
      const prev = state.currentRun.cost;
      const stage = action.stage || 'unknown';
      const tokensIn = Number(action.tokensIn) || 0;
      const tokensOut = Number(action.tokensOut) || 0;
      const wallClockMs = Number(action.wallClockMs) || 0;
      const stageTotal = (prev.byStage[stage] || 0) + tokensIn + tokensOut;
      return {
        ...state,
        currentRun: {
          ...state.currentRun,
          cost: {
            totalTokensIn: prev.totalTokensIn + tokensIn,
            totalTokensOut: prev.totalTokensOut + tokensOut,
            wallClockMs: prev.wallClockMs + wallClockMs,
            byStage: { ...prev.byStage, [stage]: stageTotal },
          },
        },
      };
    }

    case 'RUN_EXPORT':
      // The actual file download is a side effect performed by the click
      // handler; this action exists so the run trace can log that an
      // export happened (useful when debugging a Run the user has sent
      // in a bug report).
      if (!state.currentRun) return state;
      return {
        ...state,
        currentRun: {
          ...state.currentRun,
          log: [
            ...state.currentRun.log,
            { stage: 'export', level: 'info', message: 'Run exported to JSON.', ts: Date.now() },
          ],
        },
      };

    case 'RUN_IMPORT':
      // Replaces the entire current run with a validated import. The view
      // fields (draftContent, reviews, finalContent) are also rebuilt so
      // the main UI reflects the imported run without a page reload.
      return rehydrateFromRun(state, action.run);

    case 'TOGGLE_RUN_TRACE':
      return { ...state, runTraceOpen: !state.runTraceOpen };

    case 'RESET':
      return initialState;

    case 'SET_COPIED':
      return { ...state, copiedId: action.id };

    default:
      return state;
  }
}

/**
 * Rebuild the legacy view-state fields from a freshly imported Run. This is
 * what makes the round-trip acceptance criterion work: exporting then
 * re-importing a run renders the same UI as the original.
 */
function rehydrateFromRun(state, run) {
  if (!run) return state;
  const drafts = run.drafts || [];
  const lastDraft = drafts.length > 0 ? drafts[drafts.length - 1] : null;
  const hasUpdated = drafts.some((d) => d.kind === 'updated');
  return {
    ...state,
    currentRun: run,
    // Surface the input fields so the Draft Market form shows the same values.
    question: run.input?.question || '',
    startDate: run.input?.startDate || '',
    endDate: run.input?.endDate || '',
    references: run.input?.references || '',
    numberOfOutcomes: run.input?.numberOfOutcomes || '',
    rigor: run.input?.rigor || 'machine',
    // View-state rebuild. Criticisms/aggregation are Phase 2 concerns so we
    // don't try to map them back to the legacy `reviews[]` shape here — the
    // run-trace panel is the authoritative view of imported runs. The main
    // UI still renders the latest draft and final JSON.
    draftContent: lastDraft ? lastDraft.content : null,
    draftVersions: drafts.map((d) => ({
      content: d.content,
      timestamp: d.timestamp || 0,
      source: d.kind === 'updated' ? 'update' : 'draft',
    })),
    viewingVersionIndex: Math.max(0, drafts.length - 1),
    draftJustUpdated: false,
    reviews: [],
    deliberatedReview: null,
    lastReviewConfig: null,
    finalContent: run.finalJson || null,
    hasUpdated,
    // Early-resolution gate is not persisted across export/import; imported
    // runs start with the gate cleared.
    earlyResolutionRisk: null,
    earlyResolutionRiskLevel: null,
    earlyResolutionAcknowledged: false,
    // Source-accessibility gate is also not persisted; an imported run has
    // to be re-checked if the user wants the gate to gate Accept.
    sourceAccessibility: null,
    sourceAccessibilityAcknowledged: false,
    touchedFields: {
      question: false,
      startDate: false,
      endDate: false,
    },
  };
}

export function useMarketReducer() {
  return useReducer(reducer, initialState);
}
