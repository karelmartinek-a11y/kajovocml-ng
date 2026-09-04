# Forenzní audit zdrojového kódu a produkčního chování

Datum řezu: 4. září 2026, přibližně 03:00–05:35 CEST  
Auditovaný commit: `b73df873199c410943e5d4af93171cacc3ebdd63`  
Produkční release: `/opt/kajovocml-ng/releases/20260904T025422Z-b73df873199c`  
Produkční endpoint: `https://kaja.hcasc.cz`

## Technický závěr

Program v auditovaném stavu **není možné označit za kompletní, robustní ani na vysoké produkční úrovni**. Release je skutečně nasazen ze stejného commitu, jeho soubory odpovídají release manifestu a základní HTTP health/readiness odpovídají 200. To ale zastírá zásadní nesoulad mezi deklarovanou šíří rozhraní a skutečným provedením:

- katalog obsahuje 262 kanonických operací, ale běžící aplikace jsou převážně jednorázové generické obálky nad stejným workerem; specializované runtime balíky pro agenty, MCP, generation workspace/orchestraci a runtime boundary nejsou z aplikací vůbec importovány;
- 268 z 295 unikátních kódů skutečně vyhazovaných přes `DomainError` není v aktivním registru chyb; produkce proto vrací obecné `ERROR_RECOVERY_CONTRACT_INCOMPLETE` místo skutečné příčiny;
- produkční browser session se sice vytvořila a reálně otevřela `example.com`, ale kanonické uzavření skončilo po opakovaných pokusech `FAILED_FINAL: STATE_VERSION_CONFLICT` a session zůstala `ACTIVE`;
- generation validace umí vydat PASS pouze ze čtyř kontrol existence/stavu/délky digestu, bez buildu, typové kontroly, bezpečnostní kontroly nebo E2E; aktivace je pouze několik databázových UPDATE v jedné transakci;
- `/ready` je zelené i při selhané TLS renewal službě a neaktivním denním backup timeru; samotné UI současně zobrazuje pět provozních oblastí jako `NO EVIDENCE`, přestože API vrací stovky heartbeat záznamů.

Žádný bod níže není odvozen z komentáře, poznámky, staršího auditu nebo výsledku existujícího testu. Komentáře byly při interpretaci ignorovány. Důkaz tvoří výhradně vykonávané příkazy, konfigurace, SQL, typové kontrakty, importní graf a přímé chování stejného commitu na produkci.

## Rozsah a úplnost čtení

Audit zahrnul 227 produkčních/operativních zdrojových souborů, 31 584 řádků a 2 541 304 bajtů. Každý soubor byl přečten od prvního do posledního řádku a opatřen SHA-256. Rozsah tvoří `.github`, `apps`, `packages`, `database`, `deploy` a `scripts`; z důkazů byly záměrně vyloučeny dokumenty, komentářové závěry, starší audity a testovací výsledky. Úplný soupis je v `artifacts/forensic-audit-2026-09-04/source-inventory.tsv`.

Produkční release má shodný source SHA s auditem a `sha256sum -c FILES.sha256` skončil `RELEASE_FILES_OK`. Proto jsou zdrojové a produkční důkazy porovnatelné v jednom řezu.

## Co program podle vlastního kódu deklaruje

Normativní funkční povrch byl odvozen pouze z vlastního operation catalogu, generovaných HTTP tras, databázového schématu a vstupních bodů aplikací. Deklarované oblasti jsou:

| Oblast | Deklarovaná činnost | Počet operací |
|---|---|---:|
| AGENT | definice, runy, model calls, approvals, paměť, delegace, eval, handoff | 26 |
| AGENTIC | autoritativní agentní provedení a výsledek | 2 |
| AUDIT | integrita, append, archivace a provoz auditního řetězce | 7 |
| AUTHORITY | intent/context/action-plan, rozhodnutí a lineage | 8 |
| BROWSER | session, action, observe, auth, state, upload/download, automace, cleanup | 80 |
| CHAT | konverzace, zprávy a centrální modelové odpovědi | 9 |
| COMPONENT | registrace, revision, activation, health, control a deregistrace | 19 |
| GENERATION | job, plán, workspace, kandidát, validace, integrace, aktivace a rollback | 26 |
| MCP | discovery, tools/resources/prompts, calls, tasky, subscriptions a protokol | 41 |
| MONITOR | heartbeat, probe, alert a provozní monitoring | 8 |
| OWNERAPIKEY | singleton credential: čtení, reveal, rotate a session exchange | 4 |
| PROVENANCE | content provenance a evidence | 3 |
| RUNTIME | instance, IPC, boundary, egress, secret/state capability a cleanup | 14 |
| SECRET | import, reveal, rotate, bind, revoke a usage | 8 |
| SELFTEST | katalog, run, evidence a stav | 7 |

Součet je 262. Každá operace, její fronta, entita, strategie, přesný handler a stav produkčního důkazu jsou po jedné řádce v `artifacts/forensic-audit-2026-09-04/operation-assessment.tsv`.

## Registr všech zjištěných odchylek

### Kritické průřezové vady

| ID | Odchylka | Důkaz a skutečný dopad |
|---|---|---|
| F-001 | 268 používaných doménových chyb není registrováno | Zdroj vyhazuje 295 unikátních `DomainError` kódů, ale jen 27 z nich je v aktivním 258položkovém registru; 268 je mimo něj. `canonicalizeDomainError` neznámý kód přemapuje na `ERROR_RECOVERY_CONTRACT_INCOMPLETE`. V produkci se to projevilo u 33 z 42 read-only operací. Všech 424 výskytů je v `unregistered-domain-error-occurrences.tsv`. |
| F-002 | Deklarované specializované runtimy nejsou zapojeny do aplikací | Žádná aplikace neimportuje `@kcml/runtime-boundary`, `@kcml/mcp-runtime`, `@kcml/agent-sdk`, `@kcml/generation-orchestrator` ani `@kcml/generation-workspace`. 23 aplikačních entrypointů má jediný řádek a spouští obecný `runService`; názvy specializovaných systemd služeb tak neznamenají specializovanou implementaci. |
| F-003 | Generation může vyrobit syntetický PASS a syntetickou aktivaci | `runGenerationValidation` kontroluje jen existenci workspace, 32bajtový digest, stav `INTEGRATED` a další 32bajtový digest; pak nastaví `validation_state` i `verification_state` na PASS. `switchGenerationActivation` přepne `READY→SWITCHING→VERIFYING→ACTIVE` bez buildu, deploymentu, runtime postflightu nebo E2E. Integrace zapisuje úspěšné kroky/evidence, aniž by provedla odpovídající externí práci. |
| F-004 | Browser lifecycle nelze spolehlivě uzavřít ani uklidit | Produkční `browser.session.create` otevřela skutečnou stránku a uložila ARIA observation. `browser.session.close` ale osmkrát opakovala stale command a skončila `FAILED_FINAL: STATE_VERSION_CONFLICT`; session zůstala `ACTIVE`. Exact handler očekává jinou sadu lifecycle stavů než browser host, cleanup není hostem obsluhován a v heartbeat byl později `contexts: 0` při stále `ACTIVE` DB session. |

### Kanonické operace, fronty a konzistence

| ID | Odchylka | Všechny relevantní výskyty / dopad |
|---|---|---|
| F-005 | Read výsledek s `bigint` vrací původní neserializovatelný objekt | `acceptedResult` vytvoří `safeResult`, ale do odpovědi vloží původní `result`. Produkční GET detail reálné browser session skončil 422; journal obsahoval `Do not know how to serialize a BigInt`. |
| F-006 | Retry workeru porušuje direktivy registru | Worker opakuje každý error kromě `DO_NOT_RETRY`. Tím opakuje i `REFRESH_AND_RETRY_NEW_COMMAND`, `RECONCILE_THEN_RETRY` a `MANUAL_REVIEW` jako tutéž starou command. Přímý důkaz je osm opakování browser close bez nového expected version. |
| F-007 | U failure záznamu se míchá skutečný a fallback error contract | `effectiveCode` může zůstat neznámý původní kód, zatímco classification, side-effect, recordDigest a HTTP mapping pocházejí z fallback `ERROR_RECOVERY_CONTRACT_INCOMPLETE`. Jeden failure proto není vnitřně kanonicky konzistentní. |
| F-008 | Velká část 262 operací jen zapisuje tvrzení volajícího | Exact handlers pro agent result/eval/handoff, browser verify/state, MCP task/probe a generation evidence přijímají výsledkové hodnoty v arguments a persistují je bez provedení deklarované práce nebo nezávislého ověření. Operation matrix uvádí všechny handlery jednotlivě; postiženy jsou zejména AGENT, BROWSER, GENERATION a MCP. |
| F-009 | Mutace secrets a OWNER credential mají druhou nekánonickou cestu | Speciální HTTP routes volají `SecretManager` a owner credential služby přímo, mimo `CanonicalOperationService`; import navíc provádí samostatné transakce po záznamech. Existují tedy dvě autority zápisu a bulk import není atomický. |
| F-010 | Kanonické OWNER API key operace nejsou ekvivalentní skutečné funkci | Kanonický reveal pouze vrací příznak, rotate pouze mění metadata bez výměny verifieru/tajné hodnoty a session exchange vytváří identifikátor/expiraci bez skutečné session. Speciální HTTP routes dělají jinou práci. |
| F-011 | Nově registrovanou komponentu nelze dovést k deregistraci | Register vytvoří `DRAFT`; deregister přijímá jen `RETIRED`, ale operation catalog ani state handlers neposkytují dosažitelný retire přechod. Produkční fixture `1dd7b786-f48f-41ee-ab6a-c8c1e73d3e72` proto zůstala `DRAFT`; deregister skončil `COMPONENT_DEREGISTER_STATE_INVALID`. |
| F-012 | Generické nested GET scope filtruje nesprávný sloupec | Router vloží parametr `id` i `parentId`; surface reader u klíče `id` přednostně použije child `id` a teprve potom u `parentId` zkusí `parent_id`. Kolekce jako `/components/:id/revisions` tak vyžaduje současně `child.id=parent` i `parent_id=parent`. Všech 94 dotčených tras je v `nested-generic-route-occurrences.tsv`. |
| F-013 | Generické GET vrací celé databázové řádky | `SELECT to_jsonb(t)` nemá per-route projekci ani redakční pravidla. Stejný mechanismus obsluhuje 202 generických GET tras, což rozšiřuje veřejnou datovou stopu při každém přidaném DB sloupci. |
| F-014 | Interní operace jsou v katalogu, ale veřejný invoke je odmítá před handlerem | `component.state.query`, `runtime.ready.report` a `runtime.state.report` v produkčním sweepu skončily `EXPOSURE_PARITY_INCOMPLETE`; katalog a UI je přesto prezentují vedle volatelných operací. |

### Browser interaction plane

| ID | Odchylka | Všechny relevantní výskyty / dopad |
|---|---|---|
| F-015 | Browser host zapisuje autoritativní stav přímo do PostgreSQL | Attach, observation, action lifecycle a heartbeat provádějí přímé INSERT/UPDATE z `ManagedBrowserHost`, mimo command službu a její idempotency/admission/fencing tok. |
| F-016 | `FOR UPDATE SKIP LOCKED` při attach není v transakci | Selection běží přes pool; lock se uvolní skončením statementu před následným attach/update. Více hostů může vybrat tutéž session. |
| F-017 | Dispatch action nemá trvalý lease ani atomický side-effect checkpoint | DB claim a Playwright side effect nejsou jeden atomický protokol. Pád po kliknutí/odeslání před persistencí nechá neznámý výsledek bez deterministické obnovy. |
| F-018 | Mutující browser action končí v `RECONCILING`, ale readback není implementován | Host po mutaci pouze zapíše phase vyžadující reconciliaci; žádný nezávislý engine neověří skutečný DOM/server outcome a nedokončí ho. |
| F-019 | `control_holder` se při action nevynucuje | Kontrolují se epochy, nikoli identita držitele řízení. Záznam s cizím/propadlým holderem lze použít, pokud sedí číselné fence hodnoty. |
| F-020 | Automation ignoruje část vlastního kontraktu | `allowedOrigins`, precondition, postcondition a `mutationTrigger` jsou ve schématu, ale runner je nepoužívá. Po každém kroku také neaktualizuje document/observation epoch a považuje okamžitý `ACCEPTED` za úspěch bez čekání na terminal outcome. |
| F-021 | Action schema, dispatch a UI mají tři různé množiny akcí | Schéma obsahuje dialog/permission/challenge; managed dispatch tyto větve nemá, ale má PASSKEY; UI nabízí jen osm základních akcí a nezpřístupňuje upload/download/dialog/permission/challenge/passkey. |
| F-022 | Locator model nestačí pro složitější dokumenty | Implementovány jsou role/label/text/testId bez přesné frame/document identity; host eviduje prakticky hlavní page/frame. Iframe, popup a změna dokumentu mohou adresovat chybný prvek. |
| F-023 | Screenshot není artifact | Host zapíše JPG do lokálního adresáře, ale nevytvoří artifact/preview-frame záznam. Reálná observation měla `screenshotArtifactId: null`; UI tedy nemá autorizovatelný preview artifact. |
| F-024 | UI vždy volá detail nulové browser session | Při žádném výběru používá zero UUID, což na každém otevření Browser obrazovky vyvolá 422. Spolu s BigInt chybou byly v browser console dva produkční HTTP errory. |

### Runtime, IPC, secrets a egress

| ID | Odchylka | Všechny relevantní výskyty / dopad |
|---|---|---|
| F-025 | Runtime boundary je mrtvý kód | Obsáhlý sandbox launcher existuje, ale `runtime-host` a `runtime-gateway` jej neimportují; oba jsou generické workers. Produkce tedy neprokazuje, že sandbox vůbec ohraničuje deklarované runy. |
| F-026 | `createAnonymousCapabilityPair` nevytváří socketpair | Vrací jen dvě čísla file descriptorů (`3` a předaný fd); nevytvoří anonymní kanál, nevlastní lifecycle a neověří, že fd existuje. |
| F-027 | Capability client není bezpečný pro souběh | Každý invoke používá sequence `0`, přidává nový `data` listener a nemá korelaci více odpovědí, cancellation ani pevný deadline cleanup. Souběžné requesty se mohou splést a listener leakovat. |
| F-028 | Legacy HMAC transport nemá replay ochranu | Ověří podpis, ale nemá nonce/sequence cache nebo freshness window. Zachycený validní rámec lze znovu přehrát. |
| F-029 | Secret broker autorizuje jen OS UID | Neověřuje vazbu konkrétního executionId, targetu, účelu a povoleného secret use; caller s přístupem k socketu může požádat o libovolné secret id. |
| F-030 | Egress enforcement je pouze allowlist URL/metody | Nejsou prosazeny auth binding, credential injection policy, rate limit, circuit breaker/retry contract ani DNS rebinding ochrana. Response body se celý bufferuje až do 2 MB. |
| F-031 | State capability namespace je jen `executionId` | Chybí component/revision/activation/secret-use lineage; znalost executionId je prakticky jediný aplikační oddělovač. |
| F-032 | Sdílená skupina ruší least privilege mezi službami | Všechny služby běží se skupinou `kcml-platform`; `runtime.env`, master key a řada datových cest jsou group-readable/writable. Browser, generic workers a další procesy tak sdílejí DB credential a kryptografický klíč. |
| F-033 | Preview ticket používá předvídatelný fallback klíč | Pokud chybí `KCML_PREVIEW_TICKET_KEY`, server vytvoří klíč z veřejně známého `cipher.keyId` paddingem nul. Na produkci proměnná skutečně chybí. |
| F-034 | Preview WebSocket není úplná WebSocket implementace | Server skládá jen jednoduché server→client frames; neimplementuje běžné čtení maskovaných client frames, fragmentaci, ping/pong a úplný close handshake. Ticket je hlavní autentizační hranice. |
| F-035 | Preview čte cestu artifactu přímo z DB | File path z persistence jde do `readFile` bez kanonikalizace vůči artifact rootu; při kompromitovaném zápisu DB je možný lokální file disclosure. |

### MCP a agenti

| ID | Odchylka | Všechny relevantní výskyty / dopad |
|---|---|---|
| F-036 | MCP runtime není zapojen a server nemá `/mcp` transport | Balík existuje, ale žádná aplikace jej neinstancuje. Běžící MCP-nazvané služby jsou generic command workers a HTTP server nevystavuje MCP JSON-RPC endpoint. |
| F-037 | Implementovaný MCP runtime pokrývá jen zlomek katalogu | Obsahuje discover, tools/list a tools/call; chybí initialize negotiation, resources, prompts, tasks, subscriptions, elicitation a stream transport. |
| F-038 | MCP tools/call směšuje externí tool s interní operací | Tool name se používá jako název kanonické platformní operace. Neexistuje skutečný outbound MCP server transport/connection/session. |
| F-039 | MCP evidence je převážně databázový skelet | `resources.read` vrací metadata, task update přijme dodaný stav, era/legacy probe hlásí podporu bez wire handshaku a některé calls jen vloží řádek `EXECUTING`. |
| F-040 | Agent SDK není zapojen | `agent.run.start` vytvoří řádek, ale žádný běžící app entrypoint nevolá `AgentSdk.execute`; model started/completed a eval/handoff/delegate ukládají caller-supplied výsledek. |

### Generation a activation

| ID | Odchylka | Všechny relevantní výskyty / dopad |
|---|---|---|
| F-041 | Sedm generation služeb konzumuje stejnou frontu stejným generic workerem | Coordinator, OpenAI, workspace, integration, validation, activation a obecný worker nejsou funkčně oddělené procesy; názvy služeb vytvářejí dojem pipeline, importní graf jej nepotvrzuje. |
| F-042 | `integrateCandidate` deklaruje 14 reconciled kroků bez integrace | Po kontrole workspace souborů vyrobí integration evidence a saga steps jako `RECONCILED`; neaplikuje release, komponentu, runtime ani deployment. Vstupní activation epoch není materiálně použit. |
| F-043 | Validation gate neměří kvalitu programu | Čtyři gates kontrolují pouze existenci a formát/stav; nejsou zde compile, typecheck, lint, dependency/security scan, migrace, contract behavior, browser E2E ani production smoke. Přesto se `verification_state` nastaví PASS. |
| F-044 | Aktivace a rollback jsou databázové simulace | Aktivace mění head a set state v jedné DB transakci; rollback obdobně vrací snapshot v DB. Není proveden deploy, reload služby, health/postflight nebo důkaz efektivního runtime přepnutí. |

### Auth, audit, monitoring a provoz

| ID | Odchylka | Všechny relevantní výskyty / dopad |
|---|---|---|
| F-045 | Readiness může být zelené při selhané povinné službě | `/ready` v produkci vrátil ready a 22 očekávaných heartbeat služeb, zatímco `kcml-canonical-tls-renew.service` je FAILED. Tato služba není zahrnuta do heartbeat readiness množiny. |
| F-046 | Denní backup timer je enabled, ale neaktivní a bez historie | `kcml-backup.timer` měl `Active: inactive (dead)`, `Trigger: n/a`, journal bez záznamů a tabulka `backup_record` měla 0 řádků. Kód při instalaci pouze enableuje timer; aktivaci aktuální produkce neprokázala. |
| F-047 | TLS renewal selhává a nginx má opakované warnings | Canonical renewal 4. 9. skončila exit 1; nginx současně hlásí redefinované TLS protocol options na IPv4 i IPv6 a neoptimální `proxy_headers_hash` konfiguraci. Syntax test je úspěšný, provozní čistota nikoli. |
| F-048 | Readiness databáze je příliš mělká | Kontroluje existenci tabulek, singleton počty, extensions a minimální entity floor, nikoli funkční transakční průchod, fronty, backup, TLS, browser host context nebo skutečný provider call. |
| F-049 | `/metrics` je bez autentizace | Provozní metadata lze číst bez OWNER session/API key; povrch není oddělen privátní sítí na úrovni aplikace. |
| F-050 | Auth neudržuje očekávatelná usage metadata | `owner_session.last_seen_at` se při authenticate neaktualizuje a API credential `last_used_at` se při použití neaktualizuje. Throttle je jen podle IP; významné login/logout/revoke události nejsou jednotně v kanonickém auditním toku. |
| F-051 | Secret export je hromadný plaintext reveal | Speciální POST dokáže vydat všechny aktivní secrets. Operace obchází command worker, není rozdělena podle účelu/targetu a rozšiřuje dopad jediné kompromitované OWNER session. |
| F-052 | Heartbeat tabulka hromadí historické instance bez jasného aktuálního pohledu | V produkci bylo 887 heartbeat řádků a mnoho READY/DRAINING/FAILED položek pro stejný service name. Spotřebitel musí správně filtrovat release/instance/expiry; generické UI může zobrazit zavádějící historii. |

### Owner UI, UX a kosmetické odchylky

| ID | Odchylka | Produkční pozorování / zdroj |
|---|---|---|
| F-053 | Dashboard headline metriky nejsou napojené na response | UI očekává `active_components`, `degraded`, `open_alerts`, `running_work` a `timeline`; `/system/readiness` je neposkytuje. Po vytvoření komponenty dashboard stále ukazoval 0 a audit panel tvrdil, že nejsou události, přestože DB měla 79 audit events. |
| F-054 | Health strip vždy hledá nesprávná jména | Substringy `API`, `Workers`, `PostgreSQL`, `TLS`, `DNS` se neshodují s konkrétními service names. Všechny položky se proto ukazují jako `NO EVIDENCE`, i když je 22 služeb READY. |
| F-055 | Security obrazovka zobrazuje statická tvrzení jako stav | Texty typu GitHub Actions secret PASS a bezpečnostní checklist nejsou navázány na pozorovanou evidence nebo čerstvý run. Mohou vizuálně simulovat splnění. |
| F-056 | Releases obrazovka ukazuje statický osmifázový tok | `/releases` v UI vracelo prázdno, i když DB evidovala 23 deployment runů; osm kroků je dekorativní layout, ne stav konkrétního release. |
| F-057 | Dvanáct generation tabů recykluje stejný obsah | Přepnutí Diskuse/Web/Zdroje/Capability/… mění nadpis, ale hlavní evidence a data zůstávají stejné. Funkční šířka je pouze prezentační. |
| F-058 | Agent/Catalog taby recyklují tutéž dataset/projekci | Rozdílné pohledy nevynucují rozdílné entity nebo dotazy; uživatel dostává tentýž generic table pod jiným názvem. |
| F-059 | MCP obrazovka zaměňuje platformní operation catalog za MCP tools | Výsledek discovery se nepoužije jako skutečný server/tool inventory; UI prezentuje interní kanonické operace. |
| F-060 | Operation dialog používá univerzální raw JSON | Pro rozdílných 262 operací nabízí v zásadě `{name, stableKey}`/raw JSON bez typovaných formulářů, field validation, prerequisite guidance a bezpečných defaultů. |
| F-061 | Chat natvrdo volí `gpt-5.4` | Model je jak v request body, tak v UI labelu pevně zapsán. Neodráží model descriptor/activation, dostupnost provideru ani případnou změnu konfigurace. |
| F-062 | Browser UI zpřístupňuje jen menšinu deklarovaných akcí | Ovládací lišta má osm tlačítek; chybí většina akcí z 80operační browser oblasti a neukazuje pending/reconciling terminal status. |
| F-063 | Mobilní health strip je záměrně horizontální overflow bez affordance | Na 390 px je `display:flex; overflow:auto` a každá položka má min-width 145 px; PostgreSQL a další stavové bloky jsou mimo první viewport bez indikace posunu. |
| F-064 | Mobilní command search se zredukuje na nepojmenované úzké tlačítko | Text a klávesová zkratka jsou skryté, zůstane 38px ikonový control bez viditelného popisu; význam není samovysvětlující. |
| F-065 | Sidebar footer ukusuje prostor scrollovacímu menu | Sticky full-height sidebar má samostatně scrollující nav a footer s `margin-top:auto`; při nižším viewportu jsou spodní položky obtížně viditelné a footer vizuálně překrývá konec navigace. |
| F-066 | Stavové barvy klasifikují `OPEN` jako chybu bez kontextu | Obecný `Status` regex řadí jakýkoli text obsahující OPEN mezi bad; legitimní `OPEN` barrier/session/availability stav tak může být červený. Podobně substring PASS/ACTIVE může vytvořit false-positive good tón. |
| F-067 | Desktop i mobil načítají 19 routes, ale route existence není funkční důkaz | Všechny routy měly správný title/heading, command palette se otevřela; většina obrazovek je však generic DataTable/QuietState a prázdný produkční stav neprokazuje mutační workflow. |

## Produkční ověření po jednotlivých funkcích

Všechny 42 read-only operace byly přímo zavolány na produkčním `/operations/:name/invoke`:

- 6 skončilo HTTP 200: `audit.integrity.verify`, `mcp.server.discover`, `mcp.tools.list`, `monitor.heartbeat.observe`, `ownerApiKey.read`, `selfTest.catalog.list`;
- 3 interní operace skončily 422 `EXPOSURE_PARITY_INCOMPLETE`;
- zbývajících 33 skončilo při chybějícím targetu 422 `ERROR_RECOVERY_CONTRACT_INCOMPLETE`, tedy ztratilo svůj konkrétní validační error contract.

Přesný výsledek každé z 42 operací je v `production-read-operation-sweep.tsv`.

U mutací byly provedeny dva řízené end-to-end průchody, aby se nepletla pouhá existence handleru s funkčností:

1. **Component:** register byl terminálně úspěšný, read detail/revisions/releases/usage proběhl; deregister skončil terminální chybou a odhalil nedosažitelný lifecycle.
2. **Browser:** create byl terminálně úspěšný, host otevřel stránku, vytvořil page/frame identity a ARIA snapshot `Example Domain`; detail GET odhalil BigInt serializaci a close odhalil retry/lifecycle vadu.

Dalších 216 mutačních operací nebylo násilně spuštěno bez platných produkčních agregátů (agent, MCP server, generation candidate, runtime instance, monitoring profile atd.). Produkční databáze měla před kontrolními fixtures nulové počty v těchto hlavních doménách. U těchto operací je stav poctivě `NOT_DIRECTLY_EXECUTED`, nikoli PASS. Jejich konkrétní handler byl zdrojově zkontrolován po jedné položce; výsledek a důvod neprovedení je uveden u každé řádky v `operation-assessment.tsv`.

Toto je podstatná mez důkazu: požadavek „každá funkce funguje v produkci“ **nelze z aktuální produkce potvrdit**. Vytvořit stovky umělých agentů, tajemství, MCP tasků, generation aktivací a runtime side effects jen pro audit by změnilo produkční autoritu a nebylo by forenzně čisté. Audit proto žádné takové body neoznačuje za splněné.

## Produkční snapshot

| Kontrola | Pozorovaný stav |
|---|---|
| Release/source identity | shodný commit `b73df873…`; release file manifest PASS |
| `/health` | HTTP 200 |
| `/ready` | HTTP 200, `ready=true`, 22 očekávaných heartbeat služeb |
| Failed systemd units | 1: `kcml-canonical-tls-renew.service` |
| Backup timer | enabled, ale inactive/dead; trigger n/a |
| nginx | syntax OK, 4 opakované warning třídy/výskyty v testu |
| Aktivní preview secret | `KCML_PREVIEW_TICKET_KEY` chybí, použit fallback |
| Audit chain | direct operation uspěla; při snapshotu 79 events |
| Doménová data | component 1 auditní fixture; browser session 1 auditní fixture; agent/MCP/generation/monitor profile/alerts/backups 0 |
| Browser fixture | `ACTIVE`, state version 3, URL `https://example.com/`; close command `FAILED_FINAL` |
| Component fixture | `DRAFT`, state version 1; deregister `FAILED_FINAL` |

## Robustnost a nejistota

Pozitivně bylo přímo potvrzeno: shoda release s commitem, integrita release souborů, základní health/readiness odpověď, audit chain verification, skutečné vytvoření browser kontextu a DOM observation, singleton OWNER API key read a skutečný command/idempotency/queue průchod u dvou create operací.

Tyto pozitivní body nemění celkový závěr. Převaha deklarovaných funkcí nemá skutečný produkční aggregate ani end-to-end důkaz; několik klíčových domén má navíc přímo ve zdroji skeletovou nebo syntetickou implementaci. Zelený health stav tedy znamená hlavně „procesy běží a DB je dosažitelná“, nikoli „program umí deklarované činnosti“.

Audit nevytváří tvrzení o absenci chyby tam, kde nebyla dosažitelná produkční větev. `NOT_DIRECTLY_EXECUTED` není environmentální PASS ani omluva; je to explicitní chybějící produkční důkaz.

## Doporučené pořadí nápravy

1. Zastavit produkční tvrzení o úplnosti: opravit error registry/transport tak, aby žádná konkrétní chyba nemohla být maskována, a změnit UI/readiness na evidence-only zobrazení.
2. Připojit skutečné specializované runtimy k aplikačním entrypointům; odstranit generic one-line services, které jen duplikují frontu pod jiným názvem.
3. Opravit browser lifecycle jako jediný transakčně dokazatelný state machine: atomický claim, durable action checkpoint, readback/reconciliation, korektní close/cleanup a artifact preview.
4. Zakázat generation PASS/activation bez skutečného buildu, contract evaluation, security, E2E, deploy a postflight evidence.
5. Sloučit secrets/OWNER mutation na jedinou canonical command cestu; zavést účelovou secret capability a oddělené service credentials/keys.
6. Zprovoznit backup timer a zahrnout backup, TLS renewal, nginx config a aktuální service-instance filtr do readiness.
7. Opravit všech 94 nested routes a zavést explicitní response projekce místo `to_jsonb(t)`.
8. Teprve poté doplnit po jedné produkční acceptance cestě pro všech 262 operací s platným fixture lifecycle a rollback/cleanup protokolem.

## Otevřené otázky

- Jak má v kanonickém lifecycle komponenty vzniknout `RETIRED`, když katalog tuto operaci nenabízí?
- Který jediný proces má být skutečnou autoritou pro browser attach/action/cleanup a jak se má obnovit possible side effect po pádu?
- Mají být `generation.validation PASS` a `verification PASS` dvě nezávislé evidence, nebo se nyní záměrně zapisují z jedné čtyřbodové kontroly?
- Které z 262 operací mají být skutečně veřejně/OWNER volatelné a které mají zůstat pouze interní, aby operation palette nepředstírala dostupnost?
- Jak se mají auditní fixtures bezpečně odstranit, když component retire/deregister a browser close/cleanup nejsou funkční?

## Přílohy

- `artifacts/forensic-audit-2026-09-04/source-inventory.tsv` — všech 227 přečtených souborů, řádky, bajty a SHA-256.
- `artifacts/forensic-audit-2026-09-04/operation-assessment.tsv` — všech 262 operací, handler a individuální produkční stav důkazu.
- `artifacts/forensic-audit-2026-09-04/production-read-operation-sweep.tsv` — všech 42 read-only produkčních invokací.
- `artifacts/forensic-audit-2026-09-04/unregistered-domain-error-occurrences.tsv` — všech 424 zdrojových výskytů 268 neregistrovaných `DomainError` kódů.
- `artifacts/forensic-audit-2026-09-04/nested-generic-route-occurrences.tsv` — všech 94 nested collection routes postižených chybným scope algoritmem.
- `artifacts/forensic-audit-2026-09-04/operation-matrix.tsv` — čistá deklarovaná capability/queue/entity/handler matice bez hodnotící vrstvy.

