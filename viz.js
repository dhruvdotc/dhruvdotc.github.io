/* ============================================================
   viz.js — canvas visualizations built from real project data.
   Each init* fn sizes a canvas (DPR-aware) and animates on demand.
   ============================================================ */
(function () {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ACCENT = '#F5A623';
  const TEXT = '#EFF1F8';
  const MUTED = '#7A8499';
  const GRID = 'rgba(122,132,153,0.16)';

  // DPR-aware sizing. Returns {ctx, w, h}.
  function fit(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* -----------------------------------------------------------
     1. DETECTION — cropped real photo + animated YOLO boxes
        + monocular ray -> GPS readout. The centerpiece.
  ----------------------------------------------------------- */
  function initDetection(canvas, opts) {
    const img = new Image();
    img.src = opts.src;
    // crop region (original-image px) framing the buoy cluster
    const crop = opts.crop;          // {sx,sy,sw,sh}
    const boxes = opts.boxes;        // [{x,y,w,h,cls,conf,color}]
    let state = { ctx: null, w: 0, h: 0 };
    let t0 = null, raf = null, ready = false, replayAt = 0;

    function resize() { state = fit(canvas); }
    img.onload = () => { ready = true; resize(); draw(performance.now()); };

    function scaleBox(b, s) {
      return {
        x: (b.x - crop.sx) * s, y: (b.y - crop.sy) * s,
        w: b.w * s, h: b.h * s, cls: b.cls, conf: b.conf, color: b.color
      };
    }

    function draw(now) {
      if (!ready) return;
      const { ctx, w, h } = state;
      if (!ctx) return;
      const elapsed = (now - (t0 || now)) / 1000;
      ctx.clearRect(0, 0, w, h);

      // image cover-fit into canvas using crop
      const s = w / crop.sw;
      const drawH = crop.sh * s;
      const oy = (h - drawH) / 2;
      ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, oy, w, drawH);

      // slight darken for HUD legibility
      ctx.fillStyle = 'rgba(7,8,13,0.22)';
      ctx.fillRect(0, 0, w, h);

      // corner frame
      ctx.strokeStyle = 'rgba(245,166,35,0.5)';
      ctx.lineWidth = 1.5;
      const c = 16, pad = 10;
      [[pad, pad, 1, 1], [w - pad, pad, -1, 1], [pad, h - pad, 1, -1], [w - pad, h - pad, -1, -1]].forEach(([cx, cy, dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy + dy * c); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx * c, cy);
        ctx.stroke();
      });

      const dur = REDUCED ? 0 : 1.0;
      // scanline sweep 0..1
      const scan = REDUCED ? 1 : clamp(elapsed / 0.7, 0, 1);
      if (scan < 1 && !REDUCED) {
        const sy = oy + drawH * scan;
        const g = ctx.createLinearGradient(0, sy - 30, 0, sy);
        g.addColorStop(0, 'rgba(245,166,35,0)');
        g.addColorStop(1, 'rgba(245,166,35,0.35)');
        ctx.fillStyle = g; ctx.fillRect(0, sy - 30, w, 30);
        ctx.strokeStyle = 'rgba(245,166,35,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
      }

      // boxes appear after scan passes them
      let lastBox = null;
      boxes.forEach((b, i) => {
        const sb = scaleBox(b, s);
        sb.y += oy;
        const appear = REDUCED ? 1 : clamp((elapsed - 0.45 - i * 0.12) / 0.35, 0, 1);
        if (appear <= 0) return;
        const a = easeOut(appear);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = b.color; ctx.lineWidth = 2;
        // grow from center
        const gx = sb.x + sb.w / 2, gy = sb.y + sb.h / 2;
        const bw = sb.w * (0.6 + 0.4 * a), bh = sb.h * (0.6 + 0.4 * a);
        rr(ctx, gx - bw / 2, gy - bh / 2, bw, bh, 3); ctx.stroke();
        // label chip
        const label = b.cls + ' ' + b.conf.toFixed(2);
        ctx.font = '600 10px "JetBrains Mono", monospace';
        const tw = ctx.measureText(label).width + 10;
        const ly = gy - bh / 2 - 15;
        ctx.fillStyle = 'rgba(7,8,13,0.9)';
        rr(ctx, gx - bw / 2, ly, tw, 14, 2); ctx.fill();
        ctx.fillStyle = b.color; ctx.fillRect(gx - bw / 2, ly, 2, 14);
        ctx.fillStyle = TEXT;
        ctx.textBaseline = 'middle';
        ctx.fillText(label, gx - bw / 2 + 6, ly + 7);
        ctx.restore();
        if (appear >= 1) lastBox = sb;
      });

      // projection ray + GPS lock (after all boxes)
      const projStart = 0.45 + boxes.length * 0.12 + 0.4;
      const proj = REDUCED ? 1 : clamp((elapsed - projStart) / 0.6, 0, 1);
      if (proj > 0 && lastBox) {
        const tx = lastBox.x + lastBox.w / 2, ty = lastBox.y + lastBox.h;
        const sxp = w - 14, syp = 16;
        const px = sxp + (tx - sxp) * easeOut(proj);
        const py = syp + (ty - syp) * easeOut(proj);
        ctx.strokeStyle = 'rgba(245,166,35,0.55)'; ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(sxp, syp); ctx.lineTo(px, py); ctx.stroke();
        ctx.setLineDash([]);
        if (proj >= 1) {
          ctx.fillStyle = ACCENT;
          ctx.beginPath(); ctx.arc(tx, ty, 3, 0, 7); ctx.fill();
          const lbl = '32.8801N 117.2340W';
          ctx.font = '600 10px "JetBrains Mono", monospace';
          const tw = ctx.measureText(lbl).width + 12;
          ctx.fillStyle = 'rgba(7,8,13,0.92)';
          rr(ctx, tx - tw / 2, ty + 8, tw, 16, 3); ctx.fill();
          ctx.strokeStyle = 'rgba(245,166,35,0.5)'; ctx.lineWidth = 1;
          rr(ctx, tx - tw / 2, ty + 8, tw, 16, 3); ctx.stroke();
          ctx.fillStyle = ACCENT; ctx.textBaseline = 'middle';
          ctx.fillText(lbl, tx - tw / 2 + 6, ty + 16);
        }
      }

      const done = elapsed > projStart + 1.2;
      if (!done && !REDUCED) raf = requestAnimationFrame(draw);
    }

    function play() {
      if (!ready) { setTimeout(play, 60); return; }
      cancelAnimationFrame(raf);
      t0 = performance.now();
      raf = requestAnimationFrame(draw);
    }
    window.addEventListener('resize', () => { resize(); draw(performance.now()); });
    canvas.addEventListener('click', play);
    return { play, resize };
  }

  /* -----------------------------------------------------------
     2. TRACKING — CARLA MOT: boxes with IDs drift across,
        occasional ID churn (drop + reassign).
  ----------------------------------------------------------- */
  function initTracking(canvas) {
    let s = fit(canvas), raf = null, t0 = null;
    let nextId = 4;
    let tracks = [
      { id: 1, x: 0.1, y: 0.55, vx: 0.10, w: 0.12, life: 0 },
      { id: 2, x: 0.45, y: 0.42, vx: 0.07, w: 0.10, life: 0 },
      { id: 3, x: 0.75, y: 0.62, vx: 0.085, w: 0.13, life: 0 }
    ];
    function resize() { s = fit(canvas); }
    function frame(now) {
      if (!t0) t0 = now;
      const dt = 1 / 60;
      const { ctx, w, h } = s;
      ctx.clearRect(0, 0, w, h);
      // perspective road
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) { const y = h * (0.3 + i * 0.14); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.3); ctx.lineTo(w * 0.15, h); ctx.moveTo(w * 0.5, h * 0.3); ctx.lineTo(w * 0.85, h); ctx.strokeStyle = GRID; ctx.stroke();

      tracks.forEach(tr => {
        tr.x += tr.vx * dt; tr.life += dt;
        if (tr.x > 1.05) { tr.x = -0.1; tr.id = nextId++; tr.y = 0.4 + Math.random() * 0.3; tr.life = 0; }
      });
      // random churn: occasionally reassign an id
      if (!REDUCED && Math.random() < 0.004) {
        const tr = tracks[Math.floor(Math.random() * tracks.length)];
        tr.id = nextId++; tr.life = 0;
      }
      tracks.forEach(tr => {
        const bx = tr.x * w, by = tr.y * h, bw = tr.w * w, bh = tr.w * w * 0.7;
        const fresh = tr.life < 0.4 ? tr.life / 0.4 : 1;
        ctx.strokeStyle = ACCENT; ctx.globalAlpha = 0.4 + 0.6 * fresh; ctx.lineWidth = 1.5;
        rr(ctx, bx - bw / 2, by - bh / 2, bw, bh, 2); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.font = '600 9px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(7,8,13,0.9)';
        const t = 'ID ' + tr.id;
        const tw = ctx.measureText(t).width + 6;
        ctx.fillRect(bx - bw / 2, by - bh / 2 - 12, tw, 11);
        ctx.fillStyle = ACCENT; ctx.textBaseline = 'middle';
        ctx.fillText(t, bx - bw / 2 + 3, by - bh / 2 - 6);
      });
      if (!REDUCED) raf = requestAnimationFrame(frame);
    }
    function play() { cancelAnimationFrame(raf); t0 = null; raf = requestAnimationFrame(frame); }
    function stop() { cancelAnimationFrame(raf); }
    window.addEventListener('resize', resize);
    if (REDUCED) { resize(); raf = requestAnimationFrame(frame); cancelAnimationFrame(raf); frame(0); }
    return { play, stop, resize };
  }

  /* -----------------------------------------------------------
     3. CONTROL — lane-error step response settling to zero.
        PID vs proportional-only, with phase-margin readout.
  ----------------------------------------------------------- */
  function initControl(canvas) {
    let s = fit(canvas), raf = null, t0 = null;
    function resize() { s = fit(canvas); }
    // response samples: damped (PID) vs undamped (P-only)
    function pid(t) { return 1 - Math.exp(-5.2 * t) * (Math.cos(7 * t) + (5.2 / 7) * Math.sin(7 * t)); }
    function ponly(t) { return 1 - Math.exp(-0.4 * t) * Math.cos(9 * t); }
    function frame(now) {
      if (!t0) t0 = now;
      const prog = REDUCED ? 1 : clamp((now - t0) / 2200, 0, 1);
      const { ctx, w, h } = s;
      ctx.clearRect(0, 0, w, h);
      const padL = 8, padB = 16, padT = 10, padR = 8;
      const gx = padL, gw = w - padL - padR, gy = padT, gh = h - padT - padB;
      // grid
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) { const y = gy + gh * i / 4; ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke(); }
      // target line (setpoint 0 error => settle)
      const ty = gy + gh * 0.32;
      ctx.strokeStyle = 'rgba(122,132,153,0.5)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(gx, ty); ctx.lineTo(gx + gw, ty); ctx.stroke(); ctx.setLineDash([]);
      const T = 1.6;
      function curve(fn, color, alpha, width) {
        ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width;
        ctx.beginPath();
        const N = Math.floor(gw * prog);
        for (let i = 0; i <= N; i++) {
          const t = (i / gw) * T;
          const v = fn(t);
          const x = gx + i;
          const y = gy + gh - v * gh * 0.62;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      curve(ponly, MUTED, 0.5, 1);       // undamped reference
      curve(pid, ACCENT, 1, 2);          // PID
      if (!REDUCED && prog < 1) raf = requestAnimationFrame(frame);
    }
    function play() { cancelAnimationFrame(raf); t0 = null; raf = requestAnimationFrame(frame); }
    window.addEventListener('resize', () => { resize(); frame(performance.now()); });
    return { play, resize };
  }

  /* -----------------------------------------------------------
     4. SEGMENTATION — corrupted -> repaired sweep over a
        synthetic semantic map (class color blocks).
  ----------------------------------------------------------- */
  function initSegmentation(canvas) {
    let s = fit(canvas), raf = null, t0 = null;
    const classes = [
      { c: '#3b4a6b', x: 0, y: 0.0, w: 1, h: 0.42 },     // sky
      { c: '#5a6b3b', x: 0, y: 0.42, w: 0.34, h: 0.3 },  // veg
      { c: '#6b5a3b', x: 0.66, y: 0.42, w: 0.34, h: 0.3 },// veg/building
      { c: '#4b3b6b', x: 0, y: 0.62, w: 1, h: 0.38 },    // road
      { c: '#8a5a2b', x: 0.42, y: 0.5, w: 0.16, h: 0.5 } // pole/car
    ];
    function resize() { s = fit(canvas); }
    function noise(ctx, x, y, w, h, amt) {
      const img = ctx.getImageData(x, y, Math.max(1, w | 0), Math.max(1, h | 0));
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * amt;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      ctx.putImageData(img, x, y);
    }
    function frame(now) {
      if (!t0) t0 = now;
      const prog = REDUCED ? 1 : clamp((now - t0) / 2600, 0, 1);
      const { ctx, w, h } = s;
      ctx.clearRect(0, 0, w, h);
      const sweepX = w * prog;
      classes.forEach(k => {
        ctx.fillStyle = k.c;
        ctx.fillRect(k.x * w, k.y * h, k.w * w, k.h * h);
      });
      // corrupted region = right of sweep (noisy, blurry feel)
      if (prog < 1 && !REDUCED) {
        ctx.save();
        ctx.beginPath(); ctx.rect(sweepX, 0, w - sweepX, h); ctx.clip();
        ctx.fillStyle = 'rgba(120,120,140,0.18)'; ctx.fillRect(sweepX, 0, w - sweepX, h);
        try { noise(ctx, sweepX, 0, w - sweepX, h, 120); } catch (e) {}
        ctx.restore();
        // sweep line
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sweepX, 0); ctx.lineTo(sweepX, h); ctx.stroke();
        ctx.fillStyle = ACCENT; ctx.font = '600 9px "JetBrains Mono", monospace';
        ctx.fillText('repair', sweepX - 38, 12);
      }
      if (!REDUCED && prog < 1) raf = requestAnimationFrame(frame);
    }
    function play() { cancelAnimationFrame(raf); t0 = null; raf = requestAnimationFrame(frame); }
    window.addEventListener('resize', () => { resize(); frame(performance.now()); });
    return { play, resize };
  }

  /* -----------------------------------------------------------
     5. SCHEDULER — route network: vertiports, conflict arcs,
        conflict-free amber schedule. Actual MWIS output style.
  ----------------------------------------------------------- */
  function initScheduler(canvas) {
    let s = fit(canvas), raf = null, t0 = null;
    function resize() { s = fit(canvas); }

    const VPS = [
      {id:'V1',x:.08,y:.22},{id:'V2',x:.30,y:.10},{id:'V3',x:.60,y:.14},{id:'V4',x:.87,y:.24},
      {id:'V5',x:.13,y:.73},{id:'V6',x:.44,y:.80},{id:'V7',x:.74,y:.68},{id:'V8',x:.91,y:.74}
    ];
    const CONF  = [{a:0,b:6,curl:.15},{a:1,b:5,curl:-.13},{a:3,b:4,curl:-.16}];
    const SCHED = [{a:0,b:1,curl:.20},{a:2,b:6,curl:.22},{a:4,b:5,curl:.19}];

    function N(i,w,h){return{x:VPS[i].x*w,y:VPS[i].y*h};}

    function drawArc(ctx,A,B,curl){
      const mx=(A.x+B.x)/2-(B.y-A.y)*curl;
      const my=(A.y+B.y)/2+(B.x-A.x)*curl;
      ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.quadraticCurveTo(mx,my,B.x,B.y);ctx.stroke();
      return{mx,my};
    }

    function arrowHead(ctx,cx,cy,ex,ey,sz){
      const a=Math.atan2(ey-cy,ex-cx);
      ctx.beginPath();ctx.moveTo(ex,ey);
      ctx.lineTo(ex-sz*Math.cos(a-.42),ey-sz*Math.sin(a-.42));
      ctx.lineTo(ex-sz*Math.cos(a+.42),ey-sz*Math.sin(a+.42));
      ctx.closePath();ctx.fill();
    }

    function confX(ctx,x,y,r){
      ctx.save();ctx.strokeStyle='rgba(255,80,80,0.75)';ctx.lineWidth=1.2;
      ctx.beginPath();ctx.moveTo(x-r,y-r);ctx.lineTo(x+r,y+r);
      ctx.moveTo(x+r,y-r);ctx.lineTo(x-r,y+r);ctx.stroke();ctx.restore();
    }

    function frame(now){
      if(!t0)t0=now;
      const prog=REDUCED?1:clamp((now-t0)/2600,0,1);
      const{ctx,w,h}=s;
      ctx.clearRect(0,0,w,h);
      const NR=Math.max(9,Math.round(Math.min(w,h)*.046));
      const FS=Math.max(7,Math.round(NR*.72));

      const p_hdr   =clamp(prog/.2,0,1);
      const p_nodes =clamp((prog-.05)/.35,0,1);
      const p_conf  =clamp((prog-.25)/.4,0,1);
      const p_sched =clamp((prog-.6)/.4,0,1);
      const p_legend=clamp((prog-.85)/.15,0,1);

      // header
      ctx.globalAlpha=easeOut(p_hdr);
      ctx.font=`600 ${Math.max(7,Math.round(w*.018))}px "JetBrains Mono",monospace`;
      ctx.fillStyle=MUTED;ctx.textBaseline='top';ctx.textAlign='left';
      ctx.fillText('CONFLICT-FREE SCHEDULE OUTPUT',Math.round(w*.015),Math.round(h*.04));
      ctx.globalAlpha=1;

      // conflict routes — gray dashed
      ctx.setLineDash([3,3]);ctx.lineWidth=1;
      CONF.forEach((r,i)=>{
        const t=clamp(p_conf*CONF.length-i,0,1);if(t<=0)return;
        const A=N(r.a,w,h),B=N(r.b,w,h);
        ctx.strokeStyle=`rgba(122,132,153,${easeOut(t)*.45})`;
        ctx.globalAlpha=easeOut(t);
        const{mx,my}=drawArc(ctx,A,B,r.curl);
        if(t>=.85){
          const qx=.25*A.x+.5*mx+.25*B.x,qy=.25*A.y+.5*my+.25*B.y;
          ctx.globalAlpha=1;ctx.setLineDash([]);
          confX(ctx,qx,qy,4);
          ctx.setLineDash([3,3]);ctx.lineWidth=1;
        }
        ctx.globalAlpha=1;
      });
      ctx.setLineDash([]);ctx.globalAlpha=1;

      // scheduled routes — amber solid with arrowheads
      SCHED.forEach((r,i)=>{
        const t=clamp(p_sched*SCHED.length-i,0,1);if(t<=0)return;
        const A=N(r.a,w,h),B=N(r.b,w,h);
        ctx.strokeStyle=ACCENT;ctx.lineWidth=1.8;ctx.globalAlpha=easeOut(t);
        const{mx,my}=drawArc(ctx,A,B,r.curl);
        if(t>=.7){ctx.fillStyle=ACCENT;ctx.globalAlpha=easeOut((t-.7)/.3);arrowHead(ctx,mx,my,B.x,B.y,7);}
        ctx.globalAlpha=1;
      });

      // nodes
      VPS.forEach((v,i)=>{
        const t=clamp(p_nodes*(VPS.length/.8)-i,.6,1);if(t<=0)return;
        const P=N(i,w,h);
        ctx.globalAlpha=easeOut(t);
        ctx.beginPath();ctx.arc(P.x,P.y,NR,0,7);
        ctx.fillStyle='rgba(14,17,23,.92)';ctx.fill();
        ctx.strokeStyle='rgba(122,132,153,.55)';ctx.lineWidth=1.2;ctx.stroke();
        ctx.fillStyle=TEXT;ctx.font=`600 ${FS}px "JetBrains Mono",monospace`;
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(v.id,P.x,P.y+.3);
        ctx.globalAlpha=1;
      });
      ctx.textAlign='left';

      // legend
      if(p_legend>0){
        const lx=Math.round(w*.015),ly=h-Math.round(h*.1)-2;
        ctx.globalAlpha=easeOut(p_legend);
        ctx.font=`400 ${Math.max(7,Math.round(w*.015))}px "JetBrains Mono",monospace`;
        ctx.textBaseline='middle';
        ctx.setLineDash([3,3]);ctx.strokeStyle='rgba(122,132,153,.5)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(lx+18,ly);ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle=MUTED;ctx.fillText('conflict',lx+22,ly);
        const lx2=lx+82;
        ctx.strokeStyle=ACCENT;ctx.lineWidth=1.5;
        ctx.beginPath();ctx.moveTo(lx2,ly);ctx.lineTo(lx2+18,ly);ctx.stroke();
        ctx.fillStyle=ACCENT;ctx.fillText('scheduled',lx2+22,ly);
        ctx.globalAlpha=1;
      }

      if(!REDUCED&&prog<1)raf=requestAnimationFrame(frame);
    }

    function play(){cancelAnimationFrame(raf);t0=null;raf=requestAnimationFrame(frame);}
    function stop(){cancelAnimationFrame(raf);}
    window.addEventListener('resize',()=>{resize();frame(performance.now());});
    if(REDUCED){resize();frame(0);}
    return{play,stop,resize};
  }

  /* -----------------------------------------------------------
     6. FAULT — PCB circuit schematic: IC + passives + amber
        fault net with tooltip. FaultWise validation output style.
  ----------------------------------------------------------- */
  function initFault(canvas) {
    let s = fit(canvas), raf = null, t0 = null;
    function resize(){s=fit(canvas);}

    function drawResistor(ctx,cx,cy,len){
      const bw=len*.52,bh=Math.max(7,len*.22);
      ctx.beginPath();ctx.moveTo(cx-len/2,cy);ctx.lineTo(cx-bw/2,cy);ctx.stroke();
      ctx.beginPath();ctx.moveTo(cx+bw/2,cy);ctx.lineTo(cx+len/2,cy);ctx.stroke();
      ctx.strokeRect(cx-bw/2,cy-bh/2,bw,bh);
    }

    function drawCap(ctx,cx,y0,y1){
      const gap=3,hw=9,mid=(y0+y1)/2;
      ctx.beginPath();ctx.moveTo(cx,y0);ctx.lineTo(cx,mid-gap);ctx.stroke();
      ctx.beginPath();ctx.moveTo(cx,mid+gap);ctx.lineTo(cx,y1);ctx.stroke();
      ctx.beginPath();ctx.moveTo(cx-hw,mid-gap);ctx.lineTo(cx+hw,mid-gap);ctx.stroke();
      ctx.beginPath();ctx.moveTo(cx-hw,mid+gap);ctx.lineTo(cx+hw,mid+gap);ctx.stroke();
    }

    function frame(now){
      if(!t0)t0=now;
      const prog=REDUCED?1:clamp((now-t0)/2400,0,1);
      const{ctx,w,h}=s;
      ctx.clearRect(0,0,w,h);

      const ICX0=w*.36,ICX1=w*.64,ICY0=h*.10,ICY1=h*.90;
      const ICW=ICX1-ICX0,ICH=ICY1-ICY0;
      const VCCY=h*.04,GNDY=h*.96;
      const FS=Math.max(7,Math.round(h*.085));

      const PINS_L=[
        {y:ICY0+ICH*.17,label:'VCC'},
        {y:ICY0+ICH*.37,label:'IN_A'},
        {y:ICY0+ICH*.60,label:'IN_B'},
        {y:ICY0+ICH*.83,label:'GND'}
      ];
      const PINS_R=[
        {y:ICY0+ICH*.17,label:'OUT_1'},
        {y:ICY0+ICH*.37,label:'OUT_2'},
        {y:ICY0+ICH*.60,label:'EN'},
        {y:ICY0+ICH*.83,label:'GPIO_3',fault:true}
      ];

      const p_bg   =clamp(prog/.22,0,1);
      const p_ic   =clamp((prog-.12)/.28,0,1);
      const p_trace=clamp((prog-.35)/.38,0,1);
      const p_fault=clamp((prog-.80)/.20,0,1);
      const faultTraceEnd=ICX1+(w-ICX1)*.58;

      // faint PCB dot-grid
      ctx.strokeStyle='rgba(122,132,153,0.06)';ctx.lineWidth=1;
      const gs=Math.round(h*.5);
      for(let gx=0;gx<w+gs;gx+=gs){ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,h);ctx.stroke();}
      for(let gy=0;gy<h+gs;gy+=gs){ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(w,gy);ctx.stroke();}

      // power rails
      ctx.globalAlpha=easeOut(p_bg);
      ctx.strokeStyle='rgba(245,166,35,.28)';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(0,VCCY);ctx.lineTo(w,VCCY);ctx.stroke();
      ctx.strokeStyle='rgba(122,132,153,.28)';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(0,GNDY);ctx.lineTo(w,GNDY);ctx.stroke();
      ctx.font=`500 ${FS-1}px "JetBrains Mono",monospace`;
      ctx.fillStyle=ACCENT;ctx.textBaseline='middle';ctx.textAlign='left';
      ctx.fillText('+VCC',5,VCCY+FS);
      ctx.fillStyle=MUTED;ctx.fillText('GND',5,GNDY-FS);
      ctx.globalAlpha=1;

      // IC chip
      ctx.globalAlpha=easeOut(p_ic);
      ctx.fillStyle='rgba(14,17,23,.94)';ctx.fillRect(ICX0,ICY0,ICW,ICH);
      ctx.strokeStyle='rgba(122,132,153,.55)';ctx.lineWidth=1.5;ctx.strokeRect(ICX0,ICY0,ICW,ICH);
      ctx.fillStyle=MUTED;ctx.font=`600 ${FS}px "JetBrains Mono",monospace`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText('U1',(ICX0+ICX1)/2,(ICY0+ICY1)/2-FS*.65);
      ctx.font=`400 ${FS-2}px "JetBrains Mono",monospace`;
      ctx.fillText('\u03BCController',(ICX0+ICX1)/2,(ICY0+ICY1)/2+FS*.55);
      ctx.textAlign='left';ctx.globalAlpha=1;

      // left pin stubs + labels
      PINS_L.forEach((p,i)=>{
        const t=clamp(p_trace*PINS_L.length-i,0,1);if(t<=0)return;
        ctx.globalAlpha=easeOut(t);
        ctx.strokeStyle='rgba(122,132,153,.40)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(ICX0,p.y);ctx.lineTo(ICX0*.10,p.y);ctx.stroke();
        ctx.fillStyle=MUTED;ctx.font=`400 ${FS-1}px "JetBrains Mono",monospace`;
        ctx.textBaseline='middle';ctx.textAlign='right';
        ctx.fillText(p.label,ICX0-3,p.y);
        ctx.textAlign='left';ctx.globalAlpha=1;
      });

      // VCC bypass cap + GND drop + R1 on IN_A
      if(p_trace>.25){
        ctx.globalAlpha=easeOut(clamp((p_trace-.25)/.4,0,1));
        const vp=PINS_L[0],capX=ICX0*.54;
        ctx.strokeStyle='rgba(245,166,35,.26)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(ICX0,vp.y);ctx.lineTo(capX,vp.y);ctx.lineTo(capX,VCCY+2);ctx.stroke();
        ctx.strokeStyle=MUTED;ctx.lineWidth=1.2;
        drawCap(ctx,capX,vp.y-16,VCCY+4);
        ctx.font=`400 ${FS-3}px "JetBrains Mono",monospace`;ctx.fillStyle=MUTED;
        ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText('C1 100nF',capX,vp.y-28);ctx.textAlign='left';

        const gp=PINS_L[3],gndX=ICX0*.34;
        ctx.strokeStyle='rgba(122,132,153,.28)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(ICX0,gp.y);ctx.lineTo(gndX,gp.y);ctx.lineTo(gndX,GNDY-2);ctx.stroke();

        const inA=PINS_L[1],r1cx=ICX0*.62;
        ctx.strokeStyle='rgba(122,132,153,.36)';ctx.lineWidth=1;
        drawResistor(ctx,r1cx,inA.y,ICX0*.42);
        ctx.font=`400 ${FS-3}px "JetBrains Mono",monospace`;
        ctx.fillStyle=MUTED;ctx.textAlign='center';ctx.textBaseline='bottom';
        ctx.fillText('R1 4k7',r1cx,inA.y-8);ctx.textAlign='left';
        ctx.globalAlpha=1;
      }

      // right pin stubs + fault highlight
      PINS_R.forEach((p,i)=>{
        const t=clamp(p_trace*PINS_R.length-i,0,1);if(t<=0)return;
        const isFault=!!p.fault,fa=isFault?easeOut(p_fault):0;
        ctx.globalAlpha=easeOut(t);
        const traceEnd=isFault?faultTraceEnd:ICX1+(w-ICX1)*.44;
        ctx.strokeStyle=isFault?`rgba(245,166,35,${.18+fa*.72})`:'rgba(122,132,153,.38)';
        ctx.lineWidth=isFault?1.5:1;
        if(isFault&&fa<.5)ctx.setLineDash([3,2]);
        ctx.beginPath();ctx.moveTo(ICX1,p.y);ctx.lineTo(traceEnd,p.y);ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle=isFault&&fa>.4?ACCENT:MUTED;
        ctx.font=`400 ${FS-1}px "JetBrains Mono",monospace`;
        ctx.textBaseline='middle';ctx.textAlign='left';
        ctx.fillText(p.label,ICX1+3,p.y);
        // pulsing fault dot
        if(isFault&&fa>.3){
          const pr=4+Math.sin(now/280)*1.5;
          ctx.globalAlpha=fa;
          ctx.beginPath();ctx.arc(traceEnd,p.y,pr,0,7);
          ctx.fillStyle=`rgba(245,166,35,${.55+Math.sin(now/280)*.3})`;ctx.fill();
          ctx.strokeStyle='rgba(245,166,35,.28)';ctx.lineWidth=1;
          ctx.beginPath();ctx.arc(traceEnd,p.y,pr+5,0,7);ctx.stroke();
        }
        ctx.textAlign='left';ctx.globalAlpha=1;
      });

      // fault tooltip
      const fp=PINS_R[3];
      if(p_fault>.2||REDUCED){
        const ta=REDUCED?1:easeOut(clamp((p_fault-.2)/.5,0,1));
        const TX=faultTraceEnd+14,TY=fp.y-54;
        const tipW=Math.min(w-TX-8,w*.32);
        ctx.globalAlpha=ta;
        ctx.fillStyle='rgba(7,8,13,.93)';
        rr(ctx,TX,TY,tipW,50,4);ctx.fill();
        ctx.strokeStyle='rgba(245,166,35,.6)';ctx.lineWidth=1;
        rr(ctx,TX,TY,tipW,50,4);ctx.stroke();
        ctx.setLineDash([2,2]);ctx.strokeStyle='rgba(245,166,35,.35)';
        ctx.beginPath();ctx.moveTo(faultTraceEnd,fp.y);ctx.lineTo(TX,TY+25);ctx.stroke();
        ctx.setLineDash([]);
        ctx.font=`600 ${FS-1}px "JetBrains Mono",monospace`;
        ctx.fillStyle=ACCENT;ctx.textBaseline='top';ctx.textAlign='left';
        ctx.fillText('FLOATING_INPUT \u00B7 no pull-down',TX+7,TY+6);
        ctx.font=`400 ${FS-2}px "JetBrains Mono",monospace`;
        ctx.fillStyle='rgba(122,132,153,.9)';
        ctx.fillText('fix: add 10k\u03A9 pull-down to GND',TX+7,TY+24);
        ctx.globalAlpha=1;
      }

      if(!REDUCED)raf=requestAnimationFrame(frame);
    }

    function play(){cancelAnimationFrame(raf);t0=null;raf=requestAnimationFrame(frame);}
    function stop(){cancelAnimationFrame(raf);}
    window.addEventListener('resize',()=>{resize();frame(performance.now());});
    if(REDUCED){resize();frame(0);}
    return{play,stop,resize};
  }

  /* -----------------------------------------------------------
     HERO backdrop — slow coordinate grid drift + radar sweep.
     Very low contrast; reads as instrumentation, not decoration.
  ----------------------------------------------------------- */
  function initHeroBackdrop(canvas) {
    let s = fit(canvas), raf = null, t = 0;
    function resize() { s = fit(canvas); }
    function frame() {
      const { ctx, w, h } = s;
      ctx.clearRect(0, 0, w, h);
      t += 0.0032;
      const step = 64;
      const ox = (t * 20) % step, oy = (t * 12) % step;
      ctx.strokeStyle = 'rgba(122,132,153,0.06)'; ctx.lineWidth = 1;
      for (let x = -step + ox; x < w + step; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = -step + oy; y < h + step; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      // radar sweep anchored bottom-right
      const cx = w * 0.82, cy = h * 0.5, R = Math.hypot(w, h) * 0.5;
      const ang = t * 0.8;
      const g = ctx.createConicGradient ? ctx.createConicGradient(ang, cx, cy) : null;
      if (g) {
        g.addColorStop(0, 'rgba(245,166,35,0.10)');
        g.addColorStop(0.06, 'rgba(245,166,35,0)');
        g.addColorStop(1, 'rgba(245,166,35,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
      }
      // faint range rings
      ctx.strokeStyle = 'rgba(245,166,35,0.05)';
      [0.18, 0.34, 0.5].forEach(r => { ctx.beginPath(); ctx.arc(cx, cy, R * r, 0, 7); ctx.stroke(); });
      if (!REDUCED) raf = requestAnimationFrame(frame);
    }
    function play() { if (REDUCED) { resize(); frame(); cancelAnimationFrame(raf); return; } cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
    function stop() { cancelAnimationFrame(raf); }
    window.addEventListener('resize', resize);
    return { play, stop, resize };
  }

  /* -----------------------------------------------------------
     Counter — count up to a numeric target on demand.
  ----------------------------------------------------------- */
  function countUp(el) {
    const target = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.dec || '0', 10);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    if (REDUCED) { el.textContent = prefix + target.toFixed(dec) + suffix; return; }
    const dur = 1100; let t0 = null;
    function step(now) {
      if (!t0) t0 = now;
      const p = clamp((now - t0) / dur, 0, 1);
      const v = target * easeOut(p);
      el.textContent = prefix + v.toFixed(dec) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  window.VIZ = {
    initDetection, initTracking, initControl, initSegmentation,
    initScheduler, initFault, initHeroBackdrop, countUp, REDUCED
  };
})();
