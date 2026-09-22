const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outDir = path.join(__dirname, '../screenshots');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Wrapper HTML to force dark mode and clear auth session to show login overlay
const htmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;">
<iframe id="crmFrame" src="../index.html" style="position:fixed;top:0;left:0;width:100%;height:100%;border:none;"></iframe>
<script>
  localStorage.setItem('crm_theme_preference', 'dark');
  localStorage.removeItem('crm_auth_session');
  const frame = document.getElementById('crmFrame');
  frame.onload = () => {
    try {
      const doc = frame.contentDocument;
      doc.documentElement.setAttribute('data-theme', 'dark');
      doc.documentElement.setAttribute('data-theme-choice', 'dark');
      const appContainer = doc.querySelector('.app-container');
      const loginScreen = doc.getElementById('login-screen');
      if (appContainer) appContainer.style.display = 'none';
      if (loginScreen) loginScreen.style.display = 'flex';
    } catch (e) {
      console.error(e);
    }
  };
</script>
</body>
</html>`;

const wrapperPath = path.join(__dirname, 'login_test_wrapper.html');
fs.writeFileSync(wrapperPath, htmlContent, 'utf8');

const targetUrl = 'file:///' + wrapperPath.replace(/\\/g, '/');
const outFile = path.join(outDir, 'login_dark_before_1440x900.png');

console.log('Capturing before screenshot at:', targetUrl);
const cmd = `"${chromePath}" --headless=new --disable-gpu --virtual-time-budget=2500 --window-size=1440,900 --screenshot="${outFile}" "${targetUrl}"`;
try {
  execSync(cmd, { stdio: 'inherit' });
  console.log('Before screenshot saved to:', outFile);
} catch (err) {
  console.error('Error capturing screenshot:', err);
}
