'use strict';

/** Confirma a saida sem encerrar os terminais antes da decisao do usuario. */
module.exports = function configurarFechamento(janela, { db, dialog, estaInstalando }) {
  let autorizado = false;
  let perguntando = false;

  janela.on('close', (evento) => {
    if (autorizado || estaInstalando() || db.getSetting('app.naoConfirmarSaida', false)) return;
    evento.preventDefault();
    if (perguntando) return;
    perguntando = true;

    dialog.showMessageBox(janela, {
      type: 'question',
      title: 'Fechar Terminal IA',
      message: 'Deseja realmente fechar o sistema?',
      buttons: ['Cancelar', 'Fechar'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      checkboxLabel: 'Não exibir novamente',
      checkboxChecked: false,
    }).then(({ response, checkboxChecked }) => {
      if (response !== 1 || janela.isDestroyed()) return;
      if (checkboxChecked) db.setSetting('app.naoConfirmarSaida', true);
      autorizado = true;
      janela.close();
    }).catch((erro) => {
      console.error('Falha ao confirmar fechamento:', erro);
    }).finally(() => { perguntando = false; });
  });
};
