#!/usr/bin/env node
// Copies the terminal library Cloud Shell uses into the workspace (prototypes/xeno-workspace/vendor/xterm/): the
// workspace is plain scripts, so it carries the published UMD builds and their licence, not a bundle. Run after a
// version bump of @xterm/xterm or @xterm/addon-fit; the copies are committed like docs-editor.js.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'prototypes', 'xeno-workspace', 'vendor', 'xterm');
mkdirSync(out, { recursive: true });
const nm = (p) => join(root, 'node_modules', p);
copyFileSync(nm('@xterm/xterm/lib/xterm.js'), join(out, 'xterm.js'));
copyFileSync(nm('@xterm/xterm/css/xterm.css'), join(out, 'xterm.css'));
copyFileSync(nm('@xterm/addon-fit/lib/addon-fit.js'), join(out, 'addon-fit.js'));
const v = (p) => JSON.parse(readFileSync(nm(`${p}/package.json`), 'utf8')).version;
writeFileSync(join(out, 'LICENSE.md'), `@xterm/xterm ${v('@xterm/xterm')} and @xterm/addon-fit ${v('@xterm/addon-fit')} — MIT\n\n${readFileSync(nm('@xterm/xterm/LICENSE'), 'utf8')}`);
console.log(`vendor/xterm: @xterm/xterm ${v('@xterm/xterm')}, @xterm/addon-fit ${v('@xterm/addon-fit')}`);
