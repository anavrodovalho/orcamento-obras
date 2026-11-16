/**
 * cronograma.js — cronograma físico e parcelas de pagamento (abas Cronograma e Contrato da planilha).
 *
 * Funções puras, sem DOM nem rede: rodam no navegador e no Node (testes).
 *
 * Regras herdadas da planilha:
 *  - Etapas em sequência: a etapa começa no dia em que a anterior termina (fim = início + dias).
 *  - Dias de cada etapa = fórmula da aba cfg_cronograma (padrão: ARREDONDAR_CIMA(k/125*AREA)).
 *    Etapa com 0 dias não entra na sequência.
 *  - % concluído da obra = média dos % das etapas ponderada pelos dias.
 *  - Parcelas: entrada = adiantamento × total; saldo dividido em ⌈(término − data-base) / intervalo⌉
 *    parcelas iguais, com a diferença de centavos na última, que vence no término previsto.
 */
(function (raiz) {
  'use strict';

  const Formula = (typeof module !== 'undefined' && module.exports) ? require('./formula.js') : raiz.Formula;

  const DIA = 86400000;
  const dataOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
  const ms = (s) => Date.parse(s + 'T00:00:00Z');
  const somarDias = (s, d) => new Date(ms(s) + d * DIA).toISOString().slice(0, 10);
  const diferenca = (a, b) => Math.round((ms(a) - ms(b)) / DIA); // a − b, em dias
  const centavos = (v) => Math.round(v * 100) / 100;

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let t = String(v).trim().replace('%', '');
    if (/,/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    const n = Number(t);
    return isFinite(n) ? n : null;
  }

  /**
   * @param {object} e
   *   etapas: [{ id, ordem, etapa, formula_dias, ativo }] (cfg_cronograma)
   *   vars: variáveis da obra (Motor.variaveis)
   *   data_inicio: 'AAAA-MM-DD'
   *   ajustes: { [id]: dias } — dias digitados só neste orçamento
   *   execucao: { [id]: { conclusao: 'AAAA-MM-DD', pct: 0..1 } }
   *   hoje: 'AAAA-MM-DD'
   */
  function calcular(e) {
    const hoje = e.hoje || new Date().toISOString().slice(0, 10);
    const ajustes = e.ajustes || {};
    const execucao = e.execucao || {};
    const inicioObra = dataOk(e.data_inicio) ? e.data_inicio : null;
    const erros = [];
    let cursor = inicioObra;
    let somaDias = 0, somaFeito = 0;

    const etapas = (e.etapas || [])
      .filter((et) => et.ativo !== false)
      .slice()
      .sort((a, b) => (num(a.ordem) || 0) - (num(b.ordem) || 0))
      .map((et) => {
        const r = Formula.calcular(et.formula_dias, e.vars || {});
        let diasCalc = null, erro = '';
        if (r.valor !== undefined) diasCalc = Math.max(0, Math.ceil(Number(r.valor) - 1e-9));
        else { erro = r.erro || r.pendente || 'fórmula inválida'; erros.push(et.etapa + ': ' + erro); }
        const ajuste = num(ajustes[et.id]);
        const dias = ajuste !== null && ajuste >= 0 ? Math.round(ajuste) : diasCalc;
        const ex = execucao[et.id] || {};
        const conclusao = dataOk(ex.conclusao) ? ex.conclusao : '';
        const pctInformado = num(ex.pct);
        const pct = conclusao ? 1 : (pctInformado === null ? 0 : Math.max(0, Math.min(1, pctInformado)));

        let inicio = '', fim = '';
        if (cursor && dias !== null && dias > 0) {
          inicio = cursor;
          fim = somarDias(cursor, dias);
          cursor = fim;
        }
        let status;
        if (dias === 0) status = 'NÃO SE APLICA';
        else if (!inicio) status = erro ? 'ERRO' : 'SEM DATA';
        else if (conclusao) status = conclusao > fim ? 'CONCLUÍDA COM ATRASO' : 'CONCLUÍDA';
        else if (hoje > fim) status = 'ATRASADA';
        else if (hoje >= inicio) status = 'EM ANDAMENTO';
        else status = 'A INICIAR';

        if (dias > 0) { somaDias += dias; somaFeito += dias * pct; }
        return {
          id: et.id, ordem: num(et.ordem) || 0, etapa: et.etapa, formula_dias: et.formula_dias,
          dias, dias_calculados: diasCalc, ajustado: ajuste !== null && ajuste >= 0,
          inicio, fim, conclusao, pct, status, erro,
        };
      });

    const comData = etapas.filter((x) => x.fim);
    const fim = comData.length ? comData[comData.length - 1].fim : '';
    const prazo = inicioObra && fim ? diferenca(fim, inicioObra) : null;
    const pctGeral = somaDias > 0 ? somaFeito / somaDias : 0;
    const validas = etapas.filter((x) => x.dias > 0);
    const todasConcluidas = validas.length > 0 && validas.every((x) => x.conclusao);
    let situacao = 'PENDENTE';
    if (fim) situacao = todasConcluidas ? 'CONCLUÍDA' : (hoje > fim ? 'PRAZO VENCIDO' : 'EM PRAZO');

    return {
      etapas,
      inicio: inicioObra || '',
      fim,
      prazo_dias: prazo,
      meses: prazo === null ? null : prazo / 30,
      dias_restantes: fim ? diferenca(fim, hoje) : null,
      pct_geral: pctGeral,
      situacao,
      atrasadas: etapas.filter((x) => x.status === 'ATRASADA').length,
      erros,
    };
  }

  /**
   * @param {object} e
   *   total, adiantamento (0..1), data_base, fim, intervalo (dias)
   *   pagamentos: { [n]: { pago_em: 'AAAA-MM-DD' } } — n = 0 é a entrada
   *   hoje
   */
  function parcelas(e) {
    const hoje = e.hoje || new Date().toISOString().slice(0, 10);
    const total = num(e.total) === null ? null : centavos(num(e.total)); // contrato fecha em centavos
    const adiantamento = num(e.adiantamento);
    const intervalo = num(e.intervalo);
    const pagamentos = e.pagamentos || {};
    const faltas = [];
    if (total === null || total <= 0) faltas.push('valor total do contrato');
    if (adiantamento === null || adiantamento < 0 || adiantamento >= 1) faltas.push('% de adiantamento (de 0% a 99%)');
    if (!dataOk(e.data_base)) faltas.push('data-base do parcelamento');
    if (!dataOk(e.fim)) faltas.push('término previsto (cronograma)');
    if (intervalo === null || intervalo < 1 || Math.floor(intervalo) !== intervalo) faltas.push('intervalo entre pagamentos (dias)');
    if (!faltas.length && e.fim <= e.data_base) faltas.push('data-base anterior ao término da obra');
    if (faltas.length) return { ok: false, faltas, lista: [], total, recebido: 0, em_aberto: null };

    const entrada = centavos(total * adiantamento);
    const saldo = centavos(total - entrada);
    const n = Math.ceil(diferenca(e.fim, e.data_base) / intervalo);
    const valor = centavos(saldo / n);
    const ultima = centavos(saldo - valor * (n - 1));

    const situacao = (venc, pago) => pago ? 'PAGA' : (hoje > venc ? 'VENCIDA' : 'A VENCER');
    const lista = [];
    const pagoEm = (k) => (pagamentos[k] && dataOk(pagamentos[k].pago_em)) ? pagamentos[k].pago_em : '';
    if (entrada > 0) lista.push({ n: 0, rotulo: 'Entrada', vencimento: e.data_base, valor: entrada, pago_em: pagoEm(0), status: situacao(e.data_base, pagoEm(0)) });
    for (let i = 1; i <= n; i++) {
      const venc = i === n ? e.fim : somarDias(e.data_base, i * intervalo);
      const v = i === n ? ultima : valor;
      lista.push({ n: i, rotulo: i + 'ª parcela', vencimento: venc < e.fim ? venc : e.fim, valor: v, pago_em: pagoEm(i), status: situacao(venc, pagoEm(i)) });
    }
    const recebido = centavos(lista.filter((p) => p.pago_em).reduce((s, p) => s + p.valor, 0));
    return {
      ok: true, faltas: [], total, entrada, saldo, n, valor, ultima, intervalo,
      data_base: e.data_base, fim: e.fim, lista,
      recebido, em_aberto: centavos(total - recebido),
      vencidas: lista.filter((p) => p.status === 'VENCIDA').length,
    };
  }

  const api = { calcular, parcelas, somarDias, diferenca, dataOk };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Cronograma = api;
})(typeof self !== 'undefined' ? self : this);
