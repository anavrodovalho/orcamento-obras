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
  const vantagens = [e.vantagem_1, e.vantagem_2, e.vantagem_3].filter((v) => String(v || '').trim());
  const historia = String(e.historia || '').split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);

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

    ${historia.length || vantagens.length ? `
    <section class="pr-secao">
      <h2>Sobre a empresa</h2>
      ${historia.map((t) => `<p>${esc(t)}</p>`).join('')}
      ${vantagens.length ? `<ul class="pr-vantagens">${vantagens.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : ''}
    </section>` : ''}

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

function fecharImpressao() {
  el('impressao').hidden = true;
  document.body.classList.remove('modo-impressao');
  document.title = 'Orçamento · Orçamento de Obras';
}
