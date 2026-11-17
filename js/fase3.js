'use strict';
/**
 * fase3.js — aba Gastos do editor (abas "Controle de Gastos" e "DASHBOARD" da planilha) e o
 * Relatório da obra para imprimir. O cálculo fica em gastos.js (função pura); aqui só tela.
 *
 * Os gastos NÃO ficam no dados_json do orçamento: cada lançamento é uma linha da aba db_gastos,
 * gravada na hora pelo Apps Script (não depende do botão Salvar do orçamento).
 */

const STATUS_GRUPO = { OK: 'st-pago', ACIMA: 'st-atrasado', 'SEM ORÇAMENTO': 'st-breve' };
const MSG_GASTOS_APPS_SCRIPT = 'Para lançar gastos, atualize o Apps Script: crie o arquivo Gastos e cole de novo Code, Db, Setup e Orcamentos; rode setupPlanilha e publique uma nova versão.';

/** Gasto × orçado a partir do resultado do motor, da fase 2 e dos lançamentos. */
function calcularFase3(orc, r, f2, gastos) {
  const mod = orc.contrato && orc.contrato.modalidade === 'SEM' ? 'SEM' : 'COM';
  return Gastos.resumo({
    gastos: gastos || [],
    orcado: r.grupos,
    total_contrato: r.propostas[mod].total,
    data_inicio: f2.crono.inicio,
    fim: f2.crono.fim,
    parcelas: f2.parcelas.ok ? f2.parcelas.lista : [],
    pct_fisico: f2.crono.pct_geral,
  });
}

/** Grupos do modelo (ordem da Lista de Materiais) + os que já têm lançamento. */
function gruposDeGasto(gastos) {
  const lista = [];
  ((dados.modelo && dados.modelo.itens) || []).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
    .forEach((i) => { if (i.grupo && !lista.includes(i.grupo)) lista.push(i.grupo); });
  if (!lista.includes('ADICIONAIS')) lista.push('ADICIONAIS');
  (gastos || []).forEach((g) => { if (g.grupo && !lista.includes(g.grupo)) lista.push(g.grupo); });
  return lista;
}

const mesBr = (m) => {
  const [a, n] = m.split('-');
  return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(n) - 1] + '/' + a.slice(2);
};
const sinal = (v) => (v < 0 ? ' class="erro-campo"' : '');

Object.assign(editor, {
  gastos: [],
  gastosErro: '',
  gastoEdicao: null,
  filtroGasto: { grupo: '', mes: '', busca: '' },

  async carregarGastos() {
    this.gastos = []; this.gastosErro = ''; this.gastoEdicao = null;
    if (!this.id) return;
    try {
      this.gastos = await api('listGastos', { orcamento_id: this.id });
    } catch (erro) {
      if (erro.codigo === 'SESSAO') throw erro;
      this.gastosErro = /desconhecida|não existe/i.test(erro.message) ? MSG_GASTOS_APPS_SCRIPT : erro.message;
    }
  },

  atualizarGastos() {
    this.fase3 = calcularFase3(this.orc, this.resultado, this.fase2, this.gastos);
    dados.lista = null; // total gasto da lista de orçamentos mudou
    this.atualizarResumo();
    this.renderizarAba();
  },

  // ─────────── Aba: Gastos ───────────
  abaGastos(alvo) {
    if (!this.id) {
      alvo.innerHTML = '<div class="alerta alerta-ambar">Salve o orçamento para começar a lançar os gastos da obra.</div>';
      return;
    }
    if (this.gastosErro) {
      alvo.innerHTML = `<div class="alerta alerta-ambar">${esc(this.gastosErro)}</div>`;
      return;
    }
    const s = this.fase3;
    const mod = this.orc.contrato.modalidade === 'SEM' ? 'sem material' : 'com material';
    const ritmo = s.desvio === null || !s.total_gasto ? '' : s.desvio > 0.1 ? ' card-atraso' : '';
    alvo.innerHTML = `
      <div class="cards-resumo cards-4">
        <div class="card-numero"><span class="rotulo-card">Contrato</span><span class="valor-card">${moeda(s.total_contrato)}</span>
          <span class="sub-card">${s.total_contrato === null ? 'preencha as taxas comerciais (aba Dados) · ' : mod + ' · '}custo orçado ${moeda(s.custo_orcado)}</span></div>
        <div class="card-numero${ritmo}"><span class="rotulo-card">Total gasto</span><span class="valor-card">${moeda(s.total_gasto)}</span>
          <span class="sub-card">${s.pct_gasto === null ? '—' : pct(s.pct_gasto) + ' do custo'} · obra ${pct(s.pct_fisico || 0)} concluída</span></div>
        <div class="card-numero${s.saldo_contrato < 0 ? ' card-atraso' : ''}"><span class="rotulo-card">Saldo do contrato</span><span class="valor-card">${moeda(s.saldo_contrato)}</span>
          <span class="sub-card">contrato − gasto · margem prevista ${moeda(s.margem_prevista)}</span></div>
        <div class="card-numero${s.caixa < 0 ? ' card-atraso' : ''}"><span class="rotulo-card">Caixa da obra</span><span class="valor-card">${moeda(s.caixa)}</span>
          <span class="sub-card">recebido ${moeda(s.recebido)} − gasto</span></div>
      </div>
      ${ritmo ? `<div class="alerta alerta-ambar">Já foi gasto ${pct(s.pct_gasto)} do custo orçado, mas o cronograma marca ${pct(s.pct_fisico || 0)} da obra concluída. Confira os grupos acima do orçado e o andamento das etapas.</div>` : ''}
      ${this.formGasto()}
      <div class="cartao">
        <div class="cartao-titulo"><h2>Gasto × orçado por grupo</h2>
          <button class="botao botao-secundario botao-pequeno" type="button" id="gs-relatorio">Relatório da obra</button></div>
        <p class="nota">Orçado = custo do grupo na lista de itens (sem administração nem proteção), como no DASHBOARD da planilha.</p>
        <div class="tabela-rolagem"><table class="tabela tabela-gastos">
          <thead><tr><th>Grupo</th><th class="num">Orçado</th><th class="num">Gasto</th><th class="num">Saldo</th><th class="col-barra">Consumido</th><th>Situação</th></tr></thead>
          <tbody>${s.grupos.map((g) => `<tr class="${g.status === 'OK' ? '' : 'linha-pendente'}">
            <td>${esc(g.grupo)}${g.lancamentos ? ` <small class="nota">(${g.lancamentos})</small>` : ''}</td>
            <td class="num">${moeda(g.orcado)}</td><td class="num">${moeda(g.gasto)}</td><td class="num"><span${sinal(g.saldo)}>${moeda(g.saldo)}</span></td>
            <td class="col-barra">${g.pct === null ? '—' : `<span class="barra-pct${g.pct > 1 ? ' estouro' : ''}"><i style="width:${Math.min(100, g.pct * 100)}%"></i></span><small>${pct(g.pct)}</small>`}</td>
            <td>${pilula(STATUS_GRUPO[g.status], g.status)}</td></tr>`).join('')}</tbody>
          <tfoot><tr class="linha-total"><td>Total</td><td class="num">${moeda(s.custo_orcado)}</td><td class="num">${moeda(s.total_gasto)}</td>
            <td class="num"><span${sinal(s.custo_orcado - s.total_gasto)}>${moeda(s.custo_orcado - s.total_gasto)}</span></td><td class="col-barra">${s.pct_gasto === null ? '' : pct(s.pct_gasto)}</td><td></td></tr></tfoot>
        </table></div>
      </div>
      ${s.meses.length ? `
      <div class="cartao">
        <div class="cartao-titulo"><h2>Mês a mês</h2><span class="nota">Recebido = parcelas com "Pago em" na aba Pagamento.</span></div>
        ${this.graficoMeses(s.meses)}
        <div class="tabela-rolagem"><table class="tabela">
          <thead><tr><th>Mês</th><th class="num">Gasto</th><th class="num">Recebido</th><th class="num">Saldo do mês</th><th class="num">Gasto acumulado</th><th class="num">Caixa acumulado</th></tr></thead>
          <tbody>${s.meses.map((m) => `<tr${m.mes === hojeIso().slice(0, 7) ? ' class="linha-atual"' : ''}><td>${mesBr(m.mes)}</td><td class="num">${moeda(m.gasto)}</td><td class="num">${moeda(m.recebido)}</td>
            <td class="num"><span${sinal(m.saldo)}>${moeda(m.saldo)}</span></td><td class="num">${moeda(m.gasto_acum)}</td><td class="num"><span${sinal(m.caixa)}>${moeda(m.caixa)}</span></td></tr>`).join('')}</tbody>
        </table></div>
      </div>` : ''}
      <div class="cartao">
        <div class="cartao-titulo"><h2>Lançamentos</h2>
          <button class="botao botao-secundario botao-pequeno" type="button" id="gs-csv"${this.gastos.length ? '' : ' disabled'}>Exportar CSV</button></div>
        <div class="barra-ferramentas">
          <input id="gs-busca" class="campo" type="search" placeholder="Buscar descrição ou fornecedor…" value="${esc(this.filtroGasto.busca)}">
          <select id="gs-f-grupo" class="campo">${opcoesSelect(gruposDeGasto(this.gastos).filter((g) => this.gastos.some((x) => x.grupo === g)), this.filtroGasto.grupo, 'Todos os grupos')}</select>
          <select id="gs-f-mes" class="campo">${opcoesSelect([...new Set(this.gastos.map((g) => g.data.slice(0, 7)))].sort().reverse().map((m) => ({ valor: m, rotulo: mesBr(m) })), this.filtroGasto.mes, 'Todos os meses')}</select>
        </div>
        <div class="tabela-rolagem" id="gs-lista"></div>
      </div>`;

    this.ligarFormGasto(alvo);
    el('gs-relatorio').addEventListener('click', () => abrirRelatorioObra());
    el('gs-csv').addEventListener('click', () => this.exportarGastos());
    el('gs-busca').addEventListener('input', debounce((ev) => { this.filtroGasto.busca = ev.target.value; this.listaGastos(); }, 150));
    el('gs-f-grupo').addEventListener('change', (ev) => { this.filtroGasto.grupo = ev.target.value; this.listaGastos(); });
    el('gs-f-mes').addEventListener('change', (ev) => { this.filtroGasto.mes = ev.target.value; this.listaGastos(); });
    this.listaGastos();
  },

  graficoMeses(meses) {
    const maior = Math.max(1, ...meses.map((m) => Math.max(m.gasto, m.recebido)));
    return `<div class="grafico-meses" role="img" aria-label="Gasto e recebido por mês">
      ${meses.map((m) => `<div class="gm-col" title="${mesBr(m.mes)} · gasto ${moeda(m.gasto)} · recebido ${moeda(m.recebido)}">
        <div class="gm-barras"><i class="gm-recebido" style="height:${(m.recebido / maior) * 100}%"></i><i class="gm-gasto" style="height:${(m.gasto / maior) * 100}%"></i></div>
        <span>${mesBr(m.mes)}</span></div>`).join('')}
    </div>
    <div class="gm-legenda"><span><i class="gm-recebido"></i>Recebido</span><span><i class="gm-gasto"></i>Gasto</span></div>`;
  },

  formGasto() {
    const g = this.gastoEdicao ? this.gastos.find((x) => x.id === this.gastoEdicao) : null;
    const v = g || { data: hojeIso(), grupo: '', descricao: '', fornecedor: '', qtd: null, unidade: '', valor_unitario: null, observacao: '' };
    return `
      <div class="cartao${g ? ' cartao-edicao' : ''}" id="gs-form-cartao">
        <div class="cartao-titulo"><h2>${g ? 'Editar gasto ' + esc(g.id) : 'Lançar gasto'}</h2><span class="nota">Grava na hora, sem precisar salvar o orçamento.</span></div>
        <form id="gs-form" class="grade-campos" novalidate>
          <label class="rotulo">Data<input id="gs-data" class="campo" type="date" value="${esc(v.data)}" required></label>
          <label class="rotulo">Grupo<select id="gs-grupo" class="campo" required>${opcoesSelect(gruposDeGasto(this.gastos), v.grupo, 'Escolha…')}</select></label>
          <label class="rotulo largo">Descrição<input id="gs-desc" class="campo" type="text" maxlength="300" value="${esc(v.descricao)}" placeholder="Ex.: Cimento CP-II 50 kg" required></label>
          <label class="rotulo">Fornecedor<input id="gs-forn" class="campo" type="text" maxlength="120" value="${esc(v.fornecedor)}"></label>
          <label class="rotulo">Quantidade<input id="gs-qtd" class="campo campo-num" type="text" inputmode="decimal" value="${esc(numCampo(v.qtd))}" placeholder="1"></label>
          <label class="rotulo">Unidade<input id="gs-un" class="campo" type="text" maxlength="12" value="${esc(v.unidade)}" placeholder="un, saco, m³, h…"></label>
          <label class="rotulo">Valor unitário (R$)<input id="gs-unit" class="campo campo-num" type="text" inputmode="decimal" value="${esc(numCampo(v.valor_unitario))}" required></label>
          <div class="rotulo">Total<strong id="gs-total" class="gs-total">—</strong></div>
          <label class="rotulo largo">Observação<input id="gs-obs" class="campo" type="text" maxlength="500" value="${esc(v.observacao)}" placeholder="Nº da nota, forma de pagamento…"></label>
          <div class="gs-acoes largo">
            <button class="botao botao-primario" type="submit" id="gs-salvar">${g ? 'Salvar alteração' : 'Lançar'}</button>
            ${g ? '<button class="botao botao-secundario" type="button" id="gs-cancelar">Cancelar</button>' : ''}
          </div>
        </form>
      </div>`;
  },

  ligarFormGasto(alvo) {
    const total = () => {
      const qtd = el('gs-qtd').value.trim() === '' ? 1 : lerNumero(el('gs-qtd').value);
      const unit = lerNumero(el('gs-unit').value);
      el('gs-total').textContent = qtd !== null && unit !== null ? moeda(Math.round(qtd * unit * 100) / 100) : '—';
    };
    ['gs-qtd', 'gs-unit'].forEach((id) => el(id).addEventListener('input', total));
    total();
    el('gs-form').addEventListener('submit', (ev) => { ev.preventDefault(); this.salvarGasto(); });
    if (el('gs-cancelar')) el('gs-cancelar').addEventListener('click', () => { this.gastoEdicao = null; this.renderizarAba(); });
  },

  async salvarGasto() {
    const gasto = {
      id: this.gastoEdicao || '',
      orcamento_id: this.id,
      data: el('gs-data').value,
      grupo: el('gs-grupo').value,
      descricao: el('gs-desc').value.trim(),
      fornecedor: el('gs-forn').value.trim(),
      qtd: el('gs-qtd').value.trim() === '' ? null : lerNumero(el('gs-qtd').value),
      unidade: el('gs-un').value.trim(),
      valor_unitario: lerNumero(el('gs-unit').value),
      observacao: el('gs-obs').value.trim(),
    };
    const falta = !gasto.data ? ['gs-data', 'Informe a data.'] : !gasto.grupo ? ['gs-grupo', 'Escolha o grupo.']
      : !gasto.descricao ? ['gs-desc', 'Descreva o gasto.']
      : (el('gs-qtd').value.trim() !== '' && !(gasto.qtd > 0)) ? ['gs-qtd', 'Quantidade inválida.']
      : (gasto.valor_unitario === null || gasto.valor_unitario < 0) ? ['gs-unit', 'Informe o valor unitário.'] : null;
    if (falta) { toast(falta[1], 'erro'); el(falta[0]).focus(); return; }

    const botao = el('gs-salvar');
    botao.disabled = true; botao.textContent = 'Gravando…';
    try {
      const salvo = await api('saveGasto', { gasto });
      const i = this.gastos.findIndex((x) => x.id === salvo.id);
      if (i >= 0) this.gastos[i] = salvo; else this.gastos.push(salvo);
      this.gastos.sort((a, b) => (a.data === b.data ? (a.id < b.id ? -1 : 1) : (a.data < b.data ? -1 : 1)));
      toast(this.gastoEdicao ? 'Gasto alterado.' : 'Gasto ' + salvo.id + ' lançado: ' + moeda(salvo.total) + '.');
      this.gastoEdicao = null;
      this.atualizarGastos();
      setTimeout(() => el('gs-desc') && el('gs-desc').focus(), 30);
    } catch (erro) {
      botao.disabled = false; botao.textContent = this.gastoEdicao ? 'Salvar alteração' : 'Lançar';
      if (erro.codigo !== 'SESSAO') toast(erro.message, 'erro', 6000);
    }
  },

  gastosFiltrados() {
    const f = this.filtroGasto;
    const b = semAcento(f.busca);
    return this.gastos.filter((g) => (!f.grupo || g.grupo === f.grupo) && (!f.mes || g.data.startsWith(f.mes)) &&
      (!b || semAcento([g.descricao, g.fornecedor, g.observacao, g.id].join(' ')).includes(b)));
  },

  listaGastos() {
    const alvo = el('gs-lista');
    if (!this.gastos.length) { alvo.innerHTML = '<p class="vazio">Nenhum gasto lançado ainda.</p>'; return; }
    const lista = this.gastosFiltrados().slice().reverse(); // mais recentes primeiro
    alvo.innerHTML = `
      <table class="tabela tabela-responsiva">
        <thead><tr><th>Data</th><th>Grupo</th><th>Descrição</th><th class="num">Qtd</th><th class="num">R$/un</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${lista.map((g) => `<tr${g.id === this.gastoEdicao ? ' class="linha-atual"' : ''}>
          <td data-rotulo="Data">${dataBr(g.data)}</td>
          <td data-rotulo="Grupo">${esc(g.grupo)}</td>
          <td class="principal-cel quebra"><strong>${esc(g.descricao)}</strong><small>${esc([g.fornecedor, g.observacao].filter(Boolean).join(' · ') || g.id)}</small></td>
          <td class="num" data-rotulo="Qtd">${esc(numCampo(g.qtd))} ${esc(g.unidade || '')}</td>
          <td class="num" data-rotulo="R$/un">${moeda(g.valor_unitario)}</td>
          <td class="num" data-rotulo="Total"><strong>${moeda(g.total)}</strong></td>
          <td class="acoes-linha"><button class="botao botao-secundario botao-pequeno" type="button" data-editar="${esc(g.id)}">Editar</button>
            <button class="botao botao-secundario botao-pequeno" type="button" data-excluir="${esc(g.id)}" aria-label="Excluir ${esc(g.descricao)}">Excluir</button></td>
        </tr>`).join('') || '<tr><td colspan="7" class="vazio">Nada encontrado com esse filtro.</td></tr>'}</tbody>
        <tfoot><tr class="linha-total"><td colspan="5">${lista.length} lançamento(s)${lista.length !== this.gastos.length ? ' no filtro' : ''}</td><td class="num">${moeda(lista.reduce((s, g) => s + g.total, 0))}</td><td></td></tr></tfoot>
      </table>`;
    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
      this.gastoEdicao = b.dataset.editar;
      this.renderizarAba();
      el('gs-form-cartao').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', () => this.excluirGasto(b.dataset.excluir)));
  },

  async excluirGasto(id) {
    const g = this.gastos.find((x) => x.id === id);
    if (!g) return;
    if (!(await confirmar('Excluir gasto?', `${g.descricao} — ${moeda(g.total)} em ${dataBr(g.data)}. Sai do controle (continua na planilha, marcado como inativo).`, { ok: 'Excluir', perigo: true }))) return;
    try {
      await api('deleteGasto', { id });
      this.gastos = this.gastos.filter((x) => x.id !== id);
      if (this.gastoEdicao === id) this.gastoEdicao = null;
      toast('Gasto excluído.');
      this.atualizarGastos();
    } catch (erro) {
      if (erro.codigo !== 'SESSAO') toast(erro.message, 'erro');
    }
  },

  exportarGastos() {
    const nome = 'gastos-' + this.id + '-' + semAcento(this.orc.parametros.cliente_nome || '').replace(/[^a-z0-9]+/g, '-');
    exportarCsv(nome, [
      { rotulo: 'Nº', valor: (g) => g.id }, { rotulo: 'Data', valor: (g) => dataBr(g.data) }, { rotulo: 'Grupo', valor: (g) => g.grupo },
      { rotulo: 'Descrição', valor: (g) => g.descricao }, { rotulo: 'Fornecedor', valor: (g) => g.fornecedor },
      { rotulo: 'Qtde', valor: (g) => g.qtd }, { rotulo: 'UM', valor: (g) => g.unidade }, { rotulo: 'R$/UN', valor: (g) => g.valor_unitario },
      { rotulo: 'R$ TOTAL', valor: (g) => g.total }, { rotulo: 'Observação', valor: (g) => g.observacao },
      { rotulo: 'Lançado por', valor: (g) => g.atualizado_por },
    ], this.gastosFiltrados());
  },
});

/** Relatório da obra (aba RELATORIO_OBRA da planilha): financeiro, gasto × orçado, meses, etapas e parcelas. */
function abrirRelatorioObra() {
  const orc = editor.orc;
  const p = orc.parametros;
  const e = dados.modelo.empresa || {};
  const s = editor.fase3;
  const { crono, parcelas: pr } = editor.fase2;
  const mod = orc.contrato.modalidade === 'SEM' ? 'sem material' : 'com material';
  // No papel, só até o mês atual (ou o último com movimento): os meses futuros estão zerados.
  const comMovimento = s.meses.filter((m) => m.gasto || m.recebido).map((m) => m.mes);
  const limite = [hojeIso().slice(0, 7)].concat(comMovimento).sort().pop();
  const meses = s.meses.filter((m) => m.mes <= limite);

  el('impressao-folha').innerHTML = `
    ${cabecalhoFolha(e)}
    <h1 class="pr-titulo">Relatório da obra <span>posição em ${dataBr(hojeIso())}</span></h1>

    <dl class="pr-dados">
      <dt>Cliente</dt><dd>${esc(p.cliente_nome || '—')}</dd>
      <dt>Endereço da obra</dt><dd>${esc([p.endereco_obra, p.cidade].filter(Boolean).join(' — ') || '—')}</dd>
      <dt>Orçamento</dt><dd>${esc(editor.id || '—')} · ${p.area ? num2(p.area) + ' m²' : '—'} · ${mod}</dd>
      <dt>Prazo</dt><dd>${dataBr(crono.inicio)} a ${dataBr(crono.fim)}${crono.prazo_dias !== null ? ' (' + crono.prazo_dias + ' dias)' : ''}</dd>
      <dt>Andamento</dt><dd>${pct(crono.pct_geral)} concluído · ${esc(crono.situacao)}${crono.atrasadas ? ' · ' + crono.atrasadas + ' etapa(s) atrasada(s)' : ''}</dd>
    </dl>

    <section class="pr-secao rl-secao">
      <h2>Resumo financeiro</h2>
      <table class="pr-tabela rl-resumo">
        <tbody>
          <tr><td>Valor do contrato</td><td class="num">${moeda(s.total_contrato)}</td></tr>
          <tr><td>Recebido do cliente</td><td class="num">${moeda(s.recebido)}</td></tr>
          <tr><td>A receber</td><td class="num">${moeda(s.total_contrato === null ? null : s.total_contrato - s.recebido)}</td></tr>
          <tr><td>Custo orçado (lista de itens)</td><td class="num">${moeda(s.custo_orcado)}</td></tr>
          <tr><td>Total gasto</td><td class="num">${moeda(s.total_gasto)}${s.pct_gasto === null ? '' : ' <small>(' + pct(s.pct_gasto) + ' do custo)</small>'}</td></tr>
        </tbody>
        <tfoot>
          <tr><td>Saldo do contrato (contrato − gasto)</td><td class="num">${moeda(s.saldo_contrato)}</td></tr>
          <tr class="sub"><td>Caixa da obra (recebido − gasto)</td><td class="num">${moeda(s.caixa)}</td></tr>
        </tfoot>
      </table>
    </section>

    <section class="pr-secao rl-secao">
      <h2>Gasto × orçado por grupo</h2>
      ${s.grupos.length ? `<table class="pr-tabela rl-grupos">
        <thead><tr><th>Grupo</th><th class="num">Orçado</th><th class="num">Gasto</th><th class="num">Saldo</th><th class="num">%</th><th>Situação</th></tr></thead>
        <tbody>${s.grupos.map((g) => `<tr${g.status === 'OK' ? '' : ' class="rl-acima"'}><td>${esc(g.grupo)}</td><td class="num">${moeda(g.orcado)}</td><td class="num">${moeda(g.gasto)}</td>
          <td class="num">${moeda(g.saldo)}</td><td class="num">${g.pct === null ? '—' : pct(g.pct)}</td><td>${esc(g.status)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${moeda(s.custo_orcado)}</td><td class="num">${moeda(s.total_gasto)}</td><td class="num">${moeda(s.custo_orcado - s.total_gasto)}</td><td class="num">${s.pct_gasto === null ? '' : pct(s.pct_gasto)}</td><td></td></tr></tfoot>
      </table>` : '<p>Nenhum grupo com orçamento.</p>'}
    </section>

    ${meses.length ? `
    <section class="pr-secao rl-secao">
      <h2>Mês a mês</h2>
      <table class="pr-tabela rl-meses">
        <thead><tr><th>Mês</th><th class="num">Gasto</th><th class="num">Recebido</th><th class="num">Saldo do mês</th><th class="num">Caixa acumulado</th></tr></thead>
        <tbody>${meses.map((m) => `<tr><td>${mesBr(m.mes)}</td><td class="num">${moeda(m.gasto)}</td><td class="num">${moeda(m.recebido)}</td><td class="num">${moeda(m.saldo)}</td><td class="num">${moeda(m.caixa)}</td></tr>`).join('')}</tbody>
      </table>
    </section>` : ''}

    ${crono.fim ? `
    <section class="pr-secao rl-secao">
      <h2>Andamento das etapas</h2>
      <table class="pr-tabela rl-etapas">
        <thead><tr><th>Etapa</th><th>Início</th><th>Término</th><th>Concluída em</th><th class="num">%</th><th>Situação</th></tr></thead>
        <tbody>${crono.etapas.filter((x) => x.inicio).map((x) => `<tr><td>${esc(x.etapa)}</td><td>${dataBr(x.inicio)}</td><td>${dataBr(x.fim)}</td><td>${x.conclusao ? dataBr(x.conclusao) : ''}</td><td class="num">${pct(x.pct)}</td><td>${esc(x.status)}</td></tr>`).join('')}</tbody>
      </table>
    </section>` : ''}

    ${pr.ok ? `
    <section class="pr-secao rl-secao">
      <h2>Parcelas</h2>
      <table class="pr-tabela rl-parcelas">
        <thead><tr><th>Parcela</th><th>Vencimento</th><th class="num">Valor</th><th>Pago em</th><th>Situação</th></tr></thead>
        <tbody>${pr.lista.map((x) => `<tr><td>${esc(x.rotulo)}</td><td>${dataBr(x.vencimento)}</td><td class="num">${moeda(x.valor)}</td><td>${x.pago_em ? dataBr(x.pago_em) : ''}</td><td>${esc(x.status)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Recebido / total</td><td class="num">${moeda(pr.recebido)}</td><td colspan="2">de ${moeda(pr.total)}</td></tr></tfoot>
      </table>
    </section>` : ''}

    <footer class="pr-assinatura rl-assinatura">
      <div class="linha-assinatura"></div>
      <strong>${esc(e.responsavel_tecnico || '')}</strong>
      <span>${esc(e.razao_social || '')}</span>
    </footer>`;

  document.title = `Relatório da obra - ${p.cliente_nome || 'cliente'}`;
  el('impressao').hidden = false;
  document.body.classList.add('modo-impressao');
  el('impressao').scrollTop = 0;
}
