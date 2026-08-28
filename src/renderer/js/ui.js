/** Utilitarios de UI: criacao de elementos, avisos, modais e formatacao. */

export function el(tag, props = {}, filhos = []) {
  const nodo = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (chave === 'class') nodo.className = valor;
    else if (chave === 'text') nodo.textContent = valor;
    else if (chave === 'html') nodo.innerHTML = valor;
    else if (chave === 'dataset') Object.assign(nodo.dataset, valor);
    else if (chave.startsWith('on') && typeof valor === 'function') nodo.addEventListener(chave.slice(2), valor);
    else nodo.setAttribute(chave, valor === true ? '' : valor);
  }
  for (const filho of [].concat(filhos)) {
    if (filho === null || filho === undefined || filho === false) continue;
    nodo.append(typeof filho === 'string' ? document.createTextNode(filho) : filho);
  }
  return nodo;
}

export function $(seletor, raiz = document) { return raiz.querySelector(seletor); }
export function $$(seletor, raiz = document) { return [...raiz.querySelectorAll(seletor)]; }

export function limpar(nodo) { while (nodo.firstChild) nodo.firstChild.remove(); }

/* --------------------------------------------------------------- avisos */

export function aviso(mensagem, tipo = 'info', ms = 3200) {
  const caixa = el('div', { class: `aviso ${tipo}`, text: mensagem });
  $('#avisos').append(caixa);
  setTimeout(() => {
    caixa.style.transition = 'opacity .25s';
    caixa.style.opacity = '0';
    setTimeout(() => caixa.remove(), 260);
  }, ms);
}

/**
 * Como aviso(), mas nao some sozinho — pra progresso de algo em andamento
 * (ex.: download de atualizacao), onde quem chamou controla quando termina.
 */
export function progressoAviso(mensagem) {
  const texto = el('div', { text: mensagem });
  const barraPreenchimento = el('div', { class: 'aviso-barra-fill' });
  const caixa = el('div', { class: 'aviso info' }, [
    texto,
    el('div', { class: 'aviso-barra' }, [barraPreenchimento]),
  ]);
  $('#avisos').append(caixa);

  return {
    atualizar(percent) { barraPreenchimento.style.width = `${Math.max(0, Math.min(100, percent))}%`; },
    remover() {
      caixa.style.transition = 'opacity .25s';
      caixa.style.opacity = '0';
      setTimeout(() => caixa.remove(), 260);
    },
  };
}

/* --------------------------------------------------------------- modais */

let fecharAtual = null;

export function abrirModal({ titulo, corpo, acoes = [], aoAbrir }) {
  const fundo = $('#modal-fundo');
  const modal = $('#modal');
  limpar(modal);

  modal.append(el('div', { class: 'modal-topo', text: titulo }));
  const areaCorpo = el('div', { class: 'modal-corpo' }, corpo);
  modal.append(areaCorpo);

  /* Sem acoes (ex.: tela de "atualizando..."), nao ha o que por num rodape —
     desenha-lo vazio deixaria uma barra sobrando embaixo do modal. */
  if (acoes.length) {
    const rodape = el('div', { class: 'modal-rodape' });
    for (const acao of acoes) {
      rodape.append(el('button', {
        class: `btn ${acao.classe || ''}`,
        text: acao.rotulo,
        onclick: () => acao.aoClicar?.(fecharModal),
      }));
    }
    modal.append(rodape);
  }

  fundo.classList.remove('oculto');
  fecharAtual = fecharModal;
  aoAbrir?.(areaCorpo);

  const primeiro = modal.querySelector('input, textarea, select');
  primeiro?.focus();
  primeiro?.select?.();
}

export function fecharModal() {
  $('#modal-fundo').classList.add('oculto');
  limpar($('#modal'));
  fecharAtual = null;
}

export function modalAberto() { return fecharAtual !== null; }

export function confirmar(mensagem, aoConfirmar, rotuloConfirmar = 'Confirmar') {
  abrirModal({
    titulo: 'Confirmacao',
    corpo: [el('p', { text: mensagem, style: 'line-height:1.6' })],
    acoes: [
      { rotulo: 'Cancelar', aoClicar: (fechar) => fechar() },
      { rotulo: rotuloConfirmar, classe: 'perigo', aoClicar: (fechar) => { fechar(); aoConfirmar(); } },
    ],
  });
}

/* ---------------------------------------------------------- formatacao */

/** Situacao de um terminal: e o que a cor da barra lateral comunica. */
export const SITUACOES = {
  AND: 'IA trabalhando agora',
  OCI: 'Terminal ocioso',
  MOR: 'Processo encerrado',
  FEC: 'Encerrado — no historico',
};

export function formatarData(iso) {
  if (!iso) return '';
  const data = new Date(iso);
  return data.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function formatarHora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Quanto tempo o terminal ficou aberto, no formato curto do historico. */
export function formatarDuracao(inicio, fim) {
  if (!inicio || !fim) return '';
  const minutos = Math.max(0, Math.round((new Date(fim) - new Date(inicio)) / 60000));
  if (minutos < 1) return 'menos de 1 min';
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas}h${String(resto).padStart(2, '0')}` : `${horas}h`;
}

/** Cabecalho de grupo do historico: "hoje", "ontem" ou a data. */
export function rotuloDoDia(iso) {
  if (!iso) return 'sem data';
  const data = new Date(iso);
  const dia = (valor) => new Date(valor.getFullYear(), valor.getMonth(), valor.getDate()).getTime();
  const diferenca = (dia(new Date()) - dia(data)) / 86400000;
  if (diferenca === 0) return 'hoje';
  if (diferenca === 1) return 'ontem';
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function chaveDoDia(iso) {
  if (!iso) return '';
  const data = new Date(iso);
  return `${data.getFullYear()}-${data.getMonth()}-${data.getDate()}`;
}

export function tempoRelativo(iso) {
  if (!iso) return '';
  const diferenca = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diferenca < 60) return 'agora';
  if (diferenca < 3600) return `${Math.floor(diferenca / 60)} min atras`;
  if (diferenca < 86400) return `${Math.floor(diferenca / 3600)} h atras`;
  if (diferenca < 604800) return `${Math.floor(diferenca / 86400)} d atras`;
  return formatarData(iso);
}

export function encurtarCaminho(caminho, limite = 40) {
  if (!caminho || caminho.length <= limite) return caminho || '';
  return `...${caminho.slice(-(limite - 3))}`;
}
