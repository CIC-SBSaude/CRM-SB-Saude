const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\usuario\\.gemini\\antigravity-ide\\brain\\4d21453a-718f-4f05-b139-f51ba4c81b19';
const tempProfileDir = path.join(__dirname, 'temp_chrome_profile');

if (!fs.existsSync(tempProfileDir)) {
  fs.mkdirSync(tempProfileDir, { recursive: true });
}

console.log('Iniciando Chrome Headless na porta 9222...');
const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9222',
  `--user-data-dir=${tempProfileDir}`,
  '--window-size=1440,1100',
  'http://localhost:8080/index.html'
]);

setTimeout(async () => {
  try {
    const fetchJson = (url) => new Promise((resolve, reject) => {
      http.get(url, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const targets = await fetchJson('http://127.0.0.1:9222/json');
    console.log('Targets encontrados:', targets.length);
    const pageTarget = targets.find(t => t.type === 'page');
    if (!pageTarget) {
      console.error('Nenhum alvo de página encontrado!');
      chrome.kill();
      process.exit(1);
    }

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

    let id = 1;
    const callbacks = new Map();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (callbacks.has(msg.id)) {
        const cb = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        cb(msg.result);
      }
    };

    function send(method, params = {}) {
      return new Promise((resolve) => {
        const reqId = id++;
        callbacks.set(reqId, resolve);
        ws.send(JSON.stringify({ id: reqId, method, params }));
      });
    }

    ws.onopen = async () => {
      console.log('WebSocket CDP conectado!');
      await send('Page.enable');
      await send('Runtime.enable');

      // 1. Configurar sessão autenticada de Administrador Master e tema Claro
      console.log('Configurando sessão administrativa...');
      await send('Runtime.evaluate', {
        expression: `
          localStorage.setItem('crm_auth_session', JSON.stringify({
            token: 'mock_jwt_master',
            user: { name: 'Administrador Master', role: 'master_admin', email: 'admin@sbsaude.com.br', username: 'admin' },
            expiresAt: Date.now() + 86400000
          }));
          localStorage.setItem('crm_theme_preference', 'light');
          document.documentElement.setAttribute('data-theme', 'light');
          document.documentElement.setAttribute('data-theme-choice', 'light');
          location.reload();
        `
      });

      // Aguarda recarregamento e montagem completa do dashboard
      await new Promise(r => setTimeout(r, 2500));

      // 2. Screenshot 1: Dashboard Light com Insights Estratégicos
      console.log('Capturando dashboard em modo Claro...');
      const snapLight = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(artifactDir, 'strategic_insights_light.png'), Buffer.from(snapLight.data, 'base64'));
      console.log('✓ Salvo: strategic_insights_light.png');

      // 3. Screenshot 2: Dashboard Dark com Insights Estratégicos
      console.log('Alternando para modo Escuro...');
      await send('Runtime.evaluate', {
        expression: `
          document.documentElement.setAttribute('data-theme', 'dark');
          document.documentElement.setAttribute('data-theme-choice', 'dark');
          localStorage.setItem('crm_theme_preference', 'dark');
        `
      });
      await new Promise(r => setTimeout(r, 800));

      console.log('Capturando dashboard em modo Escuro...');
      const snapDark = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(artifactDir, 'strategic_insights_dark.png'), Buffer.from(snapDark.data, 'base64'));
      console.log('✓ Salvo: strategic_insights_dark.png');

      // 4. Screenshot 3: Modal de Drilldown ao clicar em um cartão
      console.log('Abrindo modal de drilldown do Corretor Líder...');
      await send('Runtime.evaluate', {
        expression: `
          const card = document.querySelector('.exec-insight-card[data-insight="top-broker"]');
          if (card) card.click();
        `
      });
      await new Promise(r => setTimeout(r, 1000));

      console.log('Capturando modal de drilldown...');
      const snapModal = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(artifactDir, 'strategic_insights_drilldown.png'), Buffer.from(snapModal.data, 'base64'));
      console.log('✓ Salvo: strategic_insights_drilldown.png');

      ws.close();
      chrome.kill();
      console.log('Todas as evidências visuais foram geradas com sucesso!');
      process.exit(0);
    };

  } catch (err) {
    console.error('Erro na captura:', err);
    chrome.kill();
    process.exit(1);
  }
}, 2000);
