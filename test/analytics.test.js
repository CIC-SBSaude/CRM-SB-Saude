const assert = require('node:assert/strict');
const analytics = require('../js/analytics.js');

const proposals = [
  { UF: 'BA', TEMPERATURA_CONTRATO: 'Fechado', COMPETENCIA: '01/01/2026', VIDAS: '1.200', FATURAMENTO: 'R$ 12.000,00', TKM: 'R$ 10,00' },
  { UF: 'BA', TEMPERATURA_CONTRATO: 'Fechado', COMPETENCIA: '01/02/2026', VIDAS: '100', FATURAMENTO: 'R$ 2.000,00', TKM: 'R$ 20,00' },
  { UF: 'SP', TEMPERATURA_CONTRATO: 'Iniciada', COMPETENCIA: '01/02/2026', VIDAS: '50', FATURAMENTO: 'R$ 500,00', TKM: 'R$ 10,00' }
];

const pivot = analytics.build(proposals, { row: 'UF', column: 'TEMPERATURA_CONTRATO', measure: 'revenue' });
assert.equal(pivot.filteredCount, 3);
assert.equal(pivot.grandTotal, 14500);
assert.equal(pivot.rows.find(r => r.label === 'BA').total, 14000);
assert.equal(pivot.columnTotals.reduce((a, b) => a + b, 0), pivot.grandTotal);

const average = analytics.build(proposals, { row: 'UF', measure: 'avgLives' });
assert.equal(average.rows.find(r => r.label === 'BA').total, 650);
assert.equal(average.grandTotal, 450);

const filtered = analytics.build(proposals, { row: 'COMPETENCIA', measure: 'count', filters: [{ field: 'UF', value: 'BA' }] });
assert.equal(filtered.filteredCount, 2);
assert.deepEqual(filtered.rows.map(r => r.label), ['2026-01', '2026-02']);
assert.equal(filtered.grandTotal, 2);

assert.equal(analytics.number('1.234.567,89'), 1234567.89);
assert.equal(analytics.number('R$ 10.000,50'), 10000.5);
assert.equal(analytics.toCsv(filtered).split('\r\n')[0], '\uFEFF"Competência";"Total"');
console.log('Análises: cálculos, filtros e CSV corretos.');
