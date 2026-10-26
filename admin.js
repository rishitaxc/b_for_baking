(() => {
  let csrf = '', setup = false, authenticated = false, offset = 0, orderItems = [], currentOrder = null;
  let statuses = [];
  const $ = selector => document.querySelector(selector);
  const money = paise => paise === null || paise === undefined ? 'Not quoted' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);
  const date = value => new Date(value.length === 10 ? value + 'T12:00:00+05:30' : value).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
  function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }
  function errorBanner(message = '') { $('#dashboard-error').textContent = message; $('#dashboard-error').hidden = !message; }
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}), ...options.headers } });
    const value = await response.json();
    if (!response.ok) { if (response.status === 401 && authenticated) { authenticated = false; csrf = ''; if ($('#order-dialog').open) $('#order-dialog').close(); $('#dashboard').hidden = true; $('#auth-screen').hidden = false; $('#auth-error').textContent = 'Your session has ended. Please sign in again.'; } throw new Error(value.error || 'This request could not be completed.'); }
    return value;
  }
  function populateStatuses() {
    for (const selector of ['#status-filter', '#edit-status']) { const select = $(selector), previous = select.value; select.replaceChildren(); if (selector === '#status-filter') { const all = node('option', 'All statuses'); all.value = ''; select.append(all); } for (const status of statuses) { const option = node('option', status); option.value = status; select.append(option); } if ([...select.options].some(o => o.value === previous)) select.value = previous; }
  }
  async function boot() {
    try {
      const session = await api('/api/admin/session'); setup = !session.configured;
      if (session.authenticated) { csrf = session.csrf; await enterDashboard(session.username); return; }
      $('#auth-screen').hidden = false; $('#dashboard').hidden = true;
      if (setup) {
        $('#auth-title').textContent = 'Make this little corner yours.'; $('#auth-description').textContent = session.setupAllowed ? 'Create your owner username and a password of at least 12 characters. Only you can access enquiries and insights.' : 'The owner account must be configured on localhost or through the hosting environment before signing in.';
        $('#login-button').textContent = 'Create owner account'; $('#confirm-label').hidden = false; $('#confirm-password').required = true; $('#password').minLength = 12; $('#password').autocomplete = 'new-password';
        if (!session.setupAllowed) $('#login-button').disabled = true;
      }
    } catch (error) { $('#auth-error').textContent = error.message || 'The backend is unavailable. Open this dashboard through the Node server.'; }
  }
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('#login-button'); button.disabled = true; $('#auth-error').textContent = '';
    try {
      if (setup && $('#password').value !== $('#confirm-password').value) throw new Error('The passwords do not match.');
      const result = await api(setup ? '/api/admin/setup' : '/api/admin/login', { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value }) });
      csrf = result.csrf; $('#password').value = ''; $('#confirm-password').value = ''; setup = false; $('#confirm-label').hidden = true; $('#confirm-password').required = false; $('#login-button').textContent = 'Sign in'; await enterDashboard(result.username);
    } catch (error) { $('#auth-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  async function enterDashboard(username) { authenticated = true; $('#auth-screen').hidden = true; $('#dashboard').hidden = false; $('#owner-greeting').textContent = `Hello, ${username}. Here’s your bakery today.`; await refresh(); }
  function view(name) { document.querySelectorAll('.admin-view').forEach(section => section.hidden = section.id !== 'view-' + name); document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name)); errorBanner(); if (name === 'orders') loadOrders().catch(error => errorBanner(error.message)); }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => view(button.dataset.view)));
  $('#view-all-orders').addEventListener('click', () => view('orders'));
  function showChart(result) {
    const chart = $('#activity-chart'); chart.replaceChildren(); const values = new Map(result.daily.map(day => [day.day, day])); let maximum = 1;
    result.daily.forEach(day => maximum = Math.max(maximum, day.views, day.instagram_clicks));
    const dayCount = result.period.days;
    for (let i = 0; i < dayCount; i++) {
      const current = new Date(result.period.from + 'T12:00:00Z'); current.setUTCDate(current.getUTCDate() + i); const key = current.toISOString().slice(0, 10), row = values.get(key) || { views: 0, instagram_clicks: 0 };
      const group = node('div', undefined, 'chart-day'); group.title = `${date(key)}: ${row.views} page views, ${row.instagram_clicks} Instagram clicks`; group.setAttribute('aria-label', group.title);
      const bars = node('div', undefined, 'chart-bars'); const views = node('span', undefined, 'view-bar'), clicks = node('span', undefined, 'click-bar'); views.style.height = (row.views / maximum * 100) + '%'; clicks.style.height = (row.instagram_clicks / maximum * 100) + '%'; bars.append(views, clicks); group.append(bars);
      if (i === 0 || i === dayCount - 1 || (dayCount <= 30 && i % 7 === 0)) group.append(node('small', String(current.getUTCDate()))); chart.append(group);
    }
    chart.setAttribute('aria-label', `Daily page views and Instagram clicks for the last ${dayCount} days. Hover over a day for values.`);
  }
  async function loadOverview() {
    const result = await api('/api/admin/overview?days=' + $('#report-days').value); statuses = result.statuses; populateStatuses();
    $('#metric-visitors').textContent = result.metrics.visitors.toLocaleString('en-IN'); $('#metric-instagram').textContent = result.metrics.instagramClicks.toLocaleString('en-IN'); $('#metric-instagram-visitors').textContent = result.metrics.instagramBrowsers.toLocaleString('en-IN'); $('#metric-orders').textContent = result.orders.total.toLocaleString('en-IN'); $('#metric-new').textContent = `${result.orders.new} new · ${result.orders.active} confirmed / in progress`; $('#pageview-total').textContent = result.metrics.pageViews + ' page views'; showChart(result);
    const labels = { profile: 'Instagram profile links', gallery_post: 'Original gallery posts', bot: 'Baker Bot links' }, sources = $('#instagram-sources'); sources.replaceChildren();
    for (const kind of ['profile', 'gallery_post', 'bot']) { const row = result.sources.find(source => source.source === kind); const item = node('div', undefined, 'source-row'); item.append(node('span', labels[kind]), node('strong', String(row?.clicks || 0))); sources.append(item); }
    const recent = await api('/api/admin/orders'); renderOrders($('#recent-orders'), recent.items.slice(0, 5));
  }
  function renderOrders(container, items) {
    container.replaceChildren();
    if (!items.length) { const empty = node('div', undefined, 'empty-state'); empty.append(node('span', '♡', 'empty-heart'), node('h3', 'The next sweet story starts here.'), node('p', 'New website enquiries will appear as soon as a customer submits the form.')); container.append(empty); return; }
    const wrap = node('div', undefined, 'table-scroll'), table = node('table'); const head = node('thead'), row = node('tr'); ['Customer', 'Celebration', 'Date', 'Status', 'Quote / balance', ''].forEach(label => row.append(node('th', label))); head.append(row); table.append(head); const body = node('tbody');
    items.forEach(item => {
      const tr = node('tr'), customer = node('td'); customer.append(node('strong', item.customer_name), node('small', item.reference)); const status = node('td'); status.append(node('span', item.status, 'status-badge ' + (['Confirmed', 'Baking', 'Ready', 'Completed'].includes(item.status) ? 'status-positive' : '')));
      const quote = node('td'); quote.append(node('span', money(item.total_paise))); if (item.total_paise !== null) quote.append(node('small', money(item.total_paise - item.advance_received_paise) + ' due'));
      const action = node('td'), button = node('button', 'Review ↗', 'text-button'); button.type = 'button'; button.setAttribute('aria-label', 'Review ' + item.reference); button.addEventListener('click', () => openOrder(item.id).catch(error => errorBanner(error.message))); action.append(button);
      tr.append(customer, node('td', item.occasion), node('td', date(item.event_date)), status, quote, action); body.append(tr);
    }); table.append(body); wrap.append(table); container.append(wrap);
  }
  async function loadOrders() {
    const query = new URLSearchParams({ offset: String(offset), search: $('#order-search').value, status: $('#status-filter').value }); const result = await api('/api/admin/orders?' + query);
    orderItems = result.items; renderOrders($('#order-list'), result.items); $('#order-count').textContent = result.total ? `${result.offset + 1}–${Math.min(result.offset + result.items.length, result.total)} of ${result.total} enquiries` : 'No enquiries yet'; $('#previous-page').disabled = offset === 0; $('#next-page').disabled = offset + result.limit >= result.total;
  }
  async function refresh() { errorBanner(); try { await loadOverview(); if (!$('#view-orders').hidden) await loadOrders(); } catch (error) { errorBanner(error.message); } }
  $('#refresh').addEventListener('click', refresh); $('#report-days').addEventListener('change', () => loadOverview().catch(error => errorBanner(error.message)));
  const search = () => { offset = 0; loadOrders().catch(error => errorBanner(error.message)); }; $('#search-orders').addEventListener('click', search); $('#status-filter').addEventListener('change', search); $('#order-search').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); search(); } });
  $('#previous-page').addEventListener('click', () => { offset = Math.max(0, offset - 50); loadOrders().catch(error => errorBanner(error.message)); }); $('#next-page').addEventListener('click', () => { offset += 50; loadOrders().catch(error => errorBanner(error.message)); });
  function detail(label, value) { const block = node('div'); block.append(node('small', label), node('strong', value === null || value === '' ? 'To discuss' : String(value))); $('#customer-details').append(block); }
  async function openOrder(id) {
    const result = await api('/api/admin/orders/' + id); currentOrder = result.order; const order = currentOrder;
    $('#detail-reference').textContent = order.reference; $('#detail-name').textContent = order.customer_name; $('#customer-details').replaceChildren();
    detail('PHONE', order.phone); detail('CELEBRATION', order.occasion); detail('CELEBRATION DATE', date(order.event_date)); detail('RECEIVED', date(order.created_at)); detail('GUESTS', order.guests); detail('WEIGHT ESTIMATE', order.estimated_kg ? order.estimated_kg + ' kg · planning estimate' : 'Not applicable / to discuss'); detail('PREFERRED WEIGHT', order.preferred_weight); detail('COLLECTION / DELIVERY', order.fulfilment);
    const design = $('#order-design'); design.replaceChildren(); design.append(node('h3', 'Preferred design'), node('p', order.design_summary, 'prewrap'));
    if (order.has_image) { const image = node('img'); image.src = '/api/admin/orders/' + id + '/image'; image.alt = 'Customer’s custom cake illustration'; design.append(image); }
    else if (/^\d+$/.test(order.design_id)) { const image = node('img'); image.src = '/assets/bake-' + order.design_id + '.jpg'; image.alt = order.design_summary; design.append(image); }
    if (order.design_reference) { const link = node('a', 'Open the customer’s design reference ↗', 'text-button'); link.href = order.design_reference; link.target = '_blank'; link.rel = 'noopener noreferrer'; design.append(link); }
    $('#customer-notes').textContent = order.details || 'No extra notes.';
    const contacts = $('#detail-contact'); contacts.replaceChildren(); const phone = node('a', 'Call customer ↗', 'secondary'); phone.href = 'tel:' + order.phone.replace(/[^+0-9]/g, ''); contacts.append(phone);
    const digits = order.phone.replace(/\D/g, ''); if (digits.length >= 10) { const chat = node('a', 'WhatsApp customer ↗', 'secondary'); chat.href = 'https://wa.me/' + (digits.length === 10 ? '91' : '') + digits + '?text=' + encodeURIComponent(`Hello ${order.customer_name}, this is B for Baking about your enquiry ${order.reference}.`); chat.target = '_blank'; chat.rel = 'noopener noreferrer'; contacts.append(chat); }
    const history = $('#order-history'); history.replaceChildren(); result.history.forEach(item => { const entry = node('div', undefined, 'history-row'); entry.append(node('small', date(item.created_at) + ' · ' + item.actor), node('p', item.summary)); history.append(entry); });
    $('#edit-status').value = order.status; $('#edit-total').value = order.total_paise === null ? '' : (order.total_paise / 100).toFixed(2); $('#edit-requested').value = (order.advance_requested_paise / 100).toFixed(2); $('#edit-received').value = (order.advance_received_paise / 100).toFixed(2); $('#edit-notes').value = order.owner_notes; $('#update-message').textContent = ''; updateBalance();
    if (!$('#order-dialog').open) $('#order-dialog').showModal();
  }
  function updateBalance() { const total = $('#edit-total').value, received = Number($('#edit-received').value || 0); $('#detail-balance').textContent = total === '' ? 'Not quoted' : money(Math.round((Number(total) - received) * 100)); }
  $('#edit-total').addEventListener('input', updateBalance); $('#edit-received').addEventListener('input', updateBalance); $('#close-order').addEventListener('click', () => $('#order-dialog').close());
  $('#order-update').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('#save-order'); button.disabled = true; $('#update-message').textContent = '';
    try {
      await api('/api/admin/orders/' + currentOrder.id, { method: 'PATCH', body: JSON.stringify({ revision: currentOrder.revision, status: $('#edit-status').value, totalPaise: $('#edit-total').value === '' ? null : Math.round(Number($('#edit-total').value) * 100), advanceRequestedPaise: Math.round(Number($('#edit-requested').value) * 100), advanceReceivedPaise: Math.round(Number($('#edit-received').value) * 100), ownerNotes: $('#edit-notes').value }) });
      await openOrder(currentOrder.id); $('#update-message').textContent = 'Saved. Your order details are up to date.'; await refresh();
    } catch (error) { $('#update-message').textContent = error.message; } finally { button.disabled = false; }
  });
  $('#logout').addEventListener('click', async () => { try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); location.reload(); } catch (error) { errorBanner(error.message); } });
  $('#password-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form); const button = form.querySelector('button'); button.disabled = true;
    try { if (data.get('newPassword') !== data.get('confirmPassword')) throw new Error('The new passwords do not match.'); await api('/api/admin/password', { method: 'POST', body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword') }) }); location.reload(); } catch (error) { $('#password-message').textContent = error.message; } finally { button.disabled = false; }
  });
  $('#export-orders').addEventListener('click', () => {
    const safeCell = value => { let s = String(value ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
    const rows = [['Reference', 'Customer', 'Phone', 'Occasion', 'Date', 'Status', 'Quote INR', 'Advance requested INR', 'Advance received INR', 'Balance INR'], ...orderItems.map(o => [o.reference, o.customer_name, o.phone, o.occasion, o.event_date, o.status, o.total_paise === null ? '' : o.total_paise / 100, o.advance_requested_paise / 100, o.advance_received_paise / 100, o.total_paise === null ? '' : (o.total_paise - o.advance_received_paise) / 100])];
    const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(row => row.map(safeCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); const link = node('a'); link.href = url; link.download = 'b-for-baking-orders.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  boot();
})();
