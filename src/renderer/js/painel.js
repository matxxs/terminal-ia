/** Painel da direita, compartilhado pelas anotacoes e pelo historico. */

import { $, limpar } from './ui.js';
import { estado, emitir } from './estado.js';
import { reajustar } from './terminais.js';

export function abrirPainel(tipo) {
  estado.painel = tipo;
  if (tipo !== 'notas') estado.sessaoAnotada = null;

  const painel = $('#painel-direito');
  limpar(painel);
  painel.classList.remove('oculto');
  $('#app').classList.add('painel-aberto');
  reajustar();
  return painel;
}

export function fecharPainel() {
  estado.painel = null;
  estado.sessaoAnotada = null;
  $('#painel-direito').classList.add('oculto');
  $('#app').classList.remove('painel-aberto');
  reajustar();
  emitir('lateral:redesenhar');
}

export function painelAberto() { return estado.painel !== null; }
