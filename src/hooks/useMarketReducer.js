import { useReducer } from 'react';
import { DEFAULT_DRAFT_MODEL, DEFAULT_REVIEW_MODEL } from '../constants/models';

const initialState = {
  // Mode
  mode: 'draft', // 'draft' | 'review' | 'ideating'

  // Input
  question: '',
  startDate: '',
  endDate: '',
  references: '',
  selectedModel: DEFAULT_DRAFT_MODEL,
  reviewModels: [DEFAULT_REVIEW_MODEL],
  humanReviewInput: '',
  pastedDraft: '',

  // Ideating
  ideatingInput: '',
  ideatingModel: DEFAULT_DRAFT_MODEL,
  ideatingContent: null,

  // Processing
  loading: null, // null | 'draft' | 'review' | 'update' | 'accept' | 'early-resolution' | 'ideate'
  loadingMeta: null, // { models: string[], startTime: number } | null
  error: null,
  dateError: null,

  // Content
  draftContent: null,
  reviews: [],           // Array of { model, modelName, content }
  deliberatedReview: null, // Synthesized review after deliberation
  finalContent: null,
  hasUpdated: false,

  // Early-resolution gate (runs between Update and Finalize).
  // HIGH risk blocks Accept until the user explicitly acknowledges.
  earlyResolutionRisk: null,         // raw analyst text
  earlyResolutionRiskLevel: null,    // 'low' | 'medium' | 'high' | 'unknown' | null
  earlyResolutionAcknowledged: false,

  // UI
  copiedId: null,
};

function clearEarlyResolution(state) {
  return {
    ...state,
    earlyResolutionRisk: null,
    earlyResolutionRiskLevel: null,
    earlyResolutionAcknowledged: false,
  };
}

function reducer(state, action) {
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

    case 'ADD_REVIEW_MODEL':
      return {
        ...state,
        reviewModels: [...state.reviewModels, DEFAULT_REVIEW_MODEL],
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
        reviews: [],
        deliberatedReview: null,
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
        reviews: [],
        deliberatedReview: null,
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
      };

    case 'UPDATE_SUCCESS':
      // Clear stale risk from any previous update; handleUpdate immediately
      // chains into START_EARLY_RESOLUTION to recompute against the new draft.
      return clearEarlyResolution({
        ...state,
        loading: null,
        loadingMeta: null,
        draftContent: action.content,
        hasUpdated: true,
      });

    case 'FINALIZE_SUCCESS':
      return { ...state, loading: null, loadingMeta: null, finalContent: action.content };

    case 'IDEATE_SUCCESS':
      return { ...state, loading: null, loadingMeta: null, ideatingContent: action.content };

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

    case 'RESET':
      return initialState;

    case 'SET_COPIED':
      return { ...state, copiedId: action.id };

    default:
      return state;
  }
}

export function useMarketReducer() {
  return useReducer(reducer, initialState);
}

export { initialState };
