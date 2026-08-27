'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { ipcMain, dialog, shell } = require('electron');

const db = require('./db');
const ptys = require('./pty-manager');
const updater = require('./updater');

function registrar(getJanela) {
  /* Quando a IA para, a tela vira a fotografia de "onde eu parei" do terminal. */
  ptys.definirObservadorAtividade((sessionId, ocupado) => {
    const guardou = ocupado ? false : db.saveSessionOutput(sessionId, ptys.obterResumoTela(sessionId));
    enviar('term:atividade', { id: sessionId, ocupado });
    if (guardou) enviar('sessoes:mudaram', { ids: [sessionId], motivo: 'SAIDA' });
  });

  const on = (canal, manipulador) => {
    ipcMain.handle(canal, async (evento, ...args) => {
      try {
        return { ok: true, data: await manipulador(...args) };
      } catch (erro) {
        return { ok: false, error: erro?.message || String(erro) };
      }
    });
  };

  /* ------------------------------------------------------------- projetos */

  on('projetos:listar', () => db.listProjects());
  on('projetos:criar', (dados) => db.createProject(dados));
  on('projetos:atualizar', (id, dados) => db.updateProject(id, dados));
  on('projetos:excluir', (id) => db.deleteProject(id));
  on('projetos:reordenar', (ids) => db.reorderProjects(ids));

  on('projetos:escolherPasta', async () => {
    const janela = getJanela();
    const res = await dialog.showOpenDialog(janela, {
      title: 'Escolha a pasta do projeto',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const dir = res.filePaths[0];
    return { path: dir, name: path.basename(dir) };
  });

  on('projetos:abrirNoExplorer', (dir) => {
    shell.openPath(dir);
    return true;
  });

  on('projetos:validarPasta', (dir) => {
    try { return fs.statSync(dir).isDirectory(); } catch { return false; }
  });

  /* --------------------------------------------------------------- perfis */

  on('perfis:listar', () => db.listProfiles());
  on('perfis:salvar', (perfil) => db.saveProfile(perfil));
  on('perfis:excluir', (id) => db.deleteProfile(id));

  /* ------------------------------------------------------------- terminais */

  on('term:listarSessoes', () => db.listOpenSessions());

  on('term:abrir', ({ projectId, profileId, title, cwd, cols, rows }) => {
    const projeto = projectId ? db.getProject(projectId) : null;
    const perfil = profileId ? db.getProfile(profileId) : null;
    const diretorio = cwd || projeto?.path || process.env.USERPROFILE || process.cwd();
    const rotulo = title || `${perfil?.name || 'Shell'}${projeto ? ` — ${projeto.name}` : ''}`;

    const sessao = db.createSession({
      project_id: projectId ?? null,
      profile_id: profileId ?? null,
      project_name: projeto?.name || '',
      profile_name: perfil?.name || 'Shell',
      profile_icon: perfil?.icon || 'SH',
      title: rotulo,
      cwd: diretorio,
    });

    const info = ptys.criar(sessao.id, {
      shell: perfil?.shell,
      shellArgs: perfil?.shell_args,
      cwd: diretorio,
      cols, rows,
      initialCommand: perfil?.initial_command,
    }, (dados) => enviar('term:dados', { id: sessao.id, data: dados }),
       (saida) => enviar('term:fim', { id: sessao.id, ...saida }));

    return { ...sessao, shell: info.shell };
  });

  on('term:reconectar', ({ sessionId, cols, rows }) => {
    const sessao = db.getSession(sessionId);
    if (!sessao || !sessao.open) throw new Error('Sessao nao encontrada.');
    const perfil = sessao.profile_id ? db.getProfile(sessao.profile_id) : null;

    const info = ptys.criar(sessao.id, {
      shell: perfil?.shell,
      shellArgs: perfil?.shell_args,
      cwd: sessao.cwd,
      cols, rows,
      initialCommand: perfil?.initial_command,
    }, (dados) => enviar('term:dados', { id: sessao.id, data: dados }),
       (saida) => enviar('term:fim', { id: sessao.id, ...saida }));

    db.touchSession(sessao.id);
    return { ...sessao, shell: info.shell };
  });

  on('term:escrever', ({ id, data }) => ptys.escrever(id, data));
  on('term:redimensionar', ({ id, cols, rows }) => ptys.redimensionar(id, cols, rows));

  on('term:executar', ({ id, command, projectId }) => {
    const enviado = ptys.executarComando(id, command);
    if (enviado) db.addCommandHistory(projectId ?? null, command);
    return enviado;
  });

  /* Fechar o terminal e o unico caminho para o historico. */
  on('term:fechar', ({ id }) => {
    db.saveSessionOutput(id, ptys.obterResumoTela(id));
    ptys.encerrar(id);
    const sessao = db.closeSession(id);
    enviar('historico:mudou', { id });
    return sessao;
  });

  /* Fecha o laco de contrapressao do lote de saida — ver comentario em pty-manager.js. */
  on('term:dadosRecebidos', ({ id, bytes }) => { ptys.confirmarRecebimento(id, bytes); return true; });

  on('term:renomear', ({ id, title }) => db.touchSession(id, title));
  on('term:reordenar', (ids) => db.reorderSessions(ids));
  on('term:estado', (id) => ptys.obterEstado(id));

  /* ------------------------------------------------------------- anotacoes */

  on('sessoes:obter', (id) => db.getSession(id));
  on('sessoes:anotacoes', (id) => db.listSessionNotes(id));
  on('sessoes:anotar', ({ sessionId, body }) => db.addSessionNote(sessionId, body, 'NOT'));
  on('sessoes:excluirAnotacao', (id) => db.deleteSessionNote(id));
  on('sessoes:excluir', (id) => db.deleteSession(id));

  /* ------------------------------------------------- historico e settings */

  on('hist:sessoes', (filtro) => db.listSessionHistory(filtro || {}));
  on('hist:comandos', ({ projectId, limite }) => db.listCommandHistory(projectId, limite));
  on('config:obter', ({ chave, padrao }) => db.getSetting(chave, padrao));
  on('config:salvar', ({ chave, valor }) => db.setSetting(chave, valor));

  /* ------------------------------------------------------------ atualizacao */

  on('atualizacao:verificar', () => updater.verificarAgora());
  on('atualizacao:instalarAgora', () => { updater.instalarAgora(); return true; });

  function enviar(canal, carga) {
    const janela = getJanela();
    if (janela && !janela.isDestroyed()) janela.webContents.send(canal, carga);
  }
}

module.exports = { registrar };
