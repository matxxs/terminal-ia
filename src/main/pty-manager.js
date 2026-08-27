'use strict';

const os = require('node:os');
const fs = require('node:fs');
const pty = require('@lydell/node-pty');

const sessoes = new Map();

/* ------------------------------------------------- deteccao de atividade */

/**
 * Claude Code e Codex redesenham a tela continuamente enquanto processam
 * (spinner + contador de tokens) e ficam em silencio ao aguardar o usuario.
 * A atividade e inferida disso, com os rotulos de interrupcao como reforco:
 * enquanto "esc to interrupt" estiver na tela, a IA esta trabalhando.
 */
const SILENCIO_MS = 2500;
const INTERVALO_VARREDURA = 600;

/**
 * Subir o shell e a IA ja produz muita saida, e isso nao e "trabalho".
 * A sessao so passa a reportar atividade depois de assentar pela primeira vez
 * (primeiro silencio). O teto evita travar quando a IA emenda direto no
 * processamento e nunca fica ociosa logo apos abrir.
 */
const AQUECIMENTO_MAXIMO_MS = 20000;

/**
 * Sem isso, uma sessao com saida muito rapida e sustentada (ex.: IA rodando
 * bateria de testes) manda uma mensagem IPC por chunk do PTY e escreve cada
 * uma direto no xterm.js — inclusive em abas ocultas, que continuam vivas de
 * proposito. A fila interna de escrita do xterm cresce mais rapido do que e
 * consumida e a memoria/CPU do processo sobe ate travar a maquina.
 *
 * O lote agrupa os chunks de uma janela curta numa unica mensagem; a
 * contrapressao pausa o PTY quando o volume ja mandado e ainda nao
 * confirmado pelo renderer passa do teto, e retoma quando confirma().
 */
const LOTE_MS = 16;
const LIMIAR_PAUSA_BYTES = 200_000;
const LIMIAR_RETOMADA_BYTES = 50_000;

const MARCADORES_OCUPADO = [
  /esc to interrupt/i,
  /esc para interromper/i,
  /ctrl\+c to (stop|cancel)/i,
  /\btokens?\b.*\besc\b/i,
];

let temporizadorVarredura = null;
let aoMudarAtividade = () => {};

function definirObservadorAtividade(callback) {
  aoMudarAtividade = callback || (() => {});
}

function limparAnsi(texto) {
  return texto
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b[[\]()#;?]*[0-9;]*[A-Za-z]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function registrarSaida(estado, dados) {
  estado.tela = (estado.tela + limparAnsi(dados)).slice(-4000);
  estado.marcadorOcupado = MARCADORES_OCUPADO.some((rx) => rx.test(estado.tela));
  /* Redesenho provocado por resize nosso nao e trabalho da IA. */
  if (Date.now() < estado.silenciarAte) return;
  estado.ultimaSaida = Date.now();
}

function avaliarAtividade() {
  const agora = Date.now();
  for (const [id, estado] of sessoes) {
    if (!estado.vivo) continue;
    const ocupado = estado.marcadorOcupado || (agora - estado.ultimaSaida) < SILENCIO_MS;

    if (!estado.aquecido) {
      const assentou = !ocupado;
      const estourou = (agora - estado.criadoEm) > AQUECIMENTO_MAXIMO_MS;
      if (!assentou && !estourou) continue;
      estado.aquecido = true;
      /* Assentar e um evento por si so: e o primeiro "parou aqui" da sessao. */
      if (assentou) {
        estado.ocupado = false;
        aoMudarAtividade(id, false);
        continue;
      }
    }

    if (ocupado === estado.ocupado) continue;
    estado.ocupado = ocupado;
    aoMudarAtividade(id, ocupado);
  }
}

function garantirVarredura() {
  if (temporizadorVarredura) return;
  temporizadorVarredura = setInterval(avaliarAtividade, INTERVALO_VARREDURA);
  temporizadorVarredura.unref?.();
}

function resolverShell(shell) {
  const nome = String(shell || '').toLowerCase();
  if (nome === 'pwsh' || nome === 'pwsh.exe') {
    const candidatos = [
      `${process.env.ProgramFiles}\\PowerShell\\7\\pwsh.exe`,
      `${process.env.LOCALAPPDATA}\\Microsoft\\WindowsApps\\pwsh.exe`,
    ];
    const achado = candidatos.find((cam) => { try { return fs.existsSync(cam); } catch { return false; } });
    if (achado) return achado;
    return 'powershell.exe';
  }
  if (!shell) return process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  return shell;
}

function diretorioValido(cwd) {
  try {
    if (cwd && fs.statSync(cwd).isDirectory()) return cwd;
  } catch { /* cai no fallback */ }
  return os.homedir();
}

/**
 * Cria um PTY real (ConPTY no Windows). O shell sempre sobe primeiro; o comando
 * inicial do perfil (claude, codex, ...) e digitado nele depois — assim, se a IA
 * encerrar ou nao estiver instalada, o terminal continua utilizavel.
 */
function criar(sessionId, { shell, shellArgs, cwd, cols, rows, initialCommand, env }, onData, onExit) {
  encerrar(sessionId);

  const executavel = resolverShell(shell);
  const diretorio = diretorioValido(cwd);
  const processo = pty.spawn(executavel, shellArgs || [], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: diretorio,
    env: { ...process.env, ...(env || {}), TERM: 'xterm-256color', TERMINAL_IA: '1' },
    useConpty: true,
  });

  const estado = {
    processo, cwd: diretorio, shell: executavel, vivo: true,
    tela: '', ocupado: false, marcadorOcupado: false,
    /* Nasce "com saida recente": sem isso, uma varredura antes do primeiro byte
       consideraria a sessao ja assentada e anularia o aquecimento. */
    ultimaSaida: Date.now(),
    aquecido: false, criadoEm: Date.now(), silenciarAte: 0,
    colunas: cols || 80, linhas: rows || 24,
    /* Lote e contrapressao — ver comentario de LOTE_MS acima. */
    bufferSaida: [], temporizadorLote: null, bytesEmTransito: 0, pausadoPorFluxo: false,
  };
  sessoes.set(sessionId, estado);
  garantirVarredura();

  function despacharLote() {
    estado.temporizadorLote = null;
    if (!estado.bufferSaida.length) return;
    const lote = estado.bufferSaida.join('');
    estado.bufferSaida.length = 0;
    if (!estado.vivo) return;
    estado.bytesEmTransito += Buffer.byteLength(lote);
    if (estado.bytesEmTransito >= LIMIAR_PAUSA_BYTES && !estado.pausadoPorFluxo) {
      estado.pausadoPorFluxo = true;
      try { estado.processo.pause(); } catch { /* processo ja pode ter morrido */ }
    }
    onData(lote);
  }

  processo.onData((dados) => {
    registrarSaida(estado, dados);
    estado.bufferSaida.push(dados);
    if (!estado.temporizadorLote) {
      estado.temporizadorLote = setTimeout(despacharLote, LOTE_MS);
      estado.temporizadorLote.unref?.();
    }
  });

  processo.onExit(({ exitCode, signal }) => {
    estado.vivo = false;
    if (estado.temporizadorLote) { clearTimeout(estado.temporizadorLote); estado.temporizadorLote = null; }
    /* Ultimas linhas antes de morrer (erro, stack trace) nao podem ficar presas no lote. */
    if (estado.bufferSaida.length) {
      const lote = estado.bufferSaida.join('');
      estado.bufferSaida.length = 0;
      onData(lote);
    }
    if (estado.ocupado) aoMudarAtividade(sessionId, false);
    sessoes.delete(sessionId);
    onExit({ exitCode, signal });
  });

  if (initialCommand && initialCommand.trim()) {
    setTimeout(() => {
      const atual = sessoes.get(sessionId);
      if (atual && atual.vivo) atual.processo.write(`${initialCommand.trim()}\r`);
    }, 450);
  }

  return { pid: processo.pid, cwd: diretorio, shell: executavel };
}

function escrever(sessionId, dados) {
  const estado = sessoes.get(sessionId);
  if (!estado || !estado.vivo) return false;
  estado.processo.write(dados);
  return true;
}

function executarComando(sessionId, comando) {
  return escrever(sessionId, `${String(comando).replace(/\r?\n/g, ' ')}\r`);
}

const SILENCIO_POS_RESIZE_MS = 900;

function redimensionar(sessionId, cols, rows) {
  const estado = sessoes.get(sessionId);
  if (!estado || !estado.vivo) return false;
  const largura = Math.max(cols, 2);
  const altura = Math.max(rows, 1);
  if (estado.colunas === largura && estado.linhas === altura) return true;
  try { estado.processo.resize(largura, altura); } catch { return false; }
  estado.colunas = largura;
  estado.linhas = altura;
  estado.silenciarAte = Date.now() + SILENCIO_POS_RESIZE_MS;
  return true;
}

function encerrar(sessionId) {
  const estado = sessoes.get(sessionId);
  if (!estado) return false;
  estado.vivo = false;
  if (estado.temporizadorLote) { clearTimeout(estado.temporizadorLote); estado.temporizadorLote = null; }
  try { estado.processo.kill(); } catch { /* processo ja morreu */ }
  sessoes.delete(sessionId);
  return true;
}

/**
 * O renderer chama isso depois que o xterm.js termina de processar um lote
 * (callback do term.write). Fecha o laco de contrapressao: sem essa
 * confirmacao o PTY pausado nunca seria retomado.
 */
function confirmarRecebimento(sessionId, bytes) {
  const estado = sessoes.get(sessionId);
  if (!estado) return;
  estado.bytesEmTransito = Math.max(0, estado.bytesEmTransito - (Number(bytes) || 0));
  if (estado.pausadoPorFluxo && estado.bytesEmTransito <= LIMIAR_RETOMADA_BYTES) {
    estado.pausadoPorFluxo = false;
    try { estado.processo.resume(); } catch { /* processo ja pode ter morrido */ }
  }
}

function encerrarTodos() {
  for (const id of [...sessoes.keys()]) encerrar(id);
}

function estaVivo(sessionId) {
  const estado = sessoes.get(sessionId);
  return Boolean(estado && estado.vivo);
}

/** No Windows o ConPTY so publica o PID depois do spawn, por isso e lido sob demanda. */
function obterEstado(sessionId) {
  const estado = sessoes.get(sessionId);
  if (!estado) return { vivo: false, pid: null, shell: null, cwd: null };
  return {
    vivo: estado.vivo,
    pid: estado.processo.pid || null,
    shell: estado.shell,
    cwd: estado.cwd,
    ocupado: estado.ocupado,
  };
}

/**
 * Ultimas linhas uteis da tela — serve de "onde eu parei" para o terminal.
 * O buffer ja vem sem ANSI; aqui so restam a limpeza de ruido e o corte.
 */
function obterResumoTela(sessionId, maximoLinhas = 8, maximoCaracteres = 700) {
  const estado = sessoes.get(sessionId);
  if (!estado) return '';

  const linhas = estado.tela
    .split(/\r?\n/)
    .map((linha) => linha.replace(/\s+$/, ''))
    .filter((linha) => linha.trim().length > 0)
    .filter((linha) => !/^[\s.·•▪░▒▓─━=_*]+$/.test(linha.trim()));

  const resumo = linhas.slice(-maximoLinhas).join('\n').trim();
  return resumo.length > maximoCaracteres ? `...${resumo.slice(-maximoCaracteres)}` : resumo;
}

module.exports = {
  criar, escrever, executarComando, redimensionar, encerrar, encerrarTodos,
  estaVivo, obterEstado, resolverShell, definirObservadorAtividade, obterResumoTela,
  confirmarRecebimento,
};
