import { startSpecializedService } from '@kcml/worker-runtime';

await startSpecializedService(process.env.KCML_ALERT_ASSIGNMENT === 'backup' ? 'kcml-alert-backup-worker' : 'kcml-alert-primary-worker');
