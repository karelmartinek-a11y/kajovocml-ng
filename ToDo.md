# KájovoCML NG — úplný implementační ToDo k odstranění auditních odchylek

**Dokument:** implementační specifikace a orchestrační kontrakt  
**Repozitář:** `karelmartinek-a11y/kajovocml-ng`  
**Výchozí větev:** `main`  
**Forenzně zafixovaný commit:** `440a293439ca082b94d2d495936a2ab7a69e49d6`  
**Normativní autorita:** `SSOT_CURRENT.md`, verze `2026.08.30.8`  
**SHA-256 SSOT:** `2d0a66005bd8c3179d284437dec4c04edca696e97f78650730bafc5c0031913a`  
**Rozsah SSOT:** 20 433 řádků, 13 959 normativních atomů, 262 kanonických operací  
**Auditní vstup:** `FORENSIC_AUDIT_CURRENT.md` — `FAIL`, 20 blokujících odchylek

---

## 1. Účel dokumentu

Tento dokument převádí všech 20 blokujících nálezů z aktuálního forenzního auditu na samostatné implementační kontrakty. Každý kontrakt je připraven tak, aby jej mohl převzít programátor bez znalosti celého programu, ale současně nemohl lokální opravou porušit průřezové invarianty SSOT.

Úkol je splněn pouze tehdy, když vznikne skutečná produkční implementace, fyzické PostgreSQL a runtime guardy, úplné recovery chování a opakovatelná machine evidence. Přítomnost názvu, markeru, záznamu v registru, počtu souborů, syntetického digestu, obecného CRUD handleru, mocku nebo testu kontrolujícího pouze metadata není důkazem splnění.

## 2. Forenzní stav výchozího commitu

Auditní report a poslední stav repozitáře nejsou časově zcela synchronní. Commit `440a293…` doplnil registry a markerové implementace po vzniku reportu, ale neprokázal uzavření původních odchylek. Proto se všech 20 kódů zachovává jako otevřený backlog až do nového behaviorálního auditu.

Konkrétní výchozí evidence:

- Requirement Registry obsahuje 13 959 records, pouze 49 má stav `ACTIVE` a pouze 288 má alespoň jeden `artifactId`; naprostá většina požadavků zůstává bez skutečné vazby na implementaci, test a evidence.
- `contracts/registry-schemas/common-record.schema.json` ověřuje prakticky jen formát `canonicalDigest`; neověřuje povinná pole jednotlivých registrů dle SSOT 55.
- Manifest nyní uvádí neprázdné registry, ale řada z nich je mechanicky odvozena jednotným defaultem. Například Binding Registry deklaruje všech 262 bindingů jako `exact=true`, Fault Catalog dává všem operacím stejnou fázi a stejné fault kinds a Exposure Parity vytváří identifikátory povinných ploch bez důkazu, že plochy existují a volají správnou operaci.
- Operation Catalog má 262 operací. Přesnou specializovanou větev má ve výchozím commitu jen 27 operací; 235 operací nemá exaktní behaviorální handler. `operation-handler-catalog.ts` je katalog metadat, nikoli implementace.
- Původní audit identifikoval 163 tabulek s obecným `document jsonb`. Poslední commit tento přesný marker odstranil, ale správnost všech fyzických schémat, constraints, migrations a kompatibility nebyla behaviorálně uzavřena.
- `packages/generation-orchestrator/src/index.ts` implementuje jen dílčí přechody a jednoduché databázové zápisy; jeho lifecycle navíc používá jiné stavy než SSOT 12.4/49.15. `cleanupOrphans()` kontroluje pouze smazané workspace soubory a může uzavřít cleanup bez inventury runtime, routes, bindings, pointerů, procesů a side effects.
- Browser runtime přijímá `payload.path` jako host cestu pro upload/download, challenge reprezentuje vyhozenou chybu a úspěch mutující akce odvozuje z pouhého uložení observation. To je v přímém rozporu se SSOT 13.16–13.19 a 51.24.
- OpenAI runtime obsahuje create/background/retrieve markerové větve, ale nemá úplnou stavovou, tool-call, successor, checkpoint, RunState a recovery implementaci SSOT 52.
- Property test při dostupné DB pouze jednou zavolá `audit.integrity.verify`; chaos test nadále testuje lokální pomocný model a až následně jednou zavolá službu. Neprobíhá krokové porovnávání modelu se skutečným SUT.
- Test `OPERATION_COVERAGE_EVIDENCE` ověřuje existenci katalogových metadat, ne chování 262 operací.
- Současný seccomp BPF program má vadné řízení skoků: shoda s položkou allowlistu nevede přímo na `ALLOW`. Profil navíc neřeší celý dvoustupňový bootstrap, architekturu, PID/user namespace, `pivot_root`, FD 3 a produkční důkaz dle SSOT 50.
- `scripts/evaluate-architecture.mjs` kontroluje pouze několik obecných podmínek a stejný výsledek plošně promítá do všech 18 architecture gates. Každá brána přitom musí mít vlastní evaluator, vstupy, predicate a evidence.

## 3. Globální pravidla platná pro všech 20 úkolů

1. `SSOT_CURRENT.md` se nemění. Pokud implementátor narazí na skutečný normativní konflikt, vrátí `SSOT_NORMATIVE_CONFLICT` s přesnými source refs; nesmí si vybrat pohodlnější výklad.
2. `AGENTS.md` je závazné pracovní omezení. Singleton OWNER zůstává `KRMAR78`; nevzniká druhý uživatel, role, permission registry, nový control plane ani nový bearer credential.
3. Každá mutace vede přes `CanonicalOperationService`, kanonickou operation z kapitoly 42 a PostgreSQL transakční profil z kapitol 49/51. Přímý SQL writer mimo canonical writer je zakázán.
4. External/provider/browser/filesystem/systemd side effect musí mít T1 intent/outbox, fresh D claim, vlastní external fázi a T2/T3 outcome/reconciliation. DB lock se přes external I/O nedrží.
5. Generated handlery používají pouze capability IPC. OpenAI call sites vedou pouze přes `packages/openai-runtime`; browserové akce pouze přes Browser Interaction Plane.
6. Záznam v Contract Packu je přijatelný jen tehdy, když odkazuje na existující implementaci, přesné source anchors, test a runtime evidence. Registry se ručně neupravují; vznikají příkazem `pnpm contracts:build`.
7. Každý task musí dodat obousměrnou traceability: requirement → source/migration/test/evidence a artifact/test → requirement/operation/oracle.
8. Test, který nelze provést kvůli prostředí, vrací přesně `NOT_EXECUTED_ENVIRONMENTAL`. Takový výsledek nikdy nesplní blocking gate.
9. Zakázány jsou placeholdery, prázdné handlery, `TODO` v produkční cestě, generický success, hardcoded PASS, source grep jako důkaz runtime vlastnosti, plošné mapování všech requirements a odvozování shody pouze z názvů.
10. Každý PR je rebaseovaný na zafixovaný integrační SHA nebo na SHA výslovně přidělený integrátorem. V popisu uvede změněné authority roots, operations, tables, registries, gates a test profiles.

## 4. Povinný výstup každého programátora

Každý vlastník odchylky odevzdá:

- produkční source/migrations/configuration změny;
- přesné machine-readable kontrakty a trace anchors, nikoli ručně upravené generated registry;
- pozitivní, negativní, concurrency, crash/fault a recovery testy podle relevance;
- přímé dotazy/oracly nad PostgreSQL a případně runtime, filesystemem a external fixture;
- seznam změněných souborů a vysvětlení vlastnictví každého z nich;
- evidence bundle s commit SHA, SSOT digestem, Contract Pack digestem, environment manifestem, příkazy, exit codes, test IDs, seed/schedule a artifact digests;
- seznam všech nových stable errors, fault points, closure predicates a acceptance gates;
- potvrzení, že neexistuje alternativní writer ani test-only write path;
- nový výstup `pnpm audit:deep` a `pnpm audit:final`; nulový exit code se přijme pouze po obsahovém review evidence.

## 5. Orchestrace a integrační pořadí

| Vlna | Úkoly | Integrační podmínka |
|---|---|---|
| A — kontrakt a fyzické základy | TD-11, TD-17, TD-18, TD-19 | Přesná schémata, registry schemas, compiler interface a runtime sandbox jsou stabilní. |
| B — kanonická sémantika | TD-03, TD-04, TD-07, TD-12, TD-15 | Existuje jediný writer, exact binding, operation handler a transaction contract. |
| C — stavové a recovery registry | TD-06, TD-09, TD-16 | Fault cutpoints, recovery rules a closure query jsou spojené s reálnou operací. |
| D — subsystémové lifecycle | TD-05, TD-10, TD-14 | Browser, generation a OpenAI mají úplný persisted lifecycle a crash recovery. |
| E — plochy a důkazy | TD-08, TD-13, TD-20, TD-02 | Skutečné surfaces, SUT harness, coverage a file-level traceability jsou úplné. |
| F — finální closure | TD-01 | Všech 18 architecture gates se nezávisle vyhodnotí a celkový stav je konjunkce jejich PASS. |

Práce může probíhat paralelně pouze mezi úkoly bez sdíleného authority rootu. `scripts/compile-contract-pack.mjs`, registry schemas a generated registry outputs vlastní TD-17 do dokončení vlny A; ostatní programátoři dodávají typed source evidence podle jeho rozhraní. `scripts/evaluate-architecture.mjs` a finální architecture report vlastní TD-01. Konfliktní změny těchto souborů se nemergují ad hoc.

---

## TD-01 — `ARCHITECTURE_READINESS_NOT_PASS`

**Vlastník:** Architecture readiness / integration engineer  
**Závislosti:** všech TD-02 až TD-20  
**SSOT:** 55.1–55.4, 55.14, 55.20–55.22; podpůrně 33–37 a 47

### Cíl

Nahradit plošný a neúplný architecture evaluator sadou 18 nezávislých, spustitelných evaluátorů přesně podle tabulky SSOT 55.21. `ARCHITECTURE_READINESS=PASS` smí vzniknout jen jako logická konjunkce 18 PASS výsledků bez unresolved finding inventory.

### Rozsah změny

- `scripts/evaluate-architecture.mjs` rozdělit na registry evaluátorů s jednoznačným `evaluatorId`, verzí a digestem.
- Pro každou bránu načíst její skutečné vstupy: exact SSOT/pack digests, registry records, source/test/runtime evidence a výsledky závislých gates.
- Výsledek každé brány musí obsahovat `inputDigest`, `environmentDigest`, `actualEvidence`, `missingEvidence`, `resultDigest`, časy a konkrétní blockers.
- `architecture-readiness.json` generovat výhradně z výsledků; stejný blanket blocker/evidence digest pro všechny gates je nepřípustný.
- Přidat konzistenční testy, které pro každou bránu záměrně poruší právě jeden invariant a ověří FAIL pouze relevantní brány a jejich závislosti.

### Akceptační kontrakt

- Přesně 18 gate IDs ze SSOT 55.21; žádný navíc ani chybějící.
- Gate bez evaluatoru, vstupů, evidence nebo PASS predicate je FAIL.
- Ruční editace resultu, waiver, screenshot, existence souboru nebo modelové tvrzení nemůže vytvořit PASS.
- Změna SSOT, compileru, schema bundle, source, testu či evidence invaliduje odpovídající input digest.
- Finální `pnpm audit:final` skončí PASS pouze po PASS všech závislých produkčních profilů; `NOT_EXECUTED_ENVIRONMENTAL` zůstává blokátor.

### Zakázané zkratky

Hardcoded status; jedna obecná funkce vracející stejný výsledek všem gates; source grep; odvození PASS z nulového počtu záznamů v jednom reportu; přepis SSOT 55.22 bez důkazu implementace.

---

## TD-02 — `ARTIFACT_TRACE_NOT_FILE_LEVEL`

**Vlastník:** Traceability / release evidence engineer  
**Závislosti:** TD-17 a hotové implementační PR ostatních úkolů  
**SSOT:** 46, 55.5, 55.19–55.20

### Cíl

Vytvořit úplnou, obousměrnou a digestově ověřenou traceability každého produkčního souboru, migration, unit, route, schema, UI surface, testu, fixture, modelu, fault pointu a deployment skriptu.

### Implementační kontrakt

- Artifact record musí obsahovat všechna pole SSOT 55.19: kind, repository path, SHA-256 exact bytes, owner module, requirement/operation/state-machine/registry/test/release vazby, generation lineage a lifecycle.
- Každý `repositoryPath` ukazuje na regular file; directory/path-name digest není přípustný.
- Trace anchor identifikuje stabilní symbol/schema/migration/test ID a ověřuje digest relevantního obsahu. Line number může být pomocná evidence, nikoli jediná identita.
- Reverse validation musí pro každý artifact potvrdit nejméně jednu skutečnou requirement relation nebo explicitní, machine-checkable `notApplicable` podle SSOT. Current product nemá future-specification výjimku.
- Generated artifacts musí nést `generatedFrom` a digest compileru/inputů. Ručně změněný generated file způsobí drift.
- Build musí selhat při novém nezdokumentovaném souboru, smazaném targetu, změněném digestu, dangling ID, testu bez oracle relation nebo requirementu bez aktivního artifact/test/evidence.

### Testy

1. Přidání source souboru bez trace recordu → FAIL.  
2. Změna bytes bez regenerace → FAIL.  
3. Přejmenování/smazání souboru → stale reference FAIL.  
4. Blanket přiřazení ≥90 % requirements jednomu artifactu → FAIL.  
5. Trace na directory nebo neexistující symbol → FAIL.  
6. Generated file se správnou lineage a digestem → PASS; ruční edit → FAIL.  
7. Každý test bez requirement a oracle relation → nezapočítat a FAIL příslušné coverage.

### Definition of Done

Nula orphan artifacts a orphan requirements; všechny digests odpovídají exact bytes; obousměrné foreign-key-like reference projdou; report lze reprodukovat byte-identicky na clean checkoutu stejného SHA.

---

## TD-03 — `AUTHORITY_OWNERSHIP_REGISTRY_EMPTY`

**Vlastník:** Domain authority / single-writer engineer  
**Závislosti:** TD-12, TD-15; rozhraní s TD-04, TD-06  
**SSOT:** 2.16–2.18, 49, 51, 55.15–55.16

### Cíl

Pro každý authoritative mutable objekt, pointer, ledger a projection zavést právě jednoho canonical writera a jednu state machine; odstranit všechny alternativní přímé writery.

### Implementační kontrakt

- Pokrýt všechny řádky kanonické ownership mapy SSOT 55.15, ne pouze současných 12 hrubých kategorií.
- Record musí obsahovat exact `authorityObjectKind`, writer ID, owner module/service, state machine, povolené operation IDs, persistence, evidence producers, zakázané writery, consumers, closure predicate a requirements.
- Statická analýza a runtime test musí dohledat všechny SQL writes/pointer switches; write mimo přidělenou service/function je blocking violation.
- Provider callback, browser event, generated handler, test helper, migration runtime krok a deployment script smí pouze produkovat typed evidence nebo volat canonical operation; nesmí vytvářet business outcome.
- Více worker instances smějí sdílet writer kód pouze pod stejným lock/lease/fence kontraktem.
- Ownership a operation registr se musí obousměrně shodovat: každý mutující operation odkazuje právě jednoho writera a writer dovoluje právě deklarované operations.

### Testy a akceptace

- Záměrný druhý SQL writer stejného rootu je nalezen buildem.
- Late/stale evidence producer nemůže změnit canonical state.
- Souběžné dva procesy stejného writera vytvoří jeden linearizovatelný outcome.
- Každý object kind z mapy 55.15 má jeden active record, requirements, state machine a closure predicate.
- Žádný record nemá prázdné `requirementIds`, generický `POSTGRESQL` bez konkrétního repository contractu ani neověřený `acceptedEvidenceProducer`.

---

## TD-04 — `BINDING_REGISTRY_EMPTY`

**Vlastník:** Exact binding / activation engineer  
**Závislosti:** TD-03, TD-12, TD-15  
**SSOT:** 7.5, 8.7–8.8, 10.17–10.18, 11.6–11.8, 13, 49.17, 51.19–51.20, 55.10

### Cíl

Nahradit syntetické mapování operation → route plným exact Binding Registry a runtime pinningem všech devíti binding kinds.

### Povinné binding kinds

`CONTRACT_BINDING`, `SECRET_BINDING`, `EXTERNAL_TARGET_BINDING`, `EXTERNAL_AUTH_BINDING`, `AGENT_TOOL_BINDING`, `BROWSER_ACCOUNT_BINDING`, `BROWSER_PROFILE_ASSIGNMENT`, `ACTIVATION_SET_MEMBERSHIP`, `ROUTE_BINDING`.

### Implementační kontrakt

- Každý record implementuje všechna pole SSOT 55.10 včetně kind/revision/digest, source/target revision, schema digestu, purpose, binding-set revision, activation set/epoch, validity a writeru. Nepoužitelná pole jsou explicitně `null` podle registry schema.
- Dispatch pinne exact active binding ID, digest, target revision, operation/route, activation epoch a případnou Secret version. Name-only lookup, wildcard, inherited grant a implicit route reuse jsou zakázané.
- Binding change vzniká pouze canonical bind/unbind/publish/activation operation. Runtime cache smí dispatchnout až po ověření current binding-set/activation headu.
- Secret value se nevkládá do registru; registr obsahuje selector/version/purpose/recipient a Secret Broker ověří exact operation context.
- Route, agent tool, browser account/profile a external binding musí mít pozitivní i cross-target negative test.

### Akceptace

- Wrong source/target revision, schema digest, purpose, account/tenant, route, Secret version nebo epoch je odmítnut před side effectem.
- Stale binding po aktivaci/rollbacku nemůže založit nový dispatch ani authoritative write.
- Každý mutující/public/internal operation má právě ten binding relation, který požaduje jeho exposure a operation contract; chybějící binding je fail-closed.
- Registry record je odvozen z implementovaného bindingu a test evidence, nikoli z `operations.map(...)` s `exact: true`.

---

## TD-05 — `BROWSER_LIFECYCLE_INCOMPLETE`

**Vlastník:** Browser Interaction Plane engineer  
**Závislosti:** TD-03, TD-04, TD-12, TD-15, TD-16  
**SSOT:** 13.1–13.21, 14, 49.19–49.20, 50.26–50.28, 51.24, 52.16–52.17, 54.21–54.22

### Cíl

Dodat úplný persisted upload, download, challenge, WebAuthn/passkey, account-state, action/reconciliation a cleanup lifecycle přes jediný Browser Interaction Plane.

### Kritické opravy výchozího stavu

- Odstranit `payload.path` a `access(file)` jako vstup arbitrary host cesty. Upload přijímá pouze session/run-scoped artifact handle s digestem, MIME, velikostí, expiry a target policy.
- Download se nesmí ukládat do callerem zadané cesty. Browser temp bytes se převedou na content-addressed artifact, ověří origin, initiator, MIME, size, digest/content schema a atomicky publikují před context close.
- `CHALLENGE`/`PASSKEY` nesmí být pouze exception string. Vznikne persistentní challenge row, checkpoint a state `CHALLENGE_REQUIRED`; resolution je vázané na run/session/page/frame/document/origin/RP/account/control/auth epoch a expiry.
- WebAuthn assertion a registration jsou odlišné operation classes. Platform private key se nikdy nekopíruje na server; platform passkey a non-exportable certifikát používají current OWNER Device Bridge.
- Observation, URL, screenshot, Playwright return ani loader disappearance nejsou obecný success oracle. Každá mutující action má durable side-effect ledger, phase `MUTATION_TRIGGER_POSSIBLY_ISSUED`, operation-specific postcondition a independent read-back.

### Povinné dílčí lifecycle

1. Upload handle create → validate → exact chooser pre-arm → consume CAS → dispatch evidence → terminal/cleanup.  
2. Download started → streaming/temp → completed/failed → artifact persisted → origin/content verified → terminal; partial bytes nejsou canonical artifact.  
3. Challenge pending → resolved/rejected/expired/cancelled → atomic consume + resume enqueue → fresh observation/precondition.  
4. Browser action T1 intent/outbox → D fresh authority claim → host/bridge phase events → postcondition/read-back → applied/not-applied/unknown.  
5. State bundle capture/verify/activate a restore s auth epoch, credential/cert versions a forbidden member kinds.  
6. Cleanup přes všechny resources uvedené v SSOT 49.20/51.24.8; terminal session není closed bez `COMPLETE`.

### Soubory ve vlastnictví úkolu

`packages/browser-*`, `apps/browser-*`, BrowserSessionService části `apps/server`, `apps/server/src/preview-ws.ts`, browser migrations a browser test/fixture suites. Raw Playwright/CDP cesta mimo tuto hranici nevznikne.

### Povinné testy

- chooser race, stale document/control/target, upload digest mismatch, partial upload;
- download start bez completion, context crash před persistencí, wrong origin/MIME/digest, safe resume;
- OTP auto-submit intent před prvním znakem, delayed push po timeoutu, duplicate/changing resolution;
- assertion vs registration, real passkey bridge, virtual authenticator pouze test policy, wrong RP/account;
- popup/OOPIF/navigation/renderer/worker/host/bridge crash před a po mutation triggeru;
- OWNER takeover neutralizuje pressed input; reconnect nereplayuje unacknowledged input;
- unknown outcome blokuje concurrency key a nový mutující action;
- orphan inventory po cleanupu je nula.

### Definition of Done

`BROWSER_FIXTURE`, relevantní `POSTGRES_REAL`, `SYSTEMD_RUNTIME`, `CROSS_SUBSYSTEM` a production-shaped browser gates mají PASS; browser raw transport, arbitrary path, stale write a false success negative testy mají prokazatelný deny.

---

## TD-06 — `CLOSURE_PREDICATE_REGISTRY_EMPTY`

**Vlastník:** Terminal closure / orphan-free recovery engineer  
**Závislosti:** TD-03, TD-09, TD-12, TD-15, TD-16 a domain lifecycle tasks  
**SSOT:** 48.38–48.40, 49.34–49.36, 51.26, 54.26, 55.13

### Cíl

Nahradit statické deklarace closure predicates skutečně spustitelnými direct-state oracly pro každý terminal root.

### Implementační kontrakt

- Každý root kind má record se všemi poli SSOT 55.13 a konkrétní `directQueryIds` odkazující na versioned implementace.
- DB část běží v `SERIALIZABLE READ ONLY DEFERRABLE` snapshotu; doplňuje ji fenced runtime/process/cgroup/socket inventura, filesystem/artifact inventura a podle relevance external/provider/browser read-back.
- `passExpression` je deterministický boolean AST nad named predicates; volný text `AND_ALL_PREDICATES` bez evaluatoru není přípustný.
- Predicate kontroluje terminal state, children, leases/fences, possible effects, pointers/epochs, bindings, queue/outbox/inbox, artifacts, cleanup, audit chain a unresolved manual review.
- Late evidence se ukládá jako evidence, ale stale fence nesmí změnit terminal root. Nový authority-bearing child po closure barrieru musí být fyzicky znemožněn root lockem/constraintem.
- API `/system/closure` a self-test evidence zobrazí jednotlivé failing predicates, query/runtime evidence digests a orphan inventory.

### Akceptace

- Každý terminal root má právě jeden active closure record, executable queries, requirements a test IDs.
- Záměrné ponechání aktivního lease, procesu, socketu, outboxu, unknown effectu, active pointeru, temp artifactu či cleanup resource způsobí FAIL odpovídajícího predicate.
- Business outcome se při cleanup failure nepřepisuje; closure zůstane FAIL a conflicting reuse je blokované.
- Closure record nevzniká jen z názvu state machine a stejná blanket šablona bez root-specific children/side effects se nepřijme.

---

## TD-07 — `ERROR_RETRY_REGISTRY_EMPTY`

**Vlastník:** Stable error / retry semantics engineer  
**Závislosti:** TD-12, TD-15, TD-16  
**SSOT:** 6.8, 10.10 a 10.26, 32, 49.28, 51.32, 52.32, 55.10.1 a 55.17

### Cíl

Vytvořit jedinou přesnou machine-readable projekci stable error catalogu a zajistit, že všechny vrstvy používají stejnou classification, side-effect point a retry/recovery directive.

### Implementační kontrakt

- Parser kapitoly 32 vytvoří právě jeden active record pro každý skutečný stable error code; běžné enumy nebo success markery typu `*_PASSED` se nesmějí mylně vydávat za error code.
- Každý record splní celé schema 55.10.1. `FIXED` má právě jednu fixed directive; `EVIDENCE_DECISION_TABLE` odkazuje na ordered, total a vzájemně bezrozpornou recovery tabulku.
- DomainError, KCIP, HTTP, MCP, OpenAI, browser, runtime a UI mappery čtou stejný record/digest. HTTP status ani SDK exception nesmí přepsat recovery meaning.
- `RETRY_SAME_OPERATION`, `REFRESH_AND_RETRY_NEW_COMMAND`, `RECONCILE_THEN_RETRY`, `MANUAL_REVIEW` a terminality musí zachovat logical operation/idempotency podle SSOT.
- Unknown runtime code failne closed; source-only code bez registry relation blokuje build.

### Testy

- Duplicate code se dvěma významy → compiler FAIL.
- Fixed code bez directive a decision-table code bez total rules → FAIL.
- Stejný code přes HTTP/KCIP/MCP/UI vrátí transportně správnou reprezentaci, ale stejný canonical meaning.
- Timeout před dispatch, po intentu, po possible effect a po terminal DB commitu vede do čtyř správných větví.
- Mutation test, který zapne boolean `retryable` proti registru, musí být zachycen.

---

## TD-08 — `EXPOSURE_PARITY_REGISTRY_EMPTY`

**Vlastník:** API/UI/chat/self-test parity engineer  
**Závislosti:** TD-04, TD-12, TD-20  
**SSOT:** 2.8–2.11, 22–24, 26, 42, 55.18

### Cíl

Pro všech 262 operací doložit skutečnou paritu podle exposure class; nahradit syntetické `API-*`, `UI-ACTION-*`, `CHAT-*` a `SELFTEST-*` identifikátory resolvovatelnými implementačními vazbami.

### Implementační kontrakt

- Každá operation má právě jednu z classes `OWNER_COMMAND`, `OWNER_QUERY`, `PUBLIC_PROTOCOL`, `INTERNAL_PROTOCOL`, `AUTOMATED_MAINTENANCE`, `EVIDENCE_ONLY`.
- Registry validator fyzicky ověří existenci a exact binding každého route handleru, UI action/view, chat capability, audit eventu, self-test case a acceptance gate.
- UI/chat/action nesmí implementovat vlastní mutaci; volají stejnou canonical operation se stejným command schema, idempotency a outcome.
- Internal protocol nedostane umělý public mutation endpoint. Musí mít parent business relation, diagnostickou/recovery projekci a evidence.
- Výjimka je možná pouze strukturovaným `notApplicableReason` odvozeným z exposure class a supporting requirementu.

### Akceptace

- Každý z 262 records projde resolve testem na existující symbol/route/surface/test, ne pouze regex ID.
- Odstranění nebo odpojení kterékoliv povinné surface způsobí `EXPOSURE_PARITY_INCOMPLETE`.
- Contract test porovná stejnou operation spuštěnou přes API, UI adapter a chat adapter: vznikne tentýž command schema, writer, idempotency scope a canonical outcome.
- Audit, self-test a OWNER diagnostika jsou dostupné i pro internal/automated/evidence operations podle tabulky 55.18.

---

## TD-09 — `FAULT_CATALOG_EMPTY`

**Vlastník:** Fault injection / crash-point engineer  
**Závislosti:** TD-12, TD-15, TD-16 a hotové domain lifecycle  
**SSOT:** 49.25, 50.36, 51.34, 52.33, 54.6–54.8, 55.11

### Cíl

Vytvořit stabilní katalog skutečných before/after cutpoints v produkčním kódu. Současný jeden generický record `PRE_AND_POST_SIDE_EFFECT` na operaci není fault catalog.

### Implementační kontrakt

- Každý applicable critical krok má canonical name `<subsystem>.<operation>.<phase>.<before|after>`, stable ID, operation/state-machine relation, přesnou source location/symbol digest, possible-effect class, applicable fault kinds, oracle, direct queries, cleanup checks a test coverage.
- Hooks jsou inertní production instrumentation. Aktivace je možná pouze compile-time allowlisted test harness capability v disposable/test namespace; request/handler nemůže dodat arbitrary fault name.
- Hook leží bezprostředně na obou stranách DB commitu, dispatch triggeru, pointer switchu, artifact fsync/rename, terminal commitu a cleanup boundary tak, aby recovery význam byl pozorovatelný.
- Přesun/odstranění hooku mění digest/lineage a invaliduje schedule; compiler odmítne stale source location.
- Katalog se generuje z explicitních typed hook declarations v reálné implementaci, nikoli plošným `operations.map()`.

### Akceptace

- 100 % critical fault points má before i after test podle applicability.
- Každý injected fault prokáže, že nastal na deklarované straně possible-effect triggeru.
- Single-fault × cutpoint, povinné pairwise a eight three-way schedules mají exact coverage report.
- Production bez test capability nemůže fault aktivovat; pokus je auditovaný deny.

---

## TD-10 — `GENERATION_PIPELINE_INCOMPLETE`

**Vlastník:** Generation orchestration / activation engineer  
**Závislosti:** TD-03, TD-04, TD-06, TD-12, TD-14, TD-15, TD-16  
**SSOT:** 12.1–12.46, 49.15–49.18, 51.26, 54.23, 55.15–55.16

### Cíl

Implementovat celý výrobní tok `DISCUSSING → ANALYZING → IMPLEMENTING → INTEGRATING → VALIDATING → CML_CONFORMANCE → ACTIVATING → COMPLETED`, persistentní workspace, live candidate, rollback a orphan-free cleanup včetně prvního CREATE.

### Kritické opravy

- Nahradit současný odlišný lifecycle (`INTAKE`, `DISCOVERY`, `SPECIFICATION`, …) přesnou state machine SSOT nebo prokázat bezeztrátové interní mapování; observable/persisted canonical states musí být SSOT states.
- Každá fáze má `generation_phase_run`, lease/fence, terminal evidence, checkpoint a atomický successor enqueue. Nelze jen aktualizovat procento a vložit checkpoint.
- Workspace authority je immutable DB/object-storage content mapping a revision pointer. Jednotlivý inline file insert není atomic `WorkspacePatchSet`.
- Implementovat typed patch set s base revision, expected previous digests, ordered ADD/UPDATE/DELETE, path containment, atomic CAS a materializací přes temporary directory + atomic rename.
- Integration je checkpointovaná 14kroková saga dle SSOT 12.30 s deterministic resource IDs, T1/D/T2/T3, read-back a compensation.
- Validation skutečně spouští gate catalog 12.32 nad live candidate runtime; row se stavem `RUNNING` ani modelové tvrzení není PASS.
- CML conformance mapuje requirements na artifacts/API/UI/test/evidence. Activation používá frozen membership, barrier, atomic all-pointer switch s vyšším epoch, postflight a atomic reverse switch.

### První CREATE a cleanup

- Provisional identity se alokuje jednou a v jobu se znovu použije; nevzniká paralelní náhradní identity.
- Před-switch failure uklidí runtime, route, bindings, filesystem pointer, releases a provisional authority.
- Po-switch failure nejprve atomicky přepne celý activation domain na `ABSENT` s vyšším epoch; až potom zastavuje runtime.
- Cleanup má root/resources pro proces/cgroup/socket/route/binding/filesystem/browser/Secret invalidation/external effect a skončí `COMPLETE` jen po `NOT EXISTS` všech živých referencí.
- Nový remediation candidate je blokovaný do complete cleanup nebo explicitního `MANUAL_REVIEW` blockeru.

### Povinné testy

- Crash před/po každém phase terminal commitu a successor enqueue.
- Workspace crash před DB pointerem, po DB commitu a před atomic rename.
- Každý integration step: duplicate, stale fence, external ambiguity, compensation.
- Stale candidate po validation PASS; activation barrier vs in-flight mutation; crash před/po switchi.
- First CREATE failure před switchi, po switchi, po ACTIVE; previous musí být exact `ABSENT`.
- UPDATE/REPAIR obnoví frozen previous snapshot, nikdy jeho přibližnou rekonstrukci.
- Cleanup failure drží closure FAIL a blokuje remediation; po resume je orphan inventory nula.

### Definition of Done

Generation coordinator a phase workers používají jednu shared state machine; live candidate, conformance, activation, rollback a cleanup mají runtime evidence. `GENERATION_RECOVERY_PASS` a relevantní cross-subsystem gates jsou PASS.

---

## TD-11 — `GENERIC_ENTITY_SCHEMA`

**Vlastník:** PostgreSQL schema / migration engineer  
**Závislosti:** žádná funkční; koordinace s TD-15 a TD-17  
**SSOT:** 25.1–25.15, 49.26, 51.29–51.36, 55.8

### Cíl

Nahradit všech 163 auditovaných generických `document jsonb` tabulek přesnými fyzickými schématy kapitol 25/49/51 a prokázat jejich constraints, ownership, immutability a migration compatibility. Poslední commit již marker `document jsonb` odstranil, ale úkol se uzavírá až behaviorálním důkazem každé tabulky.

### Rozsah

Úplný seznam 163 auditovaných tabulek je v příloze A. Pro každou tabulku vznikne machine-readable schema contract s:

- exact columns, PostgreSQL types, required/null/default/generated semantics;
- primary, unique, check, composite foreign keys a explicitní delete policy;
- mutable root/immutable revision/event/checkpoint/attempt klasifikací;
- `state_version`, incarnation/deployment/activation/fencing fields pouze tam a přesně tak, jak požaduje aggregate contract;
- exact indexes a partial unique predicates bez volatile času;
- parent ownership a sequence allocation;
- canonical digest/schema validation pravidly pro JSON payloady, které jsou skutečně strukturovaným payloadem, nikoli univerzálním storage modelem;
- requirement IDs, operation/state-machine relations a test IDs.

### Implementační kontrakt

- Greenfield baseline musí být self-consistent. Pokud existuje instalovatelná předchozí schema revision, dodat také forward-only, rollback-compatible migraci se checksum ledgerem; down migration při application rollbacku se nepoužije.
- Fyzicky vyjádřitelný invariant musí být v unique/check/FK/deferred triggeru; aplikační `if` jej nenahrazuje.
- Immutable rows nesmějí mít obecný update path. Mutable root používá guarded CAS a canonical writer.
- Same-parent reference používá composite FK. Active pointer odkazuje na validní parent-owned revision/release a nese epoch.
- Schema compiler nesmí odvozovat sloupce jen ze jména entity. Každý field má SSOT source anchor a parser test.

### Testy a akceptace

- Pro každou tabulku PostgreSQL catalog proof porovná column type/null/default/generated, constraints, indexes, FK/delete policy a immutability.
- Negative SQL testy fyzicky odmítnou duplicate active record, stale pointer, wrong parent, invalid state/nullability/digest a update immutable row.
- Migration test provede fresh baseline i upgrade z auditované schema revision; previous application release funguje ve forward compatibility window.
- Nula generických document-storage tabulek a nula chybějících entity tables; současně nula účelově přidaných nepoužívaných sloupců pouze pro průchod parseru.

---

## TD-12 — `GENERIC_OPERATION_FALLBACK`

**Vlastník:** Canonical operation / domain implementation engineer  
**Závislosti:** TD-03, TD-11, TD-15; rozhraní s TD-04, TD-07, TD-16  
**SSOT:** 6, 10–15, 27, 42, 49, 51, 55.6–55.8

### Cíl

Odstranit univerzální CRUD/fail-closed katalogové náhražky a dodat exaktní produkční implementaci všech 262 kanonických operací. Aktuálně má explicitní větev jen 27 operací a 235 je bez exact behaviorálního handleru.

### Implementační kontrakt pro každou operaci

Každá operation musí mít samostatně reviewovatelný contract a handler, který explicitně realizuje:

1. strict command a response schema včetně targetu, expected versions/epochs, deadline a canonicalization;  
2. exposure class, caller/context preconditions a exact binding;  
3. aggregate root, expected states, povolenou transition a forbidden-by-default chování;  
4. idempotency scope/key/request digest a duplicate/conflict replay;  
5. concurrency key, claim point, lock plan, CAS, fence/incarnation/deployment/activation guards;  
6. transaction profile, T1/D/T2/T3 a audit/event/outbox/successor atomicitu;  
7. side-effect class, possible-effect trigger, retry directive a recovery oracle;  
8. cancellation/timeout/late evidence semantics;  
9. terminal outcomes, cleanup policy a closure predicate;  
10. API/UI/chat/self-test/acceptance/traceability vazby.

### Provedení

- `operation-handler-catalog.ts` zůstává pouze indexem skutečných handlerů. Metadata `strategy`, `entity`, `queue` a `contractDigest` sama nejsou implementace.
- `CanonicalOperationService` dispatchuje na typed handler bez fallbacku `mutateOperationEntity`, generic table mutation nebo univerzální success response.
- Query operations mají exact consistency/sensitivity contract; mutující operations mají state-machine a PostgreSQL contract.
- Dynamic `POST /operations/:operationKey/invoke` validuje operation-specific schema a volá stejný handler jako konkrétní API route.
- Implementace se může commitovat po rodinách z přílohy B, ale jeden vlastník odpovídá za úplnost všech 262 a jejich cross-family invarianty.

### Akceptace

- Catalog/handler bijekce 262:262 je jen první strukturální gate; každý handler navíc musí projít behaviorální suite.
- Neznámá operation, chybějící handler nebo route bez exact operation bindingu failne před mutací.
- Pro každou operation existuje happy path, invalid state, stale version/epoch/fence, duplicate same digest, conflict different digest, cancellation a relevantní crash/recovery test.
- Generic fallback symboly ani equivalent reflection-based CRUD writer v produkční cestě neexistují.
- Operation-specific test kontroluje přímý DB state, audit/event/outbox a closure, nikoli jen HTTP status či katalog metadata.

---

## TD-13 — `MODEL_FAST_NOT_SUT`

**Vlastník:** Stateful model / SUT harness engineer  
**Závislosti:** TD-09, TD-12, TD-15, TD-16, TD-20  
**SSOT:** 49.29–49.30, 54.2–54.5, 54.26–54.33

### Cíl

Oddělit čistý reference model od skutečného SUT adapteru a zavést krokové porovnávání modelu se skutečným release. Jednorázové zavolání `audit.integrity.verify` po dokončení pomocného modelu nález neuzavírá.

### Implementační kontrakt

- `MODEL_FAST` zůstává pure reference-model profil pro rychlé sekvence/shrinker sanity; nesmí být vydáván za blocking release důkaz skutečné implementace.
- `POSTGRES_REAL`, `SYSTEMD_RUNTIME`, `OPENAI_FAKE_TRANSPORT`, `BROWSER_FIXTURE`, `CROSS_SUBSYSTEM`, `PRODUCTION_SHAPED` a `DISASTER_RESTORE` používají skutečnou `CanonicalOperationService`, produkční migrations, queues, brokers/gateways a relevantní runtime hranice.
- Každý generated command provede stejný krok v reference modelu a přes production API/service v SUT. Po každém kroku se porovná abstraktní stav, canonical outcome, přímý DB state, event/audit/outbox/queue/checkpoint, runtime/filesystem/external inventory a closure/orphan stav.
- Machine-readable model registry pokryje každý významný mutable aggregate a obsahuje všechna pole SSOT 54.3; model nekopíruje produkční SQL/handler.
- Command generator vytváří valid, forbidden edge, duplicate, conflict, stale, concurrent, terminal, cancellation, capacity a late-result případy.
- Failure automaticky shrinkuje při zachování preconditions a fault applicability a vytvoří exact replay artifact.

### Akceptace

- Property/chaos runner už nemůže vykázat SUT PASS po jediném read-only commandu.
- Záměrná mutation production handleru, DB fence, idempotency, side-effect order nebo cleanup je zachycena konkrétním invariant ID.
- Vadný release selže na shrunk replay; opravený stejný replay projde.
- Environment bez potřebného SUT vrací `NOT_EXECUTED_ENVIRONMENTAL`, nikoli model-only PASS pro blocking gate.

---

## TD-14 — `OPENAI_LIFECYCLE_INCOMPLETE`

**Vlastník:** OpenAI Responses / Agents SDK runtime engineer  
**Závislosti:** TD-03, TD-07, TD-12, TD-15, TD-16  
**SSOT:** 11.2–11.22, 12.9–12.17, 49.14, 51.23, 52.1–52.37, 53

### Cíl

Implementovat úplný persisted foreground/background/retrieve/resume/tool-output/continuation/Agents RunState lifecycle přes jediný `packages/openai-runtime` path.

### Kritické opravy výchozího stavu

- Local lifecycle musí používat exact stavy a hrany SSOT 52.7; vlastní `submit_state` marker nesmí sloučit provider status, local state a recovery classification.
- T0 prepare, T1 pre-dispatch claim, D provider call, T2 handle persistence, T3 ordered event/output persistence a T4 terminal/continuation musí být oddělené durable hranice.
- Background recoverable call nastaví `background=true` a `store=true`; response ID se persistuje před závislostí na dalším eventu. Poll/retrieve/resume nikdy nezakládá nový create.
- Resume stream používá poslední contiguous provider sequence a dedupe. Clean EOF není completion.
- Function call vzniká jen z complete output itemu, páruje se přes `call_id`, persistuje raw/parsed arguments, exact binding, authority/provenance a dispatch reservation.
- Tool outcome se modelu posílá až po canonical outcome commitu. Append JSON do `ai_model_call.output_items` bez unique tool-dispatch/outcome rows není dostačující.
- Všechny calls z producing response musí mít známé resolution; `OUTCOME_UNKNOWN` blokuje continuation.
- Successor model call, ordered outputs, post-tool checkpoint a unique continuation reservation jsou atomické.
- Agents SDK invocations, handoffs, approvals, sessions, compaction, memory a serialized RunState používají stejný persisted runtime; přímé `run(agent, …)` bez DB lifecycle není produkční cesta.

### Povinné recovery

- Po `DISPATCH_STARTED` bez response ID je outcome unknown a blind create zakázán.
- Se známým response ID se vždy retrieve/resume/canceluje tentýž handle.
- Provider retention expiry se liší podle úplnosti local evidence.
- Provider/tool/cancel/terminal races rozhodují guarded DB commitem; late result je immutable evidence.
- Unknown output item se neztrácí a blokuje unsupported continuation.
- Previous-response, OpenAI conversation, KCML session a stateless history strategies jsou vzájemně exkluzivní.

### Testy a akceptace

Implementovat nejméně všech 66 scénářů SSOT 52.36 a devět crash bodů 52.33 před/po hranici. Fake transport musí mít dispatch counter a deterministic event stream; bounded live profil ověří safe retrieve/tool round-trip. Žádný duplicate provider create, tool effect, successor, session item ani terminal commit.

---

## TD-15 — `POSTGRES_CONTRACT_MATRIX_EMPTY`

**Vlastník:** PostgreSQL transaction / concurrency engineer  
**Závislosti:** TD-11, TD-12; koordinace s každým domain taskem  
**SSOT:** 25, 49, 51.1–51.38, 55.8

### Cíl

Nahradit jednotně vyplněné deklarace přesnou per-operation PostgreSQL Contract Matrix a fyzickou implementací každého kontraktu.

### Implementační kontrakt

- Každá mutující operation má právě jeden exact record se všemi poli 55.8 a obousměrnou vazbou na Operation Catalog. Read-only operation má explicitní read profile nebo machine-checkable non-applicability.
- Hodnoty se nesmějí plošně defaultovat. Isolation, transaction segments, lock sets, absent-row guard, CAS/fences, constraints, sequences, outbox/inbox, side-effect split, SQLSTATE a migration implications vycházejí z konkrétního handleru a aggregate invariantu.
- Runtime transakce musí instrumentovat získané lock classes; test/debug guard odmítne pokus získat nižší class po vyšší.
- Každý external effect má T1 intent/authority outbox, fresh D claim a T2/T3 outcome/reconciliation. Handler nedrží DB lock během network/provider/browser/filesystem/systemd callu.
- Fyzické unique/check/composite FK/deferred triggers realizují deklarované invarianty. Matice bez odpovídajícího DDL/SQL path a testu je neplatná.
- SQLSTATE mapping zachová stejnou logical operation a respektuje possible-effect hranici; deadlock v blocking testu je lock-plan defect i při úspěšném retry.

### Testy

Implementovat všech 56 scénářů SSOT 51.34 na skutečném PostgreSQL 16, nejméně dvou connections a explicitních barriers. Každý test kontroluje roots, versions, fences, leases, pointers, immutable rows, idempotency, events, audit chain, outbox/inbox, queue, side effects, cleanup a orphan inventory.

### Akceptace

- Počet matrix records odpovídá přesně množině mutujících operations, nikoli počtu entities.
- Každý record má operation-specific parallel/crash test IDs a fyzické schema anchors.
- Generic record se stejným lock planem/constraints pro nesouvisející operations je odmítnut, pokud není prokázána skutečná shoda všech invariantů.

---

## TD-16 — `RECOVERY_ORACLE_RULES_EMPTY`

**Vlastník:** Recovery decision / reconciliation engineer  
**Závislosti:** TD-06, TD-07, TD-09, TD-12, TD-15  
**SSOT:** 48.23–48.40, 49.25 a 49.36, 54.12–54.26, 55.12 a 55.17

### Cíl

Nahradit jediný obecný four-rule oracle úplnou sadou operation/state-machine-specific rozhodovacích pravidel nad autoritativní evidence.

### Implementační kontrakt

- Každý recovery-relevantní operation a state machine má oracle record se schema 55.12.
- Každé pravidlo má prioritu, total predicate, právě jednu allowed action, canonical outcome, retry directive, transition ID, fencing guards a evidence to persist.
- Predicates jsou vzájemně výlučné nebo vedou ke stejnému action/outcome. Coverage validator prokáže úplnost nad observed-state schema; mezera vede do explicitního default `MANUAL_REVIEW`.
- Vstupy jsou pouze persisted/fresh evidence: root/version, idempotency, lease/fence/epochs, checkpoint, intent/outbox/claim, send phase, target handle/read-back, provider/browser evidence, pointer/runtime/cleanup inventory.
- Process memory, absence logu, exception text, timeout, HTTP status nebo worker death nejsou decisive evidence.
- Oracle action se provede canonical operation s fresh fence; samotný evaluator nesmí přímo zapisovat business state.

### Testy a akceptace

- Každá rule větev má positive i boundary test a příslušný fault schedule.
- Dvě různé automatic actions pro stejný observed state způsobí `RECOVERY_ORACLE_CONFLICT`.
- Unknown possible effect vždy blokuje conflicting keys do reconciliation/OWNER resolution; nevznikne blind retry.
- Mutation oracle (změna priority/predicate/action, odstranění guardu, použití chybějícího logu jako důkazu) je zachycena.

---

## TD-17 — `REQUIREMENTS_UNMAPPED`

**Vlastník:** Contract Pack compiler / requirement traceability engineer  
**Závislosti:** začíná ve vlně A; finální uzavření po všech implementačních tasks  
**SSOT:** 55.2–55.6, 55.19–55.20

### Cíl

Zpracovat všech 13 959 normativních atomů a vytvořit skutečné obousměrné mapování na implementaci, operations, persistence, tests, gates, runtime evidence a closure. Současných 49 ACTIVE records a 288 records s artifact relation nestačí.

### Compiler kontrakt

- Použít pinned CommonMark-compatible AST parser, NFC/LF/canonical whitespace a identity algoritmus 55.5. Heading/table/code/list context se zachovává; line wrapping nemění ID.
- Každý registry kind má vlastní JSON Schema 2020-12 se všemi required fields, enums, `additionalProperties` politikou a cross-reference validací. Jeden `common-record` ověřující pouze digest je nepřípustný.
- Každý active record má canonical source relation `AUTHORITY`; specialization/reference nemůže existovat bez targetu.
- Mapování nevzniká z keyword proximity, názvu adresáře, route/entity heuristiky nebo blanket assignment. Každá relation má typed význam a ověřitelný implementation/test anchor.
- Mutující requirement odkazuje operation, aggregate, state machine, persistence, test a closure. OWNER-visible requirement odkazuje exposure parity. Runtime/security/protocol requirement odkazuje boundary/wire record.
- Prázdné mapování je možné pouze strukturovaným `notApplicable` s fieldem, stable reason code a supporting requirement ID.
- Compiler je deterministický; stejné SSOT/schema/source evidence bytes vytvoří byte-identický pack. Ruční edit registry je drift.

### Integrační rozhraní

TD-17 definuje typed source-evidence formát a validátor, do něhož ostatní tasks dodají své symbol/schema/test/runtime anchors. Jen TD-17 mění compiler a registry schemas; generated outputs se regenerují po každé integrační vlně.

### Akceptace

- 13 959/13 959 requirements má validní lifecycle a complete applicable mappings; nula orphan requirements.
- Každý artifact/route/UI/state edge/migration/test má reverse requirement relation; nula orphan implementations.
- Záměrně odpojený atom, stale source ref, lineage cycle, retired requirement použitý active artifactem či blanket mapování způsobí build FAIL.
- Contract Pack manifest používá registry-specific schemas a exact digests; structural PASS se nevydává za implementation/architecture PASS.

---

## TD-18 — `RUNTIME_BOUNDARY_MATRIX_EMPTY`

**Vlastník:** Trusted Runtime Boundary / Linux IPC engineer  
**Závislosti:** TD-11, TD-19; rozhraní s TD-03, TD-04, TD-15  
**SSOT:** 15, 50.1–50.38, 55.9

### Cíl

Pro každý runtime/process type vytvořit přesnou Runtime Boundary Matrix a prokázat ji behaviorálními Linux/systemd testy. Současných 12 šablonových records s prázdnými requirements a deklarovanými digests není důkaz.

### Implementační kontrakt

- Každý record splní celé schema 55.9: process/systemd identity, UID/GID, channels, peer credentials, execution context, network/endpoints, filesystem, credentials, FDs, capabilities, seccomp/namespace/cgroup digests, prohibited resources, lifecycle/generations/fencing, child/cleanup a tests.
- `prohibitedResources` je konkrétní deny-by-default inventory, ne token `UNDECLARED_RESOURCE`.
- Matrix musí odpovídat skutečným systemd units, socket owner/mode/groups, code paths, sandbox profile a deployment generation. Digest konfigurace bez runtime inspection nestačí.
- Generated handler má jen anonymous FD 3 capability channel; žádnou síť, DB credential/socket, Secret/broker path, browser path, host filesystem ani OWNER API key.
- Peer identity používá SO_PEERCRED + boot/start/InvocationID/cgroup/runtime generation; UID samotné nestačí. PID reuse, stale process/unit/deployment/activation generation je odmítnuta.
- Shutdown/cleanup prokáže drain → TERM → KILL → cgroup empty, uzavřené sockets/FD a žádnou stale authority.

### Povinné testy

Všech 30 negativních testů SSOT 50.35, relevantní crash matrix 50.36 a production evidence bundle 50.37. Každý záznam matice má requirement IDs, konkrétní positive/negative test IDs a naměřené evidence digests.

### Definition of Done

Žádný handler-accessible internal socket/credential/FD, unknown peer, broad writable directory, stale process authority, orphan cgroup/socket nebo unresolved runtime effect. Gate `TRUSTED_RUNTIME_BOUNDARY` má behaviorální PASS na Ubuntu 24.04 profilu.

---

## TD-19 — `RUNTIME_SECCOMP_MISSING`

**Vlastník:** Linux sandbox / seccomp engineer  
**Závislosti:** koordinace s TD-18  
**SSOT:** 15.4, 50.11–50.18, 50.35–50.37

### Cíl

Nahradit současný nefunkční BPF marker produkčně použitelným, verzovaným Node.js 24 sandbox profilem a úplným namespace/mount/FD bootstrapem.

### Kritické vady k odstranění

- Současná BPF série používá u každé shody skok pouze přes následující instrukci, nikoli přímo na `ALLOW`; běžné allowlisted syscalls proto nedostanou správný verdict.
- Profil neověřuje `seccomp_data.arch` a nemá bezpečné pravidlo pro unsupported architecture.
- Filter se instaluje před `fexecve`, ale neumožňuje bezpečně dokončit dvoustupňový exec/bootstrap; přidat široké `execve*` generated kódu by zase porušilo zákaz child procesů.
- Chybí úplný user/PID/cgroup namespace, `pivot_root`, privátní `/proc`/`dev`/tmpfs, `openat2` containment, FD 3 a `close_range` contract; environment se neshoduje s SSOT 50.16.

### Implementační kontrakt

- Použít dvoustupňový trusted bootstrap: launcher vytvoří namespaces/mounty/identity/FDs a execne immutable trusted Node bootstrap; ten po načtení runtime, před importem generated handleru, instaluje konečný seccomp profil bez `execve/execveat/socket/connect/mount/setns/unshare` a teprve potom načte handler.
- Filter má explicitní architecture guard, default kill/typed deny, argument guards pro `clone/clone3` thread-only flags a `prctl`, zákaz io_uring a všech syscall families SSOT 50.15.
- Před handlerem jsou capabilities prázdné, `NoNewPrivileges`, private namespaces, read-only content-addressed release root, tmpfs `/tmp|/run|/work`, privátní `/proc`, minimální `/dev`, žádný `/sys`/host `/run`.
- Otevřené jsou jen FD 0–3; FD 3 je anonymous capability channel, bootstrap nastaví CLOEXEC pro případné child pokusy. Environment je exact allowlist a obsahuje `UV_USE_IO_URING=0`.
- Profile digest je odvozen z canonical compiled rules, uložen v release/runtime instance a ověřen před aktivací.

### Testy a akceptace

- Positive Node/V8/JIT/thread/file/timer/capability-channel workload projde bez rozšiřování profilu za SSOT hranici.
- Každý zakázaný syscall z 50.15/50.35 má behaviorální deny test; socket AF_INET/AF_UNIX, setns/unshare/mount/ptrace/BPF/keyring/io_uring/exec child selžou.
- Initial FD/environment/mount/namespace/capability inventory přesně odpovídá contractu.
- Double-fork/setsid/orphan pokus končí s prázdným cgroup. Unknown syscall requirement je validation FAIL, nikoli globální vypnutí seccompu.

---

## TD-20 — `TEST_EVIDENCE_INSUFFICIENT`

**Vlastník:** QA / acceptance / evidence engineer  
**Závislosti:** všechny funkční a registry tasks; úzká koordinace s TD-09 a TD-13  
**SSOT:** 33–37, 46–47, 50.35–50.37, 51.34, 52.36, 54, 55.14 a 55.18–55.21

### Cíl

Nahradit početní a metadata coverage skutečnou behaviorální evidence suite pro 262 operací, failure/recovery/closure plochu a všechny blocking profiles.

### Implementační kontrakt

- Machine-readable test catalog propojí test ID s requirements, operation/state edge, fault points, oracle queries, environment profile, expected evidence a acceptance gate.
- `it.each(catalog.records)` kontrolující pouze metadata se nepočítá jako operation coverage. Každá operation má skutečný command invocation přes production path a kontrolu canonical outcome + direct authoritative state.
- Povinné vrstvy: strict schema/contract, positive/negative domain behavior, idempotency/conflict, concurrency/linearizability, stale identity/fence/epoch, cancellation/deadline, crash/recovery, side-effect read-back, cleanup/closure, parity a security.
- Testy používají production API, CanonicalOperationService, migrations, queues, brokers, gateways, systemd/runtime a fixtures. Test-only writer/mock cesta nesmí nahradit blocking evidence.
- Environment manifest pinne OS, PostgreSQL, Node, SDKs, Playwright/browser, migrations, release, fault/model/pack digests. Každý result má exact evidence a correlation.
- Flaky retry nesmí skrýt invariant failure. Pouze prokázané pre-test infrastructure failure bez business kroku může být `NOT_EXECUTED_ENVIRONMENTAL`.

### Minimální blocking coverage

- 100 % 262 operations a applicable exposure surfaces;
- 100 % models/states/allowed+forbidden edges/terminal states;
- 100 % critical fault points before+after a single-fault matrix;
- všechny povinné pairwise, osm three-way a šestnáct cross-subsystem scénářů;
- nejméně 10 000 random schedules s reproducible seeds;
- všech 56 PostgreSQL scenarios, 66 OpenAI scenarios, 30 runtime negative scenarios a úplné browser/generation recovery scénáře;
- 100 % closure predicates a oracle mutations; nula orphan, mixed epoch, false success a unresolved duplicate effect.

### Akceptace

- Coverage report je odvozen z dokončených test evidence records, ne z počtu test functions/files.
- Záměrné mutation builds dle SSOT 54.28 jsou všechny zabity specifickými testy.
- `pnpm test`, specializované profiles a `pnpm audit:final` publikují inspectable artifact bundle; každý chybějící blocking environment zablokuje release.

---

## 6. Společná finální acceptance sekvence

Po integraci posledního tasku se na clean checkoutu stejného SHA a v požadovaných prostředích provede nejméně:

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm contracts:build
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:postgres
pnpm test:integration
pnpm test:ipc
pnpm test:systemd
pnpm test:property
pnpm test:chaos
pnpm test:e2e
pnpm test:production
pnpm conformance:audit
pnpm audit:deep
pnpm audit:final
```

K tomu musí proběhnout profile runs `POSTGRES_REAL`, `SYSTEMD_RUNTIME`, `OPENAI_FAKE_TRANSPORT`, bounded `OPENAI_LIVE`, `BROWSER_FIXTURE`, `CROSS_SUBSYSTEM`, `PRODUCTION_SHAPED` a `DISASTER_RESTORE`. Příkazový PASS bez těchto environmentálních evidence nesmí převést architecture nebo release gate na PASS.

Finální closure podmínky:

- 0 blocking findings;
- 18/18 architecture gates PASS s odlišnými, ověřitelnými inputs/evidence;
- 13 959/13 959 requirements bez orphan mappingu;
- 262/262 exact operation handlers a behaviorální evidence;
- všechny mutující operations mají exact PostgreSQL, recovery, fault a closure contract;
- všechny artifacts mají validní file-level traceability a exact digest;
- nulový unresolved `MANUAL_REVIEW`, possible-effect ambiguity, pending cleanup a orphan inventory v release scope;
- `FORENSIC_AUDIT_CURRENT.md` se aktualizuje až z nového auditního výstupu; nikdy ručně před výsledkem.

---

## Příloha A — úplný seznam 163 tabulek nálezu `GENERIC_ENTITY_SCHEMA`

TD-11 musí každou položku samostatně označit jako `SCHEMA_VERIFIED` až po fyzickém catalog/constraint/migration testu:

1. `component`
2. `component_revision`
3. `component_tool_contract`
4. `component_resource_contract`
5. `component_prompt_contract`
6. `component_endpoint_contract`
7. `component_pulse_contract`
8. `component_state_contract`
9. `component_state_transition`
10. `component_runtime_target`
11. `component_contract_binding`
12. `component_release`
13. `component_readiness_gate`
14. `component_e2e_run`
15. `mcp_server_revision_profile`
16. `mcp_registration_probe`
17. `mcp_discovery_snapshot`
18. `mcp_discovery_item`
19. `mcp_tool_alias`
20. `mcp_request_event`
21. `mcp_call_progress`
22. `mcp_input_request_item`
23. `mcp_input_response_item`
24. `mcp_subscription`
25. `mcp_subscription_notification`
26. `mcp_state_handle`
27. `mcp_task_input_request`
28. `mcp_task_input_response`
29. `mcp_task_event`
30. `mcp_idempotency_record`
31. `runtime_execution_context`
32. `runtime_process_identity`
33. `runtime_ipc_connection`
34. `runtime_ipc_call`
35. `runtime_credential_generation`
36. `runtime_cleanup_operation`
37. `external_auth_binding`
38. `secret_binding`
39. `secret_resolution`
40. `secret_access_event`
41. `external_target`
42. `external_target_binding`
43. `external_request_event`
44. `webhook_endpoint`
45. `dashboard_workspace`
46. `dashboard_node_position`
47. `dashboard_connection`
48. `dashboard_runtime_event`
49. `component_state_history`
50. `alert_delivery`
51. `monitoring_scheduler_heartbeat`
52. `audit_archive_outbox`
53. `component_audit_stream`
54. `component_audit_event`
55. `debug_log_event`
56. `generation_source`
57. `generation_fact`
58. `generation_owner_decision`
59. `generation_message`
60. `generation_turn`
61. `generation_spec_revision`
62. `generation_execution_authority`
63. `generation_capability_snapshot`
64. `generation_capability_match`
65. `generation_plan`
66. `generation_plan_node`
67. `generation_plan_edge`
68. `generation_phase_run`
69. `generation_tool_event`
70. `generation_workspace_revision`
71. `generation_workspace_file`
72. `generation_workspace_patch`
73. `generation_artifact_manifest`
74. `generation_contract_candidate`
75. `generation_validation_run`
76. `generation_validation_result`
77. `generation_repair_iteration`
78. `generation_blocker`
79. `generation_activation_member`
80. `generation_event`
81. `openai_model_capability_snapshot`
82. `openai_request_descriptor`
83. `ai_model_event`
84. `ai_model_output_item`
85. `ai_model_output_content_part`
86. `ai_tool_dispatch`
87. `ai_model_continuation`
88. `ai_run_state_checkpoint`
89. `agent_session_compaction`
90. `agent_definition`
91. `agent_revision`
92. `agent_tool_binding`
93. `agent_handoff_binding`
94. `agent_guardrail`
95. `agent_session`
96. `agent_session_item`
97. `agent_run_checkpoint`
98. `agent_message`
99. `agent_tool_call`
100. `agent_handoff_run`
101. `agent_approval_request`
102. `agent_memory_namespace`
103. `agent_memory_item`
104. `agent_trigger`
105. `agent_eval_suite`
106. `agent_eval_case`
107. `agent_eval_run`
108. `agent_eval_case_result`
109. `system_chat_conversation`
110. `system_chat_message`
111. `system_chat_action`
112. `browser_runtime_build_manifest`
113. `browser_session_binding`
114. `browser_host_slot`
115. `browser_context_instance`
116. `browser_page`
117. `browser_frame`
118. `browser_document`
119. `browser_navigation`
120. `browser_preview_frame`
121. `browser_preview_ticket`
122. `browser_preview_event`
123. `browser_control_lease`
124. `browser_control_transfer`
125. `browser_input_event`
126. `browser_action_attempt`
127. `browser_action_dispatch_event`
128. `browser_operation_scope`
129. `browser_irreversible_confirmation`
130. `browser_auth_attempt`
131. `browser_state_bundle_member`
132. `browser_bridge_connection`
133. `browser_bridge_assignment`
134. `browser_profile_lease`
135. `browser_dialog`
136. `browser_permission_request`
137. `browser_upload_handle`
138. `browser_download`
139. `browser_teaching_run`
140. `browser_teaching_step`
141. `browser_automation_definition`
142. `browser_automation_revision`
143. `browser_automation_run`
144. `browser_automation_run_step`
145. `browser_automation_artifact`
146. `browser_auth_binding`
147. `browser_challenge`
148. `self_test_catalog_entry`
149. `deployment_step`
150. `production_acceptance_run`
151. `operational_setting_applied`
152. `domain_command_activation_domain`
153. `activation_domain_barrier`
154. `configuration_apply_run`
155. `authority_lineage`
156. `operation_intent`
157. `content_provenance`
158. `instruction_segment`
159. `operation_context`
160. `semantic_action_plan`
161. `value_derivation`
162. `secret_use_context`
163. `agentic_security_event`

---

## Příloha B — kanonický katalog 262 operací pro TD-12/TD-08/TD-15/TD-20

Všechny operace níže musí mít exact handler, operation-specific contract, relevantní DB/recovery/closure/fault contract a behaviorální evidence. Aktuální explicitní větev existuje jen pro 27 operací uvedených za katalogem; její existenci je stále nutné obsahově ověřit.

### AGENT — 26

`agent.run.start`, `agent.run.status`, `agent.run.pause`, `agent.run.resume`, `agent.run.cancel`, `agent.message.append`, `agent.state.report`, `agent.model.started`, `agent.model.completed`, `agent.tool.request`, `agent.tool.result`, `agent.tool.failed`, `agent.delegate.request`, `agent.delegate.result`, `agent.approval.request`, `agent.approval.approve`, `agent.approval.reject`, `agent.checkpoint.created`, `agent.memory.read`, `agent.memory.write`, `agent.session.compact`, `agent.eval.start`, `agent.eval.result`, `agent.run.complete`, `agent.run.fail`, `agent.run.manualReview`.

### AGENTIC — 2

`agentic.security.event.record`, `agentic.security.evidence.export`.

### AUDIT — 7

`audit.event.append`, `audit.stream.ack`, `audit.stream.replay.request`, `audit.stream.replay.result`, `audit.integrity.verify`, `audit.archive.enqueue`, `audit.archive.complete`.

### AUTHORITY — 8

`authority.lineage.resolve`, `authority.lineage.append`, `authority.intent.compile`, `authority.intent.validate`, `authority.context.create`, `authority.context.validate`, `authority.actionPlan.compile`, `authority.actionPlan.validate`.

### BROWSER — 80

`browser.runtimeBuild.register`, `browser.runtimeBuild.verify`, `browser.host.ready`, `browser.host.drain`, `browser.host.recover`, `browser.session.create`, `browser.session.attach`, `browser.session.observe`, `browser.session.state`, `browser.session.pause`, `browser.session.resume`, `browser.session.close`, `browser.session.recover`, `browser.page.open`, `browser.page.activate`, `browser.page.close`, `browser.page.observed`, `browser.frame.observed`, `browser.document.changed`, `browser.navigation.observed`, `browser.preview.ticket.create`, `browser.preview.viewer.connected`, `browser.preview.viewer.disconnected`, `browser.preview.resync`, `browser.control.acquire`, `browser.control.release`, `browser.control.changed`, `browser.control.transfer`, `browser.target.pick`, `browser.target.revalidate`, `browser.action.start`, `browser.action.status`, `browser.action.dispatchPhase`, `browser.action.cancel`, `browser.action.reconcile`, `browser.action.resolveOutcome`, `browser.action.complete`, `browser.action.fail`, `browser.dialog.opened`, `browser.dialog.respond`, `browser.permission.request`, `browser.permission.respond`, `browser.challenge.required`, `browser.challenge.resolve`, `browser.auth.verify`, `browser.account.save`, `browser.account.verify`, `browser.account.logout`, `browser.account.authEpoch.increment`, `browser.state.capture`, `browser.state.verify`, `browser.state.activate`, `browser.state.invalidate`, `browser.upload.create`, `browser.upload.consume`, `browser.download.started`, `browser.download.persist`, `browser.download.verify`, `browser.artifact.created`, `browser.bridge.enroll`, `browser.bridge.connect`, `browser.bridge.assign`, `browser.bridge.release`, `browser.bridge.test`, `browser.bridge.rotateCertificate`, `browser.bridge.revoke`, `browser.profile.acquire`, `browser.profile.release`, `browser.teaching.start`, `browser.teaching.compile`, `browser.automation.preflight`, `browser.automation.verify`, `browser.automation.run`, `browser.automation.cancel`, `browser.automation.reauthenticate`, `browser.automation.reconcile`, `browser.automation.repair`, `browser.schedule.evaluate`, `browser.run.manualReview`, `browser.cleanup.resume`.

### CHAT — 9

`chat.conversation.create`, `chat.message.append`, `chat.response.stream`, `chat.command.execute`, `chat.browser.session.create`, `chat.browser.session.attach`, `chat.browser.target.attach`, `chat.browser.control.acquire`, `chat.browser.control.returnToAi`.

### COMPONENT — 19

`component.register`, `component.revision.publish`, `component.validate`, `component.verify`, `component.activate`, `component.enable`, `component.disable`, `component.suspend`, `component.quarantine`, `component.restore`, `component.recertify`, `component.rollback`, `component.deregister`, `component.heartbeat`, `component.state.query`, `component.state.report`, `component.control.enable`, `component.control.disable`, `component.control.ack`.

### GENERATION — 26

`generation.job.create`, `generation.message.append`, `generation.turn.interrupt`, `generation.source.add`, `generation.capability.resolve`, `generation.spec.propose`, `generation.spec.precheck`, `generation.spec.approve`, `generation.plan.create`, `generation.plan.validate`, `generation.phase.start`, `generation.model.execute`, `generation.workspace.patch`, `generation.workspace.validate`, `generation.candidate.publish`, `generation.integration.step`, `generation.validation.run`, `generation.blocker.open`, `generation.blocker.resolve`, `generation.activation.prepare`, `generation.activation.switch`, `generation.activation.rollback`, `generation.job.cancel`, `generation.job.resume`, `generation.job.retry`, `generation.job.complete`.

### MCP — 41

`mcp.request.validateTransport`, `mcp.request.validateJsonRpc`, `mcp.request.reserveId`, `mcp.request.finalize`, `mcp.server.discover`, `mcp.era.probe`, `mcp.era.invalidate`, `mcp.discovery.snapshot`, `mcp.discovery.invalidate`, `mcp.cache.invalidate`, `mcp.tools.list`, `mcp.tools.call`, `mcp.tools.progress`, `mcp.tools.cancel`, `mcp.tools.reconcile`, `mcp.input.required`, `mcp.input.respond`, `mcp.resources.list`, `mcp.resources.templates.list`, `mcp.resources.read`, `mcp.prompts.list`, `mcp.prompts.get`, `mcp.subscription.listen`, `mcp.subscription.acknowledge`, `mcp.subscription.notify`, `mcp.subscription.complete`, `mcp.subscription.cancel`, `mcp.stateHandle.create`, `mcp.stateHandle.resolve`, `mcp.stateHandle.close`, `mcp.task.create`, `mcp.task.get`, `mcp.task.update`, `mcp.task.cancel`, `mcp.task.expire`, `mcp.task.notify`, `mcp.contract.validate`, `mcp.contract.compatibility`, `mcp.legacy.probe`, `mcp.legacy.adapt`, `mcp.wire.verify`.

### MONITOR — 8

`monitor.probe.request`, `monitor.probe.result`, `monitor.heartbeat.observe`, `monitor.state.transition`, `monitor.alert.open`, `monitor.alert.update`, `monitor.alert.close`, `monitor.repair.enqueue`.

### OWNERAPIKEY — 4

`ownerApiKey.read`, `ownerApiKey.reveal`, `ownerApiKey.rotate`, `ownerApiKey.session.exchange`.

### PROVENANCE — 3

`provenance.content.register`, `provenance.segment.compile`, `provenance.valueDerivation.create`.

### RUNTIME — 14

`runtime.prepare`, `runtime.instance.start`, `runtime.ready.report`, `runtime.state.report`, `runtime.heartbeat`, `runtime.invoke`, `runtime.cancel`, `runtime.drain`, `runtime.stop`, `runtime.instance.restart`, `runtime.instance.reconcile`, `runtime.boundary.verify`, `runtime.connection.inspect`, `runtime.cleanup.resume`.

### SECRET — 8

`secret.resolve`, `secret.version.create`, `secret.version.activate`, `secret.rotate`, `secret.bind`, `secret.unbind`, `secret.usage.report`, `secret.useContext.create`.

### SELFTEST — 7

`selfTest.catalog.list`, `selfTest.run.start`, `selfTest.run.status`, `selfTest.run.cancel`, `selfTest.run.cleanup`, `selfTest.evidence.read`, `selfTest.registeredElement.run`.

### 27 operací s explicitní větví ve výchozím commitu — všechny vyžadují revalidaci

`audit.integrity.verify`, `browser.session.create`, `component.deregister`, `component.heartbeat`, `component.quarantine`, `component.recertify`, `component.register`, `component.restore`, `component.revision.publish`, `component.state.query`, `component.state.report`, `component.suspend`, `component.validate`, `component.verify`, `generation.job.create`, `monitor.alert.close`, `monitor.alert.open`, `monitor.alert.update`, `monitor.heartbeat.observe`, `ownerApiKey.read`, `runtime.boundary.verify`, `runtime.connection.inspect`, `secret.usage.report`, `selfTest.catalog.list`, `selfTest.evidence.read`, `selfTest.run.start`, `selfTest.run.status`.

Zbývajících 235 operací je ve výchozím commitu bez explicitní behaviorální větve.

---

## Příloha C — 18 povinných architecture gates

TD-01 musí dodat samostatný evaluator a mutation test pro:

- [ ] `ARCH_CROSS_CHAPTER_CONSISTENT`
- [ ] `ARCH_NORMATIVE_AMBIGUITY_CLOSED`
- [ ] `ARCH_SINGLE_WRITER_COMPLETE`
- [ ] `ARCH_OPERATION_LIFECYCLE_COMPLETE`
- [ ] `ARCH_POSTGRES_CONTRACT_COMPLETE`
- [ ] `ARCH_RUNTIME_BOUNDARY_COMPLETE`
- [ ] `ARCH_PROTOCOL_SEMANTICS_COMPLETE`
- [ ] `ARCH_OPENAI_LIFECYCLE_COMPLETE`
- [ ] `ARCH_BROWSER_LIFECYCLE_COMPLETE`
- [ ] `ARCH_AGENTIC_AUTHORITY_COMPLETE`
- [ ] `ARCH_FAILURE_RECOVERY_CONSISTENT`
- [ ] `ARCH_CONTRACT_PACK_DERIVABLE`
- [ ] `ARCH_TRACEABILITY_COMPLETE`
- [ ] `ARCH_ACCEPTANCE_MACHINE_CHECKABLE`
- [ ] `ARCH_CLOSURE_PREDICATES_COMPLETE`
- [ ] `ARCH_NO_OWNER_DECISION_PENDING`
- [ ] `ARCH_REPOSITORY_OWNERSHIP_COMPLETE`
- [ ] `ARCH_EXPOSURE_PARITY_COMPLETE`

---

## Příloha D — předávací checklist každého TD

- [ ] Výchozí commit a SSOT digest odpovídají tomuto dokumentu nebo je doložen integrátorem přidělený successor SHA.
- [ ] Byly přečteny všechny uvedené SSOT sekce a jejich referenced specializations.
- [ ] Změna používá jediný canonical writer/operation a neobsahuje alternativní write path.
- [ ] DB contract, side-effect boundary, recovery, cancellation a closure jsou explicitní.
- [ ] Registry record je odvozen z reálné implementace a exact evidence.
- [ ] Positive, negative, stale, duplicate/conflict, concurrency a relevantní fault testy existují.
- [ ] Přímý authoritative-state oracle ověřuje outcome; response/log/source marker není jediný oracle.
- [ ] Test evidence má requirement/operation/fault/oracle/gate vazby a exact digests.
- [ ] Generated registry files byly pouze regenerovány, nikoli ručně upraveny.
- [ ] Nejsou placeholdery, hardcoded PASS, blanket traceability ani test-only writer.
- [ ] Targeted suite a celý dostupný audit byly spuštěny; neprovedené profily jsou pravdivě `NOT_EXECUTED_ENVIRONMENTAL`.
- [ ] PR uvádí blockers pro návazné tasks a nemění cizí authority root bez integračního schválení.
