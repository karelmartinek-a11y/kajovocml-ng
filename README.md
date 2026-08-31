# KájovoCML NG

`SSOT_CURRENT.md` je jediná normativní autorita. README je pouze provozní rozcestník a není důkazem implementační ani akceptační shody.

Monorepo KájovoCML NG obsahuje PostgreSQL, OWNER UI/API, KCIP, MCP, OpenAI/Agents, browser, capability IPC a deployment vrstvy. Aktuální stav se nesmí odvozovat z počtu souborů, tras, tabulek nebo katalogových záznamů; rozhodují pouze skutečně vyhodnocené brány a evidence definované SSOT.

Aktuální revize má blokující nálezy v `pnpm audit:deep` a není připravena k produkčnímu nasazení. Toto upozornění smí být odstraněno až po nulovém hlubokém auditu.

Pro lokální ověření použijte [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), pro provoz [docs/OPERATIONS.md](docs/OPERATIONS.md) a pro bootstrap [START_HERE.md](START_HERE.md). Tyto texty jsou informativní projekce SSOT.

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm audit:final
```

`OPENAI_API_KEY` není build secret. Po prvním deployi se uloží v OWNER UI → **Secrets a hesla** a všechny AI call-sites jej čtou ze stejného šifrovaného Secret Manageru.
