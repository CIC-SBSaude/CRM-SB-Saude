const fs = require('fs');
const path = require('path');

const files = [
  'js/app.js',
  'js/business-rules.js',
  'js/analytics.js',
  'js/reports-engine.js',
  'js/supabase-client.js',
  'js/database.js'
];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (/parseInt\s*\([^)]*vidas/i.test(line) || /VIDAS/i.test(line) && /parseInt/i.test(line)) {
      console.log(`${file}:${idx + 1}: ${line.trim()}`);
    }
  });
}
