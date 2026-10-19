'use strict';

// Forms and links work without JavaScript. This layer adds small conveniences.
const toast = document.getElementById('toast');
let toastTimer;
function announce(message) {
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

document.querySelectorAll('[data-invite-path]').forEach(input => {
  input.value = new URL(input.dataset.invitePath, window.location.origin).href;
  input.addEventListener('click', () => input.select());
});

document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const input = document.getElementById(button.dataset.copy);
    try {
      await navigator.clipboard.writeText(input.value);
      announce('Invite copied. Share it privately with your travel crew.');
    } catch {
      input.focus();
      input.select();
      announce('Select and copy the highlighted link.');
    }
  });
});

document.querySelectorAll('select[data-autosubmit]').forEach(select => {
  select.form.querySelector('[data-autosubmit-fallback]')?.setAttribute('hidden', '');
  select.addEventListener('change', () => select.form.requestSubmit());
});

document.querySelectorAll('form[method="post"]').forEach(form => {
  form.addEventListener('submit', event => {
    const confirmation = form.dataset.confirm || (event.submitter?.dataset.bookedRemoval ? 'Return this booked option to the shortlist? This changes the plan only; it does not cancel a reservation.' : '');
    if (confirmation && !window.confirm(confirmation)) {
      event.preventDefault();
      return;
    }
    // Defer until the browser has collected the form values.
    setTimeout(() => {
      const button = form.querySelector('button[type="submit"], button:not([type])');
      if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    }, 0);
  });
});
window.addEventListener('pageshow', () => {
  document.querySelectorAll('button[aria-busy]').forEach(button => {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  });
});

// While the Trip Butler has a request waiting, check every 20 s (only when the tab is visible, for up to
// an hour) and reload once the research lands. If someone is mid-question, just say so instead.
const butler = document.querySelector('[data-status-url]');
if (butler) {
  const textarea = butler.querySelector('textarea');
  const original = textarea?.value;
  const stopAt = Date.now() + 60 * 60 * 1000;
  const timer = setInterval(async () => {
    if (document.hidden) return;
    if (Date.now() > stopAt) return clearInterval(timer);
    try {
      const response = await fetch(butler.dataset.statusUrl, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const status = await response.json();
      if (status.waiting) return;
      clearInterval(timer);
      if (textarea && textarea.value !== original) announce('Research is in. Reload the page to see the new ideas.');
      else window.location.reload();
    } catch { /* offline for a moment; try again next tick */ }
  }, 20000);
}

// Without JavaScript, people clear a row to remove it and get one blank row to add.
document.querySelectorAll('[data-rows]').forEach(group => {
  const list = group.querySelector('[data-row-list]');
  const template = group.querySelector('[data-row-template]');
  const add = group.querySelector('[data-add-row]');
  const max = Number(group.dataset.max) || 12;
  group.querySelectorAll('[data-remove-row]').forEach(button => { button.hidden = false; });
  add.hidden = false;
  add.addEventListener('click', () => {
    if (list.children.length >= max) { announce(`You can add up to ${max} rows.`); return; }
    list.append(template.content.cloneNode(true));
    list.lastElementChild.querySelector('input:not([type="hidden"])').focus();
  });
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-row]');
    if (!button) return;
    const row = button.closest('[data-row]');
    if (list.children.length > 1) row.remove();
    else row.querySelectorAll('input').forEach(input => { input.value = ''; });
    add.focus();
  });
});

// Idea form: the visible fields, example text and suggested labels follow the chosen kind.
// The server renders everything for the initial kind, and leaves all fields visible for no-JS.
const ideaForm = document.querySelector('form[data-kind-form]');
if (ideaForm) {
  const kindForm = JSON.parse(ideaForm.dataset.kindForm);
  const starterLabels = new Set(Object.values(kindForm).flatMap(copy => copy.starters));
  const details = ideaForm.querySelector('[data-starter-rows]');
  const destinationField = ideaForm.querySelector('[data-destination-field]');

  // Includes the row templates, so rows added later get the same text.
  const findAll = selector => [ideaForm, ...[...ideaForm.querySelectorAll('template')].map(t => t.content)]
    .flatMap(root => [...root.querySelectorAll(selector)]);

  function showFields(kind) {
    // A field the kind doesn't use stays visible while it holds a value, so nothing disappears silently.
    ideaForm.querySelectorAll('[data-kinds]').forEach(field => {
      const used = field.dataset.kinds.split(' ').includes(kind);
      field.hidden = !used && ![...field.querySelectorAll('input')].some(input => input.value);
    });
    // A destination can't belong to another destination.
    destinationField.hidden = kind === 'destination';
    destinationField.querySelector('select').disabled = kind === 'destination';
  }

  function showText(copy) {
    findAll('[data-kind-text]').forEach(el => {
      const text = copy[el.dataset.kindText];
      if ('placeholder' in el) el.placeholder = text; else el.textContent = text;
    });
    ideaForm.querySelectorAll('datalist[data-kind-list]').forEach(datalist => {
      datalist.replaceChildren(...copy[datalist.dataset.kindList].map(label => new Option(label)));
    });
  }

  // Replace untouched starter rows (suggested label, no value) with the new kind's starters.
  function swapStarterRows(copy) {
    const list = details.querySelector('[data-row-list]');
    const template = details.querySelector('[data-row-template]');
    const label = row => row.querySelector('[name="detail_label"]');
    const value = row => row.querySelector('[name="detail_value"]');
    const untouched = row => !value(row).value.trim() && (!label(row).value || starterLabels.has(label(row).value));
    const starterRow = text => {
      const row = template.content.firstElementChild.cloneNode(true);
      label(row).value = text;
      value(row).placeholder = '';
      return row;
    };
    [...list.children].filter(untouched).forEach(row => row.remove());
    if (![...list.children].some(row => value(row).value.trim())) list.prepend(...copy.starters.map(starterRow));
    if (!list.children.length) list.append(template.content.cloneNode(true));
  }

  showFields(ideaForm.querySelector('input[name="kind"]:checked')?.value);
  ideaForm.querySelectorAll('input[name="kind"]').forEach(input => input.addEventListener('change', () => {
    const copy = kindForm[input.value];
    showFields(input.value);
    showText(copy);
    swapStarterRows(copy);
  }));
}

// Remote references can disappear or reject embedding. Keep the card usable.
function showImageFallback(image) {
  image.hidden = true;
  const fallback = image.closest('.reference-photo')?.querySelector('.photo-fallback');
  if (fallback) fallback.hidden = false;
}
document.querySelectorAll('[data-reference-image]').forEach(image => {
  image.addEventListener('error', () => showImageFallback(image));
  if (image.complete && image.naturalWidth === 0) showImageFallback(image);
});

// The server validates this too; JavaScript only offers immediate guidance.
document.querySelectorAll('[data-compare-form]').forEach(form => {
  const inputs = [...form.querySelectorAll('input[name="ids"]')];
  const count = form.querySelector('[data-compare-count]');
  const update = () => {
    const total = inputs.filter(input => input.checked).length;
    count.textContent = `${total} of 4 chosen${total < 2 ? ' · choose at least 2' : ''}`;
  };
  inputs.forEach(input => input.addEventListener('change', () => {
    if (inputs.filter(i => i.checked).length > 4) {
      input.checked = false;
      announce('Compare up to four options. Uncheck one to choose another.');
    }
    update();
  }));
  form.addEventListener('submit', event => {
    if (inputs.filter(input => input.checked).length < 2) {
      event.preventDefault();
      announce('Choose at least two options to compare.');
      inputs.find(input => !input.checked)?.focus();
    }
  });
  update();
});