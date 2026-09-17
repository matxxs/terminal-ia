'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const db = require('../src/main/db');

test('IPC restaura a conversa vinculada e transmite o ID ao reabrir pelo historico', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-ia-ipc-'));
  db.init(dir);
  const handlers = new Map();
  const eventosApp = new Map();
  const inicios = [];
  let falharSpawn = false;
  const localRequire = createRequire(require.resolve('../src/main/ipc'));
  const contexto = {
    module: { exports: {} }, process,
    require: (nome) => {
      if (nome === 'electron') return {
        app: { getPath: () => dir, on: (nome, cb) => eventosApp.set(nome, cb) },
        ipcMain: { handle: (nome, cb) => handlers.set(nome, cb) },
      };
      if (nome === './updater') return {};
      if (nome === './pty-manager') return {
        definirObservadorAtividade() {},
        criar: (id, opcoes) => {
          if (falharSpawn) throw new Error('Shell nao encontrado');
          inicios.push(opcoes); return { shell: opcoes.shell };
        },
        encerrar() {}, obterResumoTela: () => '',
      };
      return localRequire(nome);
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/main/ipc'), 'utf8'), contexto);
  contexto.module.exports.registrar(() => null);
  const chamar = async (canal, dados) => {
    const res = await handlers.get(canal)(null, dados);
    assert.equal(res.ok, true, res.error);
    return res.data;
  };
  const profileId = db.listProfiles().find((p) => p.name === 'Codex').id;
  const sessao = await chamar('term:abrir', { profileId, cwd: dir });
  const conversa = '33333333-3333-4333-8333-333333333333';
  await chamar('sessoes:vincularConversa', { id: sessao.id, agente: 'codex', conversa });
  await chamar('term:reconectar', { sessionId: sessao.id });
  assert.ok(inicios.at(-1).initialCommand.startsWith(`codex resume ${conversa} `));
  await chamar('term:fechar', { id: sessao.id });
  const reaberta = await chamar('term:abrir', { resumeSessionId: sessao.id });
  assert.notEqual(reaberta.id, sessao.id);
  assert.equal(reaberta.agent_session_id, conversa);
  assert.equal(reaberta.cwd, dir);
  assert.ok(inicios.at(-1).initialCommand.startsWith(`codex resume ${conversa} `));
  assert.equal(db.getSession(sessao.id).open, 0);
  const totalAntes = db.listOpenSessions().length;
  falharSpawn = true;
  const falha = await handlers.get('term:abrir')(null, { profileId, cwd: dir });
  assert.equal(falha.ok, false);
  assert.equal(db.listOpenSessions().length, totalAntes);
  eventosApp.get('before-quit')();
});
