/**
 * Historico do trabalho: os terminais ja encerrados. Terminal aberto vive na
 * barra lateral; ele so entra aqui quando voce fecha a aba. Todos ficam
 * registrados, mas os que receberam anotacao sao os que contam como trabalho
 * feito — por isso vem destacados e ha um filtro para isolar so eles.
 */

import {
  el, limpar, aviso, confirmar,
  formatarHora, formatarDuracao, rotuloDoDia, chaveDoDia, encurtarCaminho,
} from './ui.js';
import { estado, ao, emitir } from './estado.js';
import { abrirPainel, fecharPainel } from './painel.js';
import { abrir as abrirNotas } from './anotacoes.js';

let areaLista = null;

export function iniciar() {
  ao('historico:abrir', abrir);
  ao('historico:recarregar', () => { if (estado.painel === 'historico') recarregar(); });
  window.api.historico.aoMudar(() => { if (estado.painel === 'historico') recarregar(); });
}

export async function abrir() {
  const painel = abrirPainel('historico');

  const busca = el('input', {
    class: 'campo', type: 'search', placeholder: 'Buscar por terminal, pasta ou anotacao...',
    value: estado.filtros.busca,
  });
  busca.addEventListener('input', () => {
    estado.filtros.busca = busca.value.trim();
    recarregar();
  });
  busca.addEventListener('keydown', (evento) => evento.stopPropagation());

  const somenteAnotadas = el('input', { type: 'checkbox' });
  somenteAnotadas.checked = estado.filtros.somenteAnotadas;
  somenteAnotadas.addEventListener('change', () => {
    estado.filtros.somenteAnotadas = somenteAnotadas.checked;
    recarregar();
  });

  painel.append(el('div', { class: 'pd-topo' }, [
    el('div', { class: 'pd-cabecalho' }, [
      el('div', { class: 'pd-titulo', text: 'Historico' }),
      el('div', { class: 'pd-subtitulo' }, [
        el('span', { class: 'pd-projeto', text: 'terminais que voce abriu e fechou' }),
      ]),
    ]),
    el('button', { class: 'icone', text: '×', title: 'Fechar (Esc)', onclick: fecharPainel }),
  ]));

  areaLista = el('div', { class: 'hist-lista' });

  painel.append(el('div', { class: 'pd-corpo' }, [
    busca,
    el('label', { class: 'linha-check' }, [
      somenteAnotadas,
      el('span', { text: 'Esconder terminais sem anotacao' }),
    ]),
    areaLista,
  ]));

  await recarregar();
}

async function recarregar() {
  estado.historicoSessoes = await window.api.historico.sessoes({
    busca: estado.filtros.busca || undefined,
    somenteAnotadas: estado.filtros.somenteAnotadas,
    limite: 200,
  });
  desenharLista();
}

function desenharLista() {
  if (!areaLista) return;
  limpar(areaLista);

  if (!estado.historicoSessoes.length) {
    areaLista.append(el('div', { class: 'vazio', text: estado.filtros.busca || estado.filtros.somenteAnotadas
      ? 'Nenhum terminal encerrado neste filtro.'
      : 'Nada aqui ainda. Feche um terminal e ele aparece neste historico.' }));
    return;
  }

  let diaAtual = null;
  for (const sessao of estado.historicoSessoes) {
    const referencia = sessao.closed_at || sessao.last_active_at || sessao.created_at;
    const dia = chaveDoDia(referencia);
    if (dia !== diaAtual) {
      diaAtual = dia;
      areaLista.append(el('div', { class: 'hist-dia', text: rotuloDoDia(referencia) }));
    }
    areaLista.append(itemHistorico(sessao));
  }
}

function itemHistorico(sessao) {
  const anotado = sessao.QUANTIDADE_ANOTACOES > 0;
  const periodo = `${formatarHora(sessao.created_at)}–${formatarHora(sessao.closed_at)}`;

  return el('div', {
    class: `hist-item${anotado ? ' anotado' : ''}`,
    title: sessao.cwd,
    onclick: (evento) => { if (!evento.target.closest('button')) abrirNotas(sessao.id); },
  }, [
    el('div', { class: 'hist-linha' }, [
      el('span', { class: 'hist-marca', text: anotado ? '✓' : '·' }),
      el('span', { class: 'aba-icone', text: sessao.SIGLA_PERFIL || 'SH' }),
      el('span', { class: 'hist-titulo', text: sessao.title }),
      anotado ? el('span', { class: 'selo', text: `✎${sessao.QUANTIDADE_ANOTACOES}` }) : null,
      el('button', {
        class: 'hist-remover', text: '×', title: 'Remover do historico',
        onclick: () => confirmar(
          `Remover "${sessao.title}" do historico? As anotacoes dele tambem serao apagadas.`,
          async () => {
            await window.api.sessoes.excluir(sessao.id);
            if (estado.sessaoAnotada === sessao.id) fecharPainel();
            await recarregar();
            emitir('lateral:redesenhar');
            aviso('Removido do historico.', 'ok');
          }, 'Remover'),
      }),
    ]),
    el('div', { class: 'hist-meta' }, [
      el('span', { text: sessao.NOME_PROJETO || encurtarCaminho(sessao.cwd, 24) }),
      el('span', { text: periodo }),
      el('span', { text: formatarDuracao(sessao.created_at, sessao.closed_at) }),
    ]),
    sessao.ULTIMA_ANOTACAO
      ? el('div', { class: 'hist-nota', text: sessao.ULTIMA_ANOTACAO })
      : null,
  ]);
}
