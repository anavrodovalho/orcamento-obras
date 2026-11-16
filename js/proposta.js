'use strict';
/**
 * proposta.js — documentos A4: proposta ao cliente (abas "Cotação Cliente"/"sem mat") e contrato (aba Contrato).
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
  const escopo = Contrato.escopo(p);

  el('impressao-folha').innerHTML = `
    ${previa ? '<div class="marca-previa" aria-hidden="true">PRÉVIA</div>' : ''}
    ${cabecalhoFolha(e)}

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

/** Faixa verde com logo e dados da empresa (proposta e contrato). */
function cabecalhoFolha(e) {
  return `
    <header class="pr-topo">
      <img src="assets/logo-engenharia.png" alt="" class="pr-logo">
      <div>
        <strong>${esc(e.razao_social)}</strong>${e.cnpj ? ' | ' + esc(e.cnpj) : ''}<br>
        <span>${[e.endereco, e.telefone, e.email].filter(Boolean).map(esc).join('  |  ')}</span>
      </div>
    </header>`;
}

/** Contrato (aba Contrato da planilha) + Anexo I (parcelas) + Anexo II (cronograma físico). */
function abrirContrato() {
  const orc = editor.orc;
  const p = orc.parametros;
  const e = dados.modelo.empresa || {};
  const { contrato: k, parcelas: pr, crono } = editor.fase2;
  const minuta = !k.completo;

  el('impressao-folha').innerHTML = `
    ${minuta ? '<div class="marca-previa" aria-hidden="true">MINUTA</div>' : ''}
    ${cabecalhoFolha(e)}
    <h1 class="pr-titulo ct-titulo">Contrato de construção por empreitada
      <span>${k.modalidade === 'SEM' ? 'mão de obra — materiais por conta do contratante' : 'global — mão de obra e materiais'}</span></h1>
    ${minuta ? `<div class="pr-aviso"><strong>Minuta — não assinar.</strong> Pendências:<ul>${k.pendencias.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}

    ${k.secoes.map((s) => `
      <section class="ct-secao">
        ${s.titulo ? `<h2>${esc(s.titulo)}</h2>` : ''}
        ${s.itens.map((i) => `<p class="${i.tipo === 'clausula' ? 'ct-clausula' : 'ct-paragrafo'}">${i.tipo === 'clausula' ? `<strong>Cláusula ${esc(i.numero)}.</strong> ` : ''}${marcarPendentes(i.texto)}</p>`).join('')}
      </section>`).join('')}

    <p class="ct-local">${esc(p.cidade || '____________________')}, ______ de ________________________ de __________.</p>

    <div class="ct-assinaturas">
      <div><div class="linha-assinatura"></div><strong>CONTRATANTE</strong><span>${esc(p.cliente_nome || '')}${p.cliente_cpf ? ' · CPF ' + esc(p.cliente_cpf) : ''}</span></div>
      <div><div class="linha-assinatura"></div><strong>CONSTRUTOR</strong><span>${esc(e.razao_social || '')}${e.cnpj && !/x/i.test(e.cnpj) ? ' · CNPJ ' + esc(e.cnpj) : ''}</span></div>
      <div><div class="linha-assinatura"></div><strong>TESTEMUNHA 1</strong><span>Nome / CPF</span></div>
      <div><div class="linha-assinatura"></div><strong>TESTEMUNHA 2</strong><span>Nome / CPF</span></div>
    </div>
    <p class="ct-nota">Minuta sujeita à revisão jurídica e ao preenchimento integral do escopo e das condições comerciais.</p>

    <section class="ct-anexo">
      <h2>Anexo I — Cronograma de pagamentos</h2>
      ${pr.ok ? `
      <table class="pr-tabela">
        <thead><tr><th>Parcela</th><th>Vencimento</th><th class="num">Valor (R$)</th></tr></thead>
        <tbody>${pr.lista.map((x) => `<tr><td>${esc(x.rotulo)}</td><td>${dataBr(x.vencimento)}</td><td class="num">${moeda(x.valor)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Total do contrato</td><td class="num">${moeda(pr.total)}</td></tr></tfoot>
      </table>` : `<p class="pr-aviso">Parcelas não geradas: falta ${esc(pr.faltas.join(', '))}.</p>`}
    </section>

    <section class="ct-anexo">
      <h2>Anexo II — Cronograma físico</h2>
      ${crono.fim ? `
      <table class="pr-tabela">
        <thead><tr><th>Nº</th><th>Etapa</th><th>Início</th><th>Término</th><th class="num">Dias</th></tr></thead>
        <tbody>${crono.etapas.filter((x) => x.inicio).map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.etapa)}</td><td>${dataBr(x.inicio)}</td><td>${dataBr(x.fim)}</td><td class="num">${x.dias}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Prazo total</td><td>${dataBr(crono.inicio)}</td><td>${dataBr(crono.fim)}</td><td class="num">${crono.prazo_dias}</td></tr></tfoot>
      </table>` : '<p class="pr-aviso">Cronograma sem datas: informe o início da obra.</p>'}
    </section>`;

  document.title = `Contrato - ${p.cliente_nome || 'cliente'}`;
  el('impressao').hidden = false;
  document.body.classList.add('modo-impressao');
  el('impressao').scrollTop = 0;
}

/** Destaca no PDF os trechos "[PENDENTE: …]" (o texto já vem sem HTML). */
function marcarPendentes(texto) {
  return esc(texto).replace(/\[PENDENTE:?[^\]]*\]/g, (m) => `<mark class="ct-pendente">${m}</mark>`);
}

function fecharImpressao() {
  el('impressao').hidden = true;
  document.body.classList.remove('modo-impressao');
  document.title = 'Orçamento · Orçamento de Obras';
}
