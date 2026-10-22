// Regenerate the first-party redactor distribution from its owning repository.
// Normal builds consume this generated module and never need a sibling checkout.
import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = new URL('../../xeno-agent-interface/packages/host/src/acp/acpTextRedaction.ts', import.meta.url);
const destination = new URL('../packages/report-client/vendor/', import.meta.url);
mkdirSync(destination, { recursive: true });
await build({ entryPoints: [source.pathname.replace(/^\/([A-Z]:)/, '$1')], outfile: new URL('acp-text-redaction.js', destination).pathname.replace(/^\/([A-Z]:)/, '$1'), bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', banner: {js:'// GENERATED from xeno-agent-interface/acpTextRedaction.ts; regenerate with scripts/sync-report-redaction.mjs.'} });
writeFileSync(new URL('acp-text-redaction.d.ts', destination), 'export declare function redactAcpText(value:string,maxLength?:number):string;\n');
writeFileSync(new URL('redaction-source.sha256', destination), createHash('sha256').update(readFileSync(source)).digest('hex') + '\n');
