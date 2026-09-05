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

  const documentElement = document.documentElement;
  const previousIntro = documentElement.getAttribute('data-brand-intro');
  documentElement.setAttribute('data-brand-intro', 'true');
  const visibility = target.style.visibility;
  target.style.visibility = 'hidden';
  const animations: Animation[] = [];
  let finished = false;
  let trackingFrame = 0;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(fontTimeout);
    window.cancelAnimationFrame(trackingFrame);
    animations.forEach((animation) => animation.cancel());
    target.style.visibility = visibility;
    overlay.remove();
    if (previousIntro === null) documentElement.removeAttribute('data-brand-intro');
    else documentElement.setAttribute('data-brand-intro', previousIntro);
    window.removeEventListener('click', skip, true);
    overlay.removeEventListener('click', skip);
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
  // iOS Safari only synthesizes taps as clicks on an interactive target.
  // A window-only handler leaves this otherwise decorative veil untappable.
  overlay.addEventListener('click', skip);
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
    const boxes = Array.from(target.children, (child) => child.getBoundingClientRect());
    const fontSize = parseFloat(getComputedStyle(target).fontSize);
    const mark = target.cloneNode(true) as HTMLElement;
    mark.removeAttribute('aria-label');
    mark.classList.add('brand-intro__mark');
    mark.style.visibility = 'visible';
    mark.style.left = `${rect.left}px`;
    mark.style.top = `${rect.top}px`;
    overlay.append(mark);

    const [left, p, right] = Array.from(mark.children) as HTMLElement[];
    const pRect = boxes[1];
    const scale = Math.min(68, window.innerWidth * .18) / fontSize;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight * .4;
    const y = centerY - rect.height * scale / 2;
    const centeredP = centerX - (pRect.left - rect.left + pRect.width / 2) * scale;
    const centeredWord = centerX - rect.width * scale / 2;

    // Paint each run once at its largest displayed size. Flat layers only ever
    // scale DOWN: no magnified masthead bitmap, nested scale or per-frame text
    // layout/paint. Transform and opacity animation can stay on the compositor.
    const rasterSizes = [
      Math.max(fontSize, fontSize * scale),
      Math.max(fontSize, fontSize * scale * 1.85),
      Math.max(fontSize, fontSize * scale),
    ];
    [left, p, right].forEach((run, index) => {
      run.style.fontSize = `${rasterSizes[index]}px`;
    });
    const pose = (
      index: number, x: number, top: number, size: number,
      emphasis = 1, dx = 0, dy = 0,
    ): Keyframe => {
      const box = boxes[index];
      const xOffset = x - rect.left + size * (box.left - rect.left + box.width * (1 - emphasis) / 2 + dx);
      const yOffset = top - rect.top + size * (box.top - rect.top + box.height * (1 - emphasis) * .6 + dy);
      return { transform: `translate(${xOffset}px, ${yOffset}px) scale(${fontSize * size * emphasis / rasterSizes[index]})` };
    };
    const pOpening = pose(1, centeredP, y, scale, 1.85);
    const pComposed = pose(1, centeredWord, y, scale);
    const travel = animate(p, [
      { ...pose(1, centeredP, y, scale, 1.85, 0, .08 * fontSize * 1.85), opacity: 0, offset: 0, easing: EASE },
      { ...pOpening, opacity: 1, offset: .17 },
      { ...pOpening, opacity: 1, offset: .2, easing: EASE },
      { ...pComposed, opacity: 1, offset: .47 },
      { ...pComposed, opacity: 1, offset: .54, easing: EASE },
      { ...pose(1, rect.left, rect.top, 1), opacity: 1, offset: 1 },
    ]);
    [left, right].forEach((side, index) => {
      const runIndex = index === 0 ? 0 : 2;
      const opening = pose(runIndex, centeredP, y, scale, 1, (index ? -.3 : .3) * fontSize);
      const composed = pose(runIndex, centeredWord, y, scale);
      animate(side, [
        { ...opening, opacity: 0, offset: 0 },
        { ...opening, opacity: 0, offset: .24, easing: EASE },
        { ...composed, opacity: 1, offset: .49 },
        { ...composed, opacity: 1, offset: .54, easing: EASE },
        { ...pose(runIndex, rect.left, rect.top, 1), opacity: 1, offset: 1 },
      ]);
    });
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
    // WKWebView can publish safe-area/visible-viewport insets after startup.
    // Follow the live masthead, easing any correction instead of landing on a
    // stale pre-notch coordinate then revealing the header somewhere else.
    let destinationX = rect.left;
    let destinationY = rect.top;
    let correction: Animation | null = null;
    let travelComplete = false;
    let alignedFrames = 0;
    const trackLanding = () => {
      if (finished) return;
      const destination = target.getBoundingClientRect();
      if (Math.abs(destination.left - destinationX) > .1 || Math.abs(destination.top - destinationY) > .1) {
        const painted = mark.getBoundingClientRect();
        correction?.cancel();
        destinationX = destination.left;
        destinationY = destination.top;
        const transform = `translate(${destinationX - rect.left}px, ${destinationY - rect.top}px)`;
        mark.style.transform = transform;
        const update = mark.animate([
          { transform: `translate(${painted.left - rect.left}px, ${painted.top - rect.top}px)` },
          { transform },
        ], { duration: 160, easing: EASE });
        correction = update;
        animations.push(update);
        void update.finished.then(() => {
          if (correction === update) correction = null;
        }, () => {});
        alignedFrames = 0;
      }
      if (travelComplete && !correction && ++alignedFrames >= 2) return finish();
      trackingFrame = window.requestAnimationFrame(trackLanding);
    };
    trackingFrame = window.requestAnimationFrame(trackLanding);
    // Keep the clone until both the flight and any late inset correction end.
    void travel.finished.then(() => { travelComplete = true; }, finish);
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
