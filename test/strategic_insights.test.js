/**
 * CRM SB Saúde — Testes Automatizados de Insights Estratégicos Fatuais
 * Validação dos 4 cartões executivos, escopos temporais, desempates,
 * tratamento de valores nulos/vazios e simulação de reatividade Realtime.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BusinessRules = require('../js/business-rules.js');

// Mock global window para ambiente Node.js
global.window = {
  BusinessRules
};

const StrategicInsights = require('../js/strategic-insights.js');
const { SBClient } = require('../js/supabase-client.js');

async function runStrategicInsightsTests() {
  console.log('================================================================');
  console.log('INICIANDO SUÍTE DE TESTES DE INSIGHTS ESTRATÉGICOS (CRM SB SAÚDE)');
  console.log('================================================================\n');

  // Carregar dados de referência
  const dbCode = fs.readFileSync(path.join(__dirname, '../js/database.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(dbCode, sandbox);
  const data = sandbox.window.CRM_INITIAL_DATA;
  const proposals = data.proposals || [];

  assert.strictEqual(proposals.length, 1072, 'O conjunto de testes deve conter 1.072 propostas');

  // =========================================================================
  // TESTE 1: Cartão 1 — Corretor com Mais Propostas no Período
  // =========================================================================
  console.log('--- TESTE 1: Corretor com mais propostas no período ---');

  const fullInsights = StrategicInsights.calculateFactualStrategicInsights(proposals, { period: 'all' });
  const topBroker = fullInsights.topBroker;
  const directChannel = fullInsights.directChannel;

  assert.ok(topBroker, 'O resultado do corretor líder deve existir');
  assert.strictEqual(topBroker.name, 'Hub Health', 'O corretor parceiro líder histórico deve ser Hub Health');
  assert.strictEqual(topBroker.count, 74, 'Hub Health deve ter 74 propostas');
  assert.strictEqual(topBroker.closedCount, 2, 'Hub Health deve ter 2 contratos fechados');
  assert.strictEqual(topBroker.proposalIds.length, 74, 'A lista de IDs auditáveis de Hub Health deve ter 74 elementos');

  assert.ok(directChannel, 'O canal de entrada direta deve existir');
  assert.strictEqual(directChannel.name, 'Via Cadastro', 'O canal direto de entrada manual deve ser Via Cadastro');
  assert.strictEqual(directChannel.count, 149, 'Via Cadastro deve ter exatamente 149 propostas');
  assert.strictEqual(directChannel.closedCount, 149, 'Via Cadastro deve ter exatamente 149 fechadas');
  console.log(`✓ 1.1: Corretor credenciado parceiro líder: ${topBroker.name} (${topBroker.count} propostas) e Canal Direto: ${directChannel.name} (${directChannel.count} fechadas).`);

  // 1.2 Deduplicação do mesmo corretor repetido nas colunas 1, 2 e 3
  const duplicateBrokerProposal = {
    ID: '9999',
    CORRETORES_1: 'Corretor Multiplo',
    CORRETORES_2: 'Corretor Multiplo',
    CORRETORES_3: 'Corretor Multiplo',
    FATURAMENTO: 'R$ 1.000,00',
    VIDAS: 10,
    TEMPERATURA_CONTRATO: 'Iniciada'
  };
  const extractedBrokers = StrategicInsights.extractBrokersFromProposal(duplicateBrokerProposal);
  assert.strictEqual(extractedBrokers.length, 1, 'Corretor repetido em múltiplas colunas deve ser deduplicado');
  assert.strictEqual(extractedBrokers[0], 'Corretor Multiplo', 'Nome do corretor deduplicado');
  console.log('✓ 1.2: Deduplicação de co-corretores idênticos na mesma proposta validada.');

  // 1.3 Mapeamento de ausência de corretor para "Sem corretor" (nunca fake "Direto")
  const unassignedProposal = {
    ID: '9998',
    CORRETORES_1: '',
    CORRETORES_2: null,
    CORRETORES_3: '   ',
    FATURAMENTO: 'R$ 500,00',
    VIDAS: 5,
    TEMPERATURA_CONTRATO: 'Iniciada'
  };
  const unassignedExtracted = StrategicInsights.extractBrokersFromProposal(unassignedProposal);
  assert.strictEqual(unassignedExtracted.length, 0, 'Proposta sem corretor não deve gerar corretores atribuídos');
  console.log('✓ 1.3: Propostas sem corretor não são mascaradas como "Direto".');

  // 1.4 Critério de desempate: Propostas fechadas, depois alfabético
  const tieTestProposals = [
    { ID: '1', CORRETORES_1: 'Beta Broker', TEMPERATURA_CONTRATO: 'Iniciada', FATURAMENTO: 'R$ 100,00' },
    { ID: '2', CORRETORES_1: 'Beta Broker', TEMPERATURA_CONTRATO: 'Contrato Fechado', FATURAMENTO: 'R$ 100,00' },
    { ID: '3', CORRETORES_1: 'Alfa Broker', TEMPERATURA_CONTRATO: 'Iniciada', FATURAMENTO: 'R$ 100,00' },
    { ID: '4', CORRETORES_1: 'Alfa Broker', TEMPERATURA_CONTRATO: 'Iniciada', FATURAMENTO: 'R$ 100,00' }
  ];
  const tieInsights = StrategicInsights.calculateFactualStrategicInsights(tieTestProposals, { period: 'all' });
  assert.strictEqual(tieInsights.topBroker.name, 'Beta Broker', 'Desempate por número de contratos fechados deve favorecer Beta Broker');
  console.log('✓ 1.4: Critério de desempate por contratos fechados validado.');

  // =========================================================================
  // TESTE 2: Cartão 2 — Maior Proposta do Período
  // =========================================================================
  console.log('\n--- TESTE 2: Maior proposta do período ---');

  const biggest = fullInsights.biggestProposal;
  assert.ok(biggest, 'Maior proposta deve ser retornada');
  assert.strictEqual(biggest.id, '103', 'O ID da maior proposta deve ser 103');
  assert.strictEqual(biggest.company, 'INSTITUTO DE PREVIDÊNCIA DE SANTO ANDRÉ');
  assert.strictEqual(biggest.revenue, 8620436.68, 'Faturamento deve ser exatamente R$ 8.620.436,68');
  assert.strictEqual(biggest.revenueFormatted, 'R$ 8.620.436,68', 'Faturamento formatado preservado');
  assert.strictEqual(biggest.lives, 26654, 'Número de vidas deve ser 26.654');
  assert.strictEqual(biggest.status, 'Desistência da Empresa', 'Status exibido deve refletir a desistência real');
  console.log(`✓ 2.1: Maior proposta identificada: ID #${biggest.id} — ${biggest.company} (${biggest.revenueFormatted}, ${biggest.status}).`);

  // 2.2 Preservação do faturamento histórico sem recalcular por VIDAS × TKM
  const rawP103 = proposals.find(p => String(p.ID) === '103');
  assert.strictEqual(rawP103.FATURAMENTO, 'R$ 8.620.436,68', 'FATURAMENTO bruto preservado');
  console.log('✓ 2.2: Preservação estrita do faturamento histórico original.');

  // =========================================================================
  // TESTE 3: Cartão 3 — UF com Mais Propostas no Período
  // =========================================================================
  console.log('\n--- TESTE 3: UF com mais propostas no período ---');

  const topUf = fullInsights.topUf;
  assert.ok(topUf, 'Resultado da UF destaque deve existir');
  assert.strictEqual(topUf.uf, 'BA', 'A UF líder deve ser BA');
  assert.strictEqual(topUf.count, 527, 'BA deve conter 527 propostas distintas (522 exclusivas + 5 interestaduais)');
  assert.strictEqual(topUf.lives, 206755, 'BA deve conter 206.755 vidas mapeadas');
  assert.strictEqual(topUf.hasMultiUfProposals, true, 'Deve indicar presença de propostas interestaduais (multi-UF)');
  console.log(`✓ 3.1: UF líder correta: Estado ${topUf.uf} (${topUf.count} propostas, ${topUf.lives.toLocaleString('pt-BR')} vidas).`);

  // 3.2 Parsing multi-UF
  const multiUfProposal = {
    ID: '8888',
    UF: 'BA , MG , SP',
    VIDAS: 100,
    FATURAMENTO: 'R$ 10.000,00'
  };
  const parsedUfs = StrategicInsights.extractUfsFromProposal(multiUfProposal);
  assert.deepStrictEqual(parsedUfs, ['BA', 'MG', 'SP'], 'Parsing de lista de UFs separadas por vírgula');
  console.log('✓ 3.2: Parsing e deduplicação de proposta interestadual multi-UF validado.');

  // 3.3 Tratamento de UF vazia como "UF não informada" (sem forçar "SP")
  const emptyUfProposal = { ID: '7777', UF: '', VIDAS: 10 };
  const emptyParsed = StrategicInsights.extractUfsFromProposal(emptyUfProposal);
  assert.strictEqual(emptyParsed.length, 0, 'UF vazia não deve inferir estado');
  console.log('✓ 3.3: UF ausente agrupada adequadamente sem assunção arbitrária.');

  // =========================================================================
  // TESTE 4: Cartão 4 — Valor Cotado em Propostas Fechadas
  // =========================================================================
  console.log('\n--- TESTE 4: Valor cotado em propostas fechadas ---');

  const closed = fullInsights.closedProposals;
  assert.ok(closed, 'Resultado de propostas fechadas deve existir');
  assert.strictEqual(closed.closedCount, 194, 'Devem ser exatamente 194 contratos fechados');
  assert.strictEqual(closed.totalUniverse, 1072, 'Denominador explícito deve ser 1.072');
  assert.strictEqual(closed.closureRate, '18.1', 'Taxa de fechamento deve ser 18,1%');
  assert.strictEqual(closed.totalRevenue, 3173398.87, 'Faturamento somado deve ser exatamente R$ 3.173.398,87');
  assert.strictEqual(closed.formattedRevenue.replace(/\u00a0/g, ' '), 'R$ 3.173.398,87', 'Faturamento formatado correto');
  assert.strictEqual(closed.proposalIds.length, 194, 'Lista de 194 IDs auditáveis');
  console.log(`✓ 4.1: Fechamento auditado: ${closed.closedCount} de ${closed.totalUniverse} (${closed.closureRate}%) — ${closed.formattedRevenue}.`);

  // 4.2 Destinos Mutuamente Exclusivos do Pipeline Comercial
  const dest = fullInsights.destinations;
  assert.ok(dest, 'Destinos do pipeline devem existir');
  assert.strictEqual(dest.inProgress.count, 389, 'Em andamento deve ter exatamente 389 propostas');
  assert.strictEqual(dest.closed.count, 194, 'Fechadas deve ter exatamente 194 propostas');
  assert.strictEqual(dest.lost.count, 489, 'Perdidas deve ter exatamente 489 propostas');
  assert.strictEqual(dest.inProgress.count + dest.closed.count + dest.lost.count, 1072, 'Soma dos destinos deve reconciliar 1.072 propostas');
  assert.strictEqual(dest.inProgress.lives + dest.closed.lives + dest.lost.lives, 477543, 'Soma das vidas deve reconciliar 477.543 vidas');
  console.log(`✓ 4.2: Destinos mutuamente exclusivos: Em andamento (${dest.inProgress.count}), Fechadas (${dest.closed.count}), Perdidas (${dest.lost.count}) somam 1.072.`);

  // 4.3 Seção O que Exige Atenção (Insights Acionáveis)
  assert.ok(Array.isArray(fullInsights.actionableInsights), 'Lista de insights acionáveis deve existir');
  assert.ok(fullInsights.actionableInsights.length >= 3, 'Devem existir no mínimo 3 insights priorizados');
  const lossAlert = fullInsights.actionableInsights.find(i => i.id === 'loss-alert');
  assert.ok(lossAlert, 'Insight de alerta de perda relevante deve existir');
  assert.strictEqual(lossAlert.targetId, '103', 'Alerta deve apontar para a proposta #103');
  console.log(`✓ 4.3: Insights acionáveis factuais gerados com sucesso (${fullInsights.actionableInsights.length} insights).`);

  // =========================================================================
  // TESTE 5: Filtros de Escopo e Bases Temporais
  // =========================================================================
  console.log('\n--- TESTE 5: Filtros de escopo e bases temporais ---');

  // 5.1 Base Temporal: Prospecção vs Competência
  const scopeProspeccao = StrategicInsights.filterProposalsByScope(proposals, {
    period: 'custom',
    dateField: 'prospeccao',
    dateFrom: '2025-01-01',
    dateTo: '2025-06-30'
  });
  const scopeCompetencia = StrategicInsights.filterProposalsByScope(proposals, {
    period: 'custom',
    dateField: 'competencia',
    dateFrom: '2025-01-01',
    dateTo: '2025-06-30'
  });

  assert.ok(scopeProspeccao.length > 0, 'Deve encontrar propostas no período por data de prospecção');
  assert.ok(scopeCompetencia.length > 0, 'Deve encontrar propostas no período por competência');
  console.log(`✓ 5.1: Prospecção (${scopeProspeccao.length} propostas) vs Competência (${scopeCompetencia.length} propostas).`);

  // 5.2 Mês atual com data de referência simulada
  const monthInsights = StrategicInsights.calculateFactualStrategicInsights(proposals, {
    period: 'current_month',
    referenceDate: '2025-09-15'
  });
  assert.ok(monthInsights.scope.totalUniverse === 1072, 'Universo total de 1.072');
  console.log(`✓ 5.2: Filtro de mês atual simulado com sucesso (${monthInsights.scope.filteredUniverse} propostas no mês).`);

  // 5.3 Últimos 90 dias com data de referência simulada
  const ninetyDaysInsights = StrategicInsights.calculateFactualStrategicInsights(proposals, {
    period: 'last_90_days',
    referenceDate: '2025-10-01'
  });
  assert.ok(ninetyDaysInsights.scope.filteredUniverse > 0, 'Deve conter propostas nos últimos 90 dias');
  console.log(`✓ 5.3: Filtro de últimos 90 dias simulado com sucesso (${ninetyDaysInsights.scope.filteredUniverse} propostas).`);

  // =========================================================================
  // TESTE 6: Resiliência contra Base Vazia (Zero / Empty State)
  // =========================================================================
  console.log('\n--- TESTE 6: Limpeza de estados vazios (Zero State) ---');

  const emptyInsights = StrategicInsights.calculateFactualStrategicInsights([], { period: 'all' });
  assert.strictEqual(emptyInsights.scope.totalUniverse, 0);
  assert.strictEqual(emptyInsights.scope.filteredUniverse, 0);
  assert.strictEqual(emptyInsights.topBroker.name, 'Sem dados suficientes');
  assert.strictEqual(emptyInsights.topBroker.count, 0);
  assert.strictEqual(emptyInsights.biggestProposal.company, 'Sem dados suficientes');
  assert.strictEqual(emptyInsights.biggestProposal.revenue, 0);
  assert.strictEqual(emptyInsights.topUf.label, 'Sem dados suficientes');
  assert.strictEqual(emptyInsights.topUf.count, 0);
  assert.strictEqual(emptyInsights.closedProposals.closedCount, 0);
  assert.strictEqual(emptyInsights.closedProposals.totalRevenue, 0);
  assert.strictEqual(emptyInsights.closedProposals.closureRate, '0.0', 'Taxa não deve conter fallback legado de 18.1');
  console.log('✓ 6.1: Base vazia tratada limpa e sem fallbacks fixos legados.');

  // =========================================================================
  // TESTE 7: Mapeamento de Colunas Supabase e Ciclo Realtime
  // =========================================================================
  console.log('\n--- TESTE 7: Mapeamento completo e reatividade Realtime ---');

  const client = new SBClient();
  const rawDbProposal = {
    row_number: 1073,
    id: 1073,
    data_da_prospeccao: '2026-09-22',
    empresa: 'TESTE REALTIME SB SAUDE LTDA',
    cnpj: '00.000.000/0001-99',
    competencia: '2026-10-01',
    vidas: 250,
    cidade: 'Feira de Santana',
    uf: 'BA',
    tkm: 'R$ 210,00',
    faturamento: 'R$ 52.500,00',
    acomodacao: 'Enfermaria',
    fator_moderador: 'Com Coparticipação',
    politica_coparticipacao: 'Padrão',
    corretores_1: 'Novo Corretor Realtime',
    corretores_2: null,
    corretores_3: null,
    temperatura_contrato: 'Contrato Fechado',
    usuario: 'admin@sbsaude.com.br',
    aptidao: 'Apto'
  };

  const mapped = client.mapDbProposalToCrm(rawDbProposal);
  assert.strictEqual(mapped.ID, '1073');
  assert.strictEqual(mapped.EMPRESA, 'TESTE REALTIME SB SAUDE LTDA');
  assert.strictEqual(mapped.CORRETORES_1, 'Novo Corretor Realtime');
  assert.strictEqual(mapped.TEMPERATURA_CONTRATO, 'Contrato Fechado');
  assert.strictEqual(mapped.FATURAMENTO, 'R$ 52.500,00');
  console.log('✓ 7.1: Mapeamento centralizado de colunas Supabase validado.');

  // Simulação de reatividade: adiciona a proposta mapeada ao conjunto
  const dynamicProposals = [mapped, ...proposals];
  const dynamicInsights = StrategicInsights.calculateFactualStrategicInsights(dynamicProposals, { period: 'all' });

  assert.strictEqual(dynamicInsights.scope.totalUniverse, 1073, 'Total passa a 1.073 propostas');
  assert.strictEqual(dynamicInsights.closedProposals.closedCount, 195, 'Fechadas passam a 195 contratos');
  const expectedNewClosedRevenue = 3173398.87 + 52500.00;
  assert.strictEqual(Math.round(dynamicInsights.closedProposals.totalRevenue * 100) / 100, Math.round(expectedNewClosedRevenue * 100) / 100);
  console.log(`✓ 7.2: Recálculo reativo imediato validado (Fechadas: 195, Faturamento: ${dynamicInsights.closedProposals.formattedRevenue}).`);

  console.log('\n================================================================');
  console.log('TODOS OS TESTES DE INSIGHTS ESTRATÉGICOS PASSARAM COM SUCESSO (100%)');
  console.log('================================================================\n');
}

runStrategicInsightsTests().catch(err => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES DE INSIGHTS ESTRATÉGICOS:');
  console.error(err);
  process.exit(1);
});
