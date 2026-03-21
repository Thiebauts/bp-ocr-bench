import { useState, useRef, useEffect } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import type { ImageEntry, BenchmarkRun, BenchmarkImageResult, SavedPrompt } from './types'
import { SUGGESTED_MODELS, MODEL_PRESETS, PRICING_MAP } from './models'
import { pctColor, downloadBlob, compareReadings, estimateCost, fmtCost } from './utils'
import { callOpenRouter } from './api/openrouter'
import { getAllBenchmarkRuns, saveBenchmarkRun, deleteBenchmarkRun } from './db'

// ── Helpers ────────────────────────────────────────────────────────

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtPct(n: number | null): string {
  return n === null ? '—' : n.toFixed(0) + '%'
}

function fmtErr(n: number | null): string {
  return n === null ? '—' : '±' + n.toFixed(1)
}

function diffLabel(d: 1 | 2 | null): string {
  if (d === 1) return 'Expected'
  if (d === 2) return 'Challenging'
  return '—'
}

function autoRunName(models: string[]): string {
  const date = new Date().toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  const shortModels = models.map(m => m.split('/').pop() ?? m).join(', ')
  return `${date} — ${shortModels}`
}

// ── Per-model stats from a run ─────────────────────────────────────

interface ModelStats {
  model: string
  total: number
  withGT: number
  exactPct: number | null
  dayMatchCount: number | null   // images where day count matched
  avgSys: number | null
  avgDia: number | null
  avgCostPerRequest: number | null
  avgDurationMs: number | null
  byDiff: Record<'expected' | 'challenging', { count: number; exactPct: number | null; dayMatchCount: number | null }>
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function computeModelStatsByRun(results: BenchmarkImageResult[], model: string): ModelStats[] {
  const modelResults = results.filter(r => r.model === model)
  const runIndices = [...new Set(modelResults.map(r => r.runIndex ?? 0))].sort((a, b) => a - b)
  if (runIndices.length <= 1) return []
  return runIndices.map(ri =>
    computeModelStats(results.filter(r => (r.runIndex ?? 0) === ri), model)
  )
}

function computeModelStats(results: BenchmarkImageResult[], model: string): ModelStats {
  const rows   = results.filter(r => r.model === model)
  const withGT = rows.filter(r => r.hasGroundTruth)
  const paired = withGT.filter(r => r.accuracy && r.accuracy.pairedCount > 0)

  // Value accuracy — errored GT rows contribute 0 exact out of their GT values
  const totalExactValues  = paired.reduce((s, r) => s + r.accuracy!.totalExactValues, 0)
  const totalPairedValues = withGT.reduce((s, r) => s + (r.accuracy?.pairedValues ?? r.gtPairedValues ?? 0), 0)
  const totalPaired       = paired.reduce((s, r) => s + r.accuracy!.pairedCount, 0)
  const totalSys = paired.reduce((s, r) => s + (r.accuracy!.avgSysError ?? 0) * r.accuracy!.pairedCount, 0)
  const totalDia = paired.reduce((s, r) => s + (r.accuracy!.avgDiaError ?? 0) * r.accuracy!.pairedCount, 0)

  // Day count matches (errored results count as misses)
  const dayMatchCount = withGT.filter(r => r.accuracy?.dayCountMatch).length

  // Average duration per request
  const avgDurationMs = rows.length > 0
    ? rows.reduce((s, r) => s + r.duration_ms, 0) / rows.length
    : null

  // Average cost per request (across all images for this model)
  const costsWithData = rows.filter(r => r.usage && estimateCost(r.usage, model) !== null)
  const totalCost     = costsWithData.reduce((s, r) => s + (estimateCost(r.usage!, model) ?? 0), 0)
  const avgCostPerRequest = costsWithData.length > 0 ? totalCost / costsWithData.length : null

  const byDiff = {} as Record<'expected' | 'challenging', { count: number; exactPct: number | null; dayMatchCount: number | null }>
  for (const [key, diffs] of [['expected', [1]], ['challenging', [2]]] as [string, number[]][]) {
    const dr          = paired.filter(r => r.difficulty !== null && diffs.includes(r.difficulty))
    const drAll       = withGT.filter(r => r.difficulty !== null && diffs.includes(r.difficulty))
    const dExact      = dr.reduce((s, r) => s + r.accuracy!.totalExactValues, 0)
    const dPairedVals = drAll.reduce((s, r) => s + (r.accuracy?.pairedValues ?? r.gtPairedValues ?? 0), 0)
    const dDayMatch   = drAll.filter(r => r.accuracy?.dayCountMatch).length
    byDiff[key as 'expected' | 'challenging'] = {
      count: dr.length,
      exactPct:     dPairedVals > 0 ? (dExact / dPairedVals) * 100 : null,
      dayMatchCount: drAll.length > 0 ? dDayMatch : null,
    }
  }

  return {
    model,
    total: rows.length,
    withGT: withGT.length,
    exactPct:       totalPairedValues > 0 ? (totalExactValues / totalPairedValues) * 100 : null,
    dayMatchCount:  withGT.length > 0 ? dayMatchCount : null,
    avgSys:            totalPaired > 0 ? totalSys / totalPaired : null,
    avgDia:            totalPaired > 0 ? totalDia / totalPaired : null,
    avgCostPerRequest,
    avgDurationMs,
    byDiff,
  }
}

// ── Export ─────────────────────────────────────────────────────────

function exportRunMeta(run: BenchmarkRun) {
  const imageNames = [...new Set(run.results.map(r => r.imageName))]
  const meta = {
    run_name: run.name,
    run_date: new Date(run.timestamp).toISOString(),
    models: run.models,
    images: imageNames,
    max_tokens: run.maxTokens,
    temperature: run.temperature,
    repetitions: run.runsPerCombination ?? 1,
    prompt: run.prompt ?? '',
  }
  downloadBlob(
    new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }),
    `benchmark-${run.id}-meta.json`,
  )
}

function exportRunJSON(run: BenchmarkRun) {
  downloadBlob(
    new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }),
    `benchmark-${run.id}.json`,
  )
}

function exportModelCSV(run: BenchmarkRun, model: string) {
  const headers = [
    'image_name', 'difficulty', 'has_ground_truth',
    'exact_values', 'paired_values', 'exact_pct',
    'day_count_match', 'avg_sys_error', 'avg_dia_error',
    'prompt_tokens', 'completion_tokens', 'total_tokens', 'est_cost_usd',
    'error', 'duration_ms',
  ]
  const rows = run.results
    .filter(r => r.model === model)
    .map(r => {
      const cost = r.usage ? estimateCost(r.usage, model) : null
      return [
        r.imageName,
        r.difficulty ?? '',
        r.hasGroundTruth ? 'true' : 'false',
        r.accuracy?.totalExactValues ?? '',
        r.accuracy?.pairedValues ?? '',
        r.accuracy ? r.accuracy.exactPct.toFixed(2) : '',
        r.accuracy ? (r.accuracy.dayCountMatch ? 'true' : 'false') : '',
        r.accuracy?.avgSysError != null ? r.accuracy.avgSysError.toFixed(2) : '',
        r.accuracy?.avgDiaError != null ? r.accuracy.avgDiaError.toFixed(2) : '',
        r.usage?.prompt_tokens ?? '',
        r.usage?.completion_tokens ?? '',
        r.usage?.total_tokens ?? '',
        cost != null ? cost.toFixed(6) : '',
        r.error ?? '',
        r.duration_ms,
      ]
    })
  const csv = [headers, ...rows]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const slug = model.replace(/\//g, '-')
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `benchmark-${run.id}-${slug}.csv`)
}

function exportRunCSV(run: BenchmarkRun) {
  const headers = [
    'run_name', 'run_date', 'image_name', 'difficulty',
    'model', 'has_ground_truth', 'exact_pct',
    'avg_sys_error', 'avg_dia_error', 'error', 'duration_ms',
  ]
  const rows = run.results.map(r => [
    run.name,
    new Date(run.timestamp).toISOString(),
    r.imageName,
    r.difficulty ?? '',
    r.model,
    r.hasGroundTruth ? 'true' : 'false',
    r.accuracy ? r.accuracy.exactPct.toFixed(2) : '',
    r.accuracy?.avgSysError != null ? r.accuracy.avgSysError.toFixed(2) : '',
    r.accuracy?.avgDiaError != null ? r.accuracy.avgDiaError.toFixed(2) : '',
    r.error ?? '',
    r.duration_ms,
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `benchmark-${run.id}.csv`)
}

function exportSummaryCSV(run: BenchmarkRun, stats: ModelStats[]) {
  const headers = [
    'model', 'images', 'with_gt',
    'value_accuracy_pct', 'day_match', 'day_total',
    'avg_sys_error', 'avg_dia_error',
    'avg_cost_per_request_usd', 'avg_duration_ms',
    'expected_value_acc_pct', 'expected_day_match', 'expected_count',
    'challenging_value_acc_pct', 'challenging_day_match', 'challenging_count',
    'errors',
  ]
  const rows = stats.map(s => {
    const errors = run.results.filter(r => r.model === s.model && r.error).length
    return [
      s.model,
      s.total,
      s.withGT,
      s.exactPct != null ? s.exactPct.toFixed(2) : '',
      s.dayMatchCount ?? '',
      s.withGT,
      s.avgSys != null ? s.avgSys.toFixed(2) : '',
      s.avgDia != null ? s.avgDia.toFixed(2) : '',
      s.avgCostPerRequest != null ? s.avgCostPerRequest.toFixed(6) : '',
      s.avgDurationMs != null ? s.avgDurationMs.toFixed(0) : '',
      s.byDiff.expected.exactPct != null ? s.byDiff.expected.exactPct.toFixed(2) : '',
      s.byDiff.expected.dayMatchCount ?? '',
      s.byDiff.expected.count,
      s.byDiff.challenging.exactPct != null ? s.byDiff.challenging.exactPct.toFixed(2) : '',
      s.byDiff.challenging.dayMatchCount ?? '',
      s.byDiff.challenging.count,
      errors,
    ]
  })
  const csv = [headers, ...rows]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `benchmark-${run.id}-summary.csv`)
}

// ── Scatterplot ─────────────────────────────────────────────────────

const SCATTER_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
]

function BenchmarkScatterPlot({ modelStats }: { modelStats: ModelStats[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoveredModel, setHoveredModel] = useState<string | null>(null)

  const plottable = modelStats.filter(s => s.exactPct !== null && s.avgCostPerRequest !== null)
  if (plottable.length === 0) return null

  const W = 640, H = 360
  const M = { top: 24, right: 20, bottom: 52, left: 72 }
  const pw = W - M.left - M.right
  const ph = H - M.top - M.bottom

  // X-axis: start at min accuracy − 5%, never below 0
  const minAccuracy = Math.min(...plottable.map(s => s.exactPct!))
  const xMin = Math.max(0, minAccuracy - 5)
  const xRange = 100 - xMin
  const xScale = (v: number) => ((v - xMin) / xRange) * pw
  const xTickInterval = xRange <= 15 ? 5 : 10
  const firstXTick = Math.ceil(xMin / xTickInterval) * xTickInterval
  const xTicks: number[] = []
  for (let t = firstXTick; t <= 100; t += xTickInterval) xTicks.push(t)

  // Y-axis: log scale
  const costsPositive = plottable.map(s => s.avgCostPerRequest!).filter(c => c > 0)
  const minCostVal = costsPositive.length > 0 ? Math.min(...costsPositive) : 0.0001
  const maxCostVal = Math.max(...plottable.map(s => s.avgCostPerRequest!))
  const logMin = Math.floor(Math.log10(minCostVal))
  const logMax = Math.ceil(Math.log10(Math.max(maxCostVal, minCostVal))) + 0.3
  const logRange = logMax - logMin

  const yScale = (v: number): number => {
    if (v <= 0) return ph + 10
    return ph - ((Math.log10(v) - logMin) / logRange) * ph
  }

  const yTickExp: number[] = []
  for (let exp = logMin; exp <= Math.ceil(logMax); exp++) yTickExp.push(exp)
  const yTickVals = yTickExp.map(e => Math.pow(10, e))

  const fmtYTick = (v: number): string => {
    if (v <= 0) return '$0'
    const decimals = v < 0.001 ? 5 : v < 0.01 ? 4 : v < 0.1 ? 3 : 2
    return '$' + v.toFixed(decimals)
  }

  const durPositive = plottable.filter(s => (s.avgDurationMs ?? 0) > 0).map(s => s.avgDurationMs!)
  const maxDur = durPositive.length > 0 ? Math.max(...durPositive) : 0
  const minDur = durPositive.length > 0 ? Math.min(...durPositive) : 0
  const varyingDur = plottable.length > 1 && maxDur > minDur

  const circleR = (dur: number | null): number => {
    if (!varyingDur || dur === null || dur === 0) return 9
    return 5 + ((dur - minDur) / (maxDur - minDur)) * 12
  }

  const handleDownloadPNG = () => {
    if (!svgRef.current) return
    const svg = new XMLSerializer().serializeToString(svgRef.current)
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = W * scale; canvas.height = H * scale
    const ctx = canvas.getContext('2d')!
    const img = new Image()
    img.onload = () => {
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob(b => { if (b) downloadBlob(b, 'benchmark-scatter.png') })
    }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  }

  const handleDownloadSVG = () => {
    if (!svgRef.current) return
    const svg = new XMLSerializer().serializeToString(svgRef.current)
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'benchmark-scatter.svg')
  }

  return (
    <div className="scatter-section">
      <div className="scatter-header">
        <div className="section-title" style={{ marginBottom: 0 }}>Value Accuracy vs. Cost per Request</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={handleDownloadPNG}>PNG</button>
          <button className="btn btn-sm" onClick={handleDownloadSVG}>SVG</button>
        </div>
      </div>
      <svg ref={svgRef} width={W} height={H} xmlns="http://www.w3.org/2000/svg"
        style={{ maxWidth: '100%', height: 'auto', display: 'block' }}>
        <rect width={W} height={H} fill="#ffffff" rx="4" />

        {/* Axis titles */}
        <text x={M.left + pw / 2} y={H - 6} textAnchor="middle"
          fontSize={12} fill="#555" fontFamily="system-ui,sans-serif">
          Value Accuracy (%)
        </text>
        <text x={14} y={M.top + ph / 2} textAnchor="middle"
          fontSize={12} fill="#555" fontFamily="system-ui,sans-serif"
          transform={`rotate(-90,14,${M.top + ph / 2})`}>
          Cost / Request (USD, log scale)
        </text>

        <g transform={`translate(${M.left},${M.top})`}>
          {/* X-axis grid + labels */}
          {xTicks.map(t => (
            <g key={t}>
              <line x1={xScale(t)} y1={0} x2={xScale(t)} y2={ph} stroke="#f0f0f0" strokeWidth={1} />
              <line x1={xScale(t)} y1={ph} x2={xScale(t)} y2={ph + 4} stroke="#bbb" strokeWidth={1} />
              <text x={xScale(t)} y={ph + 15} textAnchor="middle"
                fontSize={10} fill="#888" fontFamily="system-ui,sans-serif">{t}%</text>
            </g>
          ))}

          {/* Y-axis grid + labels (log scale) */}
          {yTickVals.map((v, i) => {
            const y = yScale(v)
            if (y < 0 || y > ph) return null
            return (
              <g key={i}>
                <line x1={0} y1={y} x2={pw} y2={y} stroke="#f0f0f0" strokeWidth={1} />
                <line x1={-4} y1={y} x2={0} y2={y} stroke="#bbb" strokeWidth={1} />
                <text x={-8} y={y + 4} textAnchor="end"
                  fontSize={10} fill="#888" fontFamily="system-ui,sans-serif">{fmtYTick(v)}</text>
              </g>
            )
          })}

          {/* Axis lines */}
          <line x1={0} y1={ph} x2={pw} y2={ph} stroke="#ccc" strokeWidth={1.5} />
          <line x1={0} y1={0} x2={0} y2={ph} stroke="#ccc" strokeWidth={1.5} />

          {/* Data points */}
          {plottable.map((s, i) => {
            const cx = xScale(s.exactPct!)
            const cy = yScale(s.avgCostPerRequest!)
            const r = circleR(s.avgDurationMs)
            const color = SCATTER_COLORS[i % SCATTER_COLORS.length]
            const isHovered = hoveredModel === s.model
            const shortName = s.model.split('/').pop() ?? s.model
            return (
              <g key={s.model}
                onMouseEnter={() => setHoveredModel(s.model)}
                onMouseLeave={() => setHoveredModel(null)}
                style={{ cursor: 'default' }}>
                <circle cx={cx} cy={cy} r={isHovered ? r + 2 : r}
                  fill={color} fillOpacity={isHovered ? 1 : 0.8}
                  stroke={isHovered ? '#333' : color} strokeWidth={isHovered ? 2 : 1.5} />
                {isHovered && (() => {
                  const detail = `${fmtPct(s.exactPct)} · ${s.avgCostPerRequest != null ? fmtCost(s.avgCostPerRequest) : '—'}`
                  const tw = Math.max(shortName.length, detail.length) * 6.5 + 16
                  const th = 34
                  const flipX = cx + r + 6 + tw > pw
                  const flipY = cy - th < 0
                  const tx = flipX ? cx - r - 6 - tw : cx + r + 6
                  const ty = flipY ? cy + r + 6 : cy - th + 10
                  return (
                    <>
                      <rect x={tx} y={ty} width={tw} height={th} rx={4} fill="rgba(0,0,0,0.85)" />
                      <text x={tx + 8} y={ty + 14} fontSize={10} fill="#fff" fontFamily="system-ui,sans-serif" fontWeight="bold">
                        {shortName}
                      </text>
                      <text x={tx + 8} y={ty + 27} fontSize={9} fill="#ccc" fontFamily="system-ui,sans-serif">
                        {detail}
                      </text>
                    </>
                  )
                })()}
              </g>
            )
          })}
        </g>

      </svg>

      {/* Legend (HTML, below chart) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 8, fontSize: 11, fontFamily: 'system-ui, sans-serif' }}>
        {plottable.map((s, i) => {
          const color = SCATTER_COLORS[i % SCATTER_COLORS.length]
          const shortName = s.model.split('/').pop() ?? s.model
          const timeStr = s.avgDurationMs != null ? ` · ${(s.avgDurationMs / 1000).toFixed(1)}s` : ''
          const accStr = s.exactPct != null ? ` · ${fmtPct(s.exactPct)}` : ''
          return (
            <span key={s.model} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
              <span style={{ color: '#444' }}>{shortName}{accStr}{timeStr}</span>
            </span>
          )
        })}
      </div>
      {varyingDur && (
        <div style={{ fontSize: 9, color: '#888', marginTop: 4 }}>Dot size ∝ avg response time</div>
      )}
    </div>
  )
}

// ── Report component ───────────────────────────────────────────────

function BenchmarkReport({ run }: { run: BenchmarkRun }) {
  const [showPerImage, setShowPerImage] = useState(false)
  const [detailResult, setDetailResult] = useState<BenchmarkImageResult | null>(null)
  const [errorDetail, setErrorDetail] = useState<{ imageName: string; model: string; error: string } | null>(null)

  const modelStats = run.models.map(m => computeModelStats(run.results, m))
  const modelStatsByRun = run.models.reduce<Record<string, ModelStats[]>>((acc, m) => {
    acc[m] = computeModelStatsByRun(run.results, m)
    return acc
  }, {})

  // Unique images in this run
  const imageIds = [...new Set(run.results.map(r => r.imageId))]
  const imageNames: Record<string, string> = {}
  const imageDiff: Record<string, 1 | 2 | null> = {}
  for (const r of run.results) {
    imageNames[r.imageId] = r.imageName
    imageDiff[r.imageId] = r.difficulty
  }

  return (
    <div className="report-panel">
      {/* Run meta */}
      <div className="report-meta">
        <span className="report-meta-name">{run.name}</span>
        <span className="text-muted" style={{ fontSize: 12 }}>{fmtDate(run.timestamp)}</span>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {imageIds.length} image{imageIds.length !== 1 ? 's' : ''} · {run.models.length} model{run.models.length !== 1 ? 's' : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={() => exportSummaryCSV(run, modelStats)}>Summary CSV</button>
          <button className="btn btn-sm" onClick={() => exportRunCSV(run)}>Full CSV</button>
          <button className="btn btn-sm" onClick={() => exportRunMeta(run)}>Metadata</button>
          <button className="btn btn-sm" onClick={() => exportRunJSON(run)}>Raw JSON</button>
        </div>
      </div>

      {/* Summary table per model */}
      <div>
        <div className="section-title">Model Summary</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="report-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Images</th>
                <th>With GT</th>
                <th>Value acc.</th>
                <th>Day acc.</th>
                <th title="Average estimated cost for one image extraction with this model">Cost / request</th>
                <th title="Average response time per image">Avg time</th>
                <th>Avg sys err</th>
                <th>Avg dia err</th>
                <th title="Expected difficulty (1+2) — value / day accuracy">Expected</th>
                <th title="Challenging difficulty (3) — value / day accuracy">Challenging</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {modelStats.flatMap(s => {
                const perRun = modelStatsByRun[s.model] ?? []
                const multiRun = perRun.length > 1

                // Shared cell for expected/challenging/download (same in both paths)
                const diffCells = (['expected', 'challenging'] as const).map(d => (
                  <td key={d}>
                    {s.byDiff[d].count > 0 ? (
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        <span className="stat-pill" style={{ background: pctColor(s.byDiff[d].exactPct) + '22', color: pctColor(s.byDiff[d].exactPct), border: `1px solid ${pctColor(s.byDiff[d].exactPct)}44` }}>
                          {fmtPct(s.byDiff[d].exactPct)}
                        </span>
                        {' / '}
                        {(() => {
                          const dm = s.byDiff[d].dayMatchCount
                          const tot = s.byDiff[d].count
                          if (dm === null) return <span className="text-muted">—</span>
                          const color = dm === tot ? 'var(--success)' : dm === 0 ? 'var(--danger)' : 'var(--warning)'
                          return <span className="stat-pill" style={{ background: color + '22', color, border: `1px solid ${color}44` }}>{dm}/{tot}</span>
                        })()}
                      </span>
                    ) : <span className="text-muted">—</span>}
                  </td>
                ))

                // ── Single-run row ──────────────────────────────────────
                if (!multiRun) {
                  return [(
                    <tr key={s.model}>
                      <td><code className="model-id-badge">{s.model}</code></td>
                      <td>{s.total}</td>
                      <td>{s.withGT}</td>
                      <td>
                        <span className="stat-pill" style={{ background: pctColor(s.exactPct) + '22', color: pctColor(s.exactPct), border: `1px solid ${pctColor(s.exactPct)}44` }}>
                          {fmtPct(s.exactPct)}
                        </span>
                      </td>
                      <td>
                        {s.dayMatchCount !== null ? (() => {
                          const color = s.dayMatchCount === s.withGT ? 'var(--success)' : s.dayMatchCount === 0 ? 'var(--danger)' : 'var(--warning)'
                          return <span className="stat-pill" style={{ background: color + '22', color, border: `1px solid ${color}44` }}>{s.dayMatchCount}/{s.withGT}</span>
                        })() : <span className="text-muted">—</span>}
                      </td>
                      <td>
                        {s.avgCostPerRequest != null
                          ? <span className="cost-value" style={{ fontWeight: 600 }}>{fmtCost(s.avgCostPerRequest)}</span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {s.avgDurationMs != null ? <span>{(s.avgDurationMs / 1000).toFixed(1)}s</span> : <span className="text-muted">—</span>}
                      </td>
                      <td>{fmtErr(s.avgSys)}</td>
                      <td>{fmtErr(s.avgDia)}</td>
                      {diffCells}
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => exportModelCSV(run, s.model)} title={`Download CSV for ${s.model}`}>CSV</button>
                      </td>
                    </tr>
                  )]
                }

                // ── Multi-run: avg row + σ row + one row per run ────────
                const N = perRun.length
                const rowSpan = N + 2   // avg + σ + N runs
                const vs: CSSProperties = { verticalAlign: 'middle' }

                const sdExactPct = stdDev(perRun.map(rs => rs.exactPct).filter((v): v is number => v !== null))
                const sdDayPct   = stdDev(perRun.filter(rs => rs.dayMatchCount !== null && rs.withGT > 0).map(rs => (rs.dayMatchCount! / rs.withGT) * 100))
                const sdDuration = stdDev(perRun.map(rs => rs.avgDurationMs).filter((v): v is number => v !== null))
                const sdSys      = stdDev(perRun.map(rs => rs.avgSys).filter((v): v is number => v !== null))
                const sdDia      = stdDev(perRun.map(rs => rs.avgDia).filter((v): v is number => v !== null))

                const avgRow = (
                  <tr key={`${s.model}-avg`} className="report-row-multirun-avg">
                    <td rowSpan={rowSpan} style={vs}><code className="model-id-badge">{s.model}</code></td>
                    <td rowSpan={rowSpan} style={vs}>{`${s.total / N} × ${N}`}</td>
                    <td rowSpan={rowSpan} style={vs}>{s.withGT}</td>
                    <td>
                      <span className="stat-pill" style={{ fontSize: 14, background: pctColor(s.exactPct) + '22', color: pctColor(s.exactPct), border: `1px solid ${pctColor(s.exactPct)}44` }}>
                        {fmtPct(s.exactPct)}
                      </span>
                    </td>
                    <td>
                      {s.dayMatchCount !== null ? (() => {
                        const color = s.dayMatchCount === s.withGT ? 'var(--success)' : s.dayMatchCount === 0 ? 'var(--danger)' : 'var(--warning)'
                        return <span className="stat-pill" style={{ fontSize: 14, background: color + '22', color, border: `1px solid ${color}44` }}>{s.dayMatchCount}/{s.withGT}</span>
                      })() : <span className="text-muted">—</span>}
                    </td>
                    <td rowSpan={rowSpan} style={vs}>
                      {s.avgCostPerRequest != null
                        ? <span className="cost-value" style={{ fontWeight: 600 }}>{fmtCost(s.avgCostPerRequest)}</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {s.avgDurationMs != null
                        ? <span className="report-avg-value">{(s.avgDurationMs / 1000).toFixed(1)}s</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td><span className="report-avg-value">{fmtErr(s.avgSys)}</span></td>
                    <td><span className="report-avg-value">{fmtErr(s.avgDia)}</span></td>
                    {(['expected', 'challenging'] as const).map(d => (
                      <td key={d} rowSpan={rowSpan} style={vs}>
                        {s.byDiff[d].count > 0 ? (
                          <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                            <span className="stat-pill" style={{ background: pctColor(s.byDiff[d].exactPct) + '22', color: pctColor(s.byDiff[d].exactPct), border: `1px solid ${pctColor(s.byDiff[d].exactPct)}44` }}>
                              {fmtPct(s.byDiff[d].exactPct)}
                            </span>
                            {' / '}
                            {(() => {
                              const dm = s.byDiff[d].dayMatchCount
                              const tot = s.byDiff[d].count
                              if (dm === null) return <span className="text-muted">—</span>
                              const color = dm === tot ? 'var(--success)' : dm === 0 ? 'var(--danger)' : 'var(--warning)'
                              return <span className="stat-pill" style={{ background: color + '22', color, border: `1px solid ${color}44` }}>{dm}/{tot}</span>
                            })()}
                          </span>
                        ) : <span className="text-muted">—</span>}
                      </td>
                    ))}
                    <td rowSpan={rowSpan} style={{ ...vs, whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => exportModelCSV(run, s.model)} title={`Download CSV for ${s.model}`}>CSV</button>
                    </td>
                  </tr>
                )

                const sigmaRow = (
                  <tr key={`${s.model}-sigma`} className="report-row-sigma">
                    <td>{sdExactPct !== null && <span className="run-stddev-row">σ {sdExactPct.toFixed(1)}%</span>}</td>
                    <td>{sdDayPct   !== null && <span className="run-stddev-row">σ {sdDayPct.toFixed(1)}%</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{sdDuration !== null && <span className="run-stddev-row">σ {(sdDuration / 1000).toFixed(1)}s</span>}</td>
                    <td>{sdSys !== null && <span className="run-stddev-row">σ {sdSys.toFixed(1)}</span>}</td>
                    <td>{sdDia !== null && <span className="run-stddev-row">σ {sdDia.toFixed(1)}</span>}</td>
                  </tr>
                )

                const runRows = perRun.map((rs, i) => (
                  <tr key={`${s.model}-run${i}`} className={`report-row-subrun${i === N - 1 ? ' report-row-subrun--last' : ''}`}>
                    <td>
                      <span className="run-sub-num">#{i + 1}</span>
                      {rs.exactPct !== null
                        ? <span style={{ color: pctColor(rs.exactPct) }}>{fmtPct(rs.exactPct)}</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td>
                      {rs.dayMatchCount !== null ? (() => {
                        const c = rs.dayMatchCount === rs.withGT ? 'var(--success)' : rs.dayMatchCount === 0 ? 'var(--danger)' : 'var(--warning)'
                        return <span style={{ color: c }}>{rs.dayMatchCount}/{rs.withGT}</span>
                      })() : <span className="text-muted">—</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {rs.avgDurationMs != null ? `${(rs.avgDurationMs / 1000).toFixed(1)}s` : <span className="text-muted">—</span>}
                    </td>
                    <td>{fmtErr(rs.avgSys)}</td>
                    <td>{fmtErr(rs.avgDia)}</td>
                  </tr>
                ))

                return [avgRow, sigmaRow, ...runRows]
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Scatterplot */}
      <BenchmarkScatterPlot modelStats={modelStats} />

      {/* Per-image detail (collapsible) */}
      <details open={showPerImage} onToggle={e => setShowPerImage((e.target as HTMLDetailsElement).open)}>
        <summary className="report-detail-summary">Per-image details</summary>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table className="report-table report-table--image">
            <thead>
              <tr>
                <th>Image</th>
                <th>Difficulty</th>
                <th>Model</th>
                <th>GT</th>
                <th>Values</th>
                <th>Exact %</th>
                <th>Days</th>
                <th>Avg sys err</th>
                <th>Avg dia err</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {imageIds.flatMap(imageId =>
                run.models.flatMap(model => {
                  const allRuns = run.results.filter(x => x.imageId === imageId && x.model === model)
                  if (allRuns.length === 0) return []

                  // Single run — original layout
                  if (allRuns.length === 1) {
                    const r = allRuns[0]
                    const acc = r.accuracy
                    const isErrorWithGT = !acc && r.hasGroundTruth && r.error
                    const pct = acc ? acc.exactPct : isErrorWithGT ? 0 : null
                    const valLabel = acc
                      ? `${acc.totalExactValues}/${acc.pairedValues}`
                      : isErrorWithGT ? `0/${r.gtPairedValues}` : null
                    return [(
                      <tr key={`${imageId}-${model}`} className={r.error ? 'report-row-error' : ''}>
                        <td title={r.imageName} className="report-image-name"
                          onClick={() => r.accuracy && setDetailResult(r)}
                          style={r.accuracy ? { cursor: 'pointer' } : undefined}>
                          {r.imageName}
                        </td>
                        <td>
                          {r.difficulty ? (
                            <span className={`difficulty-badge difficulty-badge--${r.difficulty}`}>
                              {diffLabel(r.difficulty)}
                            </span>
                          ) : <span className="text-muted">—</span>}
                        </td>
                        <td><code style={{ fontSize: 11 }}>{r.model.split('/').pop()}</code></td>
                        <td>
                          {r.hasGroundTruth
                            ? <span className="gt-badge">yes</span>
                            : <span className="text-muted">no</span>}
                        </td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                          {valLabel ?? <span className="text-muted">—</span>}
                        </td>
                        <td>
                          {pct !== null ? (
                            <span className="stat-pill" style={{ background: pctColor(pct) + '22', color: pctColor(pct), border: `1px solid ${pctColor(pct)}44` }}>
                              {fmtPct(pct)}
                            </span>
                          ) : <span className="text-muted">—</span>}
                        </td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                          {acc ? (
                            <span style={{ color: acc.dayCountMatch ? 'var(--success)' : 'var(--warning)' }}>
                              {acc.extDayCount}/{acc.gtDayCount}
                              {acc.dayCountMatch ? ' ✓' : ' ⚠'}
                            </span>
                          ) : isErrorWithGT
                            ? <span style={{ color: 'var(--danger)' }}>0/{Math.round(r.gtPairedValues / 2)} ⚠</span>
                            : <span className="text-muted">—</span>}
                        </td>
                        <td>{fmtErr(r.accuracy?.avgSysError ?? null)}</td>
                        <td>{fmtErr(r.accuracy?.avgDiaError ?? null)}</td>
                        <td>
                          {r.error
                            ? <span style={{ color: 'var(--danger)', cursor: 'pointer', textDecoration: 'underline' }}
                                onClick={() => setErrorDetail({ imageName: r.imageName, model: r.model, error: r.error! })}>Error</span>
                            : r.hasGroundTruth
                              ? <span style={{ color: 'var(--success)' }}>✓</span>
                              : <span className="text-muted">No GT</span>}
                        </td>
                      </tr>
                    )]
                  }

                  // Multiple runs — average row + individual run sub-rows
                  const first = allRuns[0]
                  const validRuns = allRuns.filter(r => r.accuracy)
                  const totalExact = validRuns.reduce((s, r) => s + r.accuracy!.totalExactValues, 0)
                  const totalPaired = validRuns.reduce((s, r) => s + r.accuracy!.pairedValues, 0)
                  const avgExactPct = totalPaired > 0 ? (totalExact / totalPaired) * 100 : null
                  const dayMatchCount = validRuns.filter(r => r.accuracy!.dayCountMatch).length
                  const sysErrs = validRuns.filter(r => r.accuracy!.avgSysError != null).map(r => r.accuracy!.avgSysError!)
                  const diaErrs = validRuns.filter(r => r.accuracy!.avgDiaError != null).map(r => r.accuracy!.avgDiaError!)
                  const avgSysErr = sysErrs.length > 0 ? sysErrs.reduce((a, b) => a + b, 0) / sysErrs.length : null
                  const avgDiaErr = diaErrs.length > 0 ? diaErrs.reduce((a, b) => a + b, 0) / diaErrs.length : null
                  const gtDayCount = validRuns[0]?.accuracy?.gtDayCount ?? null

                  const avgRow = (
                    <tr key={`${imageId}-${model}-avg`} className="report-row-avg">
                      <td title={first.imageName} className="report-image-name"
                        onClick={() => { const vr = validRuns[0]; if (vr?.accuracy) setDetailResult(vr) }}
                        style={validRuns.some(r => r.accuracy) ? { cursor: 'pointer' } : undefined}>
                        {first.imageName}
                      </td>
                      <td>
                        {first.difficulty ? (
                          <span className={`difficulty-badge difficulty-badge--${first.difficulty}`}>
                            {diffLabel(first.difficulty)}
                          </span>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td>
                        <code style={{ fontSize: 11 }}>{first.model.split('/').pop()}</code>
                        <span className="run-avg-label">avg {allRuns.length} runs</span>
                      </td>
                      <td>
                        {first.hasGroundTruth
                          ? <span className="gt-badge">yes</span>
                          : <span className="text-muted">no</span>}
                      </td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {totalPaired > 0 ? `${totalExact}/${totalPaired}` : <span className="text-muted">—</span>}
                      </td>
                      <td>
                        {avgExactPct !== null ? (
                          <span className="stat-pill" style={{ background: pctColor(avgExactPct) + '22', color: pctColor(avgExactPct), border: `1px solid ${pctColor(avgExactPct)}44` }}>
                            {fmtPct(avgExactPct)}
                          </span>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {gtDayCount !== null ? (
                          <span style={{ color: dayMatchCount === validRuns.length ? 'var(--success)' : dayMatchCount === 0 ? 'var(--danger)' : 'var(--warning)' }}>
                            {dayMatchCount}/{validRuns.length} runs
                          </span>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td>{fmtErr(avgSysErr)}</td>
                      <td>{fmtErr(avgDiaErr)}</td>
                      <td>
                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{allRuns.length} runs</span>
                      </td>
                    </tr>
                  )

                  const subRows = allRuns.map((r, i) => {
                    const acc = r.accuracy
                    const subIsErrorWithGT = !acc && r.hasGroundTruth && r.error
                    const pct = acc ? acc.exactPct : subIsErrorWithGT ? 0 : null
                    const subValLabel = acc
                      ? `${acc.totalExactValues}/${acc.pairedValues}`
                      : subIsErrorWithGT ? `0/${r.gtPairedValues}` : null
                    return (
                      <tr key={`${imageId}-${model}-run${i}`} className={`report-row-subrun${r.error ? ' report-row-error' : ''}`}>
                        <td />
                        <td />
                        <td onClick={() => acc && setDetailResult(r)}
                          style={acc ? { cursor: 'pointer' } : undefined}>
                          <span className="run-sub-label">Run {i + 1}</span>
                        </td>
                        <td />
                        <td className="nowrap">
                          {subValLabel ?? '—'}
                        </td>
                        <td>
                          {pct !== null ? (
                            <span style={{ color: pctColor(pct) }}>{fmtPct(pct)}</span>
                          ) : <span>—</span>}
                        </td>
                        <td className="nowrap">
                          {acc ? (
                            <span style={{ color: acc.dayCountMatch ? 'var(--success)' : 'var(--warning)' }}>
                              {acc.extDayCount}/{acc.gtDayCount}
                              {acc.dayCountMatch ? ' ✓' : ' ⚠'}
                            </span>
                          ) : subIsErrorWithGT
                            ? <span style={{ color: 'var(--danger)' }}>0/{Math.round(r.gtPairedValues / 2)} ⚠</span>
                            : '—'}
                        </td>
                        <td>{fmtErr(r.accuracy?.avgSysError ?? null)}</td>
                        <td>{fmtErr(r.accuracy?.avgDiaError ?? null)}</td>
                        <td>
                          {r.error
                            ? <span style={{ color: 'var(--danger)', cursor: 'pointer', textDecoration: 'underline' }}
                                onClick={() => setErrorDetail({ imageName: r.imageName, model: r.model, error: r.error! })}>Error</span>
                            : r.hasGroundTruth
                              ? <span style={{ color: 'var(--success)' }}>✓</span>
                              : <span>No GT</span>}
                        </td>
                      </tr>
                    )
                  })

                  return [avgRow, ...subRows]
                })
              )}
            </tbody>
          </table>
        </div>
      </details>

      {/* Error detail modal */}
      {errorDetail && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setErrorDetail(null) }}>
          <div className="benchmark-detail-modal" style={{ maxWidth: 560 }}>
            <div className="modal-editor-header">
              <h2>Error details</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setErrorDetail(null)}>✕</button>
            </div>
            <p style={{ margin: '8px 0 4px', fontSize: 13 }}>
              <strong>{errorDetail.imageName}</strong> — <code style={{ fontSize: 12 }}>{errorDetail.model}</code>
            </p>
            <pre className="raw-pre" style={{ marginTop: 8 }}>{errorDetail.error}</pre>
          </div>
        </div>
      )}

      {/* Per-reading comparison modal */}
      {detailResult?.accuracy && (() => {
        const acc = detailResult.accuracy!
        return (
          <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setDetailResult(null) }}>
            <div className="benchmark-detail-modal">
              <div className="modal-editor-header">
                <h2>{detailResult.imageName} — {detailResult.model.split('/').pop()}
                  {detailResult.runIndex != null && <span className="text-muted"> (run {detailResult.runIndex + 1})</span>}
                </h2>
                <button className="btn btn-ghost btn-sm" onClick={() => setDetailResult(null)}>✕</button>
              </div>

              <div className="accuracy-summary-bar" style={{ marginBottom: 12 }}>
                <div className="accuracy-pct-block">
                  <span className="accuracy-pct" style={{ color: pctColor(acc.exactPct) }}>
                    {acc.exactPct.toFixed(0)}%
                  </span>
                  <span className="accuracy-pct-label">values</span>
                </div>
                <div className="accuracy-pct-block">
                  <span className="accuracy-pct" style={{ color: acc.dayCountMatch ? 'var(--success)' : 'var(--danger)' }}>
                    {acc.dayCountMatch ? 'Yes' : 'No'}
                  </span>
                  <span className="accuracy-pct-label">days</span>
                </div>
                <div className="accuracy-summary-text">
                  <strong>{acc.totalExactValues}/{acc.pairedValues} exact values</strong>
                  <span className="text-muted">
                    &ensp;({acc.exactMatches}/{acc.pairedCount} full readings)
                  </span>
                  {acc.avgSysError !== null && (
                    <span className="text-muted">
                      &ensp;·&ensp;sys ±{acc.avgSysError.toFixed(1)}&ensp;dia ±{acc.avgDiaError!.toFixed(1)} mmHg
                    </span>
                  )}
                  <span className={acc.dayCountMatch ? 'text-muted' : 'accuracy-mismatch'}>
                    &ensp;·&ensp;{acc.extDayCount}/{acc.gtDayCount} day{acc.gtDayCount !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

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
                    {acc.perReading.map((r, i) => (
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
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── Main BenchmarkTab ──────────────────────────────────────────────

interface BenchmarkTabProps {
  library: ImageEntry[]
  apiKey: string
  prompt: string           // current extraction prompt (used as default)
  savedPrompts: SavedPrompt[]
  onLibraryUpdate: (entries: ImageEntry[]) => void
}

export function BenchmarkTab({ library, apiKey, prompt, savedPrompts }: BenchmarkTabProps) {
  // Prompt — starts with the current extraction prompt, can be switched to a saved one
  const [activePrompt, setActivePrompt] = useState(prompt)
  const [selectedPromptId, setSelectedPromptId] = useState<string>('__current__')

  // Setup state
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>(['anthropic/claude-sonnet-4.6'])
  const [customModelInput, setCustomModelInput] = useState('')
  const [maxTokens, setMaxTokens] = useState(4096)
  const [temperature, setTemperature] = useState(0)
  const [runsPerCombination, setRunsPerCombination] = useState(1)
  const [concurrency, setConcurrency] = useState(3)
  const [runName, setRunName] = useState('')

  // Run state
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<{
    completed: number; total: number; running: string[]
  } | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // History state
  const [runs, setRuns] = useState<BenchmarkRun[]>([])
  const [runsReady, setRunsReady] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)

  useEffect(() => {
    getAllBenchmarkRuns()
      .then(r => { setRuns(r); setRunsReady(true) })
      .catch(() => setRunsReady(true))
  }, [])

  // ── Derived ──────────────────────────────────────────────────────

  const activeRun = runs.find(r => r.id === activeRunId) ?? null
  const imagesWithGT = library.filter(e => e.groundTruth && e.groundTruth.length > 0)
  const selectedWithGT = selectedImageIds.filter(id => imagesWithGT.some(e => e.id === id))

  // ── Image selection ───────────────────────────────────────────────

  const toggleImage = (id: string) =>
    setSelectedImageIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )

  const selectAll = () => setSelectedImageIds(imagesWithGT.map(e => e.id))
  const selectNone = () => setSelectedImageIds([])

  // ── Model management ──────────────────────────────────────────────

  const addModel = (id: string) => {
    if (!id.trim() || selectedModels.includes(id.trim())) return
    setSelectedModels(prev => [...prev, id.trim()])
  }

  const removeModel = (id: string) =>
    setSelectedModels(prev => prev.filter(m => m !== id))

  // ── Run ───────────────────────────────────────────────────────────

  const handleRun = async () => {
    if (!apiKey.trim()) { setRunError('Enter your OpenRouter API key first.'); return }
    if (selectedImageIds.length === 0) { setRunError('Select at least one image.'); return }
    if (selectedModels.length === 0) { setRunError('Add at least one model.'); return }
    if (selectedWithGT.length === 0) { setRunError('None of the selected images have ground truth set. Add ground truth first.'); return }

    setRunError(null)
    setIsRunning(true)
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    const imagesToTest = library.filter(e => selectedImageIds.includes(e.id))

    // Build flat task list in deterministic order
    type Task = { image: typeof imagesToTest[0]; model: string; runIdx: number }
    const tasks: Task[] = []
    for (const image of imagesToTest)
      for (const model of selectedModels)
        for (let runIdx = 0; runIdx < runsPerCombination; runIdx++)
          tasks.push({ image, model, runIdx })

    const total = tasks.length
    const resultSlots: (BenchmarkImageResult | undefined)[] = new Array(total)
    let completed = 0
    let nextIndex = 0
    const runningLabels = new Map<number, string>()

    const updateProgress = () => setProgress({
      completed, total, running: [...runningLabels.values()],
    })

    updateProgress()

    const executeTask = async (taskIdx: number) => {
      const { image, model, runIdx } = tasks[taskIdx]
      const shortModel = model.split('/').pop() ?? model
      const label = runsPerCombination > 1
        ? `${image.name} · ${shortModel} · run ${runIdx + 1}/${runsPerCombination}`
        : `${image.name} · ${shortModel}`

      runningLabels.set(taskIdx, label)
      updateProgress()

      const start = Date.now()
      let result: BenchmarkImageResult
      try {
        const r = await callOpenRouter({
          apiKey: apiKey.trim(),
          model,
          prompt: activePrompt,
          imageBase64: image.base64,
          imageMimeType: image.mimeType,
          maxTokens,
          temperature,
          signal,
        })
        const accuracy = (r.data && image.groundTruth && image.groundTruth.length > 0)
          ? compareReadings(r.data, image.groundTruth)
          : null
        const gtReadings = image.groundTruth?.reduce((s, d) => s + d.measurements.length, 0) ?? 0
        result = {
          imageId: image.id, imageName: image.name,
          difficulty: image.difficulty ?? null, model,
          hasGroundTruth: !!(image.groundTruth && image.groundTruth.length > 0),
          gtPairedValues: gtReadings * 2,
          accuracy, usage: r.usage, error: r.error,
          duration_ms: Date.now() - start, runIndex: runIdx,
        }
      } catch (err) {
        const gtReadings = image.groundTruth?.reduce((s, d) => s + d.measurements.length, 0) ?? 0
        result = {
          imageId: image.id, imageName: image.name,
          difficulty: image.difficulty ?? null, model,
          hasGroundTruth: !!(image.groundTruth && image.groundTruth.length > 0),
          gtPairedValues: gtReadings * 2,
          accuracy: null, error: (err as Error).message,
          duration_ms: Date.now() - start, runIndex: runIdx,
        }
      }

      resultSlots[taskIdx] = result
      runningLabels.delete(taskIdx)
      completed++
      updateProgress()
    }

    // Pool: each worker grabs the next available task until all are done or aborted
    const worker = async () => {
      while (!signal.aborted) {
        const idx = nextIndex++
        if (idx >= tasks.length) break
        await executeTask(idx)
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker))

    const results = resultSlots.filter((r): r is BenchmarkImageResult => r !== undefined)

    const run: BenchmarkRun = {
      id: crypto.randomUUID(),
      name: runName.trim() || autoRunName(selectedModels),
      timestamp: Date.now(),
      models: selectedModels,
      selectedImageIds: imagesToTest.map(e => e.id),
      results,
      prompt: activePrompt,
      maxTokens,
      temperature,
      runsPerCombination,
    }

    await saveBenchmarkRun(run)
    setRuns(prev => [run, ...prev])
    setActiveRunId(run.id)
    setProgress(null)
    setIsRunning(false)
    setRunName('')
  }

  const handleAbort = () => { abortRef.current?.abort() }

  const handleDeleteRun = async (id: string) => {
    await deleteBenchmarkRun(id)
    setRuns(prev => prev.filter(r => r.id !== id))
    if (activeRunId === id) setActiveRunId(null)
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="benchmark-root">
      <div className="benchmark-layout">

        {/* ── Left: Setup + History ── */}
        <aside className="benchmark-sidebar">

          {/* Image selector */}
          <div className="card benchmark-setup-card">
            <div className="section-title">Images to test</div>
            <div className="bench-selection-header">
              <span className="text-muted" style={{ fontSize: 12 }}>
                Only images with ground truth can be tested
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={selectAll}
                  disabled={isRunning}>All</button>
                <button className="btn btn-ghost btn-sm" onClick={selectNone}
                  disabled={isRunning}>None</button>
              </div>
            </div>

            {library.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>No images in library.</p>
            ) : (
              <div className="image-selector-list">
                {library.map(entry => {
                  const hasGT = !!(entry.groundTruth && entry.groundTruth.length > 0)
                  const checked = selectedImageIds.includes(entry.id)
                  return (
                    <label key={entry.id}
                      className={`image-selector-row${!hasGT ? ' image-selector-row--no-gt' : ''}`}>
                      <input type="checkbox" checked={checked && hasGT}
                        disabled={!hasGT || isRunning}
                        onChange={() => hasGT && toggleImage(entry.id)} />
                      <img src={`data:${entry.mimeType};base64,${entry.base64}`}
                        alt="" className="image-selector-thumb" />
                      <div className="image-selector-info">
                        <span className="image-selector-name" title={entry.name}>{entry.name}</span>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {hasGT
                            ? <span className="gt-badge">GT</span>
                            : <span className="text-muted" style={{ fontSize: 10 }}>no GT</span>}
                          {entry.difficulty && (
                            <span className={`difficulty-badge difficulty-badge--${entry.difficulty}`}>
                              {diffLabel(entry.difficulty)}
                            </span>
                          )}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              {selectedWithGT.length} / {imagesWithGT.length} images with GT selected
            </div>
          </div>

          {/* Model selector */}
          <div className="card benchmark-setup-card">
            <div className="section-title">Models to test</div>
            <div className="model-add-row" style={{ marginBottom: 8 }}>
              <select className="select select-sm" style={{ flex: 1 }}
                value=""
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  const preset = MODEL_PRESETS.find(p => p.name === e.target.value)
                  if (preset) setSelectedModels(preset.models)
                  e.target.value = ''
                }}
                disabled={isRunning}>
                <option value="">Load preset…</option>
                {MODEL_PRESETS.map(p => (
                  <option key={p.name} value={p.name}>{p.name} ({p.models.length})</option>
                ))}
              </select>
              {selectedModels.length > 0 && (
                <button className="btn btn-sm btn-ghost" disabled={isRunning}
                  onClick={() => setSelectedModels([])}>Clear all</button>
              )}
            </div>
            <div className="model-list">
              {selectedModels.map(m => (
                <div key={m} className="model-list-row">
                  <code className="model-list-id">{m}</code>
                  <button className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => removeModel(m)} disabled={isRunning}>×</button>
                </div>
              ))}
            </div>
            <div className="model-add-row">
              <select className="select select-sm" style={{ flex: 1 }}
                value=""
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  if (e.target.value) { addModel(e.target.value); e.target.value = '' }
                }}
                disabled={isRunning}>
                <option value="">Add from list…</option>
                {SUGGESTED_MODELS.map(group => (
                  <optgroup key={group.group} label={group.group}>
                    {group.models.map(m => (
                      <option key={m.id} value={m.id}
                        disabled={selectedModels.includes(m.id)}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="model-add-row">
              <input className="input input-sm" style={{ flex: 1 }}
                placeholder="Or type custom model ID…"
                value={customModelInput}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCustomModelInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { addModel(customModelInput); setCustomModelInput('') } }}
                disabled={isRunning} />
              <button className="btn btn-sm" disabled={!customModelInput.trim() || isRunning}
                onClick={() => { addModel(customModelInput); setCustomModelInput('') }}>
                Add
              </button>
            </div>
          </div>

          {/* Params + run */}
          <div className="card benchmark-setup-card">
            <div className="section-title">Run settings</div>

            {/* Prompt selector */}
            <div style={{ marginBottom: 12 }}>
              <label className="field-label" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Prompt
              </label>
              <select className="select select-sm" style={{ width: '100%' }}
                value={selectedPromptId}
                disabled={isRunning}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  const id = e.target.value
                  setSelectedPromptId(id)
                  if (id === '__current__') {
                    setActivePrompt(prompt)
                  } else {
                    const found = savedPrompts.find(p => p.id === id)
                    if (found) setActivePrompt(found.content)
                  }
                }}>
                <option value="__current__">Current extraction prompt</option>
                {savedPrompts.length > 0 && (
                  <optgroup label="Saved prompts">
                    {savedPrompts.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {selectedPromptId !== '__current__' && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                    Preview prompt
                  </summary>
                  <pre style={{
                    marginTop: 4, padding: '8px 10px', fontSize: 11,
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word', maxHeight: 140, overflowY: 'auto',
                    color: 'var(--text)',
                  }}>{activePrompt}</pre>
                </details>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div className="param-group">
                <label className="field-label" style={{ fontSize: 12 }}>Max tokens</label>
                <input className="input input-num" type="number"
                  min={1} max={32768} step={256} value={maxTokens}
                  disabled={isRunning}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setMaxTokens(Number(e.target.value))} />
              </div>
              <div className="param-group">
                <label className="field-label" style={{ fontSize: 12 }}>Temperature</label>
                <input className="input input-num" type="number"
                  min={0} max={2} step={0.1} value={temperature}
                  disabled={isRunning}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setTemperature(Number(e.target.value))} />
              </div>
              <div className="param-group">
                <label className="field-label" style={{ fontSize: 12 }} title="Run each image × model combination this many times and report averages">Repetitions</label>
                <input className="input input-num" type="number"
                  min={1} max={10} step={1} value={runsPerCombination}
                  disabled={isRunning}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setRunsPerCombination(Math.max(1, Math.min(10, Number(e.target.value))))} />
              </div>
              <div className="param-group">
                <label className="field-label" style={{ fontSize: 12 }} title="How many API calls to run at the same time">Concurrent</label>
                <input className="input input-num" type="number"
                  min={1} max={10} step={1} value={concurrency}
                  disabled={isRunning}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setConcurrency(Math.max(1, Math.min(10, Number(e.target.value))))} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label className="field-label" style={{ fontSize: 12 }}>Run name (optional)</label>
              <input className="input input-sm" style={{ marginTop: 4 }}
                placeholder="Auto-generated if blank"
                value={runName}
                disabled={isRunning}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setRunName(e.target.value)} />
            </div>

            {/* Cost estimate */}
            {selectedModels.length > 0 && selectedWithGT.length > 0 && (() => {
              const EST_INPUT_TOKENS = 5000
              const EST_OUTPUT_TOKENS = 500
              const totalRequests = selectedWithGT.length * selectedModels.length * runsPerCombination
              let totalEstCost = 0
              let modelsWithPricing = 0
              for (const m of selectedModels) {
                const p = PRICING_MAP[m]
                if (p && p.input !== null) {
                  modelsWithPricing++
                  totalEstCost += selectedWithGT.length * runsPerCombination * (
                    (EST_INPUT_TOKENS / 1_000_000) * p.input +
                    (EST_OUTPUT_TOKENS / 1_000_000) * (p.output ?? 0)
                  )
                }
              }
              return (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  <strong>{totalRequests}</strong> API calls
                  ({selectedWithGT.length} image{selectedWithGT.length !== 1 ? 's' : ''} × {selectedModels.length} model{selectedModels.length !== 1 ? 's' : ''}{runsPerCombination > 1 ? ` × ${runsPerCombination} runs` : ''})
                  {modelsWithPricing > 0 && (
                    <> · est. <strong style={{ color: 'var(--text)' }}>{fmtCost(totalEstCost)}</strong>
                    {modelsWithPricing < selectedModels.length && <> ({modelsWithPricing}/{selectedModels.length} models with known pricing)</>}
                    </>
                  )}
                </div>
              )
            })()}

            {runError && (
              <div className="error-box" style={{ marginTop: 10, fontSize: 13 }}>{runError}</div>
            )}

            {/* Progress */}
            {isRunning && progress && (
              <div className="bench-progress">
                <div className="bench-progress-bar">
                  <div className="bench-progress-fill"
                    style={{ width: `${(progress.completed / progress.total) * 100}%` }} />
                </div>
                <div className="bench-progress-text">
                  <span>{progress.completed} / {progress.total}</span>
                  <span className="text-muted" style={{ fontSize: 11 }}>
                    {progress.running.length > 0 ? progress.running[0] : ''}
                    {progress.running.length > 1 ? ` +${progress.running.length - 1}` : ''}
                  </span>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ flex: 1 }}
                onClick={handleRun}
                disabled={isRunning || selectedWithGT.length === 0 || selectedModels.length === 0}>
                {isRunning ? 'Running…' : 'Run benchmark'}
              </button>
              {isRunning && (
                <button className="btn btn-danger" onClick={handleAbort}>Stop</button>
              )}
            </div>
          </div>

          {/* Past runs */}
          <div className="card benchmark-setup-card">
            <div className="section-title">Past runs</div>
            {!runsReady ? (
              <p className="text-muted" style={{ fontSize: 13 }}>Loading…</p>
            ) : runs.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>No runs yet.</p>
            ) : (
              <div className="runs-history">
                {runs.map(r => (
                  <div key={r.id}
                    className={`run-history-row${activeRunId === r.id ? ' run-history-row--active' : ''}`}
                    onClick={() => setActiveRunId(r.id)}>
                    <div className="run-history-name">{r.name}</div>
                    <div className="run-history-meta">
                      <span>{fmtDate(r.timestamp)}</span>
                      <span className="text-muted">
                        {r.selectedImageIds.length} img · {r.models.length} model{r.models.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <button className="btn btn-ghost btn-sm btn-danger run-history-delete"
                      onClick={e => { e.stopPropagation(); handleDeleteRun(r.id) }}
                      title="Delete run">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* ── Right: Report ── */}
        <main className="benchmark-report-area">
          {activeRun ? (
            <BenchmarkReport run={activeRun} />
          ) : (
            <div className="benchmark-empty-report">
              <p>Select a past run on the left to view its report,<br />or run a new benchmark to generate one.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
