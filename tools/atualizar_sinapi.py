"""
Atualiza a base SINAPI de Goiás (data/sinapi/GO-AAAA-MM.json + index.json) a partir de uma planilha nova.

Aceita dois formatos:
  1. A própria planilha de orçamento (aba "GO", igual à usada na extração inicial).
  2. O arquivo mensal de referência da CAIXA (aba "ICD" ou primeira aba com cabeçalho
     "Código | Descrição | Unidade | Origem | AC | AL | ... | GO | ..."), lendo só a coluna GO.

Uso:
  python -I tools/atualizar_sinapi.py "C:/caminho/SINAPI_Referencia_2026_11.xlsx" [--competencia 2026-11] [--aba ICD]

O script:
  - grava data/sinapi/GO-AAAA-MM.json e acrescenta/atualiza a competência em index.json (vira a "atual");
  - mantém os arquivos dos meses anteriores (orçamentos antigos continuam reproduzíveis);
  - avisa quais códigos usados no modelo (data/modelo-padrao.json) ficaram sem preço ou sumiram,
    e a variação de preço desses itens em relação ao mês anterior.
Depois é só publicar a pasta data/sinapi no GitHub.
"""
import argparse
import json
import os
import re
import sys
import unicodedata

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTA = os.path.join(RAIZ, "data", "sinapi")


def norm(v):
    s = unicodedata.normalize("NFD", str(v or "")).encode("ascii", "ignore").decode().upper()
    return re.sub(r"\s+", " ", s).strip()


def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("R$", "").replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def achar_competencia(ws, linhas=12):
    texto = " ".join(norm(c) for row in ws.iter_rows(min_row=1, max_row=linhas, values_only=True) for c in row if c)
    m = re.search(r"(?:COLETA|REFERENCIA|MES DE REFERENCIA|DATA DE REFERENCIA)[^0-9]{0,20}(\d{2})/(\d{4})", texto)
    if not m:
        m = re.search(r"\b(\d{2})/(\d{4})\b", texto)
    comp = f"{m.group(2)}-{m.group(1)}" if m else None
    e = re.search(r"EMISSAO[^0-9]{0,10}(\d{2})/(\d{2})/(\d{4})", texto)
    emissao = f"{e.group(3)}-{e.group(2)}-{e.group(1)}" if e else None
    return comp, emissao


def ler_aba_go(ws):
    """Formato da planilha de orçamento: dados a partir da linha 10, colunas A..E."""
    insumos = []
    for r in range(10, ws.max_row + 1):
        cod = ws.cell(r, 1).value
        if cod is None or str(cod).strip() == "":
            continue
        preco = num(ws.cell(r, 5).value)
        insumos.append([cod, ws.cell(r, 2).value, ws.cell(r, 3).value, ws.cell(r, 4).value, preco])
    return insumos


def ler_formato_caixa(ws):
    """Procura a linha de cabeçalho com CODIGO + DESCRICAO e uma coluna 'GO'."""
    for r in range(1, min(ws.max_row, 40) + 1):
        cab = [norm(ws.cell(r, c).value) for c in range(1, ws.max_column + 1)]
        if not any(h.startswith("CODIGO") for h in cab) or not any(h.startswith("DESCRI") for h in cab):
            continue
        idx = lambda pref: next((i for i, h in enumerate(cab) if h.startswith(pref)), None)
        c_cod, c_desc, c_un, c_ori = idx("CODIGO"), idx("DESCRI"), idx("UNIDADE"), idx("ORIGEM")
        c_go = next((i for i, h in enumerate(cab) if h == "GO"), None)
        if c_go is None:
            # Às vezes as UFs ficam numa linha acima/abaixo do cabeçalho principal.
            for rr in (r - 1, r + 1):
                if rr < 1:
                    continue
                linha = [norm(ws.cell(rr, c).value) for c in range(1, ws.max_column + 1)]
                if "GO" in linha:
                    c_go = linha.index("GO")
                    break
        if c_go is None:
            raise SystemExit("Achei o cabeçalho, mas não a coluna 'GO'. Use --aba para indicar a aba certa.")
        insumos = []
        for row in ws.iter_rows(min_row=r + 1, values_only=True):
            cod = row[c_cod] if c_cod < len(row) else None
            if cod is None or not str(cod).strip() or not re.match(r"^\d+$", str(cod).strip().split(".")[0]):
                continue
            insumos.append([
                cod,
                row[c_desc] if c_desc is not None else "",
                row[c_un] if c_un is not None else "",
                row[c_ori] if c_ori is not None else "",
                num(row[c_go]) if c_go < len(row) else None,
            ])
        return insumos
    raise SystemExit("Não encontrei cabeçalho com 'Código' e 'Descrição' nas primeiras 40 linhas.")


def limpar(insumos):
    vistos, saida = set(), []
    for cod, desc, un, ori, preco in insumos:
        c = str(cod).strip()
        if c.endswith(".0"):
            c = c[:-2]
        if c in vistos:
            continue
        vistos.add(c)
        saida.append([int(c) if c.isdigit() else c, str(desc or "").strip(), str(un or "").strip(),
                      str(ori or "").strip(), round(preco, 2) if preco and preco > 0 else None])
    return saida


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("arquivo")
    ap.add_argument("--competencia", help="AAAA-MM (se não for detectada no arquivo)")
    ap.add_argument("--emissao", help="AAAA-MM-DD")
    ap.add_argument("--aba", help="nome da aba (padrão: GO, senão ICD, senão a primeira)")
    a = ap.parse_args()

    wb = openpyxl.load_workbook(a.arquivo, data_only=True, read_only=False)
    nome = a.aba or next((n for n in ("GO", "ICD") if n in wb.sheetnames), wb.sheetnames[0])
    ws = wb[nome]
    comp, emissao = achar_competencia(ws)
    comp = a.competencia or comp
    emissao = a.emissao or emissao
    if not comp or not re.match(r"^\d{4}-\d{2}$", comp):
        raise SystemExit("Não consegui detectar a competência. Informe --competencia AAAA-MM.")

    insumos = limpar(ler_aba_go(ws) if nome == "GO" else ler_formato_caixa(ws))
    if len(insumos) < 1000:
        raise SystemExit(f"Só {len(insumos)} insumos lidos da aba '{nome}' — formato inesperado, nada foi gravado.")

    base = {
        "uf": "GO", "competencia": comp, "emissao": emissao or "", "localidade": "GOIANIA",
        "regime": "COM DESONERAÇÃO", "fonte": f"CAIXA/SINAPI — aba {nome}",
        "colunas": ["codigo", "descricao", "unidade", "origem", "preco"], "insumos": insumos,
    }
    arquivo = f"GO-{comp}.json"
    os.makedirs(PASTA, exist_ok=True)
    with open(os.path.join(PASTA, arquivo), "w", encoding="utf-8") as f:
        json.dump(base, f, ensure_ascii=False, separators=(",", ":"))

    caminho_idx = os.path.join(PASTA, "index.json")
    indice = {"uf": "GO", "atual": comp, "competencias": []}
    if os.path.exists(caminho_idx):
        with open(caminho_idx, encoding="utf-8") as f:
            indice = json.load(f)
    anterior = next((c for c in indice["competencias"] if c["competencia"] == indice.get("atual")), None)
    indice["competencias"] = [c for c in indice["competencias"] if c["competencia"] != comp]
    indice["competencias"].append({"competencia": comp, "emissao": emissao or "", "arquivo": arquivo, "insumos": len(insumos)})
    indice["competencias"].sort(key=lambda c: c["competencia"])
    indice["atual"] = max(c["competencia"] for c in indice["competencias"])
    with open(caminho_idx, "w", encoding="utf-8") as f:
        json.dump(indice, f, ensure_ascii=False, indent=2)

    sem = sum(1 for i in insumos if i[4] is None)
    print(f"OK: {arquivo} — {len(insumos)} insumos ({sem} sem preço em GO). Competência atual: {indice['atual']}")

    # Conferência dos códigos usados no modelo
    precos = {str(i[0]): i[4] for i in insumos}
    antigos = {}
    if anterior and anterior["competencia"] != comp and os.path.exists(os.path.join(PASTA, anterior["arquivo"])):
        with open(os.path.join(PASTA, anterior["arquivo"]), encoding="utf-8") as f:
            antigos = {str(i[0]): i[4] for i in json.load(f)["insumos"]}
    with open(os.path.join(RAIZ, "data", "modelo-padrao.json"), encoding="utf-8") as f:
        modelo = json.load(f)
    codigos = sorted({str(i["codigo"]) for i in modelo["itens"] if str(i.get("codigo") or "").strip()})
    sumiram = [c for c in codigos if c not in precos]
    sem_preco = [c for c in codigos if c in precos and precos[c] is None]
    if sumiram:
        print(f"ATENÇÃO — códigos do modelo que não existem nesta base: {', '.join(sumiram)}")
    if sem_preco:
        print(f"ATENÇÃO — códigos do modelo sem preço em GO: {', '.join(sem_preco)}")
    if antigos:
        variacoes = []
        for c in codigos:
            p0, p1 = antigos.get(c), precos.get(c)
            if p0 and p1:
                variacoes.append((abs(p1 / p0 - 1), c, p0, p1))
        variacoes.sort(reverse=True)
        print(f"Maiores variações em relação a {anterior['competencia']}:")
        for v, c, p0, p1 in variacoes[:10]:
            print(f"  {c:>6}: {p0:>10.2f} → {p1:>10.2f}  ({(p1 / p0 - 1) * 100:+.1f}%)")
    print("Ao reabrir um orçamento antigo, ele é recalculado com a base atual (o editor mostra \"salvo com MM/AAAA\").")


if __name__ == "__main__":
    main()
