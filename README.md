# opencode-copilot-enterprise

**Make your organization's GitHub Copilot Enterprise models usable in [OpenCode](https://opencode.ai).**

OpenCode talks to Copilot, but it never asks Copilot's `/models` endpoint, so the custom
models your organization enables in Copilot Enterprise stay invisible in the model picker.
This plugin fetches them with the token you already have and publishes them as a regular
OpenCode provider.

No configuration beyond signing in. No hardcoded vendor, host, or org name — it works with
any Copilot Enterprise deployment.

## Why this exists

GitHub Copilot Enterprise lets organizations expose custom models under their own
`vendor/*` namespace (for example `acme/llm/my-model`). Those models show up in VS Code
Copilot Chat, but OpenCode's built-in `github-copilot` provider only knows the official
`github/*` models because it never performs discovery.

The plugin closes that gap:

1. Reads the Copilot token from OpenCode's auth store (or an env var).
2. Calls `GET /models` on the Copilot API with the headers Copilot expects.
3. Keeps the organization models (`id` contains `/`, not `github/*`).
4. Publishes them as a provider using OpenCode's `openai-compatible` runtime, pointed at
   the same host, since those models advertise the OpenAI Chat Completions endpoint.

The list refreshes every 10 minutes, so models newly enabled by your admins appear without
restarting OpenCode.

## Requirements

| | |
| --- | --- |
| OpenCode | 2.x (`@opencode/plugin` >= 2.1.0) |
| GitHub | A Copilot Enterprise seat that exposes organization models |
| Auth | `opencode auth login` → GitHub Copilot, or `GITHUB_COPILOT_TOKEN` |

## Install

```sh
# 1. Sign in to Copilot once
opencode auth login        # choose GitHub Copilot

# 2. Install the plugin
opencode plugin add github:DevNeonix/opencode-copilot-enterprise

# 3. Check
opencode models | grep -i copilot-enterprise
```

The plugin loads from the global config (`~/.config/opencode/opencode.json`) and applies to
every project. Changes hot-reload; use `/reload` in the TUI if you want to force it.

### From a local clone

`opencode plugin add` only accepts npm or Git targets, so point the config at the
**directory** by hand — not at a file:

```jsonc title="~/.config/opencode/opencode.json"
{
  "plugins": ["/path/to/opencode-copilot-enterprise"]
}
```

## Configuration

Everything works with zero options. To tune it, use the object form:

```jsonc title="~/.config/opencode/opencode.json"
{
  "plugins": [
    {
      "package": "opencode-copilot-enterprise",
      "options": {
        "providerName": "Copilot · ACME",
        "include": "^acme/",
        "exclude": "deprecated"
      }
    }
  ]
}
```

| Option | Default | Description |
| --- | --- | --- |
| `providerID` | `copilot-enterprise` | Provider id used in model references (`<providerID>/<model id>`) |
| `providerName` | `GitHub Copilot Enterprise` | Label shown in the model picker |
| `baseURL` | token's `enterpriseUrl`, else `https://api.githubcopilot.com` | Copilot host; accepts `host` or full URL |
| `include` | all | Regex of model ids to include |
| `exclude` | none | Regex of model ids to drop |
| `refreshMinutes` | `10` | Minutes between model-list refreshes |

### Hosts and data residency

The host is resolved in this order:

1. `baseURL` option
2. `enterpriseUrl` / `enterprise_url` / `baseURL` from the stored token
3. `https://api.githubcopilot.com`

GitHub Enterprise Cloud with data residency uses `api.<subdomain>.ghe.com`; GitHub
Enterprise Server uses your own host. Both work — the plugin sends whatever host you give
it to both `/models` and `/chat/completions`.

### Token resolution

Order: `GITHUB_COPILOT_TOKEN` → `COPILOT_GITHUB_TOKEN` → `auth.json`. The env vars are handy
for CI or for using a token that isn't OpenCode's own.

## Verify

```sh
opencode plugin list                      # copilot-custom-models — active
opencode models | grep copilot-enterprise
opencode run --model "<providerID>/<model id>" "say ok"
```

If nothing appears, check the log:

```sh
grep -i copilot ~/.local/share/opencode/log/opencode.log | tail -20
```

Common causes: no Copilot seat, an expired token (re-run `opencode auth login`), or an
organization that hasn't enabled any custom models.

## How it works

```
Copilot /models  ──►  filter vendor/*  ──►  Provider.Info + Model.Info[]
                                                   │
                                    ctx.provider.transform(editor)
                                                   │
                                     provider "copilot-enterprise"
                                     package: openai-compatible
                                     baseURL: <copilot host>
```

Models are exposed to OpenCode with their real context window, max output, and tool/vision
capabilities as advertised by Copilot. Costs are zero because billing is handled by your
Copilot seat.

## Limitations

- Organization models are assumed to speak OpenAI Chat Completions, which is what Copilot
  advertises for them. This is why the built-in `github-copilot` runtime isn't used.
- The token belongs to the signed-in GitHub user; the plugin never stores or forwards it
  anywhere except the configured Copilot host.
- Streaming, tools, and vision depend on what each model declares. A model that doesn't
  advertise `tool_calls` is published with tools disabled.

## License

MIT
