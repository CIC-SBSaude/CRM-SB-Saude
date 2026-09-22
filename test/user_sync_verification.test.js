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
  assert.strictEqual(adminUser.password_hash, 'admin.admin', 'A senha do Administrador deve ser admin.admin');
  assert.strictEqual(adminUser.profile, 'Administrador Master', 'O perfil deve ser Administrador Master');
  assert.strictEqual(adminUser.status, 'Ativo', 'O status deve ser Ativo');
  console.log('✓ Teste 1: Usuário Administrador confirmado no banco com senha admin.admin');

  // 2. Verificar via REST Client do Supabase (Kong 56321)
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: supaUsers, error: supaErr } = await supabase.from('users').select('*');
  assert.strictEqual(supaErr, null, 'Erro na consulta REST do Supabase');
  assert.ok(supaUsers.length >= 1, 'REST deve retornar os usuários cadastrados');
  const supaAdmin = supaUsers.find(u => u.username === 'ADMINISTRADOR');
  assert.ok(supaAdmin, 'REST deve conter ADMINISTRADOR');
  assert.strictEqual(supaAdmin.username, 'ADMINISTRADOR');
  assert.strictEqual(supaAdmin.password_hash, 'admin.admin');
  console.log('✓ Teste 2: API REST do Supabase confirma ADMINISTRADOR (admin.admin)');

  // 3. Simular criação de novo usuário pelo sistema (e.g. Consultora Mariana)
  const testNewUser = {
    user_code: 'USR-002',
    username: 'MARIANA',
    name: 'Mariana Silva',
    email: 'mariana.silva@sbsaude.com.br',
    role: 'Consultora Comercial',
    profile: 'Consultor Comercial',
    status: 'Ativo',
    password_hash: 'Mariana@2026',
    two_factor: true,
    last_login: 'Primeiro acesso pendente',
    ip: '192.168.10.45',
    avatar: 'MS',
    updated_at: new Date().toISOString()
  };

  const { error: insertErr } = await supabase.from('users').upsert(testNewUser, { onConflict: 'username' });
  assert.strictEqual(insertErr, null, 'Criação de novo usuário não deve gerar erro no Supabase');
  
  const { data: userAfterInsert } = await supabase.from('users').select('*').eq('username', 'MARIANA').single();
  assert.strictEqual(userAfterInsert.name, 'Mariana Silva');
  assert.strictEqual(userAfterInsert.role, 'Consultora Comercial');
  console.log('✓ Teste 3: Novo usuário criado e sincronizado imediatamente com o banco Supabase');

  // 4. Simular alteração de senha de usuário
  const { error: pwdErr } = await supabase.from('users').update({ password_hash: 'NovaSenha@999' }).eq('username', 'MARIANA');
  assert.strictEqual(pwdErr, null, 'Alteração de senha não deve gerar erro');
  const { data: userAfterPwd } = await supabase.from('users').select('password_hash').eq('username', 'MARIANA').single();
  assert.strictEqual(userAfterPwd.password_hash, 'NovaSenha@999');
  console.log('✓ Teste 4: Alteração de senha sincronizada no banco Supabase');

  // 5. Simular bloqueio de usuário (toggle status)
  const { error: statusErr } = await supabase.from('users').update({ status: 'Bloqueado' }).eq('username', 'MARIANA');
  assert.strictEqual(statusErr, null, 'Bloqueio de usuário não deve gerar erro');
  const { data: userAfterStatus } = await supabase.from('users').select('status').eq('username', 'MARIANA').single();
  assert.strictEqual(userAfterStatus.status, 'Bloqueado');
  console.log('✓ Teste 5: Bloqueio de usuário sincronizado no banco Supabase');

  // 6. Simular exclusão de usuário
  const { error: delErr } = await supabase.from('users').delete().eq('username', 'MARIANA');
  assert.strictEqual(delErr, null, 'Exclusão de usuário não deve gerar erro');
  const { data: remainingUsers } = await supabase.from('users').select('*').eq('username', 'MARIANA');
  assert.strictEqual(remainingUsers.length, 0, 'Após exclusão Mariana não deve mais existir');
  console.log('✓ Teste 6: Exclusão de usuário sincronizada no banco Supabase');

  await pgClient.end();
  console.log('\n🎉 TODOS OS TESTES DE SINCRONIZAÇÃO DE USUÁRIOS PASSARAM COM SUCESSO!\n');
}

verifyUserSync().catch(err => {
  console.error('❌ Falha na verificação de sincronização:', err);
  process.exit(1);
});
