/**
 * CRM SB Saúde — Testes Automatizados de Reconciliação e Paridade Exata
 * Valida o lote de referência completo (1.072 propostas), paginação Supabase,
 * resiliência contra truncamento, parsing numérico pt-BR e regras de aptidão.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const BusinessRules = require('../js/business-rules.js');

// Mock global window para ambiente Node.js
global.window = {
  location: { hostname: '127.0.0.1' },
  dispatchEvent: () => {},
  supabase: { createClient }
};

const { SBClient } = require('../js/supabase-client.js');

async function runReconciliationTests() {
  console.log('================================================================');
  console.log('INICIANDO SUÍTE DE TESTES DE RECONCILIAÇÃO E PARIDADE (CRM SB SAÚDE)');
  console.log('================================================================\n');

  // Carregar base de dados de referência (js/database.js)
  const dbCode = fs.readFileSync(path.join(__dirname, '../js/database.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(dbCode, sandbox);
  const data = sandbox.window.CRM_INITIAL_DATA;
  const proposals = data.proposals || [];

  // =============================================================
  // TESTE 1: Paridade Exata do Lote de Referência (Sem Filtros)
  // =============================================================
  console.log('--- TESTE 1: Paridade Exata do Lote de Referência (1.072 propostas) ---');

  // 1.1 Contagem de propostas e IDs únicos
  assert.strictEqual(proposals.length, 1072, 'O lote de referência deve conter exatamente 1072 propostas');
  const uniqueIds = new Set(proposals.map(p => String(p.ID)));
  assert.strictEqual(uniqueIds.size, 1072, 'Devem existir 1072 IDs únicos no lote de referência');
  console.log('✓ 1.1: 1.072 propostas distintas confirmadas por ID.');

  // 1.2 Vidas em todas as propostas (pt-BR)
  const totalLives = proposals.reduce((acc, p) => acc + BusinessRules.parseLives(p.VIDAS), 0);
  assert.strictEqual(totalLives, 477543, 'A soma de vidas em todas as propostas deve ser exatamente 477.543');
  console.log(`✓ 1.2: Vidas em todas as propostas somam ${totalLives.toLocaleString('pt-BR')} (esperado: 477.543).`);

  // 1.3 Faturamento total somado das propostas
  const totalRevenue = proposals.reduce((acc, p) => acc + BusinessRules.parseCurrency(p.FATURAMENTO), 0);
  const totalRevenueRounded = Math.round(totalRevenue * 100) / 100;
  assert.strictEqual(totalRevenueRounded, 100167303.43, 'O faturamento total somado deve ser exatamente R$ 100.167.303,43');
  console.log(`✓ 1.3: Faturamento somado: R$ ${totalRevenueRounded.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (esperado: R$ 100.167.303,43).`);

  // 1.4 Contrato Fechado: 194 propostas, 24.770 vidas, R$ 3.173.398,87
  const closedProps = proposals.filter(p => p.TEMPERATURA_CONTRATO === 'Contrato Fechado');
  const closedCount = closedProps.length;
  const closedLives = closedProps.reduce((acc, p) => acc + BusinessRules.parseLives(p.VIDAS), 0);
  const closedRevenue = Math.round(closedProps.reduce((acc, p) => acc + BusinessRules.parseCurrency(p.FATURAMENTO), 0) * 100) / 100;

  assert.strictEqual(closedCount, 194, 'Contratos fechados devem ser exatamente 194 propostas');
  assert.strictEqual(closedLives, 24770, 'Contratos fechados devem somar exatamente 24.770 vidas');
  assert.strictEqual(closedRevenue, 3173398.87, 'Contratos fechados devem somar exatamente R$ 3.173.398,87');
  console.log(`✓ 1.4: Contrato Fechado: ${closedCount} propostas, ${closedLives.toLocaleString('pt-BR')} vidas, R$ ${closedRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`);

  // 1.5 Conversão por proposta: 194 / 1072 = 18,1%
  const conversionRate = ((closedCount / proposals.length) * 100).toFixed(1);
  assert.strictEqual(conversionRate, '18.1', 'A taxa de conversão deve ser exatamente 18,1%');
  console.log(`✓ 1.5: Taxa de conversão comercial: ${conversionRate}% (esperado: 18,1%).`);

  // 1.6 TKM ponderado: 100.167.303,43 / 477.543 = R$ 209,76
  const weightedTkm = Math.round((totalRevenue / totalLives) * 100) / 100;
  assert.strictEqual(weightedTkm, 209.76, 'O TKM ponderado deve ser exatamente R$ 209,76');
  console.log(`✓ 1.6: TKM ponderado por vida: R$ ${weightedTkm.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (esperado: R$ 209,76).`);

  // 1.7 Desistências + Declínios: 372 + 117 = 489
  const countDesistencia = proposals.filter(p => p.TEMPERATURA_CONTRATO === 'Desistência da Empresa').length;
  const countDeclinado = proposals.filter(p => p.TEMPERATURA_CONTRATO === 'Declinado pela SB Saúde').length;
  assert.strictEqual(countDesistencia, 372, 'Desistência da Empresa deve ter 372 propostas');
  assert.strictEqual(countDeclinado, 117, 'Declinado pela SB Saúde deve ter 117 propostas');
  assert.strictEqual(countDesistencia + countDeclinado, 489, 'A soma de desistências e declínios deve ser 489');
  console.log(`✓ 1.7: Desistências (${countDesistencia}) + Declínios (${countDeclinado}) = 489.`);

  // 1.8 Distribuição completa do Funil Comercial
  const statusCounts = {};
  proposals.forEach(p => {
    const s = (p.TEMPERATURA_CONTRATO || '').trim();
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });
  assert.strictEqual(statusCounts['Iniciada'], 330, 'Iniciada deve ter 330');
  assert.strictEqual(statusCounts['Fria'], 26, 'Fria deve ter 26');
  assert.strictEqual(statusCounts['Morna'], 19, 'Morna deve ter 19');
  assert.strictEqual(statusCounts['Quente'], 14, 'Quente deve ter 14');
  assert.strictEqual(statusCounts['Contrato Fechado'], 194, 'Contrato Fechado deve ter 194');
  assert.strictEqual(statusCounts['Desistência da Empresa'], 372, 'Desistência da Empresa deve ter 372');
  assert.strictEqual(statusCounts['Declinado pela SB Saúde'], 117, 'Declinado pela SB Saúde deve ter 117');
  const sumFunil = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  assert.strictEqual(sumFunil, 1072, 'Soma do funil deve ser 1072');
  console.log('✓ 1.8: Distribuição completa do funil confere (330 + 26 + 19 + 14 + 194 + 372 + 117 = 1.072).');

  // 1.9 Aptidão comercial: Apto 955, Inapto 117
  const aptidaoCounts = { Apto: 0, Inapto: 0 };
  proposals.forEach(p => {
    const apt = BusinessRules.determineAptitude(p.TEMPERATURA_CONTRATO);
    if (aptidaoCounts[apt] !== undefined) aptidaoCounts[apt]++;
  });
  assert.strictEqual(aptidaoCounts['Apto'], 955, 'Aptos devem ser exatamente 955 (RN-05)');
  assert.strictEqual(aptidaoCounts['Inapto'], 117, 'Inaptos devem ser exatamente 117 (RN-05)');
  console.log(`✓ 1.9: Aptidão comercial conforme RN-05: Apto ${aptidaoCounts['Apto']}, Inapto ${aptidaoCounts['Inapto']}.`);

  // 1.10 Região BA e Casos Notáveis
  const baProps = proposals.filter(p => (p.UF || '').trim() === 'BA');
  const baLives = baProps.reduce((acc, p) => acc + BusinessRules.parseLives(p.VIDAS), 0);
  assert.strictEqual(baProps.length, 522, 'Região BA deve ter 522 propostas');
  assert.strictEqual(baLives, 205263, 'Região BA deve ter 205.263 vidas');
  console.log(`✓ 1.10: Região BA: ${baProps.length} propostas e ${baLives.toLocaleString('pt-BR')} vidas.`);

  const santoAndre = proposals.find(p => (p.EMPRESA || '').includes('SANTO ANDRÉ'));
  assert(santoAndre, 'Maior negociação de Santo André deve existir');
  assert.strictEqual(BusinessRules.parseLives(santoAndre.VIDAS), 26654, 'Santo André deve ter 26.654 vidas');
  assert.strictEqual(santoAndre.FATURAMENTO, 'R$ 8.620.436,68');
  console.log('✓ 1.11: Maior negociação (Santo André): 26.654 vidas e R$ 8.620.436,68.');

  const viaCadastro = proposals.filter(p => (p.CORRETORES_1 || '').includes('Via Cadastro'));
  const viaCadastroFat = Math.round(viaCadastro.reduce((a, b) => a + BusinessRules.parseCurrency(b.FATURAMENTO), 0) * 100) / 100;
  assert.strictEqual(viaCadastro.length, 149, 'Via Cadastro deve ter 149 propostas');
  assert.strictEqual(viaCadastroFat, 221518.54, 'Via Cadastro deve ter faturamento de R$ 221.518,54');
  console.log(`✓ 1.12: Corretor Líder (Via Cadastro): 149 propostas e R$ ${viaCadastroFat.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`);

  // =============================================================
  // TESTE 2: Paginação Real da API Supabase (> 1.000 Linhas)
  // =============================================================
  console.log('\n--- TESTE 2: Paginação Real do Supabase Client via API REST ---');
  const client = new SBClient();
  clearInterval(client.reconnectTimer);

  const supaProposals = await client.fetchProposals({ pageSize: 500 });
  assert(supaProposals, 'fetchProposals não deve retornar null');
  assert.strictEqual(supaProposals.length, 1072, 'fetchProposals paginado deve retornar exatamente 1072 registros');

  const supaIds = new Set(supaProposals.map(p => String(p.ID)));
  assert.strictEqual(supaIds.size, 1072, 'Todos os 1072 registros retornados devem possuir IDs únicos');

  const supaSyncStatus = client.getSyncStatus();
  assert.strictEqual(supaSyncStatus.state, 'complete', 'O estado de sincronização deve ser "complete"');
  assert.strictEqual(supaSyncStatus.error, null, 'Não deve haver erro de sincronização');
  console.log(`✓ 2.1: Supabase Client recuperou todas as 1.072 propostas sem truncamento com paginação ativa.`);

  // =============================================================
  // TESTE 3: Resiliência contra Truncamento em Falha de Paginação
  // =============================================================
  console.log('\n--- TESTE 3: Proteção contra Subconjunto Incompleto (Simulação de Falha) ---');
  const mockClient = new SBClient();
  clearInterval(mockClient.reconnectTimer);

  mockClient.client = {
    from: (table) => ({
      select: (cols, opts) => ({
        order: (col, dir) => ({
          range: (from, to) => {
            if (from === 0) {
              return Promise.resolve({
                data: proposals.slice(0, 500).map(p => ({ id: p.ID, ...p })),
                count: 1072,
                error: null
              });
            }
            // Simular erro na página 2
            return Promise.resolve({
              data: null,
              error: { message: 'Falha simulada de rede na página 2' }
            });
          }
        })
      })
    })
  };

  const failedResult = await mockClient.fetchProposals({ pageSize: 500, maxRetries: 1 });
  assert.strictEqual(failedResult, null, 'Em caso de falha em qualquer página, não deve retornar coleção parcial');
  assert.strictEqual(mockClient.syncState, 'error', 'Estado de sincronização deve ser "error"');
  assert(mockClient.lastSyncError.includes('Falha simulada de rede na página 2'), 'Erro capturado deve refletir a falha da página');
  console.log('✓ 3.1: Falha na página subsequente aborta a sincronização sem corromper a coleção com dados truncados.');

  // =============================================================
  // TESTE 4: Conversão Numérica pt-BR e as 83 Propostas Críticas
  // =============================================================
  console.log('\n--- TESTE 4: Teste Específico das 83 Propostas com Ponto de Milhar em VIDAS ---');
  const dotProposals = proposals.filter(p => String(p.VIDAS).includes('.'));
  assert.strictEqual(dotProposals.length, 83, 'Devem existir exatamente 83 propostas com ponto de milhar em VIDAS');

  const vidasComParseInt = dotProposals.reduce((a, p) => a + (parseInt(p.VIDAS, 10) || 0), 0);
  const vidasComParseLives = dotProposals.reduce((a, p) => a + BusinessRules.parseLives(p.VIDAS), 0);
  assert.strictEqual(vidasComParseInt, 283, 'parseInt gerava apenas 283 vidas para as 83 propostas');
  assert.strictEqual(vidasComParseLives, 309264, 'parseLives deve computar exatamente 309.264 vidas para as 83 propostas');
  console.log(`✓ 4.1: As 83 propostas somam ${vidasComParseLives.toLocaleString('pt-BR')} vidas (parseInt somava apenas ${vidasComParseInt}).`);

  // Teste de robustez de parsing
  assert.strictEqual(BusinessRules.parseLives('3.600'), 3600);
  assert.strictEqual(BusinessRules.parseLives('26.654'), 26654);
  assert.strictEqual(BusinessRules.parseLives('150'), 150);
  assert.strictEqual(BusinessRules.parseLives('0'), 0);
  assert.strictEqual(BusinessRules.parseLives(''), 0);
  assert.strictEqual(BusinessRules.parseLives(null), 0);
  assert.strictEqual(BusinessRules.parseCurrency('R$ 100.167.303,43'), 100167303.43);
  assert.strictEqual(BusinessRules.parseCurrency('R$ 183,90'), 183.90);
  console.log('✓ 4.2: Funções centrais BusinessRules.parseLives e parseCurrency validadas.');

  // =============================================================
  // TESTE 5: Preservação dos 20 Casos Históricos de Faturamento
  // =============================================================
  console.log('\n--- TESTE 5: Preservação dos 20 Faturamentos Históricos Divergentes ---');
  const pgClient = new Client({
    host: '127.0.0.1',
    port: 56322,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres'
  });
  await pgClient.connect();

  const mismatchIds = ['393', '401', '405', '411', '420', '426', '439', '448', '456', '457', '468', '471', '472', '474', '477', '480', '502', '514', '519', '532'];
  const pgMismatch = await pgClient.query(`
    SELECT id, vidas_num, tkm_num, faturamento, faturamento_num
    FROM public.proposals
    WHERE id = ANY($1::text[])
  `, [mismatchIds]);

  assert.strictEqual(pgMismatch.rows.length, 20, 'Todos os 20 registros históricos divergentes devem existir no banco');
  for (const row of pgMismatch.rows) {
    const origFat = BusinessRules.parseCurrency(row.faturamento);
    const fatNum = parseFloat(row.faturamento_num);
    assert.strictEqual(fatNum, origFat, `O faturamento_num do registro ${row.id} deve coincidir com o faturamento original`);
  }
  console.log('✓ 5.1: Todos os 20 faturamentos históricos divergentes preservados integralmente no PostgreSQL.');

  // Validar totais no banco de dados
  const pgTotals = await pgClient.query(`
    SELECT
      COUNT(*) AS count,
      SUM(vidas_num) AS vidas,
      SUM(faturamento_num) AS fat,
      COUNT(CASE WHEN aptidao = 'Apto' THEN 1 END) AS apto,
      COUNT(CASE WHEN aptidao = 'Inapto' THEN 1 END) AS inapto
    FROM public.proposals
  `);
  const pt = pgTotals.rows[0];
  assert.strictEqual(parseInt(pt.count, 10), 1072);
  assert.strictEqual(parseInt(pt.vidas, 10), 477543);
  assert.strictEqual(Math.round(parseFloat(pt.fat) * 100) / 100, 100167303.43);
  assert.strictEqual(parseInt(pt.apto, 10), 955);
  assert.strictEqual(parseInt(pt.inapto, 10), 117);
  console.log(`✓ 5.2: PostgreSQL verificado: 1.072 propostas, 477.543 vidas, R$ 100.167.303,43, 955 Aptos, 117 Inaptos.`);

  await pgClient.end();

  console.log('\n================================================================');
  console.log('🎉 TODOS OS TESTES DE RECONCILIAÇÃO E PARIDADE PASSARAM COM 100%!');
  console.log('================================================================\n');
  process.exit(0);
}

runReconciliationTests().catch(err => {
  console.error('\n❌ Falha nos testes de reconciliação:', err);
  process.exit(1);
});
