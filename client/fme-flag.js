// FME Flag Web Component
// Embeddable feature flag control with polling support

class FmeFlagElement extends HTMLElement {
  static get observedAttributes() {
    return ['flag', 'workspace', 'env', 'api-url', 'poll-interval', 'compact'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.pollTimer = null;
    this._state = 'loading';
    this._flagData = null;
    this._error = null;
    this._modalOpen = false; // Track if modal is open

    // Authentication state
    this._authState = 'checking'; // 'checking' | 'unauthenticated' | 'authenticated'
    this._authToken = null;
    this._loginError = null;
  }

  // Public getters for external access
  get state() { return this._state; }
  get flagData() { return this._flagData; }
  get error() { return this._error; }
  get modalOpen() { return this._modalOpen; }
  get authState() { return this._authState; }
  get authToken() { return this._authToken; }

  connectedCallback() {
    // Parse attributes
    this.flagName = this.getAttribute('flag');
    this.workspace = this.getAttribute('workspace');
    this.env = this.getAttribute('env');
    this.apiUrl = this.getAttribute('api-url') || 'http://localhost:3000/api';
    this.pollInterval = parseInt(this.getAttribute('poll-interval') || '60000'); // Default 60s
    this.compact = this.hasAttribute('compact');

    // Listen for shared session events
    this._handleLoginEvent = (e) => {
      console.log('[FME Flag] Login event received');
      this._authToken = e.detail?.token || sessionStorage.getItem('fme-kit-auth-token');
      this._authState = 'authenticated';
      this._loginError = null;
      this.render();
      this.fetchStatus();
      if (this.pollInterval > 0) {
        this.startPolling();
      }
    };

    this._handleLogoutEvent = () => {
      console.log('[FME Flag] Logout event received');
      this._authToken = null;
      this._authState = 'unauthenticated';
      this._loginError = 'Session expired, please login again';
      this.stopPolling();
      this.render();
    };

    window.addEventListener('fme-kit-login', this._handleLoginEvent);
    window.addEventListener('fme-kit-logout', this._handleLogoutEvent);

    // Check authentication status
    this.checkAuth();
  }

  disconnectedCallback() {
    // Clean up polling timer when component removed
    this.stopPolling();

    // Remove event listeners
    if (this._handleLoginEvent) {
      window.removeEventListener('fme-kit-login', this._handleLoginEvent);
    }
    if (this._handleLogoutEvent) {
      window.removeEventListener('fme-kit-logout', this._handleLogoutEvent);
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue && this.isConnected) {
      // Update the property
      if (name === 'flag') {
        this.flagName = newValue;
      } else if (name === 'workspace') {
        this.workspace = newValue;
      } else if (name === 'env') {
        this.env = newValue;
      } else if (name === 'api-url') {
        this.apiUrl = newValue || 'http://localhost:3000/api';
      } else if (name === 'poll-interval') {
        this.pollInterval = parseInt(newValue || '60000');
        if (this.pollInterval > 0) {
          this.startPolling();
        } else {
          this.stopPolling();
        }
        return; // Don't fetch for poll-interval changes
      } else if (name === 'compact') {
        this.compact = this.hasAttribute('compact');
        return; // Don't fetch for compact mode changes
      }

      // Only fetch if all required attributes are set
      if (this.flagName && this.workspace && this.env && this.apiUrl) {
        this.fetchStatus();
      }
    }
  }

  startPolling() {
    this.stopPolling(); // Clear any existing timer
    if (this.pollInterval > 0) {
      this.pollTimer = setInterval(() => this.fetchStatus(), this.pollInterval);
    }
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // Check authentication status
  checkAuth() {
    const token = sessionStorage.getItem('fme-kit-auth-token');
    console.log('[FME Flag] checkAuth - token exists:', !!token);
    if (token) {
      this._authToken = token;
      this._authState = 'authenticated';
      console.log('[FME Flag] checkAuth - authenticated, will fetch status');
      // Initial render and fetch
      this.render();
      this.fetchStatus();
      // Start polling if interval > 0
      if (this.pollInterval > 0) {
        this.startPolling();
      }
    } else {
      console.log('[FME Flag] checkAuth - no token, showing login form');
      this._authState = 'unauthenticated';
      this.render();
    }
  }

  // Handle login
  async handleLogin(username, password) {
    try {
      console.log('[FME Flag] Attempting login...');
      const response = await fetch(`${this.apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Login failed');
      }

      const data = await response.json();
      this._authToken = data.token;
      this._authState = 'authenticated';
      this._loginError = null;

      // Store token in sessionStorage
      sessionStorage.setItem('fme-kit-auth-token', data.token);

      // Emit login event for other components
      window.dispatchEvent(new CustomEvent('fme-kit-login', {
        detail: { token: data.token, username: data.username }
      }));

      console.log('[FME Flag] Login successful');

      // Initial fetch and start polling
      this.render();
      this.fetchStatus();
      if (this.pollInterval > 0) {
        this.startPolling();
      }
    } catch (err) {
      console.error('[FME Flag] Login error:', err);
      this._loginError = err.message;
      this.render();
    }
  }

  // Handle logout
  handleLogout() {
    this._authToken = null;
    this._authState = 'unauthenticated';
    sessionStorage.removeItem('fme-kit-auth-token');
    this.stopPolling();

    // Emit logout event for other components
    window.dispatchEvent(new Event('fme-kit-logout'));

    this.render();
  }

  // Submit login form
  submitLogin(event) {
    const formData = new FormData(event.target);
    const username = formData.get('username');
    const password = formData.get('password');
    this.handleLogin(username, password);
  }

  async fetchStatus() {
    // Skip fetch if modal is open (user is editing)
    if (this._modalOpen) {
      console.log('[FME Flag] Skipping fetch - modal is open');
      return;
    }

    // Skip fetch if required attributes are not set
    if (!this.flagName || !this.workspace || !this.env || !this.apiUrl) {
      console.log('[FME Flag] Skipping fetch - missing required attributes', {
        flagName: this.flagName,
        workspace: this.workspace,
        env: this.env,
        apiUrl: this.apiUrl
      });
      return;
    }

    try {
      const url = `${this.apiUrl}/flags/${encodeURIComponent(this.flagName)}/status?workspace=${encodeURIComponent(this.workspace)}&env=${encodeURIComponent(this.env)}`;
      console.log('[FME Flag] Fetching:', url);

      // Include Authorization header if authenticated
      const headers = {};
      if (this._authToken) {
        headers['Authorization'] = `Bearer ${this._authToken}`;
      }

      const response = await fetch(url, { headers });
      console.log('[FME Flag] Response status:', response.status);

      // Handle 401 - authentication required
      if (response.status === 401) {
        console.log('[FME Flag] 401 Unauthorized - logging out');
        this.handleLogout();
        return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      this._flagData = await response.json();
      console.log('[FME Flag] Data received:', this._flagData);
      this._state = 'ready';
      this._error = null;

      // Only render if modal is still closed
      if (!this._modalOpen) {
        this.render();
      }

      // Dispatch state-changed event
      console.log('[FME Flag] Dispatching state-changed event');
      this.dispatchEvent(new CustomEvent('state-changed', {
        detail: {
          name: this._flagData.name,
          state: this._flagData.state,
          allocation: this._flagData.allocation
        },
        bubbles: true,
        composed: true
      }));
    } catch (err) {
      console.error('[FME Flag] Fetch error:', err);
      this._state = 'error';
      this._error = err.message;

      // Only render if modal is closed
      if (!this._modalOpen) {
        this.render();
      }

      // Dispatch error event
      this.dispatchEvent(new CustomEvent('error', {
        detail: {
          message: err.message
        },
        bubbles: true,
        composed: true
      }));
    }
  }

  // Show the toggle modal for choosing treatment allocation
  showToggleModal() {
    // Mark modal as open (pauses polling and rendering)
    this._modalOpen = true;
    console.log('[FME Flag] Modal opened - polling paused');

    const treatments = this._flagData?.treatments || ['on', 'off'];
    const currentAllocation = this._flagData?.allocation || {};

    // Create modal HTML
    const modalHTML = `
      <div class="modal-overlay">
        <div class="modal">
          <div class="modal-header">Configure Flag Treatment</div>
          <div class="modal-body">
            ${treatments.map(treatment => {
              const currentSize = currentAllocation[treatment] || 0;
              return `
                <div class="treatment-row">
                  <div class="treatment-radio">
                    <input type="radio" name="treatment-radio" value="${treatment}" id="radio-${treatment}">
                  </div>
                  <label class="treatment-label" for="radio-${treatment}">${treatment}</label>
                  <div class="treatment-allocation">
                    <input type="number" class="allocation-input" id="alloc-${treatment}"
                           value="${currentSize}" min="0" max="100" step="1">
                    <span>%</span>
                  </div>
                </div>
              `;
            }).join('')}
            <div class="validation-error" id="validation-error" style="display: none;"></div>
          </div>
          <div class="modal-footer">
            <button class="modal-btn cancel" onclick="this.getRootNode().host.closeModal()">Cancel</button>
            <button class="modal-btn apply" id="apply-btn" onclick="this.getRootNode().host.applyToggle()">Apply</button>
          </div>
        </div>
      </div>
    `;

    // Add modal to shadow DOM
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHTML;
    modalContainer.id = 'modal-container';
    this.shadowRoot.appendChild(modalContainer);

    // Add event listeners
    const radioInputs = this.shadowRoot.querySelectorAll('input[name="treatment-radio"]');
    const allocInputs = this.shadowRoot.querySelectorAll('.allocation-input');

    // When radio is selected, set that treatment to 100% and others to 0
    radioInputs.forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          allocInputs.forEach(input => {
            const treatmentName = input.id.replace('alloc-', '');
            input.value = treatmentName === radio.value ? 100 : 0;
          });
          this.validateAllocation();
        }
      });
    });

    // When allocation is manually changed, validate
    allocInputs.forEach(input => {
      input.addEventListener('input', () => {
        // Clear any selected radio when manually editing
        radioInputs.forEach(r => r.checked = false);
        this.validateAllocation();
      });
    });

    this.validateAllocation();
  }

  validateAllocation() {
    const allocInputs = this.shadowRoot.querySelectorAll('.allocation-input');
    const errorDiv = this.shadowRoot.getElementById('validation-error');
    const applyBtn = this.shadowRoot.getElementById('apply-btn');

    let total = 0;
    allocInputs.forEach(input => {
      total += parseInt(input.value) || 0;
    });

    if (total !== 100) {
      errorDiv.textContent = `Total allocation must equal 100% (currently ${total}%)`;
      errorDiv.style.display = 'block';
      applyBtn.disabled = true;
    } else {
      errorDiv.style.display = 'none';
      applyBtn.disabled = false;
    }
  }

  closeModal() {
    const modal = this.shadowRoot.getElementById('modal-container');
    if (modal) {
      modal.remove();
    }

    // Mark modal as closed (resumes polling and rendering)
    this._modalOpen = false;
    console.log('[FME Flag] Modal closed - polling resumed');

    // Immediately refresh to get latest state
    this.fetchStatus();
  }

  async applyToggle() {
    const allocInputs = this.shadowRoot.querySelectorAll('.allocation-input');
    const allocations = {};

    allocInputs.forEach(input => {
      const treatment = input.id.replace('alloc-', '');
      const size = parseInt(input.value) || 0;
      if (size > 0) {
        allocations[treatment] = size;
      }
    });

    // Find primary treatment (highest allocation)
    const primaryTreatment = Object.entries(allocations)
      .sort((a, b) => b[1] - a[1])[0][0];
    const primaryAllocation = allocations[primaryTreatment];

    this.closeModal();

    // If it's 100% single treatment, use that
    if (primaryAllocation === 100) {
      await this.toggle(primaryTreatment, 100);
    } else {
      // Multi-treatment allocation - need to pass all treatments
      await this.toggleWithAllocations(allocations);
    }
  }

  async toggle(treatment, allocation = 100) {
    // If no treatment specified, cycle to next available treatment
    if (!treatment && this._flagData?.treatments?.length > 0) {
      const treatments = this._flagData.treatments;
      const currentState = this._flagData.state;
      const currentIndex = treatments.indexOf(currentState);
      const nextIndex = (currentIndex + 1) % treatments.length;
      treatment = treatments[nextIndex];
    }

    if (!treatment) {
      throw new Error('No treatment specified and no treatments available');
    }

    try {
      this._state = 'loading';
      this.render();

      // Include Authorization header if authenticated
      const headers = { 'Content-Type': 'application/json' };
      if (this._authToken) {
        headers['Authorization'] = `Bearer ${this._authToken}`;
      }

      const response = await fetch(`${this.apiUrl}/flags/${encodeURIComponent(this.flagName)}/toggle`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workspace: this.workspace,
          env: this.env,
          treatment,
          allocation
        })
      });

      // Handle 401 - authentication required
      if (response.status === 401) {
        console.log('[FME Flag] 401 Unauthorized - logging out');
        this.handleLogout();
        return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      this._flagData = await response.json();
      this._state = 'ready';
      this._error = null;
      this.render();

      // Dispatch state-changed event
      this.dispatchEvent(new CustomEvent('state-changed', {
        detail: {
          name: this._flagData.name,
          state: this._flagData.state,
          allocation: this._flagData.allocation
        },
        bubbles: true,
        composed: true
      }));
    } catch (err) {
      console.error('FME Flag toggle error:', err);
      this._state = 'error';
      this._error = err.message;
      this.render();

      // Auto-revert error after 5 seconds
      setTimeout(() => this.fetchStatus(), 5000);

      // Dispatch error event
      this.dispatchEvent(new CustomEvent('error', {
        detail: { message: err.message },
        bubbles: true,
        composed: true
      }));
    }
  }

  async kill() {
    try {
      this._state = 'loading';
      this.render();

      // Include Authorization header if authenticated
      const headers = { 'Content-Type': 'application/json' };
      if (this._authToken) {
        headers['Authorization'] = `Bearer ${this._authToken}`;
      }

      const response = await fetch(`${this.apiUrl}/flags/${encodeURIComponent(this.flagName)}/kill`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workspace: this.workspace,
          env: this.env
        })
      });

      // Handle 401 - authentication required
      if (response.status === 401) {
        console.log('[FME Flag] 401 Unauthorized - logging out');
        this.handleLogout();
        return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      this._flagData = { ...this._flagData, ...result };
      this._state = 'ready';
      this._error = null;
      this.render();

      // Dispatch state-changed event
      this.dispatchEvent(new CustomEvent('state-changed', {
        detail: {
          name: this.flagData.name,
          state: 'killed',
          allocation: { on: 0, off: 0 }
        },
        bubbles: true,
        composed: true
      }));
    } catch (err) {
      console.error('FME Flag kill error:', err);
      this._state = 'error';
      this._error = err.message;
      this.render();

      // Auto-revert error after 5 seconds
      setTimeout(() => this.fetchStatus(), 5000);

      // Dispatch error event
      this.dispatchEvent(new CustomEvent('error', {
        detail: { message: err.message },
        bubbles: true,
        composed: true
      }));
    }
  }

  async restore(treatment = null) {
    try {
      this._state = 'loading';
      this.render();

      const body = {
        workspace: this.workspace,
        env: this.env
      };

      // If treatment specified, include it; otherwise let backend auto-select
      if (treatment) {
        body.treatment = treatment;
      }

      // Include Authorization header if authenticated
      const headers = { 'Content-Type': 'application/json' };
      if (this._authToken) {
        headers['Authorization'] = `Bearer ${this._authToken}`;
      }

      const response = await fetch(`${this.apiUrl}/flags/${encodeURIComponent(this.flagName)}/restore`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      // Handle 401 - authentication required
      if (response.status === 401) {
        console.log('[FME Flag] 401 Unauthorized - logging out');
        this.handleLogout();
        return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      this._flagData = await response.json();
      this._state = 'ready';
      this._error = null;
      this.render();

      // Dispatch state-changed event
      this.dispatchEvent(new CustomEvent('state-changed', {
        detail: {
          name: this._flagData.name,
          state: this._flagData.state,
          allocation: this._flagData.allocation
        },
        bubbles: true,
        composed: true
      }));
    } catch (err) {
      console.error('FME Flag restore error:', err);
      this._state = 'error';
      this._error = err.message;
      this.render();

      // Auto-revert error after 5 seconds
      setTimeout(() => this.fetchStatus(), 5000);

      // Dispatch error event
      this.dispatchEvent(new CustomEvent('error', {
        detail: { message: err.message },
        bubbles: true,
        composed: true
      }));
    }
  }

  // Toggle with multiple treatment allocations
  async toggleWithAllocations(allocations) {
    try {
      this._state = 'loading';
      this.render();

      // Include Authorization header if authenticated
      const headers = { 'Content-Type': 'application/json' };
      if (this._authToken) {
        headers['Authorization'] = `Bearer ${this._authToken}`;
      }

      // Send the full allocations object to the API
      const response = await fetch(`${this.apiUrl}/flags/${encodeURIComponent(this.flagName)}/toggle`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workspace: this.workspace,
          env: this.env,
          allocations  // Send full allocations: {red: 50, green: 49, blue: 1}
        })
      });

      // Handle 401 - authentication required
      if (response.status === 401) {
        console.log('[FME Flag] 401 Unauthorized - logging out');
        this.handleLogout();
        return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      this._flagData = await response.json();
      this._state = 'ready';
      this._error = null;
      this.render();

      this.dispatchEvent(new CustomEvent('state-changed', {
        detail: {
          name: this._flagData.name,
          state: this._flagData.state,
          allocation: this._flagData.allocation
        },
        bubbles: true,
        composed: true
      }));
    } catch (err) {
      console.error('[FME Flag] Toggle with allocations error:', err);
      this._state = 'error';
      this._error = err.message;
      this.render();

      setTimeout(() => this.fetchStatus(), 5000);

      this.dispatchEvent(new CustomEvent('error', {
        detail: { message: err.message },
        bubbles: true,
        composed: true
      }));
    }
  }

  // Public method to manually refresh
  async refresh() {
    return this.fetchStatus();
  }

  render() {
    const state = this._state;
    const flagData = this._flagData;
    const error = this._error;

    const styles = `
      :host {
        display: block;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      }
      :host(:not([compact])) {
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 16px;
        background: white;
      }
      :host([compact]) {
        background: transparent;
        padding: 0;
        min-width: 400px;
      }

      /* Modal styles */
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.2s;
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .modal {
        background: white;
        border-radius: 12px;
        padding: 24px;
        min-width: 350px;
        max-width: 500px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        animation: slideUp 0.3s;
      }
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .modal-header {
        font-size: 18px;
        font-weight: 600;
        margin-bottom: 20px;
        color: #333;
      }
      .modal-body {
        margin-bottom: 20px;
      }
      .treatment-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px;
        border-radius: 6px;
        margin-bottom: 8px;
        background: #f9fafb;
      }
      .treatment-row:hover {
        background: #f3f4f6;
      }
      .treatment-radio {
        flex-shrink: 0;
      }
      .treatment-radio input[type="radio"] {
        width: 18px;
        height: 18px;
        cursor: pointer;
      }
      .treatment-label {
        flex: 1;
        font-size: 14px;
        font-weight: 500;
        color: #374151;
        cursor: pointer;
      }
      .treatment-allocation {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .allocation-input {
        width: 60px;
        padding: 6px 8px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 14px;
        text-align: right;
      }
      .allocation-input:focus {
        outline: none;
        border-color: #667eea;
      }
      .allocation-input:disabled {
        background: #f3f4f6;
        color: #9ca3af;
      }
      .validation-error {
        color: #ef4444;
        font-size: 13px;
        margin-top: 8px;
        padding: 8px 12px;
        background: #fee2e2;
        border-radius: 4px;
      }
      .modal-footer {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      }
      .modal-btn {
        padding: 10px 20px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      .modal-btn.cancel {
        background: #e5e7eb;
        color: #374151;
      }
      .modal-btn.cancel:hover {
        background: #d1d5db;
      }
      .modal-btn.apply {
        background: rgb(15, 76, 129);
        color: white;
      }
      .modal-btn.apply:hover {
        background: rgb(12, 61, 103);
      }
      .modal-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .compact-header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 16px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        color: white;
      }
      .compact-info {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
        min-width: 0;
      }
      .compact-icon {
        font-size: 20px;
        flex-shrink: 0;
      }
      .compact-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .compact-name {
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .compact-status {
        font-size: 11px;
        opacity: 0.9;
        font-weight: 400;
      }
      .compact-controls {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
      }
      .compact-btn {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.2s;
        white-space: nowrap;
      }
      .compact-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      }
      .compact-btn:active {
        transform: translateY(0);
      }
      .compact-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .compact-btn.toggle {
        background: rgb(15, 76, 129);
        color: white;
      }
      .compact-btn.kill {
        background: #ef4444;
        color: white;
      }
      .compact-btn.restore {
        background: #10b981;
        color: white;
      }
      .compact-btn.logout {
        background: #9ca3af;
        color: #e5e7eb;
        padding: 8px 12px;
        font-size: 16px;
        line-height: 1;
        border: 1px solid #6b7280;
        transition: all 0.2s;
      }
      .compact-btn.logout:hover {
        background: #ef4444;
        color: white;
        border-color: #dc2626;
        transform: translateY(-1px);
      }
      .loading {
        color: #666;
        font-size: 14px;
      }
      .error {
        color: #d32f2f;
        background: #ffebee;
        padding: 12px;
        border-radius: 4px;
        font-size: 14px;
      }
      .flag-name {
        font-weight: 600;
        font-size: 18px;
        margin-bottom: 12px;
        color: #333;
      }
      .state {
        display: inline-block;
        padding: 6px 14px;
        border-radius: 4px;
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .state.on {
        background: #4caf50;
        color: white;
      }
      .state.off {
        background: #9e9e9e;
        color: white;
      }
      .state.killed {
        background: #f44336;
        color: white;
      }
      .state.partial {
        background: #ff9800;
        color: white;
      }
      .state.unknown {
        background: #757575;
        color: white;
      }
      .allocation {
        font-size: 13px;
        color: #666;
        margin-top: 8px;
      }
      .controls {
        margin-top: 16px;
        display: flex;
        gap: 8px;
      }
      button {
        padding: 10px 18px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: opacity 0.2s;
      }
      button:hover:not(:disabled) {
        opacity: 0.9;
      }
      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      button.primary {
        background: #1976d2;
        color: white;
      }
      button.danger {
        background: #d32f2f;
        color: white;
      }
      button.logout-btn {
        background: #9ca3af;
        color: #e5e7eb;
        padding: 10px 14px;
        font-size: 16px;
        line-height: 1;
        border: 1px solid #6b7280;
        margin-left: auto;
      }
      button.logout-btn:hover {
        background: #ef4444;
        color: white;
        border-color: #dc2626;
      }

      /* Login form styles */
      .login-container {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 200px;
        padding: 20px;
      }
      .login-card {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 12px;
        padding: 32px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        color: white;
        max-width: 350px;
        width: 100%;
      }
      .login-header {
        font-size: 20px;
        font-weight: 600;
        margin-bottom: 24px;
        text-align: center;
      }
      .login-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .form-group label {
        font-size: 13px;
        font-weight: 500;
        opacity: 0.9;
      }
      .form-group input {
        padding: 10px 12px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        background: rgba(255,255,255,0.2);
        color: white;
        backdrop-filter: blur(10px);
      }
      .form-group input::placeholder {
        color: rgba(255,255,255,0.6);
      }
      .form-group input:focus {
        outline: none;
        background: rgba(255,255,255,0.3);
        box-shadow: 0 0 0 2px rgba(255,255,255,0.5);
      }
      .login-btn {
        padding: 12px;
        background: rgba(255,255,255,0.9);
        color: #667eea;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        margin-top: 8px;
      }
      .login-btn:hover {
        background: white;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      }
      .login-error {
        background: rgba(244, 67, 54, 0.9);
        color: white;
        padding: 10px 12px;
        border-radius: 6px;
        font-size: 13px;
        text-align: center;
      }
    `;

    let html;

    // Show login form if unauthenticated
    if (this._authState === 'unauthenticated' || this._authState === 'checking') {
      const errorMsg = this._loginError ? `<div class="login-error">${this._loginError}</div>` : '';
      html = `
        <div class="login-container">
          <div class="login-card">
            <div class="login-header">🔐 Authentication Required</div>
            <form class="login-form" onsubmit="event.preventDefault(); this.getRootNode().host.submitLogin(event);">
              ${errorMsg}
              <div class="form-group">
                <label for="username">Username</label>
                <input type="text" id="username" name="username" required autocomplete="username">
              </div>
              <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" required autocomplete="current-password">
              </div>
              <button type="submit" class="login-btn">Sign In</button>
            </form>
          </div>
        </div>
      `;
    } else if (state === 'loading') {
      html = '<div class="loading">Loading...</div>';
    } else if (state === 'error') {
      html = `<div class="error">Error: ${error}</div>`;
    } else {
      const nextState = flagData.state === 'on' ? 'off' : 'on';
      const isKilled = flagData.killed || flagData.state === 'killed';

      // Compact mode: header with buttons
      if (this.compact) {
        const treatments = flagData.treatments || [];
        const allocation = flagData.allocation || {};
        const currentState = flagData.state;

        // Format status: selected in bold, others in list, with % if not 100% single
        let statusText;
        if (flagData.killed || flagData.state === 'killed') {
          statusText = '🔴 KILLED';
        } else {
          // Check if it's 100% single treatment
          const isSingleTreatment = allocation[currentState] === 100;

          if (isSingleTreatment) {
            // Bold current, list others
            const emoji = {'red': '🔴', 'green': '🟢', 'blue': '🔵', 'on': '🟢', 'off': '⚫'}[currentState] || '⚪';
            const otherTreatments = treatments.filter(t => t !== currentState).slice(0, 4);
            const hasMore = treatments.length > 5;
            const othersList = otherTreatments.length > 0
              ? ` (${otherTreatments.join(', ')}${hasMore ? '...' : ''})`
              : '';
            statusText = `${emoji} <strong>${currentState}</strong>${othersList}`;
          } else {
            // Show all with percentages
            const allocPairs = Object.entries(allocation)
              .filter(([_, size]) => size > 0)
              .sort((a, b) => b[1] - a[1]) // Sort by percentage desc
              .slice(0, 5);
            const hasMore = Object.keys(allocation).length > 5;

            statusText = allocPairs
              .map(([treatment, size]) => {
                const emoji = {'red': '🔴', 'green': '🟢', 'blue': '🔵', 'on': '🟢', 'off': '⚫'}[treatment] || '⚪';
                const isCurrent = treatment === currentState;
                return isCurrent
                  ? `${emoji} <strong>${treatment} ${size}%</strong>`
                  : `${emoji} ${treatment} ${size}%`;
              })
              .join(', ') + (hasMore ? '...' : '');
          }
        }

        html = `
          <div class="compact-header">
            <div class="compact-info">
              <div class="compact-icon">🚩</div>
              <div class="compact-text">
                <div class="compact-name">${this.flagName}</div>
                <div class="compact-status">${statusText}</div>
              </div>
            </div>
            <div class="compact-controls">
              <button class="compact-btn toggle" onclick="this.getRootNode().host.showToggleModal()">
                Toggle
              </button>
              ${isKilled
                ? '<button class="compact-btn restore" onclick="this.getRootNode().host.restore()">Restore</button>'
                : '<button class="compact-btn kill" onclick="this.getRootNode().host.kill()">Kill</button>'}
              <button class="compact-btn logout" onclick="this.getRootNode().host.handleLogout()" title="Logout">
                ⏻
              </button>
            </div>
          </div>
        `;
      } else {
        // Full mode: show everything
        html = `
          <div class="flag-name">${this.flagName}</div>
          <div class="state ${flagData.state}">${flagData.state}</div>
          <div class="allocation">
            ON: ${flagData.allocation.on}% | OFF: ${flagData.allocation.off}%
          </div>
          <div class="controls">
            <button class="primary" onclick="this.getRootNode().host.toggle('${nextState}')">
              Toggle ${nextState.toUpperCase()}
            </button>
            ${isKilled
              ? '<button class="primary" onclick="this.getRootNode().host.restore()">Restore</button>'
              : '<button class="danger" onclick="this.getRootNode().host.kill()">Kill</button>'}
            <button class="logout-btn" onclick="this.getRootNode().host.handleLogout()" title="Logout">
              ⏻
            </button>
          </div>
        `;
      }
    }

    this.shadowRoot.innerHTML = `<style>${styles}</style>${html}`;
  }
}

// Register custom element
customElements.define('fme-flag', FmeFlagElement);
