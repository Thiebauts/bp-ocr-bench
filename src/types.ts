export interface Measurement {
  time_label: string
  systolic: number
  diastolic: number
}

export interface DayReading {
  day_label: string
  measurements: Measurement[]
}

export interface UsageInfo {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface ExtractionResult {
  data: DayReading[] | null
  raw: string
  error: string | null
  usage?: UsageInfo
  model: string
  duration_ms: number
}

export interface SavedPrompt {
  id: string
  name: string
  content: string
}

export interface ModelState {
  selected: string  // a model id or 'custom'
  custom: string    // value when selected === 'custom'
}

// ── Image library ──────────────────────────────────────────────────

export interface ImageEntry {
  id: string
  name: string
  mimeType: string
  base64: string       // base64-encoded image data (no data: prefix)
  sizeBytes: number
  savedAt: number      // Date.now()
  groundTruth: DayReading[] | null
  difficulty: 1 | 2 | null
}

// ── Benchmark ──────────────────────────────────────────────────────

export interface BenchmarkImageResult {
  imageId: string
  imageName: string
  difficulty: 1 | 2 | null
  model: string
  hasGroundTruth: boolean
  gtPairedValues: number            // ground truth reading count * 2; 0 if no GT
  accuracy: AccuracyResult | null   // null if no ground truth or on error
  usage?: UsageInfo
  error: string | null
  duration_ms: number
  runIndex?: number   // 0-based repetition index; undefined = single run
}

export interface BenchmarkRun {
  id: string
  name: string
  timestamp: number
  models: string[]
  selectedImageIds: string[]
  results: BenchmarkImageResult[]
  maxTokens: number
  temperature: number
  runsPerCombination?: number   // default 1
}

// ── Accuracy ───────────────────────────────────────────────────────

export interface PerReadingComparison {
  gtDay: string
  gtTime: string
  gtSys: number
  gtDia: number
  extSys: number | null   // null when extracted has fewer readings in this day
  extDia: number | null
  deltaSys: number | null // signed: positive = model read higher than truth
  deltaDia: number | null
  sysExact: boolean       // systolic matched exactly
  diaExact: boolean       // diastolic matched exactly
  exact: boolean          // both sys AND dia matched
}

export interface AccuracyResult {
  // Reading-pair counts (flat positional comparison)
  groundTruthCount: number
  extractedCount: number
  pairedCount: number         // min(gt readings, ext readings) — flat
  exactMatches: number        // pairs where both sys AND dia matched
  // Individual value counts (sys and dia counted separately)
  pairedValues: number        // groundTruthCount * 2  (full denominator — missing readings score 0)
  totalExactValues: number    // sysExactMatches + diaExactMatches
  sysExactMatches: number
  diaExactMatches: number
  exactPct: number            // totalExactValues / pairedValues * 100  ← value accuracy
  avgSysError: number | null  // mean |delta| over paired readings
  avgDiaError: number | null
  // Day structure (independent metric)
  gtDayCount: number
  extDayCount: number
  dayCountMatch: boolean
  dayAccuracyPct: number      // min(extDayCount, gtDayCount) / gtDayCount * 100
  perReading: PerReadingComparison[]
}
