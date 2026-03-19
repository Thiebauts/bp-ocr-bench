import type { DayReading, UsageInfo } from '../types'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export interface ApiCallParams {
  apiKey: string
  model: string
  prompt: string
  imageBase64: string
  imageMimeType: string
  maxTokens: number
  temperature: number
  signal?: AbortSignal
}

export interface ApiCallResult {
  data: DayReading[] | null
  raw: string
  error: string | null
  usage?: UsageInfo
}

export async function callOpenRouter(params: ApiCallParams): Promise<ApiCallResult> {
  const { apiKey, model, prompt, imageBase64, imageMimeType, maxTokens, temperature, signal } = params

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:5173',
      'X-Title': 'BP Extractor',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${imageMimeType};base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  })

  if (!response.ok) {
    let errorMsg = `API error ${response.status}`
    try {
      const body = await response.json()
      errorMsg = body?.error?.message ?? body?.message ?? errorMsg
    } catch {
      // ignore JSON parse errors on error responses
    }
    throw new Error(errorMsg)
  }

  const json = await response.json()
  const rawContent: string = json.choices?.[0]?.message?.content ?? ''
  const usage: UsageInfo | undefined = json.usage

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  let cleaned = rawContent.trim()
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim()
  }

  // Fix leading zeros on numbers (e.g. 09 → 9) — invalid JSON but common model mistake
  cleaned = cleaned.replace(/:\s*0+(\d+)\s*([,\}\]])/g, ': $1$2')

  try {
    const parsed = JSON.parse(cleaned)
    if (!isValidResponse(parsed)) {
      return {
        data: null,
        raw: rawContent,
        error: 'Model returned valid JSON but not in the expected format — see raw output below',
        usage,
      }
    }
    return { data: parsed, raw: rawContent, error: null, usage }
  } catch {
    return {
      data: null,
      raw: rawContent,
      error: 'Could not parse JSON from model response — see raw output below',
      usage,
    }
  }
}

function isValidResponse(data: unknown): data is DayReading[] {
  if (!Array.isArray(data)) return false
  return data.every(d => {
    if (typeof d !== 'object' || d === null) return false
    const day = d as Record<string, unknown>
    if (typeof day.day_label !== 'string' || !Array.isArray(day.measurements)) return false
    return (day.measurements as unknown[]).every(m => {
      if (typeof m !== 'object' || m === null) return false
      const meas = m as Record<string, unknown>
      return typeof meas.systolic === 'number' && typeof meas.diastolic === 'number'
    })
  })
}
