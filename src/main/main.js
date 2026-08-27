'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, shell } = require('electron');

const db = require('./db');
const ipc = require('./ipc');
const ptys = require('./pty-manager');
const updater = require('./updater');

let janela = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (janela) {
      if (janela.isMinimized()) janela.restore();
      janela.focus();
    }
  });
}

function criarJanela() {
  const bounds = db.getSetting('janela.bounds', { width: 1360, height: 860 });

  janela = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 820,
    minHeight: 560,
    show: false,
    backgroundColor: '#12141a',
    title: 'Terminal IA',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  janela.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  janela.once('ready-to-show', () => {
    janela.show();
    if (db.getSetting('janela.maximizada', false)) janela.maximize();
  });

  const salvarBounds = () => {
    if (!janela || janela.isDestroyed()) return;
    db.setSetting('janela.maximizada', janela.isMaximized());
    if (!janela.isMaximized() && !janela.isFullScreen()) db.setSetting('janela.bounds', janela.getBounds());
  };
  janela.on('resize', salvarBounds);
  janela.on('move', salvarBounds);
  janela.on('close', salvarBounds);
  janela.on('closed', () => { janela = null; });

  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function montarMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Novo terminal', accelerator: 'Ctrl+Shift+T', click: () => enviarAtalho('novo-terminal') },
        { label: 'Fechar terminal', accelerator: 'Ctrl+Shift+W', click: () => enviarAtalho('fechar-terminal') },
        { label: 'Reiniciar terminal', accelerator: 'Ctrl+Shift+R', click: () => enviarAtalho('reiniciar-terminal') },
        { type: 'separator' },
        { label: 'Adicionar projeto', accelerator: 'Ctrl+Shift+O', click: () => enviarAtalho('novo-projeto') },
        { label: 'Anotar neste terminal', accelerator: 'Ctrl+Shift+N', click: () => enviarAtalho('anotar') },
        { label: 'Historico do trabalho', accelerator: 'Ctrl+Shift+H', click: () => enviarAtalho('historico') },
        { type: 'separator' },
        { label: 'Verificar atualizacoes', click: () => enviarAtalho('verificar-atualizacoes') },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { label: 'Alternar barra lateral', accelerator: 'Ctrl+Shift+B', click: () => enviarAtalho('alternar-sidebar') },
        { label: 'Focar barra de comando', accelerator: 'Ctrl+Shift+K', click: () => enviarAtalho('focar-comando') },
        { label: 'Proximo terminal', accelerator: 'Ctrl+Tab', click: () => enviarAtalho('proximo-terminal') },
        { label: 'Terminal anterior', accelerator: 'Ctrl+Shift+Tab', click: () => enviarAtalho('terminal-anterior') },
        { type: 'separator' },
        { label: 'Recarregar interface', accelerator: 'F5', click: () => janela?.reload() },
        { label: 'Ferramentas do desenvolvedor', accelerator: 'F12', click: () => janela?.webContents.toggleDevTools() },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function enviarAtalho(acao) {
  if (janela && !janela.isDestroyed()) janela.webContents.send('app:atalho', acao);
}

app.whenReady().then(() => {
  db.init(app.getPath('userData'));
  ipc.registrar(() => janela);
  montarMenu();
  criarJanela();
  updater.iniciar(() => janela);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on('window-all-closed', () => {
  ptys.encerrarTodos();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => ptys.encerrarTodos());
