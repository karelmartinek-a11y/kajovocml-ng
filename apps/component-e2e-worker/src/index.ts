import { runService } from '@kcml/worker-runtime'; await runService({serviceName:'kcml-component-e2e-worker',queueNames:['kcml-component','kcml-mcp','kcml-selftest']});
