/**
 * Barra lateral: cada projeto e uma linha unica, selecionavel. Selecionar um
 * projeto filtra a barra de abas (top bar) para mostrar so os terminais dele
 * — a lista de terminais abertos nao aparece mais aqui, pra nao empilhar uma
 * linha por terminal quando ha varios abertos na mesma pasta.
 */

import { el, $, limpar, encurtarCaminho, SITUACOES } from './ui.js';
import { estado, ao } from './estado.js';
import { menuProjeto, selecionar, selecionarAvulso } from './projetos.js';
import { listarAbas } from './terminais.js';

export async function iniciar() {
  ao('lateral:redesenhar', sincronizar);
  ao('terminais:alterados', sincronizar);
  ao('terminal:atividade', sincronizar);
  ao('terminal:ativado', sincronizar);
  ao('projeto:selecionado', sincronizar);
}

function sincronizar() {
  estado.abasAbertas = listarAbas();
  desenhar();
}

export function desenhar() {
  const lista = $('#lista-lateral');
  if (!lista) return;
  limpar(lista);

  desenharResumo();

  const avulsos = estado.abasAbertas.filter((aba) => !aba.projectId);
  if (!estado.projetos.length && !avulsos.length) {
    lista.append(el('div', { class: 'vazio' }, [
      'Nada por aqui ainda.', el('br'),
      'Comece adicionando a pasta de um projeto.',
    ]));
    return;
  }

  for (const projeto of estado.projetos) lista.append(grupoProjeto(projeto));
  /* "sem projeto" so aparece quando tem terminal nela ou ela esta selecionada
     — senao vira uma linha vazia permanente sem nenhum terminal por tras. */
  if (avulsos.length || estado.grupoAvulsoSelecionado) lista.append(grupoAvulso(avulsos));
}

/** A cor do projeto comunica o que os terminais dele estao fazendo. */
function situacaoDoGrupo(terminais) {
  if (!terminais.length) return '';
  if (terminais.some((ter) => ter.vivo && ter.ocupado)) return 'AND';
  if (terminais.some((ter) => ter.vivo)) return 'OCI';
  return 'MOR';
}

/* ---------------------------------------------------------------- grupos */

function grupoProjeto(projeto) {
  const terminais = estado.abasAbertas.filter((aba) => aba.projectId === projeto.id);
  const situacao = situacaoDoGrupo(terminais);
  const selecionado = !estado.grupoAvulsoSelecionado && estado.projetoSelecionado === projeto.id;

  const grupo = el('div', { class: 'grupo', dataset: { id: projeto.id, situacao } });

  grupo.append(el('div', {
    class: `grupo-cabecalho${selecionado ? ' selecionado' : ''}`,
    title: `${projeto.path}\nClique para ver os terminais desta pasta na barra de abas`,
    onclick: (evento) => { if (!evento.target.closest('button')) selecionar(projeto.id); },
    oncontextmenu: (evento) => { evento.preventDefault(); menuProjeto(projeto); },
  }, [
    el('span', { class: 'grupo-cor', title: situacao ? SITUACOES[situacao] : 'Nenhum terminal aberto' }),
    el('div', { class: 'grupo-textos' }, [
      el('div', { class: 'grupo-nome', text: projeto.name }),
      el('div', { class: 'grupo-caminho', text: encurtarCaminho(projeto.path, 32) }),
    ]),
    terminais.length
      ? el('span', { class: 'selo', text: String(terminais.length), title: 'Terminais abertos' })
      : null,
    el('button', {
      class: 'icone', text: '⋯', title: 'Opcoes do projeto (abrir terminal, editar, remover)',
      onclick: (evento) => { evento.stopPropagation(); menuProjeto(projeto); },
    }),
  ]));

  return grupo;
}

function grupoAvulso(terminais) {
  const situacao = situacaoDoGrupo(terminais);
  const selecionado = estado.grupoAvulsoSelecionado;

  const grupo = el('div', { class: 'grupo', dataset: { situacao } });

  grupo.append(el('div', {
    class: `grupo-cabecalho${selecionado ? ' selecionado' : ''}`,
    title: 'Terminais abertos fora de qualquer pasta cadastrada. Clique para ve-los na barra de abas',
    onclick: () => selecionarAvulso(),
  }, [
    el('span', { class: 'grupo-cor', title: situacao ? SITUACOES[situacao] : 'Nenhum terminal aberto' }),
    el('div', { class: 'grupo-textos' }, [el('div', { class: 'grupo-nome', text: 'sem projeto' })]),
    terminais.length
      ? el('span', { class: 'selo', text: String(terminais.length), title: 'Terminais abertos' })
      : null,
  ]));

  return grupo;
}

/* --------------------------------------------------------------- resumo */

function desenharResumo() {
  const alvo = $('#resumo-terminais');
  if (!alvo) return;
  limpar(alvo);

  const abertos = estado.abasAbertas.length;
  if (!abertos) return;

  const trabalhando = estado.abasAbertas.filter((aba) => aba.vivo && aba.ocupado).length;
  const mortos = estado.abasAbertas.filter((aba) => !aba.vivo).length;

  alvo.append(el('span', { text: `${abertos} terminal${abertos > 1 ? 'is' : ''} aberto${abertos > 1 ? 's' : ''}` }));
  if (trabalhando) alvo.append(el('span', { class: 'resumo-forte', text: `${trabalhando} trabalhando` }));
  if (mortos) alvo.append(el('span', { class: 'resumo-morto', text: `${mortos} encerrado${mortos > 1 ? 's' : ''}` }));
}
