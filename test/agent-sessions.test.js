'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const db = require('../src/main/db');
const agentes = require('../src/main/agent-sessions');

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-ia-sessions-'));
db.init(dir);
const perfil = (initial_command) => ({ initial_command, shell: 'powershell.exe', env: {} });
const nova = () => db.createSession({ title: 'Teste', cwd: dir });

test('retoma por ID preservando argumentos e substituindo seletores de ultima conversa', () => {
  assert.equal(agentes.comandoRetomada('codex --model gpt-test', 'codex', ID_A),
    `codex resume ${ID_A} --model gpt-test`);
  assert.equal(agentes.comandoRetomada('codex resume --last --all', 'codex', ID_A), `codex resume ${ID_A}`);
  assert.equal(agentes.comandoRetomada('claude --continue --model sonnet', 'claude', ID_B),
    `claude --resume ${ID_B} --model sonnet`);
  assert.equal(agentes.comandoRetomada(`claude --resume ${ID_A}`, 'claude', ID_B), `claude --resume ${ID_B}`);
  assert.equal(agentes.comandoRetomada('codex exec "teste"', 'codex', ID_A), null);
  assert.equal(agentes.comandoRetomada('codex; echo outro', 'codex', ID_A), null);
  assert.equal(agentes.comandoRetomada(`codex --model gpt-test resume ${ID_A}`, 'codex', ID_B), null);
  assert.equal(agentes.comandoRetomada('claude --model sonnet "execute uma tarefa"', 'claude', ID_A), null);
  assert.throws(() => agentes.comandoRetomada('codex', 'codex', 'id; comando'));
});

test('persiste IDs diferentes na mesma pasta e recupera captura apos reinicio', () => {
  const servico = agentes.criarGerenciador(dir, db);
  const a = nova();
  const b = nova();
  const inicioA = servico.preparar(a, perfil('codex'));
  const inicioB = servico.preparar(b, perfil('codex'));
  assert.ok(!inicioA.initialCommand.includes(' resume '));
  assert.notEqual(inicioA.env.TERMINAL_IA_SESSION_FILE, inicioB.env.TERMINAL_IA_SESSION_FILE);
  fs.writeFileSync(inicioA.env.TERMINAL_IA_SESSION_FILE, JSON.stringify({ session_id: ID_A }));
  fs.writeFileSync(inicioB.env.TERMINAL_IA_SESSION_FILE, JSON.stringify({ session_id: ID_B }));
  // Outro gerenciador representa a proxima abertura, antes da leitura do watcher antigo.
  const reiniciado = agentes.criarGerenciador(dir, db);
  const retomadaA = reiniciado.preparar(db.getSession(a.id), perfil('codex'));
  const retomadaB = reiniciado.preparar(db.getSession(b.id), perfil('codex'));
  assert.ok(retomadaA.initialCommand.startsWith(`codex resume ${ID_A} `));
  assert.ok(retomadaB.initialCommand.startsWith(`codex resume ${ID_B} `));
  servico.encerrarTodos();
  reiniciado.encerrarTodos();
  assert.equal(db.getSession(a.id).agent_session_id, ID_A);
  assert.equal(db.getSession(b.id).agent_session_id, ID_B);
  const leitura = spawnSync(process.execPath, ['-e',
    'const db = require(process.argv[1]); db.init(process.argv[2]); process.stdout.write(db.getSession(Number(process.argv[3])).agent_session_id)',
    require.resolve('../src/main/db'), dir, String(a.id)], { encoding: 'utf8' });
  assert.equal(leitura.status, 0, leitura.stderr);
  assert.equal(leitura.stdout, ID_A);
});

test('captura ID durante a sessao e ignora JSON incompleto e identificador invalido', async () => {
  const sessao = nova();
  let notificado;
  const servico = agentes.criarGerenciador(dir, db, (id) => { notificado = id; });
  const inicio = servico.preparar(sessao, perfil('claude'));
  fs.writeFileSync(inicio.env.TERMINAL_IA_SESSION_FILE, '{');
  servico.sincronizar(sessao.id);
  assert.equal(db.getSession(sessao.id).agent_session_id, null);
  fs.writeFileSync(inicio.env.TERMINAL_IA_SESSION_FILE, JSON.stringify({ session_id: 'bad;command' }));
  servico.sincronizar(sessao.id);
  assert.equal(db.getSession(sessao.id).agent_session_id, null);
  fs.writeFileSync(inicio.env.TERMINAL_IA_SESSION_FILE, JSON.stringify({ session_id: ID_A }));
  try {
    const limite = Date.now() + 4000;
    while (!notificado && Date.now() < limite) await new Promise((r) => setTimeout(r, 50));
    assert.equal(notificado, sessao.id);
    assert.equal(db.getSession(sessao.id).agent_session_id, ID_A);
  } finally { servico.encerrarTodos(); }
});

test('vinculo manual valida ID e agente e nao e sobrescrito por captura anterior', () => {
  const servico = agentes.criarGerenciador(dir, db);
  const sessao = nova();
  const inicio = servico.preparar(sessao, perfil('claude'));
  servico.vincular(sessao.id, 'claude', ID_B);
  fs.writeFileSync(inicio.env.TERMINAL_IA_SESSION_FILE, JSON.stringify({ session_id: ID_A }));
  servico.sincronizar(sessao.id);
  assert.equal(db.getSession(sessao.id).agent_session_id, ID_B);
  assert.throws(() => servico.vincular(sessao.id, 'outro', ID_A));
  assert.throws(() => servico.vincular(sessao.id, 'claude', 'id & echo'));
  servico.encerrarTodos();
});

test('perfil alterado para outro agente preserva o ID e informa incompatibilidade', () => {
  const servico = agentes.criarGerenciador(dir, db);
  const sessao = nova();
  servico.vincular(sessao.id, 'codex', ID_A);
  assert.throws(() => servico.preparar(db.getSession(sessao.id), perfil('claude')), /agente/i);
  assert.equal(db.getSession(sessao.id).agent_session_id, ID_A);
  servico.encerrarTodos();
});

test('hook real grava apenas ID da conversa principal, sem devolver contexto ao agente', () => {
  const arquivo = path.join(dir, 'hook-real.json');
  const executar = (carga) => spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', agentes.HOOK_BASE64], {
      input: JSON.stringify(carga), encoding: 'utf8',
      env: { ...process.env, TERMINAL_IA_SESSION_FILE: arquivo },
    });
  const resultado = executar({ session_id: ID_A, hook_event_name: 'SessionStart' });
  assert.equal(resultado.status, 0, resultado.stderr);
  assert.equal(resultado.stdout.trim(), '');
  assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).session_id, ID_A);
  executar({ session_id: ID_B, agent_id: 'subagent', hook_event_name: 'SessionStart' });
  assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).session_id, ID_A);
});

test('CLI Codex instalado aceita os argumentos de hooks gerados no PowerShell', {
  skip: !process.env.TERMINAL_IA_CLI_SMOKE,
}, () => {
  const servico = agentes.criarGerenciador(dir, db);
  const inicio = servico.preparar(nova(), perfil('codex'));
  const comando = inicio.initialCommand.replace(/^codex /, 'codex.cmd features list ');
  try {
    const resultado = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', comando], {
      encoding: 'utf8', env: { ...process.env, CODEX_HOME: dir }, timeout: 15000,
    });
    assert.equal(resultado.status, 0, resultado.stderr);
    assert.match(resultado.stdout, /hooks/);
  } finally { servico.encerrarTodos(); }
});
