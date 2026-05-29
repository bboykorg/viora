/**
 * Главная страница Viora.
 *
 * Изменения:
 *  - Исправлен инвертированный тоггл «Живые обои»: теперь checked = включено.
 *  - Уважение prefers-reduced-motion: анимация по умолчанию выключается.
 *  - Анимация ставится на паузу при скрытой вкладке (экономит CPU).
 *  - Canvas использует devicePixelRatio для чёткости на Retina.
 *  - Анимация бэкграунда пропускает кадры, если вкладка скрыта.
 *  - Модалки имеют focus-trap + Escape для закрытия.
 *  - Пропуск анимации логотипа через кнопку и клик/Esc.
 *  - Используются Toast/Confirm из common.js.
 */
(() => {
  'use strict';

  const { Toast, Theme } = window.Viora;
  Theme.init();

  // ── DOM ────────────────────────────────────────────────────────────
  const canvasBg = document.getElementById('stars-bg');
  const canvasNebula = document.getElementById('nebula');
  const canvasMid = document.getElementById('stars-mid');
  const canvasFront = document.getElementById('stars-front');
  const canvasComets = document.getElementById('comets');
  const canvasParticles = document.getElementById('particles');
  const wallpaperToggle = document.getElementById('wallpaper-toggle');

  const ctxBg = canvasBg.getContext('2d');
  const ctxNebula = canvasNebula.getContext('2d');
  const ctxMid = canvasMid.getContext('2d');
  const ctxFront = canvasFront.getContext('2d');
  const ctxComets = canvasComets.getContext('2d');
  const ctxParticles = canvasParticles.getContext('2d');

  let width = window.innerWidth;
  let height = window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 2); // ограничиваем 2× для производительности
  let time = 0;
  let lastCometPackageTime = Date.now();
  let lastWarpJumpTime = Date.now();
  let nextCometDelay = 10000 + Math.random() * 15000;
  let animationFrameId = null;
  let isLiveWallpaperEnabled = true;
  let isLogoAnimationFinished = false;
  let tabHidden = false;

  // Уважаем prefers-reduced-motion
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Canvas resize с DPR ─────────────────────────────────────────────
  function resizeCanvas() {
    width = window.innerWidth;
    height = window.innerHeight;
    [canvasBg, canvasNebula, canvasMid, canvasFront, canvasComets, canvasParticles].forEach((c) => {
      c.width = Math.floor(width * dpr);
      c.height = Math.floor(height * dpr);
      c.style.width = width + 'px';
      c.style.height = height + 'px';
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }
  resizeCanvas();
  window.addEventListener('resize', () => { resizeCanvas(); rebuildStarsBase(); });

  // Pause animation when tab is hidden (saves CPU/battery)
  document.addEventListener('visibilitychange', () => {
    tabHidden = document.hidden;
    if (!tabHidden && isLiveWallpaperEnabled && isLogoAnimationFinished && !animationFrameId) {
      animateBackground();
    }
  });

  // ── Mouse ──────────────────────────────────────────────────────────
  let mouseX = width / 2;
  let mouseY = height / 2;
  if (window.matchMedia('(min-width: 769px)').matches) {
    document.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  }

  // ── Stars ──────────────────────────────────────────────────────────
  const STAR_COLORS = [
    [255, 255, 255], [100, 200, 255], [255, 255, 180], [200, 150, 255],
  ];
  const randStarColor = () => STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];

  const starsBg = [], starsMid = [], starsFront = [];

  function fillStars(arr, count, factory) {
    arr.length = 0;
    for (let i = 0; i < count; i++) {
      const star = factory();
      star.baseX = star.x; star.baseY = star.y;
      arr.push(star);
    }
  }

  function rebuildStarsBase() {
    // регенерируем baseX/baseY при ресайзе, иначе звёзды смещаются
    starsBg.forEach((s) => { s.baseX = s.x = (s.baseX / Math.max(1, s._prevW || width)) * width; s.baseY = s.y = (s.baseY / Math.max(1, s._prevH || height)) * height; s._prevW = width; s._prevH = height; });
    starsMid.forEach((s) => { s.baseX = s.x = (s.baseX / Math.max(1, s._prevW || width)) * width; s.baseY = s.y = (s.baseY / Math.max(1, s._prevH || height)) * height; s._prevW = width; s._prevH = height; });
    starsFront.forEach((s) => { s.baseX = s.x = (s.baseX / Math.max(1, s._prevW || width)) * width; s.baseY = s.y = (s.baseY / Math.max(1, s._prevH || height)) * height; s._prevW = width; s._prevH = height; });
  }

  fillStars(starsBg, 150, () => ({
    x: Math.random() * width, y: Math.random() * height, size: Math.random() * 1.5 + 0.3,
    speed: Math.random() * 0.0003 + 0.0001, phase: Math.random() * Math.PI * 2,
    maxBrightness: Math.random() * 0.4 + 0.3, color: STAR_COLORS[0],
  }));
  fillStars(starsMid, 100, () => ({
    x: Math.random() * width, y: Math.random() * height, size: Math.random() * 2 + 0.5,
    speed: Math.random() * 0.0005 + 0.0002, phase: Math.random() * Math.PI * 2,
    maxBrightness: Math.random() * 0.6 + 0.4, color: randStarColor(),
  }));
  fillStars(starsFront, 60, () => ({
    x: Math.random() * width, y: Math.random() * height, size: Math.random() * 2.5 + 1,
    speed: Math.random() * 0.0008 + 0.0003, phase: Math.random() * Math.PI * 2,
    maxBrightness: Math.random() * 0.9 + 0.7, color: [0, 217, 255],
  }));

  const auroraBands = [];
  for (let i = 0; i < 5; i++) {
    auroraBands.push({
      y: height * (0.2 + i * 0.15),
      color: i % 2 === 0 ? [0, 217, 255] : [168, 85, 247],
      baseOpacity: Math.random() * 0.08 + 0.02,
      waveFrequency: Math.random() * 0.01 + 0.005,
      waveAmplitude: Math.random() * 100 + 50,
    });
  }

  const comets = [], warpJumps = [];

  function createComet() {
    const side = Math.floor(Math.random() * 4);
    let x, y, angle;
    switch (side) {
      case 0: x = Math.random() * width; y = -50; angle = Math.random() * Math.PI / 3 + Math.PI / 3; break;
      case 1: x = width + 50; y = Math.random() * height; angle = Math.random() * Math.PI / 3 + Math.PI; break;
      case 2: x = Math.random() * width; y = height + 50; angle = Math.random() * Math.PI / 3 + Math.PI * 1.2; break;
      default: x = -50; y = Math.random() * height; angle = Math.random() * Math.PI / 3;
    }
    comets.push({ x, y, angle, speed: Math.random() * 2 + 1.5, length: Math.random() * 120 + 80, opacity: 1, maxOpacity: Math.random() * 0.3 + 0.6 });
  }

  function createCometPackage() {
    const num = Math.floor(Math.random() * 5) + 1;
    for (let i = 0; i < num; i++) setTimeout(createComet, i * 150 + Math.random() * 500);
    lastCometPackageTime = Date.now();
    nextCometDelay = 10000 + Math.random() * 15000;
  }

  function createWarpJump() {
    warpJumps.push({
      startX: Math.random() * width, startY: Math.random() * height,
      endX: Math.random() * width, endY: Math.random() * height,
      duration: Math.random() * 0.5 + 0.2, progress: 0, opacity: 1,
    });
    if (window.gsap && !reducedMotion) {
      gsap.to('body', { x: '+=10', y: '+=10', duration: 0.08, repeat: 1, yoyo: true, ease: 'sine.out', overwrite: true });
    }
  }

  // ── Логотип → частицы ──────────────────────────────────────────────
  const logoParticles = [];
  let logoDispersed = false;

  function createLogoParticles() {
    if (logoDispersed) return;
    logoDispersed = true;
    const svg = document.getElementById('viora-logo');
    const paths = svg.querySelectorAll('path, circle');
    paths.forEach((path) => {
      const length = path.getTotalLength ? path.getTotalLength() : 314;
      const num = Math.floor(length / 2);
      for (let i = 0; i < num; i++) {
        const point = path.getPointAtLength
          ? path.getPointAtLength((i / num) * length)
          : { x: 280 + 50 * Math.cos((i / num) * Math.PI * 2), y: 110 + 50 * Math.sin((i / num) * Math.PI * 2) };
        const rect = svg.getBoundingClientRect();
        const sx = rect.width / 550, sy = rect.height / 200;
        logoParticles.push({
          x: rect.left + point.x * sx, y: rect.top + point.y * sy,
          vx: (Math.random() - 0.5) * 7, vy: (Math.random() - 0.5) * 5,
          size: Math.random() * 2 + 1, opacity: 1,
          decay: Math.random() * 0.015 + 0.01,
          color: Math.random() > 0.5 ? [255, 255, 255] : [100, 200, 255],
        });
      }
    });
  }

  function animateLogoParticles() {
    ctxParticles.clearRect(0, 0, width, height);
    for (let i = logoParticles.length - 1; i >= 0; i--) {
      const p = logoParticles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.opacity -= p.decay;
      if (p.opacity <= 0) { logoParticles.splice(i, 1); continue; }
      ctxParticles.beginPath();
      ctxParticles.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      const c = `rgba(${p.color[0]}, ${p.color[1]}, ${p.color[2]}, ${p.opacity})`;
      ctxParticles.fillStyle = c;
      ctxParticles.shadowBlur = 10; ctxParticles.shadowColor = c;
      ctxParticles.fill();
      ctxParticles.shadowBlur = 0;
    }
    if (logoParticles.length > 0) requestAnimationFrame(animateLogoParticles);
  }

  function finishLogo() {
    const svg = document.getElementById('viora-logo');
    isLogoAnimationFinished = true;
    createLogoParticles();
    animateLogoParticles();
    if (window.gsap) gsap.to(svg, { opacity: 0, duration: 0.3, ease: 'power2.in' });
    else svg.style.opacity = '0';
    const logoScreen = document.getElementById('logo-screen');
    setTimeout(() => {
      logoScreen.classList.remove('active');
      const main = document.getElementById('main-screen');
      main.classList.add('active');
      const avatar = document.getElementById('profile-avatar');
      avatar.style.display = 'flex';
      // фокус на первую кнопку для клавиатуры
      const firstBtn = main.querySelector('.glass-button');
      firstBtn?.focus();
    }, 1000);
  }

  // GSAP-таймлайн логотипа
  function animateLogo() {
    if (!window.gsap || reducedMotion) {
      // если GSAP не загружен или пользователь не хочет анимаций — сразу к делу
      setTimeout(finishLogo, 100);
      return;
    }
    document.getElementById('logo-screen').classList.add('active');
    const sf = 0.3335;
    const V = 0.4 * sf, I = 0.3 * sf, O = 0.5 * sf, RM = 0.4 * sf, AD = 0.5 * sf, FG = 0.5 * sf, DD = 0.2 * sf;
    const vP = document.querySelectorAll('#v-1, #v-2');
    const iP = document.getElementById('letter-i');
    const oC = document.getElementById('letter-o');
    const rP = document.querySelectorAll('#r-1, #r-2, #r-3');
    const aP = document.querySelectorAll('#a-1, #a-2');
    const all = document.querySelectorAll('#viora-logo path, #viora-logo circle');
    all.forEach((p) => {
      const len = p.getTotalLength ? p.getTotalLength() : 314;
      p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
    });
    const tl = gsap.timeline({ delay: 0.5, onComplete: finishLogo });
    tl.to(vP[0], { strokeDashoffset: 0, duration: V, ease: 'power2.inOut', onStart: () => vP[0].style.filter = 'drop-shadow(0 0 10px rgba(0,217,255,0.8))' })
      .to(vP[0], { filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.3))', duration: V }, '+=0')
      .to(vP[1], { strokeDashoffset: 0, duration: V, ease: 'power2.inOut', onStart: () => vP[1].style.filter = 'drop-shadow(0 0 10px rgba(0,217,255,0.8))' }, `-=${V*0.7}`)
      .to(vP[1], { filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.3))', duration: V }, '+=0');
    tl.to(iP, { strokeDashoffset: 0, duration: I, ease: 'power3.out', onStart: () => iP.style.filter = 'drop-shadow(0 0 15px rgba(255,255,255,1))' }, `-=${V*0.5}`)
      .to(iP, { filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.3))', duration: I }, '+=0');
    tl.to(oC, { strokeDashoffset: 0, duration: O, ease: 'power2.inOut' }, `-=${I*0.5}`)
      .to(oC, { filter: 'drop-shadow(0 0 10px rgba(168,85,247,0.8))' }, `-=${O}`)
      .to(oC, { filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.3))', duration: O }, '+=0');
    tl.to(rP[0], { strokeDashoffset: 0, duration: I, ease: 'power2.out' }, `-=${O*0.5}`)
      .to(rP[1], { strokeDashoffset: 0, duration: RM, ease: 'power2.inOut', onStart: () => rP[1].style.filter = 'drop-shadow(0 0 10px rgba(168,85,247,0.8))' })
      .to(rP[1], { filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.3))', duration: RM }, '+=0')
      .to(rP[2], { strokeDashoffset: 0, duration: I, ease: 'power2.out' }, `-=${RM*0.5}`);
    tl.to(aP[0], { strokeDashoffset: 0, duration: AD, ease: 'power2.inOut', onStart: () => aP[0].style.filter = 'drop-shadow(0 0 10px rgba(0,217,255,0.8))' }, `-=${I*0.5}`)
      .to(aP[0], { filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.3))', duration: AD }, '+=0')
      .to(aP[1], { strokeDashoffset: 0, duration: I*0.5, ease: 'power3.out' }, `-=${I*0.5}`);
    tl.to('#viora-logo path, #viora-logo circle', { filter: 'drop-shadow(0 0 30px rgba(0,217,255,0.8))', duration: FG }, `+=${DD}`);
  }

  // ── Background animation ───────────────────────────────────────────
  function animateBackground() {
    if (tabHidden) {
      animationFrameId = null;
      return;
    }
    if (!isLiveWallpaperEnabled && comets.length === 0 && warpJumps.length === 0) {
      drawStaticBackground(true);
      animationFrameId = null;
      return;
    }
    if (isLiveWallpaperEnabled) time += 0.005;

    ctxBg.fillStyle = '#0a0a0f'; ctxBg.fillRect(0, 0, width, height);
    ctxNebula.clearRect(0, 0, width, height);
    ctxMid.clearRect(0, 0, width, height);
    ctxFront.clearRect(0, 0, width, height);
    ctxComets.clearRect(0, 0, width, height);

    // Градиент
    const gradient = ctxBg.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
    gradient.addColorStop(0, 'rgba(0,217,255,0.06)');
    gradient.addColorStop(0.4, 'rgba(168,85,247,0.03)');
    gradient.addColorStop(1, 'rgba(10,10,15,0)');
    ctxBg.fillStyle = gradient;
    ctxBg.fillRect(0, 0, width, height);

    // Aurora
    auroraBands.forEach((band) => {
      ctxNebula.beginPath();
      const [r, g, b] = band.color;
      const t = isLiveWallpaperEnabled ? time : 0;
      ctxNebula.moveTo(0, band.y + Math.sin(t * band.waveFrequency) * band.waveAmplitude);
      for (let x = 0; x <= width; x += 10) {
        ctxNebula.lineTo(x, band.y + Math.sin(x * 0.01 + t * band.waveFrequency) * band.waveAmplitude);
      }
      const grad = ctxNebula.createLinearGradient(0, band.y - band.waveAmplitude * 2, 0, band.y + band.waveAmplitude * 2);
      grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
      grad.addColorStop(0.5, `rgba(${r},${g},${b},${band.baseOpacity})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctxNebula.strokeStyle = grad;
      ctxNebula.lineWidth = band.waveAmplitude * 1.5;
      ctxNebula.lineCap = 'round';
      ctxNebula.shadowBlur = 40;
      ctxNebula.shadowColor = `rgba(${r},${g},${b},0.5)`;
      ctxNebula.stroke();
      ctxNebula.shadowBlur = 0;
    });

    // Stars
    const parallaxDepth = [0.01, 0.03, 0.08];
    const hoverRadius = 100;
    const isDesktop = window.matchMedia('(min-width: 769px)').matches;

    [starsBg, starsMid, starsFront].forEach((layer, idx) => {
      const ctx = idx === 0 ? ctxBg : idx === 1 ? ctxMid : ctxFront;
      const pf = isLiveWallpaperEnabled ? parallaxDepth[idx] : 0;
      layer.forEach((star) => {
        let cx = star.baseX, cy = star.baseY;
        let bright;
        let boost = 0;
        if (isLiveWallpaperEnabled) {
          const dxC = mouseX - width / 2, dyC = mouseY - height / 2;
          cx = star.baseX + dxC * pf * 0.3;
          cy = star.baseY + dyC * pf * 0.3;
          star.phase += star.speed;
          bright = Math.sin(star.phase) * 0.3 + 0.7;
        } else bright = 1;
        if (isDesktop) {
          const dxS = mouseX - cx, dyS = mouseY - cy;
          const dist = Math.sqrt(dxS * dxS + dyS * dyS);
          if (dist < hoverRadius) boost = (1 - dist / hoverRadius) * 0.5;
        }
        bright = Math.min(1, bright + boost);
        const a = bright * star.maxBrightness;
        const [r, g, b] = star.color;
        ctx.beginPath();
        ctx.arc(cx, cy, star.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        ctx.fill();
        if (a > 0.6) {
          ctx.shadowBlur = idx * 10 + 5;
          ctx.shadowColor = `rgba(${r},${g},${b},${a*0.8})`;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });
    });

    const now = Date.now();
    if (now - lastCometPackageTime > nextCometDelay) createCometPackage();
    if (isLiveWallpaperEnabled && now - lastWarpJumpTime > 15000 + Math.random() * 15000) {
      createWarpJump();
      lastWarpJumpTime = now;
    }

    // Comets
    comets.forEach((c, i) => {
      c.x += Math.cos(c.angle) * c.speed;
      c.y += Math.sin(c.angle) * c.speed;
      c.opacity -= 0.003;
      if (c.opacity <= 0 || c.x < -200 || c.x > width + 200 || c.y < -200 || c.y > height + 200) {
        comets.splice(i, 1); return;
      }
      const tx = c.x - Math.cos(c.angle) * c.length;
      const ty = c.y - Math.sin(c.angle) * c.length;
      const g = ctxComets.createLinearGradient(c.x, c.y, tx, ty);
      g.addColorStop(0, `rgba(168,85,247,${c.opacity*c.maxOpacity})`);
      g.addColorStop(0.5, `rgba(0,217,255,${c.opacity*c.maxOpacity*0.6})`);
      g.addColorStop(1, 'rgba(168,85,247,0)');
      ctxComets.strokeStyle = g;
      ctxComets.lineWidth = 3; ctxComets.lineCap = 'round';
      ctxComets.shadowBlur = 25; ctxComets.shadowColor = 'rgba(168,85,247,0.8)';
      ctxComets.beginPath(); ctxComets.moveTo(tx, ty); ctxComets.lineTo(c.x, c.y); ctxComets.stroke();
      ctxComets.shadowBlur = 0;
    });

    // Warp jumps
    warpJumps.forEach((j, i) => {
      j.progress += 0.05;
      if (j.progress >= 1) { warpJumps.splice(i, 1); return; }
      const cx = j.startX + (j.endX - j.startX) * j.progress;
      const cy = j.startY + (j.endY - j.startY) * j.progress;
      ctxComets.beginPath();
      ctxComets.moveTo(j.startX, j.startY);
      for (let t = 0; t <= j.progress; t += 0.05) {
        const x = j.startX + (j.endX - j.startX) * t;
        const y = j.startY + (j.endY - j.startY) * t;
        const offset = Math.sin(t * Math.PI * 10) * 10;
        const dx = j.endX - j.startX, dy = j.endY - j.startY;
        const nx = -dy / Math.sqrt(dx * dx + dy * dy);
        const ny = dx / Math.sqrt(dx * dx + dy * dy);
        ctxComets.lineTo(x + nx * offset, y + ny * offset);
      }
      ctxComets.lineTo(cx, cy);
      ctxComets.strokeStyle = `rgba(0,217,255,${j.opacity*(1-j.progress)})`;
      ctxComets.lineWidth = 2; ctxComets.shadowBlur = 20;
      ctxComets.shadowColor = 'rgba(168,85,247,0.8)';
      ctxComets.stroke();
      ctxComets.shadowBlur = 0;
    });

    animationFrameId = requestAnimationFrame(animateBackground);
  }

  function drawStaticBackground(clear = false) {
    if (clear) {
      ctxBg.fillStyle = '#0a0a0f'; ctxBg.fillRect(0, 0, width, height);
      ctxNebula.clearRect(0, 0, width, height);
      ctxMid.clearRect(0, 0, width, height);
      ctxFront.clearRect(0, 0, width, height);
      ctxComets.clearRect(0, 0, width, height);
    }
    const grad = ctxBg.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
    grad.addColorStop(0, 'rgba(0,217,255,0.06)');
    grad.addColorStop(0.4, 'rgba(168,85,247,0.03)');
    grad.addColorStop(1, 'rgba(10,10,15,0)');
    ctxBg.fillStyle = grad;
    ctxBg.fillRect(0, 0, width, height);

    auroraBands.forEach((band) => {
      ctxNebula.beginPath();
      const [r, g, b] = band.color;
      ctxNebula.moveTo(0, band.y);
      for (let x = 0; x <= width; x += 10) {
        ctxNebula.lineTo(x, band.y + Math.sin(x * 0.01) * band.waveAmplitude);
      }
      const g2 = ctxNebula.createLinearGradient(0, band.y - band.waveAmplitude * 2, 0, band.y + band.waveAmplitude * 2);
      g2.addColorStop(0, `rgba(${r},${g},${b},0)`);
      g2.addColorStop(0.5, `rgba(${r},${g},${b},${band.baseOpacity})`);
      g2.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctxNebula.strokeStyle = g2;
      ctxNebula.lineWidth = band.waveAmplitude * 1.5;
      ctxNebula.lineCap = 'round';
      ctxNebula.shadowBlur = 40;
      ctxNebula.shadowColor = `rgba(${r},${g},${b},0.5)`;
      ctxNebula.stroke();
      ctxNebula.shadowBlur = 0;
    });

    [starsBg, starsMid, starsFront].forEach((layer, idx) => {
      const ctx = idx === 0 ? ctxBg : idx === 1 ? ctxMid : ctxFront;
      layer.forEach((star) => {
        const a = star.maxBrightness;
        const [r, g, b] = star.color;
        ctx.beginPath();
        ctx.arc(star.baseX, star.baseY, star.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        ctx.fill();
      });
    });

    if (comets.length > 0 || warpJumps.length > 0) {
      animationFrameId = requestAnimationFrame(animateBackground);
    }
  }

  // ── Wallpaper toggle (исправлено!) ─────────────────────────────────
  // Раньше: checked=false → ON (визуально путало). Теперь: checked = enabled.
  function setWallpaperState(enabled) {
    isLiveWallpaperEnabled = enabled;
    localStorage.setItem('wallpaperEnabled', enabled ? 'true' : 'false');
    if (!isLogoAnimationFinished) return;
    if (enabled || comets.length > 0 || warpJumps.length > 0) {
      if (!animationFrameId) animateBackground();
    } else {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
      drawStaticBackground(true);
    }
  }

  function initializeWallpaperToggle() {
    const hasVisited = localStorage.getItem('hasVisited');
    const savedState = localStorage.getItem('wallpaperEnabled');

    // если пользователь не хочет анимаций — выключаем по умолчанию
    let enabled = savedState !== null ? savedState === 'true' : !reducedMotion;

    wallpaperToggle.checked = enabled;
    isLiveWallpaperEnabled = enabled;

    if (hasVisited === null) {
      localStorage.setItem('hasVisited', 'true');
      animateBackground();
      animateLogo();
    } else {
      isLogoAnimationFinished = true;
      document.getElementById('logo-screen').classList.remove('active');
      document.getElementById('main-screen').classList.add('active');
      document.getElementById('profile-avatar').style.display = 'flex';
      setWallpaperState(enabled);
    }

    wallpaperToggle.addEventListener('change', (e) => {
      setWallpaperState(e.target.checked);
      Toast.show(e.target.checked ? 'Живые обои включены' : 'Живые обои выключены', 'info', 1800);
    });
  }

  // ── Профиль ────────────────────────────────────────────────────────
  const REG_MODAL = document.getElementById('registration-modal');
  const PROFILE_MODAL = document.getElementById('profile-modal');
  const PROFILE_AVATAR = document.getElementById('profile-avatar');
  const REG_NAME_INPUT = document.getElementById('reg-name-input');
  const REG_NO_BTN = document.getElementById('reg-no');
  const REG_YES_BTN = document.getElementById('reg-yes');
  const PROFILE_NAME_DISPLAY = document.getElementById('profile-name-display');
  const PROFILE_NAME_INPUT = document.getElementById('profile-name-input');
  const EDIT_PROFILE_ICON = document.getElementById('edit-profile-icon');
  const PROFILE_YES_BTN = document.getElementById('profile-yes');
  const PROFILE_NO_BTN = document.getElementById('profile-no');

  let isEditingProfile = false;

  const getUserName = () => localStorage.getItem('viora_username') || 'Гость';
  const setUserName = (name) => {
    const v = name && name.trim() !== '' ? name.trim() : 'Гость';
    localStorage.setItem('viora_username', v);
    updateProfileDisplay();
    if (v !== 'Гость') Toast.show(`Привет, ${v}!`, 'success', 2000);
  };

  function trapFocus(modal) {
    const focusables = modal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return () => {};
    const first = focusables[0], last = focusables[focusables.length - 1];
    function onKey(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
    modal.addEventListener('keydown', onKey);
    return () => modal.removeEventListener('keydown', onKey);
  }

  let lastFocusedBeforeModal = null;
  const focusTraps = new WeakMap();

  function showModal(modal) {
    lastFocusedBeforeModal = document.activeElement;
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('is-visible'));
    document.body.classList.add('modal-open');
    focusTraps.set(modal, trapFocus(modal));
    const firstInput = modal.querySelector('input');
    (firstInput || modal.querySelector('button'))?.focus();
  }
  function hideModal(modal) {
    modal.classList.remove('is-visible');
    setTimeout(() => {
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
      const release = focusTraps.get(modal); if (release) release();
      lastFocusedBeforeModal?.focus();
    }, 300);
  }
  function setupModalCloseOutside(modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        if (modal.id === 'profile-modal') handleProfileNo();
        else if (modal.id === 'registration-modal') handleRegNo();
      }
    });
  }
  setupModalCloseOutside(REG_MODAL);
  setupModalCloseOutside(PROFILE_MODAL);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (REG_MODAL.classList.contains('is-visible')) handleRegNo();
    else if (PROFILE_MODAL.classList.contains('is-visible')) handleProfileNo();
  });

  function updateProfileDisplay() {
    const name = getUserName();
    PROFILE_NAME_DISPLAY.textContent = name;
    PROFILE_NAME_INPUT.value = name !== 'Гость' ? name : '';
    PROFILE_NAME_INPUT.placeholder = 'Введите имя';
    if (!isEditingProfile) {
      PROFILE_NAME_DISPLAY.style.display = 'inline';
      PROFILE_NAME_INPUT.style.display = 'none';
      PROFILE_YES_BTN.disabled = true;
    }
  }
  function handleRegYes() { setUserName(REG_NAME_INPUT.value.trim()); hideModal(REG_MODAL); }
  function handleRegNo() {
    if (REG_NAME_INPUT.value.trim().length === 0) setUserName('Гость');
    hideModal(REG_MODAL);
  }
  REG_YES_BTN.addEventListener('click', handleRegYes);
  REG_NO_BTN.addEventListener('click', handleRegNo);
  REG_NAME_INPUT.addEventListener('input', () => {
    REG_YES_BTN.disabled = REG_NAME_INPUT.value.trim().length < 1;
  });
  REG_NAME_INPUT.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !REG_YES_BTN.disabled) handleRegYes();
  });

  function toggleProfileEditMode() {
    isEditingProfile = !isEditingProfile;
    PROFILE_NAME_DISPLAY.style.display = isEditingProfile ? 'none' : 'inline';
    PROFILE_NAME_INPUT.style.display = isEditingProfile ? 'inline-block' : 'none';
    if (isEditingProfile) {
      const saved = getUserName();
      PROFILE_NAME_INPUT.value = saved === 'Гость' ? '' : saved;
      PROFILE_NAME_INPUT.focus();
      PROFILE_YES_BTN.disabled = PROFILE_NAME_INPUT.value.trim() === saved;
      PROFILE_NAME_INPUT.oninput = () => {
        const cur = PROFILE_NAME_INPUT.value.trim();
        PROFILE_YES_BTN.disabled = cur === saved || cur.length < 1;
      };
    } else {
      PROFILE_NAME_INPUT.oninput = null;
    }
  }
  function handleProfileYes() {
    setUserName(PROFILE_NAME_INPUT.value.trim());
    isEditingProfile = false; hideModal(PROFILE_MODAL);
  }
  function handleProfileNo() {
    isEditingProfile = false; updateProfileDisplay(); hideModal(PROFILE_MODAL);
  }
  PROFILE_AVATAR.addEventListener('click', () => { updateProfileDisplay(); showModal(PROFILE_MODAL); });
  EDIT_PROFILE_ICON.addEventListener('click', (e) => { e.stopPropagation(); toggleProfileEditMode(); });
  PROFILE_YES_BTN.addEventListener('click', handleProfileYes);
  PROFILE_NO_BTN.addEventListener('click', handleProfileNo);

  // ── Пропуск анимации логотипа ──────────────────────────────────────
  const skipBtn = document.getElementById('skip-logo');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => { if (!isLogoAnimationFinished) finishLogo(); });
  }
  document.getElementById('viora-logo').addEventListener('click', () => {
    if (!isLogoAnimationFinished) finishLogo();
  });
  document.addEventListener('keydown', (e) => {
    if (!isLogoAnimationFinished && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      finishLogo();
    }
  });

  // ── Init ──────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initializeWallpaperToggle();
    updateProfileDisplay();
  });
})();
