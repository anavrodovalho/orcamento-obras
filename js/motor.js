/**
 * motor.js — cálculo do orçamento (o que a planilha fazia nas abas Lista de Materiais,
 * Cotação Cliente, Cotação Cliente sem mat, BDI e VALIDAÇÃO).
 *
 * Função pura: recebe modelo + base SINAPI + dados da obra e devolve tudo calculado.
 * Não lê planilha nem rede — por isso dá para testar no Node contra os números da planilha.
 *
 * Regras herdadas da planilha (aba LEIA-ME/ALTERAÇÕES):
 *  - Item só entra no total se estiver OK (descrição, unidade, preço e quantidade válidos).
 *  - Preço SINAPI zero ou ausente não vira zero: o item fica pendente até ter preço manual.
 *  - Taxas vazias não viram zero: a proposta fica sem total até a taxa ser informada.
 *  - COM material: (MO + adm × custo total) + materiais × (1 + proteção).
 *  - SEM material: MO × (1 + adm).
 * Diferença proposital: item com quantidade zero e sem preço fica "NÃO SE APLICA" (não trava a emissão).
 */
(function (raiz) {
  'use strict';

  const Formula = (typeof module !== 'undefined' && module.exports) ? require('./formula.js') : raiz.Formula;
  const GRUPO_MO = 'MÃO-DE-OBRA';

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let t = String(v).trim().replace(/R\$\s?/, '').replace('%', '');
    if (/,/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    const n = Number(t);
    return isFinite(n) ? n : null;
  }

  /** Índice da base SINAPI: código → { descricao, unidade, origem, preco }. */
  function indexarSinapi(base) {
    const mapa = new Map();
    if (!base || !base.insumos) return mapa;
    base.insumos.forEach((l) => {
      mapa.set(String(l[0]), { descricao: l[1], unidade: l[2], origem: l[3], preco: l[4] });
    });
    return mapa;
  }

  /** Variáveis disponíveis nas fórmulas (nomes em MAIÚSCULAS). */
  function variaveis(p) {
    const n = (k) => num(p[k]);
    return {
      MURO: n('muro'), AREA: n('area'), GRAMA: n('grama'), PISO_EXT: n('piso_ext'),
      GOURMET: n('gourmet'), PISCINA: n('piscina'), SAUNA: n('sauna'), GARAGEM: n('garagem'),
      GESSO: n('gesso'),
      BANHEIROS: n('banheiros'), LAVABOS: n('lavabos'), QUARTOS: n('quartos'), COZINHAS: n('cozinhas'),
      DUCHAS: n('duchas'), ESCADAS: n('escadas'),
      TEM_GOURMET: (n('gourmet') !== null && p.gourmet !== '') ? 1 : 0,
      TERRENO: p.terreno || '', TELHADO: p.telhado || '', PAVIMENTOS: p.pavimentos || '',
      ACABAMENTO: p.acabamento || '', PE_DIREITO_DUPLO: p.pe_direito_duplo || '', PINTURA: p.pintura || '',
      PORTAO: p.portao || '', PORTAO_LARGURA: n('portao_largura'), PORTAO_ALTURA: n('portao_altura'),
      REGISTROS_SAUNA: n('registros_sauna'), JANELAS_SAUNA: n('janelas_sauna'),
      REGISTROS_GOURMET: n('registros_gourmet'), TERRAPLANAGEM: p.terraplanagem || '',
    };
  }

  function calcularBdi(b) {
    const v = (k) => num(b && b[k]) || 0;
    const ac = v('administracao_central') + v('seguro') + v('risco') + v('garantia');
    const impostos = v('pis') + v('cofins') + v('issqn') + v('inss') + v('outros');
    const valores = ['administracao_central', 'seguro', 'risco', 'garantia', 'despesas_financeiras', 'lucro',
      'pis', 'cofins', 'issqn', 'inss', 'outros'].map(v);
    if (impostos >= 1 || Math.min.apply(null, valores) < 0) return { valido: false, bdi: null, ac, impostos };
    const bdi = ((1 + ac) * (1 + v('despesas_financeiras')) * (1 + v('lucro')) / (1 - impostos)) - 1;
    return { valido: true, bdi, ac, impostos, financeiro: v('despesas_financeiras') + v('lucro') };
  }

  function formatarPct(x) {
    return (x * 100).toFixed(2).replace('.', ',') + '%';
  }

  /** Um item do modelo (ou adicional) → linha calculada. */
  function calcularItem(item, vars, sinapi, ajuste) {
    const codigo = item.codigo === null || item.codigo === undefined ? '' : String(item.codigo).trim();
    const ref = codigo ? sinapi.get(codigo) : null;
    const fator = num(item.fator);

    // Quantidade
    let qtd = null, motivo = '';
    const qtdAjuste = ajuste ? num(ajuste.qtd) : null;
    if (qtdAjuste !== null) {
      qtd = qtdAjuste;
    } else if (item.qtd !== undefined && item.formula_qtd === undefined) {
      qtd = num(item.qtd); // adicionais: quantidade digitada
      if (qtd === null) motivo = 'informe a quantidade';
    } else {
      const r = Formula.calcular(item.formula_qtd, Object.assign({ FATOR: fator }, vars));
      if (r.erro) motivo = 'fórmula inválida: ' + r.erro;
      else if (r.pendente) motivo = r.pendente;
      else qtd = r.valor;
    }

    // Preço: ajuste do orçamento > preço manual do modelo > SINAPI
    const precoAjuste = ajuste ? num(ajuste.preco) : null;
    // Modelo usa preco_manual; item adicional usa preco (digitado no orçamento).
    const precoManual = num(item.preco_manual !== undefined && item.preco_manual !== null && item.preco_manual !== '' ? item.preco_manual : item.preco);
    let preco = null, origem = '';
    if (precoAjuste !== null) { preco = precoAjuste; origem = 'AJUSTE'; }
    else if (precoManual !== null) { preco = precoManual; origem = 'MANUAL'; }
    else if (ref && num(ref.preco) > 0) { preco = num(ref.preco); origem = 'SINAPI'; }

    const descricao = (ref && ref.descricao) || item.descricao_manual || item.descricao || '';
    const unidade = (ref && ref.unidade) || item.unidade_manual || item.unidade || '';

    let status = 'OK';
    if (motivo) status = 'PENDENTE';
    else if (qtd < 0) { status = 'PENDENTE'; motivo = 'quantidade negativa'; }
    else if (qtd === 0 && preco === null) { status = 'NÃO SE APLICA'; }
    else if (!descricao || !unidade) { status = 'PENDENTE'; motivo = codigo && !ref ? 'código ' + codigo + ' não existe na base SINAPI: informe descrição, unidade e preço' : 'informe descrição e unidade'; }
    else if (preco === null) { status = 'PENDENTE'; motivo = codigo && ref ? 'sem preço SINAPI em GO: informe o preço manual' : 'informe o preço manual'; }
    else if (preco < 0) { status = 'PENDENTE'; motivo = 'preço negativo'; }
    else if (qtd > 0 && preco === 0) { status = 'PENDENTE'; motivo = 'preço zero com quantidade'; }

    return {
      id: item.id,
      ordem: item.ordem,
      grupo: item.grupo || 'ADICIONAIS',
      categoria: item.categoria || 'Adicionais',
      codigo,
      descricao,
      unidade,
      fator,
      formula_qtd: item.formula_qtd,
      qtd,
      preco,
      origem_preco: origem,
      total: status === 'OK' ? qtd * preco : (status === 'NÃO SE APLICA' ? 0 : null),
      status,
      motivo,
      ajustado: !!(ajuste && (qtdAjuste !== null || precoAjuste !== null)),
      adicional: !!item.adicional,
    };
  }

  /**
   * Calcula o orçamento inteiro.
   * entrada = { modelo, sinapi (base JSON), orcamento: { parametros, taxas, ajustes, adicionais, confirmacoes }, hoje }
   */
  function calcular(entrada) {
    const modelo = entrada.modelo;
    const orc = entrada.orcamento || {};
    const p = orc.parametros || {};
    const taxas = orc.taxas || {};
    const ajustes = orc.ajustes || {};
    const conf = orc.confirmacoes || {};
    const sinapi = entrada.indiceSinapi || indexarSinapi(entrada.sinapi);
    const empresa = modelo.empresa || {};

    const vars = variaveis(p);
    const rAeq = Formula.calcular(empresa.formula_area_equivalente || 'MURO/4 + AREA + PISO_EXT/20 + GOURMET/2 + PISCINA + SAUNA + GARAGEM', vars);
    const aeq = r_valor(rAeq);
    vars.AEQ = aeq;

    const ativos = (modelo.itens || []).filter((i) => i.ativo === undefined || i.ativo === true || String(i.ativo).toUpperCase() === 'TRUE' || String(i.ativo).toUpperCase() === 'SIM');
    const itens = ativos.map((i) => calcularItem(i, vars, sinapi, ajustes[i.id]))
      .concat((orc.adicionais || []).map((a, k) => calcularItem(Object.assign({ adicional: true, ordem: 1000 + k, grupo: 'ADICIONAIS' }, a), vars, sinapi, null)));

    // Totais por grupo/categoria (só itens OK, como o SUM da planilha)
    const grupos = {}, categorias = {};
    let subtotal = 0, mo = 0, pendentes = 0, moPendente = false;
    itens.forEach((it) => {
      if (it.status === 'PENDENTE') {
        pendentes++;
        if (it.grupo === GRUPO_MO) moPendente = true;
      }
      const v = it.status === 'OK' ? it.total : 0;
      grupos[it.grupo] = (grupos[it.grupo] || 0) + v;
      categorias[it.categoria] = (categorias[it.categoria] || 0) + v;
      subtotal += v;
      if (it.grupo === GRUPO_MO) mo += v;
    });
    const materiais = subtotal - mo;
    const completo = pendentes === 0 && rAeq.valor !== undefined;

    // Taxas
    const bdi = calcularBdi(modelo.bdi);
    const adm = taxas.usar_bdi ? (bdi.valido ? bdi.bdi : null) : num(taxas.administracao);
    const protecao = num(taxas.protecao);
    const adiantamento = num(taxas.adiantamento);
    const intervalo = num(taxas.intervalo);

    function fases(lista, base) {
      return (lista || []).map((f) => ({
        fase: f.fase, descricao: f.descricao, percentual: num(f.percentual) || 0,
        valor: base === null ? null : base * (num(f.percentual) || 0),
      }));
    }
    const somaPct = (lista) => (lista || []).reduce((s, f) => s + (num(f.percentual) || 0), 0);
    const rateioOk = (lista) => Math.abs(somaPct(lista) - 1) < 1e-6 && (lista || []).every((f) => (num(f.percentual) || 0) >= 0);

    const moAdm = adm === null ? null : mo + subtotal * adm;
    const materialCorrigido = protecao === null ? null : materiais * (1 + protecao);
    const totalCom = moAdm === null || materialCorrigido === null ? null : moAdm + materialCorrigido;
    const totalSem = adm === null ? null : mo * (1 + adm);

    const descCategorias = {};
    (modelo.categorias_material || []).forEach((c) => { descCategorias[c.categoria] = c.descricao; });
    const linhasMaterial = Object.keys(categorias)
      .filter((c) => c !== 'Mão-de-obra')
      .map((c) => ({ categoria: c, descricao: descCategorias[c] || '', valor: categorias[c] }))
      .sort((a, b) => {
        const ordem = (modelo.categorias_material || []).map((x) => x.categoria);
        const ia = ordem.indexOf(a.categoria), ib = ordem.indexOf(b.categoria);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });

    const propostas = {
      COM: {
        titulo: 'Proposta COM material incluso',
        mao_de_obra_adm: moAdm,
        fases: fases(modelo.rateio && modelo.rateio.COM, moAdm),
        rateio_ok: rateioOk(modelo.rateio && modelo.rateio.COM),
        materiais: linhasMaterial,
        materiais_total: materiais,
        protecao,
        materiais_corrigido: materialCorrigido,
        total: totalCom,
        completa: completo && totalCom !== null,
      },
      SEM: {
        titulo: 'Proposta SEM material incluso',
        mao_de_obra_adm: totalSem,
        fases: fases(modelo.rateio && modelo.rateio.SEM, totalSem),
        rateio_ok: rateioOk(modelo.rateio && modelo.rateio.SEM),
        total: totalSem,
        completa: !moPendente && totalSem !== null,
      },
    };

    // Termos gerais com os campos dinâmicos
    const textoTerraplanagem = p.terraplanagem === 'CONTRATANTE'
      ? 'Limpeza e terraplanagem: contratação pelo cliente, fora deste orçamento.'
      : p.terraplanagem === 'CONSTRUTOR'
        ? 'Terraplanagem incluída conforme itens e escopo deste orçamento.'
        : 'PENDENTE: definir o responsável pela terraplanagem.';
    const termos = (modelo.termos || []).filter((t) => String(t || '').trim()).map((t) => String(t)
      .replace('{ADIANTAMENTO}', adiantamento === null ? '[PENDENTE: informe o adiantamento]' : formatarPct(adiantamento))
      .replace('{TERRAPLANAGEM}', textoTerraplanagem));

    // Validação antes de emitir (aba VALIDAÇÃO, parte que cabe na fase 1)
    const hoje = entrada.hoje || new Date().toISOString().slice(0, 10);
    const competencia = entrada.sinapi && entrada.sinapi.competencia; // "2026-10"
    let diasBase = null;
    if (competencia) diasBase = Math.round((Date.parse(hoje) - Date.parse(competencia + '-01')) / 86400000);
    const limiteDias = num(empresa.dias_validade_precos) || 120;
    const pend = itens.filter((i) => i.status === 'PENDENTE');
    const validacao = [
      { item: 'Adiantamento', ok: adiantamento !== null && adiantamento >= 0 && adiantamento < 1, acao: 'Informe o % de adiantamento (pode ser 0%).' },
      { item: 'Administração / markup', ok: adm !== null && adm >= 0 && adm <= 5, acao: taxas.usar_bdi ? 'O BDI está inválido: confira a aba cfg_bdi.' : 'Informe a taxa de administração ou marque "usar BDI".' },
      { item: 'Proteção econômica', ok: protecao !== null && protecao >= 0 && protecao <= 1, acao: 'Informe o % de proteção nos materiais (pode ser 0%).' },
      { item: 'Intervalo de pagamentos', ok: intervalo !== null && intervalo >= 1 && Math.floor(intervalo) === intervalo, acao: 'Informe de quantos em quantos dias são os pagamentos.' },
      { item: 'Área e início da obra', ok: (num(p.area) || 0) > 0 && !!p.data_inicio, acao: 'Informe a área do projeto e a data de início.' },
      { item: 'Insumos e quantitativos', ok: pend.length === 0, acao: pend.length + ' item(ns) pendente(s) na aba Itens.' },
      { item: 'Rateio das propostas', ok: propostas.COM.rateio_ok && propostas.SEM.rateio_ok, acao: 'Os % por fase (cfg_rateio) devem somar 100% em cada proposta.' },
      { item: 'Coeficientes técnicos', ok: !!conf.coeficientes_revisados, acao: 'Confirme que revisou os coeficientes técnicos.' },
      { item: 'Competência e preços', ok: !!conf.precos_revisados && diasBase !== null && diasBase >= 0 && diasBase <= limiteDias, acao: diasBase !== null && diasBase > limiteDias ? 'A base SINAPI tem mais de ' + limiteDias + ' dias: atualize.' : 'Confirme que revisou os preços (regime com desoneração).' },
      { item: 'BDI', ok: bdi.valido, acao: 'Alíquotas do BDI inválidas (tributos somam 100% ou mais, ou há valor negativo).' },
      { item: 'Portão', ok: p.portao === 'NÃO' || (p.portao === 'SIM' && (num(p.portao_largura) || 0) > 0 && (num(p.portao_altura) || 0) > 0), acao: 'Diga se há portão e, se houver, as medidas.' },
      { item: 'Terraplanagem', ok: p.terraplanagem === 'CONSTRUTOR' || p.terraplanagem === 'CONTRATANTE', acao: 'Defina quem contrata a terraplanagem.' },
    ];
    if (rAeq.valor === undefined) validacao.unshift({ item: 'Área equivalente', ok: false, acao: 'Fórmula da área equivalente: ' + (rAeq.erro || rAeq.pendente) });
    const pendenciasEmissao = validacao.filter((v) => !v.ok).length;

    return {
      area_equivalente: aeq,
      itens,
      grupos,
      categorias,
      subtotal_valido: subtotal,
      mao_de_obra: mo,
      materiais,
      pendentes,
      completo,
      bdi,
      administracao: adm,
      lucro_com_material: adm === null ? null : subtotal * adm,
      lucro_sem_material: adm === null ? null : mo * adm,
      propostas,
      termos,
      validacao,
      pendencias_emissao: pendenciasEmissao,
      pode_emitir: pendenciasEmissao === 0,
      competencia_sinapi: competencia || '',
    };
  }

  function r_valor(r) { return r.valor === undefined ? 0 : r.valor; }

  const api = { calcular, calcularItem, calcularBdi, indexarSinapi, variaveis, num, GRUPO_MO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Motor = api;
})(typeof self !== 'undefined' ? self : this);
