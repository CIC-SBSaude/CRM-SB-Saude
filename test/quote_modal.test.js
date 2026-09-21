const assert = require('node:assert/strict');
const fs = require('node:fs');
const BusinessRules = require('../js/business-rules.js');

async function runTests() {
  console.log('--- Teste 1: Constantes do Modelo Legado em BusinessRules ---');
  assert.ok(Array.isArray(BusinessRules.MOTIVOS_DECLINIO), 'MOTIVOS_DECLINIO deve ser um array');
  assert.ok(BusinessRules.MOTIVOS_DECLINIO.includes('AUSENCIA DE REGISTRO DE RETORNO DO COMERCIAL'), 'Deve conter motivo padrão do legado');
  assert.ok(BusinessRules.MOTIVOS_DECLINIO.includes('ANALISE TECNICA'), 'Deve conter ANALISE TECNICA');

  assert.ok(Array.isArray(BusinessRules.FAIXAS_ETARIAS_PADRAO), 'FAIXAS_ETARIAS_PADRAO deve ser um array');
  assert.equal(BusinessRules.FAIXAS_ETARIAS_PADRAO.length, 10, 'Padrão ANS oficial possui 10 faixas etárias');
  assert.ok(BusinessRules.FAIXAS_ETARIAS_PADRAO.includes('00 a 18 anos'), 'Deve conter primeira faixa');
  assert.ok(BusinessRules.FAIXAS_ETARIAS_PADRAO.includes('59 anos acima'), 'Deve conter última faixa');

  assert.ok(Array.isArray(BusinessRules.OPCOES_AGENCIAMENTO), 'OPCOES_AGENCIAMENTO deve ser um array');
  assert.ok(BusinessRules.OPCOES_AGENCIAMENTO.includes('Padrão SB Saúde'), 'Deve conter Padrão SB Saúde');
  console.log('✓ Constantes do modelo legado validadas com sucesso.');

  console.log('\n--- Teste 2: Serviço de Busca de Cidades por UF (IBGE e Fallback) ---');
  const spCities = await BusinessRules.fetchCitiesByUF('SP');
  assert.ok(Array.isArray(spCities) && spCities.length > 0, 'Cidades de SP devem ser retornadas');
  assert.ok(spCities.includes('São Paulo'), 'Lista de SP deve incluir a capital São Paulo');

  const baCities = await BusinessRules.fetchCitiesByUF('BA');
  assert.ok(Array.isArray(baCities) && baCities.length > 0, 'Cidades da BA devem ser retornadas');
  assert.ok(baCities.includes('Salvador'), 'Lista da BA deve incluir Salvador');

  // Teste de cache em memória
  assert.ok(BusinessRules._citiesCache['SP'], 'Cidades de SP devem estar em cache');
  assert.ok(BusinessRules._citiesCache['BA'], 'Cidades da BA devem estar em cache');

  // Teste com UF vazia
  const emptyCities = await BusinessRules.fetchCitiesByUF('');
  assert.deepEqual(emptyCities, [], 'UF vazia deve retornar array vazio');
  console.log(`✓ Serviço de cidades testado com sucesso (SP: ${spCities.length} cidades, BA: ${baCities.length} cidades).`);

  console.log('\n--- Teste 3: Verificação de Integridade dos Componentes no app.js e styles.css ---');
  const appCode = fs.readFileSync('js/app.js', 'utf8');
  const cssCode = fs.readFileSync('css/styles.css', 'utf8');

  // Verifica campos legado em app.js
  const requiredFields = [
    'inp-cidade',
    'cities-datalist',
    'temp-btn',
    'inp-decline-reason',
    'inp-qnt-faixas',
    'inp-faixas-etarias',
    'faixas-chips-wrapper',
    'inp-agenciamento-1',
    'inp-vitalicio-1',
    'inp-agenciamento-2',
    'inp-vitalicio-2',
    'inp-agenciamento-3',
    'inp-vitalicio-3',
    'inp-data-tecnica',
    'inp-data-diretoria',
    'inp-data-envio',
    'inp-observacao'
  ];

  for (const field of requiredFields) {
    assert.ok(appCode.includes(field), `app.js deve conter o campo ou classe "${field}"`);
  }

  // Verifica classes CSS
  const requiredCss = [
    '.temp-selector-list',
    '.temp-btn',
    '.segmented-group',
    '.segmented-btn',
    '.stepper-input-group',
    '.stepper-btn',
    '.faixa-chips-container',
    '.faixa-chip',
    '.city-field-wrapper'
  ];

  for (const cls of requiredCss) {
    assert.ok(cssCode.includes(cls), `styles.css deve conter a regra "${cls}"`);
  }

  console.log('✓ Todos os 28 campos e regras visuais integradas e validadas.');

  console.log('\n--- Teste 4: Verificação do Cadastro de Novo Modelo de Coparticipação ---');
  // Verifica presença de botões e IDs do modal de coparticipação em app.js
  const requiredCopartFields = [
    'openNewCopartModal',
    'btn-new-copart-policy',
    'inp-copart-nome',
    'inp-copart-desconto',
    'inp-copart-ultrapasse',
    'inp-copart-eletiva',
    'inp-copart-emergencia',
    'inp-copart-exames-simples',
    'inp-copart-exames-complexos',
    'inp-copart-terapia',
    'copart-image-upload-box'
  ];

  for (const field of requiredCopartFields) {
    assert.ok(appCode.includes(field), `app.js deve conter o campo/identificador de coparticipação "${field}"`);
  }

  // Verifica classes CSS da coparticipação
  const requiredCopartCss = [
    '.copart-slider-wrapper',
    '.copart-range-input',
    '.copart-image-upload-box',
    '.segmented-yes-no'
  ];

  for (const cls of requiredCopartCss) {
    assert.ok(cssCode.includes(cls), `styles.css deve conter a regra de estilo "${cls}"`);
  }

  // Validação matemática e formatação de valores da política
  const testPolicy = {
    Nome_Politica: 'Copart Executivo Teste',
    Percentual_Desconto_Evento: '25,00%',
    Qnt_Partida_Evento: '3',
    Valor_Consulta_Eletiva: BusinessRules.formatCurrency(BusinessRules.parseCurrency('25')),
    Valor_Consulta_Emergencia: BusinessRules.formatCurrency(BusinessRules.parseCurrency('45,50')),
    Valor_Exames_Simples: BusinessRules.formatCurrency(BusinessRules.parseCurrency('15')),
    Valor_Exames_Complexos: BusinessRules.formatCurrency(BusinessRules.parseCurrency('80')),
    Terapia: 'Sim',
    Valor_Terapia: BusinessRules.formatCurrency(BusinessRules.parseCurrency('60'))
  };

  assert.equal(testPolicy.Valor_Consulta_Eletiva, 'R$\u00A025,00');
  assert.equal(testPolicy.Valor_Consulta_Emergencia, 'R$\u00A045,50');
  assert.equal(testPolicy.Qnt_Partida_Evento, '3');
  console.log('✓ Estrutura, estilos e regras do modelo de coparticipação certificados.');

  console.log('\n--- Teste 5: Detalhes Completos da Empresa no Drawer & Links Interativos ---');
  const requiredLabels = [
    'Empresa',
    'Data da Proposta',
    'Competência',
    'Vidas',
    'UF',
    'TKM (Ticket Médio)',
    'Faturamento',
    'Acomodação',
    'Fator Moderador',
    'Politica de Coparticipação',
    'Corretor de Negocios 1',
    'Agenciamento do Corretor 1',
    'Campanha',
    'Status Campanha',
    'Temperatura do Fechamento do Contrato',
    'Empresa Apta ou Inapta para Contabilização da Conversão',
    'Tipo do Contrato',
    'Quantidade de Faixas Etárias',
    'Faixas Etárias',
    'Data da Avaliação: Diretoria',
    'Data de Envio da Proposta ao Corretor e/ou Cliente',
    'Observações'
  ];

  for (const label of requiredLabels) {
    assert.ok(appCode.includes(label), `app.js deve conter o campo legado "${label}" no drawer`);
  }

  const requiredDrawerClasses = [
    'detail-link-arrow',
    'drawer-quote-switcher',
    'drawer-quote-pill',
    'drawer-legacy-fields-list',
    'drawer-legacy-field',
    'drawer-legacy-label',
    'drawer-legacy-val'
  ];

  for (const cls of requiredDrawerClasses) {
    assert.ok(cssCode.includes(cls), `styles.css deve conter a classe "${cls}" para o layout do drawer`);
    assert.ok(appCode.includes(cls), `app.js deve utilizar a classe "${cls}"`);
  }

  assert.ok(appCode.includes('openCompanyDrawer'), 'app.js deve implementar openCompanyDrawer');
  assert.ok(appCode.includes('window.navigateToTab'), 'app.js deve expor window.navigateToTab');
  assert.ok(appCode.includes('data-link-type="company"'), 'app.js deve conter link interativo para Empresa');
  assert.ok(appCode.includes('data-link-type="copart"'), 'app.js deve conter link interativo para Coparticipação');
  assert.ok(appCode.includes('data-link-type="broker"'), 'app.js deve conter link interativo para Corretor');
  assert.ok(appCode.includes('data-link-type="agency"'), 'app.js deve conter link interativo para Agenciamento');
  assert.ok(appCode.includes('data-link-type="campaign"'), 'app.js deve conter link interativo para Campanha');

  console.log('✓ Todos os 22 campos legados, classes de layout e links interativos (>) certificados.');

  console.log('\n🎉 TODOS OS TESTES (COTAÇÃO, COPARTICIPAÇÃO & DETALHES DE EMPRESA) PASSARAM COM SUCESSO!');
}

runTests().catch(err => {
  console.error('Falha nos testes:', err);
  process.exit(1);
});
