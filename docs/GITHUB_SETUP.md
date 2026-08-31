# GitHub setup

> Informativní provozní projekce; jedinou normativní autoritou je `SSOT_CURRENT.md`.

Privátní repozitář používá chráněnou větev `main`, required CI stejného SHA a production environment s reviewer gate. Secrets nejsou repository variables. Produkce přijímá pouze podepsaný immutable release exact accepted SHA; server ověřuje podpis i vnitřní file manifest.

