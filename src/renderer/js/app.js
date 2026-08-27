/** Ponto de entrada do renderer: liga paineis, atalhos e a barra de comando. */

import { $, el, aviso, modalAberto, fecharModal, abrirModal } from './ui.js';
import { estado, ao, emitir } from './estado.js';
import * as terminais from './terminais.js';
import * as projetos from './projetos.js';
import * as anotacoes from './anotacoes.js';
import * as historico from './historico.js';
import * as lateral from './lateral.js';
import { fecharPainel, painelAberto } from './painel.js';

async function iniciar() {
  terminais.iniciar();
  anotacoes.iniciar();
  historico.iniciar();
  await lateral.iniciar();

  await projetos.recarregarPerfis();
  await projetos.recarregar();
  await terminais.restaurarSessoes();

  ligarSidebar();
  ligarBarraComando();
  ligarAtalhos();
  ligarAtualizacao();

  const recolhida = await window.api.config.obter('sidebar.recolhida', false);
  $('#app').classList.toggle('sidebar-recolhida', Boolean(recolhida));

  ao('terminal:ativado', (sessao) => carregarComandos(sessao?.project_id ?? null));

  /* O botao de anotacoes vive na aba (barra de abas), mas quem sabe abrir o
     painel de notas e o modulo de anotacoes — evita import circular entre eles. */
  ao('terminal:notas', ({ id }) => anotacoes.abrir(id));

  /* Terminal fechado vira registro: o historico e o painel aberto precisam ver. */
  ao('terminal:encerrado', ({ id }) => {
    projetos.recarregar();
    emitir('historico:recarregar');
    if (estado.painel === 'notas' && estado.sessaoAnotada === id) anotacoes.abrir(id);
  });
}

/* -------------------------------------------------------------- sidebar */

function ligarSidebar() {
  $('#btn-recolher').addEventListener('click', alternarSidebar);
  $('#btn-novo-projeto').addEventListener('click', () => projetos.novoProjeto());
  $('#btn-perfis').addEventListener('click', () => projetos.gerenciarPerfis());
  $('#btn-historico').addEventListener('click', () => historico.abrir());
  $('#btn-nova-aba').addEventListener('click', () => abrirTerminalPadrao());
  $('#btn-novo-terminal').addEventListener('click', () => abrirTerminalPadrao());
  $('#btn-terminal-aqui').addEventListener('click', () => abrirTerminalPadrao());
  /* O botao de recolher vive dentro da propria sidebar: some junto com ela.
     Este outro fica na barra de abas, sempre alcancavel, so visivel quando
     a sidebar esta recolhida (ver #app.sidebar-recolhida no CSS). */
  $('#btn-mostrar-sidebar').addEventListener('click', () => mostrarSidebar());
}

function alternarSidebar() {
  const app = $('#app');
  app.classList.toggle('sidebar-recolhida');
  window.api.config.salvar('sidebar.recolhida', app.classList.contains('sidebar-recolhida'));
}

function mostrarSidebar() {
  $('#app').classList.remove('sidebar-recolhida');
  window.api.config.salvar('sidebar.recolhida', false);
}

async function abrirTerminalPadrao() {
  const projeto = projetos.projetoAtual();
  const perfil = estado.perfis[0];
  await terminais.abrirTerminal({
    projectId: projeto?.id ?? null,
    profileId: perfil?.id ?? null,
    cwd: projeto?.path ?? null,
    title: projeto ? `${perfil?.name || 'Shell'} — ${projeto.name}` : (perfil?.name || 'Shell'),
  });
  projetos.recarregar();
}

/* -------------------------------------------------------- barra comando */

async function carregarComandos(projectId) {
  estado.comandos = await window.api.historico.comandos(projectId, 60);
  estado.posicaoComando = -1;
}

function ligarBarraComando() {
  const formulario = $('#barra-comando');
  const entrada = $('#entrada-comando');

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const comando = entrada.value.trim();
    if (!comando) return;
    const enviado = await terminais.executarNoAtivo(comando);
    if (!enviado) return;
    entrada.value = '';
    const sessao = terminais.sessaoAtiva();
    await carregarComandos(sessao?.project_id ?? null);
  });

  entrada.addEventListener('keydown', (evento) => {
    evento.stopPropagation();

    if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (!estado.comandos.length) return;
      estado.posicaoComando = Math.min(estado.posicaoComando + 1, estado.comandos.length - 1);
      entrada.value = estado.comandos[estado.posicaoComando] || '';
      requestAnimationFrame(() => entrada.setSelectionRange(entrada.value.length, entrada.value.length));
    }

    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      estado.posicaoComando = Math.max(estado.posicaoComando - 1, -1);
      entrada.value = estado.posicaoComando === -1 ? '' : (estado.comandos[estado.posicaoComando] || '');
    }

    if (evento.key === 'Escape') {
      entrada.value = '';
      estado.posicaoComando = -1;
      terminais.focarAtivo();
    }
  });
}

/* -------------------------------------------------------------- atalhos */

function ligarAtalhos() {
  window.api.app.aoReceberAtalho((acao) => {
    if (acao === 'novo-terminal') abrirTerminalPadrao();
    if (acao === 'fechar-terminal') terminais.fecharAtivo();
    if (acao === 'novo-projeto') { mostrarSidebar(); projetos.novoProjeto(); }
    if (acao === 'anotar') anotacoes.abrirDoAtivo();
    if (acao === 'historico') historico.abrir();
    if (acao === 'alternar-sidebar') alternarSidebar();
    if (acao === 'focar-comando') $('#entrada-comando').focus();
    if (acao === 'reiniciar-terminal') terminais.reiniciarAtivo();
    if (acao === 'proximo-terminal') terminais.proximaAba(1);
    if (acao === 'terminal-anterior') terminais.proximaAba(-1);
    if (acao === 'verificar-atualizacoes') verificarAtualizacoesManual();
  });

  window.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') {
      if (modalAberto()) { fecharModal(); return; }
      if (painelAberto()) { fecharPainel(); return; }
    }

    if (!evento.ctrlKey || evento.altKey || evento.shiftKey) return;

    if (/^[1-9]$/.test(evento.key)) {
      evento.preventDefault();
      terminais.ativarPorIndice(Number(evento.key) - 1);
    }
  });

  $('#modal-fundo').addEventListener('mousedown', (evento) => {
    if (evento.target.id === 'modal-fundo') fecharModal();
  });
}

/* -------------------------------------------------------- atualizacao */

/** Checagem automatica ao abrir + a cada 4h ja roda no main; aqui so o gatilho manual do menu. */
function ligarAtualizacao() {
  window.api.atualizacao.aoFicarPronta(({ versao }) => {
    abrirModal({
      titulo: 'Atualizacao pronta',
      corpo: [el('p', {
        text: `A versao ${versao} do Terminal IA foi baixada. Reiniciar agora para instalar? Os terminais abertos sao restaurados ao voltar.`,
        style: 'line-height:1.6',
      })],
      acoes: [
        { rotulo: 'Mais tarde', aoClicar: (fechar) => fechar() },
        { rotulo: 'Reiniciar agora', classe: 'perigo', aoClicar: (fechar) => { fechar(); window.api.atualizacao.instalarAgora(); } },
      ],
    });
  });
}

async function verificarAtualizacoesManual() {
  try {
    const resultado = await window.api.atualizacao.verificar();
    if (!resultado.ativo) { aviso('Checagem de atualizacao nao disponivel neste modo (build de desenvolvimento).', 'info'); return; }
    if (resultado.temAtualizacao) aviso(`Baixando a versao ${resultado.versao} em segundo plano...`, 'ok');
    else aviso('Voce ja esta na versao mais recente.', 'ok');
  } catch (erro) {
    aviso(`Falha ao verificar atualizacoes: ${erro.message}`, 'erro', 6000);
  }
}

window.addEventListener('error', (evento) => aviso(`Erro: ${evento.message}`, 'erro', 6000));
window.addEventListener('unhandledrejection', (evento) => aviso(`Erro: ${evento.reason?.message || evento.reason}`, 'erro', 6000));

iniciar().catch((erro) => {
  console.error(erro);
  aviso(`Falha ao iniciar: ${erro.message}`, 'erro', 9000);
});
