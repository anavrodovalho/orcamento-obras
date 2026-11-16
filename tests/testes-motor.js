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

console.log('\n' + (total - falhas) + '/' + total + ' testes passaram');
process.exit(falhas ? 1 : 0);
