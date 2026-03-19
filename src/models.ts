export interface ModelEntry {
  id: string
  label: string
  input: number | null
  output: number | null
}

export interface ModelGroup {
  group: string
  models: ModelEntry[]
}

export const SUGGESTED_MODELS: ModelGroup[] = [
  {
    group: 'Anthropic',
    models: [
      { id: 'anthropic/claude-sonnet-4.6',              label: 'Claude Sonnet 4.6',       input: 3,     output: 15    },
      { id: 'anthropic/claude-opus-4.6',                label: 'Claude Opus 4.6',         input: 5,     output: 25    },
      { id: 'anthropic/claude-opus-4.5',                label: 'Claude Opus 4.5',         input: 5,     output: 25    },
      { id: 'anthropic/claude-sonnet-4.5',              label: 'Claude Sonnet 4.5',       input: 3,     output: 15    },
      { id: 'anthropic/claude-opus-4.1',                label: 'Claude Opus 4.1',         input: 15,    output: 75    },
      { id: 'anthropic/claude-opus-4',                  label: 'Claude Opus 4',           input: 15,    output: 75    },
      { id: 'anthropic/claude-sonnet-4',                label: 'Claude Sonnet 4',         input: 3,     output: 15    },
      { id: 'anthropic/claude-haiku-4.5',               label: 'Claude Haiku 4.5',        input: 1,     output: 5     },
      { id: 'anthropic/claude-3.7-sonnet',              label: 'Claude 3.7 Sonnet',       input: 3,     output: 15    },
      { id: 'anthropic/claude-3.7-sonnet:thinking',     label: 'Claude 3.7 Sonnet (Thinking)', input: 3, output: 15  },
      { id: 'anthropic/claude-3.5-sonnet',              label: 'Claude 3.5 Sonnet',       input: 6,     output: 30    },
      { id: 'anthropic/claude-3.5-haiku',               label: 'Claude 3.5 Haiku',        input: 0.8,   output: 4     },
      { id: 'anthropic/claude-3-haiku',                 label: 'Claude 3 Haiku',          input: 0.25,  output: 1.25  },
    ],
  },
  {
    group: 'OpenAI',
    models: [
      { id: 'openai/gpt-5',                             label: 'GPT-5',                   input: 1.25,  output: 10    },
      { id: 'openai/gpt-5-pro',                        label: 'GPT-5 Pro',               input: 15,    output: 120   },
      { id: 'openai/gpt-5-mini',                       label: 'GPT-5 Mini',              input: 0.25,  output: 2     },
      { id: 'openai/gpt-5-nano',                       label: 'GPT-5 Nano',              input: 0.05,  output: 0.4   },
      { id: 'openai/gpt-4.1',                           label: 'GPT-4.1',                 input: 2,     output: 8     },
      { id: 'openai/gpt-4.1-mini',                      label: 'GPT-4.1 Mini',            input: 0.4,   output: 1.6   },
      { id: 'openai/gpt-4.1-nano',                      label: 'GPT-4.1 Nano',            input: 0.1,   output: 0.4   },
      { id: 'openai/gpt-4o',                            label: 'GPT-4o',                  input: 2.5,   output: 10    },
      { id: 'openai/gpt-4o-mini',                       label: 'GPT-4o Mini',             input: 0.15,  output: 0.6   },
      { id: 'openai/o4-mini',                           label: 'o4 Mini',                 input: 1.1,   output: 4.4   },
      { id: 'openai/o4-mini-high',                      label: 'o4 Mini High',            input: 1.1,   output: 4.4   },
      { id: 'openai/o3-pro',                            label: 'o3 Pro',                  input: 20,    output: 80    },
      { id: 'openai/o3',                                label: 'o3',                      input: 2,     output: 8     },
      { id: 'openai/o1',                                label: 'o1',                      input: 15,    output: 60    },
      { id: 'openai/gpt-4-turbo',                       label: 'GPT-4 Turbo',             input: 10,    output: 30    },
    ],
  },
  {
    group: 'Google',
    models: [
      { id: 'google/gemini-3.1-pro-preview',            label: 'Gemini 3.1 Pro (preview)',input: 2,     output: 12    },
      { id: 'google/gemini-3-pro-preview',              label: 'Gemini 3 Pro (preview)',  input: 2,     output: 12    },
      { id: 'google/gemini-3-flash-preview',            label: 'Gemini 3 Flash (preview)',input: 0.5,   output: 3     },
      { id: 'google/gemini-3.1-flash-image-preview',   label: 'Gemini 3.1 Flash Image',  input: 0.25,  output: 1.5   },
      { id: 'google/gemini-2.5-pro',                    label: 'Gemini 2.5 Pro',          input: 1.25,  output: 10    },
      { id: 'google/gemini-2.5-pro-preview',           label: 'Gemini 2.5 Pro (preview)',input: 1.25,  output: 10    },
      { id: 'google/gemini-2.5-flash',                  label: 'Gemini 2.5 Flash',        input: 0.3,   output: 2.5   },
      { id: 'google/gemini-2.5-flash-lite',             label: 'Gemini 2.5 Flash Lite',   input: 0.1,   output: 0.4   },
      { id: 'google/gemini-2.0-flash-001',              label: 'Gemini 2.0 Flash',        input: 0.1,   output: 0.4   },
      { id: 'google/gemini-2.0-flash-lite-001',         label: 'Gemini 2.0 Flash Lite',   input: 0.075, output: 0.3   },
      { id: 'google/gemma-3-27b-it',                   label: 'Gemma 3 27B',             input: 0.04,  output: 0.15  },
    ],
  },
  {
    group: 'xAI',
    models: [
      { id: 'x-ai/grok-4.1-fast',                      label: 'Grok 4.1 Fast',           input: 0.2,   output: 0.5   },
      { id: 'x-ai/grok-4',                             label: 'Grok 4',                  input: 3,     output: 15    },
      { id: 'x-ai/grok-4-fast',                        label: 'Grok 4 Fast',             input: 0.2,   output: 0.5   },
    ],
  },
  {
    group: 'Meta',
    models: [
      { id: 'meta-llama/llama-4-maverick',              label: 'Llama 4 Maverick',        input: 0.15,  output: 0.6   },
      { id: 'meta-llama/llama-4-scout',                 label: 'Llama 4 Scout',           input: 0.08,  output: 0.3   },
      { id: 'meta-llama/llama-3.2-90b-vision-instruct', label: 'Llama 3.2 90B Vision',    input: null,  output: null  },
      { id: 'meta-llama/llama-3.2-11b-vision-instruct', label: 'Llama 3.2 11B Vision',    input: 0.049, output: 0.049 },
    ],
  },
  {
    group: 'Mistral',
    models: [
      { id: 'mistralai/mistral-large-2512',             label: 'Mistral Large 2512',      input: 0.5,   output: 1.5   },
      { id: 'mistralai/mistral-medium-3.1',             label: 'Mistral Medium 3.1',      input: 0.4,   output: 2     },
      { id: 'mistralai/mistral-medium-3',               label: 'Mistral Medium 3',        input: 0.4,   output: 2     },
      { id: 'mistralai/mistral-small-3.2-24b-instruct', label: 'Mistral Small 3.2 24B',   input: 0.06,  output: 0.18  },
      { id: 'mistralai/mistral-small-3.1-24b-instruct', label: 'Mistral Small 3.1 24B',   input: 0.35,  output: 0.56  },
      { id: 'mistralai/ministral-14b-2512',             label: 'Ministral 14B',           input: 0.2,   output: 0.2   },
      { id: 'mistralai/ministral-8b-2512',              label: 'Ministral 8B',            input: 0.15,  output: 0.15  },
      { id: 'mistralai/pixtral-large-2411',             label: 'Pixtral Large',           input: 2,     output: 6     },
    ],
  },
  {
    group: 'Qwen',
    models: [
      { id: 'qwen/qwen3-vl-235b-a22b-instruct',        label: 'Qwen3 VL 235B',           input: 0.2,   output: 0.88  },
      { id: 'qwen/qwen3-vl-32b-instruct',              label: 'Qwen3 VL 32B',            input: 0.104, output: 0.416 },
      { id: 'qwen/qwen3-vl-8b-instruct',               label: 'Qwen3 VL 8B',             input: 0.08,  output: 0.5   },
      { id: 'qwen/qwen2.5-vl-72b-instruct',            label: 'Qwen2.5 VL 72B',          input: 0.8,   output: 0.8   },
      { id: 'qwen/qwen2.5-vl-32b-instruct',            label: 'Qwen2.5 VL 32B',          input: 0.2,   output: 0.6   },
    ],
  },
  {
    group: 'Amazon',
    models: [
      { id: 'amazon/nova-premier-v1',                   label: 'Nova Premier',            input: 2.5,   output: 12.5  },
      { id: 'amazon/nova-pro-v1',                       label: 'Nova Pro',                input: 0.8,   output: 3.2   },
      { id: 'amazon/nova-2-lite-v1',                    label: 'Nova 2 Lite',             input: 0.3,   output: 2.5   },
      { id: 'amazon/nova-lite-v1',                      label: 'Nova Lite',               input: 0.06,  output: 0.24  },
    ],
  },
]

export const PRICING_MAP: Record<string, { input: number | null; output: number | null }> =
  Object.fromEntries(
    SUGGESTED_MODELS.flatMap(g => g.models.map(m => [m.id, { input: m.input, output: m.output }])),
  )
