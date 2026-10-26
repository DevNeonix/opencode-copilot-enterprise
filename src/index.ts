// V2 plugin (OpenCode 2.x): descubre en vivo los modelos custom de Copilot Enterprise
// (p.ej. inditex/KAIA/*) y los publica como provider propio.
//
// OpenCode no hace discovery de /models para github-copilot, así que los modelos
// que la organización habilita nunca aparecen en el picker. Este plugin los lee del
// propio token de Copilot y los publica como modelos del provider.
//
// Token: variable GITHUB_COPILOT_TOKEN (o COPILOT_GITHUB_TOKEN), o
// ~/.local/share/opencode/auth.json (entrada "github-copilot").
//
// Opciones (objeto {package, options} en opencode.json):
//   providerID       id del provider publicado        (def. "github-copilot-enterprise")
//   providerName     nombre visible                   (def. "GitHub Copilot Enterprise")
//   enterpriseUrl    host de Copilot Enterprise       (def. value del auth.json o api.githubcopilot.com)
//   include          regex opcional de ids a incluir  (def. todos los "vendor/*")
//   exclude          regex opcional de ids a omitir
//   refreshMinutes   minutos entre refrescos          (def. 10)

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Model, Plugin, Provider } from "@opencode/plugin"

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

type Options = {
  providerID?: string
  providerName?: string
  enterpriseUrl?: string
  include?: string
  exclude?: string
  refreshMinutes?: number
  [key: string]: any
}

const INTEGRATION_HEADERS = {
  "Copilot-Integration-Id": "vscode-chat",
  "Editor-Version": "vscode/1.99.0",
  "X-GitHub-Api-Version": "2025-04-01",
  Accept: "application/json",
}

async function readToken(): Promise<{ access: string; enterpriseUrl?: string } | undefined> {
  const env = process.env.GITHUB_COPILOT_TOKEN ?? process.env.COPILOT_GITHUB_TOKEN
  if (env) return { access: env }
  try {
    const file = join(homedir(), ".local", "share", "opencode", "auth.json")
    const json = JSON.parse(await readFile(file, "utf8"))
    const entry = json?.["github-copilot"]
    if (!entry?.access) return undefined
    return { access: String(entry.access), enterpriseUrl: entry.enterpriseUrl ?? entry.enterprise_url }
  } catch {
    return undefined
  }
}

async function discover(auth: { access: string; enterpriseUrl?: string }): Promise<CopilotModel[]> {
  const base = auth.enterpriseUrl
    ? String(auth.enterpriseUrl).replace(/\/+$/, "")
    : "https://api.githubcopilot.com"
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${auth.access}`, ...INTEGRATION_HEADERS },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`GET ${base}/models -> ${res.status}`)
  const json = (await res.json()) as { data?: CopilotModel[] }
  // Los modelos de organización llevan "vendor/" en el id; github/* son los oficiales.
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
    const providerID = Provider.ID.make(options.providerID ?? "github-copilot-enterprise")
    const providerName = options.providerName ?? "GitHub Copilot Enterprise"
    const include = matcher(options.include, true)
    const exclude = matcher(options.exclude, false)
    const refreshMs = Math.max(1, options.refreshMinutes ?? 10) * 60_000

    let models: ReturnType<typeof toModel>[] = []
    let auth: Awaited<ReturnType<typeof readToken>>

    const refresh = async () => {
      const nextAuth = await readToken()
      if (!nextAuth) return false
      if (options.enterpriseUrl) nextAuth.enterpriseUrl = options.enterpriseUrl

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
        nextAuth.access !== auth?.access || JSON.stringify(next) !== JSON.stringify(models)
      auth = nextAuth
      models = next
      return changed
    }

    await refresh()

    await ctx.provider.transform((editor) => {
      if (!auth || models.length === 0) return
      // KAIA sólo anuncia el endpoint OpenAI Chat Completions, así que se expone
      // con el runtime openai-compatible en vez del nativo de github-copilot.
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          name: providerName,
          activation: "enabled",
          package: "@opencode/ai/providers/openai-compatible",
          settings: {
            baseURL: auth.enterpriseUrl
              ? String(auth.enterpriseUrl).replace(/\/+$/, "")
              : "https://api.githubcopilot.com",
          },
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
