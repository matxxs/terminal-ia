/** Gerencia as abas de terminal: xterm no renderer, PTY no processo principal. */

import { Terminal } from '../vendor/xterm.mjs';
import { FitAddon } from '../vendor/addon-fit.mjs';
import { el, $, limpar, aviso, confirmar, encurtarCaminho } from './ui.js';
import { estado, ao, emitir } from './estado.js';

const abas = new Map();          // sessionId -> { sessao, term, fit, host, aba, vivo }
let idAtivo = null;

/* A barra de abas mostra so os terminais do projeto selecionado na lateral —
   os demais continuam vivos (PTY rodando), so ficam ocultos. Cada grupo
   lembra qual foi o ultimo terminal ativo nele, pra voltar onde parou. */
const ultimoAtivoPorGrupo = new Map();   // chaveGrupo -> sessionId

function grupoDe(sessao) {
  return sessao.project_id != null ? { tipo: 'projeto', id: sessao.project_id } : { tipo: 'avulso' };
}
function chaveGrupo(grupo) {
  return grupo.tipo === 'projeto' ? `p:${grupo.id}` : 'avulso';
}
function grupoSelecionado() {
  return estado.grupoAvulsoSelecionado
    ? { tipo: 'avulso' }
    : { tipo: 'projeto', id: estado.projetoSelecionado };
}
function abasDoGrupo(chave) {
  return [...abas.values()].filter((item) => chaveGrupo(grupoDe(item.sessao)) === chave);
}

const EH_MAC = window.api.app.plataforma === 'darwin';

/**
 * Por padrao o xterm.js trata Ctrl+C como SIGINT e Ctrl+V como um caractere
 * de controle cru (SYN) em qualquer situacao, cancelando o evento — por isso
 * copiar/colar nunca funcionava, em nenhuma sessao (claude, codex, shell...).
 * Aqui a gente reassume esses atalhos: Ctrl+C copia so quando ha selecao
 * (senao cai no comportamento padrao de interromper o processo); Ctrl+V
 * sempre cola o conteudo da area de transferencia.
 */
function ligarClipboard(term, host) {
  term.attachCustomKeyEventHandler((evento) => {
    if (evento.type !== 'keydown') return true;
    const tecla = EH_MAC ? evento.metaKey : evento.ctrlKey;
    if (!tecla || evento.altKey || evento.shiftKey) return true;

    if (evento.key === 'c' || evento.key === 'C') {
      if (!term.hasSelection()) return true;
      evento.preventDefault();
      window.api.clipboard.escrever(term.getSelection());
      term.clearSelection();
      return false;
    }

    if (evento.key === 'v' || evento.key === 'V') {
      /* Sem preventDefault aqui, o navegador ainda dispara o evento nativo
         'paste' no textarea do xterm — que o proprio xterm.js escuta e usa
         pra colar sozinho — duplicando o texto colado junto com o term.paste
         manual abaixo. */
      evento.preventDefault();
      window.api.clipboard.ler().then((texto) => { if (texto) term.paste(texto); });
      return false;
    }

    return true;
  });

  /* Botao direito no padrao Windows Terminal: copia se ha selecao, cola senao. */
  host.addEventListener('contextmenu', (evento) => {
    evento.preventDefault();
    if (term.hasSelection()) {
      window.api.clipboard.escrever(term.getSelection());
      term.clearSelection();
    } else {
      window.api.clipboard.ler().then((texto) => { if (texto) term.paste(texto); });
    }
  });
}

const TEMA = {
  background: '#0e1015', foreground: '#dfe3ec', cursor: '#6ea8fe', cursorAccent: '#0e1015',
  selectionBackground: 'rgba(110,168,254,.30)',
  black: '#1c202b', red: '#f87171', green: '#4ade80', yellow: '#fbbf24',
  blue: '#6ea8fe', magenta: '#c084fc', cyan: '#22d3ee', white: '#dfe3ec',
  brightBlack: '#5b6478', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fcd34d',
  brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#ffffff',
};

export function iniciar() {
  window.api.term.aoReceberDados(({ id, data }) => {
    /* O ack fecha o laco de contrapressao do main (pty-manager.js): sem ele,
       uma sessao pausada por excesso de saida nunca seria retomada. Precisa
       ir mesmo se a aba ja foi fechada, senao o PTY fica pausado pra sempre. */
    const confirmar = () => window.api.term.dadosRecebidos(id, new Blob([data]).size);
    const item = abas.get(id);
    if (!item) { confirmar(); return; }
    item.term.write(data, confirmar);
  });

  window.api.term.aoEncerrar(({ id, exitCode }) => {
    const item = abas.get(id);
    if (!item) return;
    item.vivo = false;
    item.aba.classList.add('morta');
    atualizarSituacaoAba(item);
    item.term.write(`\r\n\x1b[90m\u2014 processo encerrado (codigo ${exitCode}). Ctrl+Shift+R reinicia esta aba. \u2014\x1b[0m\r\n`);
    atualizarInfo();
    emitir('terminais:alterados');
  });

  window.api.term.aoMudarAtividade(({ id, ocupado }) => {
    const item = abas.get(id);
    if (!item) return;
    item.ocupado = ocupado;
    atualizarSituacaoAba(item);
    if (id === idAtivo) atualizarInfo();
    emitir('terminal:atividade', { id, ocupado });
  });

  ao('projeto:selecionado', aplicarFiltroGrupo);
  ao('lateral:redesenhar', atualizarNotasNasAbas);

  window.addEventListener('resize', agendarAjuste);

  const observador = new ResizeObserver(agendarAjuste);
  observador.observe($('#terminais'));

  /* As colunas do grid tem transicao; so no fim dela a largura e a definitiva. */
  $('#app').addEventListener('transitionend', (evento) => {
    if (evento.propertyName === 'grid-template-columns') agendarAjuste();
  });
}

/**
 * O reencaixe espera o layout assentar: a coluna do grid tem transicao e o
 * ResizeObserver dispara em cada quadro dela. Ajustar no meio da animacao
 * calcularia as colunas do xterm com uma largura intermediaria.
 */
let temporizadorAjuste = null;

function agendarAjuste() {
  clearTimeout(temporizadorAjuste);
  /* setTimeout, nao requestAnimationFrame: rAF nao dispara com a janela
     minimizada ou oculta, e o terminal ficaria com o tamanho antigo ao voltar. */
  temporizadorAjuste = setTimeout(() => ajustar(idAtivo), 90);
}

/** Reencaixa a aba ativa imediatamente. */
export function reajustar() { ajustar(idAtivo); }

/* --------------------------------------------------------- ciclo de vida */

export async function abrirTerminal({ projectId = null, profileId = null, cwd = null, title = null }) {
  try {
    const sessao = await window.api.term.abrir({ projectId, profileId, cwd, title, cols: 100, rows: 30 });
    montarAba(sessao);
    ativar(sessao.id);
    return sessao;
  } catch (erro) {
    aviso(`Nao foi possivel abrir o terminal: ${erro.message}`, 'erro');
    return null;
  }
}

export async function restaurarSessoes() {
  const sessoes = await window.api.term.listarSessoes();
  for (const sessao of sessoes) {
    try {
      const viva = await window.api.term.reconectar({ sessionId: sessao.id, cols: 100, rows: 30 });
      montarAba({ ...sessao, ...viva });
    } catch {
      await window.api.term.fechar(sessao.id);
    }
  }
  if (sessoes.length) ativar(sessoes[0].id);
  atualizarVazio();
}

function montarAba(sessao) {
  const host = el('div', { class: 'host-terminal', dataset: { id: sessao.id } });
  $('#terminais').append(host);

  const term = new Terminal({
    fontFamily: "'Cascadia Mono', 'Consolas', monospace",
    fontSize: 13,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 12000,
    allowProposedApi: true,
    theme: TEMA,
    windowsPty: { backend: 'conpty' },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  ligarClipboard(term, host);

  term.onData((dados) => window.api.term.escrever(sessao.id, dados));
  term.onResize(({ cols, rows }) => window.api.term.redimensionar(sessao.id, cols, rows));
  term.onTitleChange((titulo) => {
    const item = abas.get(sessao.id);
    if (item) item.tituloProcesso = titulo;
    if (sessao.id === idAtivo) atualizarInfo();
  });

  const aba = criarAba(sessao);
  $('#abas-terminais').append(aba);

  abas.set(sessao.id, { sessao, term, fit, host, aba, vivo: true, ocupado: false, tituloProcesso: '' });
  estado.anotacoesPorSessao.set(sessao.id, sessao.QUANTIDADE_ANOTACOES || 0);
  atualizarSeloAnotacoes(sessao.id);
  aplicarFiltroGrupo();
  atualizarVazio();
  emitir('terminais:alterados');
}

function criarAba(sessao) {
  const perfil = estado.perfis.find((per) => per.id === sessao.profile_id);
  const aba = el('div', {
    class: 'aba-terminal',
    dataset: { id: sessao.id, situacao: 'OCI' },
    title: sessao.cwd,
    onclick: (evento) => { if (!evento.target.closest('button')) ativar(sessao.id); },
    onauxclick: (evento) => { if (evento.button === 1) fecharTerminal(sessao.id); },
    ondblclick: (evento) => { if (!evento.target.closest('button')) renomear(sessao.id); },
  }, [
    el('span', { class: 'ponto-situacao' }),
    el('span', { class: 'aba-icone', text: sessao.SIGLA_PERFIL || perfil?.icon || 'SH' }),
    el('span', { class: 'aba-rotulo', text: sessao.title }),
    el('span', { class: 'selo-anotacoes oculto' }),
    el('button', {
      class: 'terminal-acao', text: '\u270e', title: 'Anotacoes deste terminal (Ctrl+Shift+N)',
      onclick: (evento) => { evento.stopPropagation(); emitir('terminal:notas', { id: sessao.id }); },
    }),
    el('button', {
      class: 'aba-fechar',
      title: 'Fechar (Ctrl+Shift+W)',
      text: '\u00d7',
      onclick: (evento) => { evento.stopPropagation(); fecharTerminal(sessao.id); },
    }),
  ]);
  return aba;
}

/** Situacao (cor do ponto) refletindo se o processo esta vivo/ocupado. */
function atualizarSituacaoAba(item) {
  item.aba.dataset.situacao = !item.vivo ? 'MOR' : (item.ocupado ? 'AND' : 'OCI');
}

function atualizarSeloAnotacoes(id) {
  const item = abas.get(id);
  if (!item) return;
  const selo = item.aba.querySelector('.selo-anotacoes');
  const total = estado.anotacoesPorSessao.get(id) || 0;
  selo.textContent = total ? `\u270e${total}` : '';
  selo.classList.toggle('oculto', !total);
}

/** Selo de anotacoes + destaque da aba cujo bloco de notas esta aberto agora. */
function atualizarNotasNasAbas() {
  for (const [id, item] of abas) {
    atualizarSeloAnotacoes(id);
    item.aba.classList.toggle('anotando', estado.sessaoAnotada === id);
  }
}

export function ativar(id) {
  const item = abas.get(id);
  if (!item) return;
  for (const [chave, outro] of abas) {
    const atual = chave === id;
    outro.host.classList.toggle('ativo', atual);
    outro.aba.classList.toggle('ativa', atual);
  }
  idAtivo = id;

  const grupo = grupoDe(item.sessao);
  const chave = chaveGrupo(grupo);
  ultimoAtivoPorGrupo.set(chave, id);

  /* Ativar um terminal de outro grupo (reabrir pelo historico, atalho, etc.)
     leva a selecao da lateral junto — senao a barra de abas mostraria um
     terminal que a lateral diz nao estar selecionado. */
  if (chave !== chaveGrupo(grupoSelecionado())) {
    estado.projetoSelecionado = grupo.tipo === 'projeto' ? grupo.id : null;
    estado.grupoAvulsoSelecionado = grupo.tipo === 'avulso';
    emitir('projeto:selecionado', grupo);
  }

  item.aba.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  setTimeout(() => { ajustar(id); item.term.focus(); }, 0);
  atualizarInfo();
  atualizarVazio();
  emitir('terminal:ativado', item.sessao);
}

/**
 * Mostra/esconde as abas conforme o grupo selecionado na lateral. Os
 * terminais fora do grupo continuam com o PTY rodando — so ficam ocultos.
 */
function aplicarFiltroGrupo() {
  const chave = chaveGrupo(grupoSelecionado());
  let ativoNoGrupo = false;

  for (const item of abas.values()) {
    const pertence = chaveGrupo(grupoDe(item.sessao)) === chave;
    item.aba.classList.toggle('oculto', !pertence);
    if (pertence && item.sessao.id === idAtivo) ativoNoGrupo = true;
  }

  if (!ativoNoGrupo) {
    const doGrupo = abasDoGrupo(chave);
    const ultimo = ultimoAtivoPorGrupo.get(chave);
    const escolhido = doGrupo.find((item) => item.sessao.id === ultimo) || doGrupo[doGrupo.length - 1];
    if (escolhido) { ativar(escolhido.sessao.id); return; }

    /* Grupo selecionado sem nenhum terminal aberto: limpa o que estava visivel. */
    for (const item of abas.values()) { item.host.classList.remove('ativo'); item.aba.classList.remove('ativa'); }
    idAtivo = null;
    atualizarInfo();
  }
  atualizarVazio();
}

/** Fechar a aba e o que move o terminal (e suas anotacoes) para o historico. */
export async function fecharTerminal(id) {
  const item = abas.get(id);
  if (!item) return;
  await window.api.term.fechar(id);
  item.term.dispose();
  item.host.remove();
  item.aba.remove();
  abas.delete(id);

  if (idAtivo === id) {
    idAtivo = null;
    /* Fechar a aba ativa nao troca de pasta: prefere outro terminal do mesmo
       grupo e, se nao houver, deixa a barra de abas vazia nessa pasta. */
    const chave = chaveGrupo(grupoSelecionado());
    if (ultimoAtivoPorGrupo.get(chave) === id) ultimoAtivoPorGrupo.delete(chave);
    const restantes = abasDoGrupo(chave);
    const ultimo = ultimoAtivoPorGrupo.get(chave);
    const proximo = restantes.find((item) => item.sessao.id === ultimo) || restantes[restantes.length - 1];
    if (proximo) ativar(proximo.sessao.id);
    else atualizarInfo();
  }
  atualizarVazio();
  emitir('terminais:alterados');
  emitir('terminal:encerrado', { id });
}

export async function reiniciarAtivo() {
  const item = abas.get(idAtivo);
  if (!item) return;
  try {
    const viva = await window.api.term.reconectar({ sessionId: item.sessao.id, cols: 100, rows: 30 });
    item.vivo = true;
    item.aba.classList.remove('morta');
    atualizarSituacaoAba(item);
    item.term.reset();
    item.sessao = { ...item.sessao, ...viva };
    aviso('Terminal reiniciado.', 'ok');
    atualizarInfo();
  } catch (erro) {
    aviso(`Falha ao reiniciar: ${erro.message}`, 'erro');
  }
}

export function fecharAtivo() {
  if (!idAtivo) return;
  const item = abas.get(idAtivo);
  if (item?.vivo) {
    confirmar(`Encerrar o terminal "${item.sessao.title}"? O processo em execucao sera finalizado.`,
      () => fecharTerminal(item.sessao.id), 'Encerrar');
    return;
  }
  fecharTerminal(idAtivo);
}

function renomear(id) {
  const item = abas.get(id);
  if (!item) return;
  const rotulo = item.aba.querySelector('.aba-rotulo');
  const campo = el('input', { class: 'campo', value: item.sessao.title, style: 'width:150px;padding:2px 5px' });
  rotulo.replaceWith(campo);
  campo.focus();
  campo.select();

  const encerrar = async (salvar) => {
    const titulo = salvar && campo.value.trim() ? campo.value.trim() : item.sessao.title;
    item.sessao.title = titulo;
    const novo = el('span', { class: 'aba-rotulo', text: titulo });
    campo.replaceWith(novo);
    if (salvar) await window.api.term.renomear(id, titulo);
  };
  campo.addEventListener('blur', () => encerrar(true));
  campo.addEventListener('keydown', (evento) => {
    evento.stopPropagation();
    if (evento.key === 'Enter') encerrar(true);
    if (evento.key === 'Escape') encerrar(false);
  });
}

/* ------------------------------------------------------------- comandos */

export async function executarNoAtivo(comando) {
  const item = abas.get(idAtivo);
  if (!item) { aviso('Nenhum terminal aberto. Abra um com Ctrl+Shift+T.', 'erro'); return false; }
  if (!item.vivo) { aviso('O terminal esta encerrado. Use Ctrl+Shift+R para reinicia-lo.', 'erro'); return false; }
  await window.api.term.executar(item.sessao.id, comando, item.sessao.project_id ?? null);
  item.term.focus();
  return true;
}

/** Terminais abertos, para a barra lateral listar os de cada projeto. */
export function listarAbas() {
  return [...abas.entries()].map(([id, item]) => ({
    id,
    title: item.sessao.title,
    cwd: item.sessao.cwd,
    projectId: item.sessao.project_id ?? null,
    icone: item.sessao.SIGLA_PERFIL
      || estado.perfis.find((per) => per.id === item.sessao.profile_id)?.icon
      || 'SH',
    vivo: item.vivo,
    ocupado: Boolean(item.ocupado),
    ativa: id === idAtivo,
    anotacoes: estado.anotacoesPorSessao.get(id) || 0,
  }));
}

/** Situacao da aba de um terminal, ou null se ele nao esta mais aberto. */
export function estadoDaAba(id) {
  const item = abas.get(id);
  if (!item) return null;
  return { vivo: item.vivo, ocupado: Boolean(item.ocupado), ativa: id === idAtivo };
}

export function sessaoAtiva() { return abas.get(idAtivo)?.sessao || null; }
export function totalAbas() { return abas.size; }
export function focarAtivo() { abas.get(idAtivo)?.term.focus(); }

/** Ctrl+Tab e Ctrl+1..9 navegam so entre as abas visiveis (do grupo selecionado). */
export function proximaAba(passo = 1) {
  const ids = abasDoGrupo(chaveGrupo(grupoSelecionado())).map((item) => item.sessao.id);
  if (ids.length < 2) return;
  const atual = ids.indexOf(idAtivo);
  ativar(ids[(atual + passo + ids.length) % ids.length]);
}

export function ativarPorIndice(indice) {
  const ids = abasDoGrupo(chaveGrupo(grupoSelecionado())).map((item) => item.sessao.id);
  if (ids[indice]) ativar(ids[indice]);
}

/* -------------------------------------------------------------- suporte */

function ajustar(id, tentativa = 0) {
  const item = abas.get(id);
  if (!item || !item.host.classList.contains('ativo')) return;
  try {
    item.fit.fit();
    window.api.term.redimensionar(id, item.term.cols, item.term.rows);
  } catch { /* aba ainda sem layout */ return; }

  /* Se o encaixe saiu maior que o host, o layout ainda estava mudando: refaz. */
  const tela = item.host.querySelector('.xterm-screen');
  const sobrou = tela && tela.getBoundingClientRect().width > item.host.clientWidth + 1;
  if (sobrou && tentativa < 4) {
    setTimeout(() => ajustar(id, tentativa + 1), 60);
  }
}

async function atualizarInfo() {
  const item = abas.get(idAtivo);
  const alvo = $('#info-sessao');
  if (!item) { alvo.textContent = ''; return; }

  const partes = [encurtarCaminho(item.sessao.cwd, 42)];
  if (item.vivo) {
    const info = await window.api.term.estado(item.sessao.id);
    if (info.pid) partes.push(`pid ${info.pid}`);
    partes.push(info.ocupado ? 'trabalhando' : 'ocioso');
  } else {
    partes.push('[encerrado]');
  }
  if (abas.get(idAtivo) !== item) return;

  alvo.textContent = partes.join('  ·  ');
  alvo.title = `${item.sessao.cwd}\n${item.tituloProcesso || ''}`;
  $('#entrada-comando').placeholder = item.vivo
    ? `Comando em ${encurtarCaminho(item.sessao.cwd, 48)}`
    : 'Terminal encerrado \u2014 Ctrl+Shift+R para reiniciar';
}

/** Nome mostrado no estado vazio de uma pasta selecionada sem terminal aberto. */
function nomeDoGrupoSelecionado() {
  const grupo = grupoSelecionado();
  if (grupo.tipo === 'avulso') return 'sem projeto';
  return estado.projetos.find((projeto) => projeto.id === grupo.id)?.name || 'esta pasta';
}

function atualizarVazio() {
  const nada = abas.size === 0;
  $('#boas-vindas').classList.toggle('oculto', !nada);

  const pastaVazia = $('#pasta-vazia');
  if (!pastaVazia) return;
  const vazioNoGrupo = !nada && !abasDoGrupo(chaveGrupo(grupoSelecionado())).length;
  pastaVazia.classList.toggle('oculto', !vazioNoGrupo);
  if (vazioNoGrupo) {
    $('#pasta-vazia-texto').textContent = `Nenhum terminal aberto em "${nomeDoGrupoSelecionado()}" agora.`;
  }
}

export function reordenarPersistido() {
  window.api.term.reordenar([...abas.keys()]);
}

