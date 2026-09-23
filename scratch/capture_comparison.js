const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artDir = 'C:\\Users\\usuario\\.gemini\\antigravity-ide\\brain\\4d21453a-718f-4f05-b139-f51ba4c81b19';

// 1. Criar harness que carrega tela de Empresas autenticada
const companiesHarness = path.join(__dirname, 'companies_runner.html');
const companiesHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="/css/styles.css">
  <script>
    localStorage.setItem('crm_auth_session', JSON.stringify({
      login: 'ADMINISTRADOR',
      name: 'Administrador Master',
      profile: 'Administrador Master',
      role: 'Administrador Master'
    }));
    localStorage.setItem('crm_active_user', 'ADMINISTRADOR');
    window.location.hash = '#companies';
  </script>
  <script src="/js/campanhas_data.js"></script>
  <script src="/js/database.js"></script>
  <script src="/js/business-rules.js"></script>
  <script src="/js/reports-engine.js"></script>
  <script src="/js/supabase-client.js"></script>
</head>
<body>
  <div class="app-container">
    <aside class="sidebar" id="main-sidebar">
      <div class="sidebar-header">
        <div class="brand-container">
          <div class="logo-mark"><span class="logo-cross">+</span></div>
          <div class="brand-text">
            <span class="brand-name">SB Saúde</span>
            <span class="brand-sub">Comercial</span>
          </div>
        </div>
      </div>
      <nav class="sidebar-nav">
        <a class="nav-item active" data-tab="companies">
          <span class="nav-label">Empresas</span>
        </a>
      </nav>
    </aside>
    <main class="main-content">
      <header class="top-header">
        <div class="theme-switch-control">
          <button type="button" class="theme-switch-btn" data-theme-choice="light">Claro</button>
        </div>
      </header>
      <section class="page-container" id="view-content"></section>
    </main>
  </div>
  <script src="/js/app.js"></script>
</body>
</html>`;
fs.writeFileSync(companiesHarness, companiesHtml, 'utf8');

// Capturar tela de Empresas em 1920x1080
const shotCompanies = path.join(__dirname, '../screenshots/companies_1920x1080.png');
const cmd1 = `"${chromePath}" --headless=new --disable-gpu --virtual-time-budget=3500 --window-size=1920,1080 --screenshot="${shotCompanies}" "http://localhost:8080/scratch/companies_runner.html"`;
execSync(cmd1);
console.log('✓ Capturado companies_1920x1080.png');

// Copiar todos os screenshots relevantes para o diretório de artefatos
const files = fs.readdirSync(path.join(__dirname, '../screenshots')).filter(f => f.endsWith('.png'));
files.forEach(f => {
  const src = path.join(__dirname, '../screenshots', f);
  const dest = path.join(artDir, f);
  fs.copyFileSync(src, dest);
  console.log('Copied ' + f + ' to artifacts dir');
});
