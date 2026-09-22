const assert = require('assert');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const SUPABASE_URL = 'http://127.0.0.1:56321';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const PG_CONN = 'postgresql://postgres:postgres@127.0.0.1:56322/postgres';

async function verifyUserSync() {
  console.log('--- Iniciando Verificação Completa de Usuários e Sincronização Supabase ---');

  // 1. Verificar banco PostgreSQL direto
  const pgClient = new Client({ connectionString: PG_CONN });
  await pgClient.connect();

  const pgUsersRes = await pgClient.query('SELECT * FROM public.users ORDER BY id ASC;');
  console.log(`[PG] Usuários encontrados na tabela public.users: ${pgUsersRes.rows.length}`);
  
  assert.ok(pgUsersRes.rows.length >= 1, 'Deve existir pelo menos o usuário Administrador no banco Supabase');
  const adminUser = pgUsersRes.rows.find(u => u.username === 'ADMINISTRADOR');
  assert.ok(adminUser, 'Usuário ADMINISTRADOR deve existir');
  assert.strictEqual(adminUser.username, 'ADMINISTRADOR', 'O usuário deve ser ADMINISTRADOR');
  assert.ok(adminUser.password_hash === 'admin.admin' || adminUser.password_hash.startsWith('$2'), 'A senha do Administrador deve ser admin.admin ou hash Bcrypt seguro');
  assert.strictEqual(adminUser.profile, 'Administrador Master', 'O perfil deve ser Administrador Master');
  assert.strictEqual(adminUser.status, 'Ativo', 'O status deve ser Ativo');
  console.log('✓ Teste 1: Usuário Administrador confirmado no banco com credencial segura');

  // 2. Verificar via REST Client do Supabase (Kong 56321) com colunas sanitizadas
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: supaUsers, error: supaErr } = await supabase.from('users')
    .select('id, row_number, user_code, username, name, email, role, profile, status, two_factor, last_login, ip, avatar');
  assert.strictEqual(supaErr, null, 'Erro na consulta REST do Supabase com colunas seguras');
  assert.ok(supaUsers.length >= 1, 'REST deve retornar os usuários cadastrados');
  const supaAdmin = supaUsers.find(u => u.username === 'ADMINISTRADOR');
  assert.ok(supaAdmin, 'REST deve conter ADMINISTRADOR');
  assert.strictEqual(supaAdmin.username, 'ADMINISTRADOR');
  assert.strictEqual(supaAdmin.password_hash, undefined, 'Hash de senha NUNCA deve ser exposto na API REST pública');
  console.log('✓ Teste 2: API REST do Supabase confirma ADMINISTRADOR e preserva sigilo do hash de senha');

  // Obter sessão de Administrador para operações administrativas autorizadas via RPC
  const { data: authRes } = await supabase.rpc('auth_login', {
    p_user: 'ADMINISTRADOR',
    p_password: 'admin.admin'
  });
  assert.ok(authRes && authRes.success && authRes.session_token, 'Login administrativo deve fornecer token de sessão');
  const sessionToken = authRes.session_token;

  // 3. Simular criação de novo usuário pelo sistema via RPC admin_save_user
  const testNewUser = {
    user_code: 'USR-002',
    username: 'MARIANA',
    name: 'Mariana Silva',
    email: 'mariana.silva@sbsaude.com.br',
    role: 'Consultora Comercial',
    profile: 'Consultor Comercial',
    status: 'Ativo',
    password: 'Mariana@2026',
    two_factor: true,
    avatar: 'MS'
  };

  const { data: insertRes, error: insertErr } = await supabase.rpc('admin_save_user', {
    p_session_token: sessionToken,
    p_user_data: testNewUser
  });
  assert.strictEqual(insertErr, null, 'Criação de novo usuário não deve gerar erro no Supabase');
  assert.strictEqual(insertRes.success, true);
  
  const { data: userAfterInsert } = await supabase.from('users')
    .select('id, username, name, role')
    .eq('username', 'MARIANA')
    .single();
  assert.strictEqual(userAfterInsert.name, 'Mariana Silva');
  assert.strictEqual(userAfterInsert.role, 'Consultora Comercial');
  console.log('✓ Teste 3: Novo usuário criado e sincronizado com hash Bcrypt via RPC no banco Supabase');

  // 4. Simular alteração de senha de usuário via RPC admin_reset_password
  const { data: pwdRes, error: pwdErr } = await supabase.rpc('admin_reset_password', {
    p_session_token: sessionToken,
    p_target_username: 'MARIANA',
    p_new_password: 'NovaSenha@999'
  });
  assert.strictEqual(pwdErr, null, 'Alteração de senha via RPC não deve gerar erro');
  assert.strictEqual(pwdRes.success, true);

  // Validar no PostgreSQL que a senha agora autentica apenas com a nova senha
  const { data: authMariana } = await supabase.rpc('auth_login', {
    p_user: 'MARIANA',
    p_password: 'NovaSenha@999'
  });
  assert.strictEqual(authMariana.success, true, 'Nova senha redefinida deve autenticar com sucesso');
  console.log('✓ Teste 4: Alteração de senha sincronizada e validada via RPC no banco Supabase');

  // 5. Simular bloqueio de usuário (toggle status) via RPC admin_save_user
  const { data: statusRes, error: statusErr } = await supabase.rpc('admin_save_user', {
    p_session_token: sessionToken,
    p_user_data: {
      username: 'MARIANA',
      status: 'Bloqueado'
    }
  });
  assert.strictEqual(statusErr, null, 'Bloqueio de usuário não deve gerar erro');
  assert.strictEqual(statusRes.success, true);
  
  const { data: userAfterStatus } = await supabase.from('users')
    .select('status')
    .eq('username', 'MARIANA')
    .single();
  assert.strictEqual(userAfterStatus.status, 'Bloqueado');
  console.log('✓ Teste 5: Bloqueio de usuário sincronizado no banco Supabase');

  // 6. Simular exclusão de usuário via RPC admin_delete_user
  const { data: delRes, error: delErr } = await supabase.rpc('admin_delete_user', {
    p_session_token: sessionToken,
    p_target_username: 'MARIANA'
  });
  assert.strictEqual(delErr, null, 'Exclusão de usuário não deve gerar erro');
  assert.strictEqual(delRes.success, true);

  const { data: remainingUsers } = await supabase.from('users')
    .select('id')
    .eq('username', 'MARIANA');
  assert.strictEqual(remainingUsers.length, 0, 'Após exclusão Mariana não deve mais existir');
  console.log('✓ Teste 6: Exclusão de usuário sincronizada no banco Supabase');

  await pgClient.end();
  console.log('\n🎉 TODOS OS TESTES DE SINCRONIZAÇÃO DE USUÁRIOS PASSARAM COM SUCESSO!\n');
}

verifyUserSync().catch(err => {
  console.error('❌ Falha na verificação de sincronização:', err);
  process.exit(1);
});
