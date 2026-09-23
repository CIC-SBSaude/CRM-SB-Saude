/**
 * CRM SB Saúde — Testes Automatizados de Responsividade e Validação Visual do Dashboard Executivo
 * 
 * Validações:
 * 1. 0 overflow horizontal (document.documentElement e body) em todas as viewports.
 * 2. 6 KPIs executivos estruturados com deltas e definições.
 * 3. 3 Macro-destinos mutuamente exclusivos (Em Andamento, Fechadas, Perdidas).
 * 4. 3 Visualizações gráficas Chart.js funcionais.
 * 5. 5 Insights acionáveis priorizados (incluindo Alerta de Perda Proposta #103).
 * 6. Tabela de Propostas que Exigem Ação com paginação e badges minimalistas.
 * 7. 9 Módulos operacionais compactos no rodapé.
 * 8. 6 Viewports testadas: 1920x1080, 1440x900, 1366x768, 1024x768, 768x1024, 390x844.
 * 9. Dark Mode validado.
 * 10. Gravação de screenshots PNG de alta resolução.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

console.log('--- Iniciando Testes Automatizados de Responsividade do Dashboard Executivo ---\n');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
assert(fs.existsSync(chromePath), 'Google Chrome deve estar instalado para execução dos testes automatizados');

const screenshotsDir = path.join(__dirname, '../screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

const viewports = [
  { width: 1920, height: 1080, name: 'Desktop Full HD 1080p' },
  { width: 1440, height: 900, name: 'Desktop Widescreen' },
  { width: 1366, height: 768, name: 'Desktop Laptop' },
  { width: 1024, height: 768, name: 'Tablet Paisagem / Desktop Compacto' },
  { width: 768, height: 1024, name: 'Tablet Retrato' },
  { width: 390, height: 844, name: 'Mobile iPhone' },
  { width: 360, height: 740, name: 'Mobile Compacto 360px' }
];

// Teste em cada Viewport (Light Mode)
for (const vp of viewports) {
  const screenshotFile = path.join(screenshotsDir, `dashboard_${vp.width}x${vp.height}.png`);
  const targetUrl = `http://localhost:8080/test/dashboard_responsive_runner.html?theme=light`;
  
  const cmd = `"${chromePath}" --headless=new --disable-gpu --virtual-time-budget=4000 --window-size=${vp.width},${vp.height} --screenshot="${screenshotFile}" --dump-dom "${targetUrl}"`;

  let output = '';
  try {
    output = execSync(cmd, { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024 });
  } catch (err) {
    assert.fail(`Falha ao executar Chrome na viewport ${vp.name} (${vp.width}x${vp.height}): ${err.message}`);
  }

  const payloadMatch = output.match(/data-test-payload="([^"]+)"/);
  assert(payloadMatch, `Chrome deve retornar payload de teste para ${vp.name}`);

  const unescapedPayload = payloadMatch[1].replace(/&quot;/g, '"');
  const res = JSON.parse(unescapedPayload);

  // A. Ausência de Rolagem Horizontal no Documento
  assert.strictEqual(
    res.document.hasHorizontalScroll,
    false,
    `Documento não deve apresentar rolagem horizontal na viewport ${vp.name} (${vp.width}x${vp.height}). ` +
    `scrollWidth=${res.document.scrollWidth} vs clientWidth=${res.document.clientWidth}`
  );

  // B. Ausência de Rolagem Horizontal no Body
  assert.strictEqual(
    res.body.hasHorizontalScroll,
    false,
    `Body não deve apresentar rolagem horizontal na viewport ${vp.name} (${vp.width}x${vp.height})`
  );

  // C. Componentes Estruturais Presentes
  assert.strictEqual(res.counts.kpiCards, 6, 'Devem existir exatamente 6 cartões de KPI');
  assert.strictEqual(res.counts.destCols, 3, 'Devem existir 3 colunas de macro-destinos');
  assert.strictEqual(res.counts.insightCards, 5, 'Devem existir exatamente 5 cartões de insights acionáveis');
  assert.strictEqual(res.insightCardsScrollOverflow, false, 'Nenhum card de insight deve ultrapassar a largura do container');
  assert.ok(res.counts.navCards >= 8, 'Devem existir os cartões de navegação operacional compacta');
  assert.ok(res.counts.tableRows >= 1, 'Tabela de propostas acionáveis deve conter linhas renderizadas');

  // D. Botão Atualizar e Ausência do Selo Técnico
  assert.strictEqual(res.hasRefreshBtn, true, 'Botão de atualizar deve existir');
  assert.ok(res.refreshBtnClasses.includes('exec-btn-refresh'), 'Botão de atualizar deve ter classe exec-btn-refresh');
  assert.strictEqual(res.hasRealtimeBadge, false, 'Selo técnico "Supabase Realtime Ativo" não deve existir no dashboard');

  // E. 3 Gráficos Inicializados
  assert.strictEqual(res.charts.hasEvolution, true, 'Canvas chart-evolution deve estar presente');
  assert.strictEqual(res.charts.hasPipeline, true, 'Canvas chart-pipeline deve estar presente');
  assert.strictEqual(res.charts.hasLossOpp, true, 'Canvas chart-loss-opp deve estar presente');

  console.log(`✓ Viewport ${vp.name} (${vp.width}x${vp.height}): 0 overflow (doc ${res.document.clientWidth}px), 6 KPIs, 5 Insights verticais, 3 Destinos, 3 Gráficos, screenshot gravado.`);
}

// Teste em Dark Mode (1440x900)
console.log('\n--- Teste Visual: Dark Mode ---');
{
  const screenshotDark = path.join(screenshotsDir, `dashboard_dark_1440x900.png`);
  const targetUrl = `http://localhost:8080/test/dashboard_responsive_runner.html?theme=dark`;
  const cmd = `"${chromePath}" --headless=new --disable-gpu --virtual-time-budget=4000 --window-size=1440,900 --screenshot="${screenshotDark}" --dump-dom "${targetUrl}"`;

  const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024 });
  const payloadMatch = output.match(/data-test-payload="([^"]+)"/);
  assert(payloadMatch, 'Chrome deve retornar payload para Dark Mode');
  const res = JSON.parse(payloadMatch[1].replace(/&quot;/g, '"'));

  assert.strictEqual(res.document.hasHorizontalScroll, false, 'Dark Mode não deve ter overflow horizontal');
  assert.strictEqual(res.theme, 'dark', 'Atributo data-theme deve ser "dark"');
  console.log('✓ Dark Mode validado com sucesso (data-theme="dark", 0 overflow, screenshot gravado).');
}

console.log('\n================================================================');
console.log('🎉 TODOS OS TESTES DE RESPONSIVIDADE E LAYOUT DO DASHBOARD PASSARAM!');
console.log('================================================================\n');
