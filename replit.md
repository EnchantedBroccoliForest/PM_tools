# Prediction Market Creator

## Overview
AI-assisted prediction market creation tool that uses OpenRouter API to generate well-defined market questions with clear resolution criteria, descriptions, and edge cases.

## Project Structure
- `/src` - React source code
  - `App.jsx` - Main application component
  - `App.css` - Styling
  - `main.jsx` - React entry point
  - `index.css` - Global styles
- `vite.config.js` - Vite configuration (port 5000, all hosts allowed)
- `index.html` - HTML entry point

## Tech Stack
- React 19 with Vite
- Node.js 20

## Environment Variables
- `VITE_OPENROUTER_API_KEY` - Required for API calls to OpenRouter

## Development
Run `npm run dev` to start the development server on port 5000.

## Features
- Draft prediction market questions with AI assistance
- Review drafts with a different AI model
- Generate final market details including resolution criteria, description, and edge cases
- Support for multiple AI models via OpenRouter

## Recent Changes
- 2026-01-26: Initial setup on Replit with Vite + React
