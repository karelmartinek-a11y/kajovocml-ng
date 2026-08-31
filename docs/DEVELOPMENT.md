# Vývoj

> Informativní pracovní projekce; jedinou normativní autoritou je `SSOT_CURRENT.md`.

Použijte Node.js 24, pnpm 11 a `pnpm install --frozen-lockfile`. Pro DB testy je nutný PostgreSQL 16 s `pgcrypto` a `citext`, izolované `DATABASE_URL`, `KCML_MASTER_KEY`, `KCML_RELEASE_ID` a 40znakový `KCML_SOURCE_SHA`.

Před sdílením změny spusťte `pnpm audit:final`. Contract Pack regenerujte výhradně `pnpm contracts:build`; vygenerovaný PASS je platný pouze tehdy, když evaluator skutečně ověřil všechny vstupy a nevytváří plošné traceability vazby.

