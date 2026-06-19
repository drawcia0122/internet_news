(function initAdultAgeGate() {
  const STORAGE_KEY = 'internet-news-adult-age-confirmed-v1';
  const ADULT_PATH_PATTERN = /\/adult-(?:trends|ranking|trending|magazine|campaign|sale|topic)\.html$/;

  let pendingHref = null;
  let overlayElement = null;
  let dialogElement = null;
  let approveButton = null;
  let declineButton = null;
  let previouslyFocusedElement = null;

  document.addEventListener('click', handleDocumentClick);
  window.addEventListener('keydown', handleWindowKeydown);

  function handleDocumentClick(event) {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (anchor.target && anchor.target !== '_self') return;

    const destination = getAdultDestination(anchor.getAttribute('href'));
    if (!destination || isAdultAgeConfirmed()) return;

    event.preventDefault();
    pendingHref = destination.href;
    showAdultAgeGate();
  }

  function handleWindowKeydown(event) {
    if (!overlayElement || overlayElement.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      handleDecline();
    }
    if (event.key === 'Tab') {
      trapFocus(event);
    }
  }

  function showAdultAgeGate() {
    ensureGateElements();
    document.body.classList.add('adult-age-gate-open');
    overlayElement.hidden = false;
    overlayElement.setAttribute('aria-hidden', 'false');
    dialogElement.setAttribute('aria-modal', 'true');
    previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => approveButton?.focus(), 0);
  }

  function closeAdultAgeGate() {
    if (!overlayElement) return;
    overlayElement.hidden = true;
    overlayElement.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('adult-age-gate-open');
    if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === 'function') {
      previouslyFocusedElement.focus();
    }
  }

  function ensureGateElements() {
    if (overlayElement) return;

    overlayElement = document.createElement('div');
    overlayElement.className = 'adult-age-gate-overlay';
    overlayElement.hidden = true;
    overlayElement.setAttribute('aria-hidden', 'true');

    dialogElement = document.createElement('section');
    dialogElement.className = 'adult-age-gate-dialog';
    dialogElement.setAttribute('role', 'dialog');
    dialogElement.setAttribute('aria-labelledby', 'adult-age-gate-title');
    dialogElement.setAttribute('aria-describedby', 'adult-age-gate-description');

    dialogElement.innerHTML = [
      '<div class="adult-age-gate-badge" aria-hidden="true">🔞</div>',
      '<p class="adult-age-gate-kicker">ちょっとだけ確認です</p>',
      '<h2 id="adult-age-gate-title">この先は大人向けのページです。</h2>',
      '<p id="adult-age-gate-description">18歳以上の方のみ、そのまま進んでください。</p>',
      '<div class="adult-age-gate-actions">',
      '<button class="adult-age-gate-approve" type="button">18歳以上なので見る</button>',
      '<button class="adult-age-gate-decline" type="button">トップに戻る</button>',
      '</div>',
    ].join('');

    overlayElement.appendChild(dialogElement);
    document.body.appendChild(overlayElement);

    approveButton = dialogElement.querySelector('.adult-age-gate-approve');
    declineButton = dialogElement.querySelector('.adult-age-gate-decline');

    approveButton?.addEventListener('click', handleApprove);
    declineButton?.addEventListener('click', handleDecline);
    overlayElement.addEventListener('click', (event) => {
      if (event.target !== overlayElement) return;
      handleDecline();
    });
  }

  function handleApprove() {
    markAdultAgeConfirmed();
    const destination = pendingHref;
    pendingHref = null;
    closeAdultAgeGate();
    if (destination) {
      window.location.href = destination;
    }
  }

  function handleDecline() {
    pendingHref = null;
    closeAdultAgeGate();
  }

  function trapFocus(event) {
    if (!approveButton || !declineButton) return;
    const focusable = [approveButton, declineButton].filter(Boolean);
    const firstElement = focusable[0];
    const lastElement = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  function getAdultDestination(href) {
    if (!href) return null;
    let destination;
    try {
      destination = new URL(href, window.location.href);
    } catch {
      return null;
    }
    if (destination.origin !== window.location.origin) return null;
    if (!ADULT_PATH_PATTERN.test(destination.pathname)) return null;
    return destination;
  }

  function isAdultAgeConfirmed() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function markAdultAgeConfirmed() {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // Ignore storage failures and continue for this navigation.
    }
  }
}());
