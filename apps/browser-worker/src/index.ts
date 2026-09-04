import { startSpecializedService } from '@kcml/worker-runtime';
import { runBrowserSessionService } from '@kcml/browser-automation-runtime/session-service';

await Promise.all([startSpecializedService('kcml-browser-worker'),runBrowserSessionService()]);
