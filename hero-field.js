/* ============================================================
   hero-field.js — robotics/AI aurora hero backdrop.
   Supports dark (night) and light (day/sky) modes via u_light.
   Exposes setMode(bool), getMouse() for external callers.
   ============================================================ */
(function () {
  'use strict';
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const VERT = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.0,1.0); }`;

  const FRAG = `
    precision highp float;
    uniform vec2 u_res;
    uniform float u_time;
    uniform vec2 u_mouse;
    uniform float u_light;
    varying vec2 v_uv;

    float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
      vec2 u=f*f*(3.-2.*f);
      return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
    }
    float fbm(vec2 p){
      float v=0.,a=0.5;
      for(int i=0;i<6;i++){ v+=a*noise(p); p=p*2.0+vec2(1.7,9.2); a*=0.5; }
      return v;
    }
    void main(){
      vec2 uv=v_uv;
      vec2 asp=vec2(u_res.x/u_res.y,1.0);
      vec2 p=uv*asp*1.6;
      float t=u_time*0.035;
      vec2 m=u_mouse*asp*1.6;
      float md=distance(p,m);

      vec2 q=vec2(fbm(p+t), fbm(p+vec2(5.2,1.3)-t));
      vec2 r=vec2(fbm(p+q*1.8+vec2(1.7,9.2)+t*0.6), fbm(p+q*1.8+vec2(8.3,2.8)-t*0.6));
      r += 0.25*normalize(m-p+1e-4)*exp(-md*md*1.8);
      float f=fbm(p+r*2.2);

      /* dark (night) palette */
      vec3 c1_d=vec3(0.024,0.028,0.047);
      vec3 c2_d=vec3(0.043,0.16,0.27);
      vec3 c3_d=vec3(0.09,0.42,0.50);
      /* light (day sky) palette */
      vec3 c1_l=vec3(0.86,0.91,0.97);
      vec3 c2_l=vec3(0.50,0.74,0.92);
      vec3 c3_l=vec3(0.70,0.88,0.97);

      vec3 c1=mix(c1_d,c1_l,u_light);
      vec3 c2=mix(c2_d,c2_l,u_light);
      vec3 c3=mix(c3_d,c3_l,u_light);

      vec3 col=mix(c1,c2,smoothstep(0.18,0.62,f));
      col=mix(col,c3,smoothstep(0.55,0.95,f)*clamp(r.x*1.4,0.,1.));

      /* amber glow — cursor in dark, sun-glow in light */
      vec3 amber=vec3(0.96,0.65,0.14);
      float glowStr=mix(0.40,0.80,u_light);
      float glowFall=mix(3.2,1.4,u_light);
      col += amber*glowStr*exp(-md*md*glowFall)*smoothstep(0.25,0.85,f);
      col += amber*mix(0.06,0.24,u_light)*exp(-md*md*mix(0.7,0.35,u_light));

      /* scan banding — very subtle in light */
      col += mix(0.006,0.002,u_light)*sin((uv.y*u_res.y)*0.7 + u_time*1.2);

      /* vignette: dark edges on dark; brightened centre on light */
      float vig_d=smoothstep(1.35,0.15,length((uv-0.5)*vec2(1.05,1.45)));
      float vig_l=0.65+0.35*smoothstep(0.9,0.0,length((uv-0.5)*vec2(1.1,1.5)));
      float vigFactor=mix(mix(0.30,1.0,vig_d), vig_l, u_light);
      col*=vigFactor;

      gl_FragColor=vec4(col,1.0);
    }`;

  function compile(gl, type, src){
    const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){ console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  }

  function initAurora(canvas, getMouse, getLight){
    const gl = canvas.getContext('webgl',{antialias:false,depth:false,alpha:false,powerPreference:'low-power'})
            || canvas.getContext('experimental-webgl');
    if(!gl) return null;
    const vs=compile(gl,gl.VERTEX_SHADER,VERT), fs=compile(gl,gl.FRAGMENT_SHADER,FRAG);
    if(!vs||!fs) return null;
    const prog=gl.createProgram(); gl.attachShader(prog,vs); gl.attachShader(prog,fs); gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){ console.warn(gl.getProgramInfoLog(prog)); return null; }
    gl.useProgram(prog);
    const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(prog,'a_pos'); gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    const uRes=gl.getUniformLocation(prog,'u_res');
    const uTime=gl.getUniformLocation(prog,'u_time');
    const uMouse=gl.getUniformLocation(prog,'u_mouse');
    const uLight=gl.getUniformLocation(prog,'u_light');
    const SCALE=0.55;
    let raf=null, t0=performance.now();

    function resize(){
      const r=canvas.getBoundingClientRect();
      const w=Math.max(2,Math.round(r.width*SCALE)), h=Math.max(2,Math.round(r.height*SCALE));
      if(canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; }
      gl.viewport(0,0,w,h); gl.uniform2f(uRes,w,h);
    }
    function frame(now){
      const m=getMouse();
      gl.uniform1f(uTime,(now-t0)/1000);
      gl.uniform2f(uMouse,m.x,1.0-m.y);
      gl.uniform1f(uLight,getLight());
      gl.drawArrays(gl.TRIANGLES,0,3);
      if(!REDUCED) raf=requestAnimationFrame(frame);
    }
    function play(){
      resize();
      if(REDUCED){
        gl.uniform1f(uTime,8.0); const m=getMouse();
        gl.uniform2f(uMouse,m.x,1-m.y); gl.uniform1f(uLight,getLight());
        gl.drawArrays(gl.TRIANGLES,0,3); return;
      }
      cancelAnimationFrame(raf); raf=requestAnimationFrame(frame);
    }
    window.addEventListener('resize',resize);
    return { play, resize };
  }

  function initNodes(canvas, getMouse, getLight){
    const ctx=canvas.getContext('2d');
    let w=0,h=0,dpr=Math.min(window.devicePixelRatio||1,2),raf=null;
    let pts=[];
    function resize(){
      const r=canvas.getBoundingClientRect(); w=r.width; h=r.height;
      canvas.width=w*dpr; canvas.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
      const n=Math.round(Math.min(64, Math.max(28, w*h/26000)));
      pts=[];
      for(let i=0;i<n;i++) pts.push({
        x:Math.random()*w, y:Math.random()*h,
        vx:(Math.random()-0.5)*0.12, vy:(Math.random()-0.5)*0.12,
        r:Math.random()<0.18?1.9:1.1, amber:Math.random()<0.22
      });
    }
    function frame(){
      ctx.clearRect(0,0,w,h);
      const m=getMouse(), mx=m.x*w, my=m.y*h;
      const lv=getLight();
      const LINK=Math.min(150, w*0.13);
      for(const p of pts){
        const dx=mx-p.x, dy=my-p.y, d=Math.hypot(dx,dy)||1;
        if(d<240){ const f=(1-d/240)*0.010; p.vx+=dx/d*f; p.vy+=dy/d*f; }
        p.vx*=0.985; p.vy*=0.985;
        p.x+=p.vx; p.y+=p.vy;
        if(p.x<-20)p.x=w+20; if(p.x>w+20)p.x=-20;
        if(p.y<-20)p.y=h+20; if(p.y>h+20)p.y=-20;
      }
      for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++){
        const a=pts[i],b=pts[j],dx=a.x-b.x,dy=a.y-b.y,d=Math.hypot(dx,dy);
        if(d<LINK){
          const base=(1-d/LINK);
          const al_d=base*0.16, al_l=base*0.24;
          const al=al_d+(al_l-al_d)*lv;
          const linkClr=lv>0.5?`rgba(55,90,155,${al.toFixed(3)})`:`rgba(120,170,190,${al.toFixed(3)})`;
          ctx.strokeStyle=linkClr; ctx.lineWidth=0.6;
          ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        }
      }
      for(const p of pts){
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,7);
        const nc=lv>0.5
          ?(p.amber?'rgba(160,90,8,0.60)':'rgba(55,90,155,0.50)')
          :(p.amber?'rgba(245,166,35,0.55)':'rgba(150,195,210,0.45)');
        ctx.fillStyle=nc; ctx.fill();
      }
      if(!REDUCED) raf=requestAnimationFrame(frame);
    }
    function play(){ resize(); if(REDUCED){ frame(); cancelAnimationFrame(raf); return; } cancelAnimationFrame(raf); raf=requestAnimationFrame(frame); }
    window.addEventListener('resize',resize);
    return { play, resize };
  }

  function initHeroField(auroraCanvas, nodesCanvas){
    const target={x:0.62,y:0.32}, mouse={x:0.62,y:0.32};
    let lightVal=0, lightTarget=0;

    function onMove(e){
      const r=auroraCanvas.getBoundingClientRect();
      target.x=(e.clientX-r.left)/r.width;
      target.y=(e.clientY-r.top)/r.height;
    }
    window.addEventListener('pointermove',onMove,{passive:true});
    function ease(){
      mouse.x+=(target.x-mouse.x)*0.06;
      mouse.y+=(target.y-mouse.y)*0.06;
      lightVal+=(lightTarget-lightVal)*0.015; // ~3s ease
      if(!REDUCED) requestAnimationFrame(ease);
    }
    ease();

    const getMouse=()=>mouse;
    const getLight=()=>lightVal;

    const aurora=initAurora(auroraCanvas,getMouse,getLight);
    const nodes=initNodes(nodesCanvas,getMouse,getLight);

    function setMode(val){
      lightTarget=typeof val==='boolean'?(val?1:0):Math.max(0,Math.min(1,val));
    }

    return {
      play(){
        aurora&&aurora.play(); nodes&&nodes.play();
        if(!aurora){ auroraCanvas.style.background='radial-gradient(120% 90% at 65% 30%,#0c2433,#07080d 70%)'; }
      },
      getMouse,
      setMode,
      ok:!!aurora
    };
  }

  window.HeroField = { initHeroField };
})();
