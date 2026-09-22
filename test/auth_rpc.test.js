const assert = require('assert');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const SUPABASE_URL = 'http://127.0.0.1:56321';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const PG_CONN = 'postgresql://postgres:postgres@127.0.0.1:56322/postgres';

async function testAuthRpc() {
  console.log('--- Iniciando Testes da Função RPC de Autenticação Segura (auth_login) ---');

  const pgClient = new Client({ connectionString: PG_CONN });
  await pgClient.connect();

  const procs = await pgClient.query("SELECT proname, pronamespace::regnamespace::text as ns FROM pg_proc WHERE proname IN ('crypt', 'gen_salt');");
  console.log('Funções encontradas:', procs.rows);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // 1. Teste via SQL Direto no PostgreSQL: Login com Administrador
  const res1 = await pgClient.query('SELECT public.auth_login($1, $2) AS payload;', ['ADMINISTRADOR', 'admin.admin']);
  const payload1 = res1.rows[0].payload;
  assert.strictEqual(payload1.success, true, 'Login do Administrador deve retornar success = true');
  assert.ok(payload1.user, 'Payload deve conter o objeto do usuário');
  assert.strictEqual(payload1.user.login, 'ADMINISTRADOR');
  assert.strictEqual(payload1.user.password_hash, undefined, 'Hash de senha NUNCA deve ser exposto no payload');
  console.log('✓ Teste 1: auth_login via PostgreSQL executado com sucesso e sem exposição de hash.');

  // 2. Verificar auto-migração para Bcrypt no PostgreSQL
  const checkHash = await pgClient.query('SELECT password_hash FROM public.users WHERE username = $1;', ['ADMINISTRADOR']);
  const storedHash = checkHash.rows[0].password_hash;
  assert.ok(storedHash.startsWith('$2'), 'Senha legada deve ser auto-migrada para hash Bcrypt ($2a$ ou $2b$)');
  console.log('✓ Teste 2: Auto-migração transparente para Bcrypt (pgcrypto) validada:', storedHash.substring(0, 10) + '...');

  // 3. Teste via RPC do Supabase REST API (Kong 56321) com hash Bcrypt ativo
  const { data: supaRpcData, error: supaRpcErr } = await supabase.rpc('auth_login', {
    p_user: 'ADMINISTRADOR',
    p_password: 'admin.admin'
  });
  assert.strictEqual(supaRpcErr, null, 'Chamada RPC do Supabase não deve gerar erro');
  assert.strictEqual(supaRpcData.success, true, 'RPC do Supabase deve autenticar com sucesso via Bcrypt');
  assert.strictEqual(supaRpcData.user.name, 'Administrador');
  console.log('✓ Teste 3: Chamada RPC via REST API do Supabase autenticada com sucesso.');

  // 4. Teste de login por E-mail institucional
  const { data: emailRpcData } = await supabase.rpc('auth_login', {
    p_user: 'administrador@sbsaude.com.br',
    p_password: 'admin.admin'
  });
  assert.strictEqual(emailRpcData.success, true, 'Login por e-mail deve autenticar com sucesso');
  assert.strictEqual(emailRpcData.user.login, 'ADMINISTRADOR');
  console.log('✓ Teste 4: Login flexível por e-mail corporativo autenticado com sucesso.');

  // 5. Teste de Senha Incorreta
  const { data: wrongPwdData } = await supabase.rpc('auth_login', {
    p_user: 'ADMINISTRADOR',
    p_password: 'senha_totalmente_errada'
  });
  assert.strictEqual(wrongPwdData.success, false);
  assert.strictEqual(wrongPwdData.error_code, 'INVALID_PASSWORD');
  assert.ok(wrongPwdData.message.includes('Senha incorreta'));
  console.log('✓ Teste 5: Rejeição segura de credencial incorreta confirmada.');

  // 6. Teste de Usuário Inexistente
  const { data: notFoundData } = await supabase.rpc('auth_login', {
    p_user: 'usuario_fantasma_xyz',
    p_password: 'qualquer_senha'
  });
  assert.strictEqual(notFoundData.success, false);
  assert.strictEqual(notFoundData.error_code, 'USER_NOT_FOUND');
  console.log('✓ Teste 6: Rejeição de usuário inexistente confirmada.');

  // 7. Teste de Usuário Bloqueado / Inativo
  const blockedUser = {
    username: 'TESTE_BLOQUEADO',
    name: 'Usuário Bloqueado Teste',
    email: 'bloqueado@sbsaude.com.br',
    role: 'Consultor',
    profile: 'Consultor Comercial',
    status: 'Bloqueado',
    password_hash: 'Bloqueado@2026'
  };
  await pgClient.query(`
    INSERT INTO public.users (username, name, email, role, profile, status, password_hash)
    VALUES ($1, $2, $3, $4, $5, $6, extensions.crypt($7, extensions.gen_salt('bf', 10)))
    ON CONFLICT (username) DO UPDATE SET status = 'Bloqueado';
  `, [blockedUser.username, blockedUser.name, blockedUser.email, blockedUser.role, blockedUser.profile, blockedUser.status, blockedUser.password_hash]);

  const { data: blockedRpcData } = await supabase.rpc('auth_login', {
    p_user: 'TESTE_BLOQUEADO',
    p_password: 'Bloqueado@2026'
  });
  assert.strictEqual(blockedRpcData.success, false);
  assert.strictEqual(blockedRpcData.error_code, 'USER_BLOCKED');
  assert.ok(blockedRpcData.message.includes('Acesso bloqueado'));

  // Limpeza do usuário bloqueado de teste via PostgreSQL administrativo
  await pgClient.query('DELETE FROM public.users WHERE username = $1;', ['TESTE_BLOQUEADO']);
  console.log('✓ Teste 7: Bloqueio de conta inativa/suspensa validado com sucesso.');

  await pgClient.end();

  console.log('\n================================================================');
  console.log('🎉 TODOS OS TESTES DA FUNÇÃO RPC AUTH_LOGIN PASSARAM COM 100%!');
  console.log('================================================================\n');
}

testAuthRpc().catch(err => {
  console.error('❌ Falha nos testes de auth_login:', err);
  process.exit(1);
});
