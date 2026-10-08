// The XENO workspace (prototypes/xeno-workspace) on the platform, at /workspace/.
// Dev: served straight from its source folder. Build: copied into dist/workspace.
// It is plain scripts with no build step, so nothing here transforms it. Tests and notes are never served or shipped.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2' };
export const shipped = (rel) => { const r = rel.split(path.sep).join('/'); return !r.startsWith('tests/') && !r.startsWith('node_modules/') && !/(^|\/)\./.test(r) && Object.hasOwn(TYPES, path.extname(r)) && !/(^|\/)package(-lock)?\.json$/.test(r); };

// Every local script and stylesheet address in the page gets ?v=<hash of that file's bytes>.
// The file names carry no content hash, and a CDN or browser may keep a .js for hours whatever the
// origin says. A changed file gets a new address, so it is fetched; an unchanged one keeps its address.
// hashOf(name) returns the hash, or null when the file is not shipped. A reference to a missing file fails the build.
export function stampAssets(html, hashOf) {
  let count = 0;
  const out = html.replace(/\b(src|href)="([^"#?:]+\.(?:js|css))"/g, (whole, attr, name) => {
    const h = hashOf(name);
    if (!h) throw new Error('xeno-workspace: index.html refers to ' + name + ', which is not shipped');
    count++; return attr + '="' + name + '?v=' + h + '"';
  });
  return { html: out, count };
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(abs, base, out); else if (e.isFile()) out.push(path.relative(base, abs));
  }
  return out;
}

export function xenoWorkspace(rootDir) {
  const src = path.join(rootDir, 'prototypes', 'xeno-workspace');
  let outDir = path.join(rootDir, 'dist'), building = false;
  return {
    name: 'xeno-workspace',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); building = config.command === 'build'; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const u = new URL(req.url || '/', 'http://local');
        if (u.pathname === '/workspace') { res.statusCode = 301; res.setHeader('Location', '/workspace/' + u.search); return res.end(); }
        if (!u.pathname.startsWith('/workspace/')) return next();
        let rel; try { rel = decodeURIComponent(u.pathname.slice('/workspace/'.length)) || 'index.html'; } catch { rel = ''; }
        const abs = path.resolve(src, rel);
        if (!rel || !abs.startsWith(src + path.sep) || !shipped(path.relative(src, abs)) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.statusCode = 404; return res.end('Not found'); }
        res.setHeader('Content-Type', TYPES[path.extname(abs)]); res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(abs).pipe(res);
      });
    },
    closeBundle() {
      if (!building) return; // the dev server also closes a bundle when it stops; only a build ships files
      if (!fs.existsSync(path.join(src, 'index.html'))) throw new Error('xeno-workspace: ' + src + ' has no index.html, so /workspace would ship empty');
      const files = walk(src).filter(shipped);
      const dest = path.join(outDir, 'workspace');
      for (const rel of files) { const to = path.join(dest, rel); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(src, rel), to); }
      const page = path.join(dest, 'index.html');
      const stamped = stampAssets(fs.readFileSync(page, 'utf8'), (name) => { const p = path.join(dest, name); return files.includes(name.split('/').join(path.sep)) && fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12) : null; });
      if (stamped.count === 0) throw new Error('xeno-workspace: no script or stylesheet address was stamped, so index.html was not recognised');
      fs.writeFileSync(page + '.tmp', stamped.html, 'utf8'); fs.renameSync(page + '.tmp', page);
      if (!fs.existsSync(path.join(dest, 'index.html')) || !fs.existsSync(path.join(dest, 'platform.js'))) throw new Error('xeno-workspace: the copy is missing index.html or platform.js');
      console.log(`xeno-workspace: ${files.length} files -> ${path.relative(rootDir, dest)}, ${stamped.count} addresses stamped`);
    },
  };
}
