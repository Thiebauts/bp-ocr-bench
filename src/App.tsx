import { useState, useRef, useEffect, Suspense, lazy, useCallback } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'
import type {
  ExtractionResult, SavedPrompt, ModelState, DayReading,
  Measurement, ImageEntry, AccuracyResult,
} from './types'
import { SUGGESTED_MODELS } from './models'
import {
  downloadBlob, pctColor, fmtPrice, estimateCost, fmtCost,
  getEffectiveModelId, fileToBase64, base64ToObjectUrl, compareReadings,
} from './utils'
import { callOpenRouter } from './api/openrouter'
import { getAllImages, saveImage as dbSave, deleteImage as dbDelete } from './db'

const BenchmarkTab = lazy(() =>
  import('./BenchmarkTab').then(m => ({ default: m.BenchmarkTab }))
)

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_PROMPT = `You are a medical data extraction assistant. Extract all blood pressure readings from this handwritten log image.

Return ONLY valid JSON matching this exact structure (no markdown, no explanation):

[
  {
    "day_label": "Day 1",
    "measurements": [
      { "time_label": "Morning", "systolic": 120, "diastolic": 80 }
    ]
  }
]

Rules:
- Readings are written as systolic/diastolic pairs, often separated by /, ||, or whitespace
- If a third number appears alongside a pair, it is likely pulse — ignore it
- Group readings by day/date if visible
- If no day grouping is apparent, use "Day 1" for all readings
- If no days are specified but different groups of numbers are seen, consider these groups as different days
- Use time labels from the image (e.g. "Morning", "Evening", "8:00 AM") or generate sequential ones ("Reading 1", "Reading 2")
- systolic and diastolic must be integers with no leading zeros
- Read each digit carefully — handwritten digits can be ambiguous
- Extract ALL readings visible in the image`

function exportJSON(data: DayReading[], label: string) {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `bp-readings-${label}.json`)
}

function exportCSV(data: DayReading[], label: string) {
  const rows: string[][] = [['day_label', 'time_label', 'systolic', 'diastolic']]
  for (const day of data)
    for (const m of day.measurements)
      rows.push([day.day_label, m.time_label, String(m.systolic), String(m.diastolic)])
  const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `bp-readings-${label}.csv`)
}

// ── ModelSelector ──────────────────────────────────────────────────

function ModelSelector({ label, value, onChange }: {
  label: string; value: ModelState; onChange: (v: ModelState) => void
}) {
  return (
    <div className="model-selector">
      <label className="field-label">{label}</label>
      <select className="select" value={value.selected}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange({ ...value, selected: e.target.value })}>
        {SUGGESTED_MODELS.map(group => (
          <optgroup key={group.group} label={group.group}>
            {group.models.map(m => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.input !== null ? `  ·  ${fmtPrice(m.input)} in / ${fmtPrice(m.output)} out per 1M` : ''}
                {'  —  '}{m.id}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="custom">─ Custom model ID…</option>
      </select>
      {value.selected === 'custom' && (
        <input className="input" type="text" placeholder="e.g. anthropic/claude-opus-4"
          value={value.custom}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, custom: e.target.value })} />
      )}
    </div>
  )
}

// ── GroundTruthEditor (modal) ──────────────────────────────────────

function GroundTruthEditor({ entry, onSave, onClose }: {
  entry: ImageEntry
  onSave: (id: string, gt: DayReading[]) => void
  onClose: () => void
}) {
  const [days, setDays] = useState<DayReading[]>(() =>
    entry.groundTruth && entry.groundTruth.length > 0
      ? JSON.parse(JSON.stringify(entry.groundTruth))
      : [{ day_label: 'Day 1', measurements: [{ time_label: 'Morning', systolic: 0, diastolic: 0 }] }]
  )

  const updateDayLabel = (di: number, label: string) =>
    setDays(d => d.map((day, i) => i === di ? { ...day, day_label: label } : day))

  const removeDay = (di: number) =>
    setDays(d => d.filter((_, i) => i !== di))

  const addDay = () =>
    setDays(d => [...d, { day_label: `Day ${d.length + 1}`, measurements: [] }])

  const addRow = (di: number) =>
    setDays(d => d.map((day, i) => i !== di ? day : {
      ...day,
      measurements: [...day.measurements, { time_label: '', systolic: 0, diastolic: 0 }],
    }))

  const removeRow = (di: number, mi: number) =>
    setDays(d => d.map((day, i) => i !== di ? day : {
      ...day, measurements: day.measurements.filter((_, j) => j !== mi),
    }))

  const updateRow = (di: number, mi: number, field: keyof Measurement, raw: string) =>
    setDays(d => d.map((day, i) => i !== di ? day : {
      ...day,
      measurements: day.measurements.map((m, j) => j !== mi ? m : {
        ...m,
        [field]: field === 'time_label' ? raw : raw === '' ? 0 : parseInt(raw, 10),
      }),
    }))

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-dialog">
        {/* Left: image */}
        <div className="modal-image-pane">
          <img src={`data:${entry.mimeType};base64,${entry.base64}`} alt={entry.name} />
        </div>

        {/* Right: editor */}
        <div className="modal-editor-pane">
          <div className="modal-editor-header">
            <h2>Ground truth — {entry.name}</h2>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
          </div>

          <div className="modal-editor-body">
            <p className="text-muted" style={{ fontSize: 13, marginBottom: 4 }}>
              Enter the actual readings from this image. They will be compared positionally (by order)
              against model output to calculate accuracy.
            </p>

            {days.map((day, di) => (
              <div key={di} className="gt-day-block">
                <div className="gt-day-header">
                  <input className="input gt-day-input" value={day.day_label}
                    onChange={e => updateDayLabel(di, e.target.value)}
                    placeholder="Day label (e.g. Day 1)" />
                  <button className="btn btn-danger btn-sm" onClick={() => removeDay(di)}
                    title="Remove this day">×</button>
                </div>

                <table className="gt-table">
                  <thead>
                    <tr>
                      <th>Time / label</th>
                      <th>Systolic</th>
                      <th>Diastolic</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.measurements.map((m, mi) => (
                      <tr key={mi}>
                        <td>
                          <input className="gt-input" value={m.time_label}
                            onChange={e => updateRow(di, mi, 'time_label', e.target.value)}
                            placeholder="Morning" />
                        </td>
                        <td>
                          <input className="gt-input gt-input-num" type="number"
                            value={m.systolic || ''} min={0} max={300}
                            onChange={e => updateRow(di, mi, 'systolic', e.target.value)}
                            placeholder="120" />
                        </td>
                        <td>
                          <input className="gt-input gt-input-num" type="number"
                            value={m.diastolic || ''} min={0} max={200}
                            onChange={e => updateRow(di, mi, 'diastolic', e.target.value)}
                            placeholder="80" />
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => removeRow(di, mi)}
                            title="Remove reading">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="gt-day-footer">
                  <button className="btn btn-ghost btn-sm" onClick={() => addRow(di)}>+ Add reading</button>
                </div>
              </div>
            ))}

            <button className="btn btn-sm" onClick={addDay} style={{ marginTop: 4 }}>+ Add day</button>
          </div>

          <div className="modal-editor-footer">
            <button className="btn btn-danger btn-sm" onClick={() => onSave(entry.id, [])}>
              Clear all
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={() => onSave(entry.id, days)}>Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── ResultPanel ────────────────────────────────────────────────────

function ResultPanel({ result, loading, label, accuracy }: {
  result: ExtractionResult | null
  loading: boolean
  label: string
  accuracy: AccuracyResult | null
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (!result?.data) return
    navigator.clipboard.writeText(JSON.stringify(result.data, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!loading && !result) return null

  const modelSlug = result?.model.replace(/\//g, '-') ?? 'model'

  return (
    <div className="card result-panel">
      {/* Header */}
      <div className="result-header">
        <div className="result-header-left">
          <span className="result-label">{label}</span>
          {result && <code className="model-id-badge">{result.model}</code>}
        </div>
        {result && <span className="duration-badge">{(result.duration_ms / 1000).toFixed(2)}s</span>}
      </div>

      {/* Loading */}
      {loading && (
        <div className="loading-row">
          <div className="spinner" />
          <span className="text-muted">Extracting…</span>
        </div>
      )}

      {/* Token usage + cost */}
      {result?.usage && (
        <div className="usage-row">
          <span>Tokens:</span>
          <strong>{result.usage.prompt_tokens ?? '?'}</strong>
          <span>in +</span>
          <strong>{result.usage.completion_tokens ?? '?'}</strong>
          <span>out =</span>
          <strong>{result.usage.total_tokens ?? '?'}</strong>
          <span>total</span>
          {(() => {
            const cost = estimateCost(result.usage, result.model)
            return cost !== null ? (
              <><span className="usage-divider">·</span><span>Est. cost:</span>
                <strong className="cost-value">{fmtCost(cost)}</strong></>
            ) : null
          })()}
        </div>
      )}

      {/* Error */}
      {result?.error && (
        <div className="error-box"><strong>Error:</strong> {result.error}</div>
      )}

      {/* Structured readings */}
      {result?.data && (
        <>
          <div className="readings-grid">
            {result.data.map((day, di) => (
              <div key={di} className="day-block">
                <div className="day-label">{day.day_label}</div>
                <table className="bp-table">
                  <thead><tr><th>Time</th><th>Systolic</th><th>Diastolic</th></tr></thead>
                  <tbody>
                    {day.measurements.map((m, mi) => (
                      <tr key={mi}>
                        <td>{m.time_label}</td>
                        <td className="bp-sys">{m.systolic}</td>
                        <td className="bp-dia">{m.diastolic}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          {/* Accuracy vs ground truth */}
          {accuracy && (
            <div className="accuracy-block">
              {/* Always-visible summary bar */}
              <div className="accuracy-summary-bar">
                {/* Value accuracy */}
                <div className="accuracy-pct-block">
                  <span className="accuracy-pct" style={{ color: pctColor(accuracy.exactPct) }}>
                    {accuracy.exactPct.toFixed(0)}%
                  </span>
                  <span className="accuracy-pct-label">values</span>
                </div>
                {/* Day count match */}
                <div className="accuracy-pct-block">
                  <span className="accuracy-pct" style={{ color: accuracy.dayCountMatch ? 'var(--success)' : 'var(--danger)' }}>
                    {accuracy.dayCountMatch ? 'Yes' : 'No'}
                  </span>
                  <span className="accuracy-pct-label">days</span>
                </div>
                <div className="accuracy-summary-text">
                  <strong>
                    {accuracy.totalExactValues}/{accuracy.pairedValues} exact values
                  </strong>
                  <span className="text-muted">
                    &ensp;({accuracy.exactMatches}/{accuracy.pairedCount} full readings)
                  </span>
                  {accuracy.avgSysError !== null && (
                    <span className="text-muted">
                      &ensp;·&ensp;sys ±{accuracy.avgSysError.toFixed(1)}&ensp;dia ±{accuracy.avgDiaError!.toFixed(1)} mmHg
                    </span>
                  )}
                  <span className={accuracy.dayCountMatch ? 'text-muted' : 'accuracy-mismatch'}>
                    &ensp;·&ensp;{accuracy.extDayCount}/{accuracy.gtDayCount} day{accuracy.gtDayCount !== 1 ? 's' : ''}
                  </span>
                  {accuracy.extractedCount !== accuracy.groundTruthCount && (
                    <span className="accuracy-mismatch">
                      &ensp;⚠ {accuracy.extractedCount} readings extracted vs {accuracy.groundTruthCount} expected
                    </span>
                  )}
                </div>
              </div>

              {/* Per-reading detail table (collapsible) */}
              <details className="accuracy-details">
                <summary>Per-reading comparison</summary>
                <div style={{ overflowX: 'auto' }}>
                  <table className="accuracy-table">
                    <thead>
                      <tr>
                        <th>Day</th><th>Time</th>
                        <th>True sys</th><th>True dia</th>
                        <th>Got sys</th><th>Got dia</th>
                        <th>Δ sys</th><th>Δ dia</th>
                        <th>Sys</th><th>Dia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accuracy.perReading.map((r, i) => (
                        <tr key={i} className={
                          r.extSys === null ? 'acc-row-missing'
                          : r.exact          ? 'acc-row-exact'
                          : (Math.abs(r.deltaSys ?? 0) > 5 || Math.abs(r.deltaDia ?? 0) > 5)
                                             ? 'acc-row-error' : ''
                        }>
                          <td>{r.gtDay}</td>
                          <td>{r.gtTime}</td>
                          <td className="bp-sys">{r.gtSys}</td>
                          <td className="bp-dia">{r.gtDia}</td>
                          <td className={r.extSys !== null ? 'bp-sys' : 'text-muted'}>{r.extSys ?? '—'}</td>
                          <td className={r.extDia !== null ? 'bp-dia' : 'text-muted'}>{r.extDia ?? '—'}</td>
                          <td className={!r.deltaSys ? '' : Math.abs(r.deltaSys) > 5 ? 'acc-err' : 'acc-warn'}>
                            {r.deltaSys === null ? '—' : r.deltaSys === 0 ? '0' : (r.deltaSys > 0 ? '+' : '') + r.deltaSys}
                          </td>
                          <td className={!r.deltaDia ? '' : Math.abs(r.deltaDia) > 5 ? 'acc-err' : 'acc-warn'}>
                            {r.deltaDia === null ? '—' : r.deltaDia === 0 ? '0' : (r.deltaDia > 0 ? '+' : '') + r.deltaDia}
                          </td>
                          <td className={r.extSys === null ? 'text-muted' : r.sysExact ? 'acc-ok' : 'acc-err'}>
                            {r.extSys === null ? '—' : r.sysExact ? '✓' : '✗'}
                          </td>
                          <td className={r.extDia === null ? 'text-muted' : r.diaExact ? 'acc-ok' : 'acc-err'}>
                            {r.extDia === null ? '—' : r.diaExact ? '✓' : '✗'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}

          {/* Action buttons */}
          <div className="result-actions">
            <button className="btn btn-sm" onClick={handleCopy}>{copied ? '✓ Copied!' : 'Copy JSON'}</button>
            <button className="btn btn-sm" onClick={() => exportJSON(result.data!, modelSlug)}>Export JSON</button>
            <button className="btn btn-sm" onClick={() => exportCSV(result.data!, modelSlug)}>Export CSV</button>
          </div>
        </>
      )}

      {/* Raw response */}
      {result?.raw && (
        <details className="raw-details">
          <summary>Raw model response</summary>
          <pre className="raw-pre">{result.raw}</pre>
        </details>
      )}
    </div>
  )
}

// ── App ────────────────────────────────────────────────────────────

interface ImageState { file: File; previewUrl: string; base64: string; mimeType: string }

export default function App() {
  // Tab
  const [tab, setTab] = useState<'extraction' | 'benchmark'>('extraction')

  // API key
  const [apiKey, setApiKey] = useState<string>(
    () => (import.meta.env.VITE_OPENROUTER_API_KEY as string) ?? '',
  )

  // Current image (from upload or library)
  const [image, setImage] = useState<ImageState | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const extractAbortRef = useRef<AbortController | null>(null)

  // Image library (IndexedDB)
  const [library, setLibrary]         = useState<ImageEntry[]>([])
  const [libraryReady, setLibraryReady] = useState(false)
  const [activeLibId, setActiveLibId] = useState<string | null>(null)  // which library entry is loaded
  const [saveName, setSaveName]       = useState('')
  const [gtEditorId, setGtEditorId]   = useState<string | null>(null)  // which entry is open in editor
  const [renamingId, setRenamingId]   = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Prompt
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>(() => {
    try { return JSON.parse(localStorage.getItem('bp-saved-prompts') ?? '[]') as SavedPrompt[] }
    catch { return [] }
  })
  const [promptName, setPromptName]   = useState('')
  const [selectedSaved, setSelectedSaved] = useState('')

  // Models
  const [modelA, setModelA] = useState<ModelState>({ selected: 'anthropic/claude-sonnet-4.6', custom: '' })
  const [compareMode, setCompareMode] = useState(false)
  const [modelB, setModelB] = useState<ModelState>({ selected: 'openai/gpt-4o', custom: '' })

  // Parameters
  const [maxTokens, setMaxTokens]     = useState(4096)
  const [temperature, setTemperature] = useState(0)

  // Results & accuracy
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)
  const [resultA,  setResultA]  = useState<ExtractionResult | null>(null)
  const [resultB,  setResultB]  = useState<ExtractionResult | null>(null)
  const [accuracyA, setAccuracyA] = useState<AccuracyResult | null>(null)
  const [accuracyB, setAccuracyB] = useState<AccuracyResult | null>(null)
  const [globalError, setGlobalError] = useState<string | null>(null)

  // ── Load library on mount ───────────────────────────────────────

  useEffect(() => {
    getAllImages()
      .then(entries => { setLibrary(entries); setLibraryReady(true) })
      .catch(() => setLibraryReady(true))
  }, [])

  // ── Image handlers ─────────────────────────────────────────────

  const loadImageFile = async (file: File) => {
    if (!file.type.match(/^image\/(png|jpeg|jpg)$/)) {
      setGlobalError('Please select a PNG or JPEG image.'); return
    }
    if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl)
    const previewUrl = URL.createObjectURL(file)
    const base64 = await fileToBase64(file)
    setImage({ file, previewUrl, base64, mimeType: file.type })
    setActiveLibId(null)
    setSaveName(file.name.replace(/\.[^.]+$/, ''))
    setGlobalError(null)
  }

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) loadImageFile(file)
    e.target.value = ''  // allow re-selecting same file
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]; if (file) loadImageFile(file)
  }

  // ── Image library handlers ─────────────────────────────────────

  const handleSaveToLibrary = async () => {
    if (!image) return
    const name = saveName.trim() || image.file.name
    const entry: ImageEntry = {
      id: crypto.randomUUID(), name, mimeType: image.mimeType,
      base64: image.base64, sizeBytes: image.file.size,
      savedAt: Date.now(), groundTruth: null, difficulty: null,
    }
    await dbSave(entry)
    setLibrary(prev => [entry, ...prev])
    setActiveLibId(entry.id)
    setSaveName('')
  }

  const handleLoadFromLibrary = (entry: ImageEntry) => {
    if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl)
    const previewUrl = base64ToObjectUrl(entry.base64, entry.mimeType)
    const blob = new Blob(                   // reconstruct File so meta is present
      [new Uint8Array(atob(entry.base64).split('').map(c => c.charCodeAt(0)))],
      { type: entry.mimeType }
    )
    setImage({ file: new File([blob], entry.name, { type: entry.mimeType }), previewUrl, base64: entry.base64, mimeType: entry.mimeType })
    setActiveLibId(entry.id)
    setResultA(null); setResultB(null)
    setAccuracyA(null); setAccuracyB(null)
    setGlobalError(null)
  }

  const handleDeleteFromLibrary = async (id: string) => {
    await dbDelete(id)
    setLibrary(prev => prev.filter(e => e.id !== id))
    if (activeLibId === id) setActiveLibId(null)
  }

  const handleSetDifficulty = async (id: string, difficulty: 1 | 2 | null) => {
    const entry = library.find(e => e.id === id)
    if (!entry) return
    const updated = { ...entry, difficulty }
    await dbSave(updated)
    setLibrary(prev => prev.map(e => e.id === id ? updated : e))
  }

  const startRename = useCallback((id: string) => {
    const entry = library.find(e => e.id === id)
    if (!entry) return
    setRenamingId(id)
    setRenameValue(entry.name)
  }, [library])

  const commitRename = useCallback(async () => {
    if (!renamingId) return
    const trimmed = renameValue.trim()
    if (!trimmed) { setRenamingId(null); return }
    const entry = library.find(e => e.id === renamingId)
    if (!entry || entry.name === trimmed) { setRenamingId(null); return }
    const updated = { ...entry, name: trimmed }
    await dbSave(updated)
    setLibrary(prev => prev.map(e => e.id === renamingId ? updated : e))
    setRenamingId(null)
  }, [renamingId, renameValue, library])

  const handleRenameKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitRename()
    else if (e.key === 'Escape') setRenamingId(null)
  }, [commitRename])

  const handleSaveGroundTruth = async (id: string, gt: DayReading[]) => {
    const entry = library.find(e => e.id === id)
    if (!entry) return
    const updated = { ...entry, groundTruth: gt.length > 0 ? gt : null }
    await dbSave(updated)
    setLibrary(prev => prev.map(e => e.id === id ? updated : e))
    setGtEditorId(null)
    // Re-run accuracy if we just updated the active image's ground truth
    if (id === activeLibId && resultA?.data && updated.groundTruth)
      setAccuracyA(compareReadings(resultA.data, updated.groundTruth))
    if (id === activeLibId && resultB?.data && updated.groundTruth)
      setAccuracyB(compareReadings(resultB.data, updated.groundTruth))
  }

  // ── Prompt library ─────────────────────────────────────────────

  const persistPrompts = (list: SavedPrompt[]) => {
    setSavedPrompts(list)
    localStorage.setItem('bp-saved-prompts', JSON.stringify(list))
  }
  const saveCurrentPrompt = () => {
    const name = promptName.trim(); if (!name) return
    const updated = [...savedPrompts.filter(p => p.name !== name), { id: crypto.randomUUID(), name, content: prompt }]
    persistPrompts(updated); setPromptName('')
  }
  const loadSavedPrompt = (id: string) => {
    const found = savedPrompts.find(p => p.id === id)
    if (found) { setPrompt(found.content); setSelectedSaved(id) }
  }
  const deleteSavedPrompt = (id: string) => {
    persistPrompts(savedPrompts.filter(p => p.id !== id))
    if (selectedSaved === id) setSelectedSaved('')
  }

  // ── Extract ────────────────────────────────────────────────────

  const handleExtract = async () => {
    if (!image)        { setGlobalError('Please select an image first.'); return }
    const key = apiKey.trim()
    if (!key)          { setGlobalError('Please enter your OpenRouter API key.'); return }
    const effA = getEffectiveModelId(modelA)
    const effB = getEffectiveModelId(modelB)
    if (!effA)         { setGlobalError('Please enter a model ID for Model A.'); return }
    if (compareMode && !effB) { setGlobalError('Please enter a model ID for Model B.'); return }

    extractAbortRef.current?.abort()
    extractAbortRef.current = new AbortController()
    const { signal } = extractAbortRef.current

    setResultA(null); setResultB(null)
    setAccuracyA(null); setAccuracyB(null)
    setGlobalError(null)

    const base = { apiKey: key, prompt, imageBase64: image.base64, imageMimeType: image.mimeType, maxTokens, temperature, signal }

    const runModel = async (
      model: string,
      setLoading: (v: boolean) => void,
      setResult: (r: ExtractionResult) => void,
    ): Promise<ExtractionResult> => {
      setLoading(true)
      const start = Date.now()
      let res: ExtractionResult
      try {
        const r = await callOpenRouter({ ...base, model })
        res = { ...r, model, duration_ms: Date.now() - start }
      } catch (err) {
        if (signal.aborted) {
          res = { data: null, raw: '', error: 'Cancelled', model, duration_ms: Date.now() - start }
        } else {
          res = { data: null, raw: '', error: (err as Error).message, model, duration_ms: Date.now() - start }
        }
      } finally { setLoading(false) }
      setResult(res!)
      return res!
    }

    const [resA, resB] = await Promise.all([
      runModel(effA, setLoadingA, setResultA),
      compareMode ? runModel(effB, setLoadingB, setResultB) : Promise.resolve(null),
    ])

    // Compute accuracy if active image has ground truth
    const gt = activeLibId ? library.find(e => e.id === activeLibId)?.groundTruth : null
    if (gt && gt.length > 0) {
      if (resA?.data) setAccuracyA(compareReadings(resA.data, gt))
      if (resB?.data) setAccuracyB(compareReadings(resB.data, gt))
    }
  }

  const isRunning = loadingA || loadingB
  const activeEntry = activeLibId ? library.find(e => e.id === activeLibId) : null

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1 className="app-title">BP Extractor</h1>
        <nav className="tab-nav">
          <button className={`tab-btn${tab === 'extraction' ? ' tab-btn--active' : ''}`}
            onClick={() => setTab('extraction')}>Extraction</button>
          <button className={`tab-btn${tab === 'benchmark' ? ' tab-btn--active' : ''}`}
            onClick={() => setTab('benchmark')}>Benchmark</button>
        </nav>
        <div className="api-key-row">
          <label htmlFor="api-key" className="field-label">OpenRouter API Key</label>
          <input id="api-key" className="input api-key-input" type="password"
            placeholder="sk-or-v1-…" value={apiKey}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)} />
        </div>
      </header>

      {tab === 'benchmark' && (
        <Suspense fallback={<div className="loading-row"><div className="spinner" /><span className="text-muted">Loading benchmark…</span></div>}>
          <BenchmarkTab
            library={library}
            apiKey={apiKey}
            prompt={prompt}
            savedPrompts={savedPrompts}
            onLibraryUpdate={setLibrary}
          />
        </Suspense>
      )}

      <main className="app-main" style={{ display: tab === 'extraction' ? undefined : 'none' }}>
        {globalError && <div className="global-error">{globalError}</div>}

        {/* ── Config: image + prompt ── */}
        <div className="config-grid">
          {/* Image section */}
          <section className="card section-image">
            <div className="section-title">Image</div>

            {/* Drop zone */}
            <div className={`drop-zone${dragOver ? ' drag-over' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}>
              {image ? (
                <img src={image.previewUrl} alt="Blood pressure log" className="image-preview" />
              ) : (
                <div className="drop-placeholder">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <p>Click or drag &amp; drop</p>
                  <p className="text-muted">PNG or JPEG</p>
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg"
              className="hidden-input" onChange={handleFileInput} />

            {/* Image meta + library actions */}
            {image && (
              <div className="image-meta-row">
                {activeEntry ? (
                  // Loaded from library
                  <div className="library-active-info">
                    {renamingId === activeEntry.id ? (
                      <input className="input input-sm rename-input"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        onBlur={commitRename}
                        autoFocus />
                    ) : (
                      <>
                        <span className="library-active-name">{activeEntry.name}</span>
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => startRename(activeEntry.id)}
                          title="Rename image">✏</button>
                      </>
                    )}
                    {activeEntry.groundTruth && <span className="gt-badge">ground truth</span>}
                    {activeEntry.difficulty && (
                      <span className={`difficulty-badge difficulty-badge--${activeEntry.difficulty}`}>
                        difficulty {activeEntry.difficulty}
                      </span>
                    )}
                    <button className="btn btn-sm btn-ghost"
                      onClick={() => setGtEditorId(activeEntry.id)}>
                      {activeEntry.groundTruth ? 'Edit truth' : 'Add truth'}
                    </button>
                  </div>
                ) : (
                  // Freshly uploaded — offer to save
                  <div className="library-save-row">
                    <input className="input input-sm" type="text" placeholder="Name…"
                      value={saveName}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setSaveName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSaveToLibrary()} />
                    <button className="btn btn-sm" onClick={handleSaveToLibrary}>
                      Save to library
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Library strip */}
            <div className="library-section">
              <div className="library-section-header">
                <span className="field-label">Image library</span>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  {libraryReady ? `${library.length} saved` : 'Loading…'}
                </span>
              </div>
              {libraryReady && library.length === 0 ? (
                <p className="library-empty">No images saved yet.</p>
              ) : (
                <div className="library-strip">
                  {library.map(entry => (
                    <div key={entry.id}
                      className={`library-thumb${activeLibId === entry.id ? ' library-thumb--active' : ''}`}>
                      <img
                        className="library-thumb-img"
                        src={`data:${entry.mimeType};base64,${entry.base64}`}
                        alt={entry.name}
                        onClick={() => handleLoadFromLibrary(entry)}
                        title={`Load: ${entry.name}`}
                      />
                      <div className="library-thumb-body">
                        <span className="library-thumb-name" title={entry.name}
                          onClick={() => handleLoadFromLibrary(entry)}>
                          {entry.name}
                        </span>
                        {entry.groundTruth && <span className="gt-badge">truth</span>}
                      </div>
                      <div className="library-thumb-actions">
                        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }}
                          onClick={() => setGtEditorId(entry.id)}
                          title={entry.groundTruth ? 'Edit ground truth' : 'Add ground truth'}>
                          {entry.groundTruth ? '✏ truth' : '+ truth'}
                        </button>
                        <button className="btn btn-ghost btn-sm btn-danger"
                          onClick={() => handleDeleteFromLibrary(entry.id)}
                          title="Delete from library">×</button>
                      </div>
                      <div className="difficulty-picker">
                        {([1, 2] as const).map(d => (
                          <button key={d}
                            title={d === 1 ? 'Expected (easy/moderate)' : 'Challenging (hard)'}
                            className={`difficulty-btn difficulty-btn--${d}${entry.difficulty === d ? ' difficulty-btn--active' : ''}`}
                            onClick={() => handleSetDifficulty(entry.id, entry.difficulty === d ? null : d)}>
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Prompt section */}
          <section className="card section-prompt">
            <div className="section-title">Extraction Prompt</div>
            <div className="prompt-library">
              <div className="prompt-library-load">
                <select className="select select-sm" style={{ flex: 1 }} value={selectedSaved}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => { if (e.target.value) loadSavedPrompt(e.target.value) }}>
                  <option value="">Load saved prompt…</option>
                  {savedPrompts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {selectedSaved && (
                  <button className="btn btn-danger btn-sm" onClick={() => deleteSavedPrompt(selectedSaved)}>Delete</button>
                )}
              </div>
              <div className="prompt-library-save">
                <input className="input input-sm" style={{ flex: 1 }} type="text"
                  placeholder="Name for current prompt…" value={promptName}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setPromptName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveCurrentPrompt()} />
                <button className="btn btn-sm" onClick={saveCurrentPrompt} disabled={!promptName.trim()}>Save</button>
              </div>
            </div>

            <textarea className="prompt-textarea" value={prompt} rows={18} spellCheck={false}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)} />

            <div className="prompt-footer">
              <button className="btn btn-ghost btn-sm" onClick={() => setPrompt(DEFAULT_PROMPT)}>
                Reset to default
              </button>
              <span className="text-muted char-count">{prompt.length} chars</span>
            </div>
          </section>
        </div>

        {/* ── Model + parameters ── */}
        <section className="card">
          <div className="section-title">Model &amp; Parameters</div>
          <div className="model-params-grid">
            <div className="models-col">
              <ModelSelector label="Model A" value={modelA} onChange={setModelA} />
              <label className="compare-toggle">
                <input type="checkbox" checked={compareMode} onChange={e => setCompareMode(e.target.checked)} />
                <span>Compare with a second model</span>
              </label>
              {compareMode && (
                <><hr className="compare-divider" /><ModelSelector label="Model B" value={modelB} onChange={setModelB} /></>
              )}
            </div>
            <div className="params-col">
              <div className="param-group">
                <label className="field-label" htmlFor="max-tokens">Max Tokens</label>
                <input id="max-tokens" className="input input-num" type="number"
                  min={1} max={32768} step={256} value={maxTokens}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setMaxTokens(Number(e.target.value))} />
              </div>
              <div className="param-group">
                <label className="field-label" htmlFor="temperature">Temperature</label>
                <input id="temperature" className="input input-num" type="number"
                  min={0} max={2} step={0.1} value={temperature}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setTemperature(Number(e.target.value))} />
              </div>
            </div>
          </div>
        </section>

        {/* ── Extract button ── */}
        <div className="extract-row">
          <button className="btn btn-primary btn-extract" onClick={handleExtract}
            disabled={isRunning || !image} title={!image ? 'Select an image first' : undefined}>
            {isRunning ? <><span className="spinner spinner-sm" />Extracting…</> : 'Extract'}
          </button>
        </div>

        {/* ── Results ── */}
        {(resultA || resultB || loadingA || loadingB) && (
          <div className={`results-section${compareMode ? ' results-compare' : ''}`}>
            <ResultPanel result={resultA} loading={loadingA} label="Model A" accuracy={accuracyA} />
            {compareMode && (
              <ResultPanel result={resultB} loading={loadingB} label="Model B" accuracy={accuracyB} />
            )}
          </div>
        )}
      </main>

      {/* Ground truth editor modal */}
      {gtEditorId && (() => {
        const entry = library.find(e => e.id === gtEditorId)
        return entry ? (
          <GroundTruthEditor entry={entry} onSave={handleSaveGroundTruth} onClose={() => setGtEditorId(null)} />
        ) : null
      })()}
    </div>
  )
}
