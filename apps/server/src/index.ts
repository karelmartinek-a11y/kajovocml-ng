#!/usr/bin/env node
import { buildServer } from './server.js';

const app=await buildServer();const inherited=Number(process.env.LISTEN_FDS??0)>0&&Number(process.env.LISTEN_PID??0)===process.pid;
if(inherited){await app.ready();await new Promise<void>((resolve,reject)=>{app.server.once('error',reject);app.server.listen({fd:3},()=>{app.server.off('error',reject);resolve();});});}else await app.listen({path:process.env.KCML_WEB_SOCKET??'/run/kajovocml-ng/web-api.sock'});
process.on('SIGTERM',()=>void app.close());process.on('SIGINT',()=>void app.close());
