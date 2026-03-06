import { useReducer } from 'react';
import { DEFAULT_DRAFT_MODEL, DEFAULT_REVIEW_MODEL } from '../constants/models';

const initialState = {
  // Input
  question: '',
  startDate: '',
  endDate: '',
  selectedModel: DEFAULT_DRAFT_MODEL,
  reviewModels: [DEFAULT_REVIEW_MODEL],
  humanReviewInput: '',

  // Processing
  loading: null, // null | 'draft' | 'review' | 'update' | 'accept'
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
      return { ...state, loading: action.phase, error: null };

    case 'STOP_LOADING':
      return { ...state, loading: null };

    case 'SET_ERROR':
      return { ...state, loading: null, error: action.error };

    case 'DRAFT_SUCCESS':
      return {
        ...state,
        loading: null,
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
        reviews: action.reviews,
        deliberatedReview: action.deliberatedReview || null,
      };

    case 'UPDATE_SUCCESS':
      return {
        ...state,
        loading: null,
        draftContent: action.content,
        hasUpdated: true,
      };

    case 'FINALIZE_SUCCESS':
      return { ...state, loading: null, finalContent: action.content };

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
