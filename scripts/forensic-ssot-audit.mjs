#!/usr/bin/env node
import { runForensicAudit } from './lib/forensic-audit.mjs';
const root=process.cwd(); const report=await runForensicAudit(root);
process.stdout.write(`${JSON.stringify(report,null,2)}\n`); if(report.findings.length)process.exitCode=1;
