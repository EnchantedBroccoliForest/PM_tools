import { useReducer } from 'react';
import { DEFAULT_DRAFT_MODEL, DEFAULT_REVIEW_MODEL } from '../constants/models';

function getInitialTheme() {
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  return 'dark';
}

const initialState = {
  // Mode
  mode: 'draft', // 'draft' | 'review'

  // Input
  question: '',
  startDate: '',
  endDate: '',
  references: '',
  selectedModel: DEFAULT_DRAFT_MODEL,
  reviewModels: [DEFAULT_REVIEW_MODEL],
  humanReviewInput: '',
  pastedDraft: '',

  // Processing
  loading: null, // null | 'draft' | 'review' | 'update' | 'accept' | 'early-resolution'
  loadingMeta: null, // { models: string[], startTime: number } | null
  error: null,
  dateError: null,

  // Content
  draftContent: null,
  reviews: [],           // Array of { model, modelName, content }
  deliberatedReview: null, // Synthesized review after deliberation
  finalContent: null,
  hasUpdated: false,

  // UI
  copiedId: null,
  theme: getInitialTheme(),
};

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
      return {
        ...state,
        draftContent: action.content,
        reviews: [],
        deliberatedReview: null,
        humanReviewInput: '',
        finalContent: null,
        hasUpdated: false,
      };

    case 'DRAFT_SUCCESS':
      return {
        ...state,
        loading: null,
        loadingMeta: null,
        draftContent: action.content,
        reviews: [],
        deliberatedReview: null,
        humanReviewInput: '',
        finalContent: null,
        hasUpdated: false,
      };

    case 'REVIEW_SUCCESS':
      return {
        ...state,
        loading: null,
        loadingMeta: null,
        reviews: action.reviews,
        deliberatedReview: action.deliberatedReview || null,
      };

    case 'UPDATE_SUCCESS':
      return {
        ...state,
        loading: null,
        loadingMeta: null,
        draftContent: action.content,
        hasUpdated: true,
      };

    case 'FINALIZE_SUCCESS':
      return { ...state, loading: null, loadingMeta: null, finalContent: action.content };

    case 'START_EARLY_RESOLUTION':
      return {
        ...state,
        loading: 'early-resolution',
        loadingMeta: { models: action.models || [], startTime: Date.now() },
      };

    case 'EARLY_RESOLUTION_SUCCESS':
      return {
        ...state,
        loading: null,
        loadingMeta: null,
        finalContent: { ...state.finalContent, earlyResolutionRisk: action.content },
      };

    case 'EARLY_RESOLUTION_ERROR':
      return {
        ...state,
        loading: null,
        loadingMeta: null,
        finalContent: { ...state.finalContent, earlyResolutionRisk: `Error: ${action.error}` },
      };

    case 'RESET':
      return initialState;

    case 'SET_COPIED':
      return { ...state, copiedId: action.id };

    case 'TOGGLE_THEME': {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('theme', next); } catch {}
      return { ...state, theme: next };
    }

    default:
      return state;
  }
}

export function useMarketReducer() {
  return useReducer(reducer, initialState);
}

export { initialState };
