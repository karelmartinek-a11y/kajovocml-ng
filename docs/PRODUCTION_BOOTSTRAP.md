# Produkční bootstrap

> Informativní provozní projekce; jedinou normativní autoritou je `SSOT_CURRENT.md`.

`deploy/scripts/bootstrap-production-server.sh` je určen pro čistě identifikovaný Ubuntu 24.04 cíl a smí měnit pouze zdroje KájovoCML NG. Před použitím ověřte jeho idempotenci, ownership, UDS, systemd sandbox a rollback v izolovaném prostředí. Host-local master key nesmí být v GitHubu; dočasný certifikát nenahrazuje produkční DNS-01 certifikát.

