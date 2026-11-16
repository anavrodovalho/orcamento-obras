'use strict';
/**
 * fase2.js — abas Cronograma, Pagamento e Contrato do editor de orçamento.
 * O cálculo fica em cronograma.js e contrato.js (funções puras); aqui só tela.
 *
 * Dados guardados no orçamento (dados_json):
 *   orc.cronograma = { ajustes: { E01: dias }, execucao: { E01: { conclusao, pct } } }
 *   orc.contrato   = { modalidade: 'COM' | 'SEM', data_base, atividades }
 *   orc.pagamentos = { 0: { pago_em }, 1: { pago_em }, … }   (0 = entrada)
 */

const STATUS_ETAPA = {
  'CONCLUÍDA': 'st-pago', 'CONCLUÍDA COM ATRASO': 'st-pago', 'EM ANDAMENTO': 'st-vencer',
  'ATRASADA': 'st-atrasado', 'A INICIAR': 'st-neutro', 'NÃO SE APLICA': 'st-neutro', 'SEM DATA': 'st-breve', 'ERRO': 'st-atrasado',
};
const STATUS_PARCELA = { PAGA: 'st-pago', VENCIDA: 'st-atrasado', 'A VENCER': 'st-vencer' };
const SITUACAO_OBRA = { 'EM PRAZO': 'st-vencer', 'PRAZO VENCIDO': 'st-atrasado', 'CONCLUÍDA': 'st-pago', PENDENTE: 'st-breve' };

/** Completa um orçamento (novo ou antigo, da fase 1) com os campos da fase 2. */
function completarFase2(orc) {
  orc.cronograma = Object.assign({ ajustes: {}, execucao: {} }, orc.cronograma || {});
  orc.cronograma.ajustes = orc.cronograma.ajustes || {};
  orc.cronograma.execucao = orc.cronograma.execucao || {};
  orc.contrato = Object.assign({ modalidade: 'COM', data_base: '', atividades: '' }, orc.contrato || {});
  orc.pagamentos = orc.pagamentos || {};
  return orc;
}

/** Cronograma, parcelas e contrato a partir do orçamento e do resultado do motor. */
function calcularFase2(orc, r) {
  completarFase2(orc);
  const p = orc.parametros;
  const hoje = hojeIso();
  const vars = Motor.variaveis(p);
  const crono = Cronograma.calcular({
    etapas: (dados.modelo && dados.modelo.cronograma) || [], vars, data_inicio: p.data_inicio,
    ajustes: orc.cronograma.ajustes, execucao: orc.cronograma.execucao, hoje,
  });
  const mod = orc.contrato.modalidade === 'SEM' ? 'SEM' : 'COM';
  const parcelas = Cronograma.parcelas({
    total: r.propostas[mod].total, adiantamento: orc.taxas.adiantamento,
    data_base: orc.contrato.data_base || p.data_inicio, fim: crono.fim, intervalo: orc.taxas.intervalo,
    pagamentos: orc.pagamentos, hoje,
  });
  const contrato = Contrato.montar({ modelo: dados.modelo, orc, resultado: r, crono, parcelas, vars });
  return { crono, parcelas, contrato };
}

Object.assign(editor, {

  // ─────────── Aba: Cronograma ───────────
  abaCronograma(alvo) {
    const c = this.fase2.crono;
    const p = this.orc.parametros;
    const exec = this.orc.cronograma.execucao;
    const ajustes = this.orc.cronograma.ajustes;
    if (!((dados.modelo && dados.modelo.cronograma) || []).length) {
      alvo.innerHTML = '<div class="alerta alerta-ambar">A aba <strong>cfg_cronograma</strong> não existe ou está vazia. Atualize o Apps Script (Code, Db, Config, Setup e Seed), rode <strong>setupPlanilha</strong> e publique uma nova versão; depois clique em ↻.</div>';
      return;
    }
    alvo.innerHTML = `
      ${!p.data_inicio ? '<div class="alerta alerta-ambar">Informe a data de início da obra para montar as datas do cronograma.</div>' : ''}
      ${c.erros.length ? `<div class="alerta alerta-ambar">Fórmula com erro na aba cfg_cronograma: ${esc(c.erros.join(' · '))}</div>` : ''}
      <div class="cards-resumo cards-4">
        <div class="card-numero"><span class="rotulo-card">Início</span>
          <input id="cr-inicio" class="campo campo-card" type="date" value="${esc(p.data_inicio || '')}" aria-label="Início da obra"></div>
        <div class="card-numero"><span class="rotulo-card">Término previsto</span><span class="valor-card">${dataBr(c.fim)}</span>
          <span class="sub-card">${c.prazo_dias === null ? '—' : c.prazo_dias + ' dias · ' + num2(c.meses).replace(/,00$/, '') + ' meses'}</span></div>
        <div class="card-numero"><span class="rotulo-card">Concluído</span><span class="valor-card">${pct(c.pct_geral)}</span>
          <span class="sub-card">ponderado pelos dias de cada etapa</span></div>
        <div class="card-numero"><span class="rotulo-card">Situação</span><span class="valor-card">${pilula(SITUACAO_OBRA[c.situacao] || 'st-neutro', c.situacao)}</span>
          <span class="sub-card">${c.dias_restantes === null || c.situacao === 'CONCLUÍDA' ? '' : c.dias_restantes >= 0 ? c.dias_restantes + ' dias restantes' : -c.dias_restantes + ' dias após o término'}${c.atrasadas ? ' · ' + c.atrasadas + ' etapa(s) atrasada(s)' : ''}</span></div>
      </div>
      ${c.fim ? `<div class="cartao"><div class="cartao-titulo"><h2>Gráfico</h2><span class="nota">linha dourada = hoje</span></div>${this.gantt(c)}</div>` : ''}
      <div class="cartao">
        <div class="cartao-titulo"><h2>Etapas</h2><span class="nota">Dias calculados pela aba cfg_cronograma (k/125 × área). Digite outro número só para este orçamento; apague para voltar.</span></div>
        <div class="tabela-rolagem"><table class="tabela tabela-crono">
          <thead><tr><th>Nº</th><th>Etapa</th><th class="num">Dias</th><th>Início</th><th>Fim</th><th>Concluída em</th><th class="num">%</th><th>Situação</th></tr></thead>
          <tbody>${c.etapas.map((e, i) => `<tr class="${e.status === 'ATRASADA' ? 'linha-pendente' : ''}${e.dias === 0 ? ' linha-zerada' : ''}">
            <td>${i + 1}</td>
            <td class="quebra">${esc(e.etapa)}${e.erro ? `<br><small class="erro-campo">${esc(e.erro)}</small>` : ''}</td>
            <td class="num"><input class="campo campo-tabela campo-dias${e.ajustado ? ' ajustado' : ''}" type="text" inputmode="numeric" data-dias="${esc(e.id)}" value="${e.ajustado ? esc(String(ajustes[e.id])) : ''}" placeholder="${e.dias_calculados === null ? '?' : e.dias_calculados}" aria-label="Dias de ${esc(e.etapa)}"></td>
            <td>${dataBr(e.inicio)}</td>
            <td>${dataBr(e.fim)}</td>
            <td><input class="campo campo-tabela campo-data" type="date" data-conclusao="${esc(e.id)}" value="${esc((exec[e.id] || {}).conclusao || '')}" aria-label="Conclusão de ${esc(e.etapa)}"></td>
            <td class="num"><input class="campo campo-tabela campo-pct" type="text" inputmode="decimal" data-pct-etapa="${esc(e.id)}" value="${e.conclusao ? '100' : ((exec[e.id] || {}).pct ? esc(numCampo(Math.round(exec[e.id].pct * 1000) / 10)) : '')}" placeholder="0"${e.conclusao ? ' disabled' : ''} aria-label="% de ${esc(e.etapa)}"></td>
            <td>${pilula(STATUS_ETAPA[e.status] || 'st-neutro', e.status)}</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr class="linha-total"><td></td><td>Total</td><td class="num">${c.etapas.reduce((s, e) => s + (e.dias || 0), 0)}</td><td>${dataBr(c.inicio)}</td><td>${dataBr(c.fim)}</td><td></td><td class="num">${pct(c.pct_geral)}</td><td></td></tr></tfoot>
        </table></div>
      </div>`;

    el('cr-inicio').addEventListener('change', (ev) => { p.data_inicio = ev.target.value; this.aposAlterar(true); });
    alvo.querySelectorAll('[data-dias]').forEach((inp) => inp.addEventListener('change', () => {
      const v = lerNumero(inp.value);
      if (inp.value.trim() === '' || v === null || v < 0) delete ajustes[inp.dataset.dias];
      else ajustes[inp.dataset.dias] = Math.round(v);
      this.aposAlterar(true);
    }));
    alvo.querySelectorAll('[data-conclusao]').forEach((inp) => inp.addEventListener('change', () => {
      const id = inp.dataset.conclusao;
      exec[id] = Object.assign({}, exec[id], { conclusao: inp.value });
      this.aposAlterar(true);
    }));
    alvo.querySelectorAll('[data-pct-etapa]').forEach((inp) => inp.addEventListener('change', () => {
      const id = inp.dataset.pctEtapa;
      const v = lerNumero(inp.value);
      exec[id] = Object.assign({}, exec[id], { pct: v === null ? null : Math.max(0, Math.min(100, v)) / 100 });
      this.aposAlterar(true);
    }));
  },

  /** Barras por etapa ao longo do tempo (substitui a grade semanal A/E/P da planilha). */
  gantt(c) {
    const ini = Date.parse(c.inicio + 'T00:00:00Z');
    const fim = Date.parse(c.fim + 'T00:00:00Z');
    const span = Math.max(1, fim - ini);
    const pos = (d) => ((Date.parse(d + 'T00:00:00Z') - ini) / span) * 100;
    const meses = [];
    const d = new Date(ini);
    d.setUTCDate(1);
    while (d.getTime() <= fim) {
      const x = ((d.getTime() - ini) / span) * 100;
      if (x >= 0) meses.push({ x, rotulo: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('. de ', '/').replace('.', '') });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    const hoje = hojeIso();
    const xHoje = hoje >= c.inicio && hoje <= c.fim ? pos(hoje) : null;
    const cor = { 'CONCLUÍDA': 'g-ok', 'CONCLUÍDA COM ATRASO': 'g-ok', 'EM ANDAMENTO': 'g-andamento', 'ATRASADA': 'g-atraso' };
    return `<div class="gantt">
      <div class="gantt-linha gantt-escala"><span></span><div class="gantt-trilho">${meses.map((m) => `<span class="gantt-mes" style="left:${m.x}%">${esc(m.rotulo)}</span>`).join('')}</div></div>
      ${c.etapas.filter((e) => e.inicio).map((e) => `
        <div class="gantt-linha" title="${esc(e.etapa)}: ${dataBr(e.inicio)} a ${dataBr(e.fim)} (${e.dias} dias)">
          <span class="gantt-nome">${esc(e.etapa)}</span>
          <div class="gantt-trilho">
            <div class="gantt-barra ${cor[e.status] || ''}" style="left:${pos(e.inicio)}%;width:${Math.max(0.6, pos(e.fim) - pos(e.inicio))}%">
              ${e.pct > 0 && e.pct < 1 ? `<i style="width:${e.pct * 100}%"></i>` : ''}
            </div>
            ${xHoje !== null ? `<span class="gantt-hoje" style="left:${xHoje}%"></span>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
  },

  // ─────────── Aba: Pagamento ───────────
  abaPagamento(alvo) {
    const pr = this.fase2.parcelas;
    const ct = this.orc.contrato;
    const t = this.orc.taxas;
    const r = this.resultado;
    const pag = this.orc.pagamentos;
    alvo.innerHTML = `
      <div class="cartao">
        <div class="cartao-titulo"><h2>Condições</h2><span class="nota">Entrada = adiantamento × total. Saldo em parcelas iguais até o término previsto; centavos na última.</span></div>
        <div class="grade-campos">
          <label class="rotulo largo">Modalidade contratada
            <select id="pg-mod" class="campo">${opcoesSelect([
              { valor: 'COM', rotulo: 'Com material — ' + moeda(r.propostas.COM.total) },
              { valor: 'SEM', rotulo: 'Sem material — ' + moeda(r.propostas.SEM.total) }], ct.modalidade)}</select></label>
          <label class="rotulo">Data-base do parcelamento
            <input id="pg-base" class="campo" type="date" value="${esc(ct.data_base || '')}"><small class="nota">Vazio = início da obra (${dataBr(this.orc.parametros.data_inicio)})</small></label>
          <label class="rotulo">Adiantamento (%)<input class="campo campo-num" type="text" inputmode="decimal" data-taxa-pg="adiantamento" data-pct="1" value="${esc(pctCampo(t.adiantamento))}"></label>
          <label class="rotulo">Pagamentos a cada (dias)<input class="campo campo-num" type="text" inputmode="numeric" data-taxa-pg="intervalo" value="${esc(numCampo(t.intervalo))}"></label>
        </div>
      </div>
      ${!pr.ok ? `<div class="alerta alerta-ambar">Para gerar as parcelas, falta: ${esc(pr.faltas.join(', '))}.</div>` : `
      <div class="cards-resumo cards-4">
        <div class="card-numero"><span class="rotulo-card">Valor do contrato</span><span class="valor-card">${moeda(pr.total)}</span><span class="sub-card">${ct.modalidade === 'SEM' ? 'sem material' : 'com material'}</span></div>
        <div class="card-numero"><span class="rotulo-card">Entrada</span><span class="valor-card">${moeda(pr.entrada)}</span><span class="sub-card">${pct(t.adiantamento)} em ${dataBr(pr.data_base)}</span></div>
        <div class="card-numero"><span class="rotulo-card">Parcelas</span><span class="valor-card">${pr.n} × ${moeda(pr.valor)}</span><span class="sub-card">a cada ${pr.intervalo} dias${pr.ultima !== pr.valor ? ' · última ' + moeda(pr.ultima) : ''}</span></div>
        <div class="card-numero"><span class="rotulo-card">Recebido</span><span class="valor-card">${moeda(pr.recebido)}</span><span class="sub-card">em aberto ${moeda(pr.em_aberto)}${pr.vencidas ? ` · <strong class="erro-campo">${pr.vencidas} vencida(s)</strong>` : ''}</span></div>
      </div>
      <div class="cartao">
        <div class="cartao-titulo"><h2>Parcelas</h2><span class="nota">Preencha "Pago em" quando receber.</span></div>
        <div class="tabela-rolagem"><table class="tabela">
          <thead><tr><th>Parcela</th><th>Vencimento</th><th class="num">Valor</th><th>Pago em</th><th>Situação</th></tr></thead>
          <tbody>${pr.lista.map((x) => `<tr class="${x.status === 'VENCIDA' ? 'linha-pendente' : ''}">
            <td>${esc(x.rotulo)}</td><td>${dataBr(x.vencimento)}</td><td class="num">${moeda(x.valor)}</td>
            <td><input class="campo campo-tabela campo-data" type="date" data-pago="${x.n}" value="${esc((pag[x.n] || {}).pago_em || '')}" aria-label="Pagamento da ${esc(x.rotulo)}"></td>
            <td>${pilula(STATUS_PARCELA[x.status], x.status)}</td></tr>`).join('')}</tbody>
          <tfoot><tr class="linha-total"><td colspan="2">Total</td><td class="num">${moeda(pr.lista.reduce((s, x) => s + x.valor, 0))}</td><td colspan="2"></td></tr></tfoot>
        </table></div>
      </div>`}`;

    el('pg-mod').addEventListener('change', (ev) => { ct.modalidade = ev.target.value; this.aposAlterar(true); });
    el('pg-base').addEventListener('change', (ev) => { ct.data_base = ev.target.value; this.aposAlterar(true); });
    alvo.querySelectorAll('[data-taxa-pg]').forEach((inp) => inp.addEventListener('change', () => {
      t[inp.dataset.taxaPg] = inp.dataset.pct ? lerPct(inp.value) : lerNumero(inp.value);
      this.aposAlterar(true);
    }));
    alvo.querySelectorAll('[data-pago]').forEach((inp) => inp.addEventListener('change', () => {
      if (inp.value) pag[inp.dataset.pago] = { pago_em: inp.value };
      else delete pag[inp.dataset.pago];
      this.aposAlterar(true);
    }));
  },

  // ─────────── Aba: Contrato ───────────
  abaContrato(alvo) {
    const k = this.fase2.contrato;
    const ct = this.orc.contrato;
    const padrao = (dados.modelo.empresa || {}).atividades_construtor_padrao || '';
    alvo.innerHTML = `
      <div class="cartao">
        <div class="cartao-titulo"><h2>${k.completo ? '✔ Contrato pronto' : 'Minuta do contrato'}</h2>
          <button class="botao botao-primario botao-pequeno" type="button" id="ct-ver">Ver contrato</button></div>
        <p class="nota">${k.clausulas} cláusulas · modalidade <strong>${k.modalidade === 'SEM' ? 'sem material' : 'com material'}</strong> (troque na aba Pagamento) · anexos com as parcelas e o cronograma.
          As cláusulas ficam na aba <strong>cfg_contrato</strong> da planilha; a cláusula de escopo usa o campo "Escopo do projeto" da aba Dados + a lista automática.</p>
        ${k.pendencias.length ? `<ul class="validacao">${k.pendencias.map((t) => `<li class="pend"><span class="marca">!</span><div><strong>${esc(t)}</strong></div></li>`).join('')}</ul>
          <p class="nota">Enquanto houver pendência, o contrato sai marcado como MINUTA.</p>` : ''}
      </div>
      <div class="cartao">
        <div class="cartao-titulo"><h2>Atividades do construtor</h2><span class="nota">Vazio = texto padrão da aba cfg_empresa</span></div>
        <textarea id="ct-atividades" class="campo" rows="4" placeholder="${esc(padrao)}">${esc(ct.atividades || '')}</textarea>
      </div>`;
    el('ct-ver').addEventListener('click', () => abrirContrato());
    el('ct-atividades').addEventListener('input', debounce((ev) => { ct.atividades = ev.target.value; this.aposAlterar(false); }, 250));
  },
});
