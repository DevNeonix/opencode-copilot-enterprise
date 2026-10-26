// opencode-copilot-enterprise
//
// OpenCode 2 plugin que descubre en vivo los modelos custom de GitHub Copilot
// Enterprise de cualquier organización (ids tipo `vendor/modelo`, p. ej.
// `acme/llm/mi-modelo`) y los publica en el picker de modelos.
//
// Por qué hace falta: OpenCode no llama a `/models` para el provider
// `github-copilot`, así que los modelos que la organización habilita nunca
// aparecen. Este plugin lee el token que ya tiene OpenCode, lista `/models` y
// publica los modelos de empresa como un provider `openai-compatible`
// apuntando al endpoint que ellos mismos anuncian.
//
// Token: `GITHUB_COPILOT_TOKEN` / `COPILOT_GITHUB_TOKEN`, o la entrada
// `github-copilot` de `~/.local/share/opencode/auth.json`.
//
// Opciones (objeto `{ package, options }` en opencode.json):
//   providerID      id del provider publicado          (def. "copilot-enterprise")
//   providerName    nombre visible                     (def. "GitHub Copilot Enterprise")
//   baseURL         host de Copilot                    (def. el del token, o api.githubcopilot.com)
//   include         regex de ids a incluir             (def. todos los `vendor/*`)
//   exclude         regex de ids a omitir              (def. ninguno)
//   refreshMinutes  minutos entre refrescos            (def. 10)

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Model, Plugin, Provider } from "@opencode/plugin"

const DEFAULT_BASE_URL = "https://api.githubcopilot.com"

type CopilotModel = {
  id: string
  name?: string
  model_picker_enabled?: boolean
  capabilities?: {
    limits?: {
      max_context_window_tokens?: number
      max_output_tokens?: number
      max_prompt_tokens?: number
    }
    supports?: { tool_calls?: boolean; streaming?: boolean; vision?: boolean }
  }
}

type Auth = { access: string; baseURL: string }

type Options = {
  providerID?: string
  providerName?: string
  baseURL?: string
  include?: string
  exclude?: string
  refreshMinutes?: number
  [key: string]: any
}

// Cabeceras que espera el proxy de Copilot para aceptar peticiones de un
// editor que no es VS Code.
const INTEGRATION_HEADERS = {
  "Copilot-Integration-Id": "vscode-chat",
  "Editor-Version": "vscode/1.99.0",
  "X-GitHub-Api-Version": "2025-04-01",
  Accept: "application/json",
}

function normalizeBaseURL(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = String(value).trim().replace(/\/+$/, "")
  if (!trimmed) return undefined
  if (/^https?:\/\//.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

// `api.githubcopilot.com` (@github) y `api.<ghe>.com` (GHE.com con data
// residency) usan el mismo path; el host de GHE self-hosted lo pone el token.
async function readAuth(options: Options): Promise<Auth | undefined> {
  const env = process.env.GITHUB_COPILOT_TOKEN ?? process.env.COPILOT_GITHUB_TOKEN
  if (env) {
    return { access: env.trim(), baseURL: normalizeBaseURL(options.baseURL) ?? DEFAULT_BASE_URL }
  }

  try {
    const file = join(homedir(), ".local", "share", "opencode", "auth.json")
    const json = JSON.parse(await readFile(file, "utf8"))
    const entry = json?.["github-copilot"]
    if (!entry?.access) return undefined

    const fromToken = normalizeBaseURL(entry.enterpriseUrl ?? entry.enterprise_url ?? entry.baseURL)
    return {
      access: String(entry.access),
      baseURL: normalizeBaseURL(options.baseURL) ?? fromToken ?? DEFAULT_BASE_URL,
    }
  } catch {
    return undefined
  }
}

async function discover(auth: Auth): Promise<CopilotModel[]> {
  const res = await fetch(`${auth.baseURL}/models`, {
    headers: { Authorization: `Bearer ${auth.access}`, ...INTEGRATION_HEADERS },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`GET ${auth.baseURL}/models -> ${res.status}`)
  const json = (await res.json()) as { data?: CopilotModel[] }
  // Los modelos de empresa llevan `vendor/` en el id; `github/*` son los oficiales.
  return (json.data ?? []).filter(
    (m) => typeof m.id === "string" && m.id.includes("/") && m.model_picker_enabled !== false,
  )
}

function matcher(pattern: string | undefined, fallback: boolean) {
  if (!pattern) return () => fallback
  const re = new RegExp(pattern)
  return (id: string) => re.test(id)
}

function toModel(providerID: ReturnType<typeof Provider.ID.make>, m: CopilotModel) {
  const limits = m.capabilities?.limits
  const supports = m.capabilities?.supports
  return {
    ...Model.Info.default(providerID, Model.ID.make(m.id)),
    name: m.name || m.id,
    capabilities: {
      tools: supports?.tool_calls ?? true,
      input: ["text", ...(supports?.vision ? ["image"] : [])],
      output: ["text"],
      temperature: true,
    },
    variants: [],
    limit: {
      context: limits?.max_context_window_tokens ?? 128_000,
      input: limits?.max_prompt_tokens ?? limits?.max_context_window_tokens ?? 128_000,
      output: limits?.max_output_tokens ?? 16_384,
    },
    cost: [],
  }
}

export default Plugin.define({
  id: "copilot-custom-models",
  async setup(ctx) {
    const options: Options = ctx.options ?? {}
    const providerID = Provider.ID.make(options.providerID ?? "copilot-enterprise")
    const providerName = options.providerName ?? "GitHub Copilot Enterprise"
    const include = matcher(options.include, true)
    const exclude = matcher(options.exclude, false)
    const refreshMs = Math.max(1, options.refreshMinutes ?? 10) * 60_000

    let models: ReturnType<typeof toModel>[] = []
    let auth: Auth | undefined

    const refresh = async () => {
      const nextAuth = await readAuth(options)
      if (!nextAuth) return false

      let list: CopilotModel[]
      try {
        list = await discover(nextAuth)
      } catch (error) {
        console.warn(`[copilot-custom-models] ${String(error)}`)
        return false
      }

      const next = list
        .filter((m) => !m.id.startsWith("github/"))
        .filter((m) => include(m.id) && !exclude(m.id))
        .map((m) => toModel(providerID, m))

      const changed =
        nextAuth.access !== auth?.access ||
        nextAuth.baseURL !== auth?.baseURL ||
        JSON.stringify(next) !== JSON.stringify(models)

      auth = nextAuth
      models = next
      return changed
    }

    await refresh()

    await ctx.provider.transform((editor) => {
      if (!auth || models.length === 0) return
      // Los modelos de empresa solo anuncian el endpoint OpenAI Chat
      // Completions, así que se exponen con el runtime `openai-compatible`
      // en lugar del nativo de github-copilot.
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          name: providerName,
          activation: "enabled",
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: auth.baseURL },
          headers: { Authorization: `Bearer ${auth.access}`, ...INTEGRATION_HEADERS },
        },
        models,
      })
    })

    const timer = setInterval(() => {
      void refresh()
        .then((changed) => (changed ? ctx.provider.reload() : undefined))
        .catch(() => {})
    }, refreshMs)

    return () => clearInterval(timer)
  },
})
