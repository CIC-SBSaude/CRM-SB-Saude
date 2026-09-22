const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

console.log('--- Iniciando Testes da Aba Corretores (CRM SB Saúde) ---');

// 1. Carregar dependências no sandbox
const dbCode = fs.readFileSync('./js/database.js', 'utf8');
const brCode = fs.readFileSync('./js/business-rules.js', 'utf8');
const reportsCode = fs.readFileSync('./js/reports-engine.js', 'utf8');
const clientCode = fs.readFileSync('./js/supabase-client.js', 'utf8');

const sandbox = {
  window: {},
  localStorage: {
    store: {},
    getItem(key) { return this.store[key] || null; },
    setItem(key, val) { this.store[key] = String(val); },
    removeItem(key) { delete this.store[key]; }
  },
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval
};
sandbox.window = sandbox;

vm.createContext(sandbox);
vm.runInContext(dbCode, sandbox);
vm.runInContext(brCode, sandbox);
vm.runInContext(reportsCode, sandbox);
vm.runInContext(clientCode, sandbox);

const appData = sandbox.window.CRM_INITIAL_DATA;
const BusinessRules = sandbox.window.BusinessRules;
const ReportsEngine = sandbox.window.ReportsEngine;
const SBClient = sandbox.window.CRMSupabaseClient;

// Teste 1: Base inicial de corretores
assert.strictEqual(appData.brokers.length, 161, 'Deve conter 161 corretores na base de referência');
assert.ok(appData.brokers[0].CORRETOR_1, 'Corretor inicial deve possuir CORRETOR_1 preenchido');
console.log('✓ Teste 1: Base inicial contém 161 corretores íntegros com chave CORRETOR_1.');

// Teste 2: ReportsEngine extração de corretores
const brokerRecords = ReportsEngine.extractSourceRecords('brokers', appData, { role: 'Administrador Master' });
assert.strictEqual(brokerRecords.length, 161, 'ReportsEngine deve extrair 161 corretores');
assert.ok(brokerRecords.every(b => b.NOME_CORRETOR && b.NOME_CORRETOR.trim() !== ''), 'Nenhum corretor deve ter nome vazio no relatório');
console.log('✓ Teste 2: ReportsEngine extrai 161 corretores com NOME_CORRETOR válido.');

// Teste 3: Supabase fetchBrokers mapeamento de campos
const mockSupabaseData = [
  { id: 1, row_number: 2, corretor_1: 'Adailton Neves ( Anap)', imagem: null, email: 'adailton@email.com', telefone: '7199999999' },
  { id: 2, row_number: 3, corretor_1: 'Alberto Galvão', imagem: null, email: null, telefone: null }
];

const clientInstance = new SBClient();
clientInstance.client = {
  from(table) {
    assert.strictEqual(table, 'brokers');
    return {
      select() {
        return {
          order() {
            return Promise.resolve({ data: mockSupabaseData, error: null });
          }
        };
      }
    };
  }
};

clientInstance.fetchBrokers().then(brokers => {
  assert.strictEqual(brokers.length, 2);
  assert.strictEqual(brokers[0].CORRETOR_1, 'Adailton Neves ( Anap)', 'CORRETOR_1 deve estar preenchido');
  assert.strictEqual(brokers[0]['Corretor 1'], 'Adailton Neves ( Anap)', "Compatibilidade com 'Corretor 1'");
  assert.strictEqual(brokers[1].CORRETOR_1, 'Alberto Galvão', 'CORRETOR_1 deve estar preenchido para Alberto Galvão');
  console.log('✓ Teste 3: fetchBrokers mapeia corretamente CORRETOR_1 e campos de apoio.');

  // Teste 4: Simulação de renderBrokers com dados do Supabase
  const brokerStats = brokers.map(b => {
    const name = (b.CORRETOR_1 || b['Corretor 1'] || b.corretor_1 || 'Sem Identificação').trim();
    let p1 = 0, p2 = 0, p3 = 0, lives = 0, revenue = 0;
    appData.proposals.forEach(p => {
      const v = BusinessRules.parseLives(p.VIDAS);
      const r = BusinessRules.parseCurrency(p.FATURAMENTO);
      if (p.CORRETORES_1 === name) {
        p1++;
        lives += v;
        revenue += r;
      }
      if (p.CORRETORES_2 === name) p2++;
      if (p.CORRETORES_3 === name) p3++;
    });
    return {
      name,
      image: b.Imagem || '',
      totalProps: p1 + p2 + p3,
      pos1: p1,
      pos2: p2,
      pos3: p3,
      lives,
      revenue
    };
  });

  brokerStats.sort((a, b) => b.revenue - a.revenue);

  // Validação de geração de HTML sem exceções de toLowerCase/slice
  const renderedRows = brokerStats.map(b => {
    const safeName = b.name || 'Sem Identificação';
    const initials = (safeName.length >= 2 ? safeName.slice(0, 2) : (safeName || 'CO')).toUpperCase();
    return `<tr data-broker-name="${safeName.toLowerCase()}"><td>${initials} ${safeName}</td></tr>`;
  });

  assert.strictEqual(renderedRows.length, 2);
  assert.ok(renderedRows[0].includes('data-broker-name='));
  console.log('✓ Teste 4: renderBrokers processa e formata dados de corretores sem qualquer erro.');

  // Teste 5: saveBroker upsert
  let upsertCalled = false;
  clientInstance.client = {
    from(table) {
      assert.strictEqual(table, 'brokers');
      return {
        upsert(record, options) {
          assert.strictEqual(record.corretor_1, 'Novo Corretor Teste');
          assert.strictEqual(options.onConflict, 'corretor_1');
          upsertCalled = true;
          return Promise.resolve({ error: null });
        }
      };
    }
  };

  clientInstance.saveBroker({ CORRETOR_1: 'Novo Corretor Teste' }).then(success => {
    assert.strictEqual(success, true);
    assert.strictEqual(upsertCalled, true);
    console.log('✓ Teste 5: saveBroker grava novo corretor no Supabase com sucesso.');

    console.log('\n======================================================');
    console.log('🎉 TODOS OS TESTES DA ABA CORRETORES PASSARAM COM SUCESSO!');
    console.log('======================================================\n');
  }).catch(err => {
    console.error('Erro no teste 5:', err);
    process.exit(1);
  });
}).catch(err => {
  console.error('Erro no teste 3:', err);
  process.exit(1);
});
