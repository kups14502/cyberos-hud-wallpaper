/* =========================================================================
   SCENE: OUTRUN ("Horizon Sun")
   The synthwave horizon, in the accent color: a sliced sun resting on the
   primary monitor's horizon, three ranges of rim-lit crags in front of it,
   and a perspective grid floor rolling toward the viewer. Every color is a
   lightness or small hue shift of the accent, so pale ice and cyan both read
   as one palette.

   Almost all of it is static, so almost all of it is cached:
     * sky: the sun disk is painted once into an offscreen canvas. A sky frame
       clips its slices (a handful of rects) and blits it, and the sky only
       redraws at ~20 Hz, since nothing on it moves fast.
     * band: mountains, haze, the horizon line and the sun's glow on the floor
       are one offscreen strip, and the vertical grid lines are one Path2D.
       Only the horizontal grid lines are rebuilt per frame, about eighty
       segments in one path.
   Caches rebuild when PAL.gen, a canvas size or the monitor geometry change.
   ========================================================================= */
SCENES.outrun=(function(){
  const HZ=0.60;          // horizon, as a share of its monitor's height
  const BAND=0.60;        // band share of its layer: room above the horizon for the peaks
  const SUN_R=0.19, SUN_RW=0.22;   // sun radius: share of monitor height, capped by width
  const SUN_UP=0.62;      // sun center, in radii above the horizon
  const SLICES=6;         // gaps in the lower disk
  const SLICE_RATE=1/6;   // gap periods per second: the slices sink slowly
  const DEPTH=0.25;       // grid row spacing; depth 1 is the monitor's bottom edge
  const SPEED=0.30;       // grid rows per second toward the viewer
  const CELL=1.3;         // cell width over cell depth, near the viewer
  const GRID_A=0.55;      // grid alpha at the bottom edge
  const SKY_MS=45;        // sky redraw interval

  const E={ e:0 };                  // eased bass, 0 unless music is playing
  const SKY={ g:null, last:-1 };
  const C={ gen:-1, star:null };

  const hue=h=>((h%360)+360)%360;
  const smooth=(a,b,x)=>{ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
  function surface(w,h){
    w=Math.max(1,Math.ceil(w)); h=Math.max(1,Math.ceil(h));
    if(typeof OffscreenCanvas==="function") return new OffscreenCanvas(w,h);
    const c=document.createElement("canvas"); c.width=w; c.height=h; return c;
  }
  function pal(){
    if(C.gen===PAL.gen) return C;
    C.gen=PAL.gen;
    const l=clamp(PAL.l+20,0,92), s=clamp(PAL.s-20,0,100);
    C.star=Array.from({length:41},(_,j)=>hslStr(PAL.h, s, l, (j/40).toFixed(3)));
    return C;
  }

  /* ---- deterministic noise, so a rebuild never reshuffles the skyline ---- */
  function hash(i){
    let x=Math.imul(i|0,0x27d4eb2d)^0x165667b1;
    x=Math.imul(x^(x>>>15),0x85ebca6b); x^=x>>>13;
    return (x>>>0)/4294967296;
  }
  // Linear value noise summed over octaves: straight runs between kinks read
  // as rock. Smooth interpolation here gave rounded dunes.
  function lnoise(x){ const i=Math.floor(x); return lerp(hash(i),hash(i+1),x-i); }
  function crag(x){
    let s=0,a=1,n=0,f=1;
    for(let o=0;o<7;o++){ s+=a*lnoise(x*f+o*37.1); n+=a; a*=0.56; f*=2.07; }
    return Math.pow(clamp((s/n-0.24)/0.56,0,1),1.45);
  }
  function rng(seed){
    let a=seed>>>0;
    return ()=>{ a=(a+0x6D2B79F5)>>>0; let t=a;
      t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61);
      return ((t^(t>>>14))>>>0)/4294967296; };
  }
  /* Three ranges, back to front. Heights are shares of M, the monitor's short
     side (so portrait does not grow alps), sampled at u = (x - vanishing x) / M.
     The envelope runs on v, the same distance in sun radii: every range stays
     low under the sun so it keeps its slices, and rises toward the sides.
       f, off   noise frequency and seed offset
       h, lo    tallest peak, and the envelope's floor under the sun
       v0, v1   where the envelope starts and finishes rising
       fill     accent haze in the range's body; line: crest alpha */
  const RANGES=[
    {f:1.7, off:5.1,  h:0.110, lo:0.10, v0:0.9, v1:2.6, fill:0.030, line:0.16},
    {f:3.0, off:11.3, h:0.075, lo:0.06, v0:1.2, v1:3.0, fill:0.014, line:0.32},
    {f:5.2, off:47.1, h:0.042, lo:0.00, v0:1.8, v1:4.2, fill:0,     line:0.55},
  ];
  function rangeH(r, u, v){
    return 0.003 + r.h*(r.lo+(1-r.lo)*smooth(r.v0,r.v1,Math.abs(v)))*crag(u*r.f+r.off);
  }

  /* ---- where the sun and the horizon go ----
     SC.screens is only filled once the loop runs, and game mode set to Always
     never runs it, so fall back to the layout engine's list. */
  function primaryIdx(){ return SC.screens.length ? SC.primary : (LAY.primary|0); }
  function viewPrimary(w,h){
    const S=SC.screens.length ? SC.screens : (LAY.screens||[]);
    return S[primaryIdx()] || {x:0,y:0,w:w,h:h};
  }
  function sunOf(P){
    const R=Math.min(P.h*SUN_R, P.w*SUN_RW), hz=P.y+P.h*HZ;
    return {cx:P.x+P.w/2, hz:hz, R:R, cy:hz-R*SUN_UP};
  }
  // The monitor a band belongs to: the primary when its center is on the band
  // (a span, or the primary's own layer), else the monitor this per-monitor
  // layer was cut for.
  function home(T){
    const S=T.screens||[], P=S[primaryIdx()];
    if(P && P.x+P.w/2>0 && P.x+P.w/2<T.w) return {r:P, main:true};
    for(const s of S) if(Math.abs(s.x)<2 && Math.abs(s.w-T.w)<2) return {r:s, main:false};
    const lh=T.h/BAND;
    return {r:{x:0,y:T.h-lh,w:T.w,h:lh}, main:false};
  }

  /* =============================== BAND =============================== */
  function bandGeo(T){
    const H=home(T), P=H.r, G=T.outrun;
    if(G && G.gen===PAL.gen && G.w===T.w && G.h===T.h && G.dpr===T.dpr && G.cx===T.cx &&
       G.px===P.x && G.py===P.y && G.pw===P.w && G.ph===P.h) return G;
    const g={gen:PAL.gen, w:T.w, h:T.h, dpr:T.dpr, cx:T.cx, px:P.x, py:P.y, pw:P.w, ph:P.h};
    const ctx=T.ctx, h=PAL.h, s=PAL.s, lit=clamp(PAL.l+8,0,80);
    g.hz=P.y+P.h*HZ;
    g.A=Math.max(8, P.y+P.h-g.hz);            // screen px from horizon to depth 1
    g.zFar=Math.sqrt(g.A*DEPTH/0.5);          // rows past this merge into the horizon haze
    const floor=Math.max(1, T.h-g.hz);

    // vertical lines never move (the camera only travels forward): one Path2D
    const cw=CELL*DEPTH*g.A, zN=g.A/(floor+1), zV=g.zFar, yF=g.hz+g.A/zV;
    const jMax=Math.ceil(Math.max(g.cx, T.w-g.cx)*zV/cw)+1;
    const vp=new Path2D();
    for(let j=-jMax;j<=jMax;j++){ vp.moveTo(g.cx+j*cw/zV, yF); vp.lineTo(g.cx+j*cw/zN, T.h+1); }
    g.vpath=vp;

    // one vertical gradient fades every grid line into the horizon
    const gg=ctx.createLinearGradient(0,g.hz,0,T.h);
    // rows and columns fade in from nothing where they start, so the grid
    // grows out of the haze instead of beginning at an edge
    const u0=1/g.zFar;
    const U=[0,u0,u0*1.5,u0*2.2,u0*3.2,0.18,0.3,0.45,0.65,0.85,1];
    for(const u of U){
      const y=u*g.A; if(y>floor) break;
      const a=smooth(u0,u0*3.2,u)*(0.1+0.9*Math.pow(u,1.15));
      gg.addColorStop(y/floor, hslStr(h,s,lit,(GRID_A*a).toFixed(3)));
    }
    if(floor>g.A) gg.addColorStop(1, hslStr(h,s,lit,GRID_A));
    g.grad=gg;

    // and a horizontal erase keeps the floor calm under the corner panels
    const eg=ctx.createLinearGradient(0,0,T.w,0);
    for(let i=0;i<=48;i++){
      const d=Math.abs(i/48*T.w-g.cx)/P.w;
      eg.addColorStop(i/48, "rgba(0,0,0,"+(0.72*smooth(0.16,0.62,d)).toFixed(3)+")");
    }
    g.edge=eg;

    buildStrip(T, g, P, H.main);
    T.outrun=g;
    return g;
  }

  /* Everything static on the band, drawn once: the sun's glow on the floor,
     three ranges with haze pooled between them, the horizon line. Each range
     is filled with the background first, which is what hides the sun and the
     ranges behind it. */
  function buildStrip(T, g, P, main){
    const h=PAL.h, s=PAL.s, lit=clamp(PAL.l+8,0,80), cx=g.cx, hz=g.hz, W=T.w;
    const sun=sunOf(P), glowR=main ? sun.R*2.3 : 0;
    // the band's top edge is the ceiling: a span's primary leaves less room
    const M=Math.min(P.h, P.w*0.75), mk=Math.min(1, (hz-6)/(M*0.118));
    // envelope unit: the sun radius, squeezed on a narrow monitor so its
    // edges still reach the peaks
    const vr=Math.min(sun.R, P.w/5.6);
    const top=Math.max(0, hz-M*0.118*mk-4);
    const bot=hz+Math.max(g.A*0.14, glowR*0.3)+2;
    const cv=surface(W*T.dpr, (bot-top)*T.dpr), c=cv.getContext("2d");
    c.setTransform(T.dpr,0,0,T.dpr,0,-top*T.dpr);
    g.strip=cv; g.stripY=top; g.stripW=cv.width/T.dpr; g.stripH=cv.height/T.dpr;

    if(main){
      c.save();
      c.beginPath(); c.rect(0,hz,W,bot-hz); c.clip();
      c.translate(cx,hz); c.scale(1,0.3);
      const rg=c.createRadialGradient(0,0,0,0,0,glowR);
      rg.addColorStop(0,   hslStr(hue(h+14),s,lit,0.22));
      rg.addColorStop(0.3, hslStr(hue(h+14),s,lit,0.08));
      rg.addColorStop(0.7, hslStr(hue(h+14),s,lit,0.02));
      rg.addColorStop(1,   hslStr(hue(h+14),s,lit,0));
      c.fillStyle=rg; c.fillRect(-glowR,-glowR,glowR*2,glowR*2);
      c.restore();
    }

    // crest lines are rim light from the sun behind them: brightest near it
    const rim=a=>{
      const lg=c.createLinearGradient(0,0,W,0);
      for(let i=0;i<=48;i++){
        const v=(i/48*W-cx)/sun.R;
        lg.addColorStop(i/48, hslStr(h,s,lit,(a*(0.3+0.7*Math.exp(-v*v/10))).toFixed(3)));
      }
      return lg;
    };
    // haze pooled on the horizon over a range's feet, a little less each time
    // it is laid down, so every range in front reads nearer and darker
    const haze=(depth,a)=>{
      const hy=hz-M*depth*mk, hg=c.createLinearGradient(0,hy,0,hz);
      hg.addColorStop(0,   hslStr(hue(h-6),s,lit,0));
      hg.addColorStop(0.65,hslStr(hue(h-6),s,lit,(a*0.35).toFixed(3)));
      hg.addColorStop(1,   hslStr(hue(h-6),s,lit,a));
      c.fillStyle=hg; c.fillRect(0,hy,W,hz-hy);
    };
    const step=3;
    c.lineWidth=1; c.lineJoin="round";
    RANGES.forEach((r,i)=>{
      const line=new Path2D();
      for(let x=-step;x<=W+step;x+=step){
        const y=hz-rangeH(r,(x-cx)/M,(x-cx)/vr)*M*mk;
        x===-step ? line.moveTo(x,y) : line.lineTo(x,y);
      }
      const body=new Path2D(line);
      body.lineTo(W+step,hz+1); body.lineTo(-step,hz+1); body.closePath();
      c.fillStyle=PAL.bg; c.fill(body);
      if(r.fill){
        const fg=c.createLinearGradient(0,hz-M*r.h*mk,0,hz);
        fg.addColorStop(0, hslStr(h,s,lit,(r.fill*0.3).toFixed(3)));
        fg.addColorStop(1, hslStr(h,s,lit,r.fill));
        c.fillStyle=fg; c.fill(body);
      }
      c.strokeStyle=rim(r.line); c.stroke(line);
      if(i<RANGES.length-1) haze(i ? 0.035 : 0.06, i ? 0.10 : 0.07);
    });

    // the floor's own haze, where the rows grow too dense to tell apart
    const fl=c.createLinearGradient(0,hz,0,hz+g.A*0.14);
    fl.addColorStop(0,   hslStr(h,s,lit,0.10));
    fl.addColorStop(0.4, hslStr(h,s,lit,0.035));
    fl.addColorStop(1,   hslStr(h,s,lit,0));
    c.fillStyle=fl; c.fillRect(0,hz,W,g.A*0.14);

    // the horizon line, brightest under the sun
    const lg=c.createLinearGradient(0,0,W,0);
    for(let i=0;i<=48;i++){
      const d=Math.abs(i/48*W-cx)/P.w;
      lg.addColorStop(i/48, hslStr(h,s,clamp(lit+10,0,88),(0.14+0.8*Math.exp(-d*d*9)).toFixed(3)));
    }
    c.fillStyle=lg;
    c.globalAlpha=0.22; c.fillRect(0,hz-3,W,6);
    c.globalAlpha=1;    c.fillRect(0,hz-0.75,W,1.5);
  }

  function paint(T, ph, ga){
    const g=bandGeo(T), ctx=T.ctx, fy=g.hz, fh=T.h-g.hz;
    ctx.clearRect(0,0,T.w,T.h);
    ctx.beginPath();
    const kMax=Math.ceil(g.zFar/DEPTH)+1;
    for(let k=1;k<=kMax;k++){
      const z=(k-ph)*DEPTH; if(z<=0 || z>g.zFar) continue;
      const y=g.hz+g.A/z; if(y>T.h+1) continue;
      ctx.moveTo(0,y); ctx.lineTo(T.w,y);
    }
    // a wide faint pass under the hairline stands in for the glow the
    // economy surface drops, then the hairline itself
    ctx.strokeStyle=g.grad;
    ctx.lineWidth=3.2; ctx.globalAlpha=ga*0.2;
    ctx.stroke(); ctx.stroke(g.vpath);
    ctx.lineWidth=1;   ctx.globalAlpha=ga;
    ctx.stroke(); ctx.stroke(g.vpath);
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation="destination-out";
    ctx.fillStyle=g.edge; ctx.fillRect(0,fy,T.w,fh);
    // an opaque floor slid in underneath, so the flat graph-paper grid of the
    // vignette layer does not show through between the perspective lines.
    // A photo kept under the scene has no such grid, and it should show.
    if(!BGMED.kind){
      ctx.globalCompositeOperation="destination-over";
      ctx.fillStyle=PAL.bg; ctx.fillRect(0,fy,T.w,fh);
    }
    ctx.globalCompositeOperation="source-over";
    ctx.drawImage(g.strip, 0, g.stripY, g.stripW, g.stripH);
  }

  /* ================================ SKY ================================ */
  function skyGeo(K){
    const k=K.ctx.canvas.width/Math.max(1,K.w), P=viewPrimary(K.w,K.h), per=!!CFG.bgPerMonitor;
    const G=SKY.g;
    if(G && G.gen===PAL.gen && G.w===K.w && G.h===K.h && G.k===k && G.per===per &&
       G.px===P.x && G.py===P.y && G.pw===P.w && G.ph===P.h) return G;
    const g={gen:PAL.gen, w:K.w, h:K.h, k:k, per:per, px:P.x, py:P.y, pw:P.w, ph:P.h};
    const ctx=K.ctx, h=PAL.h, s=PAL.s, lit=clamp(PAL.l+8,0,80);
    Object.assign(g, sunOf(P));
    const R=g.R;

    // horizon glow: one across a span, one per monitor when each has its own horizon
    const S=SC.screens.length ? SC.screens : (LAY.screens||[]);
    const rows=(per && S.length) ? S.map(r=>({x:r.x, w:r.w, hz:r.y+r.h*HZ, h:r.h}))
                                 : [{x:0, w:K.w, hz:g.hz, h:P.h}];
    g.clearH=0;
    g.haze=rows.map(r=>{
      const y0=r.hz-r.h*0.5, gr=ctx.createLinearGradient(0,y0,0,r.hz);
      gr.addColorStop(0,   hslStr(hue(h+18),s,lit,0));
      gr.addColorStop(0.55,hslStr(hue(h+8), s,lit,0.018));
      gr.addColorStop(0.85,hslStr(hue(h-4), s,lit,0.045));
      gr.addColorStop(1,   hslStr(hue(h-8), s,lit,0.09));
      g.clearH=Math.max(g.clearH, r.hz+2);
      return {x:r.x, w:r.w, y0:y0, y1:r.hz, g:gr};
    });
    g.clearH=Math.min(K.h, g.clearH);

    // the glow the sun throws along the horizon: a circle squashed into a wide
    // ellipse by a scale at draw time, so it can reach past the primary's edges
    g.gr=P.h*0.24; g.gsx=(P.w*1.05)/g.gr;
    const eg=ctx.createRadialGradient(0,0,0,0,0,g.gr);
    eg.addColorStop(0,   hslStr(hue(h-4),s,lit,0.13));
    eg.addColorStop(0.25,hslStr(hue(h-2),s,lit,0.08));
    eg.addColorStop(0.6, hslStr(hue(h+10),s,lit,0.025));
    eg.addColorStop(1,   hslStr(hue(h+18),s,lit,0));
    g.glow=eg;
    // everything but the disk: the glow stays out of the slices, so they read
    // as cuts through to the night instead of gray bars
    const out=new Path2D();
    out.rect(0,0,K.w,g.clearH); out.arc(g.cx,g.cy,R,0,Math.PI*2);
    g.outside=out;

    // halo: a wide soft bloom that sells the disk as a light source. It is
    // drawn inside the same clip as the glow, since a radial gradient paints
    // its first stop over everything inside its inner circle: unclipped, that
    // filled the slices with gray bars.
    g.hr=R*2.7;
    const hg=ctx.createRadialGradient(g.cx,g.cy,R,g.cx,g.cy,g.hr);
    hg.addColorStop(0,    hslStr(hue(h+2),s,lit,0.26));
    hg.addColorStop(0.03, hslStr(hue(h+2),s,lit,0.15));
    hg.addColorStop(0.12, hslStr(hue(h+4),s,lit,0.075));
    hg.addColorStop(0.32, hslStr(hue(h+6),s,lit,0.03));
    hg.addColorStop(0.62, hslStr(hue(h+8),s,lit,0.009));
    hg.addColorStop(1,    hslStr(hue(h+8),s,lit,0));
    g.halo=hg;

    // the disk, at device resolution: pale light on the crown sinking into
    // deep accent at the horizon. Below the crown the lightness stays in the
    // saturated middle, since a pale color under alpha reads as gray, and the
    // fade is carried by alpha, which also keeps the biggest object on screen
    // dim enough for an OLED panel.
    const pad=3, sz=2*R+pad*2, cv=surface(sz*k, sz*k), c=cv.getContext("2d");
    c.setTransform(k,0,0,k,0,0);
    const dg=c.createLinearGradient(0,pad,0,pad+2*R);
    dg.addColorStop(0,    hslStr(hue(h-8), s,clamp(lit+6,72,84),0.90));
    dg.addColorStop(0.2,  hslStr(hue(h-4), s,clamp(lit-8,60,72),0.78));
    dg.addColorStop(0.48, hslStr(hue(h),   s,clamp(lit-20,52,60),0.62));
    dg.addColorStop(0.76, hslStr(hue(h+6), s,clamp(lit-28,48,52),0.48));
    dg.addColorStop(1,    hslStr(hue(h+14),s,clamp(lit-34,42,46),0.36));
    c.fillStyle=dg;
    c.beginPath(); c.arc(pad+R,pad+R,R,0,Math.PI*2); c.fill();
    // a touch of limb darkening, so it reads as a lit body and not a sticker
    const lg=c.createRadialGradient(pad+R,pad+R*0.8,R*0.55,pad+R,pad+R,R);
    lg.addColorStop(0,"rgba(0,0,0,0)"); lg.addColorStop(0.75,"rgba(0,0,0,0.05)"); lg.addColorStop(1,"rgba(0,0,0,0.2)");
    c.globalCompositeOperation="source-atop"; c.fillStyle=lg; c.fillRect(0,0,sz,sz);
    c.globalCompositeOperation="source-over";
    // and a crisp rim, bright on the crown and gone by the equator
    const rg=c.createLinearGradient(0,pad,0,pad+R*1.1);
    rg.addColorStop(0, hslStr(hue(h-6),s,clamp(lit+6,0,88),0.55));
    rg.addColorStop(1, hslStr(hue(h-6),s,clamp(lit+6,0,88),0));
    c.strokeStyle=rg; c.lineWidth=1.25;
    c.beginPath(); c.arc(pad+R,pad+R,R-0.6,0,Math.PI*2); c.stroke();
    g.sun=cv; g.pad=pad; g.sunW=cv.width/k; g.sunH=cv.height/k;

    // sparse stars, thinning toward the horizon and kept off the sun's halo.
    // Grouped by tier and twinkle phase, so each group is one fill.
    const r=rng(0x5eed), lim=g.hz-P.h*0.08;
    const n=clamp(Math.round(K.w*Math.max(0,lim)/20000),60,900);
    const paths=Array.from({length:18},()=>new Path2D());
    for(let i=0;i<n;i++){
      const x=r()*K.w, y=lim*Math.pow(r(),1.35), t=r(), ph=(r()*6)|0;
      if(Math.hypot(x-g.cx,y-g.cy)<R*1.5) continue;
      const low=y/lim;
      const tier=(t<0.06 && low<0.6) ? 2 : (t<0.32 && low<0.8) ? 1 : 0;
      const z=[1.1,1.6,2.2][tier];
      paths[tier*6+ph].rect(x,y,z,z);
    }
    g.stars=paths;
    SKY.g=g;
    return g;
  }

  function paintSky(K, t, sph, e){
    const g=skyGeo(K), ctx=K.ctx, c=pal(), R=g.R;
    ctx.clearRect(0,0,K.w,g.clearH);
    for(const z of g.haze){ ctx.fillStyle=z.g; ctx.fillRect(z.x,z.y0,z.w,z.y1-z.y0); }
    ctx.save();
    ctx.clip(g.outside,"evenodd");
    const hy=g.cy-g.hr;
    ctx.globalAlpha=clamp(0.85+0.5*e,0,1);
    ctx.fillStyle=g.halo; ctx.fillRect(g.cx-g.hr, hy, g.hr*2, g.hz-hy);
    ctx.globalAlpha=1;
    ctx.translate(g.cx,g.hz); ctx.scale(g.gsx,1);
    ctx.fillStyle=g.glow; ctx.fillRect(-g.gr,-g.gr,g.gr*2,g.gr);
    ctx.restore();

    const base=[0.26,0.42,0.66];
    for(let i=0;i<18;i++){
      const grp=i%6, a=base[(i/6)|0]*(0.62+0.38*Math.sin(t*(0.35+grp*0.11)+grp*1.7));
      ctx.fillStyle=c.star[clamp(Math.round(a*40),0,40)];
      ctx.fill(g.stars[i]);
    }

    // the slices: gaps born as hairlines below the middle, widening as they sink
    const x0=g.cx-R-2, w=2*R+4, top=g.cy-R, bot=Math.min(g.hz, g.cy+R);
    const ys=g.cy-0.08*R, span=bot-ys, pd=span/SLICES;
    ctx.save();
    ctx.beginPath();
    let y=top;
    for(let i=0;i<SLICES;i++){
      const m=ys+(i+sph)*pd, p=(m-ys)/span, gh=pd*0.62*Math.pow(p,1.15);
      if(m-gh/2>y) ctx.rect(x0,y,w,m-gh/2-y);
      y=Math.max(y,m+gh/2);
    }
    if(bot>y) ctx.rect(x0,y,w,bot-y);
    ctx.clip();
    ctx.globalAlpha=clamp(0.92+0.1*e,0,1);
    ctx.drawImage(g.sun, g.cx-R-g.pad, g.cy-R-g.pad, g.sunW, g.sunH);
    ctx.restore();
    ctx.globalAlpha=1;
  }

  const bass=S=>(AUD.live && CFG.audio) ? clamp(S.energy*2,0,1) : 0;

  return {
    label:"Horizon Sun", band:BAND,
    init(){ SKY.g=null; SKY.last=-1; },
    frame(dt, S){ E.e=lerp(E.e, bass(S), 1-Math.exp(-dt/180)); },
    draw(T, S){ paint(T, (S.t*SPEED)%1, 0.86+0.14*E.e); },
    sky(K, S){
      const now=S.t*1000;
      if(SKY.g && SKY.last>=0 && now-SKY.last<SKY_MS && now>=SKY.last) return;
      SKY.last=now;
      paintSky(K, S.t, (S.t*SLICE_RATE)%1, E.e);
    },
    still(T){ paint(T, 0.4, 0.9); },
    stillSky(K){ paintSky(K, 2.1, 0.45, 0); SKY.last=-1; }
  };
})();
