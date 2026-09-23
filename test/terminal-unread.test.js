'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function iniciar() {
  const callbacks = {};
  const elemento = () => ({
    dataset: {}, classList: { toggle() {}, add() {} },
    querySelector: () => ({}), scrollIntoView() {}, addEventListener() {},
  });
  const contexto = {
    Blob, setTimeout() {}, clearTimeout() {},
    ResizeObserver: class { observe() {} },
    $: elemento, ao() {}, emitir() {},
    estado: { grupoAvulsoSelecionado: true, anotacoesPorSessao: new Map(), perfis: [] },
    window: { addEventListener() {}, api: { app: { plataforma: 'win32' }, term: {
      aoReceberDados: (cb) => { callbacks.dados = cb; },
      aoEncerrar: (cb) => { callbacks.fim = cb; },
      aoMudarAtividade: (cb) => { callbacks.atividade = cb; },
      dadosRecebidos() {},
    } } },
  };
  const fonte = fs.readFileSync(require.resolve('../src/renderer/js/terminais.js'), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
  vm.runInNewContext(fonte + `
    atualizarInfo = atualizarVazio = () => {};
    globalThis.inserir = (item) => abas.set(item.sessao.id, item);
  `, contexto);
  for (const id of [1, 2]) contexto.inserir({
    sessao: { id }, vivo: true, ocupado: false, conclusaoPendente: false,
    aba: elemento(), host: elemento(), term: { write(data, cb) { cb?.(); } },
  });
  contexto.iniciar();
  contexto.ativar(2);
  return {
    ativar: contexto.ativar,
    dados: () => callbacks.dados({ id: 1, data: 'Resposta final\r\n' }),
    atividade: (ocupado) => callbacks.atividade({ id: 1, ocupado }),
    pendente: () => contexto.listarAbas().find((aba) => aba.id === 1).conclusaoPendente,
  };
}

test('visualizar a saida antes do aviso de ociosidade impede novo alerta ao sair', () => {
  const app = iniciar();
  app.atividade(true);
  app.dados();
  app.ativar(1);
  app.ativar(2);
  app.atividade(false);
  assert.equal(app.pendente(), false);
});

test('atividade sem nova saida nao reativa uma conclusao ja visualizada', () => {
  const app = iniciar();
  app.atividade(true);
  app.dados();
  app.atividade(false);
  assert.equal(app.pendente(), true);
  app.ativar(1);
  app.ativar(2);
  app.atividade(true);
  app.atividade(false);
  assert.equal(app.pendente(), false);
});

test('nova resposta em segundo plano volta a sinalizar conclusao nao vista', () => {
  const app = iniciar();
  app.ativar(1);
  app.ativar(2);
  app.atividade(true);
  app.dados();
  app.atividade(false);
  assert.equal(app.pendente(), true);
  app.ativar(1);
  assert.equal(app.pendente(), false);
});
