# Testování

> Informativní testovací projekce; jedinou normativní autoritou je `SSOT_CURRENT.md`, zejména kapitoly 33–37, 49–55.

`pnpm audit:final` je lokální agregátor kontrol, nikoli náhrada všech blocking profilů. Unit/model testy nesmějí být vydány za PostgreSQL, systemd/runtime, browser, provider, cross-subsystem ani production-shaped důkaz. Neprovedená environmentální kontrola používá přesně `NOT_EXECUTED_ENVIRONMENTAL`; uncovered blocking obligation musí zůstat FAIL/BLOCKED podle SSOT.

