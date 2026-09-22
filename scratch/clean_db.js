const { Client } = require('pg');
async function clean() {
  const c = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:56322/postgres' });
  await c.connect();
  const res = await c.query('DELETE FROM public.coparticipation_policies WHERE TRIM(COALESCE(nome_politica, "")) = \'\'');
  console.log('Removed empty/corrupted rows:', res.rowCount);
  const rows = (await c.query('SELECT id, row_number, id_politica, nome_politica, percentual_desconto_evento, valor_consulta_eletiva FROM public.coparticipation_policies ORDER BY id ASC')).rows;
  console.log('Current coparticipation policies in DB:');
  console.table(rows);
  await c.end();
}
clean().catch(console.error);
