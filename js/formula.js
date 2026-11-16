/**
 * formula.js — interpretador das fórmulas de quantidade do modelo de itens.
 *
 * Sintaxe do Excel em português, para a Ana editar direto na planilha (aba cfg_itens):
 *   FATOR*AEQ*SE(TERRENO="PLANO"; 1; 1,6)
 *   SE(E(SAUNA>0; VAZIO(JANELAS_SAUNA)); PENDENTE("informe as janelas"); BANHEIROS+LAVABOS)
 *
 * - Separador de argumentos: ponto e vírgula (;). Decimal: vírgula ou ponto.
 * - Operadores: + - * / ^  e comparações = <> < > <= >=
 * - Texto entre aspas; a comparação de texto ignora acento e maiúsculas ("MÉDIO" = "medio").
 * - Campo vazio vale 0 nas contas; use VAZIO(x) para testar se foi preenchido.
 * - Funções: SE, E, OU, NAO, VAZIO, PAV, TER, PENDENTE, MAX, MIN, ARRED, ARREDONDAR_CIMA
 *
 * Nada é executado com eval: a fórmula vira uma árvore e é avaliada aqui.
 * Funciona no navegador (window.Formula) e no Node (require).
 */
(function (raiz) {
  'use strict';

  /** Erro lançado por PENDENTE("..."): o item fica pendente com essa mensagem. */
  function Pendencia(mensagem) {
    this.name = 'Pendencia';
    this.message = mensagem || 'dado pendente';
  }

  function ErroFormula(mensagem) {
    this.name = 'ErroFormula';
    this.message = mensagem;
  }

  function normalizar(t) {
    return String(t == null ? '' : t)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .trim().toUpperCase();
  }

  // ───────────── Léxico ─────────────
  function tokens(fonte) {
    const lista = [];
    let i = 0;
    const s = String(fonte);
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        let j = i;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
        if ((s[j] === ',' || s[j] === '.') && /[0-9]/.test(s[j + 1] || '')) {
          j++;
          while (j < s.length && /[0-9]/.test(s[j])) j++;
        }
        lista.push({ t: 'num', v: Number(s.slice(i, j).replace(',', '.')) });
        i = j;
        continue;
      }
      if (c === '"') {
        const fim = s.indexOf('"', i + 1);
        if (fim < 0) throw new ErroFormula('aspas sem fechamento');
        lista.push({ t: 'str', v: s.slice(i + 1, fim) });
        i = fim + 1;
        continue;
      }
      if (/[A-Za-zÀ-ÿ_]/.test(c)) {
        let j = i;
        while (j < s.length && /[A-Za-zÀ-ÿ0-9_.]/.test(s[j])) j++;
        lista.push({ t: 'id', v: normalizar(s.slice(i, j)).replace(/\./g, '_') });
        i = j;
        continue;
      }
      const dois = s.slice(i, i + 2);
      if (dois === '<>' || dois === '<=' || dois === '>=') { lista.push({ t: 'op', v: dois }); i += 2; continue; }
      if ('+-*/^()=<>;'.indexOf(c) >= 0) { lista.push({ t: 'op', v: c }); i++; continue; }
      if (c === ',') throw new ErroFormula('use ponto e vírgula (;) para separar os argumentos');
      throw new ErroFormula('caractere inválido: ' + c);
    }
    return lista;
  }

  // ───────────── Sintaxe (descida recursiva) ─────────────
  function analisar(fonte) {
    const tk = tokens(fonte);
    let p = 0;
    const olhar = () => tk[p];
    const eh = (v) => tk[p] && tk[p].t === 'op' && tk[p].v === v;
    const esperar = (v) => {
      if (!eh(v)) throw new ErroFormula('esperava "' + v + '"' + (tk[p] ? ' perto de ' + JSON.stringify(tk[p].v) : ' no fim'));
      p++;
    };

    function comparacao() {
      let esq = soma();
      while (tk[p] && tk[p].t === 'op' && ['=', '<>', '<', '>', '<=', '>='].indexOf(tk[p].v) >= 0) {
        const op = tk[p++].v;
        esq = { k: 'cmp', op, a: esq, b: soma() };
      }
      return esq;
    }
    function soma() {
      let esq = produto();
      while (eh('+') || eh('-')) { const op = tk[p++].v; esq = { k: 'bin', op, a: esq, b: produto() }; }
      return esq;
    }
    function produto() {
      let esq = potencia();
      while (eh('*') || eh('/')) { const op = tk[p++].v; esq = { k: 'bin', op, a: esq, b: potencia() }; }
      return esq;
    }
    function potencia() {
      const base = unario();
      if (eh('^')) { p++; return { k: 'bin', op: '^', a: base, b: potencia() }; }
      return base;
    }
    function unario() {
      if (eh('-')) { p++; return { k: 'neg', a: unario() }; }
      if (eh('+')) { p++; return unario(); }
      return primario();
    }
    function primario() {
      const t = olhar();
      if (!t) throw new ErroFormula('fórmula incompleta');
      if (t.t === 'num') { p++; return { k: 'num', v: t.v }; }
      if (t.t === 'str') { p++; return { k: 'str', v: t.v }; }
      if (t.t === 'id') {
        p++;
        if (eh('(')) {
          p++;
          const args = [];
          if (!eh(')')) {
            args.push(comparacao());
            while (eh(';')) { p++; args.push(comparacao()); }
          }
          esperar(')');
          if (!FUNCOES[t.v]) throw new ErroFormula('função desconhecida: ' + t.v);
          return { k: 'fn', nome: t.v, args };
        }
        return { k: 'var', nome: t.v };
      }
      if (eh('(')) { p++; const e = comparacao(); esperar(')'); return e; }
      throw new ErroFormula('símbolo inesperado: ' + t.v);
    }

    if (!tk.length) throw new ErroFormula('fórmula vazia');
    const arvore = comparacao();
    if (p < tk.length) throw new ErroFormula('sobrou texto depois de ' + JSON.stringify(tk[p - 1] ? tk[p - 1].v : ''));
    return arvore;
  }

  // ───────────── Avaliação ─────────────
  function numero(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v;
    throw new ErroFormula('texto usado em conta: "' + v + '"');
  }
  function verdadeiro(v) {
    if (typeof v === 'string') return v !== '';
    return numero(v) !== 0;
  }
  function comparar(op, a, b) {
    let x = a, y = b;
    if (typeof a === 'string' || typeof b === 'string') {
      x = normalizar(a); y = normalizar(b);
    } else {
      x = numero(a); y = numero(b);
    }
    switch (op) {
      case '=': return x === y;
      case '<>': return x !== y;
      case '<': return x < y;
      case '>': return x > y;
      case '<=': return x <= y;
      default: return x >= y;
    }
  }

  const ORDEM_PAV = ['TERREO', 'SUBSOLO+TERREO', 'SUBSOLO+TERREO+1PAV', 'TERREO+1PAV', 'TERREO+2PAV'];
  const ORDEM_TER = ['PLANO', 'DECLIVE', 'ACLIVE'];

  function escolher(ordem, valorVar, nomeVar, args, ctx) {
    if (args.length !== ordem.length) throw new ErroFormula(nomeVar === 'PAVIMENTOS' ? 'PAV precisa de 5 valores' : 'TER precisa de 3 valores');
    const pos = ordem.indexOf(normalizar(valorVar));
    if (pos < 0) throw new Pendencia('escolha ' + (nomeVar === 'PAVIMENTOS' ? 'os pavimentos' : 'o tipo de terreno'));
    return numero(avaliar(args[pos], ctx));
  }

  // Cada função recebe os nós (avaliação preguiçosa, como o SE do Excel).
  const FUNCOES = {
    SE: (a, ctx) => {
      if (a.length < 2 || a.length > 3) throw new ErroFormula('SE precisa de 2 ou 3 argumentos');
      if (verdadeiro(avaliar(a[0], ctx))) return avaliar(a[1], ctx);
      return a.length === 3 ? avaliar(a[2], ctx) : 0;
    },
    E: (a, ctx) => a.every((n) => verdadeiro(avaliar(n, ctx))),
    OU: (a, ctx) => a.some((n) => verdadeiro(avaliar(n, ctx))),
    NAO: (a, ctx) => !verdadeiro(avaliar(a[0], ctx)),
    VAZIO: (a, ctx) => { const v = avaliar(a[0], ctx); return v === null || v === undefined || v === ''; },
    PAV: (a, ctx) => escolher(ORDEM_PAV, ctx.vars.PAVIMENTOS, 'PAVIMENTOS', a, ctx),
    TER: (a, ctx) => escolher(ORDEM_TER, ctx.vars.TERRENO, 'TERRENO', a, ctx),
    PENDENTE: (a, ctx) => { throw new Pendencia(a.length ? String(avaliar(a[0], ctx)) : 'dado pendente'); },
    MAX: (a, ctx) => Math.max.apply(null, a.map((n) => numero(avaliar(n, ctx)))),
    MIN: (a, ctx) => Math.min.apply(null, a.map((n) => numero(avaliar(n, ctx)))),
    ARRED: (a, ctx) => {
      const f = Math.pow(10, a[1] ? numero(avaliar(a[1], ctx)) : 0);
      return Math.round(numero(avaliar(a[0], ctx)) * f) / f;
    },
    ARREDONDAR_CIMA: (a, ctx) => {
      const f = Math.pow(10, a[1] ? numero(avaliar(a[1], ctx)) : 0);
      return Math.ceil(numero(avaliar(a[0], ctx)) * f - 1e-9) / f;
    },
  };
  FUNCOES.ARREDONDAR_PARA_CIMA = FUNCOES.ARREDONDAR_CIMA;

  function avaliar(n, ctx) {
    switch (n.k) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'var':
        if (!Object.prototype.hasOwnProperty.call(ctx.vars, n.nome)) throw new ErroFormula('campo desconhecido: ' + n.nome);
        return ctx.vars[n.nome];
      case 'neg': return -numero(avaliar(n.a, ctx));
      case 'cmp': return comparar(n.op, avaliar(n.a, ctx), avaliar(n.b, ctx));
      case 'fn': return FUNCOES[n.nome](n.args, ctx);
      case 'bin': {
        const a = numero(avaliar(n.a, ctx));
        const b = numero(avaliar(n.b, ctx));
        switch (n.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': if (b === 0) throw new ErroFormula('divisão por zero'); return a / b;
          default: return Math.pow(a, b);
        }
      }
      default: throw new ErroFormula('nó inválido');
    }
  }

  const cache = new Map();
  function compilar(fonte) {
    const chave = String(fonte);
    if (!cache.has(chave)) {
      try { cache.set(chave, { arvore: analisar(chave) }); } catch (e) { cache.set(chave, { erro: e }); }
    }
    const c = cache.get(chave);
    if (c.erro) throw c.erro;
    return c.arvore;
  }

  /**
   * Calcula a fórmula com as variáveis informadas (chaves em MAIÚSCULAS, sem acento).
   * Devolve { valor } ou { pendente: 'mensagem' } ou { erro: 'mensagem' }. Nunca lança.
   */
  function calcular(fonte, vars) {
    try {
      const v = avaliar(compilar(fonte), { vars });
      if (typeof v === 'boolean') return { valor: v ? 1 : 0 };
      if (typeof v !== 'number' || !isFinite(v)) return { erro: 'a fórmula não resultou em número' };
      return { valor: v };
    } catch (e) {
      if (e instanceof Pendencia) return { pendente: e.message };
      if (e instanceof ErroFormula) return { erro: e.message };
      return { erro: String(e && e.message || e) };
    }
  }

  const api = { calcular, normalizar, ORDEM_PAV, ORDEM_TER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Formula = api;
})(typeof self !== 'undefined' ? self : this);
