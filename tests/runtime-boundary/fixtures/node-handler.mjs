import { fstatSync } from 'node:fs';

if (Number(process.versions.node.split('.')[0]) !== 24) process.exit(81);
if (process.argv[1] !== '/runtime/runtime-handler.mjs') process.exit(82);
if (!fstatSync(3).isSocket()) process.exit(83);
process.stdout.write('NODE_BOOTSTRAP_PASS\n');
