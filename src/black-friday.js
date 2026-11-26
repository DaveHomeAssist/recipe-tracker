(() => {
  const closesAt = new Date('2026-12-03T12:15:00-05:00');
  const links = document.querySelectorAll('[data-black-friday-nav]');
  const deals = document.getElementById('black-friday-deals');
  const ended = document.getElementById('black-friday-ended');
  const deadline = document.getElementById('black-friday-deadline');
  let expirationTimer;

  if (deadline) {
    deadline.dateTime = closesAt.toISOString();
    deadline.textContent = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZoneName: 'short',
    }).format(closesAt);
  }

  function updateAvailability() {
    clearTimeout(expirationTimer);
    const millisecondsLeft = closesAt.getTime() - Date.now();
    const active = millisecondsLeft > 0;
    const activeElement = document.activeElement;
    const focusInDeals = deals?.contains(activeElement);
    const focusOnTab = Array.from(links).includes(activeElement);

    for (const link of links) link.hidden = !active;
    if (deals) deals.hidden = !active;
    if (ended) ended.hidden = active;
    if (!active && focusInDeals) ended.querySelector('h1').focus();
    else if (!active && focusOnTab) document.querySelector('.app-brand').focus();
    if (active) expirationTimer = setTimeout(updateAvailability, Math.min(millisecondsLeft, 2 ** 31 - 1));
  }

  updateAvailability();
  window.addEventListener('pageshow', updateAvailability);
  document.addEventListener('visibilitychange', updateAvailability);
})();
