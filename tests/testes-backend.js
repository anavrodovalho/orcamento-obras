'use strict';
/**
 * Testes do backend (Apps Script) no simulador. Rodar: node tests/testes-backend.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { criarAmbiente } = require('./simulador');
const Motor = require('../js/motor.js');

let passaram = 0, falharam = 0;
function teste(nome, fn) {
  try { fn(); passaram++; console.log('  ok ', nome); }
  catch (e) { falharam++; console.log('  FALHOU', nome, '\n      ', e.message); }
}
const ok = (r, msg) => { assert.strictEqual(r.ok, true, (msg || 'resposta') + ': ' + r.error); return r.data; };
const erro = (r, trecho) => {
  assert.strictEqual(r.ok, false, 'esperava erro');
  if (trecho) assert.ok(r.error.includes(trecho) || r.code === trecho, `erro "${r.error}" (code ${r.code}) não contém "${trecho}"`);
};

const raiz = path.join(__dirname, '..');
const indice = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'sinapi', 'index.json'), 'utf8'));
const sinapi = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'sinapi', indice.competencias[0].arquivo), 'utf8'));
const exemplo = JSON.parse(fs.readFileSync(path.join(__dirname, 'exemplo-planilha.json'), 'utf8'));

const amb = criarAmbiente({ agora: '2026-11-16T15:00:00-03:00', silencioso: true });
const { ss } = amb;

console.log('Instalação');
teste('setupPlanilha cria abas db_* e cfg_* e preenche o modelo', () => {
  amb.rodar('setupPlanilha');
  ['db_orcamentos', 'db_orcamento_itens', 'db_usuarios', 'db_log', 'cfg_empresa', 'cfg_bdi', 'cfg_itens', 'cfg_rateio', 'cfg_categorias', 'cfg_termos']
    .forEach((n) => assert.ok(ss.getSheetByName(n), 'falta ' + n));
  assert.strictEqual(ss.getSheetByName('cfg_itens').getLastRow(), 120); // cabeçalho + 119
  assert.strictEqual(ss.getSheetByName('cfg_rateio').getLastRow(), 25);  // cabeçalho + 12 COM + 12 SEM
});
teste('rodar de novo não duplica nem sobrescreve', () => {
  ss.getSheetByName('cfg_itens').rows[1][8] = 99; // a Ana editou um fator
  amb.rodar('setupPlanilha');
  assert.strictEqual(ss.getSheetByName('cfg_itens').getLastRow(), 120);
  assert.strictEqual(ss.getSheetByName('cfg_itens').rows[1][8], 99);
  ss.getSheetByName('cfg_itens').rows[1][8] = 17;
});
teste('fórmula fica como texto na planilha', () => {
  const cab = ss.getSheetByName('cfg_itens').rows[0];
  const col = cab.indexOf('formula_qtd');
  const linhaFixa = ss.getSheetByName('cfg_itens').rows.find((l) => l[0] === 'I077');
  assert.strictEqual(linhaFixa[col], '1');
});
teste('cfg_cronograma e cfg_contrato vêm preenchidos', () => {
  const padrao = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'modelo-padrao.json'), 'utf8'));
  assert.strictEqual(ss.getSheetByName('cfg_cronograma').getLastRow(), 26); // cabeçalho + 25 etapas
  assert.strictEqual(ss.getSheetByName('cfg_contrato').getLastRow(), padrao.contrato.length + 1);
});
teste('atualização: planilha da Fase 1 ganha as abas novas e a chave nova, sem perder o que foi editado', () => {
  ss.sheets = ss.sheets.filter((a) => a.name !== 'cfg_cronograma' && a.name !== 'cfg_contrato');
  const emp = ss.getSheetByName('cfg_empresa');
  emp.rows = emp.rows.filter((l) => l[0] !== 'atividades_construtor_padrao');
  emp.rows.find((l) => l[0] === 'cnpj')[1] = '12.345.678/0001-90';
  const antes = emp.rows.length;
  amb.rodar('setupPlanilha');
  assert.ok(ss.getSheetByName('cfg_cronograma') && ss.getSheetByName('cfg_contrato'));
  assert.strictEqual(ss.getSheetByName('cfg_cronograma').getLastRow(), 26);
  assert.strictEqual(emp.rows.length, antes + 1);
  assert.strictEqual(emp.rows.find((l) => l[0] === 'cnpj')[1], '12.345.678/0001-90');
  amb.rodar('setupPlanilha');
  assert.strictEqual(emp.rows.length, antes + 1, 'rodar de novo não duplica a chave');
});

console.log('\nUsuários');
let token;
teste('login', () => {
  amb.rodar('criarUsuario', 'ana', 'Ana Laura', 'segredo123');
  erro(amb.chamar('getConfig', {}), 'SESSAO');
  erro(amb.chamar('login', { usuario: 'ana', senha: 'x' }), 'incorretos');
  token = ok(amb.chamar('login', { usuario: 'ana', senha: 'segredo123' })).token;
  assert.ok(token);
});

console.log('\nModelo lido da planilha');
let modelo;
teste('getConfig devolve o modelo completo', () => {
  modelo = ok(amb.chamar('getConfig', {}, token));
  assert.strictEqual(modelo.itens.length, 119);
  assert.strictEqual(modelo.rateio.COM.length, 12);
  assert.strictEqual(modelo.termos.length, 8);
  assert.ok(modelo.empresa.razao_social.indexOf('HABITAR') === 0);
  assert.strictEqual(typeof modelo.itens[0].codigo, 'string');
});
teste('getConfig traz cronograma e contrato iguais ao modelo padrão', () => {
  const padrao = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'modelo-padrao.json'), 'utf8'));
  assert.deepStrictEqual(modelo.cronograma, padrao.cronograma);
  assert.deepStrictEqual(modelo.contrato, padrao.contrato);
  assert.ok(modelo.empresa.atividades_construtor_padrao.length > 20);
});
teste('o modelo vindo da planilha dá o mesmo resultado golden', () => {
  const r = Motor.calcular({ modelo, sinapi, orcamento: { parametros: exemplo.parametros } });
  assert.ok(Math.abs(r.subtotal_valido - exemplo.esperado.subtotal_valido) < 1e-6, r.subtotal_valido + ' ≠ ' + exemplo.esperado.subtotal_valido);
  assert.ok(Math.abs(r.bdi.bdi - 0.37197011333241115) < 1e-12);
});
teste('percentual digitado como "12%" na planilha vira 0,12', () => {
  const aba = ss.getSheetByName('cfg_rateio');
  const antigo = aba.rows[1][4];
  aba.rows[1][4] = '12%';
  const m = ok(amb.chamar('getConfig', {}, token));
  assert.strictEqual(m.rateio.COM[0].percentual, 0.12);
  aba.rows[1][4] = antigo;
});

console.log('\nOrçamentos');
let id, versao;
const r = () => Motor.calcular({ modelo, sinapi, orcamento: { parametros: exemplo.parametros, taxas: { adiantamento: 0.2, administracao: 0.15, protecao: 0.05, intervalo: 30 } } });
function pacote(extra) {
  const calc = r();
  return Object.assign({
    dados: { parametros: exemplo.parametros, taxas: { adiantamento: 0.2, administracao: 0.15, protecao: 0.05, intervalo: 30 }, status: 'Rascunho' },
    resumo: { subtotal: calc.subtotal_valido, total_com_material: calc.propostas.COM.total, total_sem_material: calc.propostas.SEM.total, pendencias: calc.pendencias_emissao, competencia_sinapi: calc.competencia_sinapi },
    itens: calc.itens,
  }, extra || {});
}
teste('salvar novo gera ORC0001 e o retrato dos itens', () => {
  const s = ok(amb.chamar('saveOrcamento', pacote(), token));
  id = s.id; versao = s.versao;
  assert.strictEqual(id, 'ORC0001');
  assert.strictEqual(ss.getSheetByName('db_orcamento_itens').getLastRow(), 120);
  const linha = ss.getSheetByName('db_orcamentos').rows[1];
  assert.strictEqual(linha[2], '111.444.777-35'); // CPF como texto
});
teste('listar e abrir', () => {
  const lista = ok(amb.chamar('listOrcamentos', {}, token));
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].cliente_nome, 'Cliente Exemplo');
  assert.ok(!('dados_json' in lista[0]) && !('_dados' in lista[0]));
  const o = ok(amb.chamar('getOrcamento', { id }, token));
  assert.strictEqual(o.dados.parametros.area, 150);
  assert.strictEqual(o.data_inicio, '2024-10-01');
});
teste('salvar de novo substitui os itens (não duplica)', () => {
  const s = ok(amb.chamar('saveOrcamento', pacote({ id, versao }), token));
  versao = s.versao;
  assert.strictEqual(ss.getSheetByName('db_orcamento_itens').getLastRow(), 120);
});
teste('segundo orçamento não mexe nos itens do primeiro', () => {
  const s = ok(amb.chamar('saveOrcamento', pacote(), token));
  assert.strictEqual(s.id, 'ORC0002');
  assert.strictEqual(ss.getSheetByName('db_orcamento_itens').getLastRow(), 239);
  ok(amb.chamar('saveOrcamento', pacote({ id: 'ORC0002' }), token));
  assert.strictEqual(ss.getSheetByName('db_orcamento_itens').getLastRow(), 239);
});
teste('versão antiga é recusada (outra pessoa salvou antes)', () => {
  amb.setAgora('2026-11-16T16:00:00-03:00');
  ok(amb.chamar('saveOrcamento', pacote({ id, versao }), token));
  erro(amb.chamar('saveOrcamento', pacote({ id, versao }), token), 'CONFLITO');
});
teste('validações de entrada', () => {
  const p = pacote(); p.dados = Object.assign({}, p.dados, { parametros: {} });
  erro(amb.chamar('saveOrcamento', p, token), 'nome do cliente');
  const q = pacote(); q.dados = Object.assign({}, q.dados, { status: 'Qualquer' });
  erro(amb.chamar('saveOrcamento', q, token), 'Situação');
});
teste('excluir esconde da lista', () => {
  ok(amb.chamar('deleteOrcamento', { id: 'ORC0002' }, token));
  assert.strictEqual(ok(amb.chamar('listOrcamentos', {}, token)).length, 1);
  erro(amb.chamar('getOrcamento', { id: 'ORC0002' }, token), 'não encontrado');
});

console.log('\nGastos');
let gastoId;
teste('setupPlanilha cria db_gastos com data como texto', () => {
  const aba = ss.getSheetByName('db_gastos');
  assert.ok(aba, 'falta db_gastos');
  const cab = aba.rows[0];
  assert.strictEqual(cab[0], 'id');
  assert.strictEqual(aba.formatos[cab.indexOf('data') + 1], '@');
});
teste('lançar gasto calcula o total e gera G00001', () => {
  const g = ok(amb.chamar('saveGasto', { gasto: { orcamento_id: id, data: '2024-10-05', grupo: 'MÃO-DE-OBRA', descricao: 'Pedreiro semana 1', qtd: '44', valor_unitario: '23,68', unidade: 'H' } }, token));
  gastoId = g.id;
  assert.strictEqual(g.id, 'G00001');
  assert.strictEqual(g.total, 1041.92);
  const linha = ss.getSheetByName('db_gastos').rows[1];
  assert.strictEqual(linha[2], '2024-10-05'); // data continua texto
});
teste('quantidade vazia vale 1', () => {
  const g = ok(amb.chamar('saveGasto', { gasto: { orcamento_id: id, data: '2024-11-02', grupo: 'ELÉTRICA', descricao: 'Fios e cabos', valor_unitario: 850.5 } }, token));
  assert.strictEqual(g.qtd, 1);
  assert.strictEqual(g.total, 850.5);
});
teste('listar gastos do orçamento em ordem de data', () => {
  const l = ok(amb.chamar('listGastos', { orcamento_id: id }, token));
  assert.deepStrictEqual(l.map((g) => g.id), ['G00001', 'G00002']);
  assert.ok(!('_linha' in l[0]));
  assert.strictEqual(ok(amb.chamar('listGastos', { orcamento_id: 'ORC9999' }, token)).length, 0);
});
teste('editar gasto troca valores sem duplicar', () => {
  ok(amb.chamar('saveGasto', { gasto: { id: gastoId, orcamento_id: id, data: '2024-10-05', grupo: 'MÃO-DE-OBRA', descricao: 'Pedreiro semana 1', qtd: 40, valor_unitario: 25 } }, token));
  const l = ok(amb.chamar('listGastos', { orcamento_id: id }, token));
  assert.strictEqual(l.length, 2);
  assert.strictEqual(l[0].total, 1000);
});
teste('lista de orçamentos traz o total gasto', () => {
  const lista = ok(amb.chamar('listOrcamentos', {}, token));
  assert.strictEqual(lista[0].total_gasto, 1850.5);
});
teste('validações do gasto', () => {
  const base = { orcamento_id: id, data: '2024-10-05', grupo: 'LAJE', descricao: 'x', valor_unitario: 10 };
  erro(amb.chamar('saveGasto', { gasto: Object.assign({}, base, { orcamento_id: 'ORC0002' }) }, token), 'Orçamento não encontrado');
  erro(amb.chamar('saveGasto', { gasto: Object.assign({}, base, { data: '' }) }, token), 'data');
  erro(amb.chamar('saveGasto', { gasto: Object.assign({}, base, { grupo: '' }) }, token), 'grupo');
  erro(amb.chamar('saveGasto', { gasto: Object.assign({}, base, { valor_unitario: '' }) }, token), 'valor unitário');
  erro(amb.chamar('saveGasto', { gasto: Object.assign({}, base, { qtd: 0 }) }, token), 'quantidade');
  erro(amb.chamar('saveGasto', { gasto: Object.assign({}, base, { id: 'G09999' }) }, token), 'não encontrado');
});
teste('excluir gasto tira da lista e do total', () => {
  ok(amb.chamar('deleteGasto', { id: 'G00002' }, token));
  assert.strictEqual(ok(amb.chamar('listGastos', { orcamento_id: id }, token)).length, 1);
  assert.strictEqual(ok(amb.chamar('listOrcamentos', {}, token))[0].total_gasto, 1000);
  erro(amb.chamar('deleteGasto', { id: 'G00002' }, token), 'não encontrado');
});
teste('planilha da Fase 2 sem db_gastos: lista funciona e setup cria a aba', () => {
  const guardada = ss.getSheetByName('db_gastos');
  ss.sheets = ss.sheets.filter((a) => a.name !== 'db_gastos');
  assert.strictEqual(ok(amb.chamar('listOrcamentos', {}, token))[0].total_gasto, 0);
  amb.rodar('setupPlanilha');
  assert.ok(ss.getSheetByName('db_gastos'));
  ss.sheets = ss.sheets.filter((a) => a.name !== 'db_gastos');
  ss.sheets.push(guardada);
});
teste('log registra as ações', () => {
  const log = ok(amb.chamar('listLog', {}, token));
  assert.ok(log.some((l) => l.acao === 'criar' && l.registro_id === 'ORC0001'));
});

console.log('\n' + passaram + '/' + (passaram + falharam) + ' testes passaram');
process.exit(falharam ? 1 : 0);
