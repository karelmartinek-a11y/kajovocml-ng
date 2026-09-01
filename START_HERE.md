# START HERE — ZIP → GitHub → produkce

> **Informativní provozní postup:** jedinou normativní autoritou je `SSOT_CURRENT.md`. Deployment je přípustný pouze po skutečném PASS všech blocking gates požadovaných SSOT; samotný build, počet katalogových záznamů ani statická kontrola PASS nedokazují.

> **Aktuální blokace:** tato revize nemá nulový výsledek `pnpm audit:deep`. Níže uvedený postup je referenční runbook a nesmí být použit k produkčnímu nasazení, dokud hluboký audit nevrátí PASS.

## FÁZE 1 — Developerský počítač

Předpoklad: právě jste stáhl ZIP. `<CESTA_K_ZIPU>` je cesta ke staženému souboru.

### Bash / Linux / macOS

```bash
mkdir KajovoCML-NG && cd KajovoCML-NG
unzip <CESTA_K_ZIPU>
test -f SSOT_CURRENT.md && test -f pnpm-lock.yaml
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm audit:final
git init -b main
git add .
git commit -m "Initial production implementation"
```

### PowerShell / Windows

```powershell
New-Item -ItemType Directory KajovoCML-NG | Out-Null
Expand-Archive -Path <CESTA_K_ZIPU> -DestinationPath KajovoCML-NG
Set-Location KajovoCML-NG
if (!(Test-Path SSOT_CURRENT.md)) { throw "SSOT chybí" }
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm audit:final
git init -b main
git add .
git commit -m "Initial production implementation"
```

## FÁZE 2 — Nový GitHub repozitář

1. GitHub → **New repository** → owner `<GITHUB_ORG_OR_USER>`, název `<GITHUB_REPOSITORY>`, viditelnost **Private**, bez README/.gitignore/licence.
2. Připojte a pushněte:

```bash
git remote add origin git@github.com:<GITHUB_ORG_OR_USER>/<GITHUB_REPOSITORY>.git
git push -u origin main
```

3. Settings → Branches → Add branch protection rule pro `main`: require pull request, require approvals, dismiss stale approvals, require status checks `CI / verify`, `CodeQL / codeql`, `CodeQL / audit`, require branch up to date, block force pushes/deletions, include administrators.
4. Settings → Environments → New environment `production`: required reviewer = vlastník, deployment branches = protected branches only, prevent self-review pokud GitHub plán podporuje.
5. Do **production environment**, ne do plaintext souboru, vložte:

| Přesný název | Druh | Zdroj hodnoty |
|---|---|---|
| `PASS` | Secret | vlastní silné heslo pro KRMAR78; při každém deployi se povinně synchronizuje |
| `DEPLOY_SSH_PRIVATE_KEY` | Secret | `github-actions-deploy.key` z FÁZE 4 |
| `PROD_SSH_KNOWN_HOSTS` | Secret | ověřený výstup `ssh-keyscan -H 89.221.222.92` |
| `RELEASE_SIGNING_KEY` | Secret | celý obsah `release-signing.key` z FÁZE 4 |
| `KCML_OWNER_API_KEY` | Secret | až po prvním loginu: UI → API klíč → Reveal; pro acceptance |
| `PROD_HOST` | Variable | `89.221.222.92` |
| `PROD_DEPLOY_USER` | Variable | `kcml-deploy` |

## FÁZE 3 — První příprava produkčního serveru

`<PROD_ADMIN_USER>` je existující SSH účet s právem `sudo`; hodnotu sdělí správce serveru. Bootstrap zachová cizí Nginx sites, databáze i systemd unity.

```bash
ssh <PROD_ADMIN_USER>@89.221.222.92
sudo install -d -o "$USER" -g "$USER" -m 0750 /srv/kajovocml-ng/bootstrap-source
exit
rsync -a --delete --exclude node_modules --exclude .git ./ <PROD_ADMIN_USER>@89.221.222.92:/srv/kajovocml-ng/bootstrap-source/
ssh <PROD_ADMIN_USER>@89.221.222.92 'sudo /srv/kajovocml-ng/bootstrap-source/deploy/scripts/bootstrap-production-server.sh'
```

Bootstrap ověří Ubuntu 24.04, připraví Node 24/pnpm 11/PostgreSQL 16/Nginx/Playwright, dedikované účty, UDS, filesystem, UFW 80/443+existující SSH, dočasný TLS certifikát a idempotentní konfiguraci. Před změnou vlastního configu vytvoří backup.

## FÁZE 4 — GitHub ↔ server propojení

Na developerském počítači:

```bash
deploy/scripts/generate-deployment-identities.sh ./deployment-identities
ssh-keyscan -H 89.221.222.92 > deployment-identities/prod-known-hosts
# Fingerprint ověřte jiným důvěryhodným kanálem se správcem serveru.
```

Na serveru nainstalujte veřejný deploy klíč a veřejný signing key:

```bash
scp deployment-identities/github-actions-deploy.key.pub deployment-identities/release-signing.pub <PROD_ADMIN_USER>@89.221.222.92:/tmp/
ssh <PROD_ADMIN_USER>@89.221.222.92
sudo install -d -o kcml-deploy -g kcml-platform -m 0700 /var/lib/kajovocml-ng/deploy-home/.ssh
sudo install -o kcml-deploy -g kcml-platform -m 0600 /tmp/github-actions-deploy.key.pub /var/lib/kajovocml-ng/deploy-home/.ssh/authorized_keys
sudo install -o root -g root -m 0644 /tmp/release-signing.pub /etc/kajovocml-ng/release-signing.pub
sudo install -d -o kcml-deploy -g kcml-platform -m 0750 /var/lib/kajovocml-ng/deployments
sudo git clone --mirror git@github.com:<GITHUB_ORG_OR_USER>/<GITHUB_REPOSITORY>.git /srv/kajovocml-ng/repository/repository.git
```

Pro mirror vytvořte zvláštní read-only GitHub deploy key: `ssh-keygen -t ed25519 -f repository-read.key -C kcml-production-repository`; veřejnou část vložte do Repository → Settings → Deploy keys bez write access, privátní část jako `/srv/kajovocml-ng/repository/.ssh/id_ed25519` vlastněnou `kcml-deploy:kcml-platform` s módem `0600`. Do `/srv/kajovocml-ng/repository/.ssh/known_hosts` vložte ověřené GitHub SSH host keys.

Do GitHub production secrets zkopírujte pouze privátní `github-actions-deploy.key`, privátní `release-signing.key` a ověřený `prod-known-hosts`. Privátní signing key nikdy nekopírujte na server; server má jen veřejný klíč.

Účet `kcml-deploy` musí mít v `/etc/sudoers.d/kajovocml-ng-deploy` pouze:

```text
kcml-deploy ALL=(root) NOPASSWD: /usr/local/sbin/kcml-deploy-production *
```

## FÁZE 5 — První deployment

GitHub → Actions → **Deploy production** → Run workflow nad `main`; `source_sha` ponechte prázdné pro exact HEAD. Environment reviewer deployment schválí.

Workflow vyžaduje úspěšné CI stejného SHA, sestaví a Minisign podepíše release, přenese bundle, checksum a signature, vytvoří backup, provede forward migration, synchronizuje `PASS`, ověří capability inventory, atomicky přepne `current`, spustí systemd, health/version/readiness, heartbeats, singleton API key, self-test, operation catalog a pět healthy samples. Úspěch končí `DEPLOYMENT STATUS: PASS`; jinak workflow zčervená a server spustí rollback.

## FÁZE 6 — První login

Otevřete `https://kaja.hcasc.cz`, username je vždy `KRMAR78`, heslo je přesně hodnota GitHub production secretu `PASS`. Dokončete povinné MFA a bezpečně uložte jednorázové recovery kódy.

Bez `OPENAI_API_KEY` fungují login, dashboard, konfigurace, secrets, monitoring, audit, API key a self-test; AI workery ukazují `OPENAI_CONFIGURATION_REQUIRED`. V UI otevřete **Secrets a hesla** → **Přidat secret** → stable name `OPENAI_API_KEY`, typ `API_KEY`, vložte hodnotu a uložte. Není třeba nový build.

## FÁZE 7 — Produkční verification

```bash
dig +short kaja.hcasc.cz A
dig +short kcml0001.kaja.hcasc.cz A
openssl s_client -connect kaja.hcasc.cz:443 -servername kaja.hcasc.cz </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
curl -I http://kaja.hcasc.cz
curl --fail https://kaja.hcasc.cz/health | jq
curl --fail https://kaja.hcasc.cz/ready | jq
curl --fail -H "Authorization: Bearer <KCML_OWNER_API_KEY>" https://kaja.hcasc.cz/api/v1/system/version | jq
ssh <PROD_ADMIN_USER>@89.221.222.92 'sudo systemctl --failed; sudo systemctl status kcml.target nginx postgresql --no-pager'
ssh <PROD_ADMIN_USER>@89.221.222.92 'sudo -u postgres psql -d kajovocml_ng -c "SELECT current_epoch,current_release_id,source_sha FROM kcml.application_deployment_head"'
ssh <PROD_ADMIN_USER>@89.221.222.92 'sudo nginx -t; sudo journalctl -u "kcml-*" --since "30 minutes ago" --no-pager'
ssh <PROD_ADMIN_USER>@89.221.222.92 'sudo /opt/kajovocml-ng/current/apps/server/node_modules/.bin/kcml-admin self-test'
```

Pro celý acceptance běh: GitHub → Actions → **Production acceptance**. Po prvním Reveal singleton API klíče vložte jeho hodnotu jako production secret `KCML_OWNER_API_KEY`.

## FÁZE 8 — Rollback

Automatický rollback proběhne při selhání deploye. Ručně nejprve určete poslední zdravý immutable release, nic nemažte:

```bash
ssh <PROD_ADMIN_USER>@89.221.222.92
readlink -f /opt/kajovocml-ng/current
sudo ls -la /opt/kajovocml-ng/releases
sudo /opt/kajovocml-ng/current/deploy/scripts/rollback-production.sh --release-path /opt/kajovocml-ng/releases/<POSLEDNI_ZDRAVY_RELEASE> --failed-release <SELHANY_RELEASE>
curl --fail --unix-socket /run/kajovocml-ng/web-api.sock http://localhost/ready | jq
sudo journalctl -u 'kcml-*' --since '15 minutes ago' --no-pager
```

`<POSLEDNI_ZDRAVY_RELEASE>` je přesný adresář posledního release s PASS evidence; `<SELHANY_RELEASE>` je release ID chybného běhu. Rollback nemění schema zpět: forward schema musí zůstat kompatibilní. Stav `MANUAL_REVIEW` se nesmí potvrdit jako úspěch.
