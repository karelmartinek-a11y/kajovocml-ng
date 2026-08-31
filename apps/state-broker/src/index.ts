import { runService } from '@kcml/worker-runtime'; await runService({serviceName:'kcml-state-broker',broker:'state',socketPath:'/run/kajovocml-ng/brokers/state-broker.sock'});
