'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function invocar(canal, ...args) {
  return ipcRenderer.invoke(canal, ...args).then((res) => {
    if (!res || res.ok !== true) throw new Error(res?.error || 'Falha na chamada IPC.');
    return res.data;
  });
}

function ouvir(canal, cb) {
  const ouvinte = (_e, carga) => cb(carga);
  ipcRenderer.on(canal, ouvinte);
  return () => ipcRenderer.removeListener(canal, ouvinte);
}

contextBridge.exposeInMainWorld('api', {
  projetos: {
    listar: () => invocar('projetos:listar'),
    criar: (dados) => invocar('projetos:criar', dados),
    atualizar: (id, dados) => invocar('projetos:atualizar', id, dados),
    excluir: (id) => invocar('projetos:excluir', id),
    reordenar: (ids) => invocar('projetos:reordenar', ids),
    escolherPasta: () => invocar('projetos:escolherPasta'),
    abrirNoExplorer: (dir) => invocar('projetos:abrirNoExplorer', dir),
    validarPasta: (dir) => invocar('projetos:validarPasta', dir),
  },
  perfis: {
    listar: () => invocar('perfis:listar'),
    salvar: (perfil) => invocar('perfis:salvar', perfil),
    excluir: (id) => invocar('perfis:excluir', id),
  },
  term: {
    listarSessoes: () => invocar('term:listarSessoes'),
    abrir: (dados) => invocar('term:abrir', dados),
    reconectar: (dados) => invocar('term:reconectar', dados),
    escrever: (id, data) => invocar('term:escrever', { id, data }),
    redimensionar: (id, cols, rows) => invocar('term:redimensionar', { id, cols, rows }),
    executar: (id, command, projectId) => invocar('term:executar', { id, command, projectId }),
    fechar: (id) => invocar('term:fechar', { id }),
    renomear: (id, title) => invocar('term:renomear', { id, title }),
    reordenar: (ids) => invocar('term:reordenar', ids),
    estado: (id) => invocar('term:estado', id),
    dadosRecebidos: (id, bytes) => invocar('term:dadosRecebidos', { id, bytes }),
    aoReceberDados: (cb) => ouvir('term:dados', cb),
    aoEncerrar: (cb) => ouvir('term:fim', cb),
    aoMudarAtividade: (cb) => ouvir('term:atividade', cb),
  },
  sessoes: {
    obter: (id) => invocar('sessoes:obter', id),
    anotacoes: (id) => invocar('sessoes:anotacoes', id),
    anotar: (sessionId, body) => invocar('sessoes:anotar', { sessionId, body }),
    excluirAnotacao: (id) => invocar('sessoes:excluirAnotacao', id),
    excluir: (id) => invocar('sessoes:excluir', id),
    aoMudar: (cb) => ouvir('sessoes:mudaram', cb),
  },
  historico: {
    sessoes: (filtro) => invocar('hist:sessoes', filtro),
    comandos: (projectId, limite) => invocar('hist:comandos', { projectId, limite }),
    aoMudar: (cb) => ouvir('historico:mudou', cb),
  },
  config: {
    obter: (chave, padrao) => invocar('config:obter', { chave, padrao }),
    salvar: (chave, valor) => invocar('config:salvar', { chave, valor }),
  },
  app: {
    aoReceberAtalho: (cb) => ouvir('app:atalho', cb),
    plataforma: process.platform,
  },
  clipboard: {
    ler: () => invocar('clipboard:ler'),
    escrever: (texto) => invocar('clipboard:escrever', texto),
  },
  atualizacao: {
    verificar: () => invocar('atualizacao:verificar'),
    instalarAgora: () => invocar('atualizacao:instalarAgora'),
    aoFicarPronta: (cb) => ouvir('atualizacao:pronta', cb),
  },
});
