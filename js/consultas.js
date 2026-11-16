'use strict';
/**
 * consultas.js — telas só de leitura: busca na base SINAPI e o modelo de itens (cfg_itens).
 */

const consultas = {
  buscaSinapi: '',
  buscaModelo: '',

  async mostrarSinapi() {
    const vista = el('vista-sinapi');
    vista.innerHTML = `<div class="cartao">${skeleton(6)}</div>`;
    const base = await dados.carregarSinapi();
    const semPreco = base.insumos.filter((i) => i[4] === null).length;
    vista.innerHTML = `
      <div class="cards-resumo">
        <div class="card-numero"><span class="rotulo-card">Competência</span><span class="valor-card">${competenciaBr(base.competencia)}</span><span class="sub-card">emissão ${dataBr(base.emissao)}</span></div>
        <div class="card-numero"><span class="rotulo-card">Insumos</span><span class="valor-card">${base.insumos.length.toLocaleString('pt-BR')}</span><span class="sub-card">${semPreco.toLocaleString('pt-BR')} sem preço em GO</span></div>
        <div class="card-numero"><span class="rotulo-card">Localidade</span><span class="valor-card">Goiás</span><span class="sub-card">${esc(base.localidade)} · ${esc(base.regime)}</span></div>
      </div>
      <div class="barra-ferramentas">
        <input id="sn-busca" class="campo" type="search" placeholder="Código ou palavras da descrição (ex.: cimento cp ii)" value="${esc(this.buscaSinapi)}">
      </div>
      <div class="cartao"><div id="sn-tabela"></div></div>`;
    const desenhar = () => {
      const termos = semAcento(this.buscaSinapi).split(/\s+/).filter(Boolean);
      if (!termos.length) { el('sn-tabela').innerHTML = '<p class="vazio">Digite um código ou parte da descrição.</p>'; return; }
      const achados = [];
      for (const i of base.insumos) {
        const texto = semAcento(i[0] + ' ' + i[1]);
        if (termos.every((t) => texto.includes(t))) achados.push(i);
        if (achados.length >= 200) break;
      }
      el('sn-tabela').innerHTML = achados.length ? `
        <div class="tabela-rolagem"><table class="tabela tabela-responsiva">
          <thead><tr><th>Código</th><th>Descrição</th><th>UN</th><th>Origem</th><th class="num">Preço GO</th></tr></thead>
          <tbody>${achados.map((i) => `<tr>
            <td data-rotulo="Código">${esc(i[0])}</td>
            <td class="principal-cel quebra">${esc(i[1])}</td>
            <td data-rotulo="UN">${esc(i[2])}</td>
            <td data-rotulo="Origem">${esc(i[3])}</td>
            <td class="num" data-rotulo="Preço GO">${i[4] === null ? '<span class="pilula st-breve">sem preço</span>' : moeda(i[4])}</td></tr>`).join('')}</tbody>
        </table></div>${achados.length >= 200 ? '<p class="nota">Mostrando os 200 primeiros. Refine a busca.</p>' : ''}`
        : '<p class="vazio">Nada encontrado.</p>';
    };
    el('sn-busca').addEventListener('input', debounce((e) => { this.buscaSinapi = e.target.value; desenhar(); }, 200));
    desenhar();
    el('sn-busca').focus();
  },

  async mostrarModelo() {
    const vista = el('vista-modelo');
    vista.innerHTML = `<div class="cartao">${skeleton(8)}</div>`;
    const [modelo] = await Promise.all([dados.carregarModelo(true), dados.carregarSinapi()]);

    // Testa cada fórmula com uma obra neutra para achar erros de digitação na planilha.
    const vars = Object.assign(Motor.variaveis({ area: 100, terreno: 'PLANO', telhado: 'EMBUTIDO', pavimentos: 'TÉRREO', acabamento: 'MÉDIO', pintura: 'NORMAL', portao: 'NÃO', terraplanagem: 'CONSTRUTOR' }), { AEQ: 100 });
    const somaPct = (l) => l.reduce((s, f) => s + (Number(f.percentual) || 0), 0);
    const linhas = modelo.itens.map((i) => {
      const t = Formula.calcular(i.formula_qtd, Object.assign({ FATOR: Motor.num(i.fator) }, vars));
      const ref = i.codigo ? dados.indiceSinapi.get(String(i.codigo)) : null;
      return Object.assign({}, i, { erro: t.erro || '', ref });
    });
    const erros = linhas.filter((l) => l.erro).length;
    const semPreco = linhas.filter((l) => l.preco_manual === null && !(l.ref && l.ref.preco)).length;

    vista.innerHTML = `
      <div class="alerta alerta-roxo">Para mudar fatores, fórmulas, preços manuais, rateio, termos, dados da empresa ou BDI, edite as abas <strong>cfg_*</strong> da planilha e clique em recarregar (↻). Esta tela só mostra o que está lá.</div>
      <div class="cards-resumo">
        <div class="card-numero"><span class="rotulo-card">Itens no modelo</span><span class="valor-card">${linhas.length}</span><span class="sub-card">${linhas.filter((l) => !l.ativo).length} inativo(s)</span></div>
        <div class="card-numero ${erros ? 'card-atraso' : ''}"><span class="rotulo-card">Fórmulas com erro</span><span class="valor-card">${erros}</span><span class="sub-card">testadas com uma obra neutra</span></div>
        <div class="card-numero ${semPreco ? 'card-breve' : ''}"><span class="rotulo-card">Sem preço</span><span class="valor-card">${semPreco}</span><span class="sub-card">nem SINAPI GO nem preço manual</span></div>
      </div>
      <div class="detalhe-grade">
        <div class="cartao"><div class="cartao-titulo"><h2>Rateio COM material</h2><span class="nota">soma ${pct(somaPct(modelo.rateio.COM))}</span></div>
          <table class="tabela"><tbody>${modelo.rateio.COM.map((f) => `<tr><td>${esc(f.fase)}</td><td class="num">${pct(f.percentual)}</td></tr>`).join('')}</tbody></table></div>
        <div class="cartao"><div class="cartao-titulo"><h2>Rateio SEM material</h2><span class="nota">soma ${pct(somaPct(modelo.rateio.SEM))}</span></div>
          <table class="tabela"><tbody>${modelo.rateio.SEM.map((f) => `<tr><td>${esc(f.fase)}</td><td class="num">${pct(f.percentual)}</td></tr>`).join('')}</tbody></table></div>
      </div>
      <div class="cartao">
        <div class="cartao-titulo"><h2>Itens e fórmulas de quantidade</h2>
          <span class="nota">Variáveis: AEQ, FATOR, AREA, MURO, GRAMA, PISO_EXT, GOURMET, PISCINA, SAUNA, GARAGEM, GESSO, BANHEIROS, LAVABOS, QUARTOS, COZINHAS, DUCHAS, ESCADAS, TEM_GOURMET, TERRENO, TELHADO, PAVIMENTOS, ACABAMENTO, PINTURA, PORTAO, PORTAO_LARGURA, PORTAO_ALTURA, TERRAPLANAGEM, REGISTROS_SAUNA, JANELAS_SAUNA, REGISTROS_GOURMET</span></div>
        <div class="barra-ferramentas"><input id="md-busca" class="campo" type="search" placeholder="Buscar…" value="${esc(this.buscaModelo)}"></div>
        <div id="md-tabela"></div>
      </div>
      ${this.cartaoCronograma(modelo, vars)}
      ${this.cartaoContrato(modelo, vars)}`;
    const desenhar = () => {
      const b = semAcento(this.buscaModelo);
      const lista = linhas.filter((l) => !b || semAcento([l.id, l.grupo, l.categoria, l.codigo, l.descricao_manual, l.ref && l.ref.descricao, l.formula_qtd].join(' ')).includes(b));
      el('md-tabela').innerHTML = `<div class="tabela-rolagem"><table class="tabela tabela-modelo">
        <thead><tr><th>ID</th><th>Grupo / categoria</th><th>Código</th><th>Descrição</th><th class="num">Fator</th><th>Fórmula da quantidade</th><th class="num">Preço</th></tr></thead>
        <tbody>${lista.map((l) => `<tr class="${l.erro ? 'linha-pendente' : ''}${l.ativo ? '' : ' linha-zerada'}">
          <td>${esc(l.id)}</td>
          <td><small>${esc(l.grupo)}</small><br>${esc(l.categoria)}</td>
          <td>${esc(l.codigo || '—')}</td>
          <td class="quebra">${esc((l.ref && l.ref.descricao) || l.descricao_manual || '—')}</td>
          <td class="num">${l.fator === null ? '' : esc(numCampo(l.fator))}</td>
          <td><code>${esc(l.formula_qtd)}</code>${l.erro ? `<br><small class="erro-campo">${esc(l.erro)}</small>` : ''}</td>
          <td class="num">${l.preco_manual !== null ? moeda(l.preco_manual) + '<br><small>manual</small>' : l.ref && l.ref.preco ? moeda(l.ref.preco) : '<span class="pilula st-breve">pendente</span>'}</td>
        </tr>`).join('')}</tbody></table></div>`;
    };
    el('md-busca').addEventListener('input', debounce((e) => { this.buscaModelo = e.target.value; desenhar(); }, 150));
    desenhar();
  },

  /** cfg_cronograma: fórmula de dias de cada etapa testada com 100 m² e com 150 m². */
  cartaoCronograma(modelo, vars) {
    const etapas = modelo.cronograma || [];
    const c100 = Cronograma.calcular({ etapas, vars, data_inicio: '2025-01-01' });
    const c150 = Cronograma.calcular({ etapas, vars: Object.assign({}, vars, { AREA: 150 }), data_inicio: '2025-01-01' });
    return `<div class="cartao">
      <div class="cartao-titulo"><h2>Cronograma (cfg_cronograma)</h2>
        <span class="nota">${etapas.length} etapas · prazo ${c100.prazo_dias ?? '—'} dias com 100 m², ${c150.prazo_dias ?? '—'} dias com 150 m²</span></div>
      ${c100.erros.length ? `<p class="aviso-erro">${esc(c100.erros.join(' · '))}</p>` : ''}
      <div class="tabela-rolagem"><table class="tabela tabela-modelo">
        <thead><tr><th>ID</th><th>Etapa</th><th>Fórmula dos dias</th><th class="num">100 m²</th><th class="num">150 m²</th></tr></thead>
        <tbody>${c100.etapas.map((e, i) => `<tr class="${e.erro ? 'linha-pendente' : ''}"><td>${esc(e.id)}</td><td>${esc(e.etapa)}</td>
          <td><code>${esc(e.formula_dias)}</code>${e.erro ? `<br><small class="erro-campo">${esc(e.erro)}</small>` : ''}</td>
          <td class="num">${e.dias ?? '—'}</td><td class="num">${c150.etapas[i].dias ?? '—'}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  },

  /** cfg_contrato: cláusulas, condições e campos aceitos. */
  cartaoContrato(modelo, vars) {
    const linhas = (modelo.contrato || []).map((c) => {
      let cond = '';
      if (String(c.condicao || '').trim()) {
        const t = Formula.calcular(c.condicao, Object.assign({}, vars, { MODALIDADE: 'COM' }));
        if (t.erro) cond = t.erro;
      }
      const desconhecidos = (String(c.texto).match(/\{([A-Z_]+)\}/g) || []).filter((m) => !(m.slice(1, -1) in Contrato.CAMPOS));
      return Object.assign({}, c, { erro: cond || (desconhecidos.length ? 'campo desconhecido: ' + desconhecidos.join(', ') : '') });
    });
    const erros = linhas.filter((l) => l.erro).length;
    return `<div class="cartao">
      <div class="cartao-titulo"><h2>Contrato (cfg_contrato)</h2>
        <span class="nota">${linhas.length} linhas · ${erros} com erro · numeração das cláusulas é automática</span></div>
      <p class="nota">Campos aceitos no texto: ${Object.keys(Contrato.CAMPOS).map((k) => `<code>{${k}}</code> ${esc(Contrato.CAMPOS[k])}`).join(' · ')}.
        Na coluna <em>condicao</em> vale o formato das fórmulas, mais a variável <code>MODALIDADE</code> ("COM"/"SEM"). Ex.: <code>MODALIDADE="SEM"</code>.</p>
      <div class="tabela-rolagem"><table class="tabela tabela-modelo">
        <thead><tr><th class="num">Ordem</th><th>Seção</th><th>Tipo</th><th>Condição</th><th>Texto</th></tr></thead>
        <tbody>${linhas.map((l) => `<tr class="${l.erro ? 'linha-pendente' : ''}${l.ativo === false ? ' linha-zerada' : ''}">
          <td class="num">${esc(String(l.ordem))}</td><td><small>${esc(l.secao)}</small></td><td>${esc(l.tipo)}</td>
          <td>${l.condicao ? `<code>${esc(l.condicao)}</code>` : '—'}</td>
          <td class="quebra">${esc(l.texto)}${l.erro ? `<br><small class="erro-campo">${esc(l.erro)}</small>` : ''}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  },
};
