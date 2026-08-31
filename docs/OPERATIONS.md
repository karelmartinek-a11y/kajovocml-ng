# Operations

> Informativní provozní projekce; jedinou normativní autoritou je `SSOT_CURRENT.md`.

Základní diagnostika používá `systemctl status kcml.target`, `systemctl --failed`, `journalctl -u 'kcml-*'`, `/health` a `/ready`. Chráněné `/api/v1/*` endpointy vyžadují OWNER autentizaci. Readiness musí fail-closed při neúplném heartbeat inventory, stale heartbeat, mixed release/source SHA/deployment epoch nebo nehotové recovery barrier. Immutable release se ručně neupravuje.

