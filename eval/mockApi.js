/**
 * Deterministic mock LLM for the Phase 6 regression harness.
 *
 * The eval runner calls `installQueryModel(createMockQueryModel(fixture))`
 * before stepping through the pipeline. Every subsequent `queryModel` call
 * made by the pipeline modules — draft, claim extraction, structured
 * review, judge aggregation, entailment verification, risk analysis,
 * finalize — is routed to the mock instead of the real OpenRouter API.
 *
 * The mock decides what to return by matching the system prompt against
 * the canonical strings in `SYSTEM_PROMPTS`. Each system-prompt "role"
 * gets its own handler that pulls pre-canned content out of the fixture:
 *
 *   fixture.mockResponses.draft         → drafter's first call (initial)
 *   fixture.mockResponses.updatedDraft  → drafter's second call (update)
 *   fixture.mockResponses.claims        → claim extractor (JSON array)
 *   fixture.mockResponses.reviews[n]    → structured reviewer (cycled by call)
 *   fixture.mockResponses.judgeDecision → judge aggregator (object)
 *   fixture.mockResponses.entailment    → entailment verifier (array)
 *   fixture.mockResponses.risk          → early resolution analyst (string)
 *   fixture.mockResponses.finalJson     → finalizer (object)
 *
 * The mock also keeps per-role call counters so it can differentiate the
 * drafter's initial call from its update call (both use the same system
 * prompt) and cycle through multiple canned reviews.
 *
 * Token counts and wall-clock times are synthesised deterministically so
 * the eval harness can compute a stable cost snapshot. They are not real
 * counts — the point is that they change predictably when ablations
 * remove or add pipeline stages.
 *
 * Unknown prompts fall through to a safe empty response + a warn log so
 * the pipeline never crashes on a fixture that forgot to define one of
 * the mock fields. Missing fields are logged and counted in the
 * `missingFields` set exposed on the returned mock object.
 */

import { SYSTEM_PROMPTS } from '../src/constants/prompts.js';

/**
 * Cheap, deterministic token-count estimator. The harness doesn't need
 * real BPE counts; it needs numbers that scale with input length and are
 * reproducible across runs so the baseline snapshot is stable.
 */
function estimateTokens(text) {
  if (typeof text !== 'string') return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function tokensFromMessages(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m?.content || '');
  }
  return total;
}

/**
 * Build a ModelResult envelope matching the shape the real client returns.
 */
function buildResult(content, messages) {
  const promptTokens = tokensFromMessages(messages);
  const completionTokens = estimateTokens(content);
  return {
    content,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
    // Deterministic wall-clock: 1ms per 200 characters of output, min 1ms.
    // This keeps the baseline snapshot stable without hard-coding zero.
    wallClockMs: Math.max(1, Math.ceil(content.length / 200)),
  };
}

/**
 * Serialize a JS value the way the real LLM would emit it: bare JSON, no
 * markdown fences. The pipeline parsers strip fences too, but keeping the
 * mock output fence-free tests the happy path.
 */
function toJson(value) {
  return JSON.stringify(value, null, 2);
}

/**
 * Create a mock queryModel bound to a single fixture. The returned
 * function is the installQueryModel target; the returned metadata
 * (callsByRole, missingFields) is exposed on the function as properties
 * so the harness can inspect it without capturing closures.
 *
 * @param {object} fixture  the loaded fixture JSON
 * @param {object} [options]
 * @param {(warning:string) => void} [options.onWarn]  invoked on missing fields or unknown prompts
 * @returns {(model:string, messages:Array, options?:object) => Promise<object>}
 */
export function createMockQueryModel(fixture, { onWarn } = {}) {
  const mock = fixture?.mockResponses || {};
  const callsByRole = {
    drafter: 0,
    claimExtractor: 0,
    structuredReviewer: 0,
    aggregationJudge: 0,
    entailmentVerifier: 0,
    earlyResolutionAnalyst: 0,
    finalizer: 0,
    reviewer: 0,
    ideator: 0,
    unknown: 0,
  };
  const missingFields = new Set();
  const reportMissing = (field, fallback) => {
    missingFields.add(field);
    if (onWarn) onWarn(`mock: fixture ${fixture?.id} is missing mockResponses.${field}; using fallback`);
    return fallback;
  };

  function classify(systemPrompt) {
    if (typeof systemPrompt !== 'string') return 'unknown';
    // Phase 4: try the Machine bucket first (the canonical role set;
    // any fixture captured pre-rigor was produced under Machine), then
    // fall back to Human on miss. The fallback exists so an ad-hoc
    // eval run under `--rigor=human` (Phase 5) doesn't return empty
    // for every call when Human prompts diverge from Machine. For the
    // committed fixtures, which always run under Machine, only the
    // first pass ever fires.
    const machineEntries = Object.entries(SYSTEM_PROMPTS.machine);
    for (const [role, value] of machineEntries) {
      if (systemPrompt === value) return role;
    }
    const humanEntries = Object.entries(SYSTEM_PROMPTS.human);
    for (const [role, value] of humanEntries) {
      if (systemPrompt === value) return role;
    }
    return 'unknown';
  }

  async function mockQueryModel(model, messages /* options unused in mock */) {
    const systemPrompt = Array.isArray(messages) && messages[0]?.role === 'system'
      ? messages[0].content
      : '';
    const role = classify(systemPrompt);
    callsByRole[role] = (callsByRole[role] || 0) + 1;

    switch (role) {
      case 'drafter': {
        // First call is the initial draft; second and later are updates.
        // The drafter is also used by the deliberation pass, but the
        // eval harness runs reviews through the structured reviewer path
        // only, so we won't see deliberation calls here.
        if (callsByRole.drafter === 1) {
          const content = mock.draft || reportMissing('draft', '(empty draft)');
          return buildResult(content, messages);
        }
        const content = mock.updatedDraft || mock.draft || reportMissing('updatedDraft', '(empty updated draft)');
        return buildResult(content, messages);
      }

      case 'claimExtractor': {
        // Claim extractor expects a JSON array of claims. If the fixture
        // didn't supply one, return an empty array — the pipeline will
        // fall back to empty-claim mode and the fixture's expected
        // properties should encode that.
        const claims = Array.isArray(mock.claims) ? mock.claims : reportMissing('claims', []);
        return buildResult(toJson(claims), messages);
      }

      case 'structuredReviewer': {
        const reviews = Array.isArray(mock.reviews) ? mock.reviews : null;
        if (!reviews || reviews.length === 0) {
          const fallback = {
            reviewProse: reportMissing('reviews', '(no review)'),
            rubricVotes: [],
            criticisms: [],
          };
          return buildResult(toJson(fallback), messages);
        }
        // Cycle through the reviews list so multi-reviewer runs see
        // different critiques. One-off fixtures typically supply a
        // single review which gets returned for every reviewer.
        const idx = (callsByRole.structuredReviewer - 1) % reviews.length;
        return buildResult(toJson(reviews[idx]), messages);
      }

      case 'aggregationJudge': {
        const judge = mock.judgeDecision || reportMissing('judgeDecision', {
          perItemDecisions: [],
          overall: 'needs_escalation',
          rationale: '(mock fallback — no judgeDecision configured)',
        });
        return buildResult(toJson(judge), messages);
      }

      case 'entailmentVerifier': {
        const entailment = Array.isArray(mock.entailment)
          ? mock.entailment
          : reportMissing('entailment', []);
        return buildResult(toJson(entailment), messages);
      }

      case 'earlyResolutionAnalyst': {
        // Accept either a prebuilt string or a risk level keyword. The
        // pipeline parses the first line against "Risk rating: Low/Medium/High".
        let content = mock.risk;
        if (!content) {
          content = reportMissing('risk', 'Risk rating: Unknown\n(no risk analysis configured)');
        } else if (typeof content === 'string' && !/^risk rating/i.test(content)) {
          content = `Risk rating: ${content}\n(synthetic mock)`;
        }
        return buildResult(content, messages);
      }

      case 'finalizer': {
        const finalJson = mock.finalJson || reportMissing('finalJson', {
          refinedQuestion: '(mock fallback)',
          outcomes: [],
          marketStartTimeUTC: '',
          marketEndTimeUTC: '',
          shortDescription: '',
          fullResolutionRules: '',
          edgeCases: '',
        });
        return buildResult(toJson(finalJson), messages);
      }

      case 'reviewer': {
        // The legacy reviewer / deliberation path is still reachable when
        // the aggregator runs and there are 2+ reviewers. Return a
        // trivial deliberation string so the pipeline doesn't crash;
        // the eval harness drives the structured path regardless.
        return buildResult(mock.deliberation || 'Deliberation: (mock)', messages);
      }

      case 'ideator': {
        return buildResult(mock.ideation || '(mock ideator output)', messages);
      }

      case 'unknown':
      default: {
        if (onWarn) onWarn(`mock: unrecognised system prompt for fixture ${fixture?.id}`);
        return buildResult('{}', messages);
      }
    }
  }

  mockQueryModel.callsByRole = callsByRole;
  mockQueryModel.missingFields = missingFields;
  return mockQueryModel;
}

/**
 * Build a fetch-compatible mock used by `gatherEvidence` for URL
 * reachability probes. The mock consults a `{url: true|false}` map
 * defined on the fixture (`mockResponses.urlResolves`). Any URL not in
 * the map resolves to "reachable" by default so fixtures that don't care
 * about citation integrity aren't forced to enumerate every URL.
 *
 * The fetch contract that `resolveCitation` relies on is minimal: it
 * just awaits the promise; a successful resolve (even with an opaque
 * body) counts as reachable, a rejection counts as unreachable. We
 * implement both paths.
 *
 * @param {object} fixture
 * @returns {typeof fetch}
 */
export function createMockFetch(fixture) {
  const map = fixture?.mockResponses?.urlResolves || {};
  return async function mockFetch(url /* options ignored */) {
    // Look up the URL verbatim first. Fall back to a substring match so
    // fixtures can specify a host prefix like "https://fake.invalid"
    // and catch every URL under it.
    let verdict;
    if (Object.prototype.hasOwnProperty.call(map, url)) {
      verdict = map[url];
    } else {
      verdict = true; // default: assume reachable
      for (const [key, value] of Object.entries(map)) {
        if (url.startsWith(key)) {
          verdict = value;
          break;
        }
      }
    }
    if (verdict === false) {
      throw new TypeError(`mock fetch: ${url} intentionally unreachable`);
    }
    return {
      ok: true,
      status: 200,
      type: 'opaque',
    };
  };
}
