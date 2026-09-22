const { createClient } = require('@supabase/supabase-js');

global.window = {
  supabase: { createClient },
  location: { hostname: '127.0.0.1' },
  dispatchEvent: () => {}
};

const { SBClient } = require('../js/supabase-client.js');

async function test() {
  const client = new SBClient();
  const ok = await client.checkConnection();
  console.log('checkConnection:', ok);
  const proposals = await client.fetchProposals({ pageSize: 500 });
  console.log('fetchProposals retornou:', proposals ? proposals.length : 'null');
  console.log('Sync status:', client.getSyncStatus());
  if (proposals) {
    const ids = new Set(proposals.map(p => p.ID));
    console.log('IDs únicos retornados:', ids.size);
  }
  clearInterval(client.reconnectTimer);
  process.exit(0);
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});
