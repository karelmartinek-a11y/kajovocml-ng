# Forward migrations

> Informativní projekce `SSOT_CURRENT.md`; SSOT je jediná normativní autorita.

Greenfield baseline tvoří soubory v `../baseline`. Následující migrace musí být append-only, checksumované, forward-only a kompatibilní s posledním rollback releasem; každá musí mít skutečný DB test a nesmí nahrazovat chybějící baseline kontrakt generickým JSON úložištěm.

