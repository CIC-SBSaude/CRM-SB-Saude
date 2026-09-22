# Relatório de Reconciliação de Dados e Auditoria — CRM SB Saúde

Data da Apuração: 22/09/2026 09:03:32

## 1. Tabela Comparativa de Indicadores: Antes × Depois × Referência

| Indicador | Antes (Captura / Subconjunto 1.000) | Depois (Corrigido e Reconciliado) | Lote de Referência (database.js / Especificação) | Status de Paridade |
| :--- | :---: | :---: | :---: | :---: |
| **Propostas Totais (IDs distintos)** | 1.000 | **1.072** | 1.072 | ✓ Paridade Exata 100% |
| **Vidas em Todas as Propostas** | 154.080 *(parseInt)* | **477.543** *(pt-BR)* | 477.543 | ✓ Paridade Exata 100% |
| **Faturamento Total Somado** | R$ 94.102.174,43 | **R$ 100.167.303,43** | R$ 100.167.303,43 | ✓ Paridade Exata 100% |
| **Contratos Fechados (Propostas)** | 190 | **194** | 194 | ✓ Paridade Exata 100% |
| **Contratos Fechados (Vidas)** | 6.093 *(parseInt)* | **24.770** *(pt-BR)* | 24.770 | ✓ Paridade Exata 100% |
| **Contratos Fechados (Faturamento)** | R$ 3.032.418,87 | **R$ 3.173.398,87** | R$ 3.173.398,87 | ✓ Paridade Exata 100% |
| **Taxa de Conversão Comercial** | 19,0% *(190/1000)* | **18,1%** *(194/1072)* | 18,1% | ✓ Paridade Exata 100% |
| **Ticket Médio Ponderado (TKM)** | R$ 610,74 | **R$ 209,76** | R$ 209,76 | ✓ Paridade Exata 100% |
| **Desistências + Declínios** | 476 *(369 + 107)* | **489** *(372 + 117)* | 489 *(372 + 117)* | ✓ Paridade Exata 100% |
| **Aptidão Comercial: Apto** | 547 *(API)* / 583 *(PG)* | **955** | 955 | ✓ Paridade Exata 100% (RN-05) |
| **Aptidão Comercial: Inapto** | 453 *(API)* / 489 *(PG)* | **117** | 117 | ✓ Paridade Exata 100% (RN-05) |
| **Região Destaque (Bahia - BA)** | 487 props / 76.552 vidas | **522 props / 205.263 vidas** | 522 props / 205.263 vidas | ✓ Paridade Exata 100% |
| **Maior Negociação (Santo André)** | 26 vidas / R$ 8,62M | **26.654 vidas / R$ 8.620.436,68** | 26.654 vidas / R$ 8.620.436,68 | ✓ Paridade Exata 100% |
| **Corretor Líder (Via Cadastro)** | 141 props *(captura)* | **149 propostas / R$ 221.518,54** | 149 propostas / R$ 221.518,54 | ✓ Paridade Exata 100% |

---

## 2. Distribuição Completa do Funil Comercial

| Etapa Comercial | Antes (1.000 IDs) | Depois (1.072 IDs) | Vidas Reconciliadas | Faturamento Total |
| :--- | :---: | :---: | :---: | :---: |
| **Iniciada** | 280 | **330** | 121.391 | R$ 27.692.005,36 |
| **Fria** | 22 | **26** | 13.801 | R$ 2.648.110,50 |
| **Morna** | 19 | **19** | 11.271 | R$ 2.455.012,06 |
| **Quente** | 13 | **14** | 4.618 | R$ 983.568,00 |
| **Contrato Fechado** | 190 | **194** | 24.770 | R$ 3.173.398,87 |
| **Desistência da Empresa** | 369 | **372** | 263.472 | R$ 53.912.988,64 |
| **Declinado pela SB Saúde** | 107 | **117** | 38.220 | R$ 9.302.220,00 |
| **TOTAL** | **1.000** | **1.072** | **477.543** | **R$ 100.167.303,43** |

---

## 3. Síntese das Correções Realizadas no Código

1. **Paginação Estável e Completa no Supabase Client (`js/supabase-client.js`):**
   - Implementada leitura paginada por lotes de 500 registros utilizando `.range(from, to)` com contagem exata (`{ count: 'exact' }`) e ordenação determinística (`.order('id', { ascending: true })`).
   - Adicionada verificação estrita de completude e unicidade de IDs. Se a leitura for parcial ou falhar, a coleção íntegra não é sobrescrita.
   - Adicionado rastreamento de estado de sincronização (`idle`, `loading`, `complete`, `error`, `offline`).

2. **Unificação de Parsing Numérico pt-BR (`js/business-rules.js` e `js/app.js`):**
   - Criadas funções centrais `BusinessRules.parseLives` e `BusinessRules.parsePtBrNumber`.
   - Eliminado o uso de `parseInt` sobre `VIDAS` em todo o sistema (KPIs, drilldowns, abas corretores/empresas, insights e cotações), restabelecendo 309.264 vidas que eram truncadas nos pontos de milhar.

3. **Revisão Conceitual e Terminológica dos Indicadores:**
   - O título "faturamento realizado" foi ajustado para "R$ 3,17M contratos fechados (status comercial)" para esclarecer que `Contrato Fechado` é uma etapa comercial da cotação e não integração atestada com o sistema Solus.
   - A frase "carteira ativa" foi ajustada para "base de propostas no pipeline comercial".
   - O indicador de "Receita Ponderada" foi formalmente rotulado como `RECEITA PONDERADA (SIMULAÇÃO)` com descrição explicativa sobre pesos hipotéticos.

4. **Correção da Regra de Aptidão (RN-05) no Banco de Dados:**
   - Ajustada a função `sync_proposal_financials()` no PostgreSQL local e no arquivo `supabase/schema.sql`.
   - Reconciliadas as 372 propostas de `Desistência da Empresa` que haviam sido indevidamente marcadas como `Inapto`. A base do banco agora reflete com fidelidade Apto = 955 e Inapto = 117.
   - Reconciliados os 71 registros no banco onde `faturamento_num` havia sofrido distorção de centavos por recálculo automático.

5. **Proteção e Convergência de Cache (`js/app.js`):**
   - O método `initDataStore()` agora detecta automaticamente caches locais truncados com 1.000 ou menos registros e converge para a coleção completa de 1.072 propostas, preservando quaisquer alterações legítimas do usuário por ID.

---

## 4. Auditoria de Pendências da Base de Origem (Decisão Humana Requerida)

Total de apontamentos catalogados no arquivo `outputs/pendencias_decisao_humana.csv`: **1366**.

- **524 propostas com fator moderador de Coparticipação sem política associada:**
  - O campo não é obrigatório no AppSheet legado. Nenhuma política foi associada por inferência.
- **323 propostas com faixas etárias vazias:**
  - Preservados como vazios; o faturamento e vidas são apurados pelo valor global cotado.
- **422 propostas com todas as 47 faixas etárias selecionadas:**
  - Mantidas sem inferir divisão de vidas por faixa.
- **51 cidades com nomes corrompidos por substituição textual legada:**
  - Exemplo: `GuanMensalidadei` (Guanambi), `InhMensalidadeupe` (Inhambupe), `ItMensalidadeé` (Itambé). Requer aprovação de mapa de equivalência antes de sanitização em produção.
- **24 propostas sem campanha cadastrada:**
  - Competências que não coincidem com o catálogo de campanhas. Mantidas como "Sem Campanha".
- **1 declínio sem justificativa:**
  - Proposta ID `325` (`UNICA SOROCABA VIGILANCIA E SEGUROS`). Requer complementação formal.
- **1 proposta sem usuário responsável:**
  - Proposta ID `985b949e` (`TRASJOI TRANSPORTES LTDA`). Requer atribuição formal de custódia.
- **20 casos de divergência matemática entre faturamento e Vidas × TKM:**
  - Os valores históricos originais foram preservados integralmente sem recálculo arbitrário.
- **1.187 vínculos de corretores por posição:**
  - Preservados estritamente na cardinalidade original nas 3 posições sem duplicações por joins.

---

## 5. Limitações Remanescentes

1. **Catálogo de Campanhas do AppSheet:** As campanhas reconstruídas refletem os registros encontrados nas propostas; campanhas históricas sem propostas associadas continuam indisponíveis no legado.
2. **Integração Operacional com o Sistema Solus:** Não há integração em tempo real com o Solus para confirmação de apólice ativa; propostas em "Contrato Fechado" refletem estritamente a última etapa do pipeline comercial interno.
