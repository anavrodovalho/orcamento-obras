'use strict';
/**
 * app.js — inicialização, login, navegação (hash), dados compartilhados, modal e toasts.
 * Rotas: #/orcamentos · #/orcamentos/novo · #/orcamentos/ORC0001 · #/sinapi · #/modelo
 */

const TITULOS = { orcamentos: 'Orçamentos', orcamento: 'Orçamento', sinapi: 'Base SINAPI', modelo: 'Modelo de itens' };

/** Dados que várias telas usam: modelo (cfg_* da planilha) e base SINAPI (GitHub). */
const dados = {
  modelo: null,
  sinapi: null,
  indiceSinapi: null,
  lista: null,
  invalidar() { this.modelo = null; this.lista = null; },
  async carregarModelo(forcar) {
    if (!this.modelo || forcar) this.modelo = await api('getConfig');
    return this.modelo;
  },
  async carregarSinapi() {
    if (this.sinapi) return this.sinapi;
    let indice, base;
    try {
      indice = await (await fetch('data/sinapi/index.json', { cache: 'no-cache' })).json();
      const atual = indice.competencias.find((c) => c.competencia === indice.atual) || indice.competencias[0];
      base = await (await fetch('data/sinapi/' + atual.arquivo)).json();
    } catch (e) {
      throw new Error('Não foi possível carregar a base SINAPI. Confira a internet e recarregue.');
    }
    this.sinapi = base;
    this.indiceSinapi = Motor.indexarSinapi(base);
    return base;
  },
  async carregarLista(forcar) {
    if (!this.lista || forcar) this.lista = await api('listOrcamentos');
    return this.lista;
  },
};

const app = {
  rotaAtual: null,

  iniciar() {
    sessao.carregar();
    el('form-login').addEventListener('submit', (e) => { e.preventDefault(); this.entrar(); });
    document.addEventListener('click', (e) => this.cliqueGlobal(e));
    document.addEventListener('sessao-expirada', () => { toast('Sua sessão expirou. Entre de novo.', 'erro'); this.mostrarLogin(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el('modal').hidden) fecharModal(); });
    window.addEventListener('hashchange', () => this.navegar());
    window.addEventListener('beforeunload', (e) => {
      if (window.editor && editor.alterado) { e.preventDefault(); e.returnValue = ''; }
    });
    if (sessao.dados) this.mostrarApp(); else this.mostrarLogin();
  },

  cliqueGlobal(e) {
    const alvo = e.target.closest('[data-acao]');
    if (!alvo) return;
    const acao = alvo.dataset.acao;
    if (acao === 'sair') this.sair();
    else if (acao === 'fechar-modal') fecharModal();
    else if (acao === 'atualizar') this.atualizar();
    else if (acao === 'fechar-impressao') fecharImpressao();
    else if (acao === 'imprimir') window.print();
  },

  mostrarLogin() {
    el('tela-app').hidden = true;
    el('tela-login').hidden = false;
    el('login-aviso').hidden = true;
    setTimeout(() => el('login-usuario').focus(), 50);
  },

  async entrar() {
    const usuario = el('login-usuario').value.trim();
    const senha = el('login-senha').value;
    const aviso = el('login-aviso');
    aviso.hidden = true;
    if (!usuario || !senha) { aviso.textContent = 'Informe o usuário e a senha.'; aviso.hidden = false; return; }
    const botao = el('login-botao');
    botao.disabled = true; botao.textContent = 'Entrando…';
    try {
      const s = await api('login', { usuario, senha });
      sessao.guardar(s);
      el('login-senha').value = '';
      this.mostrarApp();
    } catch (erro) {
      aviso.textContent = erro.message; aviso.hidden = false;
    } finally {
      botao.disabled = false; botao.textContent = 'Entrar';
    }
  },

  mostrarApp() {
    const s = sessao.dados;
    const iniciais = s.nome.split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
    el('menu-nome').textContent = s.nome;
    el('topo-nome').textContent = s.nome;
    el('menu-avatar').textContent = iniciais;
    el('topo-avatar').textContent = iniciais;
    el('tela-login').hidden = true;
    el('tela-app').hidden = false;
    dados.invalidar();
    if (!location.hash) location.hash = '#/orcamentos';
    this.navegar();
  },

  async sair() {
    if (window.editor && editor.alterado && !(await confirmar('Sair sem salvar?', 'Há alterações no orçamento que ainda não foram salvas.', { ok: 'Sair mesmo assim', perigo: true }))) return;
    try { await api('logout'); } catch (e) { /* o token some de qualquer jeito */ }
    if (window.editor) editor.alterado = false;
    sessao.limpar();
    dados.invalidar();
    fecharModal();
    this.mostrarLogin();
  },

  async atualizar() {
    if (window.editor && editor.alterado && this.rotaAtual === 'orcamento') {
      toast('Salve o orçamento antes de recarregar.', 'info');
      return;
    }
    dados.invalidar();
    toast('Recarregando…', 'info', 1200);
    await this.navegar();
  },

  async navegar() {
    if (!sessao.dados) return;
    const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    let rota = partes[0] || 'orcamentos';
    const parametro = partes[1] || null;
    if (!TITULOS[rota]) rota = 'orcamentos';
    if (rota === 'orcamentos' && parametro) rota = 'orcamento';

    // Saindo do editor com alterações: confirma antes.
    if (this.rotaAtual === 'orcamento' && window.editor && editor.alterado && !(rota === 'orcamento' && parametro === editor.rotaParametro)) {
      const sair = await confirmar('Sair sem salvar?', 'Há alterações neste orçamento que ainda não foram salvas.', { ok: 'Sair sem salvar', perigo: true, cancelar: 'Continuar editando' });
      if (!sair) { history.replaceState(null, '', '#/orcamentos/' + editor.rotaParametro); return; }
      editor.alterado = false;
    }

    qa('.vista').forEach((v) => { v.hidden = true; });
    qa('[data-rota]').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === (rota === 'orcamento' ? 'orcamentos' : rota)));
    el('topo-titulo').textContent = TITULOS[rota];
    document.title = `${TITULOS[rota]} · Orçamento de Obras`;
    const vista = el(`vista-${rota}`);
    vista.hidden = false;
    this.rotaAtual = rota;
    window.scrollTo(0, 0);

    try {
      if (rota === 'orcamentos') await listaOrcamentos.mostrar();
      else if (rota === 'orcamento') await editor.abrir(parametro);
      else if (rota === 'sinapi') await consultas.mostrarSinapi();
      else if (rota === 'modelo') await consultas.mostrarModelo();
    } catch (erro) {
      if (erro.codigo !== 'SESSAO') {
        vista.innerHTML = `<div class="cartao aviso-erro-bloco"><p>${esc(erro.message)}</p><button class="botao botao-secundario" type="button" data-acao="atualizar">Tentar de novo</button></div>`;
      }
    }
  },
};

// ───────────────────────────── Modal e confirmação ─────────────────────────────

function abrirModal(titulo, html, opcoes = {}) {
  const modal = el('modal');
  el('modal-titulo').textContent = titulo;
  el('modal-corpo').innerHTML = html;
  modal.querySelector('.modal-caixa').classList.toggle('modal-larga', !!opcoes.larga);
  modal.hidden = false;
  document.body.classList.add('sem-rolagem');
  const primeiro = modal.querySelector('input:not([type=hidden]):not([readonly]), select, textarea, button.botao-primario');
  if (primeiro) setTimeout(() => primeiro.focus(), 30);
}

function fecharModal() {
  const modal = el('modal');
  if (modal.hidden) return;
  modal.hidden = true;
  el('modal-corpo').innerHTML = '';
  document.body.classList.remove('sem-rolagem');
}

function confirmar(titulo, mensagem, opcoes = {}) {
  return new Promise((resolve) => {
    const dialogo = el('dialogo-confirma');
    dialogo.querySelector('.modal-caixa').innerHTML = `
      <header class="modal-topo"><h2>${esc(titulo)}</h2></header>
      <div class="modal-corpo">
        <p class="modal-texto">${esc(mensagem)}</p>
        <div class="modal-botoes">
          <button class="botao botao-secundario" type="button" data-conf="nao">${esc(opcoes.cancelar || 'Cancelar')}</button>
          <button class="botao ${opcoes.perigo ? 'botao-perigo' : 'botao-primario'}" type="button" data-conf="sim">${esc(opcoes.ok || 'Confirmar')}</button>
        </div>
      </div>`;
    dialogo.hidden = false;
    document.body.classList.add('sem-rolagem');
    dialogo.querySelector('[data-conf="sim"]').focus();
    const fechar = (resultado) => {
      dialogo.hidden = true;
      dialogo.querySelector('.modal-caixa').innerHTML = '';
      if (el('modal').hidden) document.body.classList.remove('sem-rolagem');
      document.removeEventListener('keydown', aoTeclar, true);
      resolve(resultado);
    };
    const aoTeclar = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(false); } };
    document.addEventListener('keydown', aoTeclar, true);
    dialogo.onclick = (e) => {
      const b = e.target.closest('[data-conf]');
      if (b) fechar(b.dataset.conf === 'sim');
      else if (e.target.classList.contains('modal-fundo')) fechar(false);
    };
  });
}

function toast(mensagem, tipo = 'sucesso', duracao = 3500) {
  const caixa = document.createElement('div');
  caixa.className = `toast toast-${tipo}`;
  caixa.textContent = mensagem;
  el('toasts').appendChild(caixa);
  requestAnimationFrame(() => caixa.classList.add('visivel'));
  setTimeout(() => { caixa.classList.remove('visivel'); setTimeout(() => caixa.remove(), 300); }, duracao);
}

document.addEventListener('DOMContentLoaded', () => app.iniciar());
