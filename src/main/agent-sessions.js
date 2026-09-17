'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ID_VALIDO = /^(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|thr_[a-z0-9_-]{1,100})$/i;
// O comando e fixo: caminhos e IDs nunca sao interpolados em codigo PowerShell.
// O arquivo pertence a uma unica inicializacao de uma unica aba.
const HOOK_BASE64 = Buffer.from(`
$ErrorActionPreference = 'Stop'
try {
  $evento = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($evento.agent_id -or !$env:TERMINAL_IA_SESSION_FILE) { exit 0 }
  $idConversa = [string]$evento.session_id
  if ($idConversa -notmatch '^(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|thr_[a-z0-9_-]{1,100})$') { exit 0 }
  $registro = @{ session_id = $idConversa } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($env:TERMINAL_IA_SESSION_FILE, $registro, (New-Object Text.UTF8Encoding($false)))
} catch { exit 0 }
`, 'utf16le').toString('base64');
const COMANDO_HOOK = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${HOOK_BASE64}`;

function validar(agente, id) {
  if (!['codex', 'claude'].includes(agente)) throw new Error('Escolha Codex ou Claude.');
  if (!ID_VALIDO.test(String(id || ''))) throw new Error('Informe o ID valido da conversa, sem o comando resume.');
}

/** Apenas comandos diretos. Scripts, pipelines e wrappers continuam intactos. */
function analisar(comando) {
  const texto = String(comando || '').trim();
  if (/[\r\n;&|`<>$]/.test(texto)) return null;
  const tokens = texto.match(/(?:"[^"]*"|'(?:[^']|'')*'|[^\s"'])+/g) || [];
  if (!tokens.length || tokens.join(' ').replace(/\s/g, '') !== texto.replace(/\s/g, '')) return null;
  const executavel = tokens.shift();
  const agente = /^(codex|claude)(?:\.cmd|\.exe)?$/i.exec(executavel)?.[1]?.toLowerCase();
  if (!agente) return null;
  if (tokens.some((t) => /^--settings(?:=|$)/.test(t) || /^['"]?hooks\./.test(t))) return null;
  if (agente === 'codex' && tokens[0] && !tokens[0].startsWith('-') && tokens[0] !== 'resume') return null;
  if (agente === 'claude' && tokens[0] && !tokens[0].startsWith('-')) return null;
  // Modo nao interativo e fork nao pertencem a restauracao de uma aba.
  if (tokens.some((t) => ['-p', '--print', '--fork-session', '--session-id'].includes(t)) && agente === 'claude') return null;
  const comValor = new Set(agente === 'codex'
    ? ['--model', '-m', '--profile', '-p', '--config', '-c', '--cd', '-C', '--sandbox', '-s',
      '--ask-for-approval', '-a', '--add-dir', '--enable', '--disable', '--local-provider']
    : ['--model', '--agent', '--permission-mode', '--add-dir', '--append-system-prompt',
      '--system-prompt', '--effort', '--mcp-config']);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if ((agente === 'codex' && i === 0 && token === 'resume')
      || (agente === 'claude' && ['--resume', '-r'].includes(token))) {
      if (tokens[i + 1] && !tokens[i + 1].startsWith('-')) i++;
      continue;
    }
    if (!token.startsWith('-')) return null; // Nao repete prompts iniciais ao restaurar.
    if (comValor.has(token)) {
      if (!tokens[i + 1]) return null;
      i++;
    }
  }
  return { agente, executavel, tokens };
}

function comandoRetomada(comando, agente, id) {
  validar(agente, id);
  const partes = analisar(comando);
  if (!partes || partes.agente !== agente) return null;
  const tokens = [...partes.tokens];
  if (agente === 'codex' && tokens[0] === 'resume') {
    tokens.shift();
    if (tokens[0] && !tokens[0].startsWith('-')) tokens.shift();
  }
  const restantes = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (agente === 'codex' && ['--last', '--all'].includes(token)) continue;
    if (agente === 'claude') {
      if (['--continue', '-c'].includes(token)) continue;
      if (['--resume', '-r'].includes(token)) {
        if (tokens[i + 1] && !tokens[i + 1].startsWith('-')) i++;
        continue;
      }
      if (token.startsWith('--resume=')) continue;
    }
    restantes.push(token);
  }
  return [partes.executavel, agente === 'codex' ? 'resume' : '--resume', id, ...restantes].join(' ');
}

function criarGerenciador(userDataDir, db, aoMudar = () => {}) {
  const diretorio = path.join(userDataDir, 'agent-sessions');
  fs.mkdirSync(diretorio, { recursive: true });
  const observadores = new Map();

  function arquivo(token) {
    return /^[a-f0-9-]{36}$/i.test(token || '') ? path.join(diretorio, `${token}.json`) : null;
  }

  function recuperar(sessao) {
    const destino = arquivo(sessao?.agent_capture_token);
    if (!destino) return;
    try {
      if (fs.statSync(destino).size > 2048) return;
      const registro = JSON.parse(fs.readFileSync(destino, 'utf8'));
      validar(sessao.agent_kind, registro.session_id);
      if (sessao.agent_session_id === registro.session_id) return;
      db.saveAgentSession(sessao.id, sessao.agent_kind, registro.session_id, sessao.agent_capture_token);
      aoMudar(sessao.id);
    } catch { /* Arquivo ainda nao criado, escrita parcial ou ID invalido: tenta na proxima leitura. */ }
  }

  function sincronizar(id) {
    const sessao = db.getSession(id);
    const observador = observadores.get(id);
    if (observador && observador.token !== sessao?.agent_capture_token) return;
    recuperar(sessao);
  }

  function parar(id) {
    const observador = observadores.get(id);
    if (observador) fs.unwatchFile(observador.arquivo, observador.callback);
    observadores.delete(id);
  }

  function preparar(sessao, perfil) {
    parar(sessao.id);
    recuperar(db.getSession(sessao.id));
    sessao = db.getSession(sessao.id);
    const inicial = perfil?.initial_command || '';
    const partes = analisar(inicial);
    const shell = perfil?.shell || 'powershell.exe';
    if (!partes || !/^(?:powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd\.exe)$/i.test(shell)) {
      if (sessao.agent_session_id) throw new Error('Este perfil usa um comando personalizado. Use um comando direto codex ou claude para retomar a conversa salva.');
      return { initialCommand: inicial, env: perfil?.env };
    }
    const agente = partes.agente;
    if (sessao.agent_session_id && sessao.agent_kind !== agente) {
      throw new Error('O agente do perfil mudou. Ajuste o perfil ou vincule uma conversa do agente atual.');
    }
    const id = sessao.agent_kind === agente ? sessao.agent_session_id : null;
    const token = randomUUID();
    const destino = arquivo(token);
    db.saveAgentSession(sessao.id, agente, id, token);
    let comando = id ? comandoRetomada(inicial, agente, id) : inicial;
    if (agente === 'codex') {
      const grupo = `[{hooks=[{type='command',command='${COMANDO_HOOK}'}]}]`;
      // TOML usa aspas simples internamente; o argumento externo funciona em PS e CMD.
      comando += ` -c "hooks.SessionStart=${grupo}" -c "hooks.Stop=${grupo}"`;
    } else {
      const configuracao = path.join(diretorio, 'claude-hooks.json');
      const grupo = [{ hooks: [{ type: 'command', command: COMANDO_HOOK }] }];
      fs.writeFileSync(configuracao, JSON.stringify({ hooks: { SessionStart: grupo, Stop: grupo } }));
      if (/["%$`\r\n]/.test(configuracao)) throw new Error('Caminho de dados incompativel com captura automatica de sessoes.');
      comando += ` --settings "${configuracao}"`;
    }
    const callback = () => sincronizar(sessao.id);
    fs.watchFile(destino, { interval: 500, persistent: false }, callback);
    observadores.set(sessao.id, { token, arquivo: destino, callback });
    return {
      initialCommand: comando,
      env: { ...(perfil?.env || {}), TERMINAL_IA_SESSION_FILE: destino },
    };
  }

  function vincular(id, agente, conversa) {
    validar(agente, conversa);
    if (!db.getSession(id)) throw new Error('Terminal nao encontrado.');
    parar(id);
    db.saveAgentSession(id, agente, conversa, null);
    aoMudar(id);
    return db.getSession(id);
  }

  function encerrar(id) { sincronizar(id); parar(id); }
  function encerrarTodos() { for (const id of [...observadores.keys()]) encerrar(id); }
  return { preparar, sincronizar, vincular, encerrar, encerrarTodos };
}

module.exports = { criarGerenciador, comandoRetomada, HOOK_BASE64 };
