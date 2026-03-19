import type { DayReading, Measurement, AccuracyResult, PerReadingComparison, ModelState } from './types'
import { PRICING_MAP } from './models'

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function pctColor(pct: number | null): string {
  if (pct === null) return 'var(--text-muted)'
  if (pct >= 90) return 'var(--success)'
  if (pct >= 70) return 'var(--warning)'
  return 'var(--danger)'
}

export function fmtPrice(p: number | null): string {
  if (p === null) return '?'
  return '$' + parseFloat(p.toFixed(4)).toString()
}

export function estimateCost(usage: { prompt_tokens?: number; completion_tokens?: number }, modelId: string): number | null {
  const pricing = PRICING_MAP[modelId]
  if (!pricing || pricing.input === null || !usage.prompt_tokens || !usage.completion_tokens) return null
  return (usage.prompt_tokens / 1_000_000) * pricing.input +
         (usage.completion_tokens / 1_000_000) * (pricing.output ?? 0)
}

export function fmtCost(cost: number): string {
  if (cost < 0.000_01) return '<$0.00001'
  if (cost < 0.001)    return '$' + cost.toFixed(5)
  if (cost < 0.01)     return '$' + cost.toFixed(4)
  return '$' + cost.toFixed(3)
}

export function getEffectiveModelId(m: ModelState): string {
  return m.selected === 'custom' ? m.custom.trim() : m.selected
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function base64ToObjectUrl(base64: string, mimeType: string): string {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return URL.createObjectURL(new Blob([arr], { type: mimeType }))
}

export function compareReadings(extracted: DayReading[], groundTruth: DayReading[]): AccuracyResult {
  // Try label-based matching first; fall back to positional if no labels match
  const extByLabel = new Map<string, Measurement[]>()
  for (const d of extracted) extByLabel.set(d.day_label.trim().toLowerCase(), d.measurements)
  const useLabels = groundTruth.some(d => extByLabel.has(d.day_label.trim().toLowerCase()))

  let exactPairs = 0, sysExactTotal = 0, diaExactTotal = 0
  let totalSysErr = 0, totalDiaErr = 0, pairedCount = 0
  const perReading: PerReadingComparison[] = []

  for (let di = 0; di < groundTruth.length; di++) {
    const gtDay = groundTruth[di]
    const extMeasurements = useLabels
      ? extByLabel.get(gtDay.day_label.trim().toLowerCase()) ?? []
      : di < extracted.length ? extracted[di].measurements : []
    for (let i = 0; i < gtDay.measurements.length; i++) {
      const g = gtDay.measurements[i]
      const e = i < extMeasurements.length ? extMeasurements[i] : null
      const deltaSys = e !== null ? e.systolic  - g.systolic  : null
      const deltaDia = e !== null ? e.diastolic - g.diastolic : null
      const sysExact = deltaSys === 0
      const diaExact = deltaDia === 0
      const isExact  = sysExact && diaExact

      if (e !== null) {
        pairedCount++
        if (isExact) exactPairs++
        sysExactTotal += sysExact ? 1 : 0
        diaExactTotal += diaExact ? 1 : 0
        totalSysErr += Math.abs(deltaSys!)
        totalDiaErr += Math.abs(deltaDia!)
      }

      perReading.push({
        gtDay: gtDay.day_label, gtTime: g.time_label, gtSys: g.systolic, gtDia: g.diastolic,
        extSys: e?.systolic ?? null, extDia: e?.diastolic ?? null,
        deltaSys, deltaDia, sysExact, diaExact, exact: isExact,
      })
    }
  }

  const gtTotalReadings  = groundTruth.reduce((s, d) => s + d.measurements.length, 0)
  const extTotalReadings = extracted.reduce((s, d) => s + d.measurements.length, 0)
  const pairedValues     = gtTotalReadings * 2
  const totalExactValues = sysExactTotal + diaExactTotal

  const dayAccuracyPct = groundTruth.length > 0
    ? Math.min(100, (extracted.length / groundTruth.length) * 100)
    : 100

  return {
    groundTruthCount: gtTotalReadings,
    extractedCount: extTotalReadings,
    pairedCount,
    exactMatches: exactPairs,
    pairedValues,
    totalExactValues,
    sysExactMatches: sysExactTotal,
    diaExactMatches: diaExactTotal,
    exactPct: pairedValues > 0 ? (totalExactValues / pairedValues) * 100 : 0,
    avgSysError: pairedCount > 0 ? totalSysErr / pairedCount : null,
    avgDiaError: pairedCount > 0 ? totalDiaErr / pairedCount : null,
    gtDayCount: groundTruth.length,
    extDayCount: extracted.length,
    dayCountMatch: groundTruth.length === extracted.length,
    dayAccuracyPct,
    perReading,
  }
}
