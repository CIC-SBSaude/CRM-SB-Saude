const assert = require('assert');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const SUPABASE_URL = 'http://127.0.0.1:56321';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const PG_CONN = 'postgresql://postgres:postgres@127.0.0.1:56322/postgres';

async function runAuthPasswordValidationTests() {
  console.log('========================================================================');
  console.log('--- TESTES DE VALIDAÇÃO DE SENHA, PRESERVAÇÃO DE ESPAÇOS E FLUXO RPC ---');
  console.log('========================================================================\n');

  const pgClient = new Client({ connectionString: PG_CONN });
  await pgClient.connect();
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const TEST_USER = 'DISPOSABLE_AUTH_TEST';
  const TEST_EMAIL = 'disposable.auth@sbsaude.com.br';
  const PASSWORD_WITH_SPACES = '   Secret Pass with Spaces 2026!   ';
  const PASSWORD_RESET_TARGET = '  New Target Password 2026#  ';

  try {
    // 0. Limpeza preventiva de conta descartável anterior se existir
    await pgClient.query('DELETE FROM public.user_sessions WHERE username = $1;', [TEST_USER]);
    await pgClient.query('DELETE FROM public.users WHERE username = $1;', [TEST_USER]);

    // 1. Obter sessão de Administrador Master via auth_login
    console.log('1. Autenticando Administrador Master via auth_login...');
    const { data: adminAuth, error: adminAuthErr } = await supabase.rpc('auth_login', {
      p_user: 'ADMINISTRADOR',
      p_password: 'admin.admin'
    });
    assert.strictEqual(adminAuthErr, null, 'Login do Administrador não deve gerar erro');
    assert.strictEqual(adminAuth.success, true, 'Login do Administrador deve ter sucesso');
    assert.ok(adminAuth.session_token, 'Login do Administrador deve retornar session_token');
    const adminToken = adminAuth.session_token;
    console.log('✓ Sessão de Administrador Master obtida com sucesso.');

    // 2. Criar conta descartável com senha contendo espaços antes e depois
    console.log('\n2. Criando conta descartável com senha contendo espaços preservados...');
    const { data: createRes, error: createErr } = await supabase.rpc('admin_save_user', {
      p_session_token: adminToken,
      p_user_data: {
        username: TEST_USER,
        name: 'Usuário Descartável Teste Senha',
        email: TEST_EMAIL,
        role: 'Consultor Comercial',
        profile: 'Consultor Comercial',
        status: 'Ativo',
        password: PASSWORD_WITH_SPACES
      }
    });
    assert.strictEqual(createErr, null, 'admin_save_user não deve gerar erro');
    assert.strictEqual(createRes.success, true, 'Criação do usuário deve retornar sucesso');
    console.log('✓ Usuário descartável criado com sucesso.');

    // 3. Teste de login com senha exata (com espaços) vs senha com trim() cortado
    console.log('\n3. Validando preservação exata da senha (sem trim)...');
    
    // 3.1 Senha exata com espaços DEVE PASSAR
    const { data: exactLogin, error: exactErr } = await supabase.rpc('auth_login', {
      p_user: TEST_USER,
      p_password: PASSWORD_WITH_SPACES
    });
    assert.strictEqual(exactErr, null);
    assert.strictEqual(exactLogin.success, true, 'Login com espaços legítimos na senha DEVE passar');
    assert.ok(exactLogin.session_token, 'Login deve emitir session_token');
    const userSessionToken1 = exactLogin.session_token;
    console.log('✓ Login com espaços exatos preservados: SUCESSO.');

    // 3.2 Senha com .trim() cortado DEVE FALHAR com INVALID_PASSWORD
    const { data: trimmedLogin } = await supabase.rpc('auth_login', {
      p_user: TEST_USER,
      p_password: PASSWORD_WITH_SPACES.trim()
    });
    assert.strictEqual(trimmedLogin.success, false, 'Login com senha cortada por trim DEVE falhar');
    assert.strictEqual(trimmedLogin.error_code, 'INVALID_PASSWORD', 'Código retornado deve ser INVALID_PASSWORD');
    console.log('✓ Login com senha indevidamente cortada por trim: REJEITADO com INVALID_PASSWORD.');

    // 4. Teste de login por identificador (Username case-insensitive e Email)
    console.log('\n4. Testando login por username em minúsculas e por e-mail...');
    const { data: lowerUserLogin } = await supabase.rpc('auth_login', {
      p_user: 'disposable_auth_test',
      p_password: PASSWORD_WITH_SPACES
    });
    assert.strictEqual(lowerUserLogin.success, true, 'Username case-insensitive deve autenticar');

    const { data: emailLogin } = await supabase.rpc('auth_login', {
      p_user: TEST_EMAIL,
      p_password: PASSWORD_WITH_SPACES
    });
    assert.strictEqual(emailLogin.success, true, 'Autenticação via e-mail deve funcionar');
    console.log('✓ Autenticação por username normalizado e e-mail: SUCESSO.');

    // 5. Teste de separação estrita de códigos de erro
    console.log('\n5. Testando separação precisa de códigos de erro...');

    // 5.1 Credenciais vazias
    const { data: emptyLogin } = await supabase.rpc('auth_login', {
      p_user: '',
      p_password: ''
    });
    assert.strictEqual(emptyLogin.success, false);
    assert.strictEqual(emptyLogin.error_code, 'INVALID_CREDENTIALS');

    // 5.2 Usuário inexistente
    const { data: nonExistentLogin } = await supabase.rpc('auth_login', {
      p_user: 'NON_EXISTENT_USER_XYZ_999',
      p_password: 'AnyPassword123!'
    });
    assert.strictEqual(nonExistentLogin.success, false);
    assert.strictEqual(nonExistentLogin.error_code, 'USER_NOT_FOUND');

    // 5.3 Usuário inativo / bloqueado
    await pgClient.query('UPDATE public.users SET status = $1 WHERE username = $2;', ['Inativo', TEST_USER]);
    const { data: blockedLogin } = await supabase.rpc('auth_login', {
      p_user: TEST_USER,
      p_password: PASSWORD_WITH_SPACES
    });
    assert.strictEqual(blockedLogin.success, false);
    assert.strictEqual(blockedLogin.error_code, 'USER_BLOCKED');
    // Reativa o usuário para os próximos testes
    await pgClient.query('UPDATE public.users SET status = $1 WHERE username = $2;', ['Ativo', TEST_USER]);
    console.log('✓ Separação de códigos (INVALID_CREDENTIALS, USER_NOT_FOUND, USER_BLOCKED, INVALID_PASSWORD) confirmada.');

    // 6. Teste de redefinição de senha administrativa com preservação e revogação de sessão
    console.log('\n6. Testando redefinição administrativa via admin_reset_password...');
    const { data: resetRes, error: resetErr } = await supabase.rpc('admin_reset_password', {
      p_session_token: adminToken,
      p_target_username: TEST_USER,
      p_new_password: PASSWORD_RESET_TARGET
    });
    assert.strictEqual(resetErr, null);
    assert.strictEqual(resetRes.success, true, 'admin_reset_password deve ter sucesso');
    assert.strictEqual(resetRes.target_username, TEST_USER);
    assert.strictEqual(resetRes.sessions_revoked, true);
    assert.ok(resetRes.updated_at, 'admin_reset_password deve retornar updated_at');
    console.log('✓ Senha redefinida pelo administrador com metadados de confirmação.');

    // 6.1 A sessão anterior deve ter sido revogada
    const { rows: revokedSessions } = await pgClient.query(
      'SELECT is_revoked FROM public.user_sessions WHERE token = $1;',
      [userSessionToken1]
    );
    assert.strictEqual(revokedSessions.length, 1);
    assert.strictEqual(revokedSessions[0].is_revoked, true, 'Sessão anterior do usuário DEVE estar revogada');
    console.log('✓ Sessão anterior confirmada como revogada no banco.');

    // 6.2 Senha antiga DEVE FALHAR
    const { data: oldPwdLogin } = await supabase.rpc('auth_login', {
      p_user: TEST_USER,
      p_password: PASSWORD_WITH_SPACES
    });
    assert.strictEqual(oldPwdLogin.success, false);
    assert.strictEqual(oldPwdLogin.error_code, 'INVALID_PASSWORD');
    console.log('✓ Tentativa com senha antiga: REJEITADA com INVALID_PASSWORD.');

    // 6.3 Nova senha (com espaços preservados) DEVE PASSAR
    const { data: newPwdLogin } = await supabase.rpc('auth_login', {
      p_user: TEST_USER,
      p_password: PASSWORD_RESET_TARGET
    });
    assert.strictEqual(newPwdLogin.success, true, 'Nova senha redefinida deve autenticar');
    assert.ok(newPwdLogin.session_token);
    console.log('✓ Nova senha redefinida: AUTENTICADA com sucesso.');

    // 7. Edição de dados cadastrais NUNCA deve sobrescrever password_hash
    console.log('\n7. Testando integridade: edição de perfil não pode sobrescrever password_hash...');
    const { rows: beforeUpdate } = await pgClient.query(
      'SELECT password_hash FROM public.users WHERE username = $1;',
      [TEST_USER]
    );
    const hashBeforeProfileEdit = beforeUpdate[0].password_hash;

    // Atualiza nome e cargo via admin_save_user
    await supabase.rpc('admin_save_user', {
      p_session_token: adminToken,
      p_user_data: {
        username: TEST_USER,
        name: 'Nome Atualizado do Usuário',
        role: 'Supervisor Comercial'
      }
    });

    const { rows: afterUpdate } = await pgClient.query(
      'SELECT password_hash, name, role FROM public.users WHERE username = $1;',
      [TEST_USER]
    );
    assert.strictEqual(afterUpdate[0].password_hash, hashBeforeProfileEdit, 'password_hash NÃO pode ser alterado por edição de perfil');
    assert.strictEqual(afterUpdate[0].name, 'Nome Atualizado do Usuário');
    console.log('✓ Integridade confirmada: password_hash preservado intacto após edição de perfil.');

    // 8. Garantir que NENHUMA resposta RPC exponha hashes ou credenciais
    console.log('\n8. Testando ausência de vazamento de senhas ou hashes nas respostas RPC...');
    assert.strictEqual(newPwdLogin.user.password_hash, undefined, 'auth_login não deve expor password_hash');
    assert.strictEqual(newPwdLogin.user.password, undefined, 'auth_login não deve expor password');
    assert.strictEqual(resetRes.password_hash, undefined, 'admin_reset_password não deve expor password_hash');
    assert.strictEqual(resetRes.new_password, undefined, 'admin_reset_password não deve expor new_password');
    console.log('✓ Proteção confirmada: Zero exposição de hashes ou credenciais em payload.');

    // 9. Auditoria de eventos em user_login_events
    console.log('\n9. Verificando trilha de auditoria em user_login_events...');
    const { rows: auditEvents } = await pgClient.query(
      'SELECT username, is_success, failure_reason FROM public.user_login_events WHERE username = $1 ORDER BY id DESC LIMIT 5;',
      [TEST_USER]
    );
    assert.ok(auditEvents.length >= 2, 'Eventos de auditoria devem ter sido registrados');
    const hasSuccess = auditEvents.some(e => e.is_success === true);
    const hasInvalidPwd = auditEvents.some(e => e.is_success === false && e.failure_reason === 'INVALID_PASSWORD');
    assert.ok(hasSuccess, 'Deve conter registro de login com sucesso');
    assert.ok(hasInvalidPwd, 'Deve conter registro de falha INVALID_PASSWORD');
    // 10. Teste de Resolução Dinâmica de URL e Substituição de IP Obsoleto
    console.log('\n10. Testando Resolução Dinâmica de URL e Descarte de IP Obsoleto...');
    // Simula a lógica de getEffectiveSupabaseUrl
    function testUrlResolution(windowHostname, storedUrl) {
      function getDef(h) {
        if (h && h !== 'localhost' && h !== '127.0.0.1') return `http://${h}:56321`;
        return 'http://127.0.0.1:56321';
      }
      const defaultUrl = getDef(windowHostname);
      if (!storedUrl) return defaultUrl;
      const currentHost = windowHostname || '127.0.0.1';
      try {
        const parsed = new URL(storedUrl);
        const isLoopbackStored = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
        const isLoopbackCurrent = currentHost === 'localhost' || currentHost === '127.0.0.1';
        if ((isLoopbackStored && isLoopbackCurrent) || parsed.hostname === currentHost) {
          return storedUrl;
        }
        return defaultUrl;
      } catch (e) {
        return defaultUrl;
      }
    }

    // Caso A: Stale IP de outra rede (ex: 192.168.1.99) quando aberto em 127.0.0.1 -> deve descartar e usar 127.0.0.1
    assert.strictEqual(
      testUrlResolution('127.0.0.1', 'http://192.168.1.99:56321'),
      'http://127.0.0.1:56321',
      'Deve descartar IP obsoleto de outra rede'
    );

    // Caso B: Aberto via IP da LAN 192.168.91.103 com storedUrl 127.0.0.1 -> deve atualizar para o IP da LAN
    assert.strictEqual(
      testUrlResolution('192.168.91.103', 'http://127.0.0.1:56321'),
      'http://192.168.91.103:56321',
      'Deve resolver para o IP da máquina na rede'
    );

    // Caso C: Aberto via localhost com storedUrl 127.0.0.1 -> compatível, mantém loopback
    assert.strictEqual(
      testUrlResolution('localhost', 'http://127.0.0.1:56321'),
      'http://127.0.0.1:56321',
      'Loopback compatível deve ser aceito'
    );
    console.log('✓ Resolução dinâmica e descarte de IP obsoleto testados com sucesso.');

    console.log('\n========================================================================');
    console.log('✓ TODOS OS TESTES DE VALIDAÇÃO E FLUXO DE SENHA FORAM APROVADOS (100%)');
    console.log('========================================================================\n');
  } finally {
    // Limpeza da conta descartável
    try {
      await pgClient.query('DELETE FROM public.user_sessions WHERE username = $1;', [TEST_USER]);
      await pgClient.query('DELETE FROM public.user_login_events WHERE username = $1;', [TEST_USER]);
      await pgClient.query('DELETE FROM public.users WHERE username = $1;', [TEST_USER]);
    } catch (e) {}
    await pgClient.end();
  }
}

runAuthPasswordValidationTests().catch(err => {
  console.error('❌ Falha nos testes de autenticação:', err);
  process.exit(1);
});
