'use strict';
/**
 * proposta.js — proposta ao cliente (abas "Cotação Cliente" e "Cotação Cliente sem mat").
 * Monta uma folha A4 e usa a impressão do navegador para gerar o PDF.
 * Sem todos os dados (itens pendentes ou validação incompleta), sai marcada como PRÉVIA.
 */

function abrirProposta(modalidade) {
  const r = editor.resultado;
  const orc = editor.orc;
  const p = orc.parametros;
  const e = dados.modelo.empresa || {};
  const prop = r.propostas[modalidade];
  const com = modalidade === 'COM';
  const previa = !prop.completa || !r.pode_emitir;

  const linhaFase = (f) => `<tr><td><strong>${esc(f.fase)}</strong></td><td>${esc(f.descricao)}</td><td class="num">${moeda(f.valor)}</td></tr>`;
  const textoEscopo = String(orc.escopo || '').split(/\n+/).map((t) => t.trim()).filter(Boolean);
  const escopo = montarEscopo(p);

  el('impressao-folha').innerHTML = `
    ${previa ? '<div class="marca-previa" aria-hidden="true">PRÉVIA</div>' : ''}
    <header class="pr-topo">
      <img src="assets/logo-engenharia.png" alt="" class="pr-logo">
      <div>
        <strong>${esc(e.razao_social)}</strong>${e.cnpj ? ' | ' + esc(e.cnpj) : ''}<br>
        <span>${[e.endereco, e.telefone, e.email].filter(Boolean).map(esc).join('  |  ')}</span>
      </div>
    </header>

    <h1 class="pr-titulo">Proposta de orçamento <span>${com ? 'com material incluso' : 'sem material (mão de obra e administração)'}</span></h1>
    ${previa ? `<p class="pr-aviso">Documento de prévia: ${r.pendentes ? r.pendentes + ' item(ns) sem preço ou quantidade' : 'há pendências na validação'}. Não enviar ao cliente.</p>` : ''}

    <dl class="pr-dados">
      <dt>Data do orçamento</dt><dd>${dataBr(p.data_orcamento)}</dd>
      <dt>Cliente</dt><dd>${esc(p.cliente_nome || '—')}</dd>
      <dt>Endereço da obra</dt><dd>${esc([p.endereco_obra, p.cidade].filter(Boolean).join(' — ') || '—')}</dd>
      <dt>Previsão de início</dt><dd>${dataBr(p.data_inicio)}</dd>
      <dt>Área total do projeto</dt><dd>${p.area ? num2(p.area) + ' m²' : '—'}</dd>
      <dt>Padrão</dt><dd>${esc([p.pavimentos, 'acabamento ' + (p.acabamento || '—').toLowerCase()].join(' · '))}</dd>
    </dl>

    <section class="pr-secao">
      <h2>Escopo do projeto</h2>
      ${textoEscopo.map((t) => `<p>${esc(t)}</p>`).join('')}
      <dl class="pr-escopo">${escopo.map(([rot, txt]) => `<dt>${esc(rot)}</dt><dd>${esc(txt)}</dd>`).join('')}</dl>
    </section>

    <section class="pr-secao">
      <h2>${com ? 'Mão de obra e administração' : 'Etapas da obra'}</h2>
      <table class="pr-tabela">
        <thead><tr><th>Etapa</th><th>Descrição</th><th class="num">R$</th></tr></thead>
        <tbody>${prop.fases.map(linhaFase).join('')}</tbody>
        <tfoot><tr><td colspan="2">${com ? 'Total de mão de obra e administração' : 'Total do orçamento'}</td><td class="num">${moeda(prop.mao_de_obra_adm)}</td></tr></tfoot>
      </table>
    </section>

    ${com ? `
    <section class="pr-secao">
      <h2>Materiais (estimativa)</h2>
      <table class="pr-tabela">
        <thead><tr><th>Grupo</th><th>Descrição</th><th class="num">R$</th></tr></thead>
        <tbody>${prop.materiais.filter((m) => m.valor > 0).map((m) => `<tr><td><strong>${esc(m.categoria)}</strong></td><td>${esc(m.descricao)}</td><td class="num">${moeda(m.valor)}</td></tr>`).join('')}</tbody>
        <tfoot>
          <tr><td colspan="2">Estimativa total de material</td><td class="num">${moeda(prop.materiais_total)}</td></tr>
          <tr class="sub"><td colspan="2">Reajuste dos materiais de construção (inflação)</td><td class="num">${pct(prop.protecao)}</td></tr>
        </tfoot>
      </table>
    </section>` : ''}

    <div class="pr-total"><span>Total do orçamento</span><strong>${moeda(prop.total)}</strong></div>

    ${String(orc.observacoes || '').trim() ? `<section class="pr-secao"><h2>Adicionais</h2>${String(orc.observacoes).split(/\n+/).map((t) => `<p>${esc(t)}</p>`).join('')}</section>` : ''}

    <section class="pr-secao pr-termos">
      <h2>Termos gerais</h2>
      <ol>${r.termos.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
    </section>

    <footer class="pr-assinatura">
      <p>Atenciosamente,</p>
      <div class="linha-assinatura"></div>
      <strong>${esc(e.responsavel_tecnico || '')}</strong>
      <span>${esc(e.razao_social || '')}</span>
    </footer>`;

  document.title = `Proposta ${com ? 'com' : 'sem'} material - ${p.cliente_nome || 'cliente'}`;
  el('impressao').hidden = false;
  document.body.classList.add('modo-impressao');
  window.scrollTo(0, 0);
}

/** Escopo da obra montado a partir dos parâmetros do orçamento: [rótulo, texto][]. */
function montarEscopo(p) {
  const n = (v) => Number(v) || 0;
  const m2 = (v) => num2(v) + ' m²';
  const minus = (s) => String(s || '').toLowerCase();
  const plural = (q, um, varios) => `${q} ${q === 1 ? um : varios}`;
  const PAV = {
    'TÉRREO': 'residência térrea',
    'SUBSOLO+TÉRREO': 'residência com subsolo e térreo',
    'SUBSOLO+TÉRREO+1PAV': 'residência com subsolo, térreo e pavimento superior',
    'TÉRREO+1PAV': 'sobrado (térreo + 1 pavimento)',
    'TÉRREO+2PAV': 'residência com térreo + 2 pavimentos',
  };
  const linhas = [];

  linhas.push(['Obra', `Construção de ${PAV[p.pavimentos] || 'residência'}${n(p.area) ? ' com ' + m2(p.area) + ' de área construída' : ''}.`]);

  const carac = [];
  if (p.terreno) carac.push(p.terreno === 'PLANO' ? 'terreno plano' : 'terreno em ' + minus(p.terreno));
  if (p.telhado) carac.push('telhado ' + minus(p.telhado));
  if (p.acabamento) carac.push('acabamento padrão ' + minus(p.acabamento));
  if (p.pintura) carac.push(p.pintura === 'NORMAL' ? 'pintura lisa' : 'pintura com grafiato/textura');
  if (p.pe_direito_duplo && p.pe_direito_duplo !== 'NENHUM') carac.push('pé-direito duplo na ' + minus(p.pe_direito_duplo));
  if (carac.length) linhas.push(['Características', carac.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.']);

  const comodos = [
    [n(p.quartos), 'quarto', 'quartos'], [n(p.banheiros), 'banheiro', 'banheiros'], [n(p.lavabos), 'lavabo', 'lavabos'],
    [n(p.cozinhas), 'cozinha', 'cozinhas'], [n(p.duchas), 'ducha', 'duchas'], [n(p.escadas), 'escada', 'escadas'],
  ].filter(([q]) => q > 0).map(([q, um, v]) => plural(q, um, v));
  if (comodos.length) linhas.push(['Ambientes', comodos.join(', ') + '.']);

  const areas = [];
  if (n(p.gourmet)) areas.push('área gourmet ' + m2(p.gourmet));
  if (n(p.piscina)) areas.push('piscina ' + m2(p.piscina));
  if (n(p.sauna)) areas.push('sauna ' + m2(p.sauna));
  if (n(p.garagem)) areas.push('garagem ' + m2(p.garagem));
  if (n(p.piso_ext)) areas.push('área externa com piso ' + m2(p.piso_ext));
  if (n(p.grama)) areas.push('área externa com grama ' + m2(p.grama));
  if (n(p.muro)) areas.push('muros ' + num2(p.muro) + ' m lineares');
  if (n(p.gesso)) areas.push('gesso (sancas e rebaixos) ' + m2(p.gesso));
  if (areas.length) linhas.push(['Áreas complementares', areas.join('; ').replace(/^./, (c) => c.toUpperCase()) + '.']);

  if (p.portao === 'SIM') {
    const med = n(p.portao_largura) && n(p.portao_altura) ? ` de ${num2(p.portao_largura)} × ${num2(p.portao_altura)} m` : '';
    linhas.push(['Portão', `Incluso portão${med}.`]);
  } else if (p.portao === 'NÃO') {
    linhas.push(['Portão', 'Não incluso.']);
  }
  if (p.terraplanagem === 'CONSTRUTOR') linhas.push(['Terraplanagem', 'Inclusa no orçamento.']);
  if (p.terraplanagem === 'CONTRATANTE') linhas.push(['Terraplanagem', 'Por conta do contratante (fora deste orçamento).']);
  return linhas;
}

function fecharImpressao() {
  el('impressao').hidden = true;
  document.body.classList.remove('modo-impressao');
  document.title = 'Orçamento · Orçamento de Obras';
}
