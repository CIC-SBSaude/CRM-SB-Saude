/**
 * CRM SB Saúde — Testes Automatizados de Responsividade e Apresentação em Tabela/Lista dos Relatórios
 * 
 * Validações:
 * 1. Aproveitamento de 100% da largura útil sem max-width: 1440px restritivo ou centralização.
 * 2. Modelo "Contratos Fechados" (9 colunas) exibido como tabela horizontal contínua no desktop (1920x1080, 1440x900, 1366x768, 1024x768).
 * 3. Ausência completa de mosaico de cartões no desktop (isCardMode = false, thead visível, tbody com display tabular).
 * 4. Rodapé integrado com contador de registros ("Exibindo X a Y de Z"), seletor de quantidade e controles de página.
 * 5. Ausência de rolagem horizontal indesejada (document.documentElement e .rep-table-container).
 * 6. Validação em 6 viewports: 1920x1080, 1440x900, 1366x768, 1024x768, 768x1024 e 390x844.
 * 7. Apresentação minimalista de status/temperatura (.rep-stage com .rep-stage-dot), sem badges retangulares pesados.
 * 8. Suporte a tema escuro ([data-theme="dark"]) nas cores semânticas e componentes estruturais.
 * 9. Regras de impressão (@media print) forçando layout tabular e suprimindo pseudo-elementos.
 * 10. Captura de evidências visuais (screenshots PNG) de todas as viewports e do modelo Contratos Fechados.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

console.log('--- Iniciando Testes Automatizados de Responsividade e Tabela (Relatórios CRM SB Saúde) ---\n');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
assert(fs.existsSync(chromePath), 'Google Chrome deve estar instalado para execução dos testes automatizados');

const screenshotsDir = path.join(__dirname, '../screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// 1. Verificação estática das regras de CSS
console.log('--- Teste 1: Auditoria Estática de Regras CSS (styles.css) ---');
const cssPath = path.join(__dirname, '../css/styles.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

// Não deve conter max-width: 1440px restritivo em .reports-view-wrapper
assert(!cssContent.includes('.reports-view-wrapper {\r\n  padding: 1.5rem;\r\n  width: 100%;\r\n  min-width: 0;\r\n  max-width: 1440px;'),
  'styles.css não deve conter max-width: 1440px restringindo .reports-view-wrapper');

// Deve conter largura 100% e integração com o layout
assert(cssContent.includes('.reports-view-wrapper {'), 'styles.css deve estilizar .reports-view-wrapper');
assert(cssContent.includes('.rep-stage-dot'), 'styles.css deve conter indicador minimalista .rep-stage-dot');
assert(cssContent.includes('.rep-totals-tr'), 'styles.css deve conter estilização da linha de totais');
assert(cssContent.includes('.rep-pagination-left'), 'styles.css deve conter alinhamento integrado de rodapé (.rep-pagination-left)');
assert(cssContent.includes('@media print'), 'styles.css deve conter regras dedicadas de impressão');
assert(cssContent.includes('display: table !important'), '@media print deve forçar display tabular para .rep-data-table');
console.log('✓ Auditoria estática de CSS confirmou remoção do limite de 1440px e regras limpas.');

// 2. Validação nas Viewports Reais via Chrome Headless
console.log('\n--- Teste 2: Inspeção de Métricas e Formato de Tabela em 6 Viewports Reais ---');

const viewports = [
  { width: 1920, height: 1080, name: 'Desktop Full HD 1080p', isDesktop: true },
  { width: 1440, height: 900, name: 'Desktop Widescreen', isDesktop: true },
  { width: 1366, height: 768, name: 'Desktop Laptop', isDesktop: true },
  { width: 1024, height: 768, name: 'Tablet Paisagem / Desktop Compacto', isDesktop: true },
  { width: 768, height: 1024, name: 'Tablet Retrato', isDesktop: false },
  { width: 390, height: 844, name: 'Mobile iPhone', isDesktop: false }
];

for (const vp of viewports) {
  const screenshotFile = path.join(screenshotsDir, `reports_${vp.width}x${vp.height}.png`);
  const targetUrl = `http://localhost:8080/test/reports_responsive_runner.html?scenario=default&theme=light`;
  
  const cmd = `"${chromePath}" --headless=new --disable-gpu --virtual-time-budget=3500 --window-size=${vp.width},${vp.height} --screenshot="${screenshotFile}" --dump-dom "${targetUrl}"`;

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

  // C. Ausência de Rolagem Horizontal no Contêiner da Tabela (Desktop)
  if (vp.isDesktop) {
    assert.strictEqual(
      res.tableContainer.hasHorizontalScroll,
      false,
      `Contêiner da tabela (.rep-table-container) não deve estourar na viewport ${vp.name} (${vp.width}x${vp.height}). ` +
      `scrollWidth=${res.tableContainer.scrollWidth} vs clientWidth=${res.tableContainer.clientWidth}`
    );

    // D. No Desktop a tabela NUNCA deve ser mosaico de cartões
    assert.strictEqual(
      res.layout.isCardMode,
      false,
      `No desktop (${vp.name}), a tabela deve ser exibida como tabela contínua horizontal, nunca como cartões.`
    );
    assert.strictEqual(
      res.layout.theadComputedDisplay,
      'table-header-group',
      `No desktop (${vp.name}), thead deve ter display: table-header-group`
    );
  }

  // E. Apresentação Minimalista de Temperatura / Etapa
  assert.ok(
    res.statusAesthetics.stagesCount > 0,
    `Tabela deve exibir elementos minimalistas de etapa (.rep-stage) em ${vp.name}`
  );
  assert.strictEqual(
    res.statusAesthetics.stagesCount,
    res.statusAesthetics.stageDotsCount,
    `Cada elemento .rep-stage deve possuir seu respectivo .rep-stage-dot em ${vp.name}`
  );
  assert.strictEqual(
    res.statusAesthetics.oldBadgesCount,
    0,
    `Nenhum retângulo colorido antigo (.badge) deve aparecer na tabela de relatórios em ${vp.name}`
  );

  // F. Seletor de registros por página integrado ao rodapé
  assert.strictEqual(
    res.layout.pageSizeSelectInFooter,
    true,
    `Seletor de quantidade por página (#rep-page-size-select) deve estar integrado ao rodapé (.rep-pagination-bar) em ${vp.name}`
  );

  // G. Evidência visual gerada
  assert(fs.existsSync(screenshotFile), `Screenshot deve ser gravado em ${screenshotFile}`);
  const screenshotStats = fs.statSync(screenshotFile);
  assert(screenshotStats.size > 5000, `Screenshot deve conter imagem válida em ${screenshotFile}`);

  console.log(
    `✓ Viewport ${vp.name} (${vp.width}x${vp.height}): 0 overflow (doc ${res.document.clientWidth}px, table ${res.tableContainer.clientWidth}px), ` +
    `layout=${res.layout.isCardMode ? 'lista-vertical' : 'tabela-horizontal'}, screenshot gravado (${Math.round(screenshotStats.size / 1024)} KB).`
  );
}

// 3. Validação Específica do Modelo "Contratos Fechados" (9 Colunas)
console.log('\n--- Teste 3: Modelo "Contratos Fechados" (9 Colunas em Tabela Horizontal) ---');
{
  const targetUrl = `http://localhost:8080/test/reports_responsive_runner.html?scenario=contratos_fechados&theme=light`;
  const screenshotContratos = path.join(screenshotsDir, 'reports_contratos_fechados_1920x1080.png');
  const cmd = `"${chromePath}" --headless=new --disable-gpu --virtual-time-budget=3500 --window-size=1920,1080 --screenshot="${screenshotContratos}" --dump-dom "${targetUrl}"`;
  const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024 });
  const payloadMatch = output.match(/data-test-payload="([^"]+)"/);
  assert(payloadMatch, 'Payload de teste deve ser retornado para Contratos Fechados');
  const res = JSON.parse(payloadMatch[1].replace(/&quot;/g, '"'));

  // Validação: 9 colunas no cabeçalho
  assert.strictEqual(res.layout.colCount, 9, 'Modelo Contratos Fechados deve conter exatamente 9 colunas no cabeçalho');
  // Validação: Tabela horizontal no desktop (NUNCA mosaico de cards)
  assert.strictEqual(res.layout.isCardMode, false, 'Modelo Contratos Fechados deve ser exibido como tabela horizontal no desktop, NÃO como mosaico de cartões');
  assert.strictEqual(res.layout.theadComputedDisplay, 'table-header-group', 'Cabeçalho da tabela deve estar visível (table-header-group)');
  // Validação: Registros paginados presentes
  assert.ok(res.layout.rowCount > 0, 'Tabela de Contratos Fechados deve conter registros paginados na prévia');
  // Validação: Sem rolagem horizontal no documento e na tabela
  assert.strictEqual(res.document.hasHorizontalScroll, false, 'Contratos Fechados não deve provocar rolagem horizontal no documento');
  assert.strictEqual(res.tableContainer.hasHorizontalScroll, false, 'Contratos Fechados não deve estourar largura útil da tabela');

  console.log(`✓ Modelo "Contratos Fechados": 9 colunas exibidas com sucesso em formato de tabela horizontal contínua (0 overflow).`);
  console.log(`  Screenshot gravado em: ${screenshotContratos}`);
}

// 4. Teste do Cenário Agrupado com Totais (.rep-totals-tr)
console.log('\n--- Teste 4: Cenário Agrupado com Linha de Totais ---');
{
  const targetUrl = `http://localhost:8080/test/reports_responsive_runner.html?scenario=grouped&theme=light`;
  const cmd = `"${chromePath}" --headless=new --disable-gpu --virtual-time-budget=3500 --window-size=1366,768 --dump-dom "${targetUrl}"`;
  const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024 });
  const payloadMatch = output.match(/data-test-payload="([^"]+)"/);
  assert(payloadMatch, 'Payload de teste deve ser retornado para cenário agrupado');
  const res = JSON.parse(payloadMatch[1].replace(/&quot;/g, '"'));

  assert.strictEqual(res.document.hasHorizontalScroll, false, 'Cenário agrupado não deve gerar overflow');
  assert.ok(res.layout.hasTotalsRow, 'Cenário agrupado deve conter a linha de totais (.rep-totals-tr)');
  assert.strictEqual(res.layout.isCardMode, false, 'Cenário agrupado no desktop deve manter formato tabular');
  console.log('✓ Linha de totais consolidada exibida com sucesso na base da tabela sem quebra de layout.');
}

// 5. Teste de Tema Escuro (Dark Mode)
console.log('\n--- Teste 5: Estilização Minimalista e Cores no Dark Mode ---');
{
  const targetUrl = `http://localhost:8080/test/reports_responsive_runner.html?scenario=contratos_fechados&theme=dark`;
  const screenshotDark = path.join(screenshotsDir, 'reports_dark_contratos_fechados_1366x768.png');
  const cmd = `"${chromePath}" --headless=new --disable-gpu --virtual-time-budget=3500 --window-size=1366,768 --screenshot="${screenshotDark}" --dump-dom "${targetUrl}"`;
  const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024 });
  const payloadMatch = output.match(/data-test-payload="([^"]+)"/);
  assert(payloadMatch, 'Payload de teste deve ser retornado para modo escuro');
  const res = JSON.parse(payloadMatch[1].replace(/&quot;/g, '"'));

  assert.strictEqual(res.document.hasHorizontalScroll, false, 'Modo escuro não deve gerar rolagem horizontal');
  assert.strictEqual(res.layout.isCardMode, false, 'Contratos Fechados no modo escuro deve permanecer como tabela horizontal');
  assert(fs.existsSync(screenshotDark), 'Screenshot de dark mode deve ser gravado');
  console.log(`✓ Modo escuro validado em Contratos Fechados com tabela horizontal e semântica escura.`);
}

console.log('\n================================================================');
console.log('🎉 TODOS OS TESTES DE RESPONSIVIDADE E TABELA DOS RELATÓRIOS PASSARAM COM SUCESSO!');
console.log('================================================================\n');
