/** Painel de projetos: cadastro de pastas e lancamento de terminais. */

import { el, $, limpar, aviso, confirmar, abrirModal, fecharModal } from './ui.js';
import { estado, emitir, CORES } from './estado.js';
import { abrirTerminal } from './terminais.js';

export async function recarregar() {
  estado.projetos = await window.api.projetos.listar();
  emitir('projetos:alterados', estado.projetos);
  emitir('lateral:redesenhar');
}

export async function recarregarPerfis() {
  estado.perfis = await window.api.perfis.listar();
  emitir('lateral:redesenhar');
}

const desenhar = () => emitir('lateral:redesenhar');

/** Abre um terminal na pasta do projeto com o perfil escolhido. */
export async function lancar(projeto, perfil) {
  const valida = await window.api.projetos.validarPasta(projeto.path);
  if (!valida) {
    aviso(`A pasta "${projeto.path}" nao existe mais.`, 'erro');
    return;
  }
  estado.projetoSelecionado = projeto.id;
  estado.grupoAvulsoSelecionado = false;
  await abrirTerminal({
    projectId: projeto.id,
    profileId: perfil.id,
    cwd: projeto.path,
    title: `${perfil.name} — ${projeto.name}`,
  });
  emitir('projeto:selecionado', { tipo: 'projeto', id: projeto.id });
  await recarregar();
}

/** Seleciona um projeto na lateral: a barra de abas passa a mostrar so os terminais dele. */
export function selecionar(id) {
  estado.projetoSelecionado = id;
  estado.grupoAvulsoSelecionado = false;
  desenhar();
  emitir('projeto:selecionado', { tipo: 'projeto', id });
}

/** Seleciona o grupo "sem projeto": terminais abertos fora de qualquer pasta cadastrada. */
export function selecionarAvulso() {
  estado.projetoSelecionado = null;
  estado.grupoAvulsoSelecionado = true;
  desenhar();
  emitir('projeto:selecionado', { tipo: 'avulso' });
}

export function projetoAtual() {
  return estado.projetos.find((pro) => pro.id === estado.projetoSelecionado) || null;
}

/* ------------------------------------------------------------- cadastro */

export async function novoProjeto() {
  const escolha = await window.api.projetos.escolherPasta();
  if (!escolha) return;
  formularioProjeto({ name: escolha.name, path: escolha.path, color: CORES[estado.projetos.length % CORES.length] });
}

function formularioProjeto(projeto) {
  const edicao = Boolean(projeto.id);
  const cor = projeto.color || CORES[0];

  const campoNome = el('input', { class: 'campo', value: projeto.name || '', placeholder: 'Nome do projeto' });
  const campoCaminho = el('input', { class: 'campo', value: projeto.path || '', readonly: true });

  abrirModal({
    titulo: edicao ? 'Editar projeto' : 'Adicionar projeto',
    corpo: [
      el('div', {}, [el('label', { class: 'rotulo', text: 'Nome' }), campoNome]),
      el('div', {}, [
        el('label', { class: 'rotulo', text: 'Pasta' }),
        el('div', { style: 'display:flex;gap:6px' }, [
          campoCaminho,
          el('button', {
            class: 'btn pequeno', text: 'Trocar',
            onclick: async () => {
              const escolha = await window.api.projetos.escolherPasta();
              if (escolha) { campoCaminho.value = escolha.path; if (!campoNome.value) campoNome.value = escolha.name; }
            },
          }),
        ]),
      ]),
      el('p', { class: 'dica', text: 'A cor na barra lateral segue o que os terminais do projeto estao fazendo, nao uma cor fixa.' }),
    ],
    acoes: [
      { rotulo: 'Cancelar', aoClicar: (fechar) => fechar() },
      {
        rotulo: 'Salvar',
        classe: 'primario',
        aoClicar: async (fechar) => {
          const nome = campoNome.value.trim();
          if (!nome || !campoCaminho.value) { aviso('Informe nome e pasta.', 'erro'); return; }
          try {
            if (edicao) await window.api.projetos.atualizar(projeto.id, { name: nome, color: cor, path: campoCaminho.value });
            else await window.api.projetos.criar({ name: nome, path: campoCaminho.value, color: cor });
            fechar();
            await recarregar();
            aviso(edicao ? 'Projeto atualizado.' : 'Projeto adicionado.', 'ok');
          } catch (erro) {
            aviso(erro.message.includes('UNIQUE') ? 'Essa pasta ja esta cadastrada.' : erro.message, 'erro');
          }
        },
      },
    ],
  });
}

export function menuProjeto(projeto) {
  abrirModal({
    titulo: projeto.name,
    corpo: [
      el('div', { class: 'projeto-caminho', text: projeto.path, style: 'direction:ltr;font-size:11px' }),
      el('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-top:6px' }, [
        ...estado.perfis.map((perfil) => el('button', {
          class: 'btn', style: 'text-align:left',
          text: `Abrir ${perfil.name} aqui`,
          onclick: () => { fecharModal(); lancar(projeto, perfil); },
        })),
        el('hr', { style: 'border:none;border-top:1px solid var(--borda)' }),
        el('button', {
          class: 'btn', style: 'text-align:left', text: 'Abrir pasta no Explorer',
          onclick: () => window.api.projetos.abrirNoExplorer(projeto.path),
        }),
        el('button', {
          class: 'btn', style: 'text-align:left', text: 'Editar projeto',
          onclick: () => { fecharModal(); formularioProjeto(projeto); },
        }),
        el('button', {
          class: 'btn perigo', style: 'text-align:left', text: 'Remover projeto (e seu historico)',
          onclick: () => {
            fecharModal();
            confirmar(`Remover "${projeto.name}"? O historico de terminais deste projeto e as anotacoes deles tambem serao apagados. A pasta em disco nao e apagada.`,
              async () => {
                await window.api.projetos.excluir(projeto.id);
                await recarregar();
                emitir('historico:recarregar');
                aviso('Projeto removido.', 'ok');
              }, 'Remover');
          },
        }),
      ]),
    ],
    acoes: [{ rotulo: 'Fechar', aoClicar: (fechar) => fechar() }],
  });
}

/* --------------------------------------------------------------- perfis */

export function gerenciarPerfis() {
  const desenharLista = (area) => {
    limpar(area);
    for (const perfil of estado.perfis) {
      area.append(el('div', { class: 'linha-perfil' }, [
        el('span', { class: 'aba-icone', text: perfil.icon }),
        el('div', { class: 'info' }, [
          el('div', { text: perfil.name, style: 'font-weight:600' }),
          el('div', {
            class: 'sub',
            text: `${perfil.shell} ${(perfil.shell_args || []).join(' ')}${perfil.initial_command ? `  →  ${perfil.initial_command}` : ''}`,
          }),
        ]),
        el('button', { class: 'btn pequeno', text: 'Editar', onclick: () => formularioPerfil(perfil) }),
        perfil.builtin ? null : el('button', {
          class: 'btn pequeno perigo', text: 'Excluir',
          onclick: async () => { await window.api.perfis.excluir(perfil.id); await recarregarPerfis(); desenharLista(area); desenhar(); },
        }),
      ]));
    }
    area.append(el('button', { class: 'btn primario bloco', text: '+ Novo perfil', onclick: () => formularioPerfil({}) }));
  };

  abrirModal({
    titulo: 'Perfis de terminal',
    corpo: [
      el('p', { class: 'sub', style: 'color:var(--texto-fraco);line-height:1.5', text: 'O shell sobe primeiro e o comando inicial e digitado nele. Assim, se a IA encerrar, o terminal continua vivo.' }),
      el('div', { id: 'area-perfis', style: 'display:flex;flex-direction:column;gap:8px' }),
    ],
    acoes: [{ rotulo: 'Fechar', classe: 'primario', aoClicar: (fechar) => fechar() }],
    aoAbrir: (corpo) => desenharLista(corpo.querySelector('#area-perfis')),
  });
}

function formularioPerfil(perfil) {
  const campoNome = el('input', { class: 'campo', value: perfil.name || '' });
  const campoIcone = el('input', { class: 'campo', value: perfil.icon || '>', maxlength: '3' });
  const campoShell = el('select', { class: 'campo' }, [
    el('option', { value: 'powershell.exe', text: 'Windows PowerShell (powershell.exe)' }),
    el('option', { value: 'pwsh', text: 'PowerShell 7+ (pwsh)' }),
    el('option', { value: 'cmd.exe', text: 'Prompt de comando (cmd.exe)' }),
  ]);
  campoShell.value = perfil.shell || 'powershell.exe';
  const campoArgs = el('input', { class: 'campo', value: (perfil.shell_args || ['-NoLogo']).join(' ') });
  const campoComando = el('input', {
    class: 'campo', value: perfil.initial_command || '', placeholder: 'ex.: claude, codex, npm run dev',
  });
  const campoEnv = el('textarea', {
    class: 'campo', rows: '3',
    placeholder: 'ex.: CLAUDE_CONFIG_DIR=C:\\Users\\voce\\.claude-conta-b',
  });
  campoEnv.value = Object.entries(perfil.env || {}).map(([chave, valor]) => `${chave}=${valor}`).join('\n');

  abrirModal({
    titulo: perfil.id ? `Editar perfil — ${perfil.name}` : 'Novo perfil',
    corpo: [
      el('div', { class: 'linha-dupla' }, [
        el('div', {}, [el('label', { class: 'rotulo', text: 'Nome' }), campoNome]),
        el('div', { style: 'flex:0 0 80px' }, [el('label', { class: 'rotulo', text: 'Sigla' }), campoIcone]),
      ]),
      el('div', {}, [el('label', { class: 'rotulo', text: 'Shell' }), campoShell]),
      el('div', {}, [el('label', { class: 'rotulo', text: 'Argumentos do shell' }), campoArgs]),
      el('div', {}, [el('label', { class: 'rotulo', text: 'Comando inicial (opcional)' }), campoComando]),
      el('div', {}, [
        el('label', { class: 'rotulo', text: 'Variaveis de ambiente (opcional, uma por linha CHAVE=valor)' }),
        campoEnv,
      ]),
    ],
    acoes: [
      { rotulo: 'Cancelar', aoClicar: (fechar) => fechar() },
      {
        rotulo: 'Salvar',
        classe: 'primario',
        aoClicar: async (fechar) => {
          if (!campoNome.value.trim()) { aviso('Informe o nome do perfil.', 'erro'); return; }
          const env = {};
          for (const linha of campoEnv.value.split('\n')) {
            const pos = linha.indexOf('=');
            if (pos <= 0) continue;
            env[linha.slice(0, pos).trim()] = linha.slice(pos + 1).trim();
          }
          await window.api.perfis.salvar({
            id: perfil.id,
            name: campoNome.value.trim(),
            shell: campoShell.value,
            shell_args: campoArgs.value.split(/\s+/).filter(Boolean),
            initial_command: campoComando.value.trim(),
            icon: (campoIcone.value || '>').toUpperCase(),
            env,
          });
          fechar();
          await recarregarPerfis();
          desenhar();
          aviso('Perfil salvo.', 'ok');
        },
      },
    ],
  });
}

export { formularioProjeto };
