# opencode-copilot-enterprise

Make the custom models of your **GitHub Copilot Enterprise** organization show up in
[OpenCode](https://opencode.ai).

## The problem

Your company can enable its own models in Copilot Enterprise. They work in VS Code, but
OpenCode never sees them: its built-in `github-copilot` provider only knows the official
`github/*` models, because OpenCode never asks Copilot for the list of models.

So the models are there, paid for, and you can't select them.

## The fix

This plugin asks Copilot for the model list with the token OpenCode already has, keeps the
organization models, and publishes them as a normal OpenCode provider. They appear in the
model picker like any other model.

It works with any Copilot Enterprise org — nothing about your company is hardcoded.

## Install

```sh
opencode auth login                                   # 1. choose GitHub Copilot
opencode plugin add github:DevNeonix/opencode-copilot-enterprise   # 2. install
opencode models | grep copilot-enterprise             # 3. check
```

That's it. Step 1 is only needed once; the plugin installs globally and applies to every
project.

If step 3 prints nothing, see [Troubleshooting](#troubleshooting).

## Pick a model

Use what step 3 printed:

```sh
opencode run --model "copilot-enterprise/<vendor>/<model>" "say ok"
```

Inside the TUI, the same models are in the model picker under **GitHub Copilot Enterprise**.

## How updates work

The list is read once at startup and again every 10 minutes. If an admin enables or removes
a model, it appears or disappears without restarting OpenCode.

You never edit a config file to add models. Whatever Copilot reports is what you get.

## Configuration

Optional — the plugin works with no settings at all. To change behavior:

```jsonc title="~/.config/opencode/opencode.json"
{
  "plugins": [
    {
      "package": "github:DevNeonix/opencode-copilot-enterprise",
      "options": {
        "providerName": "Copilot · ACME",
        "include": "^acme/"
      }
    }
  ]
}
```

| Option | Default | What it does |
| --- | --- | --- |
| `providerName` | `GitHub Copilot Enterprise` | Name shown in the model picker |
| `providerID` | `copilot-enterprise` | Prefix used in model references |
| `include` | everything | Only keep model ids matching this regex |
| `exclude` | nothing | Drop model ids matching this regex |
| `refreshMinutes` | `10` | How often to re-read the list |
| `baseURL` | from your token | Copilot host, if it isn't the public one |

### Which host does it call?

1. `baseURL`, if you set it
2. The host stored with your token
3. `https://api.githubcopilot.com`

Both GitHub Enterprise Cloud (`api.<subdomain>.ghe.com`) and self-hosted GitHub Enterprise
work. `baseURL` accepts `host` or a full `https://` URL.

### Which token does it use?

First `GITHUB_COPILOT_TOKEN`, then `COPILOT_GITHUB_TOKEN`, then the one saved by
`opencode auth login`. Use an env var only if you want a token other than your own.

## Troubleshooting

**No models appear.** Check that the plugin is loaded:

```sh
opencode plugin list | grep copilot
```

Then read the log:

```sh
grep -i copilot ~/.local/share/opencode/log/opencode.log | tail -20
```

The usual causes:

| Symptom | Cause | Fix |
| --- | --- | --- |
| Plugin not in `plugin list` | Not installed | `opencode plugin add github:DevNeonix/opencode-copilot-enterprise` |
| `GET .../models -> 401` or `403` | Token expired or no seat | `opencode auth login` again |
| Request succeeds, zero models | Your org has no custom models enabled | Ask your Copilot admin |
| Models appear but calls fail | Model doesn't accept the OpenAI chat protocol | Open an issue with the log line |

**I installed it but the models are the old ones / missing.** Force a full reload with
`/reload` in the TUI, or `opencode service restart`.

## Installing from a local clone

`opencode plugin add` only accepts npm or Git targets. To use a local copy, point the config
at the **folder** (not a file):

```jsonc title="~/.config/opencode/opencode.json"
{
  "plugins": ["/path/to/opencode-copilot-enterprise"]
}
```

## What it does internally

1. Reads the Copilot token from OpenCode's auth store.
2. Calls `GET /models` on the Copilot host with the headers Copilot expects from an editor.
3. Keeps models whose id contains `/` (organization models) and skips `github/*`.
4. Publishes them as one provider using OpenCode's `openai-compatible` runtime, with their
   real context window, output limit, and tool/vision support.

Costs are shown as zero because your Copilot seat pays for the usage.

## Limitations

- Organization models are assumed to speak the OpenAI Chat Completions protocol, which is
  what Copilot advertises for them.
- Your token is only ever sent to the configured Copilot host. The plugin stores nothing.
- A model that doesn't advertise `tool_calls` is published with tools disabled.

## License

MIT
