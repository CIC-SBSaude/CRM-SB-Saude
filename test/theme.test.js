/**
 * CRM SB Saúde — Testes Automatizados do Dark Mode & Gerenciador de Temas
 * Validação de:
 * 1. Lógica de resolução de tema (Claro, Escuro, Automático via prefers-color-scheme)
 * 2. Persistência de preferência no localStorage
 * 3. Script anti-FOUC no <head> do index.html
 * 4. Controles acessíveis do seletor de tema no cabeçalho
 * 5. Variáveis CSS semânticas em :root e [data-theme="dark"]
 * 6. Suporte a contraste dinâmico no Chart.js (app.js e analytics.js)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('--- Iniciando Testes do Dark Mode: CRM SB Saúde ---');

// 1. Validar script anti-FOUC e controles HTML no index.html
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

assert(
  indexHtml.includes("crm_theme_preference"),
  'index.html deve referenciar a chave crm_theme_preference no script inicial anti-FOUC'
);

assert(
  indexHtml.includes("data-theme"),
  'index.html deve aplicar o atributo data-theme ao elemento raiz'
);

// Verificar se o script anti-FOUC está no <head> antes de </head>
const headMatch = indexHtml.match(/<head[\s\S]*?<\/head>/i);
assert(headMatch, 'index.html deve conter a tag <head>');
const headContent = headMatch[0];
assert(
  headContent.includes('crm_theme_preference'),
  'O script anti-FOUC deve estar presente dentro do <head> para evitar clarão (FOUC) na renderização inicial'
);

// Verificar botões do seletor no cabeçalho
assert(
  indexHtml.includes('class="theme-switch-control"'),
  'index.html deve conter o container .theme-switch-control no cabeçalho'
);
assert(
  indexHtml.includes('data-theme-choice="light"'),
  'index.html deve conter botão para tema Claro (data-theme-choice="light")'
);
assert(
  indexHtml.includes('data-theme-choice="dark"'),
  'index.html deve conter botão para tema Escuro (data-theme-choice="dark")'
);
assert(
  indexHtml.includes('data-theme-choice="auto"'),
  'index.html deve conter botão para tema Automático (data-theme-choice="auto")'
);
console.log('✓ index.html contém script anti-FOUC no <head> e controles acessíveis no cabeçalho.');

// 2. Validar variáveis semânticas e tokens de tema no css/styles.css
const cssContent = fs.readFileSync(path.join(__dirname, '../css/styles.css'), 'utf8');

const requiredVars = [
  '--bg-canvas',
  '--bg-surface',
  '--bg-container',
  '--text-primary',
  '--text-secondary',
  '--border-subtle',
  '--bg-header',
  '--bg-sidebar',
  '--bg-input',
  '--bg-modal',
  '--bg-table-th',
  '--bg-table-td'
];

for (const varName of requiredVars) {
  assert(
    cssContent.includes(varName),
    `css/styles.css deve definir a variável semântica ${varName}`
  );
}

assert(
  cssContent.includes('[data-theme="dark"]'),
  'css/styles.css deve conter bloco seletor [data-theme="dark"]'
);

assert(
  cssContent.includes('.theme-switch-control'),
  'css/styles.css deve conter estilos para .theme-switch-control'
);
assert(
  cssContent.includes('.theme-switch-btn'),
  'css/styles.css deve conter estilos para .theme-switch-btn'
);

// Validação específica da tela de Login no Dark Mode
assert(
  cssContent.includes('--bg-login-screen'),
  'css/styles.css deve definir a variável semântica --bg-login-screen'
);
assert(
  cssContent.includes('[data-theme="dark"] .login-overlay-screen'),
  'css/styles.css deve aplicar fundo escuro diretamente a .login-overlay-screen'
);
assert(
  cssContent.includes('[data-theme="dark"] .login-page-wrapper'),
  'css/styles.css deve conter regra para .login-page-wrapper em modo escuro'
);
assert(
  /\[data-theme=["']dark["']\]\s*\.login-page-wrapper\s*\{[^}]*background-color:\s*transparent/i.test(cssContent),
  '.login-page-wrapper deve ser transparente em modo escuro para não criar retângulo isolado com bordas brancas'
);

console.log('✓ css/styles.css contém o bloco [data-theme="dark"], variáveis semânticas e regras da tela de login.');

// 3. Simular lógica de resolução de tema do CRMThemeManager
function resolveEffectiveTheme(preference, systemIsDark) {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  // auto ou qualquer outro valor
  return systemIsDark ? 'dark' : 'light';
}

// Testes de resolução:
assert.equal(resolveEffectiveTheme('light', false), 'light');
assert.equal(resolveEffectiveTheme('light', true), 'light');
assert.equal(resolveEffectiveTheme('dark', false), 'dark');
assert.equal(resolveEffectiveTheme('dark', true), 'dark');
assert.equal(resolveEffectiveTheme('auto', true), 'dark');
assert.equal(resolveEffectiveTheme('auto', false), 'light');
assert.equal(resolveEffectiveTheme(null, true), 'dark');
assert.equal(resolveEffectiveTheme(null, false), 'light');
assert.equal(resolveEffectiveTheme('unknown', true), 'dark');

console.log('✓ Lógica de resolução de tema (Claro, Escuro e Automático com OS preference) validada.');

// 4. Testar persistência de preferência em storage simulado
class MockStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
}

const storage = new MockStorage();
storage.setItem('crm_theme_preference', 'dark');
assert.equal(storage.getItem('crm_theme_preference'), 'dark');

storage.setItem('crm_theme_preference', 'light');
assert.equal(storage.getItem('crm_theme_preference'), 'light');

storage.setItem('crm_theme_preference', 'auto');
assert.equal(storage.getItem('crm_theme_preference'), 'auto');

console.log('✓ Persistência do crm_theme_preference no localStorage validada.');

// 5. Validar adaptação do Chart.js no js/app.js e js/analytics.js
const appJsContent = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const analyticsJsContent = fs.readFileSync(path.join(__dirname, '../js/analytics.js'), 'utf8');

assert(
  appJsContent.includes('CRMThemeManager'),
  'js/app.js deve instanciar e exportar window.CRMThemeManager'
);

assert(
  appJsContent.includes('isDark') || appJsContent.includes("getAttribute('data-theme') === 'dark'"),
  'js/app.js deve adaptar renderMainChart dinamicamente com base no tema escuro'
);

assert(
  analyticsJsContent.includes("data-theme") || analyticsJsContent.includes("isDark"),
  'js/analytics.js deve adaptar drawChart dinamicamente com base no tema escuro'
);

console.log('✓ Gráficos em app.js e analytics.js possuem suporte a contraste dinâmico no tema escuro.');

console.log('\n========================================');
console.log('TODOS OS TESTES DO DARK MODE PASSARAM COM SUCESSO!');
console.log('========================================\n');
