'use strict';

const { autoUpdater } = require('electron-updater');

/**
 * Atualizacao automatica via GitHub Releases (repo privado). O token de
 * leitura NAO fica embutido no build: o electron-updater le GH_TOKEN ou
 * GITHUB_TOKEN direto do ambiente da maquina que roda o app — precisa estar
 * configurado como variavel de ambiente do Windows (nao so da sessao do
 * terminal), senao a checagem falha silenciosamente com erro de autenticacao.
 *
 * Checa ao abrir e baixa em 2o plano; quem decide reiniciar e o usuario, via
 * o aviso que a UI mostra (evento 'atualizacao:pronta'). Sem dialogo nativo
 * do electron-updater.
 */
const INTERVALO_VERIFICACAO_MS = 4 * 60 * 60 * 1000;

function iniciar(getJanela) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  const enviar = (canal, carga) => {
    const janela = getJanela();
    if (janela && !janela.isDestroyed()) janela.webContents.send(canal, carga);
  };

  autoUpdater.on('update-downloaded', (info) => enviar('atualizacao:pronta', { versao: info.version }));
  autoUpdater.on('error', (erro) => console.error('[updater]', erro?.message || erro));

  verificarSilenciosa();
  /* Sessao pode ficar aberta o dia inteiro — checar so na abertura nao seria
     suficiente, e bater no GitHub toda hora tambem nao faz sentido. */
  setInterval(verificarSilenciosa, INTERVALO_VERIFICACAO_MS).unref();
}

function verificarSilenciosa() {
  autoUpdater.checkForUpdates().catch((erro) => {
    console.error('[updater] falha ao checar:', erro?.message || erro);
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
  autoUpdater.quitAndInstall();
}

module.exports = { iniciar, verificarAgora, instalarAgora };
