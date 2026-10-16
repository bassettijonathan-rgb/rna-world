// Builds the single-file page with no bundler: every ES module becomes a
// function in a small registry, and the worker's own bundle rides along as
// a string so the page can start it from a Blob URL.
//
//   dist/index.html      a complete page, open it straight from disk
//   dist/rna-world.html  the same page without <html>/<head>/<body>, the
//                        form a claude.ai Artifact is published in

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function transform(file, deps) {
  let src = readFileSync(file, 'utf8');
  const exportsList = [];
  src = src.replace(/^import\s+\{([^}]*)\}\s+from\s+'([^']+)';?\s*$/gm, (_, names, spec) => {
    const dep = resolve(dirname(file), spec);
    deps.push(dep);
    const binds = names
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/\s+as\s+/, ': '));
    return `const { ${binds.join(', ')} } = __req(${JSON.stringify(relative(root, dep))});`;
  });
  src = src.replace(/^import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)';?\s*$/gm, (_, name, spec) => {
    const dep = resolve(dirname(file), spec);
    deps.push(dep);
    return `const ${name} = __req(${JSON.stringify(relative(root, dep))});`;
  });
  if (/^import\s/m.test(src)) throw new Error(`${file}: unsupported import form`);
  src = src.replace(/^export\s+(async\s+function|function|class|const|let)\s+(\w+)/gm, (_, kind, name) => {
    exportsList.push(name);
    return `${kind} ${name}`;
  });
  if (/^export\s/m.test(src)) throw new Error(`${file}: unsupported export form`);
  // The dev-only module worker path is never taken in a bundle.
  src = src.replace(/import\.meta\.url/g, 'location.href');
  return `${src}\nreturn { ${exportsList.join(', ')} };`;
}

function bundle(entry) {
  const mods = new Map();
  const queue = [resolve(root, entry)];
  while (queue.length) {
    const f = queue.shift();
    if (mods.has(f)) continue;
    const deps = [];
    mods.set(f, transform(f, deps));
    queue.push(...deps);
  }
  let out = '(function () {\n"use strict";\nconst __defs = {};\nconst __cache = {};\n';
  out += 'function __req(id) { if (!(id in __cache)) { __cache[id] = null; __cache[id] = __defs[id](); } return __cache[id]; }\n';
  for (const [f, body] of mods) out += `__defs[${JSON.stringify(relative(root, f))}] = function () {\n${body}\n};\n`;
  out += `__req(${JSON.stringify(entry)});\n})();\n`;
  return out;
}

export function build() {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const head = html.split('<!-- head:start -->')[1].split('<!-- head:end -->')[0].trim();
  const body = html.split('<!-- body:start -->')[1].split('<!-- body:end -->')[0].trim();
  const css = readFileSync(join(root, 'src/app/style.css'), 'utf8');
  const workerSrc = bundle('src/sim/worker.js');
  const pageSrc = bundle('src/app/main.js');
  const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');
  const scripts = `<script>window.__RNA_WORKER_SRC = ${safe(JSON.stringify(workerSrc))};</script>\n<script>\n${safe(pageSrc)}</script>`;
  const fragment = `${head}\n<style>\n${css}</style>\n${body}\n${scripts}\n`;
  const full = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n<style>\n${css}</style>\n</head>\n<body>\n${body}\n${scripts}\n</body>\n</html>\n`;
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist/index.html'), full);
  writeFileSync(join(root, 'dist/rna-world.html'), fragment);
  return { bytes: full.length, worker: workerSrc.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = build();
  console.log(`dist/index.html ${(r.bytes / 1024).toFixed(0)} KB (worker ${(r.worker / 1024).toFixed(0)} KB)`);
}
