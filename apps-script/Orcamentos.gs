/**
 * Orcamentos.gs — guardar e ler orçamentos.
 *
 * db_orcamentos guarda uma linha por orçamento: colunas de resumo (para ver e filtrar na
 * planilha) + dados_json com tudo o que foi digitado (parâmetros, taxas, ajustes, adicionais).
 * db_orcamento_itens guarda o retrato dos itens calculados no último salvamento, para que um
 * orçamento enviado ao cliente continue com os mesmos números mesmo depois de atualizar a SINAPI.
 */

var LIMITE_JSON = 45000; // célula do Sheets aceita 50 mil caracteres

function orcamentoDaLinha_(l) {
  return {
    id: texto_(l.id),
    cliente_nome: texto_(l.cliente_nome),
    cliente_cpf: texto_(l.cliente_cpf),
    cliente_telefone: texto_(l.cliente_telefone),
    endereco_obra: texto_(l.endereco_obra),
    cidade: texto_(l.cidade),
    data_orcamento: dataIso_(l.data_orcamento),
    data_inicio: dataIso_(l.data_inicio),
    area: numero_(l.area),
    pavimentos: texto_(l.pavimentos),
    acabamento: texto_(l.acabamento),
    status: texto_(l.status) || 'Rascunho',
    competencia_sinapi: texto_(l.competencia_sinapi),
    subtotal: numero_(l.subtotal),
    total_com_material: numero_(l.total_com_material),
    total_sem_material: numero_(l.total_sem_material),
    pendencias: numero_(l.pendencias),
    ativo: booleano_(l.ativo),
    criado_em: texto_(l.criado_em),
    criado_por: texto_(l.criado_por),
    atualizado_em: texto_(l.atualizado_em),
    atualizado_por: texto_(l.atualizado_por),
    _dados: texto_(l.dados_json),
    _linha: l._linha
  };
}

function lerOrcamentos_(incluirInativos) {
  return lerTabela_(ABA_ORCAMENTOS).map(orcamentoDaLinha_)
    .filter(function (o) { return o.id && (incluirInativos || o.ativo); });
}

function acaoListOrcamentos() {
  return lerOrcamentos_(false)
    .sort(function (a, b) { return a.atualizado_em < b.atualizado_em ? 1 : -1; })
    .map(publico_);
}

function acaoGetOrcamento(dados) {
  var id = texto_(dados.id);
  var orc = lerOrcamentos_(false).filter(function (o) { return o.id === id; })[0];
  if (!orc) falha_('Orçamento não encontrado.');
  var resultado = publico_(orc);
  try { resultado.dados = orc._dados ? JSON.parse(orc._dados) : {}; } catch (e) { resultado.dados = {}; }
  return resultado;
}

function acaoSaveOrcamento(dados, usuario) {
  var d = dados.dados || {};
  var p = d.parametros || {};
  var resumo = dados.resumo || {};
  if (!texto_(p.cliente_nome)) falha_('Informe o nome do cliente.');
  var status = texto_(d.status) || 'Rascunho';
  if (STATUS_ORCAMENTO.indexOf(status) < 0) falha_('Situação inválida.');

  var json = JSON.stringify(d);
  if (json.length > LIMITE_JSON) falha_('Orçamento grande demais para salvar (muitos adicionais ou observações longas).');

  var agora = agoraTexto_();
  var registro = {
    cliente_nome: texto_(p.cliente_nome, 120),
    cliente_cpf: texto_(p.cliente_cpf, 20),
    cliente_telefone: texto_(p.cliente_telefone, 20),
    endereco_obra: texto_(p.endereco_obra, 200),
    cidade: texto_(p.cidade, 80),
    data_orcamento: dataIso_(p.data_orcamento),
    data_inicio: dataIso_(p.data_inicio),
    area: numero_(p.area),
    pavimentos: texto_(p.pavimentos, 40),
    acabamento: texto_(p.acabamento, 20),
    status: status,
    competencia_sinapi: texto_(resumo.competencia_sinapi, 10),
    subtotal: numero_(resumo.subtotal),
    total_com_material: numero_(resumo.total_com_material),
    total_sem_material: numero_(resumo.total_sem_material),
    pendencias: inteiro_(resumo.pendencias),
    dados_json: json,
    atualizado_em: agora,
    atualizado_por: usuario.nome
  };

  var id = texto_(dados.id);
  var todos = lerOrcamentos_(true);
  if (id) {
    var atual = todos.filter(function (o) { return o.id === id; })[0];
    if (!atual || !atual.ativo) falha_('Orçamento não encontrado.');
    if (dados.versao && dados.versao !== atual.atualizado_em) {
      falha_('Este orçamento foi alterado por ' + atual.atualizado_por + ' em ' + atual.atualizado_em +
        '. Recarregue antes de salvar para não perder a alteração.', 'CONFLITO');
    }
    atualizarLinha_(ABA_ORCAMENTOS, atual._linha, registro);
    registrarLog_(usuario, 'editar', 'orcamento', id, registro.cliente_nome + ' · ' + status);
  } else {
    id = proximoId_('ORC', 4, todos);
    registro.id = id;
    registro.ativo = true;
    registro.criado_em = agora;
    registro.criado_por = usuario.nome;
    inserirLinha_(ABA_ORCAMENTOS, registro);
    registrarLog_(usuario, 'criar', 'orcamento', id, registro.cliente_nome);
  }

  var itens = (dados.itens || []).slice(0, 1000).map(function (it, i) {
    return {
      orcamento_id: id,
      ordem: numero_(it.ordem) || i + 1,
      item_id: texto_(it.id, 20),
      grupo: texto_(it.grupo, 60),
      categoria: texto_(it.categoria, 60),
      codigo: texto_(it.codigo, 20),
      descricao: texto_(it.descricao, 300),
      unidade: texto_(it.unidade, 10),
      qtd: numero_(it.qtd),
      preco: numero_(it.preco),
      origem_preco: texto_(it.origem_preco, 10),
      total: numero_(it.total),
      status: texto_(it.status, 20),
      motivo: texto_(it.motivo, 200)
    };
  });
  substituirLinhas_(ABA_ORC_ITENS, 'orcamento_id', id, itens);

  return { id: id, versao: agora };
}

function acaoDeleteOrcamento(dados, usuario) {
  var id = texto_(dados.id);
  var atual = lerOrcamentos_(false).filter(function (o) { return o.id === id; })[0];
  if (!atual) falha_('Orçamento não encontrado.');
  atualizarLinha_(ABA_ORCAMENTOS, atual._linha, { ativo: false, atualizado_em: agoraTexto_(), atualizado_por: usuario.nome });
  registrarLog_(usuario, 'excluir', 'orcamento', id, atual.cliente_nome);
  return { excluido: id };
}
