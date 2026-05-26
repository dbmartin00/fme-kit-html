// Split.io API client utilities
// Extracted and adapted from /toggler/index.js

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from parent directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

const BASE = 'https://api.split.io/internal/api/v2';
const API_KEY = process.env.SPLIT_API_KEY;

if (!API_KEY) {
  throw new Error('SPLIT_API_KEY environment variable is required');
}

// Generic HTTP client with Split.io auth
async function api(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${method} ${path} → ${response.status} ${errorText}`);
  }

  return response.json();
}

// URL encoding helper
const enc = s => encodeURIComponent(s);

// HTTP method wrappers
const get = p => api('GET', p);
export const patchApi = (p, b) => api('PATCH', p, b);

// Normalize Split.io's inconsistent response wrapping
function unwrap(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.objects)) return data.objects;
  if (Array.isArray(data.data)) return data.data;
  throw new Error(`Unexpected API shape: ${JSON.stringify(data).slice(0, 200)}`);
}

// Fetch flag definitions for environment
export async function fetchFlags(wsId, envName) {
  return unwrap(await get(`/splits/ws/${wsId}/environments/${enc(envName)}?limit=50`));
}

// Fetch workspace-level metadata (description, tags, owners)
export async function fetchFlagsMeta(wsId) {
  const list = unwrap(await get(`/splits/ws/${wsId}?limit=50`));
  return Object.fromEntries(list.map(s => [s.name, s]));
}

// Determine flag state - handles both boolean and multi-variant flags
export function getState(def) {
  if (def.killed) {
    return def.defaultTreatment;
  }

  const [first] = def.defaultRule ?? [];
  if (!first) return 'unknown';

  // If single treatment at 100%, return that treatment
  if (first.size === 100) {
    return first.treatment;
  }

  // Multiple treatments with allocation
  return 'partial';
}

// Calculate percentage allocation for all treatments
export function getAllocation(def) {
  const rule = def.defaultRule ?? [];
  const result = {};

  rule.forEach(r => {
    result[r.treatment] = (result[r.treatment] || 0) + r.size;
  });

  return result;
}

// Get all available treatments for a flag
export function getTreatments(def, flagMeta) {
  // First priority: treatments array from the flag definition (environment-level)
  // This contains ALL defined treatments, even if not currently allocated
  if (def.treatments?.length > 0) {
    return def.treatments.map(t => t.name).sort();
  }

  // Second priority: workspace metadata (less common)
  if (flagMeta?.treatments?.length > 0) {
    return flagMeta.treatments.map(t => t.name).sort();
  }

  // Fallback: extract unique treatments from rules (only shows allocated ones)
  const treatments = new Set();

  // Add from defaultRule
  if (def.defaultRule) {
    def.defaultRule.forEach(r => treatments.add(r.treatment));
  }

  // Add defaultTreatment
  if (def.defaultTreatment) {
    treatments.add(def.defaultTreatment);
  }

  // Add from rules (if any)
  if (def.rules) {
    def.rules.forEach(rule => {
      if (rule.buckets) {
        rule.buckets.forEach(b => treatments.add(b.treatment));
      }
    });
  }

  return Array.from(treatments).sort();
}

// Set flag to a specific treatment with optional percentage allocation
export async function setTreatment(wsId, flagName, envName, treatment, allocation = 100, allTreatments = null) {
  // Build default rule based on allocation
  let rule;

  if (allocation === 100) {
    // Simple: 100% to one treatment
    rule = [{ treatment, size: 100 }];
  } else if (allTreatments && allTreatments.length > 1) {
    // Distribute remaining percentage to other treatments equally
    const otherTreatments = allTreatments.filter(t => t !== treatment);
    const remainingSize = 100 - allocation;
    const sizePerOther = Math.floor(remainingSize / otherTreatments.length);
    let remainder = remainingSize % otherTreatments.length;

    rule = [{ treatment, size: allocation }];
    otherTreatments.forEach((t, i) => {
      const size = sizePerOther + (i < remainder ? 1 : 0);
      if (size > 0) {
        rule.push({ treatment: t, size });
      }
    });
  } else {
    // Fallback: assume binary with "off" or first other treatment
    const otherTreatment = allTreatments?.[0] === treatment ? allTreatments[1] : allTreatments?.[0] || 'off';
    rule = [
      { treatment, size: allocation },
      { treatment: otherTreatment, size: 100 - allocation }
    ];
  }

  // PATCH with RFC 6902 format (array of operations)
  return patchApi(
    `/splits/ws/${wsId}/${enc(flagName)}/environments/${enc(envName)}`,
    [
      { op: 'replace', path: '/killed', value: false },
      { op: 'replace', path: '/defaultRule', value: rule }
    ]
  );
}

// Legacy alias for backwards compatibility
export async function toggleFlag(wsId, flagName, envName, state, allocation = 100) {
  return setTreatment(wsId, flagName, envName, state, allocation);
}

// Kill flag (emergency off switch)
export async function killFlag(wsId, flagName, envName, defaultTreatment = 'off') {
  return patchApi(
    `/splits/ws/${wsId}/${enc(flagName)}/environments/${enc(envName)}`,
    [
      { op: 'replace', path: '/killed', value: true },
      { op: 'replace', path: '/defaultTreatment', value: defaultTreatment }
    ]
  );
}

// Restore killed flag (alias to toggle)
export async function restoreFlag(wsId, flagName, envName, state) {
  return toggleFlag(wsId, flagName, envName, state, 100);
}
