import { BrowserHostProtocolServer } from '@kcml/browser-automation-runtime/host';

const slot=process.env.KCML_BROWSER_HOST_SLOT??'primary';
if(!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(slot))throw new Error('BROWSER_HOST_SLOT_INVALID');
const host=new BrowserHostProtocolServer({socketPath:process.env.KCML_BROWSER_HOST_SOCKET??`/run/kajovocml-ng/browser-hosts/${slot}/control.sock`,artifactOwnerSocketPath:process.env.KCML_BROWSER_ARTIFACT_SOCKET??'/run/kajovocml-ng/browser-artifacts/control.sock',runtimeBuildId:process.env.KCML_BROWSER_RUNTIME_BUILD??'playwright-1.58.2'});
await host.start();
let stopping=false;
const stop=()=>{stopping=true;};
process.once('SIGTERM',stop);process.once('SIGINT',stop);
while(!stopping)await new Promise(resolve=>setTimeout(resolve,250));
await host.stop();
