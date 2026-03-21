# BP Extractor

> Extract structured blood pressure data from handwritten log photos — any vision model, any format, runs entirely in your browser.

![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)
![React](https://img.shields.io/badge/React-18-blue)
![Status](https://img.shields.io/badge/Status-Active-brightgreen)
![License](https://img.shields.io/badge/License-MIT-green)

## Overview

BP Extractor is a personal-use web app for digitising handwritten blood pressure logs. Upload a photo of your log, select any vision-capable model available on OpenRouter, and receive structured JSON output grouped by day and measurement time. A built-in benchmark mode lets you compare model accuracy against ground-truth readings across an image library — useful for picking the best model for your handwriting style.

## Features

- Upload a photo/scan of a handwritten BP log (PNG or JPEG)
- Choose any vision model available on OpenRouter from a dropdown, or paste a custom model ID
- Edit the extraction prompt and save/load prompt variants
- Tune parameters (max tokens, temperature)
- Results displayed as a structured table grouped by day
- Copy JSON, export JSON, or export CSV
- **Compare mode**: run two models on the same image side by side
- Shows token usage when returned by the API
- Raw model response always available for debugging
- **Benchmark mode**: run multiple models across an image library with ground-truth scoring — value accuracy, mean absolute error, day-structure accuracy
- **Benchmark presets**: one-click model selections (Recommended, Frontier, Budget, per-provider)
- **Cost estimates**: per-model and total cost projections before running a benchmark
- **Run management**: rename, delete, and compare benchmark runs
- **Scatter plots**: visualise accuracy vs cost across models

## Quick Start

> **Prerequisites:** Node.js 18+ and npm.

### 1. Install dependencies

```bash
npm install
```

### 2. Set your OpenRouter API key

Copy `.env.example` to `.env` and paste your key:

```bash
cp .env.example .env
```

Edit `.env`:

```
VITE_OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

> **Note:** Vite requires the `VITE_` prefix to expose environment variables to the browser.
> If you prefer not to use a `.env` file, you can paste your key directly in the API Key field in the UI — it is never stored except in the browser's memory for the current session.

### 3. Run

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Project Structure

```
bp-extractor/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .env.example             # API key template
└── src/
    ├── main.tsx             # app entry point
    ├── App.tsx              # main extraction UI
    ├── App.css              # app styles
    ├── BenchmarkTab.tsx     # multi-model benchmark UI
    ├── db.ts                # IndexedDB persistence (images, prompts, runs)
    ├── models.ts            # model catalogue, presets, and pricing
    ├── types.ts             # shared TypeScript interfaces
    ├── utils.ts             # accuracy scoring and helper functions
    ├── vite-env.d.ts        # Vite type declarations
    └── api/
        └── openrouter.ts    # OpenRouter API client
```

## Usage

1. **Image** — click the drop zone or drag a PNG/JPEG onto it.
2. **Prompt** — edit the extraction prompt as needed. Use *Save* to store named variants; *Load* to restore them. *Reset to default* restores the original prompt.
3. **Model** — pick from the dropdown or choose "Custom model ID…" and type any OpenRouter model ID.
4. **Compare mode** — check "Compare with a second model" to pick a second model. Both run in parallel; results appear side by side.
5. **Parameters** — adjust *Max Tokens* (default 4096) and *Temperature* (default 0).
6. **Extract** — click the button. Results appear below, organised by day and measurement.
7. **Export** — use *Copy JSON*, *Export JSON*, or *Export CSV* on any result panel.

## Expected JSON shape

The model is prompted to return:

```json
[
  {
    "day_label": "Day 1",
    "measurements": [
      { "time_label": "Morning", "systolic": 120, "diastolic": 80 }
    ]
  }
]
```

If the model wraps the JSON in markdown code fences, they are stripped automatically. If parsing still fails, the raw response is shown so you can debug the prompt.

## Suggested vision-capable models on OpenRouter

| Provider | Model | OpenRouter ID |
|---|---|---|
| Anthropic | Claude Sonnet 4.6 | `anthropic/claude-sonnet-4.6` |
| OpenAI | GPT-5.4 | `openai/gpt-5.4` |
| Google | Gemini 2.5 Pro | `google/gemini-2.5-pro` |
| xAI | Grok 4 | `x-ai/grok-4` |
| Meta | Llama 4 Maverick | `meta-llama/llama-4-maverick` |
| Mistral | Mistral Large 2512 | `mistralai/mistral-large-2512` |
| Qwen | Qwen3 VL 235B | `qwen/qwen3-vl-235b-a22b-instruct` |
| Amazon | Nova Premier | `amazon/nova-premier-v1` |
| ByteDance | Seed 1.6 Flash | `bytedance-seed/seed-1.6-flash` |
| NVIDIA | Nemotron Nano 12B VL | `nvidia/nemotron-nano-12b-v2-vl` |
| AllenAI | Molmo 7B-D | `allenai/molmo-7b-d` |
| MoonshotAI | Kimi VL A3B | `moonshotai/kimi-vl-a3b-thinking` |
| StepFun | Step3 | `stepfun-ai/step3` |
| Microsoft | Phi 4 Multimodal | `microsoft/phi-4-multimodal-instruct` |

The in-app dropdown includes 60+ models across 14 providers. Check [openrouter.ai/models](https://openrouter.ai/models) (filter by *Multimodal*) for the full list.

## Benchmark Mode

The **Benchmark** tab lets you evaluate model accuracy at scale:

1. **Image library** — import images with ground-truth BP readings into the built-in library.
2. **Model selection** — pick individual models or use a preset (Recommended, Frontier, Budget, or per-provider).
3. **Cost estimate** — review projected costs before running.
4. **Run** — all selected models process every image; results are scored automatically.
5. **Results** — view per-model accuracy, mean absolute error, and day-structure accuracy. Use scatter plots to compare accuracy vs cost.
6. **History** — saved runs can be renamed, compared, or deleted.

## Build for local use (optional)

```bash
npm run build
npm run preview
```

The built output is in `dist/` — open it with any static file server, or just use `npm run dev`.

## Contributing

Contributions are welcome. Please open an issue first to discuss proposed changes.

This project follows [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages.

## License

[MIT](LICENSE) © Thiebaut Schirmer
