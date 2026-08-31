# Hodnoty potřebné při bootstrapu

> Informativní projekce `SSOT_CURRENT.md`; SSOT je jediná normativní autorita. Hodnoty a jejich použití musí před nasazením projít aktuálními validačními branami.

| Název | Účel | Kde získat | Kam zadat | Blokuje |
|---|---|---|---|---|
| `<GITHUB_ORG_OR_USER>` | Vlastník privátního repozitáře | GitHub účet/organizace | Git remote a server mirror | první push |
| `<GITHUB_REPOSITORY>` | Název privátního repozitáře | zvolí OWNER | Git remote a server mirror | první push |
| `<PROD_ADMIN_USER>` | Existující administrátor s `sudo` | správce serveru | SSH bootstrap | server bootstrap |
| `PASS` | Heslo singleton identity KRMAR78 | OWNER password manager | GitHub production secret | deploy/login |
| `DEPLOY_SSH_PRIVATE_KEY` | GitHub Actions → server | `generate-deployment-identities.sh` | GitHub production secret | deploy |
| `PROD_SSH_KNOWN_HOSTS` | Pin SSH host key | ověřený out-of-band fingerprint | GitHub production secret | deploy |
| `RELEASE_SIGNING_KEY` | Privátní release signing key | identity script | GitHub production secret | release |
| `PROD_HOST` | Produkční host | SSOT 28 | GitHub production variable | deploy |
| `PROD_DEPLOY_USER` | Repo-scoped SSH účet | bootstrap | GitHub production variable | deploy |
| WEDOS WAPI login/WPASS | DNS-01 a component DNS | WEDOS administrace | OWNER Secret Manager | DNS/TLS capability |
| `OPENAI_API_KEY` | Responses API a Agents SDK | OpenAI Platform | OWNER Secret Manager | AI capability |
| Alert webhooky | primární/záložní delivery | zvolený provider | OWNER Secret Manager | alert integrace |

