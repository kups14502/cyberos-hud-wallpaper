/* =========================================================================
   SCENE: OUTRUN ("Horizon Sun")
   The synthwave horizon, in the accent color: a sliced sun resting on the
   primary monitor's horizon, three ranges of rim-lit crags in front of it,
   and a perspective grid floor rolling toward the viewer. Every color is a
   lightness or small hue shift of the accent, so pale ice and cyan both read
   as one palette.

   Almost all of it is static, so almost all of it is cached, and the band is
   never repainted whole once it is up:
     * band: the floor (vertical grid lines, the fade under the side panels,
       the opaque ground), the mountains, the haze and the horizon line are one
       offscreen image. The canvas keeps its pixels between frames, so a frame
       only restores the thin strips a horizontal grid row left or entered from
       that image and blits the row sprite there. Rows that have not moved a
       fifth of a pixel are left alone, which spares the dense rows at the
       horizon most frames. Stroking the full-width grid every frame held a
       span to about 39 fps.
     * sky: the disk is one sprite and its slices are sub-rect blits of it, so
       no clip is ever built. The sky redraws at ~20 Hz, since nothing on it
       moves fast.
   Caches rebuild when PAL.gen, a canvas size or the monitor geometry change.
   ========================================================================= */
SCENES.outrun=(function(){
  const HZ=0.60;          // horizon, as a share of its monitor's height
  const BAND=0.60;        // band share of its layer: room above the horizon for the peaks
  const SUN_R=0.19, SUN_RW=0.22;   // sun radius: share of monitor height, capped by width
  const SUN_UP=0.62;      // sun center, in radii above the horizon
  const SLICES=6;         // gaps in the lower disk
  const SLICE_RATE=1/6;   // gap periods per second: the slices sink slowly
  const GAP_GLOW=0.4;     // share of the halo and horizon glow left showing in the gaps
  const SUN_C0=1.6, SUN_C1=2.4;    // disk chroma cap, in multiples of the accent's own: crown, horizon
  const OLED_PEAK=0.5;    // oled_mode: alpha of the disk's brightest stop
  const DRIFT_X=5, DRIFT_Y=3;       // px the sun wanders over minutes (OLED wear)
  const DEPTH=0.25;       // grid row spacing; depth 1 is the monitor's bottom edge
  const SPEED=0.30;       // grid rows per second toward the viewer
  const CELL=1.3;         // cell width over cell depth, near the viewer
  const GRID_A=0.55;      // grid alpha at the bottom edge
  const GRID_GA=0.86;     // grid brightness baked into the cached vertical lines
  const ROW_K=1.15;       // a row sprite's hairline covers its glow pass instead of adding to it
  const ROW_MIN=0.004;    // rows fainter than this are left to the horizon haze
  const EPS_Y=0.2, EPS_A=0.05;      // repaint a row once it moves this far (device px) or this much alpha
  const SKY_MS=45;        // sky redraw interval
  const TAU=Math.PI*2;

  const E={ e:0, n:0 };             // eased bass (0 unless music is playing), frame count
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
     The envelope runs on v, the same distance in sun radii: the back two stay
     low under the sun so it keeps its slices, and the front one stays high
     enough to bite into the lower disk. Aerial perspective sets them apart:
     the farther a range, the more accent haze in its body.
       f, off   noise frequency and seed offset
       h, lo    tallest peak, and the envelope's floor under the sun
       v0, v1   where the envelope starts and finishes rising
       fill     accent haze in the range's body; line: crest alpha */
  const RANGES=[
    {f:1.7, off:5.1,  h:0.110, lo:0.10, v0:0.9, v1:2.6, fill:0.075, line:0.16},
    {f:3.0, off:11.3, h:0.075, lo:0.06, v0:1.2, v1:3.0, fill:0.032, line:0.30},
    {f:5.2, off:47.1, h:0.068, lo:0.62, v0:1.2, v1:3.4, fill:0,     line:0.55},
  ];
  const RANGE_TOP=Math.max(...RANGES.map(r=>r.h))+0.008;   // headroom the strip keeps above the horizon
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
  // The sun wanders a few px on two slow incommensurate sines, keyed to the
  // wall clock so a reload or a game-mode still lands somewhere new.
  function drift(){
    const t=Date.now()/1000;
    return {x:DRIFT_X*Math.sin(t*TAU/437+0.9), y:DRIFT_Y*Math.sin(t*TAU/661+2.3)};
  }

  /* =============================== BAND =============================== */
  function bandGeo(T){
    const H=home(T), P=H.r, G=T.outrun, op=!BGMED.kind;
    if(G && G.gen===PAL.gen && G.w===T.w && G.h===T.h && G.dpr===T.dpr && G.cx===T.cx && G.op===op &&
       G.px===P.x && G.py===P.y && G.pw===P.w && G.ph===P.h){
      if(!G.base){ buildBase(T,G); T.orRows=null; }
      return G;
    }
    const g={gen:PAL.gen, w:T.w, h:T.h, dpr:T.dpr, cx:T.cx, op:op, px:P.x, py:P.y, pw:P.w, ph:P.h,
             P:{x:P.x, y:P.y, w:P.w, h:P.h}, main:H.main, Wd:T.cv.width, Hd:T.cv.height};
    g.hz=P.y+P.h*HZ;
    g.A=Math.max(8, P.y+P.h-g.hz);            // screen px from horizon to depth 1
    g.zFar=Math.sqrt(g.A*DEPTH/0.5);          // rows past this merge into the horizon haze
    g.u0=1/g.zFar;
    g.kMax=Math.ceil(g.zFar/DEPTH)+1;
    buildRow(T,g);
    buildBase(T,g);
    T.outrun=g; T.orRows=null;
    return g;
  }

  // the erase that keeps the floor calm under the corner panels, as a
  // horizontal gradient over [0, x1] in the target's own units
  function edge(c, x1, T, g){
    const eg=c.createLinearGradient(0,0,x1,0);
    for(let i=0;i<=48;i++){
      const d=Math.abs(i/48*T.w-g.cx)/g.P.w;
      eg.addColorStop(i/48, "rgba(0,0,0,"+(0.72*smooth(0.16,0.62,d)).toFixed(3)+")");
    }
    return eg;
  }

  /* One horizontal grid row at full alpha, in device px: a wide faint pass
     that stands in for the glow the economy surface drops, the hairline, and
     the side fade. A frame blits it once per row at that row's alpha. */
  function buildRow(T, g){
    const d=T.dpr, lw=3.2*d, sh=Math.ceil(lw)+4;
    const yc=Math.floor(sh/2)+(Math.round(d)%2 ? 0.5 : 0);
    const cv=surface(g.Wd, sh), c=cv.getContext("2d");
    c.strokeStyle=hslStr(PAL.h, PAL.s, clamp(PAL.l+8,0,80));
    c.beginPath(); c.moveTo(0,yc); c.lineTo(g.Wd,yc);
    c.lineWidth=lw; c.globalAlpha=0.2; c.stroke();
    c.lineWidth=d;  c.globalAlpha=1;   c.stroke();
    c.globalCompositeOperation="destination-out";
    c.fillStyle=edge(c, g.Wd, T, g); c.fillRect(0,0,g.Wd,sh);
    g.row=cv; g.rowC=yc; g.rowH=sh;
  }

  /* Everything static on the band, drawn once into an image that covers it
     from the tallest peak down: the floor's vertical lines, faded under the
     panels and laid on an opaque ground, then the sun's glow on the floor,
     three ranges with haze pooled between them, the horizon line. Each range
     is filled with the background first, which is what hides the sun and the
     ranges behind it. */
  function buildBase(T, g){
    const P=g.P, h=PAL.h, s=PAL.s, lit=clamp(PAL.l+8,0,80), cx=g.cx, hz=g.hz, W=T.w, d=T.dpr;
    const sun=sunOf(P), glowR=g.main ? sun.R*2.3 : 0;
    // the band's top edge is the ceiling: a span's primary leaves less room
    const M=Math.min(P.h, P.w*0.75), mk=Math.min(1, (hz-6)/(M*RANGE_TOP));
    // envelope unit: the sun radius, squeezed on a narrow monitor so its
    // edges still reach the peaks
    const vr=Math.min(sun.R, P.w/5.6);
    const top=Math.max(0, hz-M*RANGE_TOP*mk-4), y0=Math.floor(top*d);
    const cv=surface(g.Wd, Math.max(1,g.Hd-y0)), c=cv.getContext("2d");
    c.setTransform(d,0,0,d,0,-y0);
    g.base=cv; g.baseY=y0;

    // vertical lines never move (the camera only travels forward)
    const floor=Math.max(1, T.h-hz);
    const cw=CELL*DEPTH*g.A, zN=g.A/(floor+1), zV=g.zFar, yF=hz+g.A/zV;
    const jMax=Math.ceil(Math.max(cx, W-cx)*zV/cw)+1;
    c.beginPath();
    for(let j=-jMax;j<=jMax;j++){ c.moveTo(cx+j*cw/zV, yF); c.lineTo(cx+j*cw/zN, T.h+1); }
    // one vertical gradient fades them into the horizon; they fade in from
    // nothing where they start, so the grid grows out of the haze
    const gg=c.createLinearGradient(0,hz,0,T.h);
    const u0=g.u0, U=[0,u0,u0*1.5,u0*2.2,u0*3.2,0.18,0.3,0.45,0.65,0.85,1];
    for(const u of U){
      const y=u*g.A; if(y>floor) break;
      const a=smooth(u0,u0*3.2,u)*(0.1+0.9*Math.pow(u,1.15));
      gg.addColorStop(y/floor, hslStr(h,s,lit,(GRID_A*a).toFixed(3)));
    }
    if(floor>g.A) gg.addColorStop(1, hslStr(h,s,lit,GRID_A));
    c.strokeStyle=gg;
    c.lineWidth=3.2; c.globalAlpha=GRID_GA*0.2; c.stroke();
    c.lineWidth=1;   c.globalAlpha=GRID_GA;     c.stroke();
    c.globalAlpha=1;
    c.globalCompositeOperation="destination-out";
    c.fillStyle=edge(c, W, T, g); c.fillRect(0,hz,W,floor);
    // an opaque floor slid in underneath, so the flat graph-paper grid of the
    // vignette layer does not show through between the perspective lines.
    // A photo kept under the scene has no such grid, and it should show.
    if(g.op){
      c.globalCompositeOperation="destination-over";
      c.fillStyle=PAL.bg; c.fillRect(0,hz,W,floor);
    }
    c.globalCompositeOperation="source-over";

    if(glowR){
      const bot=hz+glowR*0.3+2;
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
      const dd=Math.abs(i/48*W-cx)/P.w;
      lg.addColorStop(i/48, hslStr(h,s,clamp(lit+10,0,88),(0.14+0.8*Math.exp(-dd*dd*9)).toFixed(3)));
    }
    c.fillStyle=lg;
    c.globalAlpha=0.22; c.fillRect(0,hz-3,W,6);
    c.globalAlpha=1;    c.fillRect(0,hz-0.75,W,1.5);
  }

  // The horizontal rows at scene position v (rows travelled), in device px.
  // w is a row's identity: it stays the same while the row rolls forward.
  function rowsAt(g, v, ga){
    const n=Math.floor(v), ph=v-n, out=[], d=g.dpr, lim=g.Hd+g.rowC;
    for(let k=1;k<=g.kMax;k++){
      const z=(k-ph)*DEPTH; if(z<=0 || z>g.zFar) continue;
      const y=(g.hz+g.A/z)*d; if(y>lim) continue;
      const u=1/z, a=Math.min(1, GRID_A*ROW_K*ga*smooth(g.u0,g.u0*3.2,u)*(0.1+0.9*Math.pow(Math.min(u,1),1.15)));
      if(a>=ROW_MIN) out.push({w:k+n, y:y, a:a});
    }
    return out;
  }
  function blitRow(ctx, g, r){ ctx.globalAlpha=r.a; ctx.drawImage(g.row, 0, r.y-g.rowC); }
  function restore(ctx, g, a, b){
    const y0=Math.max(g.baseY, Math.floor(a)), y1=Math.min(g.Hd, Math.ceil(b));
    if(y1<=y0) return;
    ctx.clearRect(0,y0,g.Wd,y1-y0);
    ctx.drawImage(g.base, 0,y0-g.baseY,g.Wd,y1-y0, 0,y0,g.Wd,y1-y0);
  }
  /* Rows whose strips chain-overlap form a cluster. A cluster with any row
     that moved, appeared or left is restored from the base image and redrawn
     whole; a still cluster keeps the pixels it already has. Restoring a
     cluster never touches another one, since their strips do not overlap. */
  function update(ctx, g, T, rows){
    const prev=new Map(), ext=[], top=g.rowC+1, bot=g.rowH-g.rowC+1;
    for(const p of T.orRows) prev.set(p.w,p);
    for(const r of rows){
      const p=prev.get(r.w);
      if(p){
        prev.delete(r.w);
        const m=Math.abs(r.y-p.y)>EPS_Y || Math.abs(r.a-p.a)>p.a*EPS_A;
        ext.push({y0:Math.min(r.y,p.y)-top, y1:Math.max(r.y,p.y)+bot, r:r, p:p, m:m});
      }else ext.push({y0:r.y-top, y1:r.y+bot, r:r, p:null, m:true});
    }
    for(const p of prev.values()) ext.push({y0:p.y-top, y1:p.y+bot, r:null, p:p, m:true});
    ext.sort((a,b)=>a.y0-b.y0);
    const kept=[];
    for(let i=0;i<ext.length;){
      let j=i, y1=ext[i].y1, m=ext[i].m;
      while(j+1<ext.length && ext[j+1].y0<=y1){ j++; y1=Math.max(y1,ext[j].y1); m=m||ext[j].m; }
      if(m){
        restore(ctx, g, ext[i].y0, y1);
        for(let q=i;q<=j;q++) if(ext[q].r){ blitRow(ctx, g, ext[q].r); kept.push(ext[q].r); }
      }else for(let q=i;q<=j;q++) kept.push(ext[q].p);
      i=j+1;
    }
    T.orRows=kept;
  }

  function paint(T, v, ga){
    const g=bandGeo(T), ctx=T.ctx, rows=rowsAt(g, v, ga);
    ctx.setTransform(1,0,0,1,0,0);
    if(T.orRows && T.orSeen===E.n-1) update(ctx, g, T, rows);
    else{
      // first frame, or the canvas may have been cleared behind our back
      ctx.clearRect(0,0,g.Wd,g.Hd);
      ctx.drawImage(g.base, 0, g.baseY);
      for(const r of rows) blitRow(ctx, g, r);
      T.orRows=rows;
    }
    ctx.globalAlpha=1;
    ctx.setTransform(T.dpr,0,0,T.dpr,0,0);
    T.orSeen=E.n;
  }

  /* ================================ SKY ================================ */
  function skyGeo(K){
    const k=K.ctx.canvas.width/Math.max(1,K.w), P=viewPrimary(K.w,K.h), per=!!CFG.bgPerMonitor;
    const oled=!!CFG.oledMode, G=SKY.g;
    if(G && G.gen===PAL.gen && G.w===K.w && G.h===K.h && G.k===k && G.per===per && G.oled===oled &&
       G.px===P.x && G.py===P.y && G.pw===P.w && G.ph===P.h) return G;
    const g={gen:PAL.gen, w:K.w, h:K.h, k:k, per:per, oled:oled, px:P.x, py:P.y, pw:P.w, ph:P.h};
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

    // halo: a wide soft bloom that sells the disk as a light source. Inside
    // its inner circle it paints its first stop, which the disk then takes
    // out again: all of it behind the disk, most of it in the gaps. A dimmed
    // disk on an OLED panel gets a dimmed halo, or the bloom outshines it.
    g.hr=R*2.7;
    const hk=oled ? 0.7 : 1;
    const hg=ctx.createRadialGradient(g.cx,g.cy,R,g.cx,g.cy,g.hr);
    hg.addColorStop(0,    hslStr(hue(h+2),s,lit,(0.26*hk).toFixed(3)));
    hg.addColorStop(0.03, hslStr(hue(h+2),s,lit,(0.15*hk).toFixed(3)));
    hg.addColorStop(0.12, hslStr(hue(h+4),s,lit,(0.075*hk).toFixed(3)));
    hg.addColorStop(0.32, hslStr(hue(h+6),s,lit,(0.03*hk).toFixed(3)));
    hg.addColorStop(0.62, hslStr(hue(h+8),s,lit,(0.009*hk).toFixed(3)));
    hg.addColorStop(1,    hslStr(hue(h+8),s,lit,0));
    g.halo=hg;

    /* The disk, at device resolution: pale light on the crown sinking into
       deep accent at the horizon. Below the crown the lightness stays in the
       middle, since a pale color under alpha reads as gray, and the fade is
       carried by alpha, which also keeps the biggest object on screen dim.
       At mid lightness full saturation would turn a pale accent into cobalt,
       so each stop's chroma is capped at a multiple of the accent's own,
       rising toward the horizon the way ice deepens: pale ice stays ice, cyan
       keeps all of its color. oled_mode also caps the peak alpha, since this
       is the largest bright shape on the screen. */
    const c0=(1-Math.abs(PAL.l/50-1))*s/100;
    const sat=l=>Math.min(s, lerp(SUN_C0,SUN_C1,clamp((84-l)/38,0,1))*c0*100/Math.max(0.05,1-Math.abs(l/50-1))).toFixed(1);
    const pk=a=>(oled ? OLED_PEAK*Math.pow(a/0.9,0.6) : a).toFixed(3);
    const col=(dh,l,a)=>hslStr(hue(h+dh), sat(l), l, pk(a));
    const pad=3, sz=2*R+pad*2, cv=surface(sz*k, sz*k), c=cv.getContext("2d");
    c.setTransform(k,0,0,k,0,0);
    const dg=c.createLinearGradient(0,pad,0,pad+2*R);
    dg.addColorStop(0,    col(-8, clamp(lit+6,72,84),  0.90));
    dg.addColorStop(0.2,  col(-4, clamp(lit-8,60,72),  0.78));
    dg.addColorStop(0.48, col(0,  clamp(lit-20,52,60), 0.62));
    dg.addColorStop(0.76, col(6,  clamp(lit-28,48,52), 0.48));
    dg.addColorStop(1,    col(14, clamp(lit-34,42,46), 0.36));
    c.fillStyle=dg;
    c.beginPath(); c.arc(pad+R,pad+R,R,0,TAU); c.fill();
    // a touch of limb darkening, so it reads as a lit body and not a sticker
    const lg=c.createRadialGradient(pad+R,pad+R*0.8,R*0.55,pad+R,pad+R,R);
    lg.addColorStop(0,"rgba(0,0,0,0)"); lg.addColorStop(0.75,"rgba(0,0,0,0.05)"); lg.addColorStop(1,"rgba(0,0,0,0.2)");
    c.globalCompositeOperation="source-atop"; c.fillStyle=lg; c.fillRect(0,0,sz,sz);
    c.globalCompositeOperation="source-over";
    // and a crisp rim, bright on the crown and gone by the equator
    const rl=clamp(lit+6,0,88), rg=c.createLinearGradient(0,pad,0,pad+R*1.1);
    rg.addColorStop(0, hslStr(hue(h-6),sat(rl),rl,oled ? 0.3 : 0.55));
    rg.addColorStop(1, hslStr(hue(h-6),sat(rl),rl,0));
    c.strokeStyle=rg; c.lineWidth=1.25;
    c.beginPath(); c.arc(pad+R,pad+R,R-0.6,0,TAU); c.stroke();
    g.sun=cv; g.pad=pad; g.sunW=cv.width/k; g.sunH=cv.height/k;
    // the disk's silhouette, for taking the glow out from under it
    const mv=surface(cv.width, cv.height), mc=mv.getContext("2d");
    mc.setTransform(k,0,0,k,0,0); mc.fillStyle="#fff";
    mc.beginPath(); mc.arc(pad+R,pad+R,R,0,TAU); mc.fill();
    g.mask=mv;

    // sparse stars, thinning toward the horizon and kept off the sun's halo.
    // Grouped by tier and twinkle phase, so each group shares one fill style.
    // Plain rects, not one Path2D per group: a sparse path as wide as the sky
    // can fall off the GPU's fast path.
    const r=rng(0x5eed), lim=g.hz-P.h*0.08;
    const n=clamp(Math.round(K.w*Math.max(0,lim)/20000),60,900);
    const grp=Array.from({length:18},()=>[]);
    for(let i=0;i<n;i++){
      const x=r()*K.w, y=lim*Math.pow(r(),1.35), t=r(), ph=(r()*6)|0;
      if(Math.hypot(x-g.cx,y-g.cy)<R*1.5) continue;
      const low=y/lim;
      const tier=(t<0.06 && low<0.6) ? 2 : (t<0.32 && low<0.8) ? 1 : 0;
      grp[tier*6+ph].push(x,y,[1.1,1.6,2.2][tier]);
    }
    g.stars=grp.map(a=>Float32Array.from(a));
    SKY.g=g;
    return g;
  }

  // the disk's horizontal bands (or its mask's), as sub-rect blits: no clip
  function bands(ctx, img, g, B, sx, sy){
    const q=img.height/g.sunH;
    for(let i=0;i<B.length;i+=2){
      const y=B[i], bh=B[i+1]-y; if(bh<0.05) continue;
      ctx.drawImage(img, 0,(y-sy)*q,img.width,bh*q, sx,y,g.sunW,bh);
    }
  }

  function paintSky(K, t, sph, e, D){
    const g=skyGeo(K), ctx=K.ctx, c=pal(), R=g.R, cx=g.cx+D.x, cy=g.cy+D.y;
    ctx.clearRect(0,0,K.w,g.clearH);
    ctx.save();
    ctx.globalAlpha=clamp(0.85+0.5*e,0,1);
    ctx.translate(D.x,D.y);
    const hy=g.cy-g.hr;
    ctx.fillStyle=g.halo; ctx.fillRect(g.cx-g.hr, hy, g.hr*2, g.hz-D.y-hy);
    ctx.restore();
    ctx.save();
    ctx.translate(g.cx,g.hz); ctx.scale(g.gsx,1);
    ctx.fillStyle=g.glow; ctx.fillRect(-g.gr,-g.gr,g.gr*2,g.gr);
    ctx.restore();

    // the slices: gaps born as hairlines below the middle, widening as they sink
    const top=cy-R, bot=Math.min(g.hz, cy+R), ys=cy-0.08*R, span=bot-ys, pd=span/SLICES;
    const B=[];
    let y=top;
    for(let i=0;i<SLICES;i++){
      const m=ys+(i+sph)*pd, p=(m-ys)/span, gh=pd*0.62*Math.pow(p,1.15);
      if(m-gh/2>y) B.push(y, m-gh/2);
      y=Math.max(y,m+gh/2);
    }
    if(bot>y) B.push(y, bot);
    // take the glow out behind the disk, and most of it in the gaps: some
    // bloom left there is what makes them read as cuts in a light, not bars
    const sx=cx-R-g.pad, sy=cy-R-g.pad;
    ctx.globalCompositeOperation="destination-out";
    ctx.globalAlpha=1-GAP_GLOW;
    ctx.drawImage(g.mask, sx, sy, g.sunW, g.sunH);
    ctx.globalAlpha=1;
    bands(ctx, g.mask, g, B, sx, sy);
    ctx.globalCompositeOperation="source-over";

    for(const z of g.haze){ ctx.fillStyle=z.g; ctx.fillRect(z.x,z.y0,z.w,z.y1-z.y0); }
    const base=[0.26,0.42,0.66];
    for(let i=0;i<18;i++){
      const grp=i%6, a=base[(i/6)|0]*(0.62+0.38*Math.sin(t*(0.35+grp*0.11)+grp*1.7)), S=g.stars[i];
      ctx.fillStyle=c.star[clamp(Math.round(a*40),0,40)];
      for(let j=0;j<S.length;j+=3) ctx.fillRect(S[j],S[j+1],S[j+2],S[j+2]);
    }

    ctx.globalAlpha=clamp(0.92+0.1*e,0,1);
    bands(ctx, g.sun, g, B, sx, sy);
    ctx.globalAlpha=1;
  }

  const bass=S=>(AUD.live && CFG.audio) ? clamp(S.energy*2,0,1) : 0;

  return {
    label:"Horizon Sun", band:BAND,
    init(T){ SKY.g=null; SKY.last=-1; if(T) T.orRows=null; },
    frame(dt, S){ E.n++; E.e=lerp(E.e, bass(S), 1-Math.exp(-dt/180)); },
    draw(T, S){ paint(T, S.t*SPEED, 0.86+0.14*E.e); },
    sky(K, S){
      const now=S.t*1000;
      if(SKY.g && SKY.last>=0 && now-SKY.last<SKY_MS && now>=SKY.last) return;
      SKY.last=now;
      paintSky(K, S.t, (S.t*SLICE_RATE)%1, E.e, drift());
    },
    // game mode holds this frame, so the band's cache is let go until the loop resumes
    still(T){ paint(T, 0.4, 0.9); if(T.outrun) T.outrun.base=null; T.orRows=null; },
    stillSky(K){ paintSky(K, 2.1, 0.45, 0, drift()); SKY.last=-1; }
  };
})();
