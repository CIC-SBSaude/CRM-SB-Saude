const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outDir = path.join(__dirname, '../screenshots');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function captureScenario({ name, theme, width, height, authenticated }) {
  const htmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;">
<iframe id="crmFrame" src="../index.html" style="position:fixed;top:0;left:0;width:100%;height:100%;border:none;"></iframe>
<script>
  localStorage.setItem('crm_theme_preference', '${theme}');
  ${authenticated ? `
  localStorage.setItem('crm_auth_session', JSON.stringify({
    login: 'ADMINISTRADOR',
    name: 'Administrador Master',
    profile: 'Administrador Master',
    role: 'Administrador Master'
  }));` : `localStorage.removeItem('crm_auth_session');`}
  const frame = document.getElementById('crmFrame');
  frame.onload = () => {
    try {
      const doc = frame.contentDocument;
      doc.documentElement.setAttribute('data-theme', '${theme}');
      doc.documentElement.setAttribute('data-theme-choice', '${theme}');
      const appContainer = doc.querySelector('.app-container');
      const loginScreen = doc.getElementById('login-screen');
      if ('${authenticated}' === 'true') {
        if (appContainer) appContainer.style.display = 'flex';
        if (loginScreen) loginScreen.style.display = 'none';
      } else {
        if (appContainer) appContainer.style.display = 'none';
        if (loginScreen) loginScreen.style.display = 'flex';
      }
    } catch (e) {
      console.error(e);
    }
  };
</script>
</body>
</html>`;

  const wrapperPath = path.join(__dirname, `wrapper_${name}.html`);
  fs.writeFileSync(wrapperPath, htmlContent, 'utf8');

  const targetUrl = 'file:///' + wrapperPath.replace(/\\/g, '/');
  const outFile = path.join(outDir, `${name}.png`);

  console.log(`Capturing ${name} (${width}x${height})...`);
  const cmd = `"${chromePath}" --headless=new --disable-gpu --virtual-time-budget=2000 --window-size=${width},${height} --screenshot="${outFile}" "${targetUrl}"`;
  execSync(cmd, { stdio: 'inherit' });
  console.log(`Saved: ${outFile}`);
}

captureScenario({ name: 'login_dark_after_1440x900', theme: 'dark', width: 1440, height: 900, authenticated: false });
captureScenario({ name: 'login_dark_after_1280x800', theme: 'dark', width: 1280, height: 800, authenticated: false });
captureScenario({ name: 'login_dark_after_375x812', theme: 'dark', width: 375, height: 812, authenticated: false });
captureScenario({ name: 'login_light_after_1440x900', theme: 'light', width: 1440, height: 900, authenticated: false });
captureScenario({ name: 'app_dark_after_1440x900', theme: 'dark', width: 1440, height: 900, authenticated: true });
console.log('All visual captures completed!');
