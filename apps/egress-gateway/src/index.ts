import { runService } from '@kcml/worker-runtime'; await runService({serviceName:'kcml-egress-gateway',broker:'egress',socketPath:'/run/kajovocml-ng/brokers/egress-gateway.sock'});
