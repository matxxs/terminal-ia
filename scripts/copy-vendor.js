'use strict';

/** Copia os assets do xterm para src/renderer/vendor, evitando bundler. */

const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const destino = path.join(raiz, 'src', 'renderer', 'vendor');

const ARQUIVOS = [
  ['node_modules/@xterm/xterm/lib/xterm.mjs', 'xterm.mjs'],
  ['node_modules/@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['node_modules/@xterm/addon-fit/lib/addon-fit.mjs', 'addon-fit.mjs'],
  ['node_modules/@xterm/addon-web-links/lib/addon-web-links.mjs', 'addon-web-links.mjs'],
  ['node_modules/@xterm/addon-search/lib/addon-search.mjs', 'addon-search.mjs'],
];

fs.mkdirSync(destino, { recursive: true });

let copiados = 0;
for (const [origem, nome] of ARQUIVOS) {
  const caminho = path.join(raiz, origem);
  if (!fs.existsSync(caminho)) {
    console.warn(`[vendor] ausente: ${origem}`);
    continue;
  }
  fs.copyFileSync(caminho, path.join(destino, nome));
  copiados += 1;
}

console.log(`[vendor] ${copiados}/${ARQUIVOS.length} arquivos copiados para src/renderer/vendor`);
