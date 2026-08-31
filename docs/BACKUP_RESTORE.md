# Backup a restore

> Informativní provozní projekce; jedinou normativní autoritou je `SSOT_CURRENT.md`, zejména kapitoly 28, 29, 49 a 51.

Před migrací musí existovat ověřený PostgreSQL custom dump, konfigurace a checksum evidence. Restore se nejprve provádí do izolované databáze a ověřuje migrace, DB kontrakt, auditní integritu, novou platform incarnation a recovery barrier. Produkční restore bez ověřené identity zálohy, maintenance režimu a closure evidence je zakázaný.

