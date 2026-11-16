'use strict';
/**
 * orcamentos.js — lista de orçamentos e editor.
 * O editor recalcula tudo no navegador (Motor.calcular) a cada alteração; o Apps Script só guarda.
 */

const STATUS = ['Rascunho', 'Enviado', 'Aprovado', 'Recusado', 'Em obra', 'Concluído'];
const CLASSE_STATUS = {
  Rascunho: 'st-neutro', Enviado: 'st-vencer', Aprovado: 'st-pago', Recusado: 'st-atrasado', 'Em obra': 'st-conferir', 'Concluído': 'st-pago',
};

const OPCOES = {
  terreno: ['PLANO', 'DECLIVE', 'ACLIVE'],
  telhado: ['COLONIAL', 'EMBUTIDO'],
  pavimentos: ['TÉRREO', 'SUBSOLO+TÉRREO', 'SUBSOLO+TÉRREO+1PAV', 'TÉRREO+1PAV', 'TÉRREO+2PAV'],
  acabamento: ['POPULAR', 'MÉDIO', 'ALTO'],
  pe_direito_duplo: ['NENHUM', 'SALA', 'SALA E COZINHA'],
  pintura: ['NORMAL', 'GRAFIATTO/TEXTURA'],
  portao: ['SIM', 'NÃO'],
  terraplanagem: [{ valor: 'CONSTRUTOR', rotulo: 'Construtor (entra no orçamento)' }, { valor: 'CONTRATANTE', rotulo: 'Contratante (fora do orçamento)' }],
};

// Campos do formulário "Dados da obra". t: texto | num | data | sel | cpf | tel
const SECOES_FORM = [
  { titulo: 'Cliente e obra', campos: [
    { k: 'cliente_nome', r: 'Nome do cliente', t: 'texto', largo: true },
    { k: 'cliente_cpf', r: 'CPF', t: 'cpf' },
    { k: 'cliente_telefone', r: 'Telefone', t: 'tel' },
    { k: 'endereco_obra', r: 'Endereço da construção', t: 'texto', largo: true },
    { k: 'cidade', r: 'Cidade', t: 'texto' },
    { k: 'data_orcamento', r: 'Data do orçamento', t: 'data' },
    { k: 'data_inicio', r: 'Início previsto da obra', t: 'data' },
  ] },
  { titulo: 'Características', campos: [
    { k: 'terreno', r: 'Terreno', t: 'sel' },
    { k: 'telhado', r: 'Telhado', t: 'sel' },
    { k: 'pavimentos', r: 'Pavimentos', t: 'sel' },
    { k: 'acabamento', r: 'Acabamento', t: 'sel' },
    { k: 'pe_direito_duplo', r: 'Pé-direito duplo', t: 'sel' },
    { k: 'pintura', r: 'Pintura', t: 'sel' },
  ] },
  { titulo: 'Áreas e medidas', aeq: true, campos: [
    { k: 'area', r: 'Área total do projeto (m²)', t: 'num' },
    { k: 'muro', r: 'Muros (metros lineares)', t: 'num' },
    { k: 'grama', r: 'Área externa com grama (m²)', t: 'num' },
    { k: 'piso_ext', r: 'Área externa com piso (m²)', t: 'num' },
    { k: 'gourmet', r: 'Área gourmet (m²)', t: 'num' },
    { k: 'piscina', r: 'Piscina (m²)', t: 'num' },
    { k: 'sauna', r: 'Sauna (m²)', t: 'num' },
    { k: 'garagem', r: 'Garagem fora da área total (m²)', t: 'num' },
    { k: 'gesso', r: 'Gesso: sancas e rebaixos (m²)', t: 'num' },
  ] },
  { titulo: 'Cômodos', campos: [
    { k: 'banheiros', r: 'Banheiros', t: 'num' },
    { k: 'lavabos', r: 'Lavabos', t: 'num' },
    { k: 'quartos', r: 'Quartos', t: 'num' },
    { k: 'cozinhas', r: 'Cozinhas', t: 'num' },
    { k: 'duchas', r: 'Duchas', t: 'num' },
    { k: 'escadas', r: 'Escadas', t: 'num' },
  ] },
  { titulo: 'Portão, extras e terraplanagem', campos: [
    { k: 'portao', r: 'Portão de garagem/pedestre', t: 'sel', vazio: 'Escolha…' },
    { k: 'portao_largura', r: 'Largura do portão (m)', t: 'num', se: (p) => p.portao === 'SIM' },
    { k: 'portao_altura', r: 'Altura do portão (m)', t: 'num', se: (p) => p.portao === 'SIM' },
    { k: 'terraplanagem', r: 'Quem paga a terraplanagem', t: 'sel', vazio: 'Escolha…' },
    { k: 'registros_gourmet', r: 'Registros extras no gourmet (un)', t: 'num', se: (p) => Number(p.gourmet) > 0 },
    { k: 'registros_sauna', r: 'Registros extras na sauna (un)', t: 'num', se: (p) => Number(p.sauna) > 0 },
    { k: 'janelas_sauna', r: 'Janelas extras na sauna (un)', t: 'num', se: (p) => Number(p.sauna) > 0 },
  ] },
];

// ───────────────────────────── Lista ─────────────────────────────

const listaOrcamentos = {
  busca: '',
  status: '',

  async mostrar() {
    const vista = el('vista-orcamentos');
    vista.innerHTML = `<div class="cartao">${skeleton(6)}</div>`;
    const lista = await dados.carregarLista(true);
    vista.innerHTML = `
      <div class="barra-ferramentas">
        <input id="lista-busca" class="campo" type="search" placeholder="Buscar cliente, cidade ou nº…" value="${esc(this.busca)}">
        <select id="lista-status" class="campo">${opcoesSelect(STATUS, this.status, 'Todas as situações')}</select>
        <span class="espaco"></span>
        <a class="botao botao-primario" href="#/orcamentos/novo">+ Novo orçamento</a>
      </div>
      <div class="cartao"><div class="tabela-rolagem" id="lista-tabela"></div></div>`;
    el('lista-busca').addEventListener('input', debounce((e) => { this.busca = e.target.value; this.tabela(lista); }, 150));
    el('lista-status').addEventListener('change', (e) => { this.status = e.target.value; this.tabela(lista); });
    this.tabela(lista);
  },

  tabela(lista) {
    const b = semAcento(this.busca);
    const filtrada = lista.filter((o) => (!this.status || o.status === this.status) &&
      (!b || semAcento([o.id, o.cliente_nome, o.cidade, o.endereco_obra].join(' ')).includes(b)));
    if (!lista.length) {
      el('lista-tabela').innerHTML = '<p class="vazio">Nenhum orçamento ainda. Clique em <strong>+ Novo orçamento</strong>.</p>';
      return;
    }
    el('lista-tabela').innerHTML = `
      <table class="tabela tabela-responsiva tabela-clicavel">
        <thead><tr><th>Cliente</th><th>Data</th><th class="num">Área</th><th>Acabamento</th><th class="num">Com material</th><th class="num">Sem material</th><th>Situação</th></tr></thead>
        <tbody>${filtrada.map((o) => `
          <tr data-id="${esc(o.id)}" tabindex="0">
            <td class="principal-cel"><strong>${esc(o.cliente_nome)}</strong><small>${esc(o.id)} · ${esc(o.cidade || o.endereco_obra || '')}</small></td>
            <td data-rotulo="Data">${dataBr(o.data_orcamento)}</td>
            <td class="num" data-rotulo="Área">${o.area ? num2(o.area) + ' m²' : '—'}</td>
            <td data-rotulo="Acabamento">${esc(o.acabamento || '—')}</td>
            <td class="num" data-rotulo="Com material">${moeda(o.total_com_material)}</td>
            <td class="num" data-rotulo="Sem material">${moeda(o.total_sem_material)}</td>
            <td data-rotulo="Situação">${pilula(CLASSE_STATUS[o.status] || 'st-neutro', o.status)}${o.pendencias ? ' ' + pilula('st-breve', o.pendencias + ' pend.') : ''}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="vazio">Nada encontrado com esse filtro.</td></tr>'}
        </tbody>
      </table>`;
    qa('#lista-tabela tr[data-id]').forEach((tr) => {
      const abrir = () => { location.hash = '#/orcamentos/' + tr.dataset.id; };
      tr.addEventListener('click', abrir);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(); });
    });
  },
};

// ───────────────────────────── Editor ─────────────────────────────

const editor = {
  id: null,
  versao: null,
  rotaParametro: null,
  orc: null,
  resultado: null,
  aba: 'dados',
  filtro: 'todos',
  busca: '',
  alterado: false,
  salvoCom: '',

  novoOrcamento(modelo) {
    const e = modelo.empresa || {};
    const n = (v) => (v === '' || v === null || v === undefined ? null : Motor.num(v));
    return completarFase2({
      status: 'Rascunho',
      parametros: {
        data_orcamento: hojeIso(), terreno: 'PLANO', telhado: 'EMBUTIDO', pavimentos: 'TÉRREO',
        acabamento: 'MÉDIO', pe_direito_duplo: 'NENHUM', pintura: 'NORMAL', portao: '', terraplanagem: '',
      },
      taxas: {
        adiantamento: n(e.adiantamento_padrao), administracao: n(e.administracao_padrao),
        protecao: n(e.protecao_padrao), intervalo: n(e.intervalo_pagamentos_padrao), usar_bdi: false,
      },
      ajustes: {},
      adicionais: [],
      confirmacoes: { coeficientes_revisados: false, precos_revisados: false },
      observacoes: e.observacoes_proposta || '',
    });
  },

  async abrir(parametro) {
    const vista = el('vista-orcamento');
    vista.innerHTML = `<div class="cartao">${skeleton(8)}</div>`;
    const [modelo] = await Promise.all([dados.carregarModelo(), dados.carregarSinapi()]);
    this.rotaParametro = parametro;
    this.alterado = false;
    if (parametro === 'novo') {
      this.id = null; this.versao = null; this.salvoCom = '';
      this.orc = this.novoOrcamento(modelo);
    } else {
      const o = await api('getOrcamento', { id: parametro });
      this.id = o.id; this.versao = o.atualizado_em; this.salvoCom = o.competencia_sinapi;
      const base = this.novoOrcamento(modelo);
      this.orc = Object.assign(base, o.dados || {});
      this.orc.parametros = Object.assign({}, base.parametros, (o.dados || {}).parametros || {});
      this.orc.status = o.status;
      completarFase2(this.orc);
    }
    this.aba = 'dados';
    this.calcular();
    this.renderizar();
  },

  calcular() {
    this.resultado = Motor.calcular({
      modelo: dados.modelo, sinapi: dados.sinapi, indiceSinapi: dados.indiceSinapi, orcamento: this.orc, hoje: hojeIso(),
    });
    this.fase2 = calcularFase2(this.orc, this.resultado);
    return this.resultado;
  },

  marcarAlterado() {
    this.alterado = true;
    const b = el('ed-salvar');
    if (b) { b.disabled = false; b.textContent = 'Salvar'; }
  },

  renderizar() {
    const p = this.orc.parametros;
    const vista = el('vista-orcamento');
    vista.innerHTML = `
      <a class="voltar" href="#/orcamentos">← Orçamentos</a>
      <div class="ed-cabecalho">
        <div class="ed-titulo">
          <h2 id="ed-nome">${esc(p.cliente_nome || 'Novo orçamento')}</h2>
          <small>${this.id ? esc(this.id) + ' · ' : ''}Base SINAPI GO ${competenciaBr(dados.sinapi.competencia)}${this.salvoCom && this.salvoCom !== dados.sinapi.competencia ? ` <span class="pilula st-breve">salvo com ${competenciaBr(this.salvoCom)}</span>` : ''}</small>
        </div>
        <div class="ed-acoes">
          <select id="ed-status" class="campo" aria-label="Situação">${opcoesSelect(STATUS, this.orc.status)}</select>
          ${this.id ? '<button class="botao botao-secundario" type="button" id="ed-duplicar">Duplicar</button><button class="botao botao-secundario" type="button" id="ed-excluir">Excluir</button>' : ''}
          <button class="botao botao-primario" type="button" id="ed-salvar">${this.id ? 'Salvo' : 'Salvar'}</button>
        </div>
      </div>
      <div class="ed-resumo" id="ed-resumo"></div>
      <nav class="abas" role="tablist">
        ${[['dados', 'Dados da obra'], ['itens', 'Itens'], ['resumo', 'Resumo e propostas'], ['cronograma', 'Cronograma'], ['pagamento', 'Pagamento'], ['contrato', 'Contrato'], ['validacao', 'Validação']]
          .map(([k, r]) => `<button type="button" role="tab" class="aba${this.aba === k ? ' ativa' : ''}" data-aba="${k}">${r}<span class="aba-contador" id="aba-cont-${k}"></span></button>`).join('')}
      </nav>
      <div id="ed-conteudo"></div>`;
    if (this.id) el('ed-salvar').disabled = true;
    el('ed-status').addEventListener('change', (e) => { this.orc.status = e.target.value; this.marcarAlterado(); });
    el('ed-salvar').addEventListener('click', () => this.salvar());
    if (this.id) {
      el('ed-duplicar').addEventListener('click', () => this.duplicar());
      el('ed-excluir').addEventListener('click', () => this.excluir());
    }
    qa('.abas .aba', vista).forEach((b) => b.addEventListener('click', () => {
      this.aba = b.dataset.aba;
      qa('.abas .aba', vista).forEach((x) => x.classList.toggle('ativa', x === b));
      this.renderizarAba();
    }));
    this.atualizarResumo();
    this.renderizarAba();
  },

  /** Faixa de totais no topo + contadores das abas. */
  atualizarResumo() {
    const r = this.resultado;
    el('ed-resumo').innerHTML = `
      <div><span>Subtotal válido</span><strong>${moeda(r.subtotal_valido)}</strong></div>
      <div><span>Com material</span><strong>${moeda(r.propostas.COM.total)}</strong></div>
      <div><span>Sem material</span><strong>${moeda(r.propostas.SEM.total)}</strong></div>
      <div class="${r.pode_emitir ? 'ok' : 'pend'}"><span>Emissão</span><strong>${r.pode_emitir ? 'Pronto para emitir' : r.pendencias_emissao + ' pendência(s)'}</strong></div>`;
    el('aba-cont-itens').textContent = r.pendentes ? String(r.pendentes) : '';
    el('aba-cont-validacao').textContent = r.pendencias_emissao ? String(r.pendencias_emissao) : '';
    const f2 = this.fase2;
    el('aba-cont-cronograma').textContent = f2.crono.atrasadas ? String(f2.crono.atrasadas) : '';
    el('aba-cont-pagamento').textContent = f2.parcelas.vencidas ? String(f2.parcelas.vencidas) : '';
    el('aba-cont-contrato').textContent = f2.contrato.pendencias.length ? String(f2.contrato.pendencias.length) : '';
    const nome = el('ed-nome');
    if (nome) nome.textContent = this.orc.parametros.cliente_nome || 'Novo orçamento';
  },

  renderizarAba() {
    const alvo = el('ed-conteudo');
    if (this.aba === 'dados') this.abaDados(alvo);
    else if (this.aba === 'itens') this.abaItens(alvo);
    else if (this.aba === 'resumo') this.abaResumo(alvo);
    else if (this.aba === 'cronograma') this.abaCronograma(alvo);
    else if (this.aba === 'pagamento') this.abaPagamento(alvo);
    else if (this.aba === 'contrato') this.abaContrato(alvo);
    else this.abaValidacao(alvo);
  },

  /** Recalcula depois de qualquer alteração e atualiza só o que depende do cálculo. */
  aposAlterar(renderAba) {
    this.calcular();
    this.marcarAlterado();
    this.atualizarResumo();
    if (renderAba) this.renderizarAba();
    else if (this.aba === 'dados') this.atualizarDadosCalculados();
  },

  // ─────────── Aba: Dados da obra ───────────
  abaDados(alvo) {
    const p = this.orc.parametros;
    const t = this.orc.taxas;
    const c = this.orc.confirmacoes;
    const campo = (f) => {
      const id = 'p-' + f.k;
      const oculto = f.se && !f.se(p) ? ' hidden' : '';
      let entrada;
      if (f.t === 'sel') entrada = `<select id="${id}" class="campo" data-k="${f.k}">${opcoesSelect(OPCOES[f.k], p[f.k] || '', f.vazio)}</select>`;
      else if (f.t === 'data') entrada = `<input id="${id}" class="campo" type="date" data-k="${f.k}" value="${esc(p[f.k] || '')}">`;
      else if (f.t === 'num') entrada = `<input id="${id}" class="campo campo-num" type="text" inputmode="decimal" data-k="${f.k}" data-num="1" value="${esc(numCampo(p[f.k]))}">`;
      else entrada = `<input id="${id}" class="campo" type="text" data-k="${f.k}" data-mascara="${f.t}" value="${esc(p[f.k] || '')}"${f.t === 'tel' ? ' inputmode="tel"' : ''}${f.t === 'cpf' ? ' inputmode="numeric"' : ''}>`;
      return `<label class="rotulo${f.largo ? ' largo' : ''}" data-campo="${f.k}"${oculto}>${esc(f.r)}${entrada}</label>`;
    };
    const bdi = this.resultado.bdi;
    alvo.innerHTML = `
      ${SECOES_FORM.map((s) => `
        <div class="cartao">
          <div class="cartao-titulo"><h2>${esc(s.titulo)}</h2>${s.aeq ? '<span class="nota-aeq" id="nota-aeq"></span>' : ''}</div>
          <div class="grade-campos">${s.campos.map(campo).join('')}</div>
        </div>`).join('')}
      <div class="cartao">
        <div class="cartao-titulo"><h2>Taxas comerciais</h2><span class="nota">Vazio = pendente. Para zero, digite 0.</span></div>
        <div class="grade-campos">
          <label class="rotulo">Adiantamento (%)<input class="campo campo-num" type="text" inputmode="decimal" data-taxa="adiantamento" data-pct="1" value="${esc(pctCampo(t.adiantamento))}"></label>
          <label class="rotulo">Administração / markup (%)<input id="t-adm" class="campo campo-num" type="text" inputmode="decimal" data-taxa="administracao" data-pct="1" value="${esc(pctCampo(t.administracao))}"${t.usar_bdi ? ' disabled' : ''}></label>
          <label class="rotulo">Proteção econômica nos materiais (%)<input class="campo campo-num" type="text" inputmode="decimal" data-taxa="protecao" data-pct="1" value="${esc(pctCampo(t.protecao))}"></label>
          <label class="rotulo">Pagamentos a cada (dias)<input class="campo campo-num" type="text" inputmode="numeric" data-taxa="intervalo" value="${esc(numCampo(t.intervalo))}"></label>
          <label class="check largo"><input type="checkbox" id="t-bdi"${t.usar_bdi ? ' checked' : ''}> Usar o BDI como administração <span class="nota">(BDI atual: ${bdi.valido ? pct(bdi.bdi) : 'inválido'} — alíquotas na aba cfg_bdi da planilha)</span></label>
        </div>
      </div>
      <div class="cartao">
        <div class="cartao-titulo"><h2>Proposta e revisão</h2></div>
        <label class="rotulo">Escopo do projeto (opcional — entra no início do escopo da proposta, antes da lista automática)
          <textarea id="t-escopo" class="campo" rows="3" placeholder="Ex.: Residência unifamiliar conforme projeto arquitetônico aprovado, incluindo fundação, estrutura, alvenaria, instalações e acabamentos.">${esc(this.orc.escopo || '')}</textarea>
        </label>
        <label class="rotulo">Adicionais / observações da proposta
          <textarea id="t-obs" class="campo" rows="3">${esc(this.orc.observacoes || '')}</textarea>
        </label>
        <div class="checks">
          <label class="check"><input type="checkbox" data-conf="coeficientes_revisados"${c.coeficientes_revisados ? ' checked' : ''}> Revisei os coeficientes técnicos (ferragem, áreas ponderadas, produtividade)</label>
          <label class="check"><input type="checkbox" data-conf="precos_revisados"${c.precos_revisados ? ' checked' : ''}> Revisei os preços e o regime (SINAPI com desoneração)</label>
        </div>
      </div>`;

    alvo.querySelectorAll('[data-k]').forEach((inp) => {
      const evento = inp.tagName === 'SELECT' || inp.type === 'date' ? 'change' : 'input';
      inp.addEventListener(evento, () => {
        const k = inp.dataset.k;
        if (inp.dataset.mascara === 'cpf') inp.value = mascaraCpf(inp.value);
        if (inp.dataset.mascara === 'tel') inp.value = mascaraTelefone(inp.value);
        p[k] = inp.dataset.num ? lerNumero(inp.value) : inp.value;
        inp.classList.toggle('campo-erro', !!inp.dataset.num && inp.value.trim() !== '' && p[k] === null);
        this.aposAlterar(false);
      });
    });
    alvo.querySelectorAll('[data-taxa]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const v = inp.dataset.pct ? lerPct(inp.value) : lerNumero(inp.value);
        t[inp.dataset.taxa] = v;
        inp.classList.toggle('campo-erro', inp.value.trim() !== '' && v === null);
        this.aposAlterar(false);
      });
    });
    el('t-bdi').addEventListener('change', (e) => {
      t.usar_bdi = e.target.checked;
      el('t-adm').disabled = t.usar_bdi;
      this.aposAlterar(false);
    });
    el('t-obs').addEventListener('input', (e) => { this.orc.observacoes = e.target.value; this.marcarAlterado(); });
    el('t-escopo').addEventListener('input', (e) => { this.orc.escopo = e.target.value; this.marcarAlterado(); });
    alvo.querySelectorAll('[data-conf]').forEach((cb) => cb.addEventListener('change', () => {
      c[cb.dataset.conf] = cb.checked;
      this.aposAlterar(false);
    }));
    this.atualizarDadosCalculados();
  },

  /** Campos condicionais e a área equivalente, sem redesenhar o formulário (não perde o foco). */
  atualizarDadosCalculados() {
    const p = this.orc.parametros;
    SECOES_FORM.forEach((s) => s.campos.forEach((f) => {
      if (!f.se) return;
      const rot = q(`[data-campo="${f.k}"]`);
      if (rot) rot.hidden = !f.se(p);
    }));
    const nota = el('nota-aeq');
    if (nota) nota.innerHTML = `Área equivalente (AEQ): <strong>${num2(this.resultado.area_equivalente)} m²</strong>`;
  },

  // ─────────── Aba: Itens ───────────
  abaItens(alvo) {
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <input id="it-busca" class="campo" type="search" placeholder="Buscar descrição ou código…" value="${esc(this.busca)}">
        <select id="it-filtro" class="campo">${opcoesSelect([
          { valor: 'todos', rotulo: 'Todos os itens' }, { valor: 'pendentes', rotulo: 'Só pendentes' },
          { valor: 'ajustados', rotulo: 'Só ajustados' }, { valor: 'adicionais', rotulo: 'Só adicionais' }, { valor: 'usados', rotulo: 'Só com quantidade' }], this.filtro)}</select>
        <span class="espaco"></span>
        <button class="botao botao-secundario" type="button" id="it-csv">Exportar CSV</button>
        <button class="botao botao-primario" type="button" id="it-adicionar">+ Item adicional</button>
      </div>
      <p class="nota nota-itens">Qtd e preço em cinza são os calculados. Digite por cima para ajustar <strong>só neste orçamento</strong>; apague para voltar ao calculado. Preço que vale para todos os orçamentos vai na coluna <em>preco_manual</em> da aba cfg_itens.</p>
      <div class="cartao"><div id="it-tabela"></div></div>`;
    el('it-busca').addEventListener('input', debounce((e) => { this.busca = e.target.value; this.tabelaItens(); }, 150));
    el('it-filtro').addEventListener('change', (e) => { this.filtro = e.target.value; this.tabelaItens(); });
    el('it-adicionar').addEventListener('click', () => this.modalAdicional());
    el('it-csv').addEventListener('click', () => this.exportarItens());
    this.tabelaItens();
  },

  tabelaItens() {
    const r = this.resultado;
    const b = semAcento(this.busca);
    const filtrar = (it) => {
      if (this.filtro === 'pendentes' && it.status !== 'PENDENTE') return false;
      if (this.filtro === 'ajustados' && !it.ajustado) return false;
      if (this.filtro === 'adicionais' && !it.adicional) return false;
      if (this.filtro === 'usados' && !(it.qtd > 0)) return false;
      return !b || semAcento(it.descricao + ' ' + it.codigo + ' ' + it.categoria).includes(b);
    };
    const grupos = [];
    r.itens.forEach((it) => { if (grupos.indexOf(it.grupo) < 0) grupos.push(it.grupo); });
    const linhas = grupos.map((g) => {
      const itens = r.itens.filter((it) => it.grupo === g && filtrar(it));
      if (!itens.length) return '';
      return `<tbody class="grupo-itens">
        <tr class="linha-grupo"><th colspan="5">${esc(g)}</th><th class="num">${moeda(r.grupos[g])}</th><th colspan="2"></th></tr>
        ${itens.map((it) => this.linhaItem(it)).join('')}
      </tbody>`;
    }).join('');
    el('it-tabela').innerHTML = linhas ? `
      <div class="tabela-rolagem">
      <table class="tabela tabela-itens">
        <thead><tr><th>Código</th><th>Descrição</th><th class="num">Qtd</th><th>UN</th><th class="num">R$/UN</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
        ${linhas}
      </table></div>` : '<p class="vazio">Nenhum item com esse filtro.</p>';

    qa('#it-tabela input[data-ajuste]').forEach((inp) => inp.addEventListener('change', () => {
      const id = inp.dataset.id, campo = inp.dataset.ajuste;
      const v = lerNumero(inp.value);
      if (inp.value.trim() !== '' && v === null) { inp.classList.add('campo-erro'); return; }
      const adicional = this.orc.adicionais.find((a) => a.id === id);
      if (adicional) {
        adicional[campo] = v;
      } else {
        const aj = Object.assign({}, this.orc.ajustes[id]);
        if (v === null) delete aj[campo]; else aj[campo] = v;
        if (Object.keys(aj).length) this.orc.ajustes[id] = aj; else delete this.orc.ajustes[id];
      }
      this.aposAlterar(false);
      this.tabelaItens();
    }));
    qa('#it-tabela [data-limpar]').forEach((bt) => bt.addEventListener('click', () => {
      delete this.orc.ajustes[bt.dataset.limpar];
      this.aposAlterar(false);
      this.tabelaItens();
    }));
    qa('#it-tabela [data-remover]').forEach((bt) => bt.addEventListener('click', () => {
      this.orc.adicionais = this.orc.adicionais.filter((a) => a.id !== bt.dataset.remover);
      this.aposAlterar(false);
      this.tabelaItens();
    }));
  },

  linhaItem(it) {
    const aj = this.orc.ajustes[it.id] || {};
    const classeSt = it.status === 'OK' ? 'st-pago' : it.status === 'PENDENTE' ? 'st-atrasado' : 'st-neutro';
    const qtdValor = it.adicional ? numCampo(it.qtd) : numCampo(aj.qtd);
    const precoValor = it.adicional ? numCampo(this.orc.adicionais.find((a) => a.id === it.id).preco) : numCampo(aj.preco);
    const precoBase = it.origem_preco === 'AJUSTE' ? null : it.preco;
    const qtdPlaceholder = it.adicional ? '' : (aj.qtd !== undefined ? '' : (it.qtd === null ? 'pendente' : num2(it.qtd)));
    const precoPlaceholder = it.adicional ? (it.origem_preco === 'SINAPI' ? num2(it.preco) : 'informe') : (precoBase === null ? 'informe' : num2(precoBase));
    const origem = it.origem_preco === 'MANUAL' ? 'preço manual (modelo)' : it.origem_preco === 'AJUSTE' ? 'preço ajustado' : it.origem_preco === 'SINAPI' ? 'SINAPI GO' : '';
    return `<tr class="${it.status === 'PENDENTE' ? 'linha-pendente' : ''}${it.qtd === 0 ? ' linha-zerada' : ''}">
      <td class="cod">${esc(it.codigo || '—')}</td>
      <td class="desc"><span>${esc(it.descricao || '(sem descrição)')}</span>
        <small>${esc(it.categoria)}${origem ? ' · ' + origem : ''}${it.motivo ? ' · <b>' + esc(it.motivo) + '</b>' : ''}</small></td>
      <td class="num"><input class="campo campo-tabela${aj.qtd !== undefined ? ' ajustado' : ''}" type="text" inputmode="decimal" data-id="${esc(it.id)}" data-ajuste="qtd" value="${esc(qtdValor)}" placeholder="${esc(qtdPlaceholder)}" aria-label="Quantidade"></td>
      <td>${esc(it.unidade)}</td>
      <td class="num"><input class="campo campo-tabela${aj.preco !== undefined ? ' ajustado' : ''}${it.status === 'PENDENTE' && it.preco === null ? ' falta' : ''}" type="text" inputmode="decimal" data-id="${esc(it.id)}" data-ajuste="preco" value="${esc(precoValor)}" placeholder="${esc(precoPlaceholder)}" aria-label="Preço unitário"></td>
      <td class="num">${it.status === 'OK' ? moeda(it.total) : '—'}</td>
      <td>${pilula(classeSt, it.status === 'NÃO SE APLICA' ? 'Não se aplica' : it.status === 'OK' ? 'OK' : 'Pendente')}</td>
      <td class="acoes">${it.adicional ? `<button class="botao-fantasma" type="button" data-remover="${esc(it.id)}" title="Remover item adicional">✕</button>`
        : (it.ajustado ? `<button class="botao-fantasma" type="button" data-limpar="${esc(it.id)}" title="Voltar ao calculado">↺</button>` : '')}</td>
    </tr>`;
  },

  modalAdicional() {
    const categorias = Array.from(new Set((dados.modelo.categorias_material || []).map((c) => c.categoria).concat(['Adicionais'])));
    abrirModal('Item adicional', `
      <form id="form-adicional" class="form-grade" novalidate>
        <label class="rotulo">Código SINAPI (opcional)<input id="ad-codigo" class="campo" type="text" inputmode="numeric" placeholder="ex.: 4750"></label>
        <label class="rotulo">Categoria<select id="ad-categoria" class="campo">${opcoesSelect(categorias, 'Adicionais')}</select></label>
        <p class="nota col-2" id="ad-achado">Com código, descrição, unidade e preço vêm da base SINAPI GO. Sem código, preencha tudo.</p>
        <label class="rotulo col-2">Descrição<input id="ad-descricao" class="campo" type="text"></label>
        <label class="rotulo">Unidade<input id="ad-unidade" class="campo" type="text" placeholder="UN, M2, KG…"></label>
        <label class="rotulo">Quantidade<input id="ad-qtd" class="campo" type="text" inputmode="decimal"></label>
        <label class="rotulo">Preço unitário (R$) <small class="nota">vazio = preço SINAPI</small><input id="ad-preco" class="campo" type="text" inputmode="decimal"></label>
        <div class="modal-botoes col-2">
          <button class="botao botao-secundario" type="button" data-acao="fechar-modal">Cancelar</button>
          <button class="botao botao-primario" type="submit">Adicionar</button>
        </div>
      </form>`);
    const achar = () => {
      const cod = el('ad-codigo').value.trim();
      const ref = cod ? dados.indiceSinapi.get(cod) : null;
      el('ad-achado').innerHTML = !cod ? 'Com código, descrição, unidade e preço vêm da base SINAPI GO. Sem código, preencha tudo.'
        : ref ? `<strong>${esc(ref.descricao)}</strong> · ${esc(ref.unidade)} · ${ref.preco ? moeda(ref.preco) : 'sem preço em GO: informe o preço'}`
          : 'Código não encontrado na base SINAPI GO: preencha descrição, unidade e preço.';
      el('ad-descricao').disabled = !!ref; el('ad-unidade').disabled = !!ref;
    };
    el('ad-codigo').addEventListener('input', achar);
    el('form-adicional').addEventListener('submit', (e) => {
      e.preventDefault();
      const qtd = lerNumero(el('ad-qtd').value);
      if (qtd === null) { el('ad-qtd').classList.add('campo-erro'); return; }
      const maior = this.orc.adicionais.reduce((m, a) => Math.max(m, Number(String(a.id).replace(/\D/g, '')) || 0), 0);
      this.orc.adicionais.push({
        id: 'A' + String(maior + 1).padStart(3, '0'),
        codigo: el('ad-codigo').value.trim(),
        categoria: el('ad-categoria').value,
        descricao: el('ad-descricao').value.trim(),
        unidade: el('ad-unidade').value.trim(),
        qtd,
        preco: lerNumero(el('ad-preco').value),
      });
      fecharModal();
      this.aposAlterar(false);
      this.filtro = 'todos';
      this.renderizarAba();
    });
  },

  exportarItens() {
    const p = this.orc.parametros;
    exportarCsv(`orcamento-${this.id || 'novo'}-${semAcento(p.cliente_nome || '').replace(/\W+/g, '-')}`, [
      { rotulo: 'Grupo', valor: (i) => i.grupo }, { rotulo: 'Categoria', valor: (i) => i.categoria },
      { rotulo: 'Código', valor: (i) => i.codigo }, { rotulo: 'Descrição', valor: (i) => i.descricao },
      { rotulo: 'Qtd', valor: (i) => i.qtd === null ? '' : Math.round(i.qtd * 10000) / 10000 }, { rotulo: 'UN', valor: (i) => i.unidade },
      { rotulo: 'R$/UN', valor: (i) => i.preco === null ? '' : i.preco }, { rotulo: 'Total', valor: (i) => i.status === 'OK' ? Math.round(i.total * 100) / 100 : '' },
      { rotulo: 'Origem do preço', valor: (i) => i.origem_preco }, { rotulo: 'Status', valor: (i) => i.status }, { rotulo: 'Motivo', valor: (i) => i.motivo },
    ], this.resultado.itens);
  },

  // ─────────── Aba: Resumo e propostas ───────────
  abaResumo(alvo) {
    const r = this.resultado;
    const com = r.propostas.COM, sem = r.propostas.SEM;
    const gruposOrdem = [];
    r.itens.forEach((it) => { if (gruposOrdem.indexOf(it.grupo) < 0) gruposOrdem.push(it.grupo); });
    alvo.innerHTML = `
      ${!r.completo ? `<div class="alerta alerta-ambar">⚠ Orçamento incompleto: ${r.pendentes} item(ns) pendente(s). Os totais abaixo somam só os itens válidos e a proposta sai marcada como PRÉVIA.</div>` : ''}
      <div class="cards-resumo cards-4">
        <div class="card-numero"><span class="rotulo-card">Área equivalente</span><span class="valor-card">${num2(r.area_equivalente)} m²</span><span class="sub-card">base dos fatores de consumo</span></div>
        <div class="card-numero"><span class="rotulo-card">Mão de obra</span><span class="valor-card">${moeda(r.mao_de_obra)}</span><span class="sub-card">grupo MÃO-DE-OBRA</span></div>
        <div class="card-numero"><span class="rotulo-card">Materiais e demais</span><span class="valor-card">${moeda(r.materiais)}</span><span class="sub-card">todos os outros grupos</span></div>
        <div class="card-numero"><span class="rotulo-card">Administração</span><span class="valor-card">${pct(r.administracao)}</span><span class="sub-card">${this.orc.taxas.usar_bdi ? 'BDI' : 'markup informado'}</span></div>
      </div>
      <div class="detalhe-grade">
        <div class="cartao">
          <div class="cartao-titulo"><h2>Proposta COM material</h2><button class="botao botao-primario botao-pequeno" type="button" data-proposta="COM">Ver proposta</button></div>
          <dl class="lista-dados lista-valores">
            <dt>Mão de obra</dt><dd>${moeda(r.mao_de_obra)}</dd>
            <dt>Administração × custo total</dt><dd>${moeda(r.lucro_com_material)}</dd>
            <dt>Materiais</dt><dd>${moeda(r.materiais)}</dd>
            <dt>Proteção econômica (${pct(com.protecao)})</dt><dd>${com.materiais_corrigido === null ? '—' : moeda(com.materiais_corrigido - r.materiais)}</dd>
            <dt class="total">Total</dt><dd class="total">${moeda(com.total)}</dd>
          </dl>
          ${!com.rateio_ok ? '<p class="aviso-erro">Os % por fase (cfg_rateio COM) não somam 100%.</p>' : ''}
        </div>
        <div class="cartao">
          <div class="cartao-titulo"><h2>Proposta SEM material</h2><button class="botao botao-primario botao-pequeno" type="button" data-proposta="SEM">Ver proposta</button></div>
          <dl class="lista-dados lista-valores">
            <dt>Mão de obra</dt><dd>${moeda(r.mao_de_obra)}</dd>
            <dt>Administração × mão de obra</dt><dd>${moeda(r.lucro_sem_material)}</dd>
            <dt class="total">Total</dt><dd class="total">${moeda(sem.total)}</dd>
          </dl>
          ${!sem.rateio_ok ? '<p class="aviso-erro">Os % por fase (cfg_rateio SEM) não somam 100%.</p>' : ''}
        </div>
      </div>
      <div class="cartao">
        <div class="cartao-titulo"><h2>Custo por grupo</h2><span class="nota">base para comparar com os gastos da obra (fase 3)</span></div>
        <div class="tabela-rolagem"><table class="tabela">
          <thead><tr><th>Grupo</th><th class="num">Custo</th><th class="num">% do subtotal</th></tr></thead>
          <tbody>${gruposOrdem.map((g) => `<tr><td>${esc(g)}</td><td class="num">${moeda(r.grupos[g])}</td><td class="num">${r.subtotal_valido ? pct(r.grupos[g] / r.subtotal_valido) : '—'}</td></tr>`).join('')}
            <tr class="linha-total"><td>Subtotal válido</td><td class="num">${moeda(r.subtotal_valido)}</td><td class="num">100,00%</td></tr></tbody>
        </table></div>
      </div>`;
    alvo.querySelectorAll('[data-proposta]').forEach((b) => b.addEventListener('click', () => abrirProposta(b.dataset.proposta)));
  },

  // ─────────── Aba: Validação ───────────
  abaValidacao(alvo) {
    const r = this.resultado;
    alvo.innerHTML = `
      <div class="cartao">
        <div class="cartao-titulo"><h2>${r.pode_emitir ? '✔ Pronto para emitir' : 'Antes de emitir'}</h2>
          <span class="nota">OK não substitui a revisão profissional.</span></div>
        <ul class="validacao">
          ${r.validacao.map((v) => `<li class="${v.ok ? 'ok' : 'pend'}"><span class="marca">${v.ok ? '✔' : '!'}</span><div><strong>${esc(v.item)}</strong>${v.ok ? '' : `<small>${esc(v.acao)}</small>`}</div></li>`).join('')}
        </ul>
      </div>`;
  },

  // ─────────── Salvar, duplicar, excluir ───────────
  async salvar() {
    const p = this.orc.parametros;
    if (!String(p.cliente_nome || '').trim()) {
      toast('Informe o nome do cliente.', 'erro');
      this.aba = 'dados';
      qa('.abas .aba').forEach((x) => x.classList.toggle('ativa', x.dataset.aba === 'dados'));
      this.renderizarAba();
      setTimeout(() => el('p-cliente_nome') && el('p-cliente_nome').focus(), 30);
      return;
    }
    const r = this.calcular();
    const botao = el('ed-salvar');
    botao.disabled = true; botao.textContent = 'Salvando…';
    try {
      const s = await api('saveOrcamento', {
        id: this.id,
        versao: this.versao,
        dados: this.orc,
        resumo: {
          subtotal: r.subtotal_valido, total_com_material: r.propostas.COM.total, total_sem_material: r.propostas.SEM.total,
          pendencias: r.pendencias_emissao, competencia_sinapi: r.competencia_sinapi,
        },
        itens: r.itens.map((it) => ({
          id: it.id, ordem: it.ordem, grupo: it.grupo, categoria: it.categoria, codigo: it.codigo, descricao: it.descricao,
          unidade: it.unidade, qtd: it.qtd, preco: it.preco, origem_preco: it.origem_preco, total: it.total, status: it.status, motivo: it.motivo,
        })),
      });
      const novo = !this.id;
      this.id = s.id; this.versao = s.versao; this.salvoCom = r.competencia_sinapi; this.rotaParametro = s.id;
      this.alterado = false;
      dados.lista = null;
      toast(novo ? 'Orçamento ' + s.id + ' criado.' : 'Orçamento salvo.');
      if (novo) { history.replaceState(null, '', '#/orcamentos/' + s.id); this.renderizar(); }
      else { botao.textContent = 'Salvo'; }
    } catch (erro) {
      botao.disabled = false; botao.textContent = 'Salvar';
      if (erro.codigo !== 'SESSAO') toast(erro.message, 'erro', 6000);
    }
  },

  async duplicar() {
    if (this.alterado && !(await confirmar('Duplicar sem salvar?', 'A cópia leva as alterações atuais, mas este orçamento continua sem elas até você salvar.', { ok: 'Duplicar' }))) return;
    const copia = JSON.parse(JSON.stringify(this.orc));
    copia.status = 'Rascunho';
    copia.parametros.cliente_nome = (copia.parametros.cliente_nome || '') + ' (cópia)';
    copia.parametros.data_orcamento = hojeIso();
    copia.confirmacoes = { coeficientes_revisados: false, precos_revisados: false };
    // A cópia é um orçamento novo: não leva o andamento da obra nem os pagamentos recebidos.
    if (copia.cronograma) copia.cronograma.execucao = {};
    copia.pagamentos = {};
    if (copia.contrato) copia.contrato.data_base = '';
    this.alterado = false;
    history.replaceState(null, '', '#/orcamentos/novo');
    app.rotaAtual = 'orcamento';
    this.id = null; this.versao = null; this.rotaParametro = 'novo'; this.salvoCom = '';
    this.orc = copia;
    this.calcular();
    this.renderizar();
    this.marcarAlterado();
    toast('Cópia criada. Ajuste e salve.', 'info');
  },

  async excluir() {
    if (!(await confirmar('Excluir orçamento?', `O orçamento ${this.id} sai da lista (continua guardado na planilha, marcado como inativo).`, { ok: 'Excluir', perigo: true }))) return;
    try {
      await api('deleteOrcamento', { id: this.id });
      this.alterado = false;
      dados.lista = null;
      toast('Orçamento excluído.');
      location.hash = '#/orcamentos';
    } catch (erro) {
      if (erro.codigo !== 'SESSAO') toast(erro.message, 'erro');
    }
  },
};
window.editor = editor;
