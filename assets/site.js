/* Small things every page shares: a rule under the header once the page scrolls, the name in the header once the
   front page's nameplate has gone, today's date in the masthead, and blocks that fade up as they come into view.
   Without JavaScript everything simply shows. */
(() => {
  const top = document.querySelector('.top');
  if (top) {
    const edge = document.createElement('div');
    edge.style.cssText = 'position:absolute;top:0;height:1px;width:1px;';
    document.body.prepend(edge);
    new IntersectionObserver(([e]) => top.classList.toggle('scrolled', !e.isIntersecting)).observe(edge);
    // the front page's nameplate stands in for the name in the header until it scrolls away
    const plate = document.querySelector('.nameplate');
    if (plate) new IntersectionObserver(([e]) => top.classList.toggle('past-mast', !e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: '-58px 0px 0px 0px' }).observe(plate);
  }
  // the masthead carries today's date, like the day's paper
  const today = document.querySelector('[data-today]');
  if (today) {
    const d = new Date();
    today.dateTime = d.toISOString().slice(0, 10);
    today.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  const blocks = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    blocks.forEach((b) => io.observe(b));
  } else blocks.forEach((b) => b.classList.add('in'));
})();
