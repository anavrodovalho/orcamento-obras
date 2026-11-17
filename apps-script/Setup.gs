/**
 * Setup.gs — instalação (rodar uma vez) e usuários.
 *
 * No editor do Apps Script (vinculado à planilha nova):
 *   1. Selecione `setupPlanilha` e clique em Executar. Autorize quando pedir.
 *      Ele cria as abas db_* e cfg_* e preenche as cfg_* com o modelo da planilha original.
 *      Pode rodar de novo sem medo: só cria o que falta e nunca sobrescreve aba que já tem dados.
 *   2. Recarregue a planilha e use o menu "Orçamento de Obras → Criar ou redefinir usuário".
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Orçamento de Obras')
    .addItem('Criar ou redefinir usuário', 'menuCriarUsuario')
    .addItem('Desativar usuário', 'menuDesativarUsuario')
    .addSeparator()
    .addItem('Instalar / completar abas', 'setupPlanilha')
    .addToUi();
}

var DESCRICOES_EMPRESA = {
  razao_social: 'Nome do construtor (aparece na proposta e no contrato)',
  cnpj: 'CNPJ ou CPF do construtor',
  endereco: 'Endereço do construtor',
  responsavel_tecnico: 'Responsável técnico (assina a proposta)',
  telefone: 'Telefone',
  email: 'E-mail',
  historia: 'Resumo da história da empresa (guardado; não sai mais na proposta, que mostra o escopo)',
  vantagem_1: 'Vantagem 1 (proposta)',
  vantagem_2: 'Vantagem 2 (proposta)',
  vantagem_3: 'Vantagem 3 (proposta)',
  horas_dia: 'Horas trabalhadas por dia, incluindo perdas (dimensionamento da equipe)',
  dias_uteis_mes: 'Média de dias úteis por mês',
  adiantamento_padrao: 'Adiantamento sugerido em orçamento novo (ex.: 20%). Vazio = preencher em cada orçamento',
  administracao_padrao: 'Administração/markup sugerida em orçamento novo (ex.: 15%)',
  protecao_padrao: 'Proteção econômica nos materiais sugerida (ex.: 5%)',
  intervalo_pagamentos_padrao: 'Intervalo das parcelas em dias sugerido (ex.: 30)',
  observacoes_proposta: 'Texto padrão do campo "Adicionais" da proposta',
  formula_area_equivalente: 'Fórmula da área equivalente (AEQ) que multiplica os fatores de consumo',
  fator_acabamento_alto: 'Fator técnico do acabamento ALTO (reservado; POPULAR=0,4 e MÉDIO=0,8 na original)',
  dias_validade_precos: 'Alerta quando a base SINAPI tiver mais que estes dias',
  atividades_construtor_padrao: 'Texto padrão de {ATIVIDADES} no contrato (dá para trocar em cada orçamento)'
};

var DESCRICOES_BDI = {
  administracao_central: 'AC — Administração Central',
  seguro: 'S — Seguro',
  risco: 'R — Risco',
  garantia: 'G — Garantia',
  despesas_financeiras: 'DF — Despesas financeiras (ao mês)',
  lucro: 'L — Lucro',
  pis: 'PIS', cofins: 'COFINS', issqn: 'ISSQN', inss: 'INSS', outros: 'Outros tributos'
};

function setupPlanilha() {
  var ss = planilha_();
  var modelo = modeloPadrao_();
  var criadas = [];

  [ABA_ORCAMENTOS, ABA_ORC_ITENS, ABA_USUARIOS, ABA_LOG, ABA_GASTOS,
    ABA_CFG_EMPRESA, ABA_CFG_BDI, ABA_CFG_ITENS, ABA_CFG_RATEIO, ABA_CFG_CATEGORIAS, ABA_CFG_TERMOS, ABA_CFG_CRONOGRAMA, ABA_CFG_CONTRATO]
    .forEach(function (nome) {
      if (!ss.getSheetByName(nome)) { criarAba_(ss, nome); criadas.push(nome); }
    });

  var preenchidas = [];
  if (vazia_(ABA_CFG_EMPRESA)) {
    inserirLinhas_(ABA_CFG_EMPRESA, Object.keys(modelo.empresa).map(function (k) {
      return { chave: k, valor: modelo.empresa[k], descricao: DESCRICOES_EMPRESA[k] || '' };
    }));
    preenchidas.push(ABA_CFG_EMPRESA);
  } else {
    // Atualização de versão: acrescenta só as chaves novas, sem mexer nas que já existem.
    var existentes = lerTabela_(ABA_CFG_EMPRESA).map(function (l) { return texto_(l.chave); });
    var novas = Object.keys(modelo.empresa).filter(function (k) { return existentes.indexOf(k) < 0; });
    if (novas.length) {
      inserirLinhas_(ABA_CFG_EMPRESA, novas.map(function (k) {
        return { chave: k, valor: modelo.empresa[k], descricao: DESCRICOES_EMPRESA[k] || '' };
      }));
      preenchidas.push(ABA_CFG_EMPRESA + ' (+' + novas.join(', ') + ')');
    }
  }
  if (vazia_(ABA_CFG_BDI)) {
    inserirLinhas_(ABA_CFG_BDI, Object.keys(modelo.bdi).map(function (k) {
      return { chave: k, valor: modelo.bdi[k], descricao: DESCRICOES_BDI[k] || '' };
    }));
    aba_(ABA_CFG_BDI).getRange(2, 2, Object.keys(modelo.bdi).length, 1).setNumberFormat('0.00%');
    preenchidas.push(ABA_CFG_BDI);
  }
  if (vazia_(ABA_CFG_ITENS)) {
    inserirLinhas_(ABA_CFG_ITENS, modelo.itens.map(function (i) {
      return Object.assign({}, i, { codigo: i.codigo === '' ? '' : String(i.codigo), ativo: true });
    }));
    preenchidas.push(ABA_CFG_ITENS);
  }
  if (vazia_(ABA_CFG_RATEIO)) {
    var linhas = [];
    ['COM', 'SEM'].forEach(function (mod) {
      modelo.rateio[mod].forEach(function (f) {
        linhas.push({ modalidade: mod, ordem: f.ordem, fase: f.fase, descricao: f.descricao, percentual: f.percentual });
      });
    });
    inserirLinhas_(ABA_CFG_RATEIO, linhas);
    aba_(ABA_CFG_RATEIO).getRange(2, 5, linhas.length, 1).setNumberFormat('0.00%');
    preenchidas.push(ABA_CFG_RATEIO);
  }
  if (vazia_(ABA_CFG_CATEGORIAS)) {
    inserirLinhas_(ABA_CFG_CATEGORIAS, modelo.categorias_material);
    preenchidas.push(ABA_CFG_CATEGORIAS);
  }
  if (vazia_(ABA_CFG_TERMOS)) {
    inserirLinhas_(ABA_CFG_TERMOS, modelo.termos.map(function (t, i) { return { ordem: i + 1, texto: t }; }));
    preenchidas.push(ABA_CFG_TERMOS);
  }
  if (vazia_(ABA_CFG_CRONOGRAMA)) {
    inserirLinhas_(ABA_CFG_CRONOGRAMA, modelo.cronograma);
    preenchidas.push(ABA_CFG_CRONOGRAMA);
  }
  if (vazia_(ABA_CFG_CONTRATO)) {
    inserirLinhas_(ABA_CFG_CONTRATO, modelo.contrato);
    aba_(ABA_CFG_CONTRATO).getRange(2, 5, modelo.contrato.length, 1).setWrap(true);
    preenchidas.push(ABA_CFG_CONTRATO);
  }

  registrarLog_('sistema', 'setup', 'planilha', '', 'Abas criadas: ' + (criadas.join(', ') || 'nenhuma') +
    ' · Modelo preenchido: ' + (preenchidas.join(', ') || 'nenhum'));
  var msg = 'Pronto. Abas criadas: ' + (criadas.length || 0) + ' · abas de modelo preenchidas: ' + (preenchidas.length || 0) +
    '. Agora cadastre os usuários pelo menu Orçamento de Obras.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* rodando pelo editor */ }
  return msg;
}

function vazia_(nome) {
  return aba_(nome).getLastRow() < 2;
}

function criarAba_(ss, nome) {
  var aba = ss.insertSheet(nome);
  var cab = cabecalhos_(nome);
  aba.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#052F34').setFontColor('#FFFFFF');
  aba.setFrozenRows(1);
  colunasTexto_(nome).forEach(function (campo) {
    var col = cab.indexOf(campo) + 1;
    if (col > 0) aba.getRange(1, col, aba.getMaxRows(), 1).setNumberFormat('@');
  });
  if (aba.getMaxColumns() > cab.length) aba.deleteColumns(cab.length + 1, aba.getMaxColumns() - cab.length);
  return aba;
}

// ───────────────────────────── Usuários ─────────────────────────────

function criarUsuario(usuario, nome, senha) {
  usuario = normalizar_(usuario).replace(/\s+/g, '');
  nome = texto_(nome, 80);
  senha = String(senha == null ? '' : senha);
  if (!usuario || !nome) throw new Error('Informe o usuário (login) e o nome.');
  if (senha.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');

  var existente = buscarUsuario_(usuario);
  var registro = { usuario: usuario, nome: nome, senha_hash: gerarHash_(senha), perfil: 'admin', ativo: true };
  if (existente) {
    atualizarLinha_(ABA_USUARIOS, existente._linha, registro);
    registrarLog_('sistema', 'editar', 'usuario', usuario, 'Senha redefinida para ' + nome);
    return 'Senha de "' + usuario + '" redefinida.';
  }
  inserirLinha_(ABA_USUARIOS, registro);
  registrarLog_('sistema', 'criar', 'usuario', usuario, 'Usuário criado: ' + nome);
  return 'Usuário "' + usuario + '" criado.';
}

function desativarUsuario(usuario) {
  var existente = buscarUsuario_(usuario);
  if (!existente) throw new Error('Usuário não encontrado.');
  atualizarLinha_(ABA_USUARIOS, existente._linha, { ativo: false });
  registrarLog_('sistema', 'editar', 'usuario', existente.usuario, 'Usuário desativado');
  return 'Usuário "' + existente.usuario + '" desativado.';
}

function menuCriarUsuario() {
  var ui = SpreadsheetApp.getUi();
  var login = perguntar_(ui, 'Usuário (login, sem espaços). Ex.: ana');
  if (login === null) return;
  var nome = perguntar_(ui, 'Nome que aparece no sistema. Ex.: Ana Laura');
  if (nome === null) return;
  var senha = perguntar_(ui, 'Senha (mínimo 6 caracteres)');
  if (senha === null) return;
  try { ui.alert(criarUsuario(login, nome, senha)); } catch (e) { ui.alert('Não foi possível: ' + e.message); }
}

function menuDesativarUsuario() {
  var ui = SpreadsheetApp.getUi();
  var login = perguntar_(ui, 'Usuário (login) a desativar');
  if (login === null) return;
  try { ui.alert(desativarUsuario(login)); } catch (e) { ui.alert('Não foi possível: ' + e.message); }
}

function perguntar_(ui, pergunta) {
  var r = ui.prompt('Orçamento de Obras', pergunta, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return null;
  return r.getResponseText();
}
