# FME Kit for Embedded FME

Lightweight REST API and embeddable Web Component for controlling Harness FME (Split.io) feature flags.

## Table of Contents

- [Introduction](#introduction)
- [Architecture Overview](#architecture-overview)
- [Customer Integration](#customer-integration)
- [Component Capabilities](#component-capabilities)
- [Quick Start](#quick-start)
- [API Endpoints](#api-endpoints)
- [Web Component Usage](#web-component-usage)
- [Embedding in Your App](#embedding-in-your-app)
- [Deployment](#deployment)
- [Development](#development)

## Introduction

**FME Kit** is a lightweight wrapper around the Harness Feature Management Engine (formerly Split.io) that enables teams to embed feature flag controls directly into their applications. Instead of context-switching to the Split.io UI, users can toggle, allocate, kill, and restore flags right where they work.

## Architecture Overview

FME Kit consists of two layers: a **backend REST API** and a **frontend Web Component**.

### Backend API Layer

The backend API acts as a simplified translation layer between your application and Split.io's complex internal API. It handles authentication, response normalization, and business logic so clients don't have to.

**Key responsibilities:**
- **Secure authentication**: Your Split.io service account token (`sat.<uuid>.<hash>`) lives exclusively in the backend `.env` file, never exposed to browsers
- **API simplification**: Converts Split.io's RFC 6902 JSON Patch format and nested response structures into simple REST endpoints
- **Multi-variant support**: Automatically detects whether flags are boolean (on/off) or multi-variant (red/green/blue) and handles both
- **Validation**: Ensures allocations sum to 100%, treatments are valid, and requests are well-formed before hitting Split.io

**Example API call:**
```bash
# Backend calls Split.io with your token:
POST https://api.split.io/internal/api/v2/splits/ws/{workspace}/{flag}/environments/{env}
Headers: x-api-key: sat.your-secret-token-here
Body: [{"op": "replace", "path": "/defaultRule", "value": [...]}]

# Your app calls the simplified FME Kit API:
POST http://localhost:3000/api/flags/my-flag/toggle
Body: {"workspace": "ws_123", "env": "Production", "allocations": {"red": 50, "green": 30, "blue": 20}}
```

The backend runs as an Express.js app, deployable to Vercel, AWS, Google Cloud, or any Node.js host with SSL termination support.

### Frontend Web Component

The frontend is a **zero-dependency Web Component** that works in any framework (React, Vue, Angular, vanilla HTML) or even mobile WebViews. It uses the browser's native Custom Elements API to create a `<fme-flag>` tag that encapsulates all UI and behavior in shadow DOM.

**What the browser does:**
1. **Loads the component**: Browser fetches `fme-flag.js` as an ES6 module
2. **Parses attributes**: Extracts flag name, workspace, environment, API URL, and polling interval
3. **Fetches current state**: Calls your backend API to get the flag's current treatment and allocation
4. **Renders the UI**: Displays a gradient card with flag status, treatment percentages, and control buttons
5. **Polls for updates**: Every 10-60 seconds (configurable), fetches fresh state to reflect changes made elsewhere
6. **Handles interactions**: Opens modal for allocation editing, pauses polling during edits, validates inputs, and applies changes

## Customer Integration

Embedding FME Kit in your application requires minimal code. Here's everything needed:

### HTML Setup

```html
<!DOCTYPE html>
<html>
<head>
  <!-- Import the Web Component -->
  <script type="module" src="http://localhost:3000/fme-flag.js"></script>
</head>
<body>
  
  <!-- Your existing app content -->
  <h1>My Application Dashboard</h1>
  
  <!-- Embed the flag control -->
  <fme-flag
    flag="checkout-v2"
    workspace="ws_abc123"
    env="Production"
    api-url="http://localhost:3000/api"
    poll-interval="60000"
    compact>
  </fme-flag>
  
</body>
</html>
```

### Configuration

**Required Attributes:**
- `flag` - Feature flag name from Split.io
- `workspace` - Your Split.io workspace ID
- `env` - Environment name (Production, Staging, etc.)

**Optional Attributes:**
- `api-url` - FME Kit API endpoint (default: `http://localhost:3000/api`)
- `poll-interval` - Refresh interval in milliseconds (default: 60000 = 60s, set to 0 to disable)
- `compact` - Use compact display mode (gradient card with inline buttons)

### JavaScript Events (Optional)

```javascript
const flag = document.querySelector('fme-flag');

// Listen for state changes
flag.addEventListener('state-changed', (e) => {
  console.log(`Flag now: ${e.detail.state}`);
  console.log(`Allocation: ${JSON.stringify(e.detail.allocation)}`);
});

// Listen for errors
flag.addEventListener('error', (e) => {
  console.error(`Flag error: ${e.detail.message}`);
});
```

## Component Capabilities

Once embedded, users can:

**Toggle**: Click the Toggle button to open an allocation modal with radio buttons for quick 100% switches or manual percentage inputs for gradual rollouts (e.g., red: 50%, green: 30%, blue: 20%)

**Allocate**: Supports both boolean flags (on/off) and multi-variant flags (custom treatments). The modal validates that percentages sum to 100% before allowing submission

**Kill**: Emergency kill switch that immediately stops the flag from evaluating, returning a safe default treatment. Automatically selects a valid treatment based on the flag's defined treatments (not hardcoded to "off")

**Restore**: Returns a killed flag to active state, restoring it to a specified treatment at 100% allocation

**Real-time Sync**: Configurable polling (10-60s) ensures the component reflects changes made by teammates in the Split.io UI or via API, with smart polling that pauses during editing to prevent losing work

The component displays current state with color-coded emojis (🟢 green, 🔴 red, 🔵 blue) and shows the selected treatment in bold with others listed, making it immediately clear what state the flag is in and what options are available.

---

## Quick Start

### 1. Start the API Server

```bash
cd fme-kit-api
npm install
npm run dev
```

The API will start on `http://localhost:3000`.

### 2. Configure Your Workspace

Update the API key in `fme-kit-api/.env`:

```bash
SPLIT_API_KEY=sat.your-api-key-here
```

### 3. Try the Demo

Open `client/demo.html` in your browser:

```bash
open client/demo.html
```

Update the `workspace` and `env` attributes in the HTML to match your Split.io workspace.

## API Endpoints

### List Flags
```bash
GET /api/flags?workspace={wsId}&env={envName}
```

Response:
```json
{
  "flags": [
    {
      "name": "new-checkout",
      "state": "on",
      "killed": false,
      "allocation": { "on": 100, "off": 0 },
      "description": "New checkout flow",
      "tags": ["frontend"],
      "owner": "jane.smith@example.com"
    }
  ]
}
```

### Flag Status
```bash
GET /api/flags/{name}/status?workspace={wsId}&env={envName}
```

### Toggle Flag
```bash
POST /api/flags/{name}/toggle
Content-Type: application/json

{
  "workspace": "ws_123",
  "env": "Production",
  "state": "on",
  "allocation": 75  // Optional: percentage for gradual rollout (default: 100)
}
```

### Kill Flag
```bash
POST /api/flags/{name}/kill
Content-Type: application/json

{
  "workspace": "ws_123",
  "env": "Production",
  "defaultTreatment": "off"  // Optional: what to return when killed
}
```

### Restore Flag
```bash
POST /api/flags/{name}/restore
Content-Type: application/json

{
  "workspace": "ws_123",
  "env": "Production",
  "state": "on"
}
```

## Web Component Usage

### Basic Usage

```html
<script type="module" src="./fme-flag.js"></script>

<fme-flag
  flag="new-dashboard-ui"
  workspace="ws_abc123"
  env="Production"
  api-url="http://localhost:3000/api">
</fme-flag>
```

### Attributes

- `flag` (required): Flag name
- `workspace` (required): Split.io workspace ID
- `env` (required): Environment name (e.g., "Production", "Staging")
- `api-url` (optional): FME Kit API URL (default: `http://localhost:3000/api`)
- `poll-interval` (optional): Polling interval in milliseconds (default: `60000` = 60 seconds, set to `0` to disable)

### Polling Examples

```html
<!-- Default: 60 second polling -->
<fme-flag flag="feature-a" workspace="ws_123" env="prod"></fme-flag>

<!-- Fast polling: 10 seconds -->
<fme-flag flag="feature-b" workspace="ws_123" env="prod" poll-interval="10000"></fme-flag>

<!-- No polling: manual refresh only -->
<fme-flag flag="feature-c" workspace="ws_123" env="prod" poll-interval="0"></fme-flag>
```

### Methods

```javascript
const flag = document.querySelector('fme-flag');

// Toggle flag on/off
await flag.toggle('on');         // 100% on
await flag.toggle('on', 75);     // 75% on, 25% off

// Kill flag
await flag.kill();

// Restore flag
await flag.restore('on');

// Manually refresh status
await flag.refresh();

// Control polling
flag.startPolling();
flag.stopPolling();
```

### Events

```javascript
const flag = document.querySelector('fme-flag');

// State changed
flag.addEventListener('state-changed', (e) => {
  console.log('New state:', e.detail.state);
  console.log('Allocation:', e.detail.allocation);
});

// Error occurred
flag.addEventListener('error', (e) => {
  console.error('Error:', e.detail.message);
});
```

## Embedding in Your App

### React

```jsx
function App() {
  useEffect(() => {
    // Load the web component
    import('./fme-flag.js');
  }, []);

  return (
    <fme-flag
      flag="new-feature"
      workspace="ws_123"
      env="prod"
      api-url="https://fme-kit-api.vercel.app/api"
    />
  );
}
```

### Vue

```vue
<template>
  <fme-flag
    flag="new-feature"
    workspace="ws_123"
    env="prod"
    api-url="https://fme-kit-api.vercel.app/api"
    @state-changed="handleStateChange"
  />
</template>

<script setup>
import './fme-flag.js';

function handleStateChange(event) {
  console.log('State changed:', event.detail);
}
</script>
```

### Angular

```typescript
// app.component.ts
import './fme-flag.js';

@Component({
  selector: 'app-root',
  template: `
    <fme-flag
      flag="new-feature"
      workspace="ws_123"
      env="prod"
      (state-changed)="onStateChange($event)"
    ></fme-flag>
  `,
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class AppComponent {
  onStateChange(event: CustomEvent) {
    console.log('State changed:', event.detail);
  }
}
```

## Deployment

### Backend (Vercel)

```bash
cd fme-kit-api
npm run deploy
```

The API will be deployed to Vercel serverless functions.

### Frontend (CDN)

Host `client/fme-flag.js` on any static hosting service (Vercel, Netlify, S3 + CloudFront, etc.).

```html
<script type="module" src="https://cdn.example.com/fme-flag.js"></script>
```

## Architecture

**Backend:**
- Express.js serverless API
- Thin wrapper around Split.io API
- Simplifies RFC 6902 PATCH format and nested response structures
- Single service account authentication

**Frontend:**
- Custom Web Component (`<fme-flag>`)
- Shadow DOM for style isolation
- Vanilla JavaScript (zero dependencies)
- Framework-agnostic (works in React, Vue, Angular, etc.)
- Configurable polling for real-time updates

## Development

### Project Structure

```
kit/
├── fme-kit-api/          # Backend API
│   ├── api/
│   │   └── index.js      # Express routes
│   ├── lib/
│   │   └── split-client.js  # Split.io utilities
│   ├── server.js         # Local dev server
│   ├── package.json
│   └── .env              # API key configuration
└── client/
    ├── fme-flag.js       # Web Component
    └── demo.html         # Demo page
```

### Testing

1. **Backend API:**
   ```bash
   # Health check
   curl http://localhost:3000/api/health
   
   # List flags
   curl "http://localhost:3000/api/flags?workspace=ws_123&env=prod"
   
   # Toggle flag
   curl -X POST http://localhost:3000/api/flags/my-flag/toggle \
     -H "Content-Type: application/json" \
     -d '{"workspace":"ws_123","env":"prod","state":"on"}'
   ```

2. **Web Component:**
   - Open `client/demo.html` in browser
   - Update workspace/env attributes
   - Click buttons to toggle, kill, restore
   - Check event log for real-time updates

## License

ISC

## Author

David Martin (david.martin@harness.io)
