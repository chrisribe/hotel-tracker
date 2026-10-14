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

const kindFields = document.querySelectorAll('input[name="kind"]');
function updateDestination() {
  const destination = document.querySelector('[data-destination-field]');
  if (!destination) return;
  const isDestination = document.querySelector('input[name="kind"]:checked')?.value === 'destination';
  destination.hidden = isDestination;
  destination.querySelector('select').disabled = isDestination;
}
kindFields.forEach(input => input.addEventListener('change', updateDestination));
updateDestination();

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