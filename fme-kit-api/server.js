// Local development server for FME Kit API + static client files

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import API app
import apiApp from './api/index.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Mount API routes FIRST (before static files)
app.use(apiApp);

// Serve static client files AFTER API routes
app.use(express.static(path.join(__dirname, '../client')));

app.listen(PORT, () => {
  console.log(`FME Kit API listening on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Demo page: http://localhost:${PORT}/demo.html`);
  console.log(`Admin portal: http://localhost:${PORT}/admin-portal.html`);
  console.log(`Debug page: http://localhost:${PORT}/debug-flag.html`);
});
