const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function backup() {
  console.log('--- Iniciando Backup de public.proposals ---');
  const client = new Client({
    host: '127.0.0.1',
    port: 56322,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres'
  });
  await client.connect();
  const res = await client.query('SELECT * FROM public.proposals ORDER BY id');
  const backupFile = path.join(__dirname, 'backup_proposals_before_reconcile.json');
  fs.writeFileSync(backupFile, JSON.stringify(res.rows, null, 2), 'utf8');
  console.log(`✓ Backup salvo com sucesso: ${res.rows.length} registros em ${backupFile}`);
  await client.end();
}

backup().catch(err => {
  console.error('Erro no backup:', err);
  process.exit(1);
});
