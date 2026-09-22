const fs = require('fs');
const lines = fs.readFileSync('css/styles.css', 'utf8').split('\n');
const found = [];
lines.forEach((line, idx) => {
  if (line.includes('[data-theme="dark"]') || line.includes(':root')) {
    found.push(`${idx + 1}: ${line.trim()}`);
  }
});
console.log(found.slice(0, 30).join('\n'));

