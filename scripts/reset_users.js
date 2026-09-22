const { Client } = require('pg');

async function resetUsers() {
  if (process.env.CONFIRM_RESET_USERS !== 'TRUE') {
    console.error('❌ ERRO DE SEGURANÇA: reset_users.js é uma operação destrutiva.');
    console.error('Para confirmar sua execução deliberada, defina a variável: CONFIRM_RESET_USERS=TRUE');
    process.exit(1);
  }

  const client = new Client({
    host: '127.0.0.1',
    port: 56322,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres'
  });

  await client.connect();
  console.log('1. Apagando todos os usuários da tabela public.users...');
  await client.query('DELETE FROM public.users;');
  await client.query('ALTER SEQUENCE IF EXISTS public.users_id_seq RESTART WITH 1;');

  console.log('2. Inserindo o usuário Administrador com a senha admin.admin...');
  const res = await client.query(`
    INSERT INTO public.users (
      user_code, username, name, email, role, profile, status, password_hash, two_factor, last_login, ip, avatar
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
    ) RETURNING *;
  `, [
    'USR-001',
    'ADMINISTRADOR',
    'Administrador',
    'administrador@sbsaude.com.br',
    'Administrador Master',
    'Administrador Master',
    'Ativo',
    'admin.admin',
    true,
    'Primeiro acesso pendente',
    '192.168.10.1',
    'AD'
  ]);

  console.log('✓ Usuário criado no Supabase com sucesso:');
  console.table(res.rows);
  await client.end();
}

resetUsers().catch(err => {
  console.error('Erro ao resetar usuários:', err);
  process.exit(1);
});
