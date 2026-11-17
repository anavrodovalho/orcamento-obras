/**
 * Orçamento de Obras — Habitar Engenharia & Incorporação
 * API JSON (Apps Script) sobre a planilha Orcamento_Obras_Habitar.
 *
 * Regras de ouro:
 *  - O cálculo do orçamento acontece no site (js/motor.js). Aqui só se guarda e se lê.
 *  - As abas cfg_* são o MODELO (fórmulas, fatores, rateio, termos, empresa, BDI) e podem
 *    ser editadas direto na planilha. As abas db_* são dados do sistema: não edite à mão.
 *  - Cabeçalho na linha 1; colunas localizadas pelo nome, nunca pela posição.
 *  - A base SINAPI NÃO fica aqui: está no GitHub (data/sinapi/GO-AAAA-MM.json).
 *
 * Arquivos: Code.gs (roteamento) · Auth.gs (login) · Db.gs (leitura/escrita)
 *           Config.gs (modelo cfg_*) · Orcamentos.gs · Gastos.gs (gastos da obra)
 *           Setup.gs (instalação) · Seed.gs (modelo padrão)
 */

// Deixe vazio quando o script estiver vinculado à planilha (Extensões → Apps Script).
var SPREADSHEET_ID = '';

var FUSO = 'America/Sao_Paulo';

var ABA_ORCAMENTOS = 'db_orcamentos';
var ABA_ORC_ITENS = 'db_orcamento_itens';
var ABA_USUARIOS = 'db_usuarios';
var ABA_LOG = 'db_log';
var ABA_GASTOS = 'db_gastos';

var ABA_CFG_EMPRESA = 'cfg_empresa';
var ABA_CFG_BDI = 'cfg_bdi';
var ABA_CFG_ITENS = 'cfg_itens';
var ABA_CFG_RATEIO = 'cfg_rateio';
var ABA_CFG_CATEGORIAS = 'cfg_categorias';
var ABA_CFG_TERMOS = 'cfg_termos';
var ABA_CFG_CRONOGRAMA = 'cfg_cronograma';
var ABA_CFG_CONTRATO = 'cfg_contrato';

var SESSAO_HORAS = 12;
var CACHE_MAX_SEGUNDOS = 21600;
var MAX_TENTATIVAS_LOGIN = 5;
var BLOQUEIO_LOGIN_SEGUNDOS = 900;
var ESPERA_LOCK_MS = 20000;

var STATUS_ORCAMENTO = ['Rascunho', 'Enviado', 'Aprovado', 'Recusado', 'Em obra', 'Concluído'];

// ───────────────────────────── Entrada da API ─────────────────────────────

function acoes_() {
  return {
    getConfig:        { fn: acaoGetConfig },
    listOrcamentos:   { fn: acaoListOrcamentos },
    getOrcamento:     { fn: acaoGetOrcamento },
    saveOrcamento:    { fn: acaoSaveOrcamento, escrita: true },
    deleteOrcamento:  { fn: acaoDeleteOrcamento, escrita: true },
    listGastos:       { fn: acaoListGastos },
    saveGasto:        { fn: acaoSaveGasto, escrita: true },
    deleteGasto:      { fn: acaoDeleteGasto, escrita: true },
    listLog:          { fn: acaoListLog }
  };
}

function doGet() {
  return respostaJson_({ ok: true, sistema: 'Orçamento de Obras Habitar' });
}

function doPost(e) {
  var resposta;
  try {
    var pedido = JSON.parse(e.postData.contents);
    resposta = { ok: true, data: executar_(pedido), error: null };
  } catch (erro) {
    if (!erro.publico) console.error(erro);
    resposta = {
      ok: false,
      data: null,
      error: erro.publico ? erro.message : 'Erro no servidor. Tente de novo em instantes.',
      code: erro.code || null
    };
  }
  return respostaJson_(resposta);
}

function executar_(pedido) {
  var acao = pedido.action;
  var dados = pedido.payload || {};
  if (acao === 'login') return acaoLogin(dados);

  var usuario = validarSessao_(pedido.token);
  if (acao === 'logout') return acaoLogout(pedido.token);

  var acoes = acoes_();
  var definicao = Object.prototype.hasOwnProperty.call(acoes, acao) ? acoes[acao] : null;
  if (!definicao) falha_('Ação desconhecida.');
  if (!definicao.escrita) return definicao.fn(dados, usuario);
  return comTrava_(function () { return definicao.fn(dados, usuario); });
}

function respostaJson_(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function falha_(mensagem, codigo) {
  var erro = new Error(mensagem);
  erro.publico = true;
  erro.code = codigo || null;
  throw erro;
}

function comTrava_(funcao) {
  var trava = LockService.getScriptLock();
  try {
    trava.waitLock(ESPERA_LOCK_MS);
  } catch (e) {
    falha_('O sistema está ocupado com outro registro. Tente de novo.');
  }
  try {
    return funcao();
  } finally {
    trava.releaseLock();
  }
}

function planilha_() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

// ───────────────────────────── Utilitários ─────────────────────────────

function texto_(valor, maximo) {
  var t = String(valor == null ? '' : valor).trim();
  return maximo ? t.slice(0, maximo) : t;
}

function normalizar_(valor) {
  return texto_(valor).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Converte para número (aceita "1.234,56" e "12%"); devolve null quando não é número. */
function numero_(valor) {
  if (valor === '' || valor == null) return null;
  if (typeof valor === 'number') return isFinite(valor) ? valor : null;
  var t = String(valor).trim().replace(/R\$\s?/, '');
  var pct = /%$/.test(t);
  t = t.replace('%', '').trim();
  if (/,/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  var n = Number(t);
  if (!isFinite(n)) return null;
  return pct ? n / 100 : n;
}

function inteiro_(valor) {
  var n = numero_(valor);
  return n !== null && Math.floor(n) === n ? n : null;
}

function dataIso_(valor) {
  if (valor == null || valor === '') return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return isNaN(valor.getTime()) ? '' : Utilities.formatDate(valor, FUSO, 'yyyy-MM-dd');
  }
  var t = String(valor).trim();
  var m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    var br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!br) return '';
    m = [null, br[3], ('0' + br[2]).slice(-2), ('0' + br[1]).slice(-2)];
  }
  return m[1] + '-' + m[2] + '-' + m[3];
}

function agoraTexto_() {
  return Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd HH:mm:ss');
}

function booleano_(valor) {
  if (valor === true || valor === false) return valor;
  var t = normalizar_(valor);
  return t === 'true' || t === 'sim' || t === '1' || t === 'verdadeiro';
}
