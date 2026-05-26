# FME Kit

Lightweight REST API and embeddable Web Component for controlling Harness FME (Split.io) feature flags.

## What is FME Kit?

FME Kit simplifies feature flag management by providing:
- **Simplified REST API**: Clean wrapper around Split.io's complex API
- **Embeddable Web Component**: Drop-in flag controls for any web app
- **Real-time Polling**: Automatic updates to reflect changes from other users
- **Zero Dependencies**: Web component uses vanilla JavaScript

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
