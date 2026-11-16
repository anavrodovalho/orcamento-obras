"""
Extrai da planilha "Orcamento de Obras SINAPI" (Excel) os dados que o sistema usa:

  data/sinapi/GO-AAAA-MM.json   base de insumos de Goiás (código, descrição, unidade, origem, preço)
  data/sinapi/index.json        lista das competências disponíveis
  data/modelo-padrao.json       modelo de itens (com fórmulas de quantidade), rateios, termos, empresa, BDI
  apps-script/Seed.gs           o mesmo modelo, embutido no Apps Script para o setupPlanilha()
  tests/exemplo-planilha.json   parâmetros e resultados da obra de exemplo (teste "golden")

Uso (rodar com -I por ser arquivo baixado):
  python -I tools/extrair_planilha.py "C:/Users/Pichau/Downloads/Planilha de Orcamento de Obras_SINAPI_2026_10.xlsx"
"""
import json
import os
import re
import sys
import warnings
from datetime import datetime

import openpyxl

warnings.filterwarnings("ignore")
sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ───────────── Fórmulas de quantidade, traduzidas linha a linha da aba "Lista de Materiais" ─────────────
# Sintaxe igual à do Excel em português: SE(cond; a; b), E(...), OU(...), decimais com vírgula.
# PAV(térreo; subsolo+térreo; subsolo+térreo+1pav; térreo+1pav; térreo+2pav) → multiplicador por pavimentos
# TER(plano; declive; aclive)                                              → multiplicador por terreno
AEQ = "FATOR*AEQ"
PAV_A = "FATOR*AEQ*PAV(1; 1,2; 1,3; 1,2; 1,4)"
PAV_B = "FATOR*AEQ*PAV(1; 1,1; 1,3; 1,2; 1,5)"
PISO_ACAB = "FATOR*(AEQ+PISO_EXT+GOURMET+SAUNA+GARAGEM)"
PINT = "FATOR*(AEQ+GOURMET+GARAGEM)"
BANCADA = "(BANHEIROS+LAVABOS)*1,8+(COZINHAS+TEM_GOURMET)*4,4"

FORMULAS = {
    9: 'FATOR*AEQ*SE(TERRENO="PLANO"; 1; 1,6)',
    10: 'FATOR*AEQ*SE(TERRENO="PLANO"; 1; 1,6)',
    11: 'FATOR*AEQ*SE(TERRENO="PLANO"; 1; 1,5)',
    12: 'FATOR*AEQ*SE(TERRENO="PLANO"; 1; 1,5)',
    13: 'FATOR*AEQ*SE(TERRENO="PLANO"; 1; 1,5)',
    14: 'FATOR*AEQ*SE(TERRENO="PLANO"; 1; 1,6)',
    20: AEQ, 21: AEQ, 27: AEQ, 30: AEQ, 31: AEQ, 32: AEQ,
    35: PAV_A, 36: PAV_A, 37: PAV_A, 39: PAV_A,
    38: PAV_A + "*SE(ESCADAS>0; 1,0649; 1)",
    40: "FATOR*AEQ*TER(1; 1,2; 1,1)",
    41: "SE(GESSO>0; GESSO*FATOR*21,4; FATOR*AEQ)",
    44: 'SE(TERRAPLANAGEM="CONTRATANTE"; 0; SE(TERRAPLANAGEM="CONSTRUTOR"; FATOR*AEQ; PENDENTE("defina quem paga a terraplanagem")))',
    45: 'SE(TERRAPLANAGEM="CONTRATANTE"; 0; SE(TERRAPLANAGEM="CONSTRUTOR"; FATOR*AEQ*TER(1; 19,5; 9,3); PENDENTE("defina quem paga a terraplanagem")))',
    48: "FATOR*AEQ*PAV(1; 30,5; 39,5; 31,5; 41,7)",
    49: "FATOR*AEQ*PAV(38,55; 1,5; 2,5; 1,8; 3,7)*SE(ESCADAS>0; 1,0749; 1)",
    50: PAV_B, 51: PAV_B, 53: PAV_B, 59: PAV_B,
    52: AEQ, 60: AEQ,
    63: AEQ, 64: AEQ, 65: AEQ, 66: AEQ, 67: AEQ, 68: AEQ,
    71: 'SE(TELHADO="EMBUTIDO"; FATOR*AEQ; 0)',
    72: 'SE(TELHADO="EMBUTIDO"; FATOR*AEQ; 0)',
    73: 'SE(TELHADO="COLONIAL"; FATOR*AEQ; 0)',
    74: AEQ, 75: AEQ, 76: AEQ,
    77: "1",
    **{r: AEQ for r in range(80, 94)},
    94: "1", 95: "2", 96: "1", 97: "1", 98: "1",
    101: AEQ, 102: AEQ,
    103: 'FATOR*AEQ*SE(TELHADO="EMBUTIDO"; 1,3; 1)',
    104: "BANHEIROS+LAVABOS",
    105: AEQ, 106: AEQ, 107: AEQ, 108: AEQ, 109: AEQ,
    110: "BANHEIROS+LAVABOS+COZINHAS+DUCHAS",
    111: "BANHEIROS",
    112: "BANHEIROS+LAVABOS+COZINHAS+1",
    113: "BANHEIROS+LAVABOS+COZINHAS+1",
    114: "BANHEIROS+LAVABOS",
    115: "1", 116: "1",
    117: "BANHEIROS+LAVABOS",
    118: "1", 119: "2", 120: "1", 121: "1",
    122: "BANHEIROS+LAVABOS+COZINHAS+1",
    125: "FATOR*(AEQ+PISO_EXT+GOURMET+PISCINA+SAUNA+GARAGEM)",
    126: "FATOR*(AEQ+PISO_EXT+GOURMET+PISCINA+SAUNA+GARAGEM)",
    127: "BANHEIROS+LAVABOS",
    128: 'SE(ACABAMENTO="ALTO"; 0; COZINHAS+TEM_GOURMET)',
    129: 'SE(ACABAMENTO="ALTO"; COZINHAS+TEM_GOURMET; 0)',
    130: "3",
    131: ('SE(OU(E(GOURMET>0; VAZIO(REGISTROS_GOURMET)); E(SAUNA>0; VAZIO(REGISTROS_SAUNA))); '
          'PENDENTE("informe os registros extras de gourmet/sauna"); '
          'BANHEIROS+LAVABOS+COZINHAS+DUCHAS+SE(GOURMET>0; REGISTROS_GOURMET; 0)+SE(SAUNA>0; REGISTROS_SAUNA; 0))'),
    132: f'SE(ACABAMENTO="POPULAR"; {BANCADA}; 0)',
    133: f'SE(ACABAMENTO="MEDIO"; {BANCADA}; 0)',
    134: f'SE(ACABAMENTO="ALTO"; {BANCADA}; 0)',
    135: "COZINHAS+TEM_GOURMET",
    136: f'SE(ACABAMENTO="POPULAR"; {PISO_ACAB}; 0)',
    137: f'SE(ACABAMENTO="MEDIO"; {PISO_ACAB}; 0)',
    138: f'SE(ACABAMENTO="ALTO"; {PISO_ACAB}; 0)',
    139: 'SE(ACABAMENTO="ALTO"; 0; GOURMET+PISCINA+SAUNA+AEQ*FATOR)',
    140: 'SE(ACABAMENTO="ALTO"; GOURMET+PISCINA+SAUNA+AEQ*FATOR; 0)',
    141: "BANHEIROS+LAVABOS+QUARTOS+COZINHAS+DUCHAS+ESCADAS+TEM_GOURMET+5",
    142: 'SE(ACABAMENTO="ALTO"; 0; FATOR*AEQ)',
    143: 'SE(ACABAMENTO="ALTO"; FATOR*AEQ; 0)',
    144: 'FATOR*AEQ*SE(TELHADO="EMBUTIDO"; 1,6; 1)',
    145: 'SE(ACABAMENTO="ALTO"; 0; BANHEIROS+LAVABOS+QUARTOS+COZINHAS+2)',
    146: "FATOR*GRAMA",
    147: 'SE(ACABAMENTO="ALTO"; BANHEIROS+LAVABOS+QUARTOS+COZINHAS+2; 0)',
    148: 'SE(ACABAMENTO="POPULAR"; QUARTOS+COZINHAS; 0)',
    149: 'SE(ACABAMENTO="MEDIO"; QUARTOS+COZINHAS; 0)',
    150: 'SE(ACABAMENTO="ALTO"; QUARTOS+COZINHAS; 0)',
    151: ('SE(E(SAUNA>0; VAZIO(JANELAS_SAUNA)); PENDENTE("informe as janelas extras da sauna"); '
          'BANHEIROS+LAVABOS+SE(SAUNA>0; JANELAS_SAUNA; 0))'),
    152: ('SE(PORTAO="NAO"; 0; SE(E(PORTAO="SIM"; PORTAO_LARGURA>0; PORTAO_ALTURA>0); '
          'PORTAO_LARGURA*PORTAO_ALTURA; PENDENTE("informe se há portão e as medidas")))'),
    155: PINT, 156: PINT, 157: PINT,
    158: f'SE(ACABAMENTO="POPULAR"; {PINT}; 0)',
    159: f'SE(ACABAMENTO="MEDIO"; {PINT}; 0)',
    160: f'SE(ACABAMENTO="ALTO"; {PINT}; 0)',
    161: f'SE(PINTURA<>"NORMAL"; {PINT}; 0)',
    162: f'SE(PINTURA="NORMAL"; {PINT}; 0)',
}

# Grupo (seção da lista) de cada intervalo de linhas — é o que o Dashboard compara com os gastos.
SECOES = [
    (8, "MÃO-DE-OBRA"), (19, "IMPOSTOS/ TAXAS"), (26, "PROJETO"), (29, "ALUGUÉIS"),
    (34, "ALVENARIA E GESSO"), (43, "TERRAPLANAGEM"), (47, "FERRAGEM"), (58, "LAJE"),
    (62, "MADEIRA"), (70, "TELHADO"), (79, "ELÉTRICA"), (100, "HIDRÁULICA"),
    (124, "ACABAMENTO E FINALIZAÇÃO"), (154, "PINTURA E MASSA"), (164, "ADICIONAIS"),
]


# ── Minuta do contrato (aba Contrato), com campos {…} e cláusulas condicionais ──
# tipo "clausula" recebe número automático; "paragrafo" não. condicao vazia = sempre entra.
ATIVIDADES_PADRAO = ("execução da mão de obra de fundação, estrutura, alvenaria, instalações hidráulicas e elétricas, "
                     "revestimentos, cobertura, pintura e acabamentos, conforme projeto aprovado, além da gestão da equipe "
                     "e da limpeza periódica da obra.")


def _c(secao, texto, condicao="", tipo="clausula"):
    return {"secao": secao, "tipo": tipo, "condicao": condicao, "texto": texto}


_CLAUSULAS = [
    _c("IDENTIFICAÇÃO DAS PARTES CONTRATANTES",
       "Neste presente contrato, define-se por CONTRATANTE o(a) Sr(a). {CONTRATANTE}, inscrito(a) no CPF sob o nº {CPF}, "
       "e por CONTRATADO, doravante denominado CONSTRUTOR, a empresa {EMPRESA}, inscrita no CNPJ sob o nº {CNPJ}, "
       "localizada em {ENDERECO_EMPRESA}.", tipo="paragrafo"),
    _c("IDENTIFICAÇÃO DAS PARTES CONTRATANTES",
       "As partes acima identificadas têm, entre si, justo e acertado o presente Contrato de Construção por Empreitada, "
       "que se regerá pelas cláusulas seguintes e pelas condições descritas no presente.", tipo="paragrafo"),
    _c("DO OBJETO DO CONTRATO",
       "O presente tem como OBJETO a construção de um imóvel residencial de {AREA} m², a ser construído em "
       "{ENDERECO_OBRA} - {CIDADE}, na modalidade de {MODALIDADE_TEXTO}."),
    _c("DO OBJETO DO CONTRATO",
       "A construção será executada conforme consta na planta elaborada pelo(a) Engenheiro(a)/Arquiteto(a) responsável, "
       "após aprovada junto à Prefeitura Municipal do local do respectivo imóvel."),
    _c("DA EXECUÇÃO",
       "A execução das obras será administrada pelo CONSTRUTOR, facultando-lhe a contratação de pedreiros e ajudantes, "
       "os quais terão vínculo único e direto com o mesmo, que ficará exclusivamente responsável pelo pagamento e por "
       "todos os encargos existentes."),
    _c("DA EXECUÇÃO",
       "O CONSTRUTOR fornecerá, além do pessoal, todos os recursos necessários à concretização da obra, como "
       "ferramentas, EPIs (Equipamentos de Proteção Individual), refeições e água potável."),
    _c("DA EXECUÇÃO",
       "Quaisquer danos causados a terceiros e provenientes da execução dos trabalhos, agindo dolosa ou culposamente, "
       "serão de inteira responsabilidade do CONSTRUTOR, mesmo que praticados pelos seus ajudantes."),
    _c("DA EXECUÇÃO",
       "O CONSTRUTOR terá completa e irrestrita liberdade para executar seus trabalhos, não necessitando predeterminar "
       "horários ou funções, ficando assim caracterizado que o mesmo faz a gestão das atividades de execução da obra, "
       "não mantendo nenhum vínculo trabalhista com o CONTRATANTE."),
    _c("DA EXECUÇÃO",
       "Limpeza e terraplanagem serão contratadas e pagas pelo CONTRATANTE, fora do preço deste contrato.",
       'TERRAPLANAGEM="CONTRATANTE"'),
    _c("DA EXECUÇÃO",
       "A terraplanagem orçada será providenciada pelo CONSTRUTOR, conforme o escopo contratado.",
       'TERRAPLANAGEM="CONSTRUTOR"'),
    _c("DA EXECUÇÃO",
       "[PENDENTE: definir o responsável pela terraplanagem]",
       'E(TERRAPLANAGEM<>"CONSTRUTOR"; TERRAPLANAGEM<>"CONTRATANTE")'),
    _c("DA EXECUÇÃO", "Escopo contratado: {ESCOPO}"),
    _c("DA EXECUÇÃO",
       "Fica sob responsabilidade do CONSTRUTOR a mão de obra referente à construção da calçada e dos muros."),
    _c("DOS MATERIAIS",
       "O CONTRATANTE será responsável por toda compra e entrega de material de fundação, alvenaria, hidráulica, "
       "elétrica, acabamento e serralheria (incluindo o portão frontal), bem como pelos recursos para armazenamento "
       "seguro destes itens (contêiner ou barracão provisório com tranca e fechadura em pleno funcionamento).",
       'MODALIDADE="SEM"'),
    _c("DOS MATERIAIS",
       "O CONSTRUTOR será responsável por toda compra e entrega de material de fundação, alvenaria, hidráulica, "
       "elétrica, acabamento e serralheria (incluindo o portão frontal), bem como pelos recursos para armazenamento "
       "seguro destes itens (contêiner ou barracão provisório com tranca e fechadura em pleno funcionamento). "
       "O CONSTRUTOR também fica obrigado a apresentar ao CONTRATANTE no mínimo 3 (três) cotações, a não ser que "
       "seja dispensado pelo CONTRATANTE formalmente.",
       'MODALIDADE="COM"'),
    _c("DOS MATERIAIS",
       "O CONSTRUTOR será responsável por trancar diariamente, em local seguro, todos os materiais da obra, bem como "
       "os respectivos equipamentos e ferramentas utilizados na execução do serviço, sendo responsabilizado a repor "
       "os possíveis prejuízos causados em caso de desleixo e esquecimento destes itens fora dos locais mencionados."),
    _c("DOS MATERIAIS",
       "O CONSTRUTOR se compromete a contratar profissionais com experiência comprovada e que sejam plenamente "
       "capazes de executar a obra em sua totalidade de forma segura, eficaz e sem desperdícios."),
    _c("DOS MATERIAIS",
       "Caso seja comprovado desperdício, inutilização ou extravio de material, ficará o CONSTRUTOR obrigado a "
       "restituí-los ao CONTRATANTE."),
    _c("DAS VISTORIAS",
       "Resta facultado ao CONTRATANTE, bem como ao engenheiro/arquiteto responsável pela planta, realizar vistorias "
       "a qualquer dia ou horário, concernentes à execução das obras, cabendo ao CONSTRUTOR se comprometer a aceitar "
       "ou não os pareceres de ambos."),
    _c("DO PREÇO E DA FORMA DE PAGAMENTO",
       "Fica ajustado que o CONTRATANTE pagará ao CONSTRUTOR o valor total de R$ {VALOR_TOTAL}, sendo R$ {ENTRADA} "
       "de entrada (adiantamento), a ser descontada do valor total, para custeio de ferramentas e insumos pagos pelo "
       "CONSTRUTOR, e o saldo de R$ {SALDO} em {N_PARCELAS} parcela(s) de R$ {VALOR_PARCELA} (a última de "
       "R$ {ULTIMA_PARCELA}, por ajuste de centavos), a cada {INTERVALO} dias contados de {DATA_BASE}, com a última "
       "no término previsto da obra ({DATA_FIM}), conforme o cronograma de pagamentos do Anexo I."),
    _c("DO PREÇO E DA FORMA DE PAGAMENTO",
       "O valor a ser pago aos pedreiros e ajudantes será feito individualmente pelo CONSTRUTOR e às suas expensas, "
       "visto que os mesmos possuem vínculo única e exclusivamente com este, comprometendo-se a pagá-los semanalmente."),
    _c("DA RESCISÃO",
       "A rescisão por iniciativa do CONTRATANTE observará a legislação aplicável e as condições expressamente "
       "acordadas pelas partes, com apuração dos serviços executados e valores devidos."),
    _c("DA RESCISÃO",
       "A rescisão por iniciativa do CONSTRUTOR observará a legislação aplicável e as condições expressamente "
       "acordadas pelas partes."),
    _c("PRAZO PARA EXECUÇÃO",
       "O prazo total para execução da obra é de {PRAZO_DIAS} dias corridos, de {DATA_INICIO} a {DATA_FIM}, conforme "
       "o cronograma físico do Anexo II. Eventual tolerância e condições de prorrogação devem ser expressamente "
       "acordadas pelas partes."),
    _c("PRAZO PARA EXECUÇÃO",
       "Interrupções e prorrogações do prazo de execução deverão ser registradas e expressamente acordadas pelas partes."),
    _c("CONDIÇÕES GERAIS",
       "O CONSTRUTOR limitar-se-á a executar o que consta na planta, sob pena de o CONTRATANTE enjeitá-la ou "
       "recebê-la com abatimento no preço."),
    _c("CONDIÇÕES GERAIS",
       "O CONSTRUTOR deverá apresentar as notas fiscais e/ou comprovantes ao CONTRATANTE referentes aos materiais "
       "adquiridos para a obra.", 'MODALIDADE="COM"'),
    _c("CONDIÇÕES GERAIS",
       "Fica acordado o pagamento apenas do montante previsto na cláusula de preço e forma de pagamento, sem "
       "reembolso de materiais, que são adquiridos diretamente pelo CONTRATANTE.", 'MODALIDADE="SEM"'),
    _c("CONDIÇÕES GERAIS", "São atividades do CONSTRUTOR: {ATIVIDADES}"),
    _c("CONDIÇÕES GERAIS",
       "O CONTRATANTE será responsável pela compra e confecção das placas de identificação da obra, bem como pela "
       "disposição do projeto impresso para eventuais fiscalizações da Prefeitura Municipal, sendo o CONSTRUTOR "
       "responsável por mantê-lo disponível e em boas condições, apresentando-o à fiscalização, caso solicitado."),
    _c("CONDIÇÕES GERAIS", "O presente contrato passa a vigorar entre as partes a partir da sua assinatura."),
    _c("CONDIÇÕES GERAIS",
       "O descumprimento das obrigações sujeitará a parte responsável às consequências previstas na legislação "
       "aplicável e nas condições expressamente acordadas."),
    _c("DO FORO",
       "Para dirimir quaisquer controvérsias oriundas deste CONTRATO, as partes elegem o foro da comarca de {CIDADE}."),
    _c("DO FORO",
       "Por estarem assim justos e contratados, firmam o presente instrumento, em duas vias de igual teor, "
       "juntamente com 2 (duas) testemunhas.", tipo="paragrafo"),
]
CONTRATO = [dict(ordem=(i + 1) * 10, ativo=True, **c) for i, c in enumerate(_CLAUSULAS)]


def secao_da_linha(r):
    atual = None
    for inicio, nome in SECOES:
        if r > inicio:
            atual = nome
    return atual


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def iso(v):
    return v.strftime("%Y-%m-%d") if isinstance(v, datetime) else ""


def main(caminho):
    wf = openpyxl.load_workbook(caminho, data_only=False)
    wv = openpyxl.load_workbook(caminho, data_only=True)

    # ── Base SINAPI GO ──
    go = wv["GO"]
    cab = " ".join(str(go.cell(r, 1).value or "") for r in range(3, 8))
    m = re.search(r"COLETA:\s*(\d{2})/(\d{4}).*?EMISS[AÃ]O:\s*(\d{2})/(\d{2})/(\d{4})", cab)
    competencia = f"{m.group(2)}-{m.group(1)}"
    emissao = f"{m.group(5)}-{m.group(4)}-{m.group(3)}"
    insumos = []
    for r in range(10, go.max_row + 1):
        cod = go.cell(r, 1).value
        if cod is None or str(cod).strip() == "":
            continue
        preco = num(go.cell(r, 5).value)
        insumos.append([
            int(cod) if str(cod).strip().isdigit() else str(cod).strip(),
            str(go.cell(r, 2).value or "").strip(),
            str(go.cell(r, 3).value or "").strip(),
            str(go.cell(r, 4).value or "").strip(),
            preco if preco and preco > 0 else None,
        ])
    base = {
        "uf": "GO",
        "competencia": competencia,
        "emissao": emissao,
        "localidade": "GOIANIA",
        "regime": "COM DESONERAÇÃO",
        "fonte": "CAIXA/SINAPI — aba ICD",
        "colunas": ["codigo", "descricao", "unidade", "origem", "preco"],
        "insumos": insumos,
    }
    os.makedirs(os.path.join(RAIZ, "data", "sinapi"), exist_ok=True)
    nome_base = f"GO-{competencia}.json"
    with open(os.path.join(RAIZ, "data", "sinapi", nome_base), "w", encoding="utf-8") as f:
        json.dump(base, f, ensure_ascii=False, separators=(",", ":"))
    indice = {"uf": "GO", "atual": competencia,
              "competencias": [{"competencia": competencia, "emissao": emissao, "arquivo": nome_base,
                                "insumos": len(insumos)}]}
    with open(os.path.join(RAIZ, "data", "sinapi", "index.json"), "w", encoding="utf-8") as f:
        json.dump(indice, f, ensure_ascii=False, indent=2)
    print(f"SINAPI GO {competencia}: {len(insumos)} insumos, {sum(1 for i in insumos if i[4] is None)} sem preço")

    # Descrições antigas dos itens que ficaram sem código/preço (aba ATUALIZAÇÃO SINAPI)
    atu = wv["ATUALIZAÇÃO SINAPI"]
    antigas = {}
    for r in range(11, atu.max_row + 1):
        linha = atu.cell(r, 1).value
        if isinstance(linha, int):
            antigas[linha] = (str(atu.cell(r, 3).value or "").strip(), str(atu.cell(r, 5).value or "").strip())

    # ── Modelo de itens ──
    lf, lv = wf["Lista de Materiais"], wv["Lista de Materiais"]
    precos_go = {i[0]: i for i in insumos}
    itens = []
    for r in range(9, 163):
        cod = lf.cell(r, 2).value
        if cod is None or r not in FORMULAS:
            continue
        codigo = int(cod) if isinstance(cod, (int, float)) else ""
        no_sinapi = precos_go.get(codigo)
        desc_manual, un_manual, preco_manual = "", "", ""
        if codigo == "":  # itens fora do SINAPI (taxas): tudo manual
            desc_manual = str(lv.cell(r, 5).value or "").strip()
            un_manual = str(lv.cell(r, 7).value or "").strip()
            preco_manual = num(lv.cell(r, 8).value) or ""
        elif not no_sinapi or no_sinapi[4] is None:
            # sem código ou sem preço em GO → descrição antiga + preço manual pendente
            antiga = antigas.get(r, ("", ""))
            desc_manual = (no_sinapi[1] if no_sinapi else "") or antiga[0]
            un_manual = (no_sinapi[2] if no_sinapi else "") or antiga[1]
        fator = num(lf.cell(r, 4).value)
        itens.append({
            "id": f"I{r:03d}",
            "ordem": r,
            "grupo": secao_da_linha(r),
            "categoria": str(lf.cell(r, 3).value or "").strip(),
            "codigo": codigo,
            "descricao_manual": desc_manual,
            "unidade_manual": un_manual,
            "preco_manual": preco_manual,
            "fator": fator if fator is not None else "",
            "formula_qtd": FORMULAS[r],
            "ativo": True,
            "observacao": "",
        })
    print(f"Modelo: {len(itens)} itens")

    # ── Rateios das propostas ──
    def rateio(aba):
        ws = wf[aba]
        linhas = []
        for r in range(274, 297, 2):
            linhas.append({
                "ordem": len(linhas) + 1,
                "fase": str(ws.cell(r, 2).value or "").strip(),
                "descricao": str(ws.cell(r, 4).value or "").strip(),
                "percentual": num(ws.cell(r, 7).value) or 0,
            })
        return linhas

    # Descrições das categorias de material na proposta COM material
    cot = wf["Cotação Cliente"]
    categorias = []
    for r in range(301, 336, 2):
        nome = str(cot.cell(r, 2).value or "").strip()
        if nome:
            categorias.append({"categoria": nome, "descricao": str(cot.cell(r, 4).value or "").strip()})


    # ── Cronograma físico (aba Cronograma): dias = ARREDONDAR_CIMA(k/125 × área) ──
    cr = wf["Cronograma"]
    cronograma = []
    for r in range(12, 53):
        nome = str(cr.cell(r, 2).value or "").strip()
        g = str(cr.cell(r, 7).value or "")
        if not nome or not g:
            continue
        m = re.fullmatch(r"=ROUNDUP\(\(\(([\d.]+)/125\)\*Parâmetros!\$D\$16\),0\)", g.replace(" ", ""))
        if m:
            formula = "ARREDONDAR_CIMA(" + m.group(1).replace(".", ",") + "/125*AREA)"
        elif "Parâmetros!J14" in g:  # enchimento da laje: ×1,7 com pé-direito duplo
            formula = 'ARREDONDAR_CIMA(4/125*AREA*SE(PE_DIREITO_DUPLO="NENHUM"; 1; 1,7))'
        else:
            raise SystemExit(f"Cronograma linha {r}: fórmula não reconhecida: {g}")
        cronograma.append({"id": f"E{len(cronograma) + 1:02d}", "ordem": len(cronograma) + 1,
                           "etapa": nome[0].upper() + nome[1:], "formula_dias": formula, "ativo": True})
    print(f"Cronograma: {len(cronograma)} etapas")

    # ── Empresa, termos e BDI ──
    cf = wv["CONFIGURAÇÃO"]
    empresa = {
        "razao_social": re.sub(r"\s{2,}", " ", str(cf["C8"].value or "")).strip(),
        "cnpj": str(cf["C12"].value or "").strip(),
        "endereco": str(cf["C14"].value or "").strip(),
        "responsavel_tecnico": str(cf["C16"].value or "").strip(),
        "telefone": str(cf["C18"].value or "").strip(),
        "email": str(cf["F8"].value or "").strip(),
        "historia": re.sub(r"\s{3,}", "\n\n", str(cf["C36"].value or "")).strip(),
        "vantagem_1": str(cf["C48"].value or "").strip(),
        "vantagem_2": str(cf["C51"].value or "").strip(),
        "vantagem_3": str(cf["C54"].value or "").strip(),
        "horas_dia": num(cf["C57"].value) or "",
        "dias_uteis_mes": num(cf["C59"].value) or "",
        "adiantamento_padrao": "",
        "administracao_padrao": "",
        "protecao_padrao": "",
        "intervalo_pagamentos_padrao": "",
        "observacoes_proposta": str(cot["B341"].value or "").strip(),
        "formula_area_equivalente": "MURO/4 + AREA + PISO_EXT/20 + GOURMET/2 + PISCINA + SAUNA + GARAGEM",
        "fator_acabamento_alto": "",
        "dias_validade_precos": 120,
        "atividades_construtor_padrao": ATIVIDADES_PADRAO,
    }
    termos = [
        "Esta proposta é válida por 10 dias.",
        str(cf["C25"].value).split(". ", 1)[1].strip(),
        str(cf["C26"].value).split(". ", 1)[1].strip(),
        str(cf["C27"].value).split(". ", 1)[1].strip(),
        "Para início da obra, o adiantamento acordado é de {ADIANTAMENTO} do valor total após assinatura do contrato.",
        str(cf["C29"].value).split(". ", 1)[1].strip(),
        str(cf["C30"].value).split(". ", 1)[1].strip(),
        "{TERRAPLANAGEM}",
    ]
    bd = wv["BDI"]
    bdi = {
        "administracao_central": bd["D5"].value, "seguro": bd["D7"].value, "risco": bd["D9"].value,
        "garantia": bd["D11"].value, "despesas_financeiras": bd["D15"].value, "lucro": bd["D17"].value,
        "pis": bd["D21"].value, "cofins": bd["D23"].value, "issqn": bd["D25"].value,
        "inss": bd["D27"].value, "outros": bd["D29"].value or 0,
    }

    modelo = {
        "gerado_de": os.path.basename(caminho),
        "empresa": empresa,
        "bdi": bdi,
        "itens": itens,
        "rateio": {"COM": rateio("Cotação Cliente"), "SEM": rateio("Cotação Cliente sem mat")},
        "categorias_material": categorias,
        "termos": termos,
        "cronograma": cronograma,
        "contrato": CONTRATO,
    }
    with open(os.path.join(RAIZ, "data", "modelo-padrao.json"), "w", encoding="utf-8") as f:
        json.dump(modelo, f, ensure_ascii=False, indent=1)
    with open(os.path.join(RAIZ, "apps-script", "Seed.gs"), "w", encoding="utf-8") as f:
        f.write("/**\n * Seed.gs — modelo padrão extraído da planilha original (gerado por tools/extrair_planilha.py).\n"
                " * Usado só pelo setupPlanilha() para preencher as abas cfg_* na primeira instalação.\n"
                " * Não edite aqui: depois de instalado, o modelo vale o que estiver na planilha.\n */\n")
        f.write("function modeloPadrao_() {\n  return " + json.dumps(modelo, ensure_ascii=False, indent=1) + ";\n}\n")

    # ── Obra de exemplo + resultados esperados (teste golden) ──
    pv, aj = wv["Parâmetros"], wv["AJUSTES TÉCNICOS"]

    def n0(v):
        return num(v)

    parametros = {
        "data_orcamento": iso(pv["D4"].value), "data_inicio": iso(pv["J4"].value),
        "cliente_cpf": "111.444.777-35", "cliente_nome": "Cliente Exemplo",  # anonimizado: o repo é público
        "endereco_obra": "Rua Exemplo, QD 1 LT 1 - Bairro Modelo", "cidade": str(pv["D12"].value or ""),
        "terreno": pv["J6"].value, "telhado": pv["J8"].value, "pavimentos": pv["J10"].value,
        "acabamento": pv["J12"].value, "pe_direito_duplo": pv["J14"].value, "pintura": pv["J16"].value,
        "muro": n0(pv["D14"].value), "area": n0(pv["D16"].value), "grama": n0(pv["D18"].value),
        "piso_ext": n0(pv["D20"].value), "gourmet": n0(pv["D22"].value), "piscina": n0(pv["D24"].value),
        "sauna": n0(pv["D26"].value), "garagem": n0(pv["D28"].value), "gesso": n0(pv["D30"].value),
        "banheiros": n0(pv["J18"].value), "lavabos": n0(pv["J20"].value), "quartos": n0(pv["J22"].value),
        "cozinhas": n0(pv["J24"].value), "duchas": n0(pv["J26"].value), "escadas": n0(pv["J28"].value),
        "portao": pv["J30"].value or "", "portao_largura": n0(aj["B12"].value), "portao_altura": n0(aj["B13"].value),
        "registros_sauna": n0(aj["B14"].value), "janelas_sauna": n0(aj["B15"].value),
        "registros_gourmet": n0(aj["B16"].value), "terraplanagem": aj["B22"].value or "",
    }
    esperado = {}
    for item in itens:
        r = item["ordem"]
        esperado[item["id"]] = {"qtd": num(lv.cell(r, 6).value), "total": num(lv.cell(r, 9).value),
                                "status": str(lv.cell(r, 19).value or "")}
    exemplo = {
        "parametros": parametros,
        "esperado": {
            "area_equivalente": lv["Q5"].value,
            "subtotal_valido": lv["T4"].value,
            "mao_de_obra": lv["K8"].value,
            "itens": esperado,
        },
    }
    os.makedirs(os.path.join(RAIZ, "tests"), exist_ok=True)
    with open(os.path.join(RAIZ, "tests", "exemplo-planilha.json"), "w", encoding="utf-8") as f:
        json.dump(exemplo, f, ensure_ascii=False, indent=1)
    print(f"Exemplo: subtotal válido R$ {lv['T4'].value:,.2f}; {sum(1 for e in esperado.values() if e['status'].startswith('PENDENTE'))} itens pendentes")


if __name__ == "__main__":
    main(sys.argv[1])
