'use strict';
/**
 * dashboard.js — tela Dashboard (aba DASHBOARD da planilha original), uma obra por vez.
 *
 * Gráficos da planilha, na mesma ordem de leitura:
 *   Total gasto vs. orçamento (rosca) · Orçamento × total gasto · Gastos vs. orçamento por grupo
 *   Pareto dos gastos por grupo · Total gasto por mês · % de conclusão das atividades
 * + os indicadores do topo (orçamento, gasto, disponível, saldo bruto, validação).
 *
 * O Pareto da planilha usa dois eixos (R$ e % acumulado). Aqui o % acumulado vira coluna de
 * texto ao lado das barras: um eixo só, sem ambiguidade de escala.
 * O cálculo é o mesmo do editor (Motor + calcularFase2 + calcularFase3); nada novo no backend.
 */

const painel = {
  ultimo: null,

  async mostrar(parametro) {
    const vista = el('vista-dashboard');
    vista.innerHTML = `<div class="cartao">${skeleton(8)}</div>`;
    const [modelo, , lista] = await Promise.all([dados.carregarModelo(), dados.carregarSinapi(), dados.carregarLista(true)]);
    if (!lista.length) {
      vista.innerHTML = '<div class="cartao"><p class="vazio">Nenhum orçamento ainda. Crie um em <a href="#/orcamentos/novo">+ Novo orçamento</a>.</p></div>';
      return;
    }
    const prioridade = { 'Em obra': 0, Aprovado: 1, 'Concluído': 2, Enviado: 3, Rascunho: 4, Recusado: 5 };
    const ordenada = lista.slice().sort((a, b) => (prioridade[a.status] ?? 9) - (prioridade[b.status] ?? 9));
    let id = parametro && lista.some((o) => o.id === parametro) ? parametro
      : (this.ultimo && lista.some((o) => o.id === this.ultimo) ? this.ultimo : ordenada[0].id);
    if (parametro !== id) history.replaceState(null, '', '#/dashboard/' + id);
    this.ultimo = id;

    const o = await api('getOrcamento', { id });
    let gastos = [], avisoGastos = '';
    try { gastos = await api('listGastos', { orcamento_id: id }); }
    catch (erro) {
      if (erro.codigo === 'SESSAO') throw erro;
      avisoGastos = /desconhecida|não existe/i.test(erro.message) ? MSG_GASTOS_APPS_SCRIPT : erro.message;
    }

    const base = editor.novoOrcamento(modelo);
    const orc = Object.assign(base, o.dados || {});
    orc.parametros = Object.assign({}, base.parametros, (o.dados || {}).parametros || {});
    orc.status = o.status;
    completarFase2(orc);
    const r = Motor.calcular({ modelo, sinapi: dados.sinapi, indiceSinapi: dados.indiceSinapi, orcamento: orc, hoje: hojeIso() });
    const f2 = calcularFase2(orc, r);
    const f3 = calcularFase3(orc, r, f2, gastos);

    this.renderizar(vista, { o, orc, r, f2, f3, lista: ordenada, avisoGastos });
  },

  renderizar(vista, { o, orc, r, f2, f3, lista, avisoGastos }) {
    const p = orc.parametros;
    const c = f2.crono;
    const s = f3;
    const mod = orc.contrato.modalidade === 'SEM' ? 'sem material' : 'com material';
    const estouro = s.saldo_contrato !== null && s.saldo_contrato < 0;
    vista.innerHTML = `
      <div class="barra-ferramentas dash-topo">
        <select id="dash-obra" class="campo" aria-label="Obra">${opcoesSelect(lista.map((x) => ({ valor: x.id, rotulo: `${x.cliente_nome} · ${x.id} · ${x.status}` })), o.id)}</select>
        <span class="espaco"></span>
        <a class="botao botao-secundario" href="#/orcamentos/${esc(o.id)}">Abrir orçamento →</a>
      </div>
      <div class="dash-cabecalho">
        <div><h2>${esc(p.cliente_nome || o.id)}</h2>
          <small>${esc([p.endereco_obra, p.cidade].filter(Boolean).join(' — ') || '—')} · ${p.area ? num2(p.area) + ' m²' : '—'} · ${mod}</small></div>
        <div class="dash-pilulas">${pilula(CLASSE_STATUS[o.status] || 'st-neutro', o.status)}
          ${r.pode_emitir ? pilula('st-pago', '✔ Validação OK') : pilula('st-breve', '! Não emitir sem revisar · ' + r.pendencias_emissao + ' pendência(s)')}</div>
      </div>
      ${avisoGastos ? `<div class="alerta alerta-ambar">${esc(avisoGastos)}</div>` : ''}
      <div class="cards-resumo dash-cards">
        <div class="card-numero"><span class="rotulo-card">Orçamento</span><span class="valor-card">${moeda(s.total_contrato)}</span><span class="sub-card">${s.total_contrato === null ? 'preencha as taxas comerciais' : 'valor do contrato'}</span></div>
        <div class="card-numero"><span class="rotulo-card">Total gasto</span><span class="valor-card">${moeda(s.total_gasto)}</span><span class="sub-card">${s.lancamentos} lançamento(s)</span></div>
        <div class="card-numero"><span class="rotulo-card">Disponível</span><span class="valor-card">${moeda(s.disponivel)}</span><span class="sub-card">nunca abaixo de zero</span></div>
        <div class="card-numero${estouro ? ' card-atraso' : ''}"><span class="rotulo-card">Saldo bruto</span><span class="valor-card">${moeda(s.saldo_contrato)}</span><span class="sub-card">inclui estouro</span></div>
        <div class="card-numero"><span class="rotulo-card">Obra concluída</span><span class="valor-card">${pct(c.pct_geral)}</span><span class="sub-card">${s.pct_gasto === null ? '' : pct(s.pct_gasto) + ' do custo já gasto'}</span></div>
        <div class="card-numero${c.situacao === 'PRAZO VENCIDO' ? ' card-atraso' : ''}"><span class="rotulo-card">Prazo</span><span class="valor-card">${esc(c.situacao)}</span>
          <span class="sub-card">${c.fim ? 'término ' + dataBr(c.fim) + (c.dias_restantes !== null && c.situacao !== 'CONCLUÍDA' ? ' · ' + (c.dias_restantes >= 0 ? c.dias_restantes + ' dias restantes' : -c.dias_restantes + ' dias de atraso') : '') : 'informe o início da obra'}</span></div>
      </div>
      <div class="dash-grade">
        <section class="cartao"><div class="cartao-titulo"><h2>Total gasto vs. orçamento</h2></div>${this.rosca(s)}</section>
        <section class="cartao"><div class="cartao-titulo"><h2>Orçamento × total gasto</h2></div>${this.comparativo(s)}</section>
        <section class="cartao dash-largo"><div class="cartao-titulo"><h2>Gastos vs. orçamento por grupo</h2>
          <div class="legenda"><span class="leg-orcado">Orçado</span><span class="leg-gasto">Gasto</span></div></div>
          <p class="nota">Orçado = custo do grupo na lista de itens. Grupo acima do orçado aparece com o selo ACIMA.</p>
          ${this.porGrupo(s)}</section>
        <section class="cartao"><div class="cartao-titulo"><h2>Pareto dos gastos</h2></div>${this.pareto(s)}</section>
        <section class="cartao"><div class="cartao-titulo"><h2>Total gasto por mês</h2></div>${this.porMes(s)}</section>
        <section class="cartao dash-largo"><div class="cartao-titulo"><h2>% de conclusão das atividades</h2>
          <a class="nota" href="#/orcamentos/${esc(o.id)}">registre o andamento na aba Cronograma</a></div>${this.atividades(c)}</section>
      </div>`;

    el('dash-obra').addEventListener('change', (ev) => { location.hash = '#/dashboard/' + ev.target.value; });
    ligarDicas(vista);
  },

  semGastos() {
    return '<p class="vazio">Nenhum gasto lançado ainda. Lance na aba <strong>Gastos</strong> do orçamento.</p>';
  },

  /** Rosca: gasto sobre o valor do contrato; o resto é o disponível. Estouro = anel inteiro vermelho. */
  rosca(s) {
    if (s.total_contrato === null) return '<p class="vazio">Sem valor de contrato: preencha as taxas comerciais do orçamento.</p>';
    const total = s.total_contrato || 1;
    const fracao = Math.min(1, s.total_gasto / total);
    const R = 54, C = 2 * Math.PI * R;
    const estouro = s.total_gasto > s.total_contrato;
    const arco = fracao * C;
    return `<div class="dash-rosca">
      <svg viewBox="0 0 140 140" class="grafico rosca" role="img" aria-label="Gasto ${pct(s.total_gasto / total)} do orçamento">
        <circle cx="70" cy="70" r="${R}" class="rosca-trilho"/>
        ${fracao > 0 ? `<circle cx="70" cy="70" r="${R}" class="rosca-arco${estouro ? ' estouro' : ''}" stroke-dasharray="${arco} ${C - arco}" transform="rotate(-90 70 70)"
          ${dica('Gasto', [moeda(s.total_gasto) + ' · ' + pct(s.total_gasto / total)])}/>` : ''}
        <text x="70" y="68" text-anchor="middle" class="rosca-valor">${pctInteiro(s.total_gasto / total)}</text>
        <text x="70" y="86" text-anchor="middle" class="rosca-rotulo">gasto</text>
      </svg>
      <dl class="dash-legenda-valores">
        <dt><i class="cor-gasto"></i>Gasto</dt><dd>${moeda(s.total_gasto)}</dd>
        <dt><i class="cor-trilho"></i>Disponível</dt><dd>${moeda(s.disponivel)}</dd>
        ${estouro ? `<dt class="erro-campo">⚠ Estouro</dt><dd class="erro-campo">${moeda(-s.saldo_contrato)}</dd>` : ''}
      </dl>
    </div>`;
  },

  comparativo(s) {
    const linhas = [['Orçamento (contrato)', s.total_contrato, 'orcado'], ['Custo orçado', s.custo_orcado, 'orcado'], ['Total gasto', s.total_gasto, 'gasto']];
    const maior = Math.max(1, ...linhas.map((l) => l[1] || 0));
    return `<div class="dash-barras">${linhas.map(([rot, v, cls]) => `
      <div class="db-linha" ${dica(rot, [moeda(v)])}>
        <span class="db-nome">${esc(rot)}</span>
        <span class="db-trilho"><i class="db-${cls}" style="width:${((v || 0) / maior) * 100}%"></i></span>
        <span class="db-valor">${moeda(v)}</span>
      </div>`).join('')}</div>
      <p class="nota">Contrato = custo orçado + administração e proteção. A diferença é a margem prevista: <strong>${moeda(s.margem_prevista)}</strong>.</p>`;
  },

  porGrupo(s) {
    if (!s.grupos.length) return '<p class="vazio">Sem grupos com orçamento.</p>';
    const maior = Math.max(1, ...s.grupos.map((g) => Math.max(g.orcado, g.gasto)));
    return `<div class="dash-grupos">${s.grupos.map((g) => `
      <div class="dg-linha" ${dica(g.grupo, ['Orçado ' + moeda(g.orcado), 'Gasto ' + moeda(g.gasto) + (g.pct === null ? '' : ' · ' + pct(g.pct)), 'Saldo ' + moeda(g.saldo)])}>
        <span class="dg-nome">${esc(g.grupo)}${g.status !== 'OK' ? ' ' + pilula(STATUS_GRUPO[g.status], g.status) : ''}</span>
        <span class="dg-barras">
          <span class="db-trilho fino"><i class="db-orcado" style="width:${(g.orcado / maior) * 100}%"></i></span>
          <span class="db-trilho fino"><i class="db-gasto" style="width:${(g.gasto / maior) * 100}%"></i></span>
        </span>
        <span class="dg-valor"><strong>${moeda(g.gasto)}</strong><small>de ${moeda(g.orcado)}</small></span>
      </div>`).join('')}</div>`;
  },

  pareto(s) {
    const com = s.grupos.filter((g) => g.gasto > 0).sort((a, b) => b.gasto - a.gasto);
    if (!com.length) return this.semGastos();
    const total = com.reduce((t, g) => t + g.gasto, 0);
    let acum = 0, n80 = 0;
    const linhas = com.map((g) => {
      acum += g.gasto;
      const a = acum / total;
      if (a - g.gasto / total < 0.8) n80++;
      return { g, parte: g.gasto / total, acum: a };
    });
    return `<div class="dash-pareto">
      <div class="dp-cab"><span>Grupo</span><span></span><span class="num">Gasto</span><span class="num">Acum.</span></div>
      ${linhas.map((l, i) => `<div class="dp-linha${i < n80 ? ' dp-vital' : ''}" ${dica(l.g.grupo, [moeda(l.g.gasto) + ' · ' + pct(l.parte) + ' do gasto', 'acumulado ' + pct(l.acum)])}>
        <span class="dp-nome">${esc(l.g.grupo)}</span>
        <span class="db-trilho fino"><i class="db-gasto" style="width:${(l.g.gasto / com[0].gasto) * 100}%"></i></span>
        <span class="num">${moeda(l.g.gasto)}</span><span class="num">${pctInteiro(l.acum)}</span>
      </div>`).join('')}
    </div>
    <p class="nota">${n80 === 1 ? 'O primeiro grupo concentra' : `Os ${n80} primeiros grupos concentram`} 80% do que já foi gasto: é onde controlar compras dá mais resultado.</p>`;
  },

  porMes(s) {
    const meses = s.meses;
    if (!meses.length || !s.total_gasto) return this.semGastos();
    const maior = Math.max(...meses.map((m) => m.gasto)) || 1;
    const W = 560, H = 190, base = 160, topo = 14, esq = 8;
    const larg = (W - esq) / meses.length;
    const barra = Math.max(4, Math.min(28, larg - 6));
    const atual = hojeIso().slice(0, 7);
    const grade = [0.5, 1].map((f) => `<line x1="${esq}" x2="${W}" y1="${base - f * (base - topo)}" y2="${base - f * (base - topo)}"/>`).join('');
    const passo = Math.ceil(meses.length / 12);
    return `<svg viewBox="0 0 ${W} ${H}" class="grafico dash-meses" role="img" aria-label="Total gasto por mês">
      <g class="grade">${grade}</g>
      <text x="${W}" y="${topo - 3}" text-anchor="end">${esc(moeda(maior))}</text>
      ${meses.map((m, i) => {
        const h = (m.gasto / maior) * (base - topo);
        const x = esq + i * larg + (larg - barra) / 2;
        return `<g class="grupo" ${dica(mesBr(m.mes), [moeda(m.gasto)])}>
          <rect class="barra-fundo" x="${esq + i * larg}" y="${topo}" width="${larg}" height="${base - topo}"/>
          ${h > 0 ? `<path class="barra-gasto${m.mes === atual ? ' atual' : ''}" d="M${x},${base} v${-(h - Math.min(4, h))} q0,${-Math.min(4, h)} ${Math.min(4, barra / 2)},${-Math.min(4, h)} h${barra - 2 * Math.min(4, barra / 2)} q${Math.min(4, barra / 2)},0 ${Math.min(4, barra / 2)},${Math.min(4, h)} v${h - Math.min(4, h)} z"/>` : ''}
          ${i % passo === 0 ? `<text x="${esq + i * larg + larg / 2}" y="${base + 16}" text-anchor="middle"${m.mes === atual ? ' class="mes-atual"' : ''}>${mesBr(m.mes)}</text>` : ''}
        </g>`;
      }).join('')}
      <line class="linha-base" x1="${esq}" x2="${W}" y1="${base}" y2="${base}"/>
    </svg>
    ${this.resumoMeses(meses)}`;
  },

  /** Números de apoio do gráfico mensal: maior mês, média e o mês atual. */
  resumoMeses(meses) {
    const atual = hojeIso().slice(0, 7);
    const ate = meses.filter((m) => m.mes <= atual);
    const comGasto = ate.filter((m) => m.gasto > 0);
    if (!comGasto.length) return '';
    const maior = comGasto.reduce((a, b) => (b.gasto > a.gasto ? b : a));
    const media = ate.reduce((t, m) => t + m.gasto, 0) / ate.length;
    const mesAtual = meses.find((m) => m.mes === atual);
    return `<dl class="dash-mini">
      <div><dt>Maior mês</dt><dd>${moeda(maior.gasto)}<small>${mesBr(maior.mes)}</small></dd></div>
      <div><dt>Média mensal</dt><dd>${moeda(media)}<small>${ate.length} mês(es) desde o início</small></dd></div>
      <div><dt>Mês atual</dt><dd>${moeda(mesAtual ? mesAtual.gasto : 0)}<small>${mesBr(atual)}</small></dd></div>
    </dl>`;
  },

  atividades(c) {
    const etapas = c.etapas.filter((e) => e.dias > 0);
    if (!etapas.length) return '<p class="vazio">Cronograma sem etapas: informe a área e o início da obra na aba Dados.</p>';
    return `<div class="dash-atividades">${etapas.map((e) => `
      <div class="da-linha" ${dica(e.etapa, [pct(e.pct) + ' · ' + e.status].concat(e.inicio ? [dataBr(e.inicio) + ' a ' + dataBr(e.fim)] : []))}>
        <span class="da-nome">${esc(e.etapa)}</span>
        <span class="db-trilho fino"><i class="db-orcado" style="width:${e.pct * 100}%"></i></span>
        <span class="da-pct">${pctInteiro(e.pct)}</span>
        <span class="da-status">${pilula(STATUS_ETAPA[e.status] || 'st-neutro', e.status)}</span>
      </div>`).join('')}</div>`;
  },
};

const pctInteiro = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : Math.round(v * 100) + '%');

/** Atributo data-dica: título + linhas, tudo escapado (o texto vira HTML só dentro da dica). */
function dica(titulo, linhas) {
  const html = '<strong>' + esc(titulo) + '</strong>' + linhas.map(esc).join('<br>');
  return ' data-dica="' + esc(html) + '"';
}

/** Dica (tooltip) que segue o mouse em qualquer elemento com data-dica (HTML já escapado). */
function ligarDicas(raiz) {
  let dica = el('dica-grafico');
  if (!dica) {
    dica = document.createElement('div');
    dica.id = 'dica-grafico';
    dica.className = 'tooltip-grafico';
    dica.hidden = true;
    document.body.appendChild(dica);
  }
  raiz.addEventListener('mousemove', (ev) => {
    const alvo = ev.target.closest('[data-dica]');
    if (!alvo || !raiz.contains(alvo)) { dica.hidden = true; return; }
    dica.innerHTML = alvo.dataset.dica;
    dica.hidden = false;
    const w = dica.offsetWidth, h = dica.offsetHeight;
    const x = ev.clientX + 14 + w > window.innerWidth ? ev.clientX - w - 14 : ev.clientX + 14;
    const y = ev.clientY + 14 + h > window.innerHeight ? ev.clientY - h - 14 : ev.clientY + 14;
    dica.style.left = x + 'px';
    dica.style.top = y + 'px';
  });
  raiz.addEventListener('mouseleave', () => { dica.hidden = true; });
}
