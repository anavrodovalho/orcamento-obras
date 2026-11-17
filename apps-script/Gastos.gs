/**
 * Gastos.gs — gastos realizados da obra (aba "Controle de Gastos" da planilha original).
 *
 * db_gastos guarda uma linha por lançamento, ligada ao orçamento pelo orcamento_id.
 * Fica fora do dados_json do orçamento de propósito: lançar um gasto não exige salvar o
 * orçamento (nem conflita com quem está editando) e a lista pode crescer sem limite de célula.
 * Excluir apenas marca ativo = FALSE (o histórico fica na planilha).
 */

function gastoDaLinha_(l) {
  return {
    id: texto_(l.id),
    orcamento_id: texto_(l.orcamento_id),
    data: dataIso_(l.data),
    grupo: texto_(l.grupo),
    descricao: texto_(l.descricao),
    fornecedor: texto_(l.fornecedor),
    qtd: numero_(l.qtd),
    unidade: texto_(l.unidade),
    valor_unitario: numero_(l.valor_unitario),
    total: numero_(l.total),
    observacao: texto_(l.observacao),
    ativo: booleano_(l.ativo),
    criado_em: texto_(l.criado_em),
    criado_por: texto_(l.criado_por),
    atualizado_em: texto_(l.atualizado_em),
    atualizado_por: texto_(l.atualizado_por),
    _linha: l._linha
  };
}

function lerGastos_(incluirInativos) {
  return lerTabela_(ABA_GASTOS).map(gastoDaLinha_)
    .filter(function (g) { return g.id && (incluirInativos || g.ativo); });
}

function acaoListGastos(dados) {
  var id = texto_(dados.orcamento_id);
  if (!id) falha_('Informe o orçamento.');
  return lerGastos_(false)
    .filter(function (g) { return g.orcamento_id === id; })
    .sort(function (a, b) { return a.data === b.data ? (a.id < b.id ? -1 : 1) : (a.data < b.data ? -1 : 1); })
    .map(publico_);
}

/** Total gasto por orçamento (para a lista de orçamentos). */
function totaisGastos_() {
  var totais = {};
  lerGastos_(false).forEach(function (g) {
    totais[g.orcamento_id] = (totais[g.orcamento_id] || 0) + (g.total || 0);
  });
  return totais;
}

function acaoSaveGasto(dados, usuario) {
  var g = dados.gasto || {};
  var orcId = texto_(g.orcamento_id);
  var orc = lerOrcamentos_(false).filter(function (o) { return o.id === orcId; })[0];
  if (!orc) falha_('Orçamento não encontrado. Salve o orçamento antes de lançar gastos.');

  var data = dataIso_(g.data);
  if (!data) falha_('Informe a data do gasto.');
  var grupo = texto_(g.grupo, 60);
  if (!grupo) falha_('Escolha o grupo do gasto.');
  var descricao = texto_(g.descricao, 300);
  if (!descricao) falha_('Descreva o gasto.');

  var qtd = numero_(g.qtd);
  var unitario = numero_(g.valor_unitario);
  if (qtd === null) qtd = 1;
  if (qtd <= 0) falha_('A quantidade precisa ser maior que zero.');
  if (unitario === null || unitario < 0) falha_('Informe o valor unitário.');
  var total = Math.round(qtd * unitario * 100) / 100;

  var agora = agoraTexto_();
  var registro = {
    orcamento_id: orcId,
    data: data,
    grupo: grupo,
    descricao: descricao,
    fornecedor: texto_(g.fornecedor, 120),
    qtd: qtd,
    unidade: texto_(g.unidade, 12),
    valor_unitario: unitario,
    total: total,
    observacao: texto_(g.observacao, 500),
    atualizado_em: agora,
    atualizado_por: usuario.nome
  };

  var todos = lerGastos_(true);
  var id = texto_(g.id);
  if (id) {
    var atual = todos.filter(function (x) { return x.id === id; })[0];
    if (!atual || !atual.ativo || atual.orcamento_id !== orcId) falha_('Gasto não encontrado.');
    atualizarLinha_(ABA_GASTOS, atual._linha, registro);
    registrarLog_(usuario, 'editar', 'gasto', id, orcId + ' · ' + descricao + ' · ' + total);
  } else {
    id = proximoId_('G', 5, todos);
    registro.id = id;
    registro.ativo = true;
    registro.criado_em = agora;
    registro.criado_por = usuario.nome;
    inserirLinha_(ABA_GASTOS, registro);
    registrarLog_(usuario, 'criar', 'gasto', id, orcId + ' · ' + descricao + ' · ' + total);
  }
  registro.id = id;
  registro.ativo = true;
  return registro;
}

function acaoDeleteGasto(dados, usuario) {
  var id = texto_(dados.id);
  var atual = lerGastos_(false).filter(function (g) { return g.id === id; })[0];
  if (!atual) falha_('Gasto não encontrado.');
  atualizarLinha_(ABA_GASTOS, atual._linha, { ativo: false, atualizado_em: agoraTexto_(), atualizado_por: usuario.nome });
  registrarLog_(usuario, 'excluir', 'gasto', id, atual.orcamento_id + ' · ' + atual.descricao + ' · ' + atual.total);
  return { excluido: id };
}
