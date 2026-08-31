import { runService } from '@kcml/worker-runtime'; await runService({serviceName:'kcml-monitor-worker',queueNames:['kcml-monitor'],intervalMs:1000});
