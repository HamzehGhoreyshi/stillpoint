// "Install the game": turns the site into an app with its own icon.
//
// Chrome, Edge and Android fire an event when the site can be installed; we
// hold on to it and show our own Install button. iPhones and iPads have no
// such event - there the only way is Share > Add to Home Screen, so we show
// that as a tip instead. Nothing shows if the game is already installed.

export function setupInstall() {
  const btn = document.getElementById('btn-install');
  const tip = document.getElementById('install-tip');

  // offline support (production only: it would get in the way while developing)
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const installed =
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    navigator.standalone === true;
  if (installed) return;

  let offer = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep the browser's own banner away; use our button
    offer = e;
    btn.classList.remove('hidden');
  });
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!offer) return;
    offer.prompt();
    await offer.userChoice;
    offer = null;
    btn.classList.add('hidden');
  });
  addEventListener('appinstalled', () => btn.classList.add('hidden'));

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) {
    tip.textContent = 'Install: tap Share, then "Add to Home Screen"';
    tip.classList.remove('hidden');
  }
}
