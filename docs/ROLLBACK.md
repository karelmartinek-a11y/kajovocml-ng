# Rollback

> Informativní provozní projekce; jedinou normativní autoritou je `SSOT_CURRENT.md`.

Rollback používá explicitní předchozí immutable release, zvýší deployment epoch, provede atomický reverse switch a znovu ověří readiness a closure. Databázové migrace jsou forward-only a musí zůstat kompatibilní s předchozím releasem. Nejasný side effect, pointer, release nebo epoch končí `MANUAL_REVIEW`, nikdy odhadnutým PASS.

