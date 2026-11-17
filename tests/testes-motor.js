'use strict';
/**
 * Testes do motor de cálculo. Rodar: node tests/testes-motor.js
 *
 * O principal é o "golden": a obra de exemplo da planilha original (150 m², aclive, térreo,
 * acabamento médio) precisa dar exatamente as mesmas quantidades e totais que o Excel calculou.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Formula = require('../js/formula.js');
const Motor = require('../js/motor.js');

const raiz = path.join(__dirname, '..');
const modelo = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'modelo-padrao.json'), 'utf8'));
const indice = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'sinapi', 'index.json'), 'utf8'));
const sinapi = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'sinapi', indice.competencias[0].arquivo), 'utf8'));
const exemplo = JSON.parse(fs.readFileSync(path.join(__dirname, 'exemplo-planilha.json'), 'utf8'));

let falhas = 0, total = 0;
function teste(nome, fn) {
  total++;
  try { fn(); console.log('  ok  ' + nome); } catch (e) { falhas++; console.log('  FALHOU  ' + nome + '\n        ' + e.message); }
}
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol || 1e-6) * Math.max(1, Math.abs(b)), msg + ': ' + a + ' ≠ ' + b);

console.log('Fórmulas');
teste('decimal com vírgula e ponto e vírgula', () => {
  assert.strictEqual(Formula.calcular('SE(TERRENO="PLANO"; 1; 1,6)*10', { TERRENO: 'ACLIVE' }).valor, 16);
});
teste('texto compara sem acento', () => {
  assert.strictEqual(Formula.calcular('SE(ACABAMENTO="MEDIO"; 2; 0)', { ACABAMENTO: 'MÉDIO' }).valor, 2);
});
teste('vazio vale zero nas contas e VAZIO detecta', () => {
  assert.strictEqual(Formula.calcular('A+1', { A: null }).valor, 1);
  assert.strictEqual(Formula.calcular('SE(VAZIO(A); 5; 0)', { A: null }).valor, 5);
});
teste('PENDENTE vira pendência com mensagem', () => {
  assert.strictEqual(Formula.calcular('PENDENTE("falta portão")', {}).pendente, 'falta portão');
});
teste('vírgula como separador de argumento dá erro claro', () => {
  assert.ok(/ponto e vírgula/.test(Formula.calcular('SE(A>0, 1, 2)', { A: 1 }).erro));
});
teste('campo desconhecido dá erro', () => {
  assert.ok(/desconhecido/.test(Formula.calcular('XYZ*2', {}).erro));
});
teste('PAV e TER escolhem pelo valor', () => {
  assert.strictEqual(Formula.calcular('PAV(1;2;3;4;5)', { PAVIMENTOS: 'TÉRREO+1PAV' }).valor, 4);
  assert.strictEqual(Formula.calcular('TER(1;2;3)', { TERRENO: 'DECLIVE' }).valor, 2);
});
teste('precedência e potência', () => {
  assert.strictEqual(Formula.calcular('2+3*4^2/8', {}).valor, 8);
  assert.strictEqual(Formula.calcular('-(2+1)*2', {}).valor, -6);
});

console.log('\nGolden — obra de exemplo da planilha');
const orc = { parametros: exemplo.parametros, taxas: {}, ajustes: {}, adicionais: [] };
const r = Motor.calcular({ modelo, sinapi, orcamento: orc, hoje: '2026-11-16' });
const esp = exemplo.esperado;

teste('área equivalente = Lista!Q5', () => perto(r.area_equivalente, esp.area_equivalente, 1e-9, 'AEQ'));
teste('cada item: quantidade e total iguais ao Excel', () => {
  const erros = [];
  r.itens.forEach((it) => {
    const e = esp.itens[it.id];
    if (!e) return;
    if (e.qtd !== null && (it.qtd === null || Math.abs(it.qtd - e.qtd) > 1e-6 * Math.max(1, Math.abs(e.qtd)))) erros.push(it.id + ' qtd ' + it.qtd + ' ≠ ' + e.qtd);
    if (e.qtd === null && it.qtd !== null) erros.push(it.id + ' qtd deveria ficar pendente, deu ' + it.qtd);
    const totalEsp = typeof e.total === 'number' ? e.total : null;
    const totalObt = it.status === 'OK' ? it.total : null;
    if ((totalEsp === null) !== (totalObt === null) || (totalEsp !== null && Math.abs(totalObt - totalEsp) > 1e-6 * Math.max(1, totalEsp))) {
      erros.push(it.id + ' total ' + totalObt + ' ≠ ' + totalEsp + ' (' + it.status + ' ' + it.motivo + ')');
    }
  });
  assert.deepStrictEqual(erros, []);
});
teste('pendentes: os mesmos da planilha, menos os de quantidade zero', () => {
  const esperados = Object.keys(esp.itens).filter((id) => esp.itens[id].status.startsWith('PENDENTE')
    && !(esp.itens[id].qtd === 0));
  const obtidos = r.itens.filter((i) => i.status === 'PENDENTE').map((i) => i.id);
  assert.deepStrictEqual(obtidos.sort(), esperados.sort());
});
teste('subtotal válido = Lista!T4 (R$ 456.454,02)', () => perto(r.subtotal_valido, esp.subtotal_valido, 1e-9, 'subtotal'));
teste('mão de obra = Lista!K8', () => perto(r.mao_de_obra, esp.mao_de_obra, 1e-9, 'MO'));
teste('sem taxas a proposta fica sem total', () => {
  assert.strictEqual(r.propostas.COM.total, null);
  assert.strictEqual(r.propostas.SEM.total, null);
  assert.ok(!r.pode_emitir);
});
teste('BDI = BDI!D34 (37,197%)', () => perto(r.bdi.bdi, 0.37197011333241115, 1e-12, 'BDI'));

console.log('\nPropostas com taxas');
const orc2 = Object.assign({}, orc, { taxas: { adiantamento: 0.2, administracao: 0.15, protecao: 0.05, intervalo: 30 } });
const r2 = Motor.calcular({ modelo, sinapi, orcamento: orc2, hoje: '2026-11-16' });
teste('COM = MO + adm×total + materiais×(1+proteção)', () => {
  const esperado = r2.mao_de_obra + r2.subtotal_valido * 0.15 + r2.materiais * 1.05;
  perto(r2.propostas.COM.total, esperado, 1e-12, 'COM');
});
teste('SEM = MO × (1+adm)', () => perto(r2.propostas.SEM.total, r2.mao_de_obra * 1.15, 1e-12, 'SEM'));
teste('fases somam o total de mão de obra', () => {
  const soma = r2.propostas.COM.fases.reduce((s, f) => s + f.valor, 0);
  perto(soma, r2.propostas.COM.mao_de_obra_adm, 1e-9, 'fases');
});
teste('termo do adiantamento preenchido', () => assert.ok(r2.termos.some((t) => t.indexOf('20,00%') >= 0)));
teste('usar BDI como administração', () => {
  const r3 = Motor.calcular({ modelo, sinapi, orcamento: Object.assign({}, orc2, { taxas: Object.assign({}, orc2.taxas, { usar_bdi: true }) }) });
  perto(r3.administracao, r3.bdi.bdi, 1e-12, 'adm=BDI');
});

console.log('\nAjustes e adicionais');
teste('preço manual resolve a pendência do item', () => {
  const r4 = Motor.calcular({ modelo, sinapi, orcamento: Object.assign({}, orc, { ajustes: { I116: { preco: 300 } } }) });
  const it = r4.itens.find((i) => i.id === 'I116');
  assert.strictEqual(it.status, 'OK');
  assert.strictEqual(it.total, 300);
  perto(r4.subtotal_valido, esp.subtotal_valido + 300, 1e-9, 'subtotal +300');
});
teste('adicional com código SINAPI pega descrição e preço', () => {
  const r5 = Motor.calcular({ modelo, sinapi, orcamento: Object.assign({}, orc, { adicionais: [{ id: 'A1', codigo: 4750, qtd: 10, categoria: 'Adicionais' }] }) });
  const it = r5.itens.find((i) => i.id === 'A1');
  assert.strictEqual(it.descricao, 'PEDREIRO (HORISTA)');
  perto(it.total, 236.8, 1e-9, 'adicional');
});
teste('acabamento ALTO troca os itens condicionais', () => {
  const p = Object.assign({}, exemplo.parametros, { acabamento: 'ALTO' });
  const r6 = Motor.calcular({ modelo, sinapi, orcamento: { parametros: p } });
  assert.strictEqual(r6.itens.find((i) => i.id === 'I133').qtd, 0);
  assert.ok(r6.itens.find((i) => i.id === 'I134').qtd > 0);
});
teste('terraplanagem CONTRATANTE zera as linhas 44 e 45', () => {
  const p = Object.assign({}, exemplo.parametros, { terraplanagem: 'CONTRATANTE' });
  const r7 = Motor.calcular({ modelo, sinapi, orcamento: { parametros: p } });
  assert.strictEqual(r7.itens.find((i) => i.id === 'I044').qtd, 0);
  assert.strictEqual(r7.itens.find((i) => i.id === 'I044').status, 'OK');
});

// ───────────── Fase 2: cronograma, parcelas e contrato ─────────────
const Cronograma = require('../js/cronograma.js');
const Contrato = require('../js/contrato.js');
const varsEx = Motor.variaveis(exemplo.parametros);
const crono = Cronograma.calcular({ etapas: modelo.cronograma, vars: varsEx, data_inicio: exemplo.parametros.data_inicio, hoje: '2024-12-15' });

console.log('\nCronograma (golden contra a aba Cronograma)');
teste('25 etapas com os mesmos dias da planilha', () => {
  // Cronograma!G12:G36 com 150 m² e pé-direito duplo na SALA (laje ×1,7)
  assert.deepStrictEqual(crono.etapas.map((e) => e.dias),
    [9, 9, 9, 9, 9, 9, 27, 15, 11, 9, 16, 6, 11, 12, 9, 18, 12, 9, 12, 9, 12, 9, 26, 9, 9]);
});
teste('término 23/07/2025, prazo 295 dias (9,83 meses)', () => {
  assert.strictEqual(crono.inicio, '2024-10-01');
  assert.strictEqual(crono.fim, '2025-07-23');
  assert.strictEqual(crono.prazo_dias, 295);
  perto(crono.meses, 9.833333333333334, 1e-12, 'meses');
});
teste('etapas encadeadas: cada uma começa quando a anterior termina', () => {
  for (let i = 1; i < crono.etapas.length; i++) assert.strictEqual(crono.etapas[i].inicio, crono.etapas[i - 1].fim);
});
teste('sem pé-direito duplo a laje cai para 5 dias', () => {
  const c = Cronograma.calcular({ etapas: modelo.cronograma, vars: Motor.variaveis(Object.assign({}, exemplo.parametros, { pe_direito_duplo: 'NENHUM' })), data_inicio: '2024-10-01' });
  assert.strictEqual(c.etapas[9].dias, 5);
});
teste('ajuste de dias e execução: % ponderado e status', () => {
  const c = Cronograma.calcular({
    etapas: modelo.cronograma, vars: varsEx, data_inicio: '2024-10-01', hoje: '2024-10-25',
    ajustes: { E01: 5 },
    execucao: { E01: { conclusao: '2024-10-06' }, E02: { pct: 0.5 } },
  });
  assert.strictEqual(c.etapas[0].dias, 5);
  assert.strictEqual(c.etapas[0].ajustado, true);
  assert.strictEqual(c.etapas[0].status, 'CONCLUÍDA');
  assert.strictEqual(c.etapas[1].inicio, '2024-10-06');
  assert.strictEqual(c.etapas[1].status, 'ATRASADA'); // terminava 15/10
  assert.strictEqual(c.etapas[2].status, 'ATRASADA');
  const somaDias = c.etapas.reduce((s, e) => s + e.dias, 0);
  perto(c.pct_geral, (5 + 9 * 0.5) / somaDias, 1e-12, '% ponderado');
  assert.strictEqual(c.situacao, 'EM PRAZO');
});
teste('sem data de início: etapas sem data e situação PENDENTE', () => {
  const c = Cronograma.calcular({ etapas: modelo.cronograma, vars: varsEx, data_inicio: '' });
  assert.strictEqual(c.situacao, 'PENDENTE');
  assert.strictEqual(c.etapas[0].status, 'SEM DATA');
});

console.log('\nParcelas');
teste('entrada 20%, 10 parcelas a cada 30 dias, centavos na última', () => {
  const pr = Cronograma.parcelas({ total: 539075.89, adiantamento: 0.2, data_base: '2024-10-01', fim: crono.fim, intervalo: 30, hoje: '2024-12-15', pagamentos: { 0: { pago_em: '2024-10-01' } } });
  assert.strictEqual(pr.ok, true);
  assert.strictEqual(pr.entrada, 107815.18);
  assert.strictEqual(pr.n, 10); // ⌈295/30⌉
  assert.strictEqual(pr.valor, 43126.07);
  assert.strictEqual(pr.ultima, 43126.08);
  perto(pr.lista.reduce((s, p) => s + p.valor, 0), 539075.89, 1e-12, 'soma das parcelas');
  assert.strictEqual(pr.lista[0].status, 'PAGA');
  assert.strictEqual(pr.lista[1].vencimento, '2024-10-31');
  assert.strictEqual(pr.lista[1].status, 'VENCIDA');
  assert.strictEqual(pr.lista[pr.lista.length - 1].vencimento, '2025-07-23');
  assert.strictEqual(pr.recebido, 107815.18);
});
teste('faltando dados, não inventa parcelas', () => {
  const pr = Cronograma.parcelas({ total: 1000, adiantamento: null, data_base: '2025-08-01', fim: '2025-07-23', intervalo: 30 });
  assert.strictEqual(pr.ok, false);
  assert.ok(pr.faltas.some((f) => f.includes('adiantamento')));
  const pr2 = Cronograma.parcelas({ total: 1000, adiantamento: 0, data_base: '2025-08-01', fim: '2025-07-23', intervalo: 30 });
  assert.ok(pr2.faltas.some((f) => f.includes('anterior ao término')));
});
teste('adiantamento 0%: sem linha de entrada', () => {
  const pr = Cronograma.parcelas({ total: 1000, adiantamento: 0, data_base: '2025-01-01', fim: '2025-03-01', intervalo: 30 });
  assert.strictEqual(pr.lista[0].n, 1);
  assert.strictEqual(pr.n, 2);
  assert.strictEqual(pr.valor + pr.ultima, 1000);
});

console.log('\nContrato');
function montarContrato(mod, extra) {
  const p = Object.assign({}, exemplo.parametros, { terraplanagem: 'CONTRATANTE' }, extra || {});
  const orc = { parametros: p, taxas: { adiantamento: 0.2, administracao: 0.15, protecao: 0.05, intervalo: 30 }, contrato: { modalidade: mod } };
  const r = Motor.calcular({ modelo, sinapi, orcamento: orc });
  const v = Motor.variaveis(p);
  const c = Cronograma.calcular({ etapas: modelo.cronograma, vars: v, data_inicio: p.data_inicio });
  const pr = Cronograma.parcelas({ total: r.propostas[mod].total, adiantamento: 0.2, data_base: p.data_inicio, fim: c.fim, intervalo: 30 });
  return Contrato.montar({ modelo, orc, resultado: r, crono: c, parcelas: pr, vars: v });
}
const textoDe = (k) => k.secoes.map((s) => s.itens.map((i) => i.texto).join(' ')).join(' ');
teste('modalidade COM e SEM escolhem as cláusulas certas', () => {
  const com = textoDe(montarContrato('COM')), sem = textoDe(montarContrato('SEM'));
  assert.ok(com.includes('O CONSTRUTOR será responsável por toda compra'));
  assert.ok(!com.includes('O CONTRATANTE será responsável por toda compra'));
  assert.ok(sem.includes('O CONTRATANTE será responsável por toda compra'));
  assert.ok(sem.includes('sem reembolso de materiais'));
});
teste('terraplanagem decide a cláusula; indefinida vira pendência', () => {
  assert.ok(textoDe(montarContrato('SEM')).includes('pagas pelo CONTRATANTE'));
  const k = montarContrato('SEM', { terraplanagem: '' });
  assert.ok(k.pendencias.some((p) => p.includes('terraplanagem')));
});
teste('cláusulas numeradas em sequência, sem buraco', () => {
  const k = montarContrato('SEM');
  const nums = [];
  k.secoes.forEach((s) => s.itens.forEach((i) => { if (i.tipo === 'clausula') nums.push(i.numero); }));
  assert.deepStrictEqual(nums, nums.map((_, i) => (i + 1) + 'ª'));
  assert.strictEqual(k.clausulas, 27); // mesma quantidade da planilha
});
teste('campos preenchidos: valor, parcelas, prazo e foro', () => {
  const t = textoDe(montarContrato('SEM'));
  assert.ok(t.includes('Cliente Exemplo'));
  assert.ok(t.includes('150,00 m²'));
  assert.ok(/em 10 parcela\(s\) de R\$ [\d.]+,\d\d/.test(t), 'parcelas');
  assert.ok(t.includes('295 dias corridos, de 01/10/2024 a 23/07/2025'));
  assert.ok(t.includes('comarca de Itumbiara'));
});
teste('CNPJ de exemplo (XX.XXX) e itens pendentes marcam pendência', () => {
  const k = montarContrato('COM');
  assert.ok(k.pendencias.some((p) => p.includes('CNPJ')));
  assert.ok(k.pendencias.some((p) => p.includes('incompleto')));
  assert.strictEqual(k.completo, false);
  assert.ok(textoDe(k).includes('[PENDENTE: CNPJ'));
});
teste('escopo automático entra na cláusula de escopo', () => {
  assert.ok(textoDe(montarContrato('SEM')).includes('Escopo contratado: Obra: Construção de residência térrea com 150,00 m²'));
});

console.log('\nGastos × orçado');
const Gastos = require('../js/gastos.js');
// Coluna "Orçamento" do DASHBOARD da planilha original (D50:D64), mesma obra de exemplo.
const DASHBOARD_ORCADO = {
  'ACABAMENTO E FINALIZAÇÃO': 31098.795371848, 'ALUGUÉIS': 1736.5954410000002, 'ALVENARIA E GESSO': 123129.8469837576,
  'ELÉTRICA': 10322.2082099645, FERRAGEM: 23820.535920452356, 'HIDRÁULICA': 11996.19256982848,
  'IMPOSTOS/ TAXAS': 16058.400195600001, LAJE: 16843.17652861956, MADEIRA: 15967.5966845703,
  'MÃO-DE-OBRA': 173378.73866024375, 'PINTURA E MASSA': 13316.673528616502, PROJETO: 5226.13075068,
  TELHADO: 13559.1341096201, TERRAPLANAGEM: 0,
};
const rGolden = Motor.calcular({ modelo, sinapi, orcamento: { parametros: exemplo.parametros } });
teste('golden: orçado por grupo = coluna Orçamento do DASHBOARD', () => {
  Object.keys(DASHBOARD_ORCADO).forEach((g) => perto(rGolden.grupos[g] || 0, DASHBOARD_ORCADO[g], 1e-9, g));
});
const lancamentos = [
  { data: '2024-10-05', grupo: 'MÃO-DE-OBRA', total: 1000 },
  { data: '2024-10-20', grupo: 'PROJETO', total: 5300 },          // passa do orçado (5.226,13)
  { data: '2024-12-01', grupo: 'MÃO-DE-OBRA', total: 2500.255 },
  { data: '2024-12-03', grupo: 'OUTROS', total: 99.9 },           // grupo sem orçamento
  { data: 'lixo', grupo: 'LAJE', total: 10 },                     // ignorado
];
const resumoG = Gastos.resumo({
  gastos: lancamentos, orcado: rGolden.grupos, total_contrato: 539075.89,
  data_inicio: '2024-10-01', fim: '2025-07-23', pct_fisico: 0.02,
  parcelas: [{ valor: 107815.18, pago_em: '2024-10-01' }, { valor: 43126.07, pago_em: '' }, { valor: 43126.07, pago_em: '2024-11-30' }],
});
teste('totais: gasto, saldo do contrato, disponível e recebido', () => {
  assert.strictEqual(resumoG.lancamentos, 4);
  assert.strictEqual(resumoG.total_gasto, 8900.16);
  assert.strictEqual(resumoG.saldo_contrato, 530175.73);
  assert.strictEqual(resumoG.disponivel, 530175.73);
  assert.strictEqual(resumoG.recebido, 150941.25);
  assert.strictEqual(resumoG.caixa, 142041.09);
  perto(resumoG.custo_orcado, 456454.02, 1e-9, 'custo orçado = subtotal da planilha');
});
teste('grupo acima do orçado e grupo sem orçamento', () => {
  const g = (n) => resumoG.grupos.find((x) => x.grupo === n);
  assert.strictEqual(g('PROJETO').status, 'ACIMA');
  assert.strictEqual(g('OUTROS').status, 'SEM ORÇAMENTO');
  assert.strictEqual(g('MÃO-DE-OBRA').status, 'OK');
  assert.strictEqual(g('MÃO-DE-OBRA').gasto, 3500.26);
  assert.strictEqual(resumoG.acima, 2);
  assert.ok(!g('TERRAPLANAGEM'), 'grupo com orçado zero e sem gasto não aparece');
  const nomes = resumoG.grupos.map((x) => x.grupo);
  assert.deepStrictEqual(nomes, nomes.slice().sort((a, b) => a.localeCompare(b, 'pt-BR')));
});
teste('meses do início ao término, com gasto, recebido e caixa acumulado', () => {
  const m = resumoG.meses;
  assert.strictEqual(m[0].mes, '2024-10');
  assert.strictEqual(m[m.length - 1].mes, '2025-07');
  assert.strictEqual(m.length, 10);
  assert.deepStrictEqual([m[0].gasto, m[0].recebido], [6300, 107815.18]);
  assert.deepStrictEqual([m[1].gasto, m[1].recebido], [0, 43126.07]);
  assert.strictEqual(m[2].gasto, 2600.16);
  assert.strictEqual(m[m.length - 1].caixa, resumoG.caixa);
});
teste('% gasto do custo × % físico', () => {
  perto(resumoG.pct_gasto, 8900.16 / 456454.02, 1e-6, 'pct gasto');
  perto(resumoG.desvio, 8900.16 / 456454.02 - 0.02, 1e-6, 'desvio');
});
teste('sem contrato nem datas não quebra', () => {
  const v = Gastos.resumo({ gastos: [], orcado: {} });
  assert.strictEqual(v.total_gasto, 0);
  assert.strictEqual(v.saldo_contrato, null);
  assert.deepStrictEqual(v.meses, []);
  assert.strictEqual(v.pct_gasto, null);
});
teste('estouro do contrato: saldo negativo, disponível zero', () => {
  const v = Gastos.resumo({ gastos: [{ data: '2025-01-01', grupo: 'LAJE', total: 1200 }], orcado: { LAJE: 1000 }, total_contrato: 1000 });
  assert.strictEqual(v.saldo_contrato, -200);
  assert.strictEqual(v.disponivel, 0);
});

console.log('\n' + (total - falhas) + '/' + total + ' testes passaram');
process.exit(falhas ? 1 : 0);
