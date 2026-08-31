# Deployment

> Informativní provozní projekce; jedinou normativní autoritou je `SSOT_CURRENT.md`, zejména kapitoly 28–30, 49–51 a 55.

Kanonický deployment musí fail-closed provést ověření exact SHA a podpisu, backup, forward migrace, identity/config reconciliation, immutable instalaci, atomický switch, restart, readiness/heartbeat kontrolu, self-test a production acceptance. Chybějící nebo neprovedená blocking evidence není PASS. Chybějící `OPENAI_API_KEY` je pouze `OPENAI_CONFIGURATION_REQUIRED`, pokud ostatní core gates skutečně prošly.

