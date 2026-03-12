# CLAUDE.md — BP Extractor

## Project Overview

- **Name**: BP Extractor
- **Purpose**: Local web app for extracting blood pressure readings from handwritten log images using vision-capable LLMs via OpenRouter
- **Status**: Active development
- **Type**: Web app

## Tech Stack

- **Language**: TypeScript 5.5
- **Key frameworks**: React 18, Vite 5
- **Package manager**: npm
- **Formatter/linter**: not yet configured (consider Prettier + ESLint)
- **Testing**: not yet configured (Vitest recommended for Vite projects)
- **Infrastructure**: local only — no deployment, no CI

## Architecture Notes

Single-page Vite/React app. `src/App.tsx` manages the main extraction UI; `src/BenchmarkTab.tsx` handles the multi-model benchmark workflow. API calls to OpenRouter are isolated in `src/api/openrouter.ts`. `src/db.ts` handles all IndexedDB persistence (image library, saved prompts, benchmark run history). All shared TypeScript interfaces live in `src/types.ts`.

The API key is read from `VITE_OPENROUTER_API_KEY` in `.env`, or entered manually in the UI (session-only, never persisted).

## Key Commands

```bash
# Install dependencies
npm install

# Run dev server (http://localhost:5173)
npm run dev

# Type-check + build for production
npm run build

# Preview production build locally
npm run preview
```

## Conventions (Project-Specific)

- Commit scopes: `ui`, `api`, `db`, `types`, `benchmark`, `deps`
- `.env` is gitignored — never commit API keys
- `dist/` is gitignored — built output only
- `node_modules/` is gitignored

## Current Focus

- [ ] General app improvements (UX, reliability, features)
- [ ] Add ESLint + Prettier configuration
- [ ] Add Vitest for unit testing

## README Sync Checklist

- [ ] Tagline / description still accurate
- [ ] Badges up to date
- [ ] Features list reflects latest capabilities
- [ ] Installation instructions still work
- [ ] Project structure tree matches reality
- [ ] Model suggestions table is current
