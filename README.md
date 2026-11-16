# Orçamento de Obras — Habitar

Sistema que substitui a planilha **"Orçamento de Obras SINAPI"**. Ele calcula as quantidades e os custos com a base SINAPI de Goiás e gera as propostas **com material** e **sem material**.

| Parte | Onde fica | O que faz |
|---|---|---|
| Site (HTML/JS) | GitHub Pages | Telas, cálculo completo no navegador e proposta em PDF |
| Base SINAPI GO | `data/sinapi/*.json` (no próprio repositório) | ~5 mil insumos com preço de Goiás, um arquivo por mês |
| Banco de dados | Planilha Google (abas `db_*`) | Orçamentos salvos, usuários e log |
| Modelo editável | Planilha Google (abas `cfg_*`) | Itens, fatores, fórmulas, preços manuais, rateio, termos, empresa e BDI |
| API | Apps Script (Aplicativo da Web) | Login, leitura do modelo, salvar e listar orçamentos |

Nenhum dado de cliente fica no GitHub. Esses dados ficam só na planilha.

## Instalação (uma vez)

1. **Planilha**: crie uma planilha Google vazia, por exemplo "Orçamento de Obras — Sistema".
2. **Apps Script**: na planilha, abra *Extensões → Apps Script*.
   - Crie os arquivos `Code`, `Auth`, `Db`, `Config`, `Orcamentos`, `Setup` e `Seed`.
   - Cole em cada um o conteúdo do arquivo de mesmo nome da pasta `apps-script/`.
   - Em *Configurações do projeto*, marque "Mostrar appsscript.json" e cole o `appsscript.json`.
3. **Preparar as abas**: no editor, escolha a função `setupPlanilha` e clique em *Executar*. Autorize o acesso quando for pedido.
   - As abas `db_*` e `cfg_*` são criadas.
   - As abas `cfg_*` vêm preenchidas com o modelo da planilha original.
   - Rodar de novo não apaga nada.
4. **Usuário**: volte à planilha, recarregue a página e use o menu *Orçamento de Obras → Criar usuário*. A senha é guardada só como hash.
5. **Publicar a API**: no editor, abra *Implantar → Nova implantação*.
   - Tipo: *Aplicativo da Web*.
   - Executar como: *Eu*.
   - Quem pode acessar: *Qualquer pessoa*.
   - Copie a URL que termina em `/exec`.
6. **Ligar o site**: cole essa URL em `js/config.js` (`window.API_URL = '...'`) e publique o repositório no GitHub Pages.

Para atualizar o Apps Script depois, use *Implantar → Gerenciar implantações → editar → Nova versão*. A URL não muda.

## Uso do dia a dia

- **Novo orçamento**: preencha cliente, área, terreno, pavimentos, acabamento, áreas extras e taxas. O total é recalculado a cada campo.
- **Itens**: mostra cada insumo com quantidade, preço e total.
  - Você pode sobrescrever a quantidade ou o preço só naquele orçamento. O campo fica azul.
  - Também pode incluir itens adicionais.
- **Pendências**: um item sem preço em GO aparece como **preço manual pendente** e fica fora do total.
  - Para resolver em todos os orçamentos, preencha `preco_manual` na aba `cfg_itens`.
  - Para resolver só em um orçamento, digite o preço na tela de itens.
- **Proposta**: na aba Resumo, escolha "Ver proposta" (com ou sem material) e depois *Imprimir / Salvar PDF*.
  - Enquanto houver pendências, a folha sai com a marca **PRÉVIA**.

## Editar o modelo (fatores, fórmulas, preços)

Tudo fica nas abas `cfg_*` da planilha. Depois de editar, clique em ↻ no sistema.

- `cfg_itens`: grupo, categoria, código SINAPI, fator, `formula_qtd`, `preco_manual` e ativo.
- `cfg_empresa`: dados da proposta, taxas padrão e `formula_area_equivalente`.
- `cfg_bdi`, `cfg_rateio` (fases COM/SEM e %), `cfg_categorias` e `cfg_termos`.

As fórmulas usam o jeito do Excel em português, com `;` separando argumentos:

```
FATOR*AEQ*SE(TERRENO="PLANO"; 1; 1,6)
FATOR*AEQ*PAV(38,55; 1,5; 2,5; 1,8; 3,7)*SE(ESCADAS>0; 1,0749; 1)
SE(PORTAO="SIM"; PORTAO_LARGURA*PORTAO_ALTURA; 0)
```

- **Funções**: `SE`, `E`, `OU`, `NAO`, `VAZIO`, `MAX`, `MIN`, `ARRED`, `ARREDONDAR_CIMA`, `PAV(...)` e `TER(...)`.
  - `PAV(...)` tem um valor por tipo de pavimento: térreo, subsolo+térreo, subsolo+térreo+1, térreo+1, térreo+2.
  - `TER(...)` tem um valor por terreno: plano, declive, aclive.
  - `PENDENTE("motivo")` deixa o item pendente.
- **Variáveis**: a tela *Modelo* do sistema lista todas e testa cada fórmula, apontando erros de digitação.

Alguns coeficientes da planilha original parecem estranhos e foram mantidos como estavam, editáveis:

- aço CA-60 ×38,55 no térreo;
- aço 10 mm ×30,5 com subsolo;
- areia de terraplanagem ×19,5 no declive.

## Atualizar o SINAPI todo mês

```
python -I tools/atualizar_sinapi.py "C:/caminho/arquivo-novo.xlsx"            # detecta a competência
python -I tools/atualizar_sinapi.py "C:/caminho/arquivo-novo.xlsx" --competencia 2026-11 --aba ICD
```

- **Arquivos aceitos**: a aba `GO` da planilha de orçamento ou o arquivo de referência da CAIXA, de onde só a coluna GO é lida.
- **O que o script grava**: `data/sinapi/GO-AAAA-MM.json`. Ele também marca esse mês como atual em `index.json`.
- **Avisos**: o script lista os códigos do modelo que sumiram ou ficaram sem preço, além das maiores variações em relação ao mês anterior.
- **Para terminar**: publique a pasta `data/sinapi` no GitHub. Ao reabrir um orçamento antigo, ele é recalculado com a base nova, e o editor mostra "salvo com MM/AAAA".

## Desenvolvimento

```
node tests/testes-motor.js      # 24 testes, incluindo a comparação item a item com a planilha
node tests/testes-backend.js    # 15 testes do Apps Script num simulador
node tests/servidor-dev.js 8788 # site + backend simulado em http://localhost:8788 (ana / teste123)
python -I tools/extrair_planilha.py "planilha.xlsx"   # regera o modelo e a base a partir da planilha original
```

O motor de cálculo (`js/motor.js` + `js/formula.js`) roda igual no navegador e no Node. Com o exemplo da planilha, ele reproduz o subtotal de R$ 456.454,02.

## Próximas fases

- **Fase 2**: cronograma físico-financeiro, parcelas e contrato.
- **Fase 3**: gastos realizados × orçado, integração com Gestão de Obras e PDFs salvos no Drive.
