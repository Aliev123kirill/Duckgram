const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;
const DIST = path.join(__dirname, 'dist');

if(!fs.existsSync(DIST)) {
  console.error('❌ dist/ not found. Run: pnpm build');
  process.exit(1);
}

// SPA fallback — serve index.html for all non-file routes
const indexHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');

app.use(express.static(DIST, {
  maxAge: '1y',
  immutable: true,
  setHeaders(res, filePath) {
    // Don't cache index.html
    if(filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// SPA fallback
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(indexHtml);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🦆 Duckgram server running at http://localhost:${PORT}`);
});
