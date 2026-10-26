(() => {
  const $ = selector => document.querySelector(selector);
  const make = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  $('#cake-quiz-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const category = $('#quiz-occasion').value, preferredStyle = $('#quiz-style').value;
    const guests = Number($('#quiz-guests').value), portion = Number($('#quiz-portion').value);
    const styleLabel = $('#quiz-style option:checked').textContent;
    const budget = $('#quiz-budget').value, kg = Math.ceil(guests * portion / 500) / 2;
    const candidates = creations.filter(item => item.occasions.includes(category));
    const matches = candidates.filter(item => preferredStyle === 'all' || item.tags.includes(preferredStyle));
    const suggestions = (matches.length ? matches : candidates).slice(0, 3);
    const plan = `${guests} guests · ${portion} g per guest · approximately ${kg} kg, rounded up to the next 0.5 kg. The bakery will confirm final weight and servings.`;
    $('#quiz-summary').textContent = plan + (preferredStyle !== 'all' && !matches.length ? ' We do not have an exact style match in this occasion; these are other occasion ideas you can personalise.' : ' These designs match your occasion' + (preferredStyle === 'all' ? '.' : ' and preferred style.')) + (budget ? ` Your total budget is ₹${Number(budget).toLocaleString('en-IN')}; the bakery will confirm which design and size are possible within it.` : ' Ask the bakery for a personalised quote.');
    const results = $('#quiz-designs'); results.replaceChildren();
    for (const item of suggestions) {
      const card = make('article', undefined, 'quiz-card');
      const image = make('img'); image.src = `assets/bake-${item.image}.jpg`; image.alt = item.label; image.loading = 'lazy';
      const title = make('h4', item.title), button = make('button', 'Choose this design ↗', 'button'); button.type = 'button';
      button.addEventListener('click', () => {
        selectOccasion(category); chooseDesign(item);
        $('#guest-count').value = String(guests); $('#portion-size').value = String(portion);
        $('#order-type').dispatchEvent(new Event('change')); updateWeightEstimate();
        const notes = $('#order-form [name="details"]');
        const quizNote = `Cake quiz: ${guests} guests; ${portion} g servings; estimated ${kg} kg; preferred style: ${styleLabel}${budget ? `; total budget ₹${budget} (quote required)` : ''}.`;
        notes.value = (notes.value.replace(/\n?Cake quiz:.*$/m, '').trim() + '\n' + quizNote).slice(0, 1800);
      });
      card.append(image, title, button); results.append(card);
    }
    $('#quiz-results').hidden = false; $('#quiz-results').focus({ preventScroll: true });
    $('#quiz-results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  });
  $('#track-order-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = form.querySelector('button'), result = $('#tracking-result');
    if (button.disabled) return;
    button.disabled = true; button.textContent = 'Checking your order…'; result.hidden = false; result.className = 'tracking-result'; result.textContent = 'Looking up your latest update…';
    try {
      const response = await fetch('/api/orders/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: $('#track-reference').value.trim(), phone: $('#track-phone').value.trim() }) });
      let value; try { value = await response.json(); } catch { throw new Error('The order tracker is unavailable. Please contact the bakery or try again later.'); }
      if (!response.ok) throw new Error(value.error || 'We could not check your order.');
      result.replaceChildren();
      result.classList.toggle('order-accepted', value.accepted);
      result.append(make('p', value.reference, 'eyebrow'), make('h3', value.status === 'Cancelled' ? 'Order cancelled' : value.accepted ? 'Your order is accepted ♡' : 'Awaiting confirmation'), make('strong', value.status), make('p', value.message));
      result.append(make('p', 'Last updated: ' + new Date(value.updatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST. Check again for the latest update.'));
    } catch (error) { result.className = 'tracking-result form-error'; result.textContent = error instanceof TypeError ? 'Cannot reach the bakery server. Please try again later or contact the bakery.' : error.message; }
    finally { button.disabled = false; button.textContent = 'Check my order ↗'; }
  });
  // Clear the previous result as soon as lookup details change.
  $('#track-order-form').addEventListener('input', () => { $('#tracking-result').hidden = true; $('#tracking-result').replaceChildren(); });
})();
