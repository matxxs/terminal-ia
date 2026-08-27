/**
 * Bloco de anotacoes de um terminal. A anotacao pertence ao terminal, nao a uma
 * tarefa: abrir Claude na pasta X e abrir Codex na mesma pasta sao dois blocos
 * independentes. Ctrl+Shift+N abre o do terminal ativo.
 */

import {
  el, aviso, confirmar,
  formatarData, formatarHora, formatarDuracao, SITUACOES,
} from './ui.js';
import { estado, emitir } from './estado.js';
import { estadoDaAba, sessaoAtiva, abrirTerminal } from './terminais.js';
import { abrirPainel, fecharPainel } from './painel.js';

export function iniciar() {
  /* A captura automatica da tela chega pelo processo principal. */
  window.api.sessoes.aoMudar(({ ids }) => {
    if (estado.painel === 'notas' && ids.includes(estado.sessaoAnotada)) abrir(estado.sessaoAnotada);
  });
}

/** Ctrl+Shift+N: anota no terminal em que voce esta. */
export function abrirDoAtivo() {
  const sessao = sessaoAtiva();
  if (!sessao) {
    aviso('Nenhum terminal aberto. Abra um com Ctrl+Shift+T.', 'erro');
    return;
  }
  abrir(sessao.id);
}

export async function abrir(sessionId) {
  const sessao = await window.api.sessoes.obter(sessionId);
  if (!sessao) { aviso('Terminal nao encontrado.', 'erro'); return; }

  const painel = abrirPainel('notas');
  estado.sessaoAnotada = sessionId;
  estado.anotacoesPorSessao.set(sessionId, sessao.notes.length);

  const aba = estadoDaAba(sessionId);
  const situacao = !sessao.open ? 'FEC' : (!aba || !aba.vivo ? 'MOR' : (aba.ocupado ? 'AND' : 'OCI'));

  painel.append(topo(sessao, situacao));
  painel.append(corpo(sessao, situacao));

  emitir('lateral:redesenhar');
}

function topo(sessao, situacao) {
  return el('div', { class: 'pd-topo', dataset: { situacao } }, [
    /* Terminal ja encerrado so pode ter vindo do historico: da o caminho de volta. */
    sessao.open
      ? el('span', { class: 'ponto-situacao', title: SITUACOES[situacao] })
      : el('button', {
        class: 'icone', text: '‹', title: 'Voltar ao historico',
        onclick: () => emitir('historico:abrir'),
      }),
    el('div', { class: 'pd-cabecalho' }, [
      el('div', { class: 'pd-titulo', text: sessao.title }),
      el('div', { class: 'pd-subtitulo' }, [
        el('span', { class: `etiqueta si-${situacao}`, text: SITUACOES[situacao] }),
        el('span', { class: 'pd-projeto', text: sessao.NOME_PROJETO || 'sem projeto', title: sessao.CAMINHO_PROJETO || sessao.cwd }),
      ]),
    ]),
    el('button', { class: 'icone', text: '×', title: 'Fechar (Esc)', onclick: fechar }),
  ]);
}

function corpo(sessao, situacao) {
  const campo = el('textarea', {
    class: 'campo', placeholder: 'O que aconteceu neste terminal? (Ctrl+Enter para salvar)',
    style: 'min-height:62px',
  });

  const salvar = async () => {
    const texto = campo.value.trim();
    if (!texto) return;
    await window.api.sessoes.anotar(sessao.id, texto);
    campo.value = '';
    await abrir(sessao.id);
    emitir('historico:recarregar');
  };

  campo.addEventListener('keydown', (evento) => {
    evento.stopPropagation();
    if (evento.key === 'Enter' && (evento.ctrlKey || evento.metaKey)) salvar();
  });

  return el('div', { class: 'pd-corpo' }, [
    blocoIdentidade(sessao, situacao),

    el('div', {}, [
      el('div', { class: 'pd-secao-rotulo', text: 'Registrar anotacao' }),
      campo,
      el('button', { class: 'btn primario bloco', style: 'margin-top:6px', text: 'Adicionar anotacao', onclick: salvar }),
    ]),

    el('div', {}, [
      el('div', { class: 'pd-secao-rotulo', text: `Anotacoes (${sessao.notes.length})` }),
      sessao.notes.length
        ? el('div', { class: 'linha-tempo' }, sessao.notes.map((anotacao) => itemAnotacao(anotacao, sessao.id)))
        : el('div', { class: 'grupo-vazio', text: 'Nenhuma anotacao neste terminal ainda.' }),
    ]),

    sessao.last_output ? el('div', {}, [
      el('div', { class: 'pd-secao-rotulo', text: 'Onde eu parei' }),
      el('details', { class: 'captura' }, [
        el('summary', { text: `Ultima saida do terminal — ${formatarData(sessao.last_output_at)}` }),
        el('pre', { class: 'captura-corpo', text: sessao.last_output }),
      ]),
    ]) : null,

    !sessao.open ? el('button', {
      class: 'btn bloco', text: 'Reabrir um terminal aqui',
      title: `Abre ${sessao.NOME_PERFIL || 'o mesmo perfil'} em ${sessao.cwd}`,
      onclick: async () => {
        const nova = await abrirTerminal({
          projectId: sessao.project_id,
          profileId: sessao.profile_id,
          cwd: sessao.cwd,
          title: sessao.title,
        });
        if (nova) abrir(nova.id);
      },
    }) : null,
  ]);
}

function blocoIdentidade(sessao, situacao) {
  const periodo = sessao.open
    ? `aberto ${formatarHora(sessao.created_at)}`
    : `${formatarHora(sessao.created_at)}–${formatarHora(sessao.closed_at)} · ${formatarDuracao(sessao.created_at, sessao.closed_at)}`;

  return el('div', { class: 'pd-identidade' }, [
    el('div', { class: 'pd-identidade-linha' }, [
      el('span', { class: 'aba-icone', text: sessao.SIGLA_PERFIL || 'SH' }),
      el('span', { text: sessao.NOME_PERFIL || 'Shell' }),
      el('span', { class: 'pd-periodo', text: periodo }),
    ]),
    el('div', { class: 'pd-caminho', text: sessao.cwd, title: sessao.cwd }),
    situacao === 'MOR' ? el('p', { class: 'dica', text: 'O processo morreu, mas a aba continua aberta. Ctrl+Shift+R reinicia.' }) : null,
  ]);
}

function itemAnotacao(anotacao, sessionId) {
  return el('div', { class: 'anotacao' }, [
    el('div', { class: 'anotacao-corpo', text: anotacao.body }),
    el('div', { class: 'anotacao-data', text: formatarData(anotacao.created_at) }),
    el('button', {
      class: 'anotacao-remover', text: '×', title: 'Excluir anotacao',
      onclick: () => confirmar('Excluir esta anotacao?', async () => {
        await window.api.sessoes.excluirAnotacao(anotacao.id);
        await abrir(sessionId);
        emitir('historico:recarregar');
      }, 'Excluir'),
    }),
  ]);
}

const fechar = fecharPainel;
