/* drone3d.js — cursor-reactive 3D S500 quadcopter renderer
   Accurate to the RobotX UAV: X-frame carbon arms, gold motor mounts,
   orange Jetson Nano housing, GPS mast, tube landing legs.
   Canvas 2D with perspective projection. Auto-yaws; cursor tilts.   */
(function () {
  'use strict';
  const REDUCED = window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  /* ── 3D math ─────────────────────────────────────────────────────── */
  function ry(p, a) { const c=Math.cos(a),s=Math.sin(a); return [p[0]*c+p[2]*s, p[1], -p[0]*s+p[2]*c]; }
  function rx(p, a) { const c=Math.cos(a),s=Math.sin(a); return [p[0], p[1]*c-p[2]*s, p[1]*s+p[2]*c]; }

  /* ── geometry (Y-up; drone centered at origin, arm tips ≈ ±0.48) ── */
  const A=0.48; // arm tip distance from center along each axis
  const MOTORS=[[A,0,A],[-A,0,A],[-A,0,-A],[A,0,-A]]; // FR FL BL BR
  const MOTOR_R=0.082, MOTOR_H=0.040;
  const PROP_L=0.43, PROP_RW=9; // prop half-length; root half-width in px/400
  const ARM_W=0.028; // arm tube half-width

  /* payload box (orange Jetson housing — slightly taller than wide) */
  const BX=0.21,BTOP=0.07,BBOT=0.28,BZ=0.18;
  /* GPS mast */
  const GPS_Y=0.38, GPS_R=0.046;

  /* ── draw helpers ────────────────────────────────────────────────── */
  function poly(ctx, pts, fill, stroke, lw) {
    if (!pts.length) return;
    ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
    ctx.closePath();
    if (fill)   { ctx.fillStyle=fill;   ctx.fill(); }
    if (stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=lw||1; ctx.stroke(); }
  }

  function sortBox(faces, raw, T) {
    return [...faces].map(f=>({...f,z:f.i.reduce((s,i)=>s+T(raw[i])[2],0)/f.i.length}))
                     .sort((a,b)=>a.z-b.z);
  }

  /* ── main draw ───────────────────────────────────────────────────── */
  function drawDrone(ctx, W, H, yaw, pitch, propPhase, now) {
    ctx.save();
    const cx=W*0.50, cy=H*0.52;
    const scale=Math.min(W,H)*0.37;
    const FOV=3.2;
    const lw=Math.max(0.8, Math.min(W,H)/360); // global line-width scale

    function tr(p)  { return rx(ry(p, yaw), pitch); }
    function pr(p)  { const z=p[2]+FOV; const f=FOV/Math.max(z,0.05); return [cx+p[0]*f*scale, cy-p[1]*f*scale]; }
    function P(p)   { return pr(tr(p)); }
    function Z(p)   { return tr(p)[2]; }
    function ZA(ps) { return ps.reduce((s,p)=>s+Z(p),0)/ps.length; }

    /* ── glow ─────────────────────────────────────────────────────── */
    const grd=ctx.createRadialGradient(cx,cy,0,cx,cy,Math.min(W,H)*0.5);
    grd.addColorStop(0,'rgba(245,166,35,0.09)'); grd.addColorStop(1,'rgba(245,166,35,0)');
    ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);

    /* shadow removed */

    /* ── landing legs (two horizontal gray tubes + struts) ─────────── */
    const LX=0.70, LY=0.21;
    [[0.22],[-0.22]].forEach(([lz])=>{
      const A2=[-LX,LY,lz], B=[LX,LY,lz];
      const AP=P(A2), BP=P(B);
      ctx.strokeStyle='#3a3a3a'; ctx.lineWidth=4.5*lw; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(AP[0],AP[1]); ctx.lineTo(BP[0],BP[1]); ctx.stroke();
      // rubber end caps
      [AP,BP].forEach(pt=>{ ctx.fillStyle='#1a1a1a'; ctx.beginPath(); ctx.arc(pt[0],pt[1],5*lw,0,7); ctx.fill(); });
    });
    // vertical struts connecting frame to legs
    [[-LX,0,-0.22],[LX,0,-0.22],[-LX,0,0.22],[LX,0,0.22]].forEach(top=>{
      const TP=P(top), LP=P([top[0],LY,top[2]]);
      ctx.strokeStyle='#2a2a2a'; ctx.lineWidth=2*lw; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(TP[0],TP[1]); ctx.lineTo(LP[0],LP[1]); ctx.stroke();
    });

    /* ── orange Jetson payload box ────────────────────────────────── */
    const bV=[[-BX,BTOP,-BZ],[BX,BTOP,-BZ],[BX,BTOP,BZ],[-BX,BTOP,BZ],
               [-BX,BBOT,-BZ],[BX,BBOT,-BZ],[BX,BBOT,BZ],[-BX,BBOT,BZ]];
    const bP=bV.map(P);
    const bFaces=[
      {i:[4,5,6,7],c:'#b85c00'},{i:[0,1,5,4],c:'#e07020'},
      {i:[1,2,6,5],c:'#e87830'},{i:[2,3,7,6],c:'#c86010'},
      {i:[3,0,4,7],c:'#b85800'},{i:[0,1,2,3],c:'#f08040'},
    ];
    sortBox(bFaces,bV,tr).forEach(f=>poly(ctx,f.i.map(i=>bP[i]),f.c,'rgba(0,0,0,0.45)',0.8*lw));

    /* ── gray battery block underneath ───────────────────────────── */
    const btV=[[-0.14,BTOP+0.01,-0.12],[0.14,BTOP+0.01,-0.12],[0.14,BTOP+0.01,0.12],[-0.14,BTOP+0.01,0.12],
               [-0.14,BBOT+0.02,-0.12],[0.14,BBOT+0.02,-0.12],[0.14,BBOT+0.02,0.12],[-0.14,BBOT+0.02,0.12]];
    const btP=btV.map(P);
    const btFaces=[
      {i:[4,5,6,7],c:'#484848'},{i:[0,1,5,4],c:'#585858'},
      {i:[1,2,6,5],c:'#5e5e5e'},{i:[2,3,7,6],c:'#525252'},
      {i:[3,0,4,7],c:'#4c4c4c'},{i:[0,1,2,3],c:'#606060'},
    ];
    sortBox(btFaces,btV,tr).forEach(f=>poly(ctx,f.i.map(i=>btP[i]),f.c,'rgba(0,0,0,0.35)',0.6*lw));

    /* ── frame arms ───────────────────────────────────────────────── */
    MOTORS.forEach((m)=>{
      const norm=Math.hypot(m[0],m[2]);
      const px=-m[2]/norm*ARM_W, pz=m[0]/norm*ARM_W;
      const corners=[[-px,0,-pz],[px,0,pz],[m[0]+px,0,m[2]+pz],[m[0]-px,0,m[2]-pz]];
      poly(ctx,corners.map(P),'#1c1c1c','rgba(65,65,65,0.5)',0.5*lw);
      // second parallel arm tube (lower rail, slight Y offset)
      const lo=[[-px,-0.02,-pz],[px,-0.02,pz],[m[0]+px,-0.02,m[2]+pz],[m[0]-px,-0.02,m[2]-pz]];
      poly(ctx,lo.map(P),'#151515','rgba(50,50,50,0.4)',0.4*lw);
    });

    /* ── center body (Pixhawk + electronics) ─────────────────────── */
    const CS=0.115, CH=0.042;
    const cV=[[-CS,-CH,-CS],[CS,-CH,-CS],[CS,-CH,CS],[-CS,-CH,CS],
               [-CS,0,-CS],[CS,0,-CS],[CS,0,CS],[-CS,0,CS]];
    const cP=cV.map(P);
    const cFaces=[
      {i:[0,1,2,3],c:'#282828'},{i:[4,5,6,7],c:'#484848'},
      {i:[0,1,5,4],c:'#363636'},{i:[1,2,6,5],c:'#3e3e3e'},
      {i:[2,3,7,6],c:'#303030'},{i:[3,0,4,7],c:'#323232'},
    ];
    sortBox(cFaces,cV,tr).forEach(f=>poly(ctx,f.i.map(i=>cP[i]),f.c,'rgba(0,0,0,0.55)',0.6*lw));
    // cyan Pixhawk status LED
    const ledP=P([0,-CH-0.008,-CS+0.018]);
    const lb=0.5+0.5*Math.sin(now*0.0028);
    ctx.beginPath(); ctx.arc(ledP[0],ledP[1],2.8*lw,0,7);
    ctx.fillStyle=`rgba(0,229,255,${(0.55+0.45*lb).toFixed(2)})`; ctx.fill();

    /* ── motors + props (depth-sorted) ───────────────────────────── */
    const sortedM=MOTORS.map((m,i)=>({m,i,z:Z(m)})).sort((a,b)=>a.z-b.z);
    sortedM.forEach(({m,i})=>{
      const P0=P(m);
      // compute ellipse radii from projected neighbor points
      const rX=P([m[0]+MOTOR_R,m[1],m[2]]), rZ=P([m[0],m[1],m[2]+MOTOR_R]);
      const radX=Math.hypot(rX[0]-P0[0],rX[1]-P0[1]);
      const radZ=Math.hypot(rZ[0]-P0[0],rZ[1]-P0[1]);
      const tilt=Math.atan2(rX[1]-P0[1],rX[0]-P0[0]);
      const radMain=Math.max(radX,radZ), radMinor=Math.min(radX,radZ)*0.42;

      // motor cylinder side
      const mBot=[m[0],m[1]-MOTOR_H,m[2]];
      const PB=P(mBot);
      const bRX=P([mBot[0]+MOTOR_R*1.05,mBot[1],mBot[2]]);
      const bRad=Math.hypot(bRX[0]-PB[0],bRX[1]-PB[1]);
      ctx.fillStyle='#7a5c1a'; ctx.beginPath();
      ctx.ellipse(PB[0],PB[1],Math.max(2,bRad),Math.max(1.2,bRad*0.42),tilt,0,7);
      ctx.fill(); ctx.strokeStyle='#4a3a08'; ctx.lineWidth=0.9*lw; ctx.stroke();
      // side band
      poly(ctx,[P([m[0]+MOTOR_R,m[1],m[2]]),P([mBot[0]+MOTOR_R*1.05,mBot[1],mBot[2]]),
                P([mBot[0]-MOTOR_R*1.05,mBot[1],mBot[2]]),P([m[0]-MOTOR_R,m[1],m[2]])],
           '#a07828','rgba(0,0,0,0.4)',0.7*lw);
      // motor top disc (gold/brass)
      ctx.fillStyle='#d4a030'; ctx.beginPath();
      ctx.ellipse(P0[0],P0[1],Math.max(2,radMain),Math.max(1.2,radMinor),tilt,0,7);
      ctx.fill(); ctx.strokeStyle='#8B6014'; ctx.lineWidth=lw; ctx.stroke();
      // highlight ring
      ctx.strokeStyle='rgba(255,200,100,0.22)'; ctx.lineWidth=0.8*lw;
      ctx.beginPath();
      ctx.ellipse(P0[0]-radMain*0.08,P0[1]-radMinor*0.12,radMain*0.58,radMinor*0.58,tilt,0,7);
      ctx.stroke();

      /* props */
      const spin=(i%2===0)?1:-1;
      const pa=propPhase*spin+i*Math.PI*0.5;
      [0,Math.PI].forEach(off=>{
        const angle=pa+off;
        const cosA=Math.cos(angle), sinA=Math.sin(angle);
        const tip=[m[0]+cosA*PROP_L, m[1]+0.012, m[2]+sinA*PROP_L];
        const root=[m[0], m[1]+0.012, m[2]];
        const TP=P(tip), RP=P(root);
        const dx=TP[0]-RP[0], dy=TP[1]-RP[1];
        const len=Math.hypot(dx,dy)||1;
        const nx=-dy/len, ny=dx/len;
        const s=Math.min(W,H)/400;
        const rw=PROP_RW*s, tw=3*s, mw=6.5*s;
        const mid=[m[0]+cosA*PROP_L*0.5,m[1]+0.012,m[2]+sinA*PROP_L*0.5];
        const MP=P(mid);
        const mdx=MP[0]-RP[0], mdy=MP[1]-RP[1];
        const ml=Math.hypot(mdx,mdy)||1;
        const mnx=-mdy/ml, mny=mdx/ml;
        ctx.beginPath();
        ctx.moveTo(RP[0]+nx*rw,RP[1]+ny*rw);
        ctx.quadraticCurveTo(MP[0]+mnx*mw*1.25,MP[1]+mny*mw*1.25,TP[0]+nx*tw,TP[1]+ny*tw);
        ctx.lineTo(TP[0]-nx*tw,TP[1]-ny*tw);
        ctx.quadraticCurveTo(MP[0]-mnx*mw*1.25,MP[1]-mny*mw*1.25,RP[0]-nx*rw,RP[1]-ny*rw);
        ctx.closePath();
        const pDepth=Z(tip), alpha=Math.min(0.82,Math.max(0.45,0.62+pDepth*0.25));
        ctx.fillStyle=`rgba(22,22,22,${alpha.toFixed(2)})`; ctx.fill();
        ctx.strokeStyle='rgba(75,75,75,0.3)'; ctx.lineWidth=0.5*lw; ctx.stroke();
      });
    });

    /* ── GPS mast ─────────────────────────────────────────────────── */
    const mastBase=P([0.01,0,0]), mastTop=P([0.01,GPS_Y,-0.01]);
    ctx.strokeStyle='#525252'; ctx.lineWidth=2.6*lw; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(mastBase[0],mastBase[1]); ctx.lineTo(mastTop[0],mastTop[1]); ctx.stroke();
    // puck
    const gp=[0.01,GPS_Y,-0.01];
    const GP=P(gp);
    const gpRX=P([gp[0]+GPS_R,gp[1],gp[2]]), gpRZ=P([gp[0],gp[1],gp[2]+GPS_R]);
    const gpRadX=Math.hypot(gpRX[0]-GP[0],gpRX[1]-GP[1]);
    const gpRadZ=Math.hypot(gpRZ[0]-GP[0],gpRZ[1]-GP[1]);
    const gpTilt=Math.atan2(gpRX[1]-GP[1],gpRX[0]-GP[0]);
    ctx.fillStyle='#4a4a4a'; ctx.beginPath();
    ctx.ellipse(GP[0],GP[1],Math.max(3,gpRadX),Math.max(1.5,Math.min(gpRadX,gpRadZ)*0.44),gpTilt,0,7);
    ctx.fill(); ctx.strokeStyle='#666'; ctx.lineWidth=0.9*lw; ctx.stroke();
    // green GPS LED
    const gpLed=P([gp[0]+GPS_R*0.3,gp[1]-0.005,gp[2]]);
    const gla=0.55+0.45*Math.sin(now*0.0014+2);
    ctx.beginPath(); ctx.arc(gpLed[0],gpLed[1],2.5*lw,0,7);
    ctx.fillStyle=`rgba(0,220,80,${gla.toFixed(2)})`; ctx.fill();

    ctx.restore();
  }

  /* ── init ────────────────────────────────────────────────────────── */
  function initDrone(canvas, getHeroMouse) {
    let W=0, H=0, raf=null;
    const DPR=Math.min(window.devicePixelRatio||1,2);
    const ctx=canvas.getContext('2d');
    let curPitch=0.34;

    function resize() {
      const r=canvas.getBoundingClientRect();
      W=r.width; H=r.height;
      canvas.width=Math.round(W*DPR); canvas.height=Math.round(H*DPR);
      ctx.setTransform(DPR,0,0,DPR,0,0);
    }

    function frame(now) {
      raf=null;
      ctx.clearRect(0,0,W,H);
      const m=getHeroMouse?getHeroMouse():{x:0.5,y:0.5};
      const autoYaw=REDUCED?0.55:(now/22000)*Math.PI*2;
      const yaw=autoYaw+(REDUCED?0:(m.x-0.5)*0.28);
      if(!REDUCED) curPitch+=(0.33+(m.y-0.5)*0.18-curPitch)*0.04;
      const pitch=curPitch;
      const propPhase=REDUCED?0:(now/1400)*Math.PI*2;
      const hoverY=REDUCED?0:Math.sin(now*0.0013)*Math.min(W,H)*0.015;
      ctx.save(); ctx.translate(0,hoverY);
      drawDrone(ctx,W,H,yaw,pitch,propPhase,now);
      ctx.restore();
      if(!REDUCED) raf=requestAnimationFrame(frame);
    }

    function play() {
      cancelAnimationFrame(raf); resize();
      if(REDUCED){drawDrone(ctx,W,H,0.55,0.34,0,0);return;}
      raf=requestAnimationFrame(frame);
    }
    function stop() { cancelAnimationFrame(raf); }
    window.addEventListener('resize',()=>{resize();if(!raf&&!REDUCED)raf=requestAnimationFrame(frame);});
    return {play,stop};
  }

  window.Drone3D={initDrone};
})();
