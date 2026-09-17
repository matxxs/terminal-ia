'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Simula apenas o processo externo e o relogio; executa o gerenciador real.
function iniciar() {
  let agora = 100000;
  let varrer;
  let receber;
  let sair;
  const timers = new Map();
  const eventos = [];
  const processos = [];
  const localRequire = createRequire(require.resolve('../src/main/pty-manager'));
  const contexto = {
    module: { exports: {} }, process, Buffer,
    Date: { now: () => agora },
    require: (nome) => nome === '@lydell/node-pty' ? {
      spawn: () => {
        const callbacks = {};
        processos.push(callbacks);
        return {
        pid: 123, onData: (cb) => { receber = cb; callbacks.dados = cb; }, onExit: (cb) => { sair = cb; callbacks.sair = cb; },
        write() {}, resize() {}, pause() {}, resume() {}, kill() {},
        };
      },
    } : localRequire(nome),
    setInterval: (cb) => { varrer = cb; return { unref() {} }; },
    setTimeout: (cb, ms) => {
      const timer = { unref() {} };
      timers.set(timer, { cb, em: agora + ms });
      return timer;
    },
    clearTimeout: (timer) => timers.delete(timer),
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/main/pty-manager'), 'utf8'), contexto);
  const manager = contexto.module.exports;
  manager.definirObservadorAtividade((id, ocupado) => eventos.push({
    tipo: 'atividade', ocupado, resumo: manager.obterResumoTela(id),
  }));
  manager.criar(1, {}, (data) => eventos.push({ tipo: 'dados', data }),
    () => eventos.push({ tipo: 'fim' }));
  return {
    manager, eventos, processos,
    dados: (data) => receber(data),
    sair: () => sair({ exitCode: 0 }),
    avancar(ms) {
      agora += ms;
      for (const [timer, tarefa] of timers) {
        if (tarefa.em <= agora) { timers.delete(timer); tarefa.cb(); }
      }
      varrer();
    },
  };
}

test('volta a ocioso apos concluir ou interromper, mesmo com marcador antigo no historico', () => {
  for (const final of ['Resposta final completa.', 'Interrupted.']) {
    const app = iniciar();
    app.avancar(3000);
    app.dados('Working (esc to interrupt)');
    app.avancar(600);
    assert.equal(app.manager.obterEstado(1).ocupado, true);
    app.dados('\r\x1b[2K' + final);
    app.avancar(3000);
    assert.equal(app.manager.obterEstado(1).ocupado, false);
    assert.equal(app.eventos.at(-1).ocupado, false);
    assert.ok(app.eventos.at(-1).resumo.includes(final));
  }
});

test('saida tardia do processo anterior nao encerra a aba reiniciada', () => {
  const app = iniciar();
  app.manager.criar(1, {}, () => {}, () => {});
  app.processos[0].sair({ exitCode: 0 });
  assert.equal(app.manager.estaVivo(1), true);
  assert.equal(app.eventos.some((e) => e.tipo === 'fim'), false);
});

test('captura a ultima saida ao encerrar mesmo durante o aquecimento', () => {
  const app = iniciar();
  app.dados('Erro final antes de sair.');
  app.sair();
  assert.deepEqual(app.eventos.map((e) => e.tipo), ['dados', 'atividade', 'fim']);
  assert.equal(app.eventos[1].resumo, 'Erro final antes de sair.');
});

test('silencio causado por contrapressao nao significa que o agente terminou', () => {
  const app = iniciar();
  app.avancar(3000);
  app.dados('x'.repeat(210000));
  app.avancar(600);
  app.avancar(3000);
  assert.equal(app.manager.obterEstado(1).ocupado, true);
  app.manager.confirmarRecebimento(1, 210000);
  app.avancar(3000);
  assert.equal(app.manager.obterEstado(1).ocupado, false);
});

test('redesenho apos resize nao transforma terminal ocioso em ocupado', () => {
  const app = iniciar();
  app.avancar(3000);
  app.manager.redimensionar(1, 120, 40);
  app.dados('Historico: esc to interrupt');
  app.avancar(600);
  assert.equal(app.manager.obterEstado(1).ocupado, false);
});
