/**
 * contrato.js — escopo da obra e minuta do contrato (aba Contrato da planilha).
 *
 * Funções puras (navegador e Node). As cláusulas vêm da aba cfg_contrato:
 *   ordem · secao · tipo (clausula | paragrafo) · condicao · texto
 *  - condicao: fórmula no mesmo formato das quantidades; vazia = sempre entra.
 *    Variáveis: as da obra + MODALIDADE ("COM" ou "SEM"). Ex.: MODALIDADE="SEM", TERRAPLANAGEM="CONTRATANTE".
 *  - texto: aceita campos entre chaves, ex. {CONTRATANTE}, {VALOR_TOTAL} (lista em CAMPOS abaixo).
 *  - As cláusulas são numeradas na ordem em que aparecem (Cláusula 1ª, 2ª…), então incluir,
 *    tirar ou trocar cláusulas na planilha não deixa buraco na numeração.
 *  - Campo sem valor vira "[PENDENTE: …]" e o contrato sai marcado como MINUTA.
 */
(function (raiz) {
  'use strict';

  const ehNode = typeof module !== 'undefined' && module.exports;
  const Formula = ehNode ? require('./formula.js') : raiz.Formula;

  const fmtNum = (v, casas) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const moedaTxt = (v) => (v === null || v === undefined || !isFinite(v)) ? null : fmtNum(v, 2);
  const dataTxt = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : null;
  const vazio = (v) => v === null || v === undefined || String(v).trim() === '';
  const n0 = (v) => Number(v) || 0;

  /** Escopo montado a partir dos parâmetros da obra: [rótulo, texto][]. */
  function escopo(p) {
    const m2 = (v) => fmtNum(v, 2) + ' m²';
    const minus = (s) => String(s || '').toLowerCase();
    const plural = (q, um, varios) => `${q} ${q === 1 ? um : varios}`;
    const maiuscula = (s) => s.replace(/^./, (c) => c.toUpperCase());
    const PAV = {
      'TÉRREO': 'residência térrea',
      'SUBSOLO+TÉRREO': 'residência com subsolo e térreo',
      'SUBSOLO+TÉRREO+1PAV': 'residência com subsolo, térreo e pavimento superior',
      'TÉRREO+1PAV': 'sobrado (térreo + 1 pavimento)',
      'TÉRREO+2PAV': 'residência com térreo + 2 pavimentos',
    };
    const linhas = [];
    linhas.push(['Obra', `Construção de ${PAV[p.pavimentos] || 'residência'}${n0(p.area) ? ' com ' + m2(p.area) + ' de área construída' : ''}.`]);

    const carac = [];
    if (p.terreno) carac.push(p.terreno === 'PLANO' ? 'terreno plano' : 'terreno em ' + minus(p.terreno));
    if (p.telhado) carac.push('telhado ' + minus(p.telhado));
    if (p.acabamento) carac.push('acabamento padrão ' + minus(p.acabamento));
    if (p.pintura) carac.push(p.pintura === 'NORMAL' ? 'pintura lisa' : 'pintura com grafiato/textura');
    if (p.pe_direito_duplo && p.pe_direito_duplo !== 'NENHUM') carac.push('pé-direito duplo na ' + minus(p.pe_direito_duplo));
    if (carac.length) linhas.push(['Características', maiuscula(carac.join(', ')) + '.']);

    const comodos = [
      [n0(p.quartos), 'quarto', 'quartos'], [n0(p.banheiros), 'banheiro', 'banheiros'], [n0(p.lavabos), 'lavabo', 'lavabos'],
      [n0(p.cozinhas), 'cozinha', 'cozinhas'], [n0(p.duchas), 'ducha', 'duchas'], [n0(p.escadas), 'escada', 'escadas'],
    ].filter(([q]) => q > 0).map(([q, um, v]) => plural(q, um, v));
    if (comodos.length) linhas.push(['Ambientes', comodos.join(', ') + '.']);

    const areas = [];
    if (n0(p.gourmet)) areas.push('área gourmet ' + m2(p.gourmet));
    if (n0(p.piscina)) areas.push('piscina ' + m2(p.piscina));
    if (n0(p.sauna)) areas.push('sauna ' + m2(p.sauna));
    if (n0(p.garagem)) areas.push('garagem ' + m2(p.garagem));
    if (n0(p.piso_ext)) areas.push('área externa com piso ' + m2(p.piso_ext));
    if (n0(p.grama)) areas.push('área externa com grama ' + m2(p.grama));
    if (n0(p.muro)) areas.push('muros ' + fmtNum(p.muro, 2) + ' m lineares');
    if (n0(p.gesso)) areas.push('gesso (sancas e rebaixos) ' + m2(p.gesso));
    if (areas.length) linhas.push(['Áreas complementares', maiuscula(areas.join('; ')) + '.']);

    if (p.portao === 'SIM') {
      const med = n0(p.portao_largura) && n0(p.portao_altura) ? ` de ${fmtNum(p.portao_largura, 2)} × ${fmtNum(p.portao_altura, 2)} m` : '';
      linhas.push(['Portão', `Incluso portão${med}.`]);
    } else if (p.portao === 'NÃO') {
      linhas.push(['Portão', 'Não incluso.']);
    }
    if (p.terraplanagem === 'CONSTRUTOR') linhas.push(['Terraplanagem', 'Inclusa no orçamento.']);
    if (p.terraplanagem === 'CONTRATANTE') linhas.push(['Terraplanagem', 'Por conta do contratante (fora deste orçamento).']);
    return linhas;
  }

  /** Campos aceitos no texto das cláusulas, com a descrição mostrada na tela Modelo. */
  const CAMPOS = {
    CONTRATANTE: 'nome do cliente', CPF: 'CPF do cliente', EMPRESA: 'razão social (cfg_empresa)', CNPJ: 'CNPJ (cfg_empresa)',
    ENDERECO_EMPRESA: 'endereço da empresa', AREA: 'área total do projeto', ENDERECO_OBRA: 'endereço da obra', CIDADE: 'cidade da obra',
    MODALIDADE_TEXTO: 'com material / só mão de obra', VALOR_TOTAL: 'valor do contrato', ENTRADA: 'valor da entrada',
    SALDO: 'total − entrada', N_PARCELAS: 'quantidade de parcelas', VALOR_PARCELA: 'valor de cada parcela',
    ULTIMA_PARCELA: 'valor da última parcela', DATA_BASE: 'data-base do parcelamento', INTERVALO: 'dias entre parcelas',
    PRAZO_DIAS: 'prazo da obra em dias', DATA_INICIO: 'início da obra', DATA_FIM: 'término previsto', ESCOPO: 'escopo da obra',
    ATIVIDADES: 'atividades do construtor',
  };

  function ordinal(n) { return n + 'ª'; }

  /**
   * @param {object} e
   *   modelo, orc, resultado (Motor.calcular), crono (Cronograma.calcular), parcelas (Cronograma.parcelas), vars
   */
  function montar(e) {
    const modelo = e.modelo || {};
    const emp = modelo.empresa || {};
    const orc = e.orc || {};
    const p = orc.parametros || {};
    const ct = orc.contrato || {};
    const mod = ct.modalidade === 'SEM' ? 'SEM' : 'COM';
    const r = e.resultado;
    const crono = e.crono || {};
    const parc = e.parcelas || { ok: false, faltas: [] };
    const pendencias = [];
    const pend = (msg) => { if (pendencias.indexOf(msg) < 0) pendencias.push(msg); };

    const textoEscopo = String(orc.escopo || '').split(/\n+/).map((t) => t.trim()).filter(Boolean).join(' ');
    const listaEscopo = escopo(p).map(([rot, txt]) => rot + ': ' + txt).join(' ');
    const cnpj = String(emp.cnpj || '').trim();
    const valores = {
      CONTRATANTE: p.cliente_nome, CPF: p.cliente_cpf, EMPRESA: emp.razao_social,
      CNPJ: /x/i.test(cnpj) ? '' : cnpj, ENDERECO_EMPRESA: emp.endereco,
      AREA: n0(p.area) ? fmtNum(p.area, 2) : '', ENDERECO_OBRA: p.endereco_obra, CIDADE: p.cidade,
      MODALIDADE_TEXTO: mod === 'COM' ? 'empreitada global (mão de obra e materiais)' : 'empreitada de mão de obra (materiais por conta do CONTRATANTE)',
      VALOR_TOTAL: parc.ok ? moedaTxt(parc.total) : (r && r.propostas[mod].total !== null ? moedaTxt(r.propostas[mod].total) : ''),
      ENTRADA: parc.ok ? moedaTxt(parc.entrada) : '', SALDO: parc.ok ? moedaTxt(parc.saldo) : '',
      N_PARCELAS: parc.ok ? String(parc.n) : '', VALOR_PARCELA: parc.ok ? moedaTxt(parc.valor) : '',
      ULTIMA_PARCELA: parc.ok ? moedaTxt(parc.ultima) : '', DATA_BASE: parc.ok ? dataTxt(parc.data_base) : '',
      INTERVALO: parc.ok ? String(parc.intervalo) : '',
      PRAZO_DIAS: crono.prazo_dias !== null && crono.prazo_dias !== undefined ? String(crono.prazo_dias) : '',
      DATA_INICIO: dataTxt(crono.inicio), DATA_FIM: dataTxt(crono.fim),
      ESCOPO: [textoEscopo, listaEscopo].filter(Boolean).join(' '),
      ATIVIDADES: !vazio(ct.atividades) ? ct.atividades : emp.atividades_construtor_padrao,
    };

    const preencher = (texto) => String(texto || '').replace(/\{([A-Z_]+)\}/g, (todo, campo) => {
      if (!(campo in CAMPOS)) { pend('Campo desconhecido no contrato: {' + campo + '} (cfg_contrato)'); return todo; }
      const v = valores[campo];
      if (vazio(v)) { pend('Contrato: falta ' + CAMPOS[campo]); return '[PENDENTE: ' + CAMPOS[campo] + ']'; }
      return String(v).trim();
    });

    const vars = Object.assign({}, e.vars || {}, { MODALIDADE: mod });
    const secoes = [];
    let numero = 0;
    (modelo.contrato || []).slice()
      .sort((a, b) => n0(a.ordem) - n0(b.ordem))
      .forEach((c) => {
        if (c.ativo === false) return;
        if (!vazio(c.condicao)) {
          const t = Formula.calcular(c.condicao, vars);
          if (t.valor === undefined) { pend('Condição inválida na cláusula de ordem ' + c.ordem + ': ' + (t.erro || t.pendente)); return; }
          if (!t.valor) return;
        }
        const titulo = String(c.secao || '').trim();
        let secao = secoes[secoes.length - 1];
        if (!secao || secao.titulo !== titulo) { secao = { titulo, itens: [] }; secoes.push(secao); }
        let texto = preencher(c.texto);
        if (/\[PENDENTE/i.test(texto) && !/\{/.test(c.texto)) pend('Contrato: ' + texto.replace(/^.*\[PENDENTE:?\s*/i, '').replace(/\].*$/, ''));
        const clausula = String(c.tipo || 'clausula').toLowerCase() !== 'paragrafo';
        if (clausula) numero++;
        secao.itens.push({ tipo: clausula ? 'clausula' : 'paragrafo', numero: clausula ? ordinal(numero) : '', texto });
      });

    if (!parc.ok) (parc.faltas || []).forEach((f) => pend('Parcelamento: falta ' + f));
    if (r && !r.propostas[mod].completa) pend('Orçamento ' + (mod === 'COM' ? 'com' : 'sem') + ' material incompleto (itens pendentes ou taxas vazias)');
    if (!(modelo.contrato || []).length) pend('A aba cfg_contrato não existe ou está vazia: atualize o Apps Script e rode setupPlanilha');

    return { modalidade: mod, secoes, pendencias, completo: pendencias.length === 0, clausulas: numero };
  }

  const api = { escopo, montar, CAMPOS };
  if (ehNode) module.exports = api;
  else raiz.Contrato = api;
})(typeof self !== 'undefined' ? self : this);
