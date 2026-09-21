/**
 * CRM SB Saúde — Testes Automatizados da Tela de Relatórios
 * Validação de:
 * 1. Extração de todas as fontes de dados reais
 * 2. Restrição e isolamento de permissão (Master vs Não-Master)
 * 3. Avaliação de filtros combinados e períodos
 * 4. Agrupamentos dinâmicos e medidas agregadas (contagem, soma, média)
 * 5. Execução dos 8 modelos sugeridos de relatório
 * 6. Persistência de relatórios salvos (CRUD)
 * 7. Integridade e consistência da exportação CSV com UTF-8 BOM e metadados
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ReportsEngine = require('../js/reports-engine.js');

// 1. Carrega base de dados real do sistema
const dbCode = fs.readFileSync(path.join(__dirname, '../js/database.js'), 'utf8');
const campaignsCode = fs.readFileSync(path.join(__dirname, '../js/campanhas_data.js'), 'utf8');

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(campaignsCode, sandbox);
vm.runInContext(dbCode, sandbox);

const realAppData = sandbox.window.CRM_INITIAL_DATA;
assert(realAppData, 'Base CRM_INITIAL_DATA deve estar carregada');
assert(realAppData.proposals.length >= 1000, 'Base de propostas deve conter ao menos 1000 registros');

console.log('✓ Base de dados real carregada com', realAppData.proposals.length, 'propostas.');

// Mock de Usuários
const masterUser = {
  login: 'RAMON',
  name: 'Ramon Reis',
  profile: 'Administrador Master'
};

const standardUser = {
  login: 'LUCAS',
  name: 'Lucas',
  profile: 'Supervisor Comercial'
};

const consultorUser = {
  login: 'JULIANA',
  name: 'Juliana Castro',
  profile: 'Consultor Comercial'
};

// -------------------------------------------------------------
// Teste 1: Disponibilidade das Fontes e Controle de Acesso
// -------------------------------------------------------------
console.log('\n--- Teste 1: Fontes de Dados e Controle de Permissão ---');

// Propostas acessíveis para todos
const proposalsStandard = ReportsEngine.extractSourceRecords('proposals', realAppData, standardUser);
assert.equal(proposalsStandard.length, realAppData.proposals.length);

// Empresas consolidadas
const companies = ReportsEngine.extractSourceRecords('companies', realAppData, standardUser);
assert.equal(companies.length, realAppData.companies.length);
assert(companies[0].TOTAL_VIDAS !== undefined);
assert(companies[0].TOTAL_FATURAMENTO !== undefined);

// Corretores com métricas
const brokers = ReportsEngine.extractSourceRecords('brokers', realAppData, standardUser);
assert.equal(brokers.length, realAppData.brokers.length);
assert(brokers[0].TOTAL_PROPOSTAS !== undefined);
assert(brokers[0].CONTRATOS_FECHADOS !== undefined);

// Políticas comerciais
const policies = ReportsEngine.extractSourceRecords('policies', realAppData, standardUser);
assert(policies.length >= 3);

// Auditoria: Master tem acesso, não-master tem acesso negado
const auditMaster = ReportsEngine.extractSourceRecords('audit', realAppData, masterUser);
assert(auditMaster.length > 0, 'Administrador Master deve ter acesso a registros de auditoria');

const auditStandard = ReportsEngine.extractSourceRecords('audit', realAppData, standardUser);
assert.equal(auditStandard.length, 0, 'Usuário comum não deve ter acesso a dados de auditoria');

const auditExecDenied = ReportsEngine.executeReport({ source: 'audit' }, realAppData, consultorUser);
assert(auditExecDenied.error, 'Execução de relatório de auditoria deve ser bloqueada para consultor');
assert.equal(auditExecDenied.records.length, 0);

console.log('✓ Controle de acesso e fontes de dados certificados com sucesso.');

// -------------------------------------------------------------
// Teste 2: Filtros Combinados e Período
// -------------------------------------------------------------
console.log('\n--- Teste 2: Filtros Combinados e Período ---');

// Filtro por UF exato
const filteredUF = ReportsEngine.filterRecords(realAppData.proposals, [
  { field: 'UF', operator: 'eq', value: 'BA' }
], {}, ReportsEngine.DATA_SOURCES.proposals);
assert(filteredUF.length > 0);
assert(filteredUF.every(p => p.UF === 'BA'));

// Filtro combinado: UF = BA E Vidas >= 50
const filteredCombined = ReportsEngine.filterRecords(realAppData.proposals, [
  { field: 'UF', operator: 'eq', value: 'BA' },
  { field: 'VIDAS', operator: 'gte', value: '50' }
], {}, ReportsEngine.DATA_SOURCES.proposals);
assert(filteredCombined.length <= filteredUF.length);
assert(filteredCombined.every(p => p.UF === 'BA' && ReportsEngine.parseNumber(p.VIDAS) >= 50));

// Filtro texto 'contains'
const filteredContains = ReportsEngine.filterRecords(realAppData.proposals, [
  { field: 'EMPRESA', operator: 'contains', value: 'LTDA' }
], {}, ReportsEngine.DATA_SOURCES.proposals);
assert(filteredContains.length > 0);
assert(filteredContains.every(p => p.EMPRESA.toUpperCase().includes('LTDA')));

// Filtro rápido de Período
const filteredPeriod = ReportsEngine.filterRecords(realAppData.proposals, [], {
  start: '01/01/2024',
  end: '31/03/2024',
  field: 'DATA_DA_PROSPECCAO'
}, ReportsEngine.DATA_SOURCES.proposals);
assert(filteredPeriod.length > 0);
for (const p of filteredPeriod) {
  const d = ReportsEngine.parseDateBR(p.DATA_DA_PROSPECCAO);
  assert(d >= new Date(2024, 0, 1) && d <= new Date(2024, 2, 31, 23, 59, 59));
}

console.log('✓ Filtros combinados e intervalos de datas validados com sucesso.');

// -------------------------------------------------------------
// Teste 3: Agrupamento Dinâmico e Medidas Matemáticas
// -------------------------------------------------------------
console.log('\n--- Teste 3: Agrupamentos e Medidas Matemáticas ---');

const groupedByEtapa = ReportsEngine.aggregateRecords(
  realAppData.proposals,
  'TEMPERATURA_CONTRATO',
  ['count', 'sum_VIDAS', 'sum_FATURAMENTO', 'avg_TKM'],
  ReportsEngine.DATA_SOURCES.proposals
);

assert(groupedByEtapa.length > 0);
const sumCounts = groupedByEtapa.reduce((acc, row) => acc + row.count, 0);
assert.equal(sumCounts, realAppData.proposals.length, 'Soma das contagens agrupadas deve ser igual ao total');

// Confere cálculo de totais
const totals = ReportsEngine.calculateGrandTotals(
  groupedByEtapa,
  ['TEMPERATURA_CONTRATO', 'count', 'sum_VIDAS', 'sum_FATURAMENTO'],
  ReportsEngine.DATA_SOURCES.proposals,
  true
);
assert.equal(totals.count, realAppData.proposals.length);
assert(totals._summary.totalVidas > 0);

console.log('✓ Agrupamento e medidas matemáticas conferem com precisão absoluta.');

// -------------------------------------------------------------
// Teste 4: Execução dos 8 Modelos Sugeridos
// -------------------------------------------------------------
console.log('\n--- Teste 4: Execução dos 8 Modelos Sugeridos ---');

assert.equal(ReportsEngine.SUGGESTED_TEMPLATES.length, 8, 'Devem existir 8 modelos sugeridos');

for (const tpl of ReportsEngine.SUGGESTED_TEMPLATES) {
  const res = ReportsEngine.executeReport(tpl.config, realAppData, standardUser);
  assert(!res.error, `Modelo ${tpl.title} não deve retornar erro`);
  assert(Array.isArray(res.records), `Modelo ${tpl.title} deve retornar array de registros`);
  assert(res.records.length > 0, `Modelo ${tpl.title} deve conter registros nos dados reais`);
  assert(res.displayedColumns.length > 0, `Modelo ${tpl.title} deve possuir colunas exibidas`);
  console.log(`  ✓ Modelo "${tpl.title}": ${res.records.length} registros gerados com sucesso.`);
}

// -------------------------------------------------------------
// Teste 5: Gerenciamento de Relatórios Salvos (CRUD)
// -------------------------------------------------------------
console.log('\n--- Teste 5: Persistência de Relatórios Salvos ---');

// Mock localStorage para Node.js
const storageMap = new Map();
global.localStorage = {
  getItem(key) { return storageMap.get(key) || null; },
  setItem(key, val) { storageMap.set(key, String(val)); },
  removeItem(key) { storageMap.delete(key); },
  clear() { storageMap.clear(); }
};

// 1. Salvar novo relatório
const saveResult = ReportsEngine.saveReport({
  title: 'Meu Relatório de Teste',
  description: 'Relatório salvo automatizado',
  source: 'proposals',
  columns: ['ID', 'EMPRESA', 'VIDAS'],
  filters: [{ field: 'UF', operator: 'eq', value: 'SP' }]
});
assert(saveResult.success, 'Relatório deve ser salvo com sucesso');
assert(saveResult.report.id, 'Relatório salvo deve possuir ID');

// 2. Listar relatórios salvos
let savedList = ReportsEngine.getSavedReports();
assert.equal(savedList.length, 1);
assert.equal(savedList[0].title, 'Meu Relatório de Teste');

// 3. Duplicar relatório
const dupResult = ReportsEngine.duplicateReport(saveResult.report.id);
assert(dupResult.success, 'Relatório deve ser duplicado com sucesso');
savedList = ReportsEngine.getSavedReports();
assert.equal(savedList.length, 2);
assert(savedList.some(r => r.title.includes('Cópia')));

// 4. Excluir relatório
const delResult = ReportsEngine.deleteReport(saveResult.report.id);
assert(delResult.success, 'Relatório deve ser excluído com sucesso');
savedList = ReportsEngine.getSavedReports();
assert.equal(savedList.length, 1);

console.log('✓ CRUD de relatórios salvos testado e aprovado.');

// -------------------------------------------------------------
// Teste 6: Integridade da Exportação CSV
// -------------------------------------------------------------
console.log('\n--- Teste 6: Integridade da Exportação CSV ---');

const sampleExec = ReportsEngine.executeReport({
  source: 'proposals',
  columns: ['ID', 'DATA_DA_PROSPECCAO', 'EMPRESA', 'UF', 'VIDAS', 'FATURAMENTO'],
  filters: [{ field: 'UF', operator: 'eq', value: 'BA' }],
  sort: { field: 'VIDAS', order: 'desc' }
}, realAppData, standardUser);

const csvString = ReportsEngine.exportToCSV(sampleExec, {
  title: 'Relatório Executivo de Propostas da Bahia',
  userName: 'Lucas (Supervisor)'
});

// Valida BOM UTF-8 (\uFEFF)
assert(csvString.startsWith('\uFEFF'), 'CSV deve iniciar com BOM UTF-8');

// Valida delimitador ;
assert(csvString.includes(';'), 'CSV deve utilizar delimitador ponto e vírgula');

// Valida metadados no topo
assert(csvString.includes('"CRM SB SAÚDE — RELATÓRIO CORPORATIVO"'), 'CSV deve conter cabeçalho institucional');
assert(csvString.includes('Relatório Executivo de Propostas da Bahia'), 'CSV deve conter o título configurado');
assert(csvString.includes('Lucas (Supervisor)'), 'CSV deve registrar o emissor');
assert(csvString.includes('Estado (UF)') && csvString.includes('BA'), 'CSV deve descrever o filtro aplicado');

// Valida linhas de dados e formatação de moeda brasileira
assert(csvString.includes('R$'), 'CSV deve conter formatação de moeda brasileira');
assert(csvString.includes('TOTAL ('), 'CSV deve conter linha final de totais gerais');

console.log('✓ Exportação CSV testada: UTF-8 BOM, delimitador pt-BR e metadados certificados.');

// -------------------------------------------------------------
// Teste 7: Formatação Numérica e Moeda Brasileira
// -------------------------------------------------------------
console.log('\n--- Teste 7: Formatação Numérica e Moeda pt-BR ---');

assert.equal(ReportsEngine.formatCurrency(1234567.89), 'R$\u00A01.234.567,89');
assert.equal(ReportsEngine.parseCurrency('R$ 1.234.567,89'), 1234567.89);
assert.equal(ReportsEngine.parseNumber('1.250'), 1250);
assert.equal(ReportsEngine.formatNumber(1250), '1.250');
assert.equal(ReportsEngine.formatDateBR('2024-01-15'), '15/01/2024');

console.log('✓ Formatações em padrão brasileiro validadas.');

console.log('\n======================================================');
console.log('🎉 TODOS OS TESTES DO MOTOR DE RELATÓRIOS PASSARAM COM SUCESSO!');
console.log('======================================================\n');
