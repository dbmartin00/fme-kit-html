import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  fetchFlags,
  fetchFlagsMeta,
  getState,
  getAllocation,
  getTreatments,
  setTreatment,
  toggleFlag,
  killFlag,
  restoreFlag,
  patchApi
} from '../lib/split-client.js';
import { validateCredentials, generateToken, validateAuthConfig } from '../lib/auth.js';
import { requireAuth } from '../lib/middleware.js';

// Load environment variables
dotenv.config({ path: new URL('../.env', import.meta.url) });

// Validate authentication configuration
validateAuthConfig();

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Helper to validate required query/body params
function requireParams(obj, ...params) {
  const missing = params.filter(p => !obj[p]);
  if (missing.length) {
    throw new Error(`Missing required parameter(s): ${missing.join(', ')}`);
  }
}

// POST /api/auth/login
// Body: { username, password }
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Missing credentials',
        code: 'MISSING_CREDENTIALS'
      });
    }

    // Validate credentials
    const isValid = await validateCredentials(username, password);

    if (!isValid) {
      return res.status(401).json({
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Generate token
    const token = generateToken(username);
    const expiresIn = process.env.JWT_EXPIRY || '8h';

    res.json({
      token,
      username,
      expiresIn
    });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({
      error: 'Authentication error',
      code: 'AUTH_ERROR'
    });
  }
});

// GET /api/flags?workspace={wsId}&env={envName}
// List all flags in workspace+environment
app.get('/api/flags', requireAuth, async (req, res) => {
  try {
    const { workspace, env } = req.query;
    requireParams(req.query, 'workspace', 'env');

    // Fetch both definitions and metadata in parallel
    const [defs, meta] = await Promise.all([
      fetchFlags(workspace, env),
      fetchFlagsMeta(workspace)
    ]);

    // Merge and simplify
    const flags = defs.map(def => ({
      name: def.name,
      state: getState(def),
      killed: def.killed,
      allocation: getAllocation(def),
      treatments: getTreatments(def, meta[def.name]),
      description: meta[def.name]?.description || '',
      tags: meta[def.name]?.tags?.map(t => t.name) || [],
      owner: meta[def.name]?.owners?.[0]?.displayName || meta[def.name]?.owners?.[0]?.name || ''
    }));

    res.json({ flags });
  } catch (err) {
    console.error('GET /api/flags error:', err);
    res.status(err.message.includes('Missing') ? 400 : 500).json({
      error: err.message
    });
  }
});

// GET /api/flags/:name/status?workspace={wsId}&env={envName}
// Get detailed flag status
app.get('/api/flags/:name/status', requireAuth, async (req, res) => {
  try {
    const { workspace, env } = req.query;
    const { name: flagName } = req.params;
    requireParams(req.query, 'workspace', 'env');

    // Fetch flags and metadata
    const [defs, meta] = await Promise.all([
      fetchFlags(workspace, env),
      fetchFlagsMeta(workspace)
    ]);

    // Find specific flag
    const def = defs.find(f => f.name === flagName);
    if (!def) {
      return res.status(404).json({ error: `Flag not found: ${flagName}` });
    }

    const flagMeta = meta[flagName] || {};
    const treatments = getTreatments(def, flagMeta);

    res.json({
      name: def.name,
      state: getState(def),
      killed: def.killed,
      allocation: getAllocation(def),
      treatments,
      defaultTreatment: def.defaultTreatment,
      description: flagMeta.description || '',
      tags: flagMeta.tags?.map(t => t.name) || [],
      owner: flagMeta.owners?.[0]?.displayName || flagMeta.owners?.[0]?.name || ''
    });
  } catch (err) {
    console.error('GET /api/flags/:name/status error:', err);
    res.status(err.message.includes('Missing') ? 400 : 500).json({
      error: err.message
    });
  }
});

// POST /api/flags/:name/toggle
// Body: { workspace, env, treatment?: string, allocation?: number, allocations?: {treatment: size} }
app.post('/api/flags/:name/toggle', requireAuth, async (req, res) => {
  try {
    const { name: flagName } = req.params;
    const { workspace, env, treatment, allocation = 100, allocations } = req.body;

    // Either allocations object or treatment must be provided
    if (!allocations && !treatment) {
      return res.status(400).json({ error: 'Missing required parameter: treatment or allocations' });
    }
    requireParams(req.body, 'workspace', 'env');

    // Fetch both definitions and metadata to get available treatments
    const [defs, meta] = await Promise.all([
      fetchFlags(workspace, env),
      fetchFlagsMeta(workspace)
    ]);
    const def = defs.find(f => f.name === flagName);
    if (!def) {
      return res.status(404).json({ error: `Flag not found: ${flagName}` });
    }
    const flagMeta = meta[flagName];
    const treatments = getTreatments(def, flagMeta);

    // Handle full allocations object (e.g., {red: 50, green: 49, blue: 1})
    if (allocations) {
      // Validate total is 100
      const total = Object.values(allocations).reduce((sum, val) => sum + val, 0);
      if (total !== 100) {
        return res.status(400).json({ error: `Allocations must sum to 100% (currently ${total}%)` });
      }

      // Validate all treatments are valid
      for (const t of Object.keys(allocations)) {
        if (treatments.length > 0 && !treatments.includes(t)) {
          return res.status(400).json({
            error: `Invalid treatment: ${t}. Available treatments: [${treatments.join(', ')}]`
          });
        }
      }

      // Build defaultRule from allocations
      const rule = Object.entries(allocations)
        .filter(([_, size]) => size > 0)
        .map(([treatment, size]) => ({ treatment, size }));

      // Apply the rule directly via patchApi helper
      const enc = s => encodeURIComponent(s);
      await patchApi(
        `/splits/ws/${workspace}/${enc(flagName)}/environments/${enc(env)}`,
        [
          { op: 'replace', path: '/killed', value: false },
          { op: 'replace', path: '/defaultRule', value: rule }
        ]
      );
    } else {
      // Single treatment mode (backward compatible)
      if (allocation < 0 || allocation > 100) {
        return res.status(400).json({ error: `Invalid allocation: ${allocation}. Must be 0-100` });
      }

      // Validate treatment
      if (treatments.length > 0 && !treatments.includes(treatment)) {
        return res.status(400).json({
          error: `Invalid treatment: ${treatment}. Available treatments: [${treatments.join(', ')}]`
        });
      }

      // Set the treatment
      await setTreatment(workspace, flagName, env, treatment, allocation, treatments);
    }

    // Fetch updated state
    const updatedDefs = await fetchFlags(workspace, env);
    const updated = updatedDefs.find(f => f.name === flagName);

    if (!updated) {
      return res.status(404).json({ error: `Flag not found after toggle: ${flagName}` });
    }

    res.json({
      name: flagName,
      state: getState(updated),
      allocation: getAllocation(updated),
      treatments,
      killed: updated.killed
    });
  } catch (err) {
    console.error('POST /api/flags/:name/toggle error:', err);
    res.status(err.message.includes('Missing') || err.message.includes('Invalid') ? 400 : 500).json({
      error: err.message
    });
  }
});

// POST /api/flags/:name/kill
// Body: { workspace, env, defaultTreatment?: string }
app.post('/api/flags/:name/kill', requireAuth, async (req, res) => {
  try {
    const { name: flagName } = req.params;
    const { workspace, env } = req.body;
    let { defaultTreatment } = req.body;
    requireParams(req.body, 'workspace', 'env');

    // Fetch flag definition to get available treatments
    const [defs, meta] = await Promise.all([
      fetchFlags(workspace, env),
      fetchFlagsMeta(workspace)
    ]);
    const def = defs.find(f => f.name === flagName);
    if (!def) {
      return res.status(404).json({ error: `Flag not found: ${flagName}` });
    }

    const treatments = getTreatments(def, meta[flagName]);

    // If no defaultTreatment specified, use the first available treatment
    // or fall back to 'off' for boolean flags
    if (!defaultTreatment) {
      if (treatments.includes('off')) {
        defaultTreatment = 'off';
      } else if (treatments.length > 0) {
        defaultTreatment = treatments[0];
      } else {
        defaultTreatment = 'off'; // fallback
      }
    }

    // Validate defaultTreatment is valid
    if (treatments.length > 0 && !treatments.includes(defaultTreatment)) {
      return res.status(400).json({
        error: `Invalid defaultTreatment: ${defaultTreatment}. Available treatments: [${treatments.join(', ')}]`
      });
    }

    // Kill the flag
    await killFlag(workspace, flagName, env, defaultTreatment);

    res.json({
      name: flagName,
      state: 'killed',
      killed: true,
      defaultTreatment
    });
  } catch (err) {
    console.error('POST /api/flags/:name/kill error:', err);
    res.status(err.message.includes('Missing') ? 400 : 500).json({
      error: err.message
    });
  }
});

// POST /api/flags/:name/restore
// Body: { workspace, env, treatment?: string }
app.post('/api/flags/:name/restore', requireAuth, async (req, res) => {
  try {
    const { name: flagName } = req.params;
    const { workspace, env } = req.body;
    let { treatment } = req.body;
    requireParams(req.body, 'workspace', 'env');

    // Fetch flag definition to get available treatments
    const [defs, meta] = await Promise.all([
      fetchFlags(workspace, env),
      fetchFlagsMeta(workspace)
    ]);
    const def = defs.find(f => f.name === flagName);
    if (!def) {
      return res.status(404).json({ error: `Flag not found: ${flagName}` });
    }

    const treatments = getTreatments(def, meta[flagName]);

    // If no treatment specified, use first available or default to 'on'
    if (!treatment) {
      if (treatments.includes('on')) {
        treatment = 'on';
      } else if (treatments.length > 0) {
        treatment = treatments[0];
      } else {
        treatment = 'on'; // fallback
      }
    }

    // Validate treatment
    if (treatments.length > 0 && !treatments.includes(treatment)) {
      return res.status(400).json({
        error: `Invalid treatment: ${treatment}. Available treatments: [${treatments.join(', ')}]`
      });
    }

    // Restore the flag
    await restoreFlag(workspace, flagName, env, treatment);

    // Fetch updated state
    const updatedDefs = await fetchFlags(workspace, env);
    const updated = updatedDefs.find(f => f.name === flagName);

    if (!updated) {
      return res.status(404).json({ error: `Flag not found after restore: ${flagName}` });
    }

    res.json({
      name: flagName,
      state: getState(updated),
      allocation: getAllocation(updated),
      treatments: getTreatments(updated, meta[flagName]),
      killed: updated.killed
    });
  } catch (err) {
    console.error('POST /api/flags/:name/restore error:', err);
    res.status(err.message.includes('Missing') || err.message.includes('Invalid') ? 400 : 500).json({
      error: err.message
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// IMPORTANT: Do not call app.listen() on Vercel
// Just export the app
export default app;
