/* =========================================================================
   SCENE: DATA STREAM
   Sparse columns of hex falling out of the dark onto a glass floor. A stream
   is a short rigid string of glyphs, a bright lead and a fading tail, that
   emerges from the air at some height and slides down until it meets the
   floor. Three depths (far, mid, near) differ in size, speed and brightness.
   The floor is a perspective lattice of faint nodes, and every stream falls
   onto one of them: far ones just under the horizon, near ones low on the
   screen. There a stream meets its own reflection, rings out a ripple drawn
   in the floor's perspective and drains into the surface.

   Every monitor is a finished scene of its own: its own floor, horizon and
   share of streams, sized to its own short edge. Streams keep out of every
   panel's box (read from the DOM once a second, never per frame), so none
   falls behind a panel or lands under one.

   Every glyph is a drawImage from an atlas baked once per palette and pixel
   size, with the brightness steps, the lead's halo and the flipped copies
   for the reflection already in it: no fillText and no color strings per
   frame. Positions snap to the sky's device pixels, so a sliding glyph stays
   sharp. Streams live on the sky canvas; the band only holds the floor,
   which never moves, so it repaints only when the palette, its size or its
   visibility changes.

   Game mode stops the rain: the floor stays and the sky holds a faint fixed
   star field. Leaving it, the streams come back one at a time from the air.
   ========================================================================= */
const DATASTREAM=(()=>{
  const GLYPHS="0123456789ABCDEF", NG=16;
  const LV=14, RL=8;            // tail brightness steps, reflection steps
  const HOR=0.63, BAND=0.5;     // horizon as a share of a monitor's height; band share
  const GRID=0.5;               // lattice step in floor units (the camera is 1 unit up)
  const RMAX=7;                 // how many cells deep a reflection reaches
  const RIP=6.5;                // a ripple's visible reach, in glyph widths
  const GOLD=0x9E3779B1|0;
  /* far -> near. size: glyph px per 1000 px of the screen's short edge.
     sp: cells/s. len: tail cells. z: landing depth on the floor, where 1 is
     the bottom of the screen. per: streams on a 16:9 screen; another shape
     gets the same density for its area in glyph units. a: peak alpha. */
  const TIERS=[
    {size:7.4, sp:[2.2,3.2], len:[8,14],  z:[6,15],    per:21.5, a:0.55, sat:0.80},
    {size:9.6, sp:[2.8,4.2], len:[9,15],  z:[2.5,4.5], per:11.5, a:0.78, sat:0.92},
    {size:13,  sp:[3.4,4.6], len:[7,11],  z:[1.5,2],   per:3.84, a:0.92, sat:1.00}
  ];
  const S={ streams:[], rip:[], atl:new Map(), bands:new Map(), scr:[], rects:[], rt:-9,
            gen:-1, k:1, e:0, n:0, frameNo:0, seed:0x2F6E2B1, font:"monospace",
            lw:0, lh:0, lk:0, ln:-1, ripCol:null, asleep:false };

  function rand(){
    let t=(S.seed=(S.seed+0x6D2B79F5)|0);
    t=Math.imul(t^(t>>>15), t|1);
    t^=t+Math.imul(t^(t>>>7), t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  }
  const rr=(a,b)=>a+rand()*(b-a);
  const sm=(a,b,x)=>{ const u=clamp((x-a)/(b-a),0,1); return u*u*(3-2*u); };
  function h32(a){
    a=Math.imul(a^(a>>>16),0x45d9f3b); a=Math.imul(a^(a>>>16),0x45d9f3b);
    return (a^(a>>>16))>>>0;
  }
  /* A glyph is a pure function of the stream, its place in the string and
     the clock, so nothing per glyph is stored. About one in six flips now
     and then, each on its own slow period, and brightens for half a second
     as it does so the change reads as an event, not as noise. The boost is
     left in FB for the caller. */
  let FB=0;
  function glyph(hv, t){
    let g=hv&15; FB=0;
    if(((hv>>>8)&255)<44){
      const per=1.6+((hv>>>16)&255)*0.02;
      const q=t/per+((hv>>>24)&255)/255, n=q|0, u=(q-n)*per;
      g=(g+n*7)&15;
      if(u<0.5) FB=(1-u*2)*0.4;
    }
    return g;
  }
  function mk(w,h){
    if(typeof OffscreenCanvas!=="undefined"){ try{ return new OffscreenCanvas(w,h); }catch(e){} }
    const c=document.createElement("canvas"); c.width=w; c.height=h; return c;
  }

  /* ---- glyph atlas: one per (device pixel size, depth) and palette ----
     Columns are the 16 glyphs. Rows: LV tail steps, the lead with its halo,
     RL flipped reflection steps, the flipped lead, then the contact glint.
     Sizes are in device pixels of the sky canvas, so a glyph lands 1:1. */
  function buildAtlas(px, ti){
    const T=TIERS[ti], k=S.k;
    const pad=Math.ceil(px*0.5), cw=Math.ceil(px*0.62), ch=Math.ceil(px*1.2);
    const sw=cw+pad*2, sh=ch+pad*2, rows=LV+RL+2;
    const gw=cw*7, gh=Math.ceil(ch*0.8);
    const c=mk(sw*NG, sh*rows+gh), g=c.getContext("2d");
    const h=PAL.h, s=PAL.s, l=PAL.l;
    // The tail's far end sits well below the accent's lightness, so a pale
    // accent still gives a colored tail instead of a gray one, and it warms
    // toward white only near the lead: a comet, not a bar of even gray.
    const hi=clamp(l+2,62,84), lo=clamp(l-30,34,50), bs=Math.min(100, s*T.sat*1.1);
    g.textAlign="center"; g.textBaseline="middle";
    const put=(r, j, flip, dx, dy)=>{
      if(!flip){ g.fillText(GLYPHS[j], j*sw+sw/2+dx, r*sh+sh/2+dy); return; }
      g.save(); g.translate(j*sw+sw/2+dx, r*sh+sh/2+dy); g.scale(1,-1);
      g.fillText(GLYPHS[j], 0, 0); g.restore();
    };
    const row=(r, flip, style)=>{ g.fillStyle=style; for(let j=0;j<NG;j++) put(r, j, flip, 0, 0); };
    /* The lead's halo is the glyph stamped in rings around itself at a low
       alpha: a soft, glyph-shaped glow with no blur pass. */
    const halo=(r, flip, a)=>{
      const rings=[[0.07,0.16],[0.15,0.10],[0.25,0.055],[0.36,0.03]];
      for(const [rad,w] of rings){
        g.fillStyle=hslStr(h, s, clamp(l-8,48,70), (a*w).toFixed(3));
        for(let q=0;q<8;q++){
          const an=q*Math.PI/4+rad*3, dx=Math.cos(an)*rad*px, dy=Math.sin(an)*rad*px;
          for(let j=0;j<NG;j++) put(r, j, flip, dx, dy);
        }
      }
    };
    g.font=`500 ${px}px ${S.font}`;
    for(let r=0;r<LV;r++){
      const v=(r+1)/LV;
      row(r, false, hslStr(h, bs*(1-0.35*v*v), lerp(lo,hi,Math.pow(v,1.4)),
                           (T.a*(0.06+0.84*Math.pow(v,1.7))).toFixed(3)));
    }
    // the reflection carries the landing, so it is a clear second image
    // rather than a trace: about two thirds of the stream above it
    for(let r=0;r<RL;r++){
      const v=(r+1)/RL;
      row(LV+1+r, true, hslStr(h, bs*0.9, lerp(lo,hi,v)*0.92, (T.a*0.68*(0.12+0.88*v)).toFixed(3)));
    }
    g.font=`600 ${px}px ${S.font}`;
    halo(LV+RL+1, true, T.a*0.8);
    row(LV+RL+1, true, hslStr(h, s*0.6, clamp(l+22,76,92), (T.a*0.74).toFixed(3)));
    // the lead: near white in the accent's hue, over its halo
    halo(LV, false, 1);
    row(LV, false, hslStr(h, s*0.45, clamp(l+30,86,96), T.a));
    // contact glint: a flat soft ellipse under the point where a stream lands
    const gy=sh*rows;
    g.save(); g.translate(gw/2, gy+gh/2); g.scale(gw/2, gh/2);
    const rg=g.createRadialGradient(0,0,0,0,0,1);
    const gl=clamp(l+10,60,86);
    rg.addColorStop(0, hslStr(h,s,gl,1)); rg.addColorStop(0.25, hslStr(h,s,gl,0.5));
    rg.addColorStop(0.6, hslStr(h,s,gl,0.14)); rg.addColorStop(1, hslStr(h,s,gl,0));
    g.fillStyle=rg; g.fillRect(-1,-1,2,2); g.restore();
    // and a hairline core, the stream's light spread along the glass
    const lg=g.createLinearGradient(gw*0.1, 0, gw*0.9, 0), lh=Math.max(1, Math.round(gh*0.07));
    lg.addColorStop(0, hslStr(h,s*0.7,gl+6,0)); lg.addColorStop(0.5, hslStr(h,s*0.7,gl+6,0.95));
    lg.addColorStop(1, hslStr(h,s*0.7,gl+6,0));
    g.fillStyle=lg; g.fillRect(gw*0.1, gy+Math.round((gh-lh)/2), gw*0.8, lh);
    let src=c;
    // an ImageBitmap is one static texture, the cheapest thing to draw from
    if(c.transferToImageBitmap){ try{ src=c.transferToImageBitmap(); }catch(e){ src=c; } }
    return { cv:src, sw, sh, gy, gw, gh,
             dw:sw/k, dh:sh/k, padc:pad/k, cwc:cw/k, chc:ch/k, gwc:gw/k, ghc:gh/k };
  }
  function atlasFor(px, ti){
    const key=px*4+ti;
    let A=S.atl.get(key);
    if(!A){ A=buildAtlas(px, ti); S.atl.set(key, A); }
    return A;
  }
  /* A palette change keeps the layout and only swaps the atlases under it. */
  function relink(){
    S.atl.clear(); S.gen=PAL.gen; S.ripCol=null;
    for(const st of S.streams) if(st.px) st.atl=atlasFor(st.px, st.tier);
  }

  /* ---- the panels ----
     Every panel's box, padded by 2rem at its screen's zoom, as a flat list
     of [x0,y0,x1,y1] in viewport px. Reading a box forces a layout, so this
     runs once a second and after a relayout, never per frame. */
  function readRects(){
    const out=[], L=(LAY.screens && LAY.screens.length) ? LAY.screens : [{el:document, zoom:1}];
    let rem=16;
    try{ rem=parseFloat(getComputedStyle(document.documentElement).fontSize)||16; }catch(e){}
    for(const s of L){
      if(!s.el) continue;
      const pad=2*rem*(s.zoom||1);
      s.el.querySelectorAll(".win, #os-label").forEach(el=>{
        const r=el.getBoundingClientRect();
        if(r.width>1 && r.height>1) out.push(r.left-pad, r.top-pad, r.right+pad, r.bottom+pad);
      });
    }
    return out;
  }
  function inRect(x, y){
    const R=S.rects;
    for(let i=0;i<R.length;i+=4) if(x>R[i] && x<R[i+2] && y>R[i+1] && y<R[i+3]) return true;
    return false;
  }
  /* Does a stream in the column at x, emerging at ys, touch a panel? Its body
     runs from the emergence point to the foot of its reflection; at the floor
     the glint and the ripple spread wider. */
  function blocked(st, x, ys){
    const R=S.rects, A=st.atl, cw=A.cwc, ch=A.chc, g=st.g;
    const bx0=x-cw, bx1=x+cw*2, by0=ys-ch*2, by1=g+RMAX*ch;
    const c=x+cw/2, fx0=c-cw*RIP, fx1=c+cw*RIP, fy0=g-ch, fy1=g+cw*RIP*st.asp+ch;
    for(let i=0;i<R.length;i+=4){
      const x0=R[i], y0=R[i+1], x1=R[i+2], y1=R[i+3];
      if(bx1>x0 && bx0<x1 && by1>y0 && by0<y1) return true;
      if(fx1>x0 && fx0<x1 && fy1>y0 && fy0<y1) return true;
    }
    return false;
  }
  /* Under a panel a column is still usable if the stream emerges well below
     it and has room to fall: push the emergence point past the panel, far
     enough that the string reads as born in the air, not dropped out of it. */
  function clearYs(st, x, ys){
    const R=S.rects, A=st.atl, cw=A.cwc, ch=A.chc;
    let y=ys;
    for(let i=0;i<R.length;i+=4)
      if(x+cw*2>R[i] && x-cw<R[i+2] && R[i+3]<st.g-ch*12 && y-ch*2<R[i+3]) y=R[i+3]+ch*6;
    return y;
  }
  /* A new layout (a drag, a panel switched on) can land a panel on a stream
     already falling: that stream leaves now and comes back somewhere clear. */
  function refreshRects(t){
    S.rt=t;
    const R=readRects(), O=S.rects;
    let same=R.length===O.length;
    for(let i=0;same && i<R.length;i++) if(Math.abs(R[i]-O[i])>1) same=false;
    if(same) return;
    S.rects=R;
    for(const st of S.streams) if(st.wait<=0 && blocked(st, st.x, st.ys)) st.wait=200+rand()*1600;
  }

  /* ---- layout ---- */
  /* Streams thin out toward a screen's edges and gather toward its middle,
     so the eye has somewhere to rest. xn is the position across the HUD's
     own content band (capped at 2:1 like the panels), so an ultrawide's
     outer edges count as edge too. */
  function weight(ti, xn){
    const e=Math.min(xn, 1-xn), G=Math.exp(-((xn-0.5)/0.2)*((xn-0.5)/0.2));
    if(ti===2) return sm(0.30,0.38,e)*(0.5+0.5*G);
    if(ti===1) return sm(0.21,0.33,e)*(0.35+0.65*G);
    return 0.035+0.965*sm(0.17,0.32,e)*(0.6+0.4*G);
  }
  /* A stream stands on a lattice node, so its x snaps to one of the floor's
     columns at its depth. It keeps out of the panels, and clear of every
     stream whose fall (reflection included) overlaps its own: two glyph
     strings crossing at one x read as noise, whatever their depths. NaN
     means there is no clear column right now. */
  function pickX(st, s, A){
    const cb=Math.min(s.w, s.h*2), c0=s.x+(s.w-cb)/2;
    const dx=GRID*s.D/st.z, lo=s.x+A.cwc*1.5, hi=s.x+s.w-A.cwc*2.5;
    const low=st.g+RMAX*A.chc;
    for(let n=0;n<24;n++){
      let x=s.cx+Math.round((lo+rand()*(hi-lo)-s.cx)/dx)*dx;
      if(x<lo) x+=dx; else if(x>hi) x-=dx;
      if(rand()>weight(st.tier, (x-c0)/cb)) continue;
      const xl=Math.round((x-A.cwc/2)*S.k)/S.k, ys=clearYs(st, xl, st.ys);
      if(blocked(st, xl, ys)) continue;
      let ok=true;
      for(const o of S.streams){
        if(o===st || o.scr!==st.scr || o.wait>0 || o.ys>low || ys>o.g+RMAX*o.atl.chc) continue;
        const need=o.tier===st.tier ? A.cwc*4 : (A.cwc+o.atl.cwc)*2;
        if(Math.abs(o.x+o.atl.cwc/2-x)<need){ ok=false; break; }
      }
      if(ok){ st.ys=ys; return xl; }
    }
    return NaN;
  }
  /* mode 0: a fresh stream at its emergence point. 1: anywhere in its life
     (the first frame should not start empty). */
  function spawn(st, mode){
    const s=S.scr[st.scr], T=TIERS[st.tier];
    st.px=Math.max(6, Math.round(T.size*s.U*S.k));
    const A=st.atl=atlasFor(st.px, st.tier), ch=A.chc;
    st.len=Math.round(rr(T.len[0],T.len[1]));
    st.speed=rr(T.sp[0],T.sp[1])*ch;
    st.seed=(rand()*4294967296)|0;
    st.b=rr(0.62,1);            // depth within the layer, so no two read alike
    st.z=1+Math.round((rr(T.z[0],T.z[1])-1)/GRID)*GRID;
    st.g=Math.round(Math.min(s.hor+s.D/st.z, s.yb-ch)*S.k)/S.k;
    st.asp=clamp(0.85/st.z, 0.05, 0.42);    // a circle on the floor at depth z
    // a few fall in from above the edge, most emerge from the middle air,
    // weighted low so the fall gathers toward the horizon
    st.ys = rand()<0.18 ? s.y-ch*(1+rand()*4)
                        : lerp(s.y+s.h*0.08, lerp(s.y,st.g,0.66), Math.sqrt(rand()));
    st.x=pickX(st, s, A);
    // no clear column: sit out a moment and try again, rather than overprint
    if(Number.isNaN(st.x)){ st.wait=300+rand()*1200; return; }
    st.wait=0;
    st.y = mode===0 ? st.ys-ch : lerp(st.ys-ch, st.g+st.len*ch, rand());
    st.hit=st.y+ch>=st.g;
  }
  function ripple(st, age){
    const A=st.atl;
    S.rip.push({ x:st.x+A.cwc/2, y:st.g, rx0:A.cwc*0.6, grow:A.cwc*2.4,
                 asp:st.asp, age, life:2.6, a:TIERS[st.tier].a*0.85 });
  }
  /* The floor a screen stands on: the one its band painted for it, else a
     floor of its own at the same proportions. */
  function floorOf(i, x){
    let hit=null;
    for(const [cv,b] of S.bands){
      if(!cv.isConnected){ S.bands.delete(cv); continue; }
      for(const f of b.F){
        if(f.i===i) return f;
        if(!hit && f.i<0 && x>=f.x0 && x<f.x1) hit=f;
      }
    }
    return hit;
  }
  function layout(K, SC, k){
    S.lw=K.w; S.lh=K.h; S.lk=k; S.ln=S.n; S.k=k;
    try{ S.font=getComputedStyle(document.body).fontFamily||"monospace"; }catch(e){}
    S.atl.clear(); S.gen=PAL.gen; S.ripCol=null;
    // game mode at boot draws before the first frame has filled SC.screens
    const live=SC.screens && SC.screens.length;
    const src=live ? SC.screens : (LAY.screens&&LAY.screens.length ? LAY.screens : [{x:0,y:0,w:K.w,h:K.h}]);
    S.scr=src.map((s,i)=>{
      const f=floorOf(i, s.x+s.w/2), yb=s.y+s.h;
      const hor=clamp(f ? f.hor : s.y+s.h*HOR, s.y+s.h*0.35, s.y+s.h*0.85);
      return { x:s.x, y:s.y, w:s.w, h:s.h, U:Math.min(s.w,s.h)/1000, hor, yb,
               D:f ? f.D : yb-hor, cx:f ? f.cx : s.x+s.w/2 };
    });
    S.streams=[]; S.rip.length=0;
    for(let ti=0;ti<TIERS.length;ti++){
      S.scr.forEach((s,si)=>{
        // the same density on every monitor, for the area of its content
        // band (2:1 at most, like the panels) in glyph units
        const bw=Math.min(s.w, s.h*2);
        const n=Math.round(TIERS[ti].per*Math.max(bw,s.h)/Math.min(bw,s.h)*9/16);
        for(let j=0;j<n;j++){
          const st={tier:ti, scr:si};
          spawn(st, 1);
          S.streams.push(st);
        }
      });
    }
  }
  function ensure(K, SC){
    const k=K.ctx.canvas.width/Math.max(1,K.w);
    if(S.lw!==K.w || S.lh!==K.h || S.lk!==k || S.ln!==S.n){
      S.rects=readRects(); S.rt=SC.t;
      layout(K, SC, k);
    }else if(S.gen!==PAL.gen) relink();
  }

  /* ---- drawing ---- */
  /* A sprite that reaches the floor is cut at it, and its mirror image shows
     only the part below it, so a stream and its reflection meet on the line. */
  function cut(ctx, A, sx, sy, x, y, g){
    const top=y-A.padc, vis=g-top;
    if(vis>=A.dh) ctx.drawImage(A.cv, sx, sy, A.sw, A.sh, x, top, A.dw, A.dh);
    else if(vis>0) ctx.drawImage(A.cv, sx, sy, A.sw, vis*S.k, x, top, A.dw, vis);
  }
  function mirror(ctx, A, sx, sy, x, y, g){
    const mT=2*g-(y-A.padc)-A.dh, o=Math.max(0, g-mT), mh=A.dh-o;
    if(mh>0) ctx.drawImage(A.cv, sx, sy+o*S.k, A.sw, mh*S.k, x, mT+o, A.dw, mh);
  }
  /* Ripples in NR alpha steps, one path each, a device pixel wide. Each
     landing rings twice, the second ring fainter and 0.4 s behind. */
  const NR=12, RTOP=0.85;
  function ripples(ctx){
    if(!S.ripCol){
      const lit=clamp(PAL.l+8,0,80);
      S.ripCol=Array.from({length:NR},(_,j)=>hslStr(PAL.h,PAL.s,lit,((j+1)/NR*RTOP).toFixed(3)));
    }
    ctx.lineWidth=Math.max(1, 1/S.k);
    for(let b=0;b<NR;b++){
      let any=false;
      for(const r of S.rip){
        for(let q=0;q<2;q++){
          const age=r.age-q*0.4; if(age<=0) continue;
          const a=r.a*(q ? 0.5 : 1)*Math.pow(1-age/r.life,1.6);
          if(Math.min(NR-1, Math.round(a*NR/RTOP)-1)!==b) continue;
          if(!any){ ctx.beginPath(); any=true; }
          const rx=r.rx0+r.grow*age;
          ctx.moveTo(r.x+rx, r.y);
          ctx.ellipse(r.x, r.y, rx, rx*r.asp, 0, 0, Math.PI*2);
        }
      }
      if(any){ ctx.strokeStyle=S.ripCol[b]; ctx.stroke(); }
    }
  }
  function render(ctx, t){
    const k=S.k, refl=CFG.terrain, rb=LV+1, hr=LV+RL+1;
    if(refl && S.rip.length) ripples(ctx);
    // pass 1: every tail glyph, and the reflection of the ones near the floor.
    // A string is always whole: no cell of it is ever skipped.
    for(const st of S.streams){
      if(st.wait>0) continue;
      const A=st.atl, ch=A.chc, g=st.g, len=st.len, x=st.x-A.padc;
      const s=S.scr[st.scr], air=s.y+s.h*0.34;
      const Y=Math.round(st.y*k)/k;
      for(let d=1;d<=len;d++){
        const y=Y-d*ch;
        if(y>=g) continue;                      // already under the floor
        const fe=(y-st.ys+ch)/(2*ch);           // fade in at the emergence point
        if(fe<=0) break;                        // and nothing above it exists yet
        const hv=h32(st.seed+Math.imul(d,GOLD));
        const sx=glyph(hv,t)*A.sw;
        // the upper air is thinner, which keeps the top panels calm
        const top= y<air ? 0.45+0.55*sm(s.y, air, y) : 1;
        const v=Math.min(1, ((1-d/(len+1))*st.b+FB)*(fe<1?fe:1)*top);
        cut(ctx, A, sx, Math.min(LV-1,(v*LV)|0)*A.sh, x, y, g);
        if(refl){
          const up=(g-y)/ch-1;                  // cells between this glyph and the floor
          if(up<RMAX){
            const rv=v*(1-Math.max(0,up)/RMAX);
            if(rv>0.04) mirror(ctx, A, sx, (rb+Math.min(RL-1,(rv*RL)|0))*A.sh, x, y, g);
          }
        }
      }
    }
    // pass 2: the leads, their mirror images and the contact glints, which
    // carry per-stream alpha. Each lead cycles its glyph three times a
    // second, out of step with the others.
    const hA=Math.min(1, 0.74+0.5*S.e), hg=t*3;
    let cur=1;
    for(const st of S.streams){
      if(st.wait>0) continue;
      const A=st.atl, ch=A.chc, g=st.g, x=st.x-A.padc;
      const s=S.scr[st.scr], air=s.y+s.h*0.34;
      const Y=Math.round(st.y*k)/k, bot=(Y+ch-g)/ch;   // lead's foot vs the floor, in cells
      if(Y<g){
        const top= Y<air ? 0.4+0.6*sm(s.y, air, Y) : 1;
        const a=hA*(0.55+0.45*st.b)*top*clamp((Y-st.ys+ch)/(2*ch),0,1);
        if(a>0.01){
          if(a!==cur) ctx.globalAlpha=cur=a;
          const sx=(h32(st.seed^((hg+(st.seed&255)/64)|0))&15)*A.sw;
          cut(ctx, A, sx, LV*A.sh, x, Y, g);
          if(refl && -bot<RMAX){
            const f=a*clamp(1+bot/RMAX,0,1);
            if(f!==cur) ctx.globalAlpha=cur=f;
            mirror(ctx, A, sx, hr*A.sh, x, Y, g);
          }
        }
      }
      if(refl && bot>-1.5){
        const I = bot<0 ? 1+bot/1.5 : Math.max(0, 1-bot/st.len);
        const a=Math.min(1, I*TIERS[st.tier].a*1.05);
        if(a>0.01){
          if(a!==cur) ctx.globalAlpha=cur=a;
          ctx.drawImage(A.cv, 0, A.gy, A.gw, A.gh,
                        st.x+A.cwc/2-A.gwc/2, g-A.ghc/2, A.gwc, A.ghc);
        }
      }
    }
    if(cur!==1) ctx.globalAlpha=1;
  }
  /* Game mode's sky: a faint fixed field of stars from a fixed seed, so
     every still is the same one, kept clear of the panels and thinning into
     the haze at each horizon. Dim and tiny, so hours of it cost no burn-in. */
  function paintStars(ctx){
    const keep=S.seed, k=S.k, NB=6, bins=Array.from({length:NB},()=>[]);
    S.seed=0x51A7E5;
    for(const s of S.scr){
      const span=s.hor-s.y; if(span<40) continue;
      const n=Math.round(s.w*span/(2000*s.U*s.U));     // as dense on any monitor, for its size
      for(let j=0;j<n;j++){
        const x=s.x+rand()*s.w, u=rand(), y=s.y+u*span;
        const a=Math.pow(rand(),1.7)*(1-0.9*sm(0.6,1,u)), big=rand()<0.18;
        if(a<0.08 || inRect(x,y)) continue;
        bins[Math.min(NB-1,(a*NB)|0)].push(Math.round(x*k)/k, Math.round(y*k)/k, (big?2:1)/k);
      }
    }
    const lit=clamp(PAL.l+22,0,90), sat=PAL.s*(1-0.4*sm(60,95,PAL.l));
    for(let b=0;b<NB;b++){
      const P=bins[b]; if(!P.length) continue;
      ctx.fillStyle=hslStr(PAL.h, sat, lit, ((b+1)/NB*0.6).toFixed(3));
      for(let j=0;j<P.length;j+=3) ctx.fillRect(P[j], P[j+1], P[j+2], P[j+2]);
    }
    S.seed=keep;
  }

  /* ---- the floor (band canvas) ----
     A lattice of nodes on a flat plane one unit under the camera: row z sits
     D/z below the horizon and its nodes are GRID*D/z apart, the same lattice
     the streams stand on. Nodes fade into the haze at the horizon and out
     toward the corners, where the panels are. One floor per monitor. */
  function paintFloor(T){
    const ctx=T.ctx;
    ctx.clearRect(0,0,T.w,T.h);
    T.dsGen=PAL.gen;
    for(const F of T.dsF||[]) paintOne(ctx, T, F);
  }
  function paintOne(ctx, T, F){
    const h=PAL.h, s=PAL.s, lit=clamp(PAL.l+8,0,80);
    const hor=F.hor, D=F.D, cx=F.cx, pw=F.pw, hz=F.prim ? 1 : 0.75;
    // a low haze sitting on the horizon under the focal point
    ctx.save();
    ctx.translate(cx, hor); ctx.scale(pw*0.46, Math.min(pw*0.5625, F.ph)*0.075);
    const rg=ctx.createRadialGradient(0,0,0,0,0,1);
    rg.addColorStop(0, hslStr(h,s,lit,0.075*hz)); rg.addColorStop(0.45, hslStr(h,s,lit,0.026*hz));
    rg.addColorStop(1, hslStr(h,s,lit,0));
    ctx.fillStyle=rg; ctx.fillRect(-1,-1,2,2);
    ctx.restore();
    // the horizon, brightest over the focal point
    const lg=ctx.createLinearGradient(cx-pw*0.66,0,cx+pw*0.66,0);
    lg.addColorStop(0,    hslStr(h,s,lit,0));
    lg.addColorStop(0.28, hslStr(h,s,lit,0.4));
    lg.addColorStop(0.5,  hslStr(h,s,lit,1));
    lg.addColorStop(0.72, hslStr(h,s,lit,0.4));
    lg.addColorStop(1,    hslStr(h,s,lit,0));
    ctx.fillStyle=lg;
    ctx.globalAlpha=0.5*hz; ctx.fillRect(F.x0, Math.round(hor), F.x1-F.x0, 1);
    ctx.globalAlpha=1;
    /* The lattice, in 12 alpha steps so each step is one fill. Near nodes
       are small crosses lying on the floor (the arm running into the
       distance is foreshortened by 1/z again); far ones shrink to dots. */
    const NB=12, bins=Array.from({length:NB},()=>[]);
    const x0=Math.max(F.x0, cx-pw*0.62), x1=Math.min(F.x1, cx+pw*0.62), arm=D*0.0075;
    for(let z=1; ; z+=GRID){
      const dy=D/z; if(dy<D*0.045) break;
      const y=Math.round(hor+dy); if(y>T.h-1) continue;
      const fz=sm(0.045,0.2,dy/D)*(0.5+0.5/Math.sqrt(z));
      const dx=GRID*D/z, cross=z<3.6;
      const ax=cross ? Math.max(2, Math.round(arm/z)) : (z<5 ? 1.5 : 1);
      const ay=cross ? Math.max(1, Math.round(arm/(z*z))) : 0;
      for(let i=Math.ceil((x0-cx)/dx); i<=Math.floor((x1-cx)/dx); i++){
        const x=cx+i*dx, u=(x-cx)/(pw*0.34);
        const a=fz*Math.exp(-u*u);
        if(a<0.04) continue;
        bins[Math.min(NB-1,(a*NB)|0)].push(Math.round(x), y, ax, ay);
      }
    }
    const dl=clamp(PAL.l+14,0,86);
    for(let b=0;b<NB;b++){
      const P=bins[b]; if(!P.length) continue;
      ctx.fillStyle=hslStr(h,s,dl,((b+1)/NB*0.5).toFixed(3));
      for(let j=0;j<P.length;j+=4){
        const x=P[j], y=P[j+1], ax=P[j+2], ay=P[j+3];
        if(!ay){ ctx.fillRect(x-ax/2, y-ax/2, ax, ax); continue; }
        ctx.fillRect(x-ax, y, ax*2+1, 1);
        ctx.fillRect(x, y-ay, 1, ay*2+1);
      }
    }
  }

  return {
    label:"Data Stream", band:BAND,
    init(T){
      /* A floor for every monitor this band covers: its horizon at HOR of
         that monitor's height, its lattice centered on it. */
      const L=[];
      (T.screens||[]).forEach((R,i)=>{
        if(R.w>0 && R.x<T.w && R.x+R.w>0 && R.y<T.h && R.y+R.h>0) L.push({R, i});
      });
      if(!L.length){ const lh=T.h/BAND; L.push({R:{x:0, y:T.h-lh, w:T.w, h:lh}, i:-1}); }
      T.dsF=L.map(({R,i})=>{
        const hor=clamp(R.y+R.h*HOR, T.h*0.06, T.h*0.5);
        const x0=Math.max(0,R.x), x1=Math.min(T.w,R.x+R.w);
        const prim=i<0 || i===LAY.primary;
        return { i, x0, x1, hor, D:Math.max(20, Math.min(R.y+R.h, T.h)-hor),
                 cx:prim && T.cx>=x0 && T.cx<=x1 ? T.cx : (x0+x1)/2,
                 pw:Math.min(R.w, R.h*2), ph:R.h, prim };
      });
      T.dsGen=-1;
      S.bands.set(T.cv, {F:T.dsF.map(f=>({ i:f.i, x0:T.x+f.x0, x1:T.x+f.x1,
                                           hor:T.y+f.hor, D:f.D, cx:T.x+f.cx }))});
      S.n++;
    },
    frame(dt, SC){
      S.frameNo++;
      if(S.asleep){
        // back from game mode: the rain starts again, a stream at a time
        S.asleep=false; S.rip.length=0;
        for(const st of S.streams) st.wait=1+rand()*2400;
      }
      // bass eases the fall faster and the leads brighter, never in a jump
      S.e+=(SC.energy-S.e)*(1-Math.exp(-dt/350));
      const adv=(1+0.6*S.e)*dt*0.001;
      for(const st of S.streams){
        if(st.wait>0){ st.wait-=dt; if(st.wait<=0) spawn(st,0); continue; }
        st.y+=st.speed*adv;
        const A=st.atl;
        if(!st.hit && st.y+A.chc>=st.g){ st.hit=true; ripple(st, 0); }
        if(st.y-st.len*A.chc>=st.g) st.wait=400+rand()*3600;
      }
      for(let i=S.rip.length-1;i>=0;i--){
        const r=S.rip[i]; r.age+=dt*0.001;
        if(r.age>=r.life) S.rip.splice(i,1);
      }
    },
    draw(T){
      // static floor: repaint on a new palette, or after a frame it missed
      if(T.dsGen!==PAL.gen || T.dsFrame!==S.frameNo-1) paintFloor(T);
      T.dsFrame=S.frameNo;
    },
    sky(K, SC){
      ensure(K, SC);
      if(!(SC.t>=S.rt && SC.t-S.rt<1)) refreshRects(SC.t);
      K.ctx.clearRect(0,0,K.w,K.h);
      render(K.ctx, SC.t);
    },
    still(T){ paintFloor(T); T.dsFrame=-9; },
    stillSky(K, SC){
      S.asleep=true;
      ensure(K, SC);
      S.rects=readRects();
      K.ctx.clearRect(0,0,K.w,K.h);
      paintStars(K.ctx);
    }
  };
})();
SCENES.datastream=DATASTREAM;
