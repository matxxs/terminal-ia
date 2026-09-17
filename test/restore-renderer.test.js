'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('falha ao restaurar preserva a aba e o vinculo para tentar novamente', async () => {
  const fechados = [];
  const mensagens = [];
  const sessao = { id: 7, title: 'Codex', agent_session_id: 'id-salvo' };
  const contexto = {
    window: { api: { app: { plataforma: 'win32' }, term: {
      listarSessoes: async () => [sessao],
      reconectar: async () => { throw new Error('Perfil indisponivel'); },
      fechar: async (id) => fechados.push(id),
    } } },
    mensagens, aviso: (texto) => mensagens.push(texto), emitir() {},
  };
  const fonte = fs.readFileSync(path.join(__dirname, '../src/renderer/js/terminais.js'), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
  vm.runInNewContext(fonte + `
    montarAba = (sessao) => abas.set(sessao.id, {
      sessao, vivo: true, aba: { classList: { add() {} } },
      term: { write: (texto) => mensagens.push(texto) },
    });
    atualizarSituacaoAba = atualizarVazio = ativar = () => {};
    globalThis.restaurar = restaurarSessoes;
    globalThis.obterAba = (id) => abas.get(id);
  `, contexto);
  await contexto.restaurar();
  assert.deepEqual(fechados, []);
  assert.equal(contexto.obterAba(7).vivo, false);
  assert.equal(contexto.obterAba(7).sessao.agent_session_id, 'id-salvo');
  assert.ok(mensagens.some((m) => m.includes('Perfil indisponivel')));
});
