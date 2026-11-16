/* Small things every page shares: a hairline under the header once the page scrolls, and blocks that fade up as
   they come into view. Without JavaScript everything simply shows. */
(() => {
  const top = document.querySelector('.top');
  if (top) {
    const edge = document.createElement('div');
    edge.style.cssText = 'position:absolute;top:0;height:1px;width:1px;';
    document.body.prepend(edge);
    new IntersectionObserver(([e]) => top.classList.toggle('scrolled', !e.isIntersecting)).observe(edge);
  }
  const blocks = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    blocks.forEach((b) => io.observe(b));
  } else blocks.forEach((b) => b.classList.add('in'));
})();
