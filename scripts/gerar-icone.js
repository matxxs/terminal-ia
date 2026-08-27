'use strict';

/** Gera build/icon.ico (PNG embutido, 256x256) sem dependencias externas. */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const LADO = 256;
const FUNDO = [18, 20, 26];
const ACENTO = [110, 168, 254];
const BORDA = [38, 43, 56];

/* --------------------------------------------------------- rasterizacao */

function distanciaSegmento(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanciaRetanguloArredondado(px, py, x0, y0, x1, y1, raio) {
  const cx = Math.max(x0 + raio, Math.min(px, x1 - raio));
  const cy = Math.max(y0 + raio, Math.min(py, y1 - raio));
  return Math.hypot(px - cx, py - cy) - raio;
}

function misturar(alvo, indice, cor, alfa) {
  for (let canal = 0; canal < 3; canal += 1) {
    alvo[indice + canal] = Math.round(alvo[indice + canal] * (1 - alfa) + cor[canal] * alfa);
  }
  alvo[indice + 3] = Math.max(alvo[indice + 3], Math.round(255 * alfa));
}

function desenhar() {
  const pixels = Buffer.alloc(LADO * LADO * 4, 0);
  const cobertura = (distancia) => Math.max(0, Math.min(1, 0.5 - distancia));

  for (let y = 0; y < LADO; y += 1) {
    for (let x = 0; x < LADO; x += 1) {
      const indice = (y * LADO + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      const dFundo = distanciaRetanguloArredondado(px, py, 6, 6, LADO - 6, LADO - 6, 52);
      const aFundo = cobertura(dFundo);
      if (aFundo > 0) misturar(pixels, indice, FUNDO, aFundo);

      const aBorda = cobertura(Math.abs(dFundo + 2) - 2.2);
      if (aBorda > 0) misturar(pixels, indice, BORDA, aBorda * 0.9);

      const dChevron = Math.min(
        distanciaSegmento(px, py, 78, 84, 132, 128),
        distanciaSegmento(px, py, 132, 128, 78, 172),
      ) - 11;
      const aChevron = cobertura(dChevron);
      if (aChevron > 0) misturar(pixels, indice, ACENTO, aChevron);

      const dBarra = distanciaSegmento(px, py, 150, 172, 190, 172) - 11;
      const aBarra = cobertura(dBarra);
      if (aBarra > 0) misturar(pixels, indice, ACENTO, aBarra);
    }
  }
  return pixels;
}

/* ------------------------------------------------------------ PNG / ICO */

function bloco(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(calcularCrc(corpo) >>> 0);
  return Buffer.concat([tamanho, corpo, crc]);
}

let tabelaCrc = null;
function calcularCrc(buffer) {
  if (!tabelaCrc) {
    tabelaCrc = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let valor = n;
      for (let k = 0; k < 8; k += 1) valor = valor & 1 ? 0xedb88320 ^ (valor >>> 1) : valor >>> 1;
      tabelaCrc[n] = valor;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = tabelaCrc[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ -1;
}

function montarPng(pixels) {
  const bruto = Buffer.alloc((LADO * 4 + 1) * LADO);
  for (let y = 0; y < LADO; y += 1) {
    bruto[y * (LADO * 4 + 1)] = 0;
    pixels.copy(bruto, y * (LADO * 4 + 1) + 1, y * LADO * 4, (y + 1) * LADO * 4);
  }

  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(LADO, 0);
  cabecalho.writeUInt32BE(LADO, 4);
  cabecalho[8] = 8;   // bits por canal
  cabecalho[9] = 6;   // RGBA
  cabecalho[10] = 0;
  cabecalho[11] = 0;
  cabecalho[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', cabecalho),
    bloco('IDAT', zlib.deflateSync(bruto, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

function montarIco(png) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0);
  cabecalho.writeUInt16LE(1, 2);
  cabecalho.writeUInt16LE(1, 4);

  const entrada = Buffer.alloc(16);
  entrada[0] = 0;   // 0 = 256px
  entrada[1] = 0;
  entrada[2] = 0;
  entrada[3] = 0;
  entrada.writeUInt16LE(1, 4);
  entrada.writeUInt16LE(32, 6);
  entrada.writeUInt32LE(png.length, 8);
  entrada.writeUInt32LE(22, 12);

  return Buffer.concat([cabecalho, entrada, png]);
}

const destino = path.join(__dirname, '..', 'build');
fs.mkdirSync(destino, { recursive: true });

const png = montarPng(desenhar());
fs.writeFileSync(path.join(destino, 'icon.png'), png);
fs.writeFileSync(path.join(destino, 'icon.ico'), montarIco(png));

console.log(`[icone] build/icon.ico e build/icon.png gerados (${LADO}x${LADO}, ${png.length} bytes)`);
