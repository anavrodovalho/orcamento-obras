/**
 * Config.gs — lê o modelo editável (abas cfg_*) e entrega ao site no mesmo formato
 * de data/modelo-padrao.json, que é o que o motor de cálculo espera.
 */

function acaoGetConfig() {
  return lerModelo_();
}

function lerModelo_() {
  var empresa = {};
  lerTabela_(ABA_CFG_EMPRESA).forEach(function (l) {
    var v = l.valor;
    empresa[texto_(l.chave)] = Object.prototype.toString.call(v) === '[object Date]' ? dataIso_(v) : v;
  });

  var bdi = {};
  lerTabela_(ABA_CFG_BDI).forEach(function (l) { bdi[texto_(l.chave)] = numero_(l.valor); });

  var itens = lerTabela_(ABA_CFG_ITENS).map(function (l) {
    var codigo = l.codigo;
    if (typeof codigo === 'number') codigo = String(codigo);
    return {
      id: texto_(l.id),
      ordem: numero_(l.ordem) || 0,
      grupo: texto_(l.grupo),
      categoria: texto_(l.categoria),
      codigo: texto_(codigo),
      descricao_manual: texto_(l.descricao_manual),
      unidade_manual: texto_(l.unidade_manual),
      preco_manual: numero_(l.preco_manual),
      fator: numero_(l.fator),
      formula_qtd: texto_(l.formula_qtd).replace(/^=/, ''),
      ativo: l.ativo === '' ? true : booleano_(l.ativo),
      observacao: texto_(l.observacao)
    };
  }).sort(function (a, b) { return a.ordem - b.ordem; });

  var rateio = { COM: [], SEM: [] };
  lerTabela_(ABA_CFG_RATEIO).forEach(function (l) {
    var mod = texto_(l.modalidade).toUpperCase();
    if (!rateio[mod]) return;
    rateio[mod].push({
      ordem: numero_(l.ordem) || 0,
      fase: texto_(l.fase),
      descricao: texto_(l.descricao),
      percentual: numero_(l.percentual) || 0
    });
  });
  rateio.COM.sort(function (a, b) { return a.ordem - b.ordem; });
  rateio.SEM.sort(function (a, b) { return a.ordem - b.ordem; });

  var categorias = lerTabela_(ABA_CFG_CATEGORIAS).map(function (l) {
    return { categoria: texto_(l.categoria), descricao: texto_(l.descricao) };
  });

  var termos = lerTabela_(ABA_CFG_TERMOS)
    .sort(function (a, b) { return (numero_(a.ordem) || 0) - (numero_(b.ordem) || 0); })
    .map(function (l) { return texto_(l.texto); })
    .filter(function (t) { return t; });

  var cronograma = lerTabela_(ABA_CFG_CRONOGRAMA).map(function (l) {
    return {
      id: texto_(l.id),
      ordem: numero_(l.ordem) || 0,
      etapa: texto_(l.etapa),
      formula_dias: texto_(l.formula_dias).replace(/^=/, ''),
      ativo: l.ativo === '' ? true : booleano_(l.ativo)
    };
  }).filter(function (e) { return e.etapa; }).sort(function (a, b) { return a.ordem - b.ordem; });

  var contrato = lerTabela_(ABA_CFG_CONTRATO).map(function (l) {
    return {
      ordem: numero_(l.ordem) || 0,
      secao: texto_(l.secao),
      tipo: texto_(l.tipo).toLowerCase() === 'paragrafo' ? 'paragrafo' : 'clausula',
      condicao: texto_(l.condicao).replace(/^=/, ''),
      texto: texto_(l.texto),
      ativo: l.ativo === '' ? true : booleano_(l.ativo)
    };
  }).filter(function (c) { return c.texto; }).sort(function (a, b) { return a.ordem - b.ordem; });

  return {
    empresa: empresa,
    bdi: bdi,
    itens: itens,
    rateio: rateio,
    categorias_material: categorias,
    termos: termos,
    cronograma: cronograma,
    contrato: contrato
  };
}
