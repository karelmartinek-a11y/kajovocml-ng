import { runService } from '@kcml/worker-runtime'; await runService({serviceName:'kcml-acceptance-runner',queueNames:['kcml-selftest'],intervalMs:250});
