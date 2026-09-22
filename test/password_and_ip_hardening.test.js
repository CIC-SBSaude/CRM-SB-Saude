const assert = require('assert');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const SUPABASE_URL = 'http://127.0.0.1:56321';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const PG_CONN = 'postgresql://postgres:postgres@127.0.0.1:56322/postgres';

async function runHardeningTests() {
  console.log('========================================================================');
  console.log('--- INICIANDO TESTES DE SEGURANÇA: SENHAS, RLS, RPCS E IP DE ACESSO ---');
  console.log('========================================================================\n');

  const pgClient = new Client({ connectionString: PG_CONN });
  await pgClient.connect();
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // 1. Obter sessão de Administrador Master via auth_login
  console.log('1. Autenticando Administrador Master via auth_login...');
  const { data: adminAuth, error: adminAuthErr } = await supabase.rpc('auth_login', {
    p_user: 'ADMINISTRADOR',
    p_password: 'admin.admin'
  });
  assert.strictEqual(adminAuthErr, null, 'Login do Administrador não deve gerar erro');
  assert.strictEqual(adminAuth.success, true, 'Login do Administrador deve retornar success = true');
  assert.ok(adminAuth.session_token, 'Login deve retornar session_token seguro');
  const adminToken = adminAuth.session_token;
  console.log('✓ Login administrativo autorizado. Token de sessão gerado com sucesso.');

  // 2. Criar usuário de teste através da RPC protegida admin_save_user
  const TEST_USER = 'TEST_SECURITY_USER';
  const PASSWORD_A = 'SenhaAntiga@2026';
  const PASSWORD_B = 'NovaSenhaForte#999';

  console.log('\n2. Criando usuário de teste via RPC admin_save_user...');
  const { data: createRes, error: createErr } = await supabase.rpc('admin_save_user', {
    p_session_token: adminToken,
    p_user_data: {
      username: TEST_USER,
      name: 'Usuário Teste Segurança',
      email: 'teste.seguranca@sbsaude.com.br',
      role: 'Consultor Comercial',
      profile: 'Consultor Comercial',
      status: 'Ativo',
      password: PASSWORD_A
    }
  });
  assert.strictEqual(createErr, null);
  assert.strictEqual(createRes.success, true);
  console.log('✓ Usuário de teste criado com hash Bcrypt no servidor.');

  // 3. Teste de Autenticação com Senha A
  console.log('\n3. Validando autenticação com a Senha A inicial...');
  const { data: loginA } = await supabase.rpc('auth_login', {
    p_user: TEST_USER,
    p_password: PASSWORD_A
  });
  assert.strictEqual(loginA.success, true, 'Autenticação com Senha A deve ser bem-sucedida');
  assert.ok(loginA.session_token, 'Login do usuário de teste deve gerar session_token');
  const userTokenBeforeReset = loginA.session_token;
  console.log('✓ Autenticação com Senha A confirmada com sucesso.');

  // 4. Redefinir senha de A para B via RPC admin_reset_password
  console.log('\n4. Executando redefinição autorizada para Senha B...');
  const { data: resetRes, error: resetErr } = await supabase.rpc('admin_reset_password', {
    p_session_token: adminToken,
    p_target_username: TEST_USER,
    p_new_password: PASSWORD_B
  });
  assert.strictEqual(resetErr, null);
  assert.strictEqual(resetRes.success, true);

  // Verificar hash no PostgreSQL direto
  const hashCheck = await pgClient.query('SELECT password_hash FROM public.users WHERE username = $1;', [TEST_USER]);
  const storedHashB = hashCheck.rows[0].password_hash;
  assert.ok(storedHashB.startsWith('$2'), 'Hash deve ser Bcrypt ($2a$ ou $2b$)');
  console.log('✓ Senha B redefinida com hash Bcrypt forte no PostgreSQL.');

  // 5. Verificar que a sessão anterior do usuário foi revogada
  const sessionCheck = await pgClient.query('SELECT is_revoked FROM public.user_sessions WHERE token = $1;', [userTokenBeforeReset]);
  assert.strictEqual(sessionCheck.rows[0].is_revoked, true, 'Sessão anterior deve ter sido revogada no reset de senha');
  console.log('✓ Revogação imediata de sessões anteriores certificada.');

  // 6. Teste de Aceite: Senha A DEVE FALHAR, Senha B DEVE PASSAR
  console.log('\n5. Validando credenciais pós-redefinição:');
  const { data: loginAFails } = await supabase.rpc('auth_login', {
    p_user: TEST_USER,
    p_password: PASSWORD_A
  });
  assert.strictEqual(loginAFails.success, false, 'Senha A deve ser estritamente rejeitada');
  assert.strictEqual(loginAFails.error_code, 'INVALID_PASSWORD');
  console.log('✓ Senha A rejeitada pelo servidor com INVALID_PASSWORD.');

  const { data: loginBPasses } = await supabase.rpc('auth_login', {
    p_user: TEST_USER,
    p_password: PASSWORD_B
  });
  assert.strictEqual(loginBPasses.success, true, 'Senha B deve autenticar com sucesso');
  console.log('✓ Senha B autenticada com sucesso pelo servidor.');

  // 7. Simular recargas, reconexões, sync manual e abertura de painel:
  // Garantir que NENHUMA dessas operações reverte a senha B
  console.log('\n6. Testando persistência contra reversão por sincronizações e recargas...');

  // 7.1 Leitura sem senha (como app.js faz)
  const { data: fetchedUsers } = await supabase.from('users')
    .select('id, row_number, user_code, username, name, email, role, profile, status, two_factor, last_login, ip, avatar, created_at, updated_at')
    .eq('username', TEST_USER);
  const userInMemory = fetchedUsers[0];
  assert.strictEqual(userInMemory.password, undefined, 'Leitura pública nunca deve conter campo password');
  assert.strictEqual(userInMemory.password_hash, undefined, 'Leitura pública nunca deve conter campo password_hash');

  // 7.2 Atualização de perfil via admin_save_user
  await supabase.rpc('admin_save_user', {
    p_session_token: adminToken,
    p_user_data: {
      username: TEST_USER,
      name: 'Nome Atualizado Pelo Admin',
      role: 'Consultor Sênior'
    }
  });

  // 7.3 Verificar se o hash da senha B permanece intacto após edição de perfil
  const hashCheckAfterSync = await pgClient.query('SELECT password_hash FROM public.users WHERE username = $1;', [TEST_USER]);
  assert.strictEqual(hashCheckAfterSync.rows[0].password_hash, storedHashB, 'O hash da Senha B NÃO DEVE ser alterado por edição de perfil ou sync');
  console.log('✓ Hash da Senha B permaneceu 100% íntegro após edições e sincronizações.');

  // 8. Teste de Segurança RLS / Permissões da API Pública (anon):
  console.log('\n7. Testando bloqueio estrito de acesso anônimo direto à tabela public.users:');

  // Tentativa de SELECT password_hash
  const { error: anonSelectErr } = await supabase.from('users').select('password_hash').limit(1);
  assert.ok(anonSelectErr, 'SELECT em password_hash deve ser bloqueado para anon');
  console.log('✓ SELECT em password_hash bloqueado com permissão negada:', anonSelectErr.message);

  // Tentativa de SELECT *
  const { error: anonStarErr } = await supabase.from('users').select('*').limit(1);
  assert.ok(anonStarErr, 'SELECT * em users deve ser bloqueado para anon');
  console.log('✓ SELECT * bloqueado para anon:', anonStarErr.message);

  // Tentativa de UPDATE direto na tabela users via anon key
  const { error: anonUpdateErr } = await supabase.from('users').update({ status: 'Inativo' }).eq('username', TEST_USER);
  assert.ok(anonUpdateErr, 'UPDATE direto na tabela users via chave pública deve ser bloqueado');
  console.log('✓ UPDATE direto bloqueado para anon:', anonUpdateErr.message);

  // Tentativa de DELETE direto na tabela users via anon key
  const { error: anonDeleteErr } = await supabase.from('users').delete().eq('username', TEST_USER);
  assert.ok(anonDeleteErr, 'DELETE direto na tabela users via chave pública deve ser bloqueado');
  console.log('✓ DELETE direto bloqueado para anon:', anonDeleteErr.message);

  // Tentativa de reset sem permissão de Administrador Master (usando token de consultor comum)
  const { data: forbiddenReset } = await supabase.rpc('admin_reset_password', {
    p_session_token: loginBPasses.session_token, // token do consultor de teste, não admin!
    p_target_username: 'ADMINISTRADOR',
    p_new_password: 'TentativaInvasiva@123'
  });
  assert.strictEqual(forbiddenReset.success, false);
  assert.strictEqual(forbiddenReset.error_code, 'FORBIDDEN', 'Consultor comum não pode resetar senhas');
  console.log('✓ Usuário sem perfil Administrador Master rejeitado com FORBIDDEN.');

  // 9. Teste de Auditoria e Sanitização de IP de Último Acesso
  console.log('\n8. Validando registro de evento de login e ausência de IPs sintéticos...');
  const loginEvent = await pgClient.query(`
    SELECT username, ip_address, ip_source, is_success
    FROM public.user_login_events
    WHERE username = $1
    ORDER BY id DESC
    LIMIT 1;
  `, [TEST_USER]);

  assert.ok(loginEvent.rows.length > 0, 'Evento de login deve estar gravado no servidor');
  const ev = loginEvent.rows[0];
  assert.strictEqual(ev.is_success, true);
  assert.ok(!ev.ip_address || !ev.ip_address.startsWith('192.168.10.'), 'Nenhum IP sintético 192.168.10.x deve ser gerado');
  console.log('✓ Evento auditável no servidor validado sem qualquer IP inventado:', ev);

  // Limpeza do usuário de teste
  await pgClient.query('DELETE FROM public.users WHERE username = $1;', [TEST_USER]);
  await pgClient.end();

  console.log('\n========================================================================');
  console.log('🎉 TODOS OS TESTES DE SEGURANÇA E PERSISTÊNCIA PASSARAM COM 100%!');
  console.log('========================================================================\n');
}

runHardeningTests().catch(err => {
  console.error('❌ Falha nos testes de hardening:', err);
  process.exit(1);
});
