from pathlib import Path

index_path = Path('packages/worker-runtime/src/index.ts')
outbox_path = Path('packages/worker-runtime/src/outbox-delivery.ts')
index = index_path.read_text(encoding='utf-8')
outbox = outbox_path.read_text(encoding='utf-8')

start = outbox.index('interface OutboxRow')
body = outbox[start:]

old_import = "import { createDatabasePool, inTransaction, type DatabaseClient } from '@kcml/database';"
new_import = "import { createDatabasePool, inTransaction, inTransactionProfile, type DatabaseClient, type DatabasePool } from '@kcml/database';"
if old_import not in index:
    raise SystemExit('database import marker not found')
index = index.replace(old_import, new_import, 1)

outbox_import = "import { TransactionalOutboxDeliveryWorker } from './outbox-delivery.js';\n"
if outbox_import not in index:
    raise SystemExit('outbox import marker not found')
index = index.replace(outbox_import, '', 1)

if 'class TransactionalOutboxDeliveryWorker' in index:
    raise SystemExit('outbox worker already embedded')
index = index.rstrip() + '\n\n' + body.rstrip() + '\n'
index_path.write_text(index, encoding='utf-8')
outbox_path.unlink()
print('batch5 outbox delivery moved under WRITER-QUEUE boundary')
