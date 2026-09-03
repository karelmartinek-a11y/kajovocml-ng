# KájovoCML NG — pracovní pravidla repozitáře

`SSOT_CURRENT.md` je jediná normativní produktová autorita. Tento soubor obsahuje pouze pracovní omezení odvozená ze SSOT a nesmí přidávat, měnit ani zužovat produktový kontrakt. Při rozporu vždy platí SSOT.

- Zachovej singleton OWNER `KRMAR78` a zákaz dalších uživatelů či oprávňovacího registru podle SSOT 2.2, 7 a 21.
- Veškeré mutace veď přes kanonickou command službu a PostgreSQL transakční profily podle SSOT 27, 49 a 51.
- OpenAI provider kód patří výhradně do `packages/openai-runtime` podle SSOT 52.3.
- Browser transport patří do Browser Interaction Plane a jeho typovaných protokolů podle SSOT 13 a 14.
- Generované handlery používají pouze capability IPC hranici podle SSOT 15 a 50.
- Test nesmí vykázat falešný PASS; environmentální neprovedení používá přesně `NOT_EXECUTED_ENVIRONMENTAL` podle SSOT 33 a 54.
- Každý produkční artefakt musí mít skutečnou obousměrnou requirement/operation traceability podle SSOT 46 a 55.19; plošné nebo odvozené vazby bez důkazu jsou zakázané.
- Projekce Contract Packu regeneruj pouze příkazem `pnpm contracts:build` a jejich PASS přijímej jen po skutečném vyhodnocení všech blocking gates podle SSOT 55.
- Dokončení zadané úlohy je nevyjednatelnou povinností každého volání Codexu; úloha nesmí být označena za dokončenou, opravenou ani předanou bez přímého vyzkoušení výsledku na produkčním serveru.
- Problém na GitHubu ani na produkčním serveru nesmí být označen jako `Blocker` nebo `Handoff`, protože Codex má z prostředí SSH přístup jak na GitHub, tak na produkční server; na produkčním serveru má root oprávnění a na GitHubu nejvyšší dostupná oprávnění.
