const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir);
}

// We can create small HTML wrappers that set the desired localStorage and redirect to index.html,
// or use Chrome flags/scripts.
// Even better: write a small helper page runner.html that sets localStorage, then navigates or embeds iframe.

const testCases = [
  { name: 'dark_proposals_kanban', theme: 'dark', tab: 'proposals', mode: 'kanban', width: 1440, height: 900 },
  { name: 'dark_proposals_table', theme: 'dark', tab: 'proposals', mode: 'table', width: 1440, height: 900 },
  { name: 'dark_dashboard', theme: 'dark', tab: 'dashboard', mode: '', width: 1440, height: 900 },
  { name: 'dark_companies', theme: 'dark', tab: 'companies', mode: '', width: 1440, height: 900 },
  { name: 'dark_brokers', theme: 'dark', tab: 'brokers', mode: '', width: 1440, height: 900 },
  { name: 'dark_campaigns', theme: 'dark', tab: 'campaigns', mode: '', width: 1440, height: 900 },
  { name: 'dark_policies', theme: 'dark', tab: 'policies', mode: '', width: 1440, height: 900 },
  { name: 'dark_audit', theme: 'dark', tab: 'audit', mode: '', width: 1440, height: 900 },
  { name: 'dark_admin', theme: 'dark', tab: 'admin', mode: '', width: 1440, height: 900 },
  { name: 'dark_reports', theme: 'dark', tab: 'reports', mode: '', width: 1440, height: 900 },
];

for (const tc of testCases) {
  // create a capture wrapper html
  const wrapperContent = `<!DOCTYPE html>
<html>
<body>
<iframe id="crmFrame" src="index.html" style="position:fixed;top:0;left:0;width:100%;height:100%;border:none;"></iframe>
<script>
  localStorage.setItem('crm_theme_preference', '${tc.theme}');
  localStorage.setItem('crm_auth_session', JSON.stringify({
    login: 'RAMON',
    name: 'Ramon Reis',
    profile: 'Administrador Master',
    role: 'Analista de Sistemas • Nível 4'
  }));
  const frame = document.getElementById('crmFrame');
  frame.onload = () => {
    try {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      // Switch theme
      if (win.CRMThemeManager) {
        win.CRMThemeManager.applyTheme('${tc.theme}', true);
      }
      // Switch tab
      const tabLink = doc.querySelector('.nav-item[data-tab="${tc.tab}"]');
      if (tabLink) tabLink.click();
      
      // If table view requested
      if ('${tc.mode}' === 'table') {
        setTimeout(() => {
          const btnTable = doc.getElementById('btn-switch-table');
          if (btnTable) btnTable.click();
        }, 100);
      }
    } catch (e) {
      console.error(e);
    }
  };
</script>
</body>
</html>`;

  fs.writeFileSync(path.join(__dirname, 'capture_runner.html'), wrapperContent, 'utf8');

  const destPng = path.join(outDir, `${tc.name}.png`);
  console.log(`Capturing ${tc.name}...`);
  try {
    execSync(`"${chromePath}" --headless=new --screenshot="${destPng}" --window-size=${tc.width},${tc.height} --virtual-time-budget=2500 http://localhost:8080/capture_runner.html`);
    console.log(`Saved: ${destPng}`);
  } catch (err) {
    console.error(`Error capturing ${tc.name}:`, err.message);
  }
}

console.log('All screenshots captured!');
