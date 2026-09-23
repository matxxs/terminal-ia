'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

function iniciar({ resposta = 0, marcado = false, lembrar = false, instalando = false } = {}) {
  const configurar = require('../src/main/close-confirmation');
  const janela = new EventEmitter();
  let fechada = false;
  let dialogos = 0;
  let preferencia = lembrar;
  janela.isDestroyed = () => false;
  janela.close = () => {
    let cancelado = false;
    janela.emit('close', { preventDefault() { cancelado = true; } });
    if (!cancelado) fechada = true;
  };
  configurar(janela, {
    db: { getSetting: () => preferencia, setSetting: (_, valor) => { preferencia = valor; } },
    dialog: { async showMessageBox() { dialogos++; return { response: resposta, checkboxChecked: marcado }; } },
    estaInstalando: () => instalando,
  });
  return { janela, ler: () => ({ fechada, dialogos, preferencia }) };
}

const aguardar = () => new Promise((resolve) => setImmediate(resolve));

test('cancelar preserva a janela e nao salva o checkbox', async () => {
  const app = iniciar({ marcado: true });
  app.janela.close();
  await aguardar();
  assert.deepEqual(app.ler(), { fechada: false, dialogos: 1, preferencia: false });
});

test('confirmar fecha e salva a preferencia de nao perguntar novamente', async () => {
  const app = iniciar({ resposta: 1, marcado: true });
  app.janela.close();
  await aguardar();
  assert.deepEqual(app.ler(), { fechada: true, dialogos: 1, preferencia: true });
});

test('cliques repetidos nao abrem confirmacoes duplicadas', async () => {
  const app = iniciar();
  app.janela.close();
  app.janela.close();
  await aguardar();
  assert.equal(app.ler().dialogos, 1);
  assert.equal(app.ler().fechada, false);
});

test('preferencia salva e instalacao de atualizacao dispensam o dialogo', () => {
  for (const opcoes of [{ lembrar: true }, { instalando: true }]) {
    const app = iniciar(opcoes);
    app.janela.close();
    assert.equal(app.ler().fechada, true);
    assert.equal(app.ler().dialogos, 0);
  }
});
