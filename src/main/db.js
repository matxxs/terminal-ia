'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

let db = null;

const SCHEMA = `
create table if not exists projects (
  id            integer primary key autoincrement,
  name          text    not null,
  path          text    not null unique,
  color         text    not null default '#6ea8fe',
  sort_order    integer not null default 0,
  archived      integer not null default 0,
  created_at    text    not null,
  updated_at    text    not null
);

create table if not exists profiles (
  id              integer primary key autoincrement,
  name            text    not null,
  shell           text    not null,
  shell_args      text    not null default '[]',
  initial_command text    not null default '',
  icon            text    not null default '>',
  env             text    not null default '{}',
  builtin         integer not null default 0,
  sort_order      integer not null default 0
);

create table if not exists sessions (
  id             integer primary key autoincrement,
  project_id     integer references projects(id) on delete cascade,
  profile_id     integer references profiles(id) on delete set null,
  project_name   text    not null default '',
  profile_name   text    not null default '',
  profile_icon   text    not null default 'SH',
  title          text    not null,
  cwd            text    not null,
  open           integer not null default 1,
  sort_order     integer not null default 0,
  last_output    text    not null default '',
  last_output_at text,
  created_at     text    not null,
  last_active_at text    not null,
  closed_at      text
);

create table if not exists session_notes (
  id         integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  body       text    not null,
  kind       text    not null default 'NOT',
  created_at text    not null
);

create table if not exists command_history (
  id         integer primary key autoincrement,
  project_id integer references projects(id) on delete set null,
  command    text    not null,
  created_at text    not null
);

create table if not exists settings (
  key   text primary key,
  value text not null
);
`;

/**
 * Indices ficam fora do SCHEMA porque alguns apontam para colunas que so
 * existem depois de migrar(): num banco antigo, criar o indice antes do
 * alter table falharia com "no such column".
 */
const INDICES = `
create index if not exists idx_sessions_projeto     on sessions(project_id, open);
create index if not exists idx_sessions_historico   on sessions(open, closed_at);
create index if not exists idx_session_notes_sessao on session_notes(session_id);
create index if not exists idx_command_hist_proj    on command_history(project_id, id);
`;

const BUILTIN_PROFILES = [
  { name: 'PowerShell', shell: 'powershell.exe', shell_args: ['-NoLogo'], initial_command: '', icon: 'PS', sort_order: 10 },
  { name: 'Claude Code', shell: 'powershell.exe', shell_args: ['-NoLogo'], initial_command: 'claude', icon: 'CL', sort_order: 20 },
  { name: 'Codex', shell: 'powershell.exe', shell_args: ['-NoLogo'], initial_command: 'codex', icon: 'CX', sort_order: 30 },
  { name: 'CMD', shell: 'cmd.exe', shell_args: [], initial_command: '', icon: 'CM', sort_order: 40 },
];

function now() {
  return new Date().toISOString();
}

function init(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = path.join(userDataDir, 'terminal-ia.db');
  db = new DatabaseSync(file);
  db.exec('pragma journal_mode = WAL');
  db.exec('pragma foreign_keys = ON');
  db.exec(SCHEMA);
  migrar();
  db.exec(INDICES);
  seedProfiles();
  return file;
}

/**
 * Migracoes idempotentes para bancos criados por versoes anteriores. As tabelas
 * tasks/task_notes das versoes antigas nao sao tocadas: o app nao as usa mais,
 * mas o conteudo continua no arquivo caso seja preciso resgatar algo.
 */
function migrar() {
  const acrescentarEm = (tabela, nome, definicao) => {
    const colunas = db.prepare(`pragma table_info(${tabela})`).all().map((col) => col.name);
    if (!colunas.includes(nome)) db.exec(`alter table ${tabela} add column ${nome} ${definicao}`);
  };
  const acrescentar = (nome, definicao) => acrescentarEm('sessions', nome, definicao);

  acrescentar('project_name', "text not null default ''");
  acrescentar('profile_name', "text not null default ''");
  acrescentar('profile_icon', "text not null default 'SH'");
  acrescentar('last_output', "text not null default ''");
  acrescentar('last_output_at', 'text');
  acrescentar('closed_at', 'text');

  acrescentarEm('profiles', 'env', "text not null default '{}'");

  /* Sessoes fechadas por versoes antigas nao tem data de encerramento; sem ela
     o historico as ordenaria todas no mesmo ponto. */
  db.exec('update sessions set closed_at = last_active_at where open = 0 and closed_at is null');

  db.exec(`
    update sessions set project_name = coalesce(
      (select PRO.name from projects PRO where PRO.id = sessions.project_id), '')
    where project_name = '' and project_id is not null
  `);

  db.exec(`
    update sessions set
      profile_name = coalesce((select PER.name from profiles PER where PER.id = sessions.profile_id), ''),
      profile_icon = coalesce((select PER.icon from profiles PER where PER.id = sessions.profile_id), 'SH')
    where profile_name = '' and profile_id is not null
  `);
}

function seedProfiles() {
  const total = db.prepare('select count(*) as TOTAL from profiles').get().TOTAL;
  if (total > 0) return;
  const ins = db.prepare(`
    insert into profiles (name, shell, shell_args, initial_command, icon, builtin, sort_order)
    values (?, ?, ?, ?, ?, 1, ?)
  `);
  for (const pro of BUILTIN_PROFILES) {
    ins.run(pro.name, pro.shell, JSON.stringify(pro.shell_args), pro.initial_command, pro.icon, pro.sort_order);
  }
}

/* ---------------------------------------------------------------- projetos */

function listProjects() {
  return db.prepare(`
    select PRO.id, PRO.name, PRO.path, PRO.color, PRO.sort_order, PRO.archived,
           (select count(*) from sessions SES
             where SES.project_id = PRO.id and SES.open = 1) as QUANTIDADE_TERMINAIS_ABERTOS,
           (select count(*) from sessions SES
             where SES.project_id = PRO.id and SES.open = 0) as QUANTIDADE_TERMINAIS_NO_HISTORICO
    from projects PRO
    where PRO.archived = 0
    order by PRO.sort_order, PRO.name
  `).all();
}

function createProject({ name, path: dir, color }) {
  const ts = now();
  const ord = db.prepare('select coalesce(max(sort_order), 0) + 10 as PROXIMO from projects').get().PROXIMO;
  const res = db.prepare(`
    insert into projects (name, path, color, sort_order, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?)
  `).run(name, dir, color || '#6ea8fe', ord, ts, ts);
  return getProject(Number(res.lastInsertRowid));
}

function getProject(id) {
  return db.prepare('select * from projects where id = ?').get(id) || null;
}

function updateProject(id, { name, color, path: dir }) {
  const atual = getProject(id);
  if (!atual) return null;
  db.prepare(`
    update projects set name = ?, color = ?, path = ?, updated_at = ?
    where id = ?
  `).run(name ?? atual.name, color ?? atual.color, dir ?? atual.path, now(), id);
  return getProject(id);
}

function deleteProject(id) {
  db.prepare('delete from projects where id = ?').run(id);
  return true;
}

function reorderProjects(ids) {
  const upd = db.prepare('update projects set sort_order = ? where id = ?');
  ids.forEach((id, idx) => upd.run((idx + 1) * 10, id));
  return true;
}

/* ---------------------------------------------------------------- perfis */

function listProfiles() {
  return db.prepare('select * from profiles order by sort_order, name').all()
    .map((pro) => ({ ...pro, shell_args: JSON.parse(pro.shell_args || '[]'), env: JSON.parse(pro.env || '{}') }));
}

function getProfile(id) {
  const pro = db.prepare('select * from profiles where id = ?').get(id);
  return pro ? { ...pro, shell_args: JSON.parse(pro.shell_args || '[]'), env: JSON.parse(pro.env || '{}') } : null;
}

function saveProfile(perfil) {
  const args = JSON.stringify(perfil.shell_args || []);
  const env = JSON.stringify(perfil.env || {});
  if (perfil.id) {
    db.prepare(`
      update profiles set name = ?, shell = ?, shell_args = ?, initial_command = ?, icon = ?, env = ?
      where id = ?
    `).run(perfil.name, perfil.shell, args, perfil.initial_command || '', perfil.icon || '>', env, perfil.id);
    return getProfile(perfil.id);
  }
  const ord = db.prepare('select coalesce(max(sort_order), 0) + 10 as PROXIMO from profiles').get().PROXIMO;
  const res = db.prepare(`
    insert into profiles (name, shell, shell_args, initial_command, icon, env, builtin, sort_order)
    values (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(perfil.name, perfil.shell, args, perfil.initial_command || '', perfil.icon || '>', env, ord);
  return getProfile(Number(res.lastInsertRowid));
}

function deleteProfile(id) {
  db.prepare('delete from profiles where id = ? and builtin = 0').run(id);
  return true;
}

/* ---------------------------------------------------------------- sessoes */

const CAMPOS_SESSAO = `
  SES.id, SES.project_id, SES.profile_id, SES.title, SES.cwd, SES.open,
  SES.sort_order, SES.last_output, SES.last_output_at,
  SES.created_at, SES.last_active_at, SES.closed_at,
  coalesce(PRO.name, SES.project_name) as NOME_PROJETO,
  PRO.color as COR_PROJETO,
  PRO.path  as CAMINHO_PROJETO,
  SES.profile_name as NOME_PERFIL,
  SES.profile_icon as SIGLA_PERFIL,
  (select count(*) from session_notes ANO where ANO.session_id = SES.id) as QUANTIDADE_ANOTACOES
`;

function listOpenSessions() {
  return db.prepare(`
    select ${CAMPOS_SESSAO}
    from sessions SES
    left join projects PRO on PRO.id = SES.project_id
    where SES.open = 1
    order by SES.sort_order, SES.id
  `).all();
}

function getSession(id) {
  const ses = db.prepare(`
    select ${CAMPOS_SESSAO}
    from sessions SES
    left join projects PRO on PRO.id = SES.project_id
    where SES.id = ?
  `).get(id);
  if (!ses) return null;
  ses.notes = listSessionNotes(id);
  return ses;
}

function createSession({ project_id, profile_id, title, cwd, project_name, profile_name, profile_icon }) {
  const ts = now();
  const ord = db.prepare('select coalesce(max(sort_order), 0) + 10 as PROXIMO from sessions where open = 1').get().PROXIMO;
  const res = db.prepare(`
    insert into sessions (project_id, profile_id, project_name, profile_name, profile_icon,
                          title, cwd, open, sort_order, created_at, last_active_at)
    values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(project_id ?? null, profile_id ?? null, project_name || '', profile_name || '',
         profile_icon || 'SH', title, cwd, ord, ts, ts);
  return getSession(Number(res.lastInsertRowid));
}

function touchSession(id, title) {
  if (title) db.prepare('update sessions set last_active_at = ?, title = ? where id = ?').run(now(), title, id);
  else db.prepare('update sessions set last_active_at = ? where id = ?').run(now(), id);
  return true;
}

/** Fechar o terminal e o que move a sessao para o historico. */
function closeSession(id) {
  const ts = now();
  db.prepare('update sessions set open = 0, closed_at = ?, last_active_at = ? where id = ?').run(ts, ts, id);
  return getSession(id);
}

function reorderSessions(ids) {
  const upd = db.prepare('update sessions set sort_order = ? where id = ?');
  ids.forEach((id, idx) => upd.run((idx + 1) * 10, id));
  return true;
}

/** Fotografia automatica da ultima tela, guardada como "onde eu parei". */
function saveSessionOutput(sessionId, texto) {
  const conteudo = String(texto || '').trim();
  if (!conteudo) return false;
  const atual = db.prepare('select last_output from sessions where id = ?').get(sessionId);
  if (!atual || atual.last_output === conteudo) return false;
  db.prepare('update sessions set last_output = ?, last_output_at = ? where id = ?')
    .run(conteudo, now(), sessionId);
  return true;
}

/* -------------------------------------------------------------- anotacoes */

function listSessionNotes(sessionId) {
  return db.prepare('select * from session_notes where session_id = ? order by id desc').all(sessionId);
}

function addSessionNote(sessionId, body, kind) {
  const texto = String(body || '').trim();
  if (!texto) return null;
  const res = db.prepare('insert into session_notes (session_id, body, kind, created_at) values (?, ?, ?, ?)')
    .run(sessionId, texto, kind || 'NOT', now());
  db.prepare('update sessions set last_active_at = ? where id = ?').run(now(), sessionId);
  return db.prepare('select * from session_notes where id = ?').get(Number(res.lastInsertRowid));
}

function deleteSessionNote(id) {
  db.prepare('delete from session_notes where id = ?').run(id);
  return true;
}

/* -------------------------------------------------------------- historico */

/**
 * Historico do trabalho: so entram os terminais ja encerrados. Todos ficam
 * registrados; os que receberam anotacao sao os que valem como "fiz alguma
 * coisa aqui" e podem ser isolados pelo filtro.
 */
function listSessionHistory({ limite, somenteAnotadas, projectId, busca } = {}) {
  const where = ['SES.open = 0'];
  const params = [];
  if (somenteAnotadas) {
    where.push('exists (select 1 from session_notes ANO where ANO.session_id = SES.id)');
  }
  if (projectId) {
    where.push('SES.project_id = ?');
    params.push(projectId);
  }
  if (busca) {
    where.push(`(SES.title like ? or SES.cwd like ? or exists (
      select 1 from session_notes ANO where ANO.session_id = SES.id and ANO.body like ?))`);
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  params.push(limite || 120);

  return db.prepare(`
    select ${CAMPOS_SESSAO},
           (select ANO.body from session_notes ANO
             where ANO.session_id = SES.id order by ANO.id desc limit 1) as ULTIMA_ANOTACAO
    from sessions SES
    left join projects PRO on PRO.id = SES.project_id
    where ${where.join(' and ')}
    order by coalesce(SES.closed_at, SES.last_active_at, SES.created_at) desc, SES.id desc
    limit ?
  `).all(...params);
}

function deleteSession(id) {
  db.prepare('delete from sessions where id = ?').run(id);
  return true;
}

/* ------------------------------------------------------- historico e config */

function addCommandHistory(project_id, command) {
  const texto = String(command || '').trim();
  if (!texto) return false;
  db.prepare('insert into command_history (project_id, command, created_at) values (?, ?, ?)')
    .run(project_id ?? null, texto, now());
  db.exec(`
    delete from command_history
    where id not in (select id from command_history order by id desc limit 500)
  `);
  return true;
}

function listCommandHistory(project_id, limite) {
  if (project_id) {
    return db.prepare(`
      select command from command_history
      where project_id = ?
      group by command order by max(id) desc limit ?
    `).all(project_id, limite || 50).map((lin) => lin.command);
  }
  return db.prepare(`
    select command from command_history group by command order by max(id) desc limit ?
  `).all(limite || 50).map((lin) => lin.command);
}

function getSetting(key, padrao) {
  const lin = db.prepare('select value from settings where key = ?').get(key);
  if (!lin) return padrao;
  try { return JSON.parse(lin.value); } catch { return padrao; }
}

function setSetting(key, value) {
  db.prepare(`
    insert into settings (key, value) values (?, ?)
    on conflict(key) do update set value = excluded.value
  `).run(key, JSON.stringify(value));
  return true;
}

module.exports = {
  init,
  listProjects, createProject, getProject, updateProject, deleteProject, reorderProjects,
  listProfiles, getProfile, saveProfile, deleteProfile,
  listOpenSessions, getSession, createSession, touchSession, closeSession, reorderSessions,
  saveSessionOutput, deleteSession,
  listSessionNotes, addSessionNote, deleteSessionNote,
  listSessionHistory,
  addCommandHistory, listCommandHistory, getSetting, setSetting,
};
