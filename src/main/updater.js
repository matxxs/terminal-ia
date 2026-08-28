'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

/**
 * Atualizacao automatica via GitHub Releases (repo publico — sem token,
 * nenhuma variavel de ambiente precisa existir na maquina de quem roda o app).
 *
 * Checa ao abrir e baixa em 2o plano; quem decide reiniciar e o usuario, via
 * o aviso que a UI mostra (evento 'atualizacao:pronta'). Sem dialogo nativo
 * do electron-updater.
 */
const INTERVALO_VERIFICACAO_MS = 4 * 60 * 60 * 1000;

let logPath = null;

/**
 * Log em arquivo (alem do console, que some numa build empacotada — sem
 * DevTools aberto ninguem ve nada). Sem isso, um update que da errado nao
 * deixa rastro nenhum pra investigar depois; com isso, o log sobrevive ao
 * fechar/reabrir do app (a propria instalacao da atualizacao inclusive) e
 * mostra a linha de comando exata que o NSIS recebeu (isSilent, --force-run,
 * --updated etc.), vinda do proprio electron-updater.
 */
function log(nivel, mensagem) {
  const linha = `[${new Date().toISOString()}] [${nivel}] ${mensagem}`;
  (nivel === 'error' ? console.error : console.log)(linha);
  if (!logPath) return;
  try { fs.appendFileSync(logPath, linha + '\n'); } catch { /* log nunca pode derrubar o updater */ }
}

function iniciar(getJanela) {
  logPath = path.join(app.getPath('userData'), 'logs', 'updater.log');
  try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); } catch { /* segue sem persistir */ }

  autoUpdater.logger = {
    info: (msg) => log('info', msg),
    warn: (msg) => log('warn', msg),
    error: (msg) => log('error', msg),
    debug: (msg) => log('debug', msg),
  };

  log('info', `Terminal IA v${app.getVersion()} iniciado — exe: ${process.execPath}`);

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  const enviar = (canal, carga) => {
    const janela = getJanela();
    if (janela && !janela.isDestroyed()) janela.webContents.send(canal, carga);
  };

  autoUpdater.on('update-available', (info) => enviar('atualizacao:baixando', { versao: info.version }));
  autoUpdater.on('download-progress', (info) => enviar('atualizacao:progresso', { percent: Math.round(info.percent) }));
  autoUpdater.on('update-downloaded', (info) => enviar('atualizacao:pronta', { versao: info.version }));
  autoUpdater.on('error', (erro) => {
    log('error', `evento 'error' do autoUpdater: ${erro?.stack || erro?.message || erro}`);
    /* Se a barra de progresso jah apareceu (download-progress chegou a disparar),
       sem isso ela ficaria presa na tela pra sempre. */
    enviar('atualizacao:erro');
  });

  verificarSilenciosa();
  /* Sessao pode ficar aberta o dia inteiro — checar so na abertura nao seria
     suficiente, e bater no GitHub toda hora tambem nao faz sentido. */
  setInterval(verificarSilenciosa, INTERVALO_VERIFICACAO_MS).unref();
}

function verificarSilenciosa() {
  autoUpdater.checkForUpdates().catch((erro) => {
    log('error', `falha ao checar: ${erro?.stack || erro?.message || erro}`);
  });
}

/** Usado pelo item de menu "Verificar atualizacoes": quem chamou quer saber o resultado. */
async function verificarAgora() {
  const resultado = await autoUpdater.checkForUpdates();
  if (!resultado) return { temAtualizacao: false, ativo: false };
  return {
    temAtualizacao: Boolean(resultado.isUpdateAvailable),
    versao: resultado.updateInfo?.version || null,
    ativo: true,
  };
}

function instalarAgora() {
  /* Sem os dois argumentos, o NSIS reinstala em modo visivel: assistente,
     paginas, recriacao de atalhos — como se fosse a primeira instalacao de
     novo. isSilent=true manda a flag /S pro instalador (sem UI nenhuma);
     isForceRunAfter=true reabre o app sozinho ao terminar. */
  log('info', 'instalarAgora(): chamando quitAndInstall(isSilent=true, isForceRunAfter=true)');
  autoUpdater.quitAndInstall(true, true);
}

module.exports = { iniciar, verificarAgora, instalarAgora };
