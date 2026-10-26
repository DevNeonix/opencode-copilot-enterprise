# opencode-copilot-enterprise

Plugin de OpenCode 2 que descubre en vivo los modelos custom de **GitHub Copilot Enterprise**
(los que la organización habilita con prefijo `vendor/`, p. ej. `inditex/KAIA/...`) y los
publica en el picker de modelos bajo su propio provider.

## Por qué hace falta

OpenCode no llama a `/models` del provider `github-copilot`, así que los modelos custom de la
empresa nunca aparecen. El plugin lee el token que ya tienes guardado, lista `/models` y publica
los que no son `github/*` como un provider `openai-compatible` apuntando a
`api.githubcopilot.com` (es el endpoint que anuncian esos modelos).

## Instalación

```sh
# 1. Tener la sesión de Copilot en OpenCode (una vez):
opencode auth login        # elegir GitHub Copilot

# 2. Instalar el plugin:
opencode plugin add github:DevNeonix/opencode-copilot-enterprise

# 3. Comprobar:
opencode models | grep KAIA
```

`opencode plugin add` solo acepta paquetes npm o Git, así que **no** vale pasarle una ruta local.
Para instalarlo desde un clon, añadirlo a mano en `~/.config/opencode/opencode.json`
(tiene que ser el **directorio**, no el archivo):

```jsonc
{ "plugins": ["/ruta/a/opencode-copilot-enterprise"] }
```

El token se toma de `GITHUB_COPILOT_TOKEN` / `COPILOT_GITHUB_TOKEN` o de
`~/.local/share/opencode/auth.json` (entrada `github-copilot`, la que crea `opencode auth login`).

## Opciones

```jsonc
{
  "plugins": [
    {
      "package": "opencode-copilot-enterprise",
      "options": {
        "providerName": "Copilot Inditex",
        "include": "^inditex/",
        "refreshMinutes": 10
      }
    }
  ]
}
```

| Opción | Por defecto | Qué hace |
| --- | --- | --- |
| `providerID` | `github-copilot-enterprise` | id del provider publicado |
| `providerName` | `GitHub Copilot Enterprise` | nombre visible |
| `enterpriseUrl` | el del auth.json, si no `https://api.githubcopilot.com` | host de Copilot Enterprise |
| `include` | todos | regex de ids a incluir |
| `exclude` | ninguno | regex de ids a omitir |
| `refreshMinutes` | `10` | minutos entre refrescos de la lista |

## Verificar

```sh
opencode plugin list          # debe aparecer copilot-custom-models
opencode models | grep -i kaia
opencode run --model github-copilot-enterprise/inditex/KAIA/deepseek-v4.1-flash "di ok"
```

Logs: `~/.local/share/opencode/log/opencode.log`.
