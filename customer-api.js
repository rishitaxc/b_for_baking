(() => {
  // Only a random browser identifier is used for analytics; no names or phone numbers go into metrics.
  const pageView = fetch('/api/metrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'page_view' }), keepalive: true }).catch(() => {});
  function wrapInstagram(link) {
    if (!(link instanceof HTMLAnchorElement)) return;
    let url; try { url = new URL(link.href); } catch { return; }
    if (!['instagram.com', 'www.instagram.com'].includes(url.hostname)) return;
    const source = link.id === 'lightbox-source' ? 'gallery_post' : link.closest('.baker-bot') ? 'bot' : 'profile';
    link.href = '/go/instagram?source=' + source + '&to=' + encodeURIComponent(url.href);
  }
  document.querySelectorAll('a').forEach(wrapInstagram);
  const observer = new MutationObserver(records => records.forEach(record => {
    if (record.type === 'attributes') wrapInstagram(record.target);
    for (const node of record.addedNodes) if (node instanceof Element) { wrapInstagram(node); node.querySelectorAll('a').forEach(wrapInstagram); }
  }));
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
  // Covers immediately-created links and keyboard/middle-button navigation as well.
  for (const event of ['click', 'auxclick']) document.addEventListener(event, e => wrapInstagram(e.target.closest?.('a')), true);

  let requestKey = '', fingerprint = '';
  function newKey() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join(''); }
  async function customPicture() {
    if (preferredDesign.value !== 'custom-build' || !savedCustomDesign) return null;
    const svg = savedCustomDesign.sketch.cloneNode(true); svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); svg.setAttribute('width', '1000'); svg.setAttribute('height', '900');
    const blobUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    try {
      const image = new Image(); image.src = blobUrl; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 900;
      const context = canvas.getContext('2d'); context.fillStyle = '#fff7f8'; context.fillRect(0, 0, 1000, 900); context.drawImage(image, 0, 0, 1000, 900);
      return canvas.toDataURL('image/png');
    } finally { URL.revokeObjectURL(blobUrl); }
  }
  document.querySelector('#order-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('.submit'), status = document.querySelector('#form-status');
    dateInput.min = localToday(); if (!form.reportValidity() || button.disabled) return;
    status.replaceChildren(); status.className = 'form-status'; button.disabled = true; button.textContent = 'Sending your enquiry…';
    try {
      const data = new FormData(form), hamper = data.get('type') === 'Hamper or gift';
      const payload = { name: data.get('name'), phone: data.get('phone'), type: data.get('type'), date: data.get('date'), designId: data.get('design'), reference: data.get('reference') || '', guests: hamper ? null : Number(data.get('guests')), portion: hamper ? null : Number(data.get('portion')), size: data.get('size') || '', fulfilment: data.get('fulfilment'), details: data.get('details') || '', website: data.get('website') || '', customConfig: preferredDesign.value === 'custom-build' ? savedCustomDesign?.configuration || null : null, customImage: await customPicture() };
      const nextFingerprint = JSON.stringify(payload); if (nextFingerprint !== fingerprint) { fingerprint = nextFingerprint; requestKey = newKey(); }
      const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, requestKey }) });
      let result; try { result = await response.json(); } catch { throw new Error('The order service is unavailable at this address. Please open the latest bakery website or contact the bakery.'); }
      if (!response.ok) { if (response.status === 409) { fingerprint = ''; requestKey = ''; } throw new Error(result.error || 'Your enquiry could not be saved. Please try again.'); }
      const heading = document.createElement('strong'); heading.textContent = 'Enquiry received · ' + result.reference;
      const note = document.createElement('p'); note.textContent = 'Your details are saved with the bakery. The bakery will confirm availability, design, price and arrangements before your order is confirmed. Please keep this reference.';
      const link = document.createElement('a'); link.className = 'text-link'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Follow up with the bakery on WhatsApp ↗';
      link.href = 'https://wa.me/917005246168?text=' + encodeURIComponent(`Hi B for Baking! I submitted enquiry ${result.reference}. My name is ${payload.name}. My celebration date is ${payload.date}. I’d like to follow up on the design and availability. Thank you!`);
      status.className = 'form-status enquiry-received'; status.append(heading, note, link); const track = document.createElement('a'); track.href = '#track-order'; track.className = 'text-link'; track.textContent = 'Check if my order is accepted →'; track.addEventListener('click', () => { document.querySelector('#track-reference').value = result.reference; document.querySelector('#track-phone').value = payload.phone; }); status.append(document.createElement('br'), track); status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) { status.className = 'form-status form-error'; status.textContent = error.message || 'We could not save your enquiry. Your details are still in the form. Please try again.'; }
    finally { button.disabled = false; button.textContent = 'Send enquiry to the bakery ↗'; }
  });
})();
