const DURATION = 1800;
const EASE = 'cubic-bezier(.22, 1, .36, 1)';

/** Animate only a decorative clone, never the route or its fixed controls. */
export function playBrandIntro(
  target: HTMLElement,
  motionPreference: MediaQueryList,
  { duration = DURATION, pauseAt }: { duration?: number; pauseAt?: number } = {},
): () => void {
  if (typeof target.animate !== 'function' || !document.fonts?.load) return () => {};

  const overlay = document.createElement('div');
  overlay.className = 'brand-intro';
  overlay.setAttribute('aria-hidden', 'true');
  const veil = document.createElement('div');
  veil.className = 'brand-intro__veil';
  overlay.append(veil);
  document.body.append(overlay);

  const visibility = target.style.visibility;
  target.style.visibility = 'hidden';
  const animations: Animation[] = [];
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(fontTimeout);
    animations.forEach((animation) => animation.cancel());
    target.style.visibility = visibility;
    overlay.remove();
    window.removeEventListener('click', skip, true);
    window.removeEventListener('keydown', skip, true);
    window.removeEventListener('wheel', finish, true);
    window.removeEventListener('resize', finish);
    window.removeEventListener('scroll', finish, true);
    document.removeEventListener('visibilitychange', finish);
    motionPreference.removeEventListener('change', finish);
  };

  const skip = (event: Event) => {
    // A tap to dismiss must not activate an unseen control beneath the veil.
    // Tab still reveals the page and proceeds with normal keyboard navigation.
    if (event.type === 'click' || ['Enter', ' '].includes((event as KeyboardEvent).key)) {
      event.preventDefault();
      event.stopPropagation();
    }
    finish();
  };
  window.addEventListener('click', skip, true);
  window.addEventListener('keydown', skip, true);
  window.addEventListener('wheel', finish, true);
  window.addEventListener('resize', finish);
  window.addEventListener('scroll', finish, true);
  document.addEventListener('visibilitychange', finish);
  motionPreference.addEventListener('change', finish);

  const animate = (element: Element, keyframes: Keyframe[]) => {
    const animation = element.animate(keyframes, { duration, fill: 'both' });
    animations.push(animation);
    return animation;
  };

  const start = () => {
    if (finished) return;
    clearTimeout(fontTimeout);
    const rect = target.getBoundingClientRect();
    if (!rect.width || rect.bottom < 0 || rect.top > window.innerHeight) return finish();
    const mark = target.cloneNode(true) as HTMLElement;
    mark.removeAttribute('aria-label');
    mark.classList.add('brand-intro__mark');
    mark.style.visibility = 'visible';
    overlay.append(mark);

    const [left, p, right] = Array.from(mark.children) as HTMLElement[];
    const pRect = p.getBoundingClientRect();
    const fontSize = parseFloat(getComputedStyle(mark).fontSize);
    const scale = Math.min(68, window.innerWidth * .18) / fontSize;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight * .4;
    const y = centerY - rect.height * scale / 2;
    const centeredP = `translate(${centerX - (pRect.left + pRect.width / 2) * scale}px, ${y}px) scale(${scale})`;
    const centeredWord = `translate(${centerX - rect.width * scale / 2}px, ${y}px) scale(${scale})`;
    const landed = `translate(${rect.left}px, ${rect.top}px) scale(1)`;

    const travel = animate(mark, [
      { transform: centeredP, offset: 0 },
      { transform: centeredP, offset: .2, easing: EASE },
      { transform: centeredWord, offset: .47 },
      { transform: centeredWord, offset: .54, easing: EASE },
      { transform: landed, offset: 1 },
    ]);
    animate(p, [
      { opacity: 0, transform: 'scale(1.85) translateY(.08em)', offset: 0, easing: EASE },
      { opacity: 1, transform: 'scale(1.85) translateY(0)', offset: .17, easing: EASE },
      { opacity: 1, transform: 'scale(1)', offset: .47 },
      { opacity: 1, transform: 'scale(1)', offset: 1 },
    ]);
    [left, right].forEach((side, index) => animate(side, [
      { opacity: 0, transform: `translateX(${index ? '-.3' : '.3'}em)`, offset: 0 },
      { opacity: 0, transform: `translateX(${index ? '-.3' : '.3'}em)`, offset: .24, easing: EASE },
      { opacity: 1, transform: 'translateX(0)', offset: .49 },
      { opacity: 1, transform: 'translateX(0)', offset: 1 },
    ]));
    animate(veil, [
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: .4, easing: 'cubic-bezier(.4, 0, .2, 1)' },
      { opacity: 0, offset: .82 },
      { opacity: 0, offset: 1 },
    ]);

    const rule = document.createElement('div');
    rule.className = 'brand-intro__rule';
    rule.style.top = `${centerY + rect.height * scale / 2 + 28}px`;
    overlay.append(rule);
    animate(rule, [
      { opacity: 0, transform: 'scaleX(0)', offset: 0 },
      { opacity: 0, transform: 'scaleX(0)', offset: .23, easing: EASE },
      { opacity: .8, transform: 'scaleX(1)', offset: .43, easing: EASE },
      { opacity: 0, transform: 'scaleX(.6)', offset: .66 },
      { opacity: 0, transform: 'scaleX(.6)', offset: 1 },
    ]);

    if (pauseAt !== undefined) {
      animations.forEach((animation) => {
        animation.pause();
        animation.currentTime = duration * pauseAt;
      });
    }
    // Cancellation rejects finished; both normal completion and interruption
    // restore the real wordmark and remove every listener through the same path.
    void travel.finished.then(finish, finish);
  };

  // Font failure must never hold the UI behind a splash. Load both faces before
  // measuring so the final pose matches the live masthead, even on a cold visit.
  const fontTimeout = setTimeout(finish, 700);
  void Promise.all([
    document.fonts.load('300 64px Fraunces'),
    document.fonts.load('italic 400 64px Fraunces'),
  ]).then(start).catch(finish);
  return finish;
}
