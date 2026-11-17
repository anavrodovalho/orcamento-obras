/**
 * gastos.js — gasto realizado × orçado (abas "Controle de Gastos" e "DASHBOARD" da planilha).
 *
 * Funções puras, sem DOM nem rede: rodam no navegador e no Node (testes).
 *
 * Regras herdadas da planilha:
 *  - Orçado de cada grupo = custo do grupo na Lista de Materiais (r.grupos do motor).
 *  - Gasto do grupo = soma dos lançamentos daquele grupo (SOMASE); acima do orçado = "ACIMA".
 *  - Saldo bruto = valor do contrato − total gasto (pode ser negativo); disponível = máx(0; saldo).
 *  - Gasto por mês = soma dos lançamentos do mês.
 * Acréscimos do sistema: recebido por mês (parcelas pagas), caixa acumulado e o confronto
 * "% do custo já gasto" × "% físico concluído" do cronograma.
 */
(function (raiz) {
  'use strict';

  const centavos = (v) => Math.round(v * 100) / 100;
  const dataOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const mesDe = (s) => s.slice(0, 7);
  const MAX_MESES = 72;

  function proximoMes(m) {
    let [a, n] = m.split('-').map(Number);
    n += 1;
    if (n > 12) { n = 1; a += 1; }
    return a + '-' + String(n).padStart(2, '0');
  }

  /**
   * @param {object} e
   *   gastos: [{ data, grupo, total }]
   *   orcado: { [grupo]: custo } (Motor.calcular → grupos)
   *   total_contrato: valor da modalidade contratada
   *   data_inicio, fim: datas do cronograma (AAAA-MM-DD)
   *   parcelas: [{ valor, pago_em }] (Cronograma.parcelas → lista)
   *   pct_fisico: 0..1 (Cronograma.calcular → pct_geral)
   */
  function resumo(e) {
    const gastos = (e.gastos || []).filter((g) => dataOk(g.data) && typeof g.total === 'number' && isFinite(g.total));
    const orcado = e.orcado || {};
    const parcelas = (e.parcelas || []).filter((p) => dataOk(p.pago_em));

    // ── por grupo ──
    const porGrupo = {};
    Object.keys(orcado).forEach((k) => { porGrupo[k] = { grupo: k, orcado: orcado[k] || 0, gasto: 0, lancamentos: 0 }; });
    gastos.forEach((g) => {
      const k = g.grupo || 'SEM GRUPO';
      if (!porGrupo[k]) porGrupo[k] = { grupo: k, orcado: 0, gasto: 0, lancamentos: 0 };
      porGrupo[k].gasto += g.total;
      porGrupo[k].lancamentos += 1;
    });
    const grupos = Object.values(porGrupo)
      .filter((x) => x.orcado > 0 || x.lancamentos > 0)
      .map((x) => {
        const gasto = centavos(x.gasto);
        const orc = centavos(x.orcado);
        let status = 'OK';
        if (gasto > orc) status = orc > 0 ? 'ACIMA' : 'SEM ORÇAMENTO';
        return { grupo: x.grupo, orcado: orc, gasto, saldo: centavos(orc - gasto), pct: orc > 0 ? gasto / orc : null, lancamentos: x.lancamentos, status };
      })
      .sort((a, b) => a.grupo.localeCompare(b.grupo, 'pt-BR'));

    const totalGasto = centavos(gastos.reduce((s, g) => s + g.total, 0));
    const custoOrcado = centavos(Object.values(orcado).reduce((s, v) => s + (v || 0), 0));
    const contrato = typeof e.total_contrato === 'number' && isFinite(e.total_contrato) ? centavos(e.total_contrato) : null;
    const recebido = centavos(parcelas.reduce((s, p) => s + p.valor, 0));
    const pctGasto = custoOrcado > 0 ? totalGasto / custoOrcado : null;
    const pctFisico = typeof e.pct_fisico === 'number' ? e.pct_fisico : null;

    // ── por mês ──
    const marcos = [];
    if (dataOk(e.data_inicio)) marcos.push(mesDe(e.data_inicio));
    if (dataOk(e.fim)) marcos.push(mesDe(e.fim));
    gastos.forEach((g) => marcos.push(mesDe(g.data)));
    parcelas.forEach((p) => marcos.push(mesDe(p.pago_em)));
    const meses = [];
    if (marcos.length) {
      marcos.sort();
      const gastoMes = {}, recebidoMes = {};
      gastos.forEach((g) => { const m = mesDe(g.data); gastoMes[m] = (gastoMes[m] || 0) + g.total; });
      parcelas.forEach((p) => { const m = mesDe(p.pago_em); recebidoMes[m] = (recebidoMes[m] || 0) + p.valor; });
      let acG = 0, acR = 0;
      for (let m = marcos[0]; m <= marcos[marcos.length - 1] && meses.length < MAX_MESES; m = proximoMes(m)) {
        const g = centavos(gastoMes[m] || 0), r = centavos(recebidoMes[m] || 0);
        acG += g; acR += r;
        meses.push({ mes: m, gasto: g, recebido: r, saldo: centavos(r - g), gasto_acum: centavos(acG), recebido_acum: centavos(acR), caixa: centavos(acR - acG) });
      }
    }

    const saldo = contrato === null ? null : centavos(contrato - totalGasto);
    return {
      total_gasto: totalGasto,
      custo_orcado: custoOrcado,
      total_contrato: contrato,
      saldo_contrato: saldo,
      disponivel: saldo === null ? null : Math.max(0, saldo),
      margem_prevista: contrato === null ? null : centavos(contrato - custoOrcado),
      recebido,
      caixa: centavos(recebido - totalGasto),
      pct_gasto: pctGasto,
      pct_fisico: pctFisico,
      desvio: pctGasto === null || pctFisico === null ? null : pctGasto - pctFisico,
      grupos,
      acima: grupos.filter((x) => x.status !== 'OK').length,
      meses,
      lancamentos: gastos.length,
    };
  }

  const api = { resumo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Gastos = api;
})(typeof self !== 'undefined' ? self : this);
