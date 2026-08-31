import { createDatabasePool } from '@kcml/database';
import { ManagedBrowserHost } from '@kcml/browser-automation-runtime';

const pool=createDatabasePool({applicationName:'kcml-browser-host'});
const host=new ManagedBrowserHost(pool,{artifactRoot:process.env.KCML_BROWSER_ARTIFACT_ROOT??'/var/lib/kajovocml-ng/browser/artifacts',runtimeBuildId:process.env.KCML_BROWSER_RUNTIME_BUILD??'playwright-1.58.2'});
await host.start();
let stopping=false;
const stop=()=>{stopping=true;};
process.once('SIGTERM',stop);process.once('SIGINT',stop);
while(!stopping){await host.tick();await new Promise(resolve=>setTimeout(resolve,250));}
await host.stop();await pool.end();
