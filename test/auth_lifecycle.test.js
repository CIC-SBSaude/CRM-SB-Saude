/**
 * CRM SB Saúde — Teste Automatizado do Ciclo de Vida de Autenticação (Login & Logoff)
 * 
 * Validações:
 * 1. Inicialização limpa da tela de login (campos vazios, botão habilitado, texto "Entrar no Sistema").
 * 2. Fluxo de login bem-sucedido com descarte imediato da senha do DOM e restauração do botão.
 * 3. Fluxo de logoff (resolução do defeito):
 *    - Limpeza estrita de identificador e senha no DOM.
 *    - Garantia de type="password" e ícone fechado.
 *    - Botão habilitado com texto "Entrar no Sistema" (SEM spinner ⏳ e SEM "Autenticando...").
 *    - Remoção de crm_auth_session e crm_active_user em localStorage e sessionStorage.
 * 4. Inatividade pós-logoff: ausência de submissão automática ou requisições espúrias.
 * 5. Tentativa com credenciais inválidas: exibição de alerta e retorno ao estado habilitado.
 * 6. Proteção contra concorrência assíncrona e respostas atrasadas pós-logoff.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

console.log('--- Iniciando Testes de Ciclo de Vida de Login e Logoff (CRM SB Saúde) ---');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
assert(fs.existsSync(chromePath), 'Google Chrome deve estar instalado para execução dos testes automatizados');

const harnessPath = path.join(__dirname, 'temp_auth_harness.html');

const harnessHtml = `<!DOCTYPE html>
<html lang="pt-BR" data-theme="light">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="../css/styles.css">
  <script src="../js/campanhas_data.js"></script>
  <script src="../js/database.js"></script>
  <script src="../js/supabase.js"></script>
  <script src="../js/supabase-client.js"></script>
  <script src="../js/business-rules.js"></script>
  <script src="../js/reports-engine.js"></script>
</head>
<body>
  <!-- Container da Aplicação -->
  <div class="app-container" style="display:none;">
    <header class="top-header">
      <div id="header-user-avatar">AD</div>
      <div id="header-user-name">Administrador</div>
      <div id="header-user-role">Administrador Master</div>
      <button type="button" id="btn-logout">Sair</button>
      <select id="user-switch" style="display:none;"></select>
    </header>
    <main>
      <div id="view-content"></div>
    </main>
  </div>

  <!-- Tela de Login Overlay -->
  <div class="login-overlay-screen" id="login-screen" style="display:flex;">
    <div class="login-page-wrapper">
      <div class="login-main-container">
        <form id="form-login" autocomplete="off">
          <input type="text" id="inp-login-identifier" class="auth-input-field" placeholder="Usuário" required>
          <input type="password" id="inp-login-password" class="auth-input-field" placeholder="Senha" required>
          <button type="button" id="btn-toggle-login-pwd">
            <svg id="pwd-icon-eye"></svg>
          </button>
          <div class="login-alert-error" id="login-alert-error" style="display:none;">
            <span id="login-error-text"></span>
          </div>
          <button type="submit" id="btn-submit-login">
            <span>Entrar no Sistema</span>
          </button>
          <a href="#" id="link-forgot-password">Esqueci minha senha</a>
        </form>
      </div>
    </div>
  </div>

  <div id="toast-container"></div>

  <script src="../js/app.js"></script>

  <script>
    async function runAuthTestSuite() {
      const suiteResults = {};

      try {
        // Garante storages limpos para o teste
        localStorage.clear();
        sessionStorage.clear();

        const form = document.getElementById('form-login');
        const inpId = document.getElementById('inp-login-identifier');
        const inpPwd = document.getElementById('inp-login-password');
        const btnSubmit = document.getElementById('btn-submit-login');
        const alertError = document.getElementById('login-alert-error');
        const errorText = document.getElementById('login-error-text');
        const appContainer = document.querySelector('.app-container');
        const loginScreen = document.getElementById('login-screen');
        const btnLogout = document.getElementById('btn-logout');

        // ============================================================
        // TESTE 1: Estado Inicial sem Sessão
        // ============================================================
        suiteResults.initial = {
          loginScreenDisplay: window.getComputedStyle(loginScreen).display,
          appContainerDisplay: window.getComputedStyle(appContainer).display,
          identifierValue: inpId.value,
          passwordValue: inpPwd.value,
          passwordType: inpPwd.type,
          btnDisabled: btnSubmit.disabled,
          btnText: btnSubmit.innerHTML.trim(),
          alertVisible: alertError.style.display !== 'none',
          authState: window.CRMAuthManager.getAuthState(),
          sessionStored: localStorage.getItem('crm_auth_session')
        };

        // ============================================================
        // TESTE 2: Login com Credenciais Válidas
        // ============================================================
        inpId.value = 'ADMINISTRADOR';
        inpPwd.value = 'admin.admin';

        // Dispara submissão
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        // Aguarda transição da autenticação
        await new Promise(r => setTimeout(r, 600));

        suiteResults.afterLogin = {
          loginScreenDisplay: loginScreen.style.display,
          appContainerDisplay: appContainer.style.display,
          passwordValue: inpPwd.value,
          btnDisabled: btnSubmit.disabled,
          btnText: btnSubmit.innerHTML.trim(),
          authState: window.CRMAuthManager.getAuthState(),
          sessionStored: !!localStorage.getItem('crm_auth_session'),
          activeUser: localStorage.getItem('crm_active_user')
        };

        // ============================================================
        // TESTE 3: Logoff e Retorno da Tela de Login (Resolução do Defeito)
        // ============================================================
        await window.CRMAuthManager.handleLogout();
        await new Promise(r => setTimeout(r, 200));

        suiteResults.afterLogout = {
          loginScreenDisplay: loginScreen.style.display,
          appContainerDisplay: appContainer.style.display,
          identifierValue: inpId.value,
          passwordValue: inpPwd.value,
          passwordType: inpPwd.type,
          btnDisabled: btnSubmit.disabled,
          btnHtml: btnSubmit.innerHTML.trim(),
          btnText: btnSubmit.textContent.trim(),
          hasSpinner: btnSubmit.innerHTML.includes('⏳') || btnSubmit.innerHTML.includes('Autenticando'),
          alertVisible: alertError.style.display !== 'none',
          authState: window.CRMAuthManager.getAuthState(),
          sessionLocal: localStorage.getItem('crm_auth_session'),
          sessionSession: sessionStorage.getItem('crm_auth_session'),
          activeUserLocal: localStorage.getItem('crm_active_user')
        };

        // ============================================================
        // TESTE 4: Inatividade pós-logoff (Nenhum envio automático)
        // ============================================================
        const attemptBeforeWait = window.CRMAuthManager.getCurrentAttemptId();
        await new Promise(r => setTimeout(r, 500));
        const attemptAfterWait = window.CRMAuthManager.getCurrentAttemptId();

        suiteResults.idleAfterLogout = {
          sameAttemptId: attemptBeforeWait === attemptAfterWait,
          authState: window.CRMAuthManager.getAuthState(),
          sessionRecreated: !!localStorage.getItem('crm_auth_session'),
          btnStillEnabled: !btnSubmit.disabled
        };

        // ============================================================
        // TESTE 5: Login com Credenciais Inválidas
        // ============================================================
        inpId.value = 'usuario.inexistente';
        inpPwd.value = 'senhaErrada123';
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        await new Promise(r => setTimeout(r, 400));

        suiteResults.invalidLogin = {
          alertVisible: alertError.style.display !== 'none',
          errorMsg: errorText.textContent,
          btnDisabled: btnSubmit.disabled,
          btnHasSpinner: btnSubmit.innerHTML.includes('⏳'),
          btnText: btnSubmit.textContent.trim(),
          authState: window.CRMAuthManager.getAuthState()
        };

        // ============================================================
        // TESTE 6: Proteção contra Respostas Remotas Atrasadas e Logoff Rápido
        // ============================================================
        // Inicia login e simula logout imediato enquanto request está pendente
        inpId.value = 'ADMINISTRADOR';
        inpPwd.value = 'admin.admin';
        
        // Dispara submissão
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        // Logoff imediato durante a autenticação
        window.CRMAuthManager.handleLogout();

        await new Promise(r => setTimeout(r, 600));

        suiteResults.raceConditionProtection = {
          loginScreenDisplay: loginScreen.style.display,
          appContainerDisplay: appContainer.style.display,
          authState: window.CRMAuthManager.getAuthState(),
          sessionExists: !!localStorage.getItem('crm_auth_session'),
          btnDisabled: btnSubmit.disabled,
          btnText: btnSubmit.textContent.trim()
        };

        document.body.setAttribute('data-test-status', 'success');
        document.body.setAttribute('data-test-payload', JSON.stringify(suiteResults));
      } catch (err) {
        document.body.setAttribute('data-test-status', 'error');
        document.body.setAttribute('data-test-payload', JSON.stringify({ error: err.message, stack: err.stack }));
      }
    }

    window.addEventListener('DOMContentLoaded', () => {
      runAuthTestSuite();
    });
  </script>
</body>
</html>`;

fs.writeFileSync(harnessPath, harnessHtml, 'utf8');

try {
  const targetUrl = 'file:///' + harnessPath.replace(/\\/g, '/');
  const cmd = `"${chromePath}" --headless=new --disable-gpu --virtual-time-budget=4000 --window-size=1440,900 --dump-dom "${targetUrl}"`;

  const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const statusMatch = output.match(/data-test-status="([^"]+)"/);
  const payloadMatch = output.match(/data-test-payload="([^"]+)"/);

  assert(statusMatch, 'O Chrome deve finalizar a execução dos testes');
  assert.strictEqual(statusMatch[1], 'success', 'Os testes no navegador devem relatar sucesso');

  const unescapedPayload = payloadMatch[1].replace(/&quot;/g, '"');
  const res = JSON.parse(unescapedPayload);

  // 1. Asserções do Teste 1: Estado Inicial
  assert.strictEqual(res.initial.loginScreenDisplay, 'flex', 'Tela de login deve estar visível');
  assert.strictEqual(res.initial.appContainerDisplay, 'none', 'App container deve estar oculto');
  assert.strictEqual(res.initial.identifierValue, '', 'Identificador inicial deve estar vazio');
  assert.strictEqual(res.initial.passwordValue, '', 'Senha inicial deve estar vazia');
  assert.strictEqual(res.initial.btnDisabled, false, 'Botão inicial deve estar habilitado');
  assert(res.initial.btnText.includes('Entrar no Sistema'), 'Botão inicial deve exibir "Entrar no Sistema"');
  assert.strictEqual(res.initial.authState, 'unauthenticated');
  console.log('✓ Teste 1: Inicialização sem sessão confirmada (DOM limpo e botão pronto).');

  // 2. Asserções do Teste 2: Login com Sucesso
  assert.strictEqual(res.afterLogin.loginScreenDisplay, 'none', 'Tela de login deve ser ocultada após login');
  assert.strictEqual(res.afterLogin.appContainerDisplay, 'flex', 'App container deve ser exibido após login');
  assert.strictEqual(res.afterLogin.passwordValue, '', 'Senha deve ser imediatamente descartada do DOM após login');
  assert.strictEqual(res.afterLogin.btnDisabled, false, 'Botão de login deve retornar a habilitado');
  assert(res.afterLogin.btnText.includes('Entrar no Sistema'), 'Botão deve conter texto estável "Entrar no Sistema"');
  assert.strictEqual(res.afterLogin.authState, 'authenticated');
  assert.strictEqual(res.afterLogin.sessionStored, true, 'Sessão deve estar gravada');
  console.log('✓ Teste 2: Login bem-sucedido validado (transição de tela e senha descartada do DOM).');

  // 3. Asserções do Teste 3: Logoff (O defeito relatado)
  assert.strictEqual(res.afterLogout.loginScreenDisplay, 'flex', 'Tela de login deve reaparecer após logoff');
  assert.strictEqual(res.afterLogout.appContainerDisplay, 'none', 'App container deve ser ocultado após logoff');
  assert.strictEqual(res.afterLogout.identifierValue, '', 'Campo de identificador DEVE estar vazio após logoff');
  assert.strictEqual(res.afterLogout.passwordValue, '', 'Campo de senha DEVE estar vazio após logoff');
  assert.strictEqual(res.afterLogout.passwordType, 'password', 'Campo de senha deve estar como type="password"');
  assert.strictEqual(res.afterLogout.btnDisabled, false, 'Botão de login DEVE estar habilitado após logoff');
  assert.strictEqual(res.afterLogout.hasSpinner, false, 'Botão NÃO deve conter spinner ⏳ nem "Autenticando..." após logoff');
  assert.strictEqual(res.afterLogout.btnText, 'Entrar no Sistema', 'Botão DEVE exibir texto "Entrar no Sistema"');
  assert.strictEqual(res.afterLogout.alertVisible, false, 'Alerta de erro deve estar oculto após logoff');
  assert.strictEqual(res.afterLogout.sessionLocal, null, 'crm_auth_session deve ser removido do localStorage');
  assert.strictEqual(res.afterLogout.sessionSession, null, 'crm_auth_session deve ser removido do sessionStorage');
  assert.strictEqual(res.afterLogout.activeUserLocal, null, 'crm_active_user deve ser removido do localStorage');
  assert.strictEqual(res.afterLogout.authState, 'unauthenticated');
  console.log('✓ Teste 3: Logoff seguro certificado (campos vazios, botão habilitado sem spinner, storages limpos).');

  // 4. Asserções do Teste 4: Inatividade pós-logoff
  assert.strictEqual(res.idleAfterLogout.sameAttemptId, true, 'Nenhuma tentativa disparada por inatividade');
  assert.strictEqual(res.idleAfterLogout.sessionRecreated, false, 'Nenhuma sessão recriada em inatividade');
  assert.strictEqual(res.idleAfterLogout.btnStillEnabled, true, 'Botão permanece habilitado');
  console.log('✓ Teste 4: Inatividade na tela de login certificada (zero requisições ou submits espúrios).');

  // 5. Asserções do Teste 5: Credenciais Inválidas
  assert.strictEqual(res.invalidLogin.alertVisible, true, 'Alerta de erro deve ser exibido');
  assert.ok(
    res.invalidLogin.errorMsg.includes('Credenciais incorretas') || res.invalidLogin.errorMsg.includes('Usuário não encontrado'),
    'Mensagem de erro de credenciais deve ser exibida ao usuário'
  );
  assert.strictEqual(res.invalidLogin.btnDisabled, false, 'Botão deve voltar a habilitado após falha');
  assert.strictEqual(res.invalidLogin.btnHasSpinner, false, 'Spinner deve ser encerrado após falha');
  assert.strictEqual(res.invalidLogin.btnText, 'Entrar no Sistema', 'Texto deve retornar a "Entrar no Sistema"');
  assert.strictEqual(res.invalidLogin.authState, 'unauthenticated');
  console.log('✓ Teste 5: Falha de autenticação tratada (spinner encerrado, botão utilizável para retry).');

  // 6. Asserções do Teste 6: Corrida Assíncrona e Logoff Rápido
  assert.strictEqual(res.raceConditionProtection.loginScreenDisplay, 'flex', 'Tela de login deve permanecer aberta');
  assert.strictEqual(res.raceConditionProtection.appContainerDisplay, 'none', 'App container deve permanecer fechado');
  assert.strictEqual(res.raceConditionProtection.sessionExists, false, 'Resposta atrasada NÃO deve criar sessão');
  assert.strictEqual(res.raceConditionProtection.btnDisabled, false, 'Botão deve estar habilitado');
  assert.strictEqual(res.raceConditionProtection.btnText, 'Entrar no Sistema');
  console.log('✓ Teste 6: Proteção contra concorrência assíncrona validada (respostas tardias descartadas).');

  console.log('\n================================================================');
  console.log('🎉 TODOS OS TESTES DO CICLO DE VIDA DE LOGIN/LOGOFF PASSARAM COM 100%!');
  console.log('================================================================\n');
} finally {
  if (fs.existsSync(harnessPath)) {
    try { fs.unlinkSync(harnessPath); } catch (e) {}
  }
}
