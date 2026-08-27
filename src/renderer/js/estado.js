/** Estado compartilhado do renderer + barramento de eventos simples. */

export const estado = {
  projetos: [],
  perfis: [],
  projetoSelecionado: null,
  /* Grupo "sem projeto" selecionado na lateral (projetoSelecionado fica null nesse caso). */
  grupoAvulsoSelecionado: false,
  /* Painel da direita: 'notas' (anotacoes de um terminal) ou 'historico'. */
  painel: null,
  sessaoAnotada: null,
  historicoSessoes: [],
  filtros: { busca: '', somenteAnotadas: false },
  comandos: [],
  posicaoComando: -1,
  sessoesOcupadas: new Set(),
  abasAbertas: [],
  /* sessionId -> quantidade de anotacoes, para o selo da barra lateral. */
  anotacoesPorSessao: new Map(),
};

const ouvintes = new Map();

export function ao(evento, callback) {
  if (!ouvintes.has(evento)) ouvintes.set(evento, new Set());
  ouvintes.get(evento).add(callback);
  return () => ouvintes.get(evento).delete(callback);
}

export function emitir(evento, carga) {
  for (const callback of ouvintes.get(evento) || []) {
    try { callback(carga); } catch (erro) { console.error(`[${evento}]`, erro); }
  }
}

export const CORES = [
  '#6ea8fe', '#4ade80', '#fbbf24', '#f87171',
  '#c084fc', '#22d3ee', '#fb923c', '#a3e635',
];
