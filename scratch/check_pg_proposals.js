const { Client } = require('pg');

async function test() {
  const c = new Client({ host: '127.0.0.1', port: 56322, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();
  const res = await c.query(`
    SELECT id, temperatura_contrato, aptidao, faturamento, faturamento_num
    FROM public.proposals
    WHERE id IN ('393', '401', '405', '411', '420', '426', '439', '448', '456', '457', '468', '471', '472', '474', '477', '480', '502', '514', '519', '532')
    ORDER BY id
  `);
  console.log('Sample of the 20 in PG:');
  res.rows.slice(0, 5).forEach(r => {
    console.log(`ID ${r.id}: status=${r.temperatura_contrato}, aptidao=${r.aptidao}, faturamento=${r.faturamento}, faturamento_num=${r.faturamento_num}`);
  });
  const desRes = await c.query(`SELECT count(*) FROM public.proposals WHERE temperatura_contrato = 'Desistência da Empresa' AND aptidao = 'Inapto'`);
  console.log('Desistencias marcadas como Inapto no PG:', desRes.rows[0].count);
  await c.end();
}
test().catch(console.error);
