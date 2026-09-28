/* =========================================================================
   SCENE: ORBITAL
   The night side of a planet seen from a station window. A dark globe rises
   out of the foot of the primary monitor, its continents picked out as a
   matrix of dots with city lights along the coasts, the graticule turning
   slowly over them. The sun sits just behind the limb, so the atmosphere is
   lit from behind, and a couple of satellites cross the sky on faint orbits.

   The band holds the planet and the sky holds everything above it. The band
   fills the planet body opaque, so the sky's stars, halo and orbit paths are
   hidden behind it for free, and a satellite going round the back of the
   planet simply slips behind the limb.

   Cost: the land mask is generated once per boot, the latitude circles, the
   limb paths and every gradient once per resize or palette change. Per frame
   it is 24 meridians and the dots on the visible cap only: each ring of the
   land grid knows which longitudes can ever be on screen, so the dots round
   the back of the planet are never touched. Both canvases redraw at about
   30 fps: nothing here moves fast enough to need more, and a canvas keeps
   its pixels in between.
   ========================================================================= */
const ORBITAL=(function(){
  const D2R=Math.PI/180, TAU=Math.PI*2;
  // Planet attitude. The pole leans back behind the limb and a little to one
  // side, so the meridians fan out from under the sun instead of sitting
  // mirror-square on the screen.
  const TILT=-26*D2R, ROLL=8*D2R;
  const cT=Math.cos(TILT), sT=Math.sin(TILT), cR=Math.cos(ROLL), sR=Math.sin(ROLL);
  const SPIN=0.35*D2R;          // rad/s, one turn in about 17 minutes
  const APEX=0.58;              // limb apex, as a share of its monitor's height
  const BAND=0.62;              // tall enough that the limb clears the band top on a span
  const REDRAW_MS=30;
  const LEV=8;                  // alpha buckets per kind of dot
  const STILL_SPIN=2.15, STILL_T=38;

  // meridian samples, pole to pole every 2.5 degrees
  const MER_N=73, MER_C=new Float32Array(MER_N), MER_S=new Float32Array(MER_N);
  for(let i=0;i<MER_N;i++){ const f=(-90+i*2.5)*D2R; MER_C[i]=Math.cos(f); MER_S[i]=Math.sin(f); }

  // Orbit paths around the planet's center on screen, sized in planet radii.
  // Both keep their near half below the screen, so only the far arc shows and
  // it passes behind the planet where it meets the limb.
  const ORBITS=[
    { a:1.62, b:1.17, rot:-6, dash:null },
    { a:2.10, b:1.06, rot:10, dash:[3,11] }
  ];
  const SATS=[
    { orbit:0, period:300, phase:-2.30 },
    { orbit:0, period:300, phase:-2.30+Math.PI },
    { orbit:1, period:210, phase:-1.55 }
  ];

  const ST={ acc:REDRAW_MS, redraw:true, spin:STILL_SPIN, energy:0, breath:0,
             ver:0, geos:new Map(), sky:null };

  // small seeded generator: the stars come out the same every boot
  function rng(seed){
    let s=seed>>>0;
    return ()=>{ s=(s*1664525+1013904223)>>>0; return s/4294967296; };
  }
  function gauss(r){ return (r()+r()+r()-1.5)*1.15; }

  /* ---------------- the land ----------------
     Continents come from warped value noise on the unit sphere, so the
     planet is the same world on every boot and on every monitor. The grid is
     rings of dots every half degree of latitude, spaced the same distance
     along the ground, odd rings offset half a step so the matrix reads as a
     weave and not a checkerboard. A cell is 0 for sea, 1 for land, 2 for a
     shore, and 3..LEV+2 for a city light of that brightness. */
  const DSTEP=0.5*D2R, NRING=Math.round(Math.PI/DSTEP);
  const RINGS=new Array(NRING);
  const LAND={ t:null, cand:[], metros:null };
  function hash(x,y,z){
    let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,1440662683);
    h=Math.imul(h^(h>>>13),1274126177);
    return ((h^(h>>>16))>>>0)/4294967296;
  }
  function vnoise(x,y,z){
    const X=Math.floor(x), Y=Math.floor(y), Z=Math.floor(z);
    let u=x-X, v=y-Y, w=z-Z;
    u=u*u*(3-2*u); v=v*v*(3-2*v); w=w*w*(3-2*w);
    const a=hash(X,Y,Z), b=hash(X+1,Y,Z), c=hash(X,Y+1,Z), d=hash(X+1,Y+1,Z);
    const e=hash(X,Y,Z+1), f=hash(X+1,Y,Z+1), g=hash(X,Y+1,Z+1), k=hash(X+1,Y+1,Z+1);
    const ab=a+(b-a)*u, cd=c+(d-c)*u, ef=e+(f-e)*u, gk=g+(k-g)*u;
    const p=ab+(cd-ab)*v, q=ef+(gk-ef)*v;
    return p+(q-p)*w;
  }
  function fbm(x,y,z,oct){
    let s=0, a=0.5, n=0;
    for(let o=0;o<oct;o++){ s+=a*vnoise(x+o*19.1,y,z); n+=a; a*=0.5; x*=2.03; y*=2.03; z*=2.03; }
    return s/n;
  }
  // warped once so the coasts wander into bays and peninsulas
  function elev(x,y,z){
    x*=2.6; y*=2.6; z*=2.6;
    const wx=fbm(x+5.2,y+1.3,z+2.8,3)-0.5, wy=fbm(x+1.7,y+9.2,z+4.1,3)-0.5, wz=fbm(x+8.3,y+2.8,z+7.7,3)-0.5;
    return fbm(x+1.5*wx, y+1.5*wy, z+1.5*wz, 5);
  }
  // how settled a patch of land is: denser near the coast, in clusters
  function heat(x,y,z,e){
    const coast=Math.max(0, 1-e/0.035);
    const pop=fbm(x*5.5+3.1, y*5.5+7.7, z*5.5+1.9, 3);
    return (pop-0.47)*3.2 + coast*0.45 - e*3;
  }
  function landT(){
    if(LAND.t!==null) return LAND.t;
    const r=rng(77), v=[];
    for(let i=0;i<1600;i++){ const y=r()*2-1, a=r()*TAU, q=Math.sqrt(1-y*y); v.push(elev(q*Math.cos(a),y,q*Math.sin(a))); }
    v.sort((a,b)=>a-b);
    LAND.t=v[Math.floor(v.length*0.64)];   // a little over a third land
    return LAND.t;
  }
  function ring(k){
    if(RINGS[k]) return RINGS[k];
    const la=-Math.PI/2+(k+0.5)*DSTEP, cl=Math.cos(la), sl=Math.sin(la);
    const n=Math.max(1, Math.round(TAU*cl/DSTEP)), dl=TAU/n, off=(k&1)*dl*0.5;
    const c=new Uint8Array(n), T0=landT();
    for(let j=0;j<n;j++){
      const lo=off+j*dl, x=cl*Math.cos(lo), z=cl*Math.sin(lo);
      const e=elev(x,sl,z)-T0;
      if(e<=0) continue;
      const hv=heat(x,sl,z,e);
      c[j]= hv>0.45 && hash(k,j,97)<(hv-0.45)*1.6 ? 3+Math.min(LEV-1, ((hv-0.45)*LEV*1.4)|0)
          : e<0.012 ? 2 : 1;
      if(hv>0.95 && c[j]>2){ LAND.cand.push({x, y:sl, z, hv}); LAND.metros=null; }
    }
    return (RINGS[k]={ cl, sl, n, dl, off, c });
  }
  // The brightest city cells also get a soft glow of their own, kept apart so
  // the glows never pile up. Only rings some band has built are candidates,
  // which is every ring that can reach a screen.
  function metros(){
    if(LAND.metros) return LAND.metros;
    const pick=[];
    LAND.cand.sort((a,b)=>b.hv-a.hv);
    for(const p of LAND.cand){
      if(pick.some(o=>o.x*p.x+o.y*p.y+o.z*p.z>0.9976)) continue;   // about 4 degrees apart
      pick.push(p);
    }
    const M=[];
    for(const p of pick){ const cl=Math.hypot(p.x,p.z); M.push(cl, p.y, p.x/cl, p.z/cl, clamp((p.hv-0.95)*2,0.25,1)); }
    return (LAND.metros=Float32Array.from(M));
  }

  // PAL.bg is "#000", a hex default, or an hsl() string from applyBg.
  function bgHsl(){
    const b=String(PAL.bg||"#000").trim();
    let m=b.match(/^hsl\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i);
    if(m) return [+m[1], +m[2], +m[3]];
    m=b.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if(!m) return [0,0,0];
    let x=m[1]; if(x.length===3) x=x.replace(/./g,"$&$&");
    const r=parseInt(x.slice(0,2),16)/255, g=parseInt(x.slice(2,4),16)/255, bl=parseInt(x.slice(4,6),16)/255;
    const mx=Math.max(r,g,bl), mn=Math.min(r,g,bl), l=(mx+mn)/2;
    if(mx===mn) return [0,0,l*100];
    const d=mx-mn, s=l>0.5? d/(2-mx-mn) : d/(mx+mn);
    let h= mx===r ? (g-bl)/d+(g<bl?6:0) : mx===g ? (bl-r)/d+2 : (r-g)/d+4;
    return [h*60, s*100, l*100];
  }

  // Line lightness follows the waves (PAL.l+8, capped at 80) so a very pale
  // accent still draws a colored line; the glow is held darker and saturated
  // for the same reason.
  function tones(){
    const l=PAL.l;
    return { h:PAL.h, s:PAL.s, line:clamp(l+8,0,80), rim:clamp(l+22,62,94),
             glow:clamp(l,40,64), city:clamp(l+25,60,92) };
  }
  function stops(g, h, s, l, list){
    for(let i=0;i<list.length;i+=2) g.addColorStop(list[i], hslStr(h,s,l,list[i+1]));
    return g;
  }

  // The monitor a band belongs to: the primary when the band reaches it (a
  // span, or the primary's own layer), else the one under its middle. Only the
  // primary's planet carries the orbits.
  function bandScreen(T){
    const S=T.screens||[], P=S[LAY.primary||0];
    const on=s=>s.x<T.w && s.x+s.w>0 && s.y<T.h && s.y+s.h>0;
    if(P && on(P)) return {s:P, primary:true};
    for(const s of S) if(T.cx>=s.x && T.cx<s.x+s.w && on(s)) return {s, primary:false};
    const lh=T.h/BAND;
    return { s:{x:0, y:T.h-lh, w:T.w, h:lh}, primary:true };
  }

  // Planet geometry in band coordinates. The radius follows the monitor's long
  // edge, so a landscape screen sees the limb dip out through its lower corners
  // and a portrait one sees a gentle arc from side to side.
  function geometry(T){
    const b=bandScreen(T), P=b.s;
    const u=Math.max(0.4, Math.min(P.w,P.h)/2160);
    const R=0.6*Math.max(P.w,P.h);
    const ax=T.cx, ay=Math.max(P.y+P.h*APEX, P.h*0.12);
    const G={ primary:b.primary, u, R, ax, ay, cx:ax, cy:ay+R, pw:P.w, ph:P.h, w:T.w, h:T.h };
    // half-angle of the limb that is on the band, measured from the apex
    G.half=Math.acos(clamp((G.cy-T.h-8)/R, -1, 1))+0.03;
    return G;
  }

  function shell(G, r0, r1){
    const p=new Path2D(), a0=-Math.PI/2-G.half, a1=-Math.PI/2+G.half;
    p.arc(G.cx,G.cy,r1,a0,a1); p.arc(G.cx,G.cy,Math.max(1,r0),a1,a0,true); p.closePath();
    return p;
  }
  function limbArc(G, r){
    const p=new Path2D(); p.arc(G.cx,G.cy,r,-Math.PI/2-G.half,-Math.PI/2+G.half); return p;
  }

  // Latitude circles do not move as the planet spins, so they are one cached path.
  function latPath(G){
    const p=new Path2D();
    for(let la=-75; la<=75; la+=15){
      const cl=Math.cos(la*D2R), sl=Math.sin(la*D2R);
      let on=false;
      for(let k=0;k<=360;k++){
        const lo=k*D2R, x=cl*Math.cos(lo), y=sl, z=cl*Math.sin(lo);
        const y1=y*cT-z*sT, z1=y*sT+z*cT;
        const X=G.cx+G.R*(x*cR-y1*sR), Y=G.cy-G.R*(x*sR+y1*cR);
        if(z1>0 && Y<G.h+4){ if(on) p.lineTo(X,Y); else { p.moveTo(X,Y); on=true; } }
        else on=false;
      }
    }
    return p;
  }

  // For every ring of the land grid, the stretches of screen-fixed longitude
  // that land on this band. Per frame only the cells turning through those
  // stretches are projected.
  function visibleRings(G){
    const M=720, dA=TAU/M, out=[], w=G.w, h=G.h, R=G.R;
    const vis=new Uint8Array(M);
    for(let k=0;k<NRING;k++){
      const la=-Math.PI/2+(k+0.5)*DSTEP, cl=Math.cos(la), y=Math.sin(la);
      const yc=y*cT, ys=y*sT;
      let any=0;
      for(let s=0;s<M;s++){
        const a=s*dA, x=cl*Math.cos(a), z=cl*Math.sin(a);
        const y1=yc-z*sT, z1=ys+z*cT;
        const X=G.cx+R*(x*cR-y1*sR), Y=G.cy-R*(x*sR+y1*cR);
        vis[s]= z1>0.01 && Y<h+3 && X>-3 && X<w+3 ? 1 : 0; any|=vis[s];
      }
      if(!any) continue;
      // runs of visible samples, walked from a hidden one so none wraps
      let s0=0; while(s0<M && vis[s0]) s0++;
      const iv=[];
      if(s0===M) iv.push(0, TAU);
      else for(let i=1;i<=M;i++){
        const s=(s0+i)%M;
        if(vis[s] && !vis[(s+M-1)%M]) iv.push((s0+i-1)*dA);
        if(!vis[s] && vis[(s+M-1)%M]) iv.push((s0+i)*dA);
      }
      out.push({ k, yc, ys, iv });
    }
    return out;
  }

  // Everything that depends on the band's size or the palette.
  function build(T){
    const G=geometry(T), u=G.u, R=G.R;
    G.disc=new Path2D(); G.disc.arc(G.cx,G.cy,R,0,TAU);
    G.limb=limbArc(G,R);
    G.air=limbArc(G,R+14*u);
    G.atmoRing=shell(G,R-32*u,R+140*u);
    G.hazeRing=shell(G,R-180*u,R+1);
    G.lat=latPath(G);
    G.rings=visibleRings(G);
    // room for every cell a band can show, plus the ends of each stretch
    G.cap=0; for(const V of G.rings) G.cap+=ring(V.k).n+V.iv.length;
    const r=0.64*G.pw; G.inv2=1/(r*r);
    G.dot=clamp(u,0.75,1.3);
    paint(T,G);
    T.orbital=G;
    // hand the sky this planet in viewport coordinates
    ST.geos.set(T.cv, { primary:G.primary, R, cx:G.cx+T.x, cy:G.cy+T.y, ax:G.ax+T.x, ay:G.ay+T.y,
                        pw:G.pw, ph:G.ph, u });
    ST.ver++;
  }
  function paint(T,G){
    const ctx=T.ctx, c=tones(), u=G.u, R=G.R, h=c.h, s=c.s;
    G.gen=PAL.gen;
    const bg=bgHsl();
    G.body=hslStr(bg[0], bg[1], bg[2]*0.55);
    // one gradient across the limb: a little glow inside the edge, the bright
    // shell on it, and a long soft tail out into space
    const r0=R-32*u, r1=R+140*u, span=r1-r0, at=d=>clamp((R+d*u-r0)/span,0,1);
    G.atmo=stops(ctx.createRadialGradient(G.cx,G.cy,r0,G.cx,G.cy,r1), h,s,c.glow,
      [0,0, at(-14),0.10, at(-4),0.36, at(0),1, at(3),0.7, at(10),0.42, at(30),0.2, at(70),0.07, 1,0]);
    // Erased out of the shell so it is thick under the sun and fades along the
    // limb. This is the inverse of the share kept: destination-out only touches
    // the ring it fills, where destination-in would repaint the whole canvas.
    const m=ctx.createRadialGradient(G.ax,G.ay,0,G.ax,G.ay,0.62*G.pw);
    [[0,0.78],[0.1,0.62],[0.3,0.34],[0.55,0.14],[0.8,0.055],[1,0.03]].forEach(([o,a])=>m.addColorStop(o,"rgba(0,0,0,"+(1-a).toFixed(3)+")"));
    G.mask=m;
    // haze near the limb: the grid and lights sink into the air at a grazing angle
    const hz=ctx.createRadialGradient(G.cx,G.cy,R-180*u,G.cx,G.cy,R);
    [[0,0],[0.45,0.28],[0.8,0.66],[1,0.92]].forEach(([o,a])=>hz.addColorStop(o,hslStr(bg[0],bg[1],bg[2]*0.55,a)));
    G.haze=hz;
    const fromSun=(rad,l,list)=>stops(ctx.createRadialGradient(G.ax,G.ay,0,G.ax,G.ay,rad),h,s,l,list);
    G.grid=fromSun(0.66*G.pw, c.line, [0,0.22, 0.3,0.15, 0.65,0.065, 1,0.025]);
    // unit glow under each big city, scaled per city
    G.cityGlow=stops(ctx.createRadialGradient(0,0,0,0,0,1), h,s,c.glow, [0,0.16, 0.35,0.07, 1,0]);
    G.rim =fromSun(0.60*G.pw, c.rim,  [0,0.95, 0.25,0.6, 0.5,0.22, 0.8,0.06, 1,0.03]);
    G.airG=fromSun(0.50*G.pw, c.glow, [0,0.42, 0.4,0.17, 1,0.02]);
    G.landSty=[]; G.citySty=[];
    for(let k=0;k<LEV;k++){
      G.landSty.push(hslStr(h, s, c.line, ((k+1)/LEV*0.42).toFixed(3)));
      G.citySty.push(hslStr(h, clamp(s-10,0,100), c.city, ((k+1)/LEV*0.95).toFixed(3)));
    }
  }

  // The meridians turn with the planet, so they are the one line path built
  // per frame, every 15 degrees.
  function meridians(ctx, G, spin){
    const R=G.R, cx=G.cx, cy=G.cy, h=G.h;
    ctx.beginPath();
    for(let m=0;m<24;m++){
      const lo=m*15*D2R+spin, cl=Math.cos(lo), sl=Math.sin(lo);
      let on=false, lx=0, ly=0, lz=-1;
      for(let i=0;i<MER_N;i++){
        const x=MER_C[i]*cl, y=MER_S[i], z=MER_C[i]*sl;
        const y1=y*cT-z*sT, z1=y*sT+z*cT;
        const X=cx+R*(x*cR-y1*sR), Y=cy-R*(x*sR+y1*cR);
        if(z1>0 && Y<h+4){
          if(on) ctx.lineTo(X,Y);
          else{
            // coming round the limb: start the line on the edge itself
            if(lz<=0 && i>0){ const f=lz/(lz-z1); ctx.moveTo(lx+(X-lx)*f, ly+(Y-ly)*f); ctx.lineTo(X,Y); }
            else ctx.moveTo(X,Y);
            on=true;
          }
        }else{
          if(on && z1<=0){ const f=lz/(lz-z1); ctx.lineTo(lx+(X-lx)*f, ly+(Y-ly)*f); }
          on=false;
        }
        lx=X; ly=Y; lz=z1;
      }
    }
  }

  // The land grid on the visible cap. Each cell's brightness falls away from
  // the sun and toward the limb. Cells are counting-sorted into alpha buckets
  // and drawn with fillRect, one style change per bucket: thousands of plain
  // rects batch far better than one path holding thousands of contours.
  const DB={ x:new Float32Array(0), y:new Float32Array(0), k:new Uint8Array(0), o:new Int32Array(0),
             cnt:new Int32Array(LEV*2+1), at:new Int32Array(LEV*2) };
  function dots(ctx, G, spin){
    const R=G.R, cx=G.cx, cy=G.cy, ax=G.ax, ay=G.ay, h=G.h, inv2=G.inv2;
    if(DB.x.length<G.cap){ const n=G.cap; DB.x=new Float32Array(n); DB.y=new Float32Array(n); DB.k=new Uint8Array(n); DB.o=new Int32Array(n); }
    const BX=DB.x, BY=DB.y, BK=DB.k, cnt=DB.cnt;
    cnt.fill(0);
    let nv=0;
    for(const V of G.rings){
      const g=ring(V.k), n=g.n, dl=g.dl, cl=g.cl, C=g.c, cd=Math.cos(dl), sd=Math.sin(dl);
      const iv=V.iv;
      for(let q=0;q<iv.length;q+=2){
        // cells whose turned longitude off+j*dl+spin falls inside this stretch
        let j=Math.ceil((iv[q]-spin-g.off)/dl);
        const j1=Math.floor((iv[q+1]-spin-g.off)/dl);
        const a0=g.off+j*dl+spin;
        let c=Math.cos(a0), s=Math.sin(a0);
        for(;j<=j1;j++){
          const v=C[((j%n)+n)%n];
          if(v){
            const x=cl*c, z=cl*s, y1=V.yc-z*sT, z1=V.ys+z*cT;
            const X=cx+R*(x*cR-y1*sR), Y=cy-R*(x*sR+y1*cR);
            if(Y<h+2 && z1>0){
              const dx=X-ax, dy=(Y-ay)*1.5;
              const f=(1-(dx*dx+dy*dy)*inv2)*Math.min(1,z1*3);
              if(f>0.05){
                // land buckets first, the shore a step brighter than inland so
                // the coasts draw the map; city buckets after them
                const b= v<3 ? Math.min(LEV-1,(f*(v===2?1:0.62)*LEV)|0)
                             : LEV+Math.min(LEV-1,(f*(0.3+0.7*(v-2)/LEV)*LEV)|0);
                BX[nv]=X; BY[nv]=Y; BK[nv]=b; cnt[b+1]++; nv++;
              }
            }
          }
          const t=c*cd-s*sd; s=s*cd+c*sd; c=t;
        }
      }
    }
    const O=DB.o, at=DB.at;
    for(let k=1;k<=LEV*2;k++) cnt[k]+=cnt[k-1];
    at.set(cnt.subarray(0,LEV*2));
    for(let i=0;i<nv;i++) O[at[BK[i]]++]=i;
    const ls=1.7*G.dot, cs=2.3*G.dot;
    for(let k=0;k<LEV*2;k++){
      const e=cnt[k+1]; let m=cnt[k]; if(m===e) continue;
      const land=k<LEV, sz=land ? ls : cs, hs=sz/2;
      ctx.fillStyle= land ? G.landSty[k] : G.citySty[k-LEV];
      for(;m<e;m++){ const i=O[m]; ctx.fillRect(BX[i]-hs,BY[i]-hs,sz,sz); }
    }
  }

  function drawBand(T, spin, b){
    let G=T.orbital;
    if(!G || G.w!==T.w || G.h!==T.h){ build(T); G=T.orbital; }
    else if(G.gen!==PAL.gen) paint(T,G);
    const ctx=T.ctx, R=G.R, cx=G.cx, cy=G.cy, w=T.w, h=T.h;
    ctx.clearRect(0,0,w,h);

    // 1. the atmosphere, then fade it along the limb away from the sun
    ctx.globalAlpha=0.8+0.2*b; ctx.fillStyle=G.atmo; ctx.fill(G.atmoRing);
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation="destination-out";
    ctx.fillStyle=G.mask; ctx.fill(G.atmoRing);
    // 2. everything on the surface goes UNDER what is already there, top layer first
    ctx.globalCompositeOperation="destination-over";
    ctx.fillStyle=G.haze; ctx.fill(G.hazeRing);

    // graticule: cached latitudes plus the meridians, which turn
    ctx.lineWidth=1;
    ctx.strokeStyle=G.grid; ctx.stroke(G.lat); meridians(ctx,G,spin); ctx.stroke();

    dots(ctx,G,spin);

    // the glow over each big city, flattened as the surface turns away from us
    const CI=metros(), cs=Math.cos(spin), ss=Math.sin(spin), inv2=G.inv2;
    ctx.fillStyle=G.cityGlow;
    for(let i=0;i<CI.length;i+=5){
      const co=CI[i+2]*cs-CI[i+3]*ss, so=CI[i+3]*cs+CI[i+2]*ss;
      const x=CI[i]*co, y=CI[i+1], z=CI[i]*so;
      const z1=y*sT+z*cT; if(z1<0.05) continue;
      const y1=y*cT-z*sT;
      const X=cx+R*(x*cR-y1*sR), Y=cy-R*(x*sR+y1*cR);
      const rr=(22+50*CI[i+4])*G.u;
      if(Y-rr>h || X+rr<0 || X-rr>w) continue;
      const dx=X-G.ax, dy=(Y-G.ay)*1.5, a=(1-(dx*dx+dy*dy)*inv2)*Math.min(1,z1*3);
      if(a<0.05) continue;
      ctx.globalAlpha=a;
      ctx.save(); ctx.translate(X,Y); ctx.scale(rr, rr*Math.max(0.3,z1));
      ctx.fillRect(-1,-1,2,2); ctx.restore();
    }
    ctx.globalAlpha=1;

    // the planet body, opaque, which also hides the sky's stars and orbits behind it
    ctx.fillStyle=G.body; ctx.fill(G.disc);
    ctx.globalCompositeOperation="source-over";

    // 3. on top: the lit edge and a detached airglow line just above it
    ctx.strokeStyle=G.airG; ctx.globalAlpha=0.6+0.4*b; ctx.lineWidth=1; ctx.stroke(G.air);
    ctx.strokeStyle=G.rim; ctx.globalAlpha=0.85+0.15*b;
    ctx.lineWidth=Math.max(0.75,1.3*G.u); ctx.stroke(G.limb);
    ctx.globalAlpha=1;
  }

  /* ---------------- sky ---------------- */
  function skyBuild(K){
    const ctx=K.ctx, c=tones(), h=c.h, s=c.s;
    const tr=ctx.getTransform(), px=1/Math.max(0.1,tr.a);   // one device pixel, in CSS px
    const geos=[]; let prim=null;
    ST.geos.forEach((g,cv)=>{ if(!cv.isConnected){ ST.geos.delete(cv); return; } geos.push(g); if(g.primary && !prim) prim=g; });
    if(!prim) prim=geos[0]||null;
    const C={ w:K.w, h:K.h, gen:PAL.gen, ver:ST.ver, px, prim, halos:[], orbits:[], stars:[] };

    // The sun's light above each limb, as ellipses drawn through a scale: a wide
    // low halo, and a tight bloom where the sun is about to clear the edge. The
    // planet body on the band covers the lower half of both.
    geos.forEach(g=>{
      let ry=0.24*g.ph, rx=0.64*g.pw;
      C.halos.push({ x:g.ax, y:g.ay+0.02*g.ph, sx:rx/ry, r:ry,
        g:stops(ctx.createRadialGradient(0,0,0,0,0,ry), h,s,c.glow,
          [0,0.24, 0.15,0.16, 0.35,0.08, 0.6,0.028, 1,0]) });
      ry=0.075*g.ph; rx=0.24*g.pw;
      const b=ctx.createRadialGradient(0,0,0,0,0,ry);
      b.addColorStop(0, hslStr(h,clamp(s-15,0,100),c.rim,0.42));
      b.addColorStop(0.22, hslStr(h,s,c.glow,0.2));
      b.addColorStop(0.55, hslStr(h,s,c.glow,0.06));
      b.addColorStop(1, hslStr(h,s,c.glow,0));
      C.halos.push({ x:g.ax, y:g.ay+0.012*g.ph, sx:rx/ry, r:ry, g:b });
    });

    // A faint band of the galaxy across the upper sky, over the primary. Three
    // long ellipses, offset, so it thickens and thins instead of reading as a stripe.
    const P=prim || { ax:K.w/2, ay:K.h*0.6, pw:K.w, ph:K.h };
    const ang=-17*D2R, ca=Math.cos(ang), sa=Math.sin(ang);
    const gx=P.ax+0.08*P.pw, gy=P.ay-0.40*P.ph;
    C.milky=[];
    [[0,0,0.70,0.085,0.03],[-0.20,0.03,0.40,0.045,0.024],[0.24,-0.02,0.34,0.035,0.02]].forEach(([ox,oy,rx,ry,a])=>{
      const R0=ry*P.ph;
      C.milky.push({ x:gx+ox*P.pw*ca-oy*P.ph*sa, y:gy+ox*P.pw*sa+oy*P.ph*ca, sx:rx*P.pw/R0, r:R0,
        g:stops(ctx.createRadialGradient(0,0,0,0,0,R0), h,clamp(s*0.5,0,100),c.glow,
          [0,a, 0.4,a*0.55, 1,0]) });
    });
    C.ang=ang;

    // stars, only where the sky shows; three brightness classes x six twinkle
    // phases. A share of them crowd along the galaxy band.
    const r=rng(4242), N=Math.round(K.w*K.h/16000), lists=[];
    for(let i=0;i<18;i++) lists.push([]);
    for(let i=0;i<N;i++){
      let x, y;
      if(r()<0.35){
        const t=(r()*2-1)*0.75*P.pw, o=gauss(r)*0.05*P.ph;
        x=gx+t*ca-o*sa; y=gy+t*sa+o*ca;
        if(x<0||x>K.w||y<0||y>K.h) continue;
      }else{ x=r()*K.w; y=r()*K.h; }
      const q=r();
      let hid=false;
      for(const g of geos){ const dx=x-g.cx, dy=y-g.cy; if(dx*dx+dy*dy<(g.R+3)*(g.R+3)){ hid=true; break; } }
      if(hid) continue;
      const cls= q<0.025 ? 2 : q<0.18 ? 1 : 0;
      const sz=Math.max(px, cls===2 ? 1.9 : cls===1 ? 1.4 : 1.0+r()*0.25);
      lists[cls*6+Math.floor(r()*6)].push(x,y,sz);
    }
    C.stars=lists.map(a=>Float32Array.from(a));
    const sl=clamp(PAL.l+25,0,92), ss=clamp(s*0.45,0,100);
    C.starSty=[]; for(let j=0;j<=40;j++) C.starSty.push(hslStr(h,ss,sl,(j/40).toFixed(3)));

    // a handful of bright stars with a soft halo each, from one unit gradient
    const su=prim ? prim.u : 1, nh=Math.max(3, Math.round(K.w*K.h/900000));
    C.hero=[];
    for(let i=0;i<nh*4 && C.hero.length<nh*4;i++){
      const x=K.w*(0.04+0.92*r()), y=K.h*(0.04+0.84*r());
      let hid=false;
      for(const g of geos){ const dx=x-g.cx, dy=y-g.cy; if(dx*dx+dy*dy<(g.R+60)*(g.R+60)){ hid=true; break; } }
      if(!hid) C.hero.push(x, y, (7+8*r())*su, r()*TAU);
    }
    C.heroG=stops(ctx.createRadialGradient(0,0,0,0,0,1), h,ss,sl, [0,0.6, 0.1,0.26, 0.3,0.07, 1,0]);
    C.heroCore=C.starSty[36];

    if(prim){
      const g=prim;
      C.orbitG=stops(ctx.createRadialGradient(g.ax,g.ay,0,g.ax,g.ay,1.0*g.pw), h,s,c.line,
        [0,0.20, 0.35,0.13, 0.7,0.06, 1,0.03]);
      ORBITS.forEach(o=>{
        const A=o.a*g.R, B=o.b*g.R, rot=o.rot*D2R, p=new Path2D();
        p.ellipse(g.cx,g.cy,A,B,rot,0,TAU);
        C.orbits.push({ A, B, cr:Math.cos(rot), sr:Math.sin(rot), p,
                        dash:o.dash ? o.dash.map(d=>d*g.u) : null, step:12*g.u/A });
      });
      const sp=Math.max(4,9*g.u);
      C.sprite=stops(ctx.createRadialGradient(0,0,0,0,0,sp), h,s,c.rim, [0,0.55, 0.25,0.22, 1,0]);
      C.spR=sp;
      C.core=hslStr(h,clamp(s-20,0,100),clamp(PAL.l+30,70,97));
      C.trail=[]; for(let j=0;j<6;j++) C.trail.push(hslStr(h,s,c.rim,(0.42*(1-j/6)).toFixed(3)));
      C.brk=hslStr(h,s,c.line,0.38);
    }
    ST.sky=C;
    return C;
  }

  function ellipses(ctx, list, rot){
    for(const a of list){
      ctx.save(); ctx.translate(a.x,a.y); if(rot) ctx.rotate(rot); ctx.scale(a.sx,1);
      ctx.fillStyle=a.g; ctx.fillRect(-a.r,-a.r,2*a.r,2*a.r);
      ctx.restore();
    }
  }

  function drawSkyAll(K, t, b, still){
    let C=ST.sky;
    if(!C || C.w!==K.w || C.h!==K.h || C.gen!==PAL.gen || C.ver!==ST.ver) C=skyBuild(K);
    const ctx=K.ctx;
    ctx.clearRect(0,0,K.w,K.h);
    ellipses(ctx, C.milky, C.ang);
    // the halo only means something over a drawn planet
    const planet=CFG.terrain && C.prim;
    if(planet){
      ctx.globalAlpha=0.7+0.3*b;
      ellipses(ctx, C.halos, 0);
      ctx.globalAlpha=1;
    }
    const base=[0.28,0.5,0.85];
    for(let c=0;c<3;c++) for(let g=0;g<6;g++){
      const a=C.stars[c*6+g]; if(!a.length) continue;
      const tw= still ? 0.85 : 0.72+0.28*Math.sin(t*(0.35+g*0.07)+g*1.7);
      ctx.fillStyle=C.starSty[Math.round(clamp(base[c]*tw,0,1)*40)];
      ctx.beginPath();
      for(let i=0;i<a.length;i+=3) ctx.rect(a[i],a[i+1],a[i+2],a[i+2]);
      ctx.fill();
    }
    ctx.fillStyle=C.heroG;
    for(let i=0;i<C.hero.length;i+=4){
      ctx.globalAlpha= still ? 0.85 : 0.7+0.3*Math.sin(t*0.21+C.hero[i+3]);
      ctx.save(); ctx.translate(C.hero[i],C.hero[i+1]); ctx.scale(C.hero[i+2],C.hero[i+2]);
      ctx.fillRect(-1,-1,2,2); ctx.restore();
    }
    ctx.globalAlpha=1; ctx.fillStyle=C.heroCore; ctx.beginPath();
    for(let i=0;i<C.hero.length;i+=4) ctx.rect(C.hero[i]-1,C.hero[i+1]-1,2,2);
    ctx.fill();
    if(!planet) return;

    const g=C.prim;
    ctx.strokeStyle=C.orbitG; ctx.lineWidth=C.px;
    for(const o of C.orbits){
      if(o.dash) ctx.setLineDash(o.dash);
      ctx.stroke(o.p);
      if(o.dash) ctx.setLineDash([]);
    }
    const R2=(g.R+2)*(g.R+2), bs=Math.max(3,6*g.u), bl=Math.max(2,3.5*g.u);
    for(const sat of SATS){
      const o=C.orbits[sat.orbit], ph=sat.phase+t*TAU/sat.period;
      const pos=(p)=>{ const c=Math.cos(p), s=Math.sin(p);
        return [g.cx+o.A*c*o.cr-o.B*s*o.sr, g.cy+o.A*c*o.sr+o.B*s*o.cr]; };
      const [X,Y]=pos(ph), dx=X-g.cx, dy=Y-g.cy;
      if(dx*dx+dy*dy<R2 || X<-30 || X>K.w+30 || Y<-30 || Y>K.h+30) continue;
      // a short fading wake along the orbit
      ctx.lineWidth=Math.max(C.px,1.2*g.u);
      let [px,py]=[X,Y];
      for(let j=0;j<6;j++){
        const [qx,qy]=pos(ph-(j+1)*o.step);
        ctx.strokeStyle=C.trail[j];
        ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(qx,qy); ctx.stroke();
        px=qx; py=qy;
      }
      ctx.save(); ctx.translate(X,Y); ctx.fillStyle=C.sprite;
      ctx.fillRect(-C.spR,-C.spR,2*C.spR,2*C.spR); ctx.restore();
      ctx.fillStyle=C.core; ctx.fillRect(X-1,Y-1,2,2);
      // tracking brackets, the one bit of HUD in the scene
      ctx.strokeStyle=C.brk; ctx.lineWidth=C.px;
      ctx.beginPath();
      for(const sx of [-1,1]) for(const sy of [-1,1]){
        const x0=X+sx*bs, y0=Y+sy*bs;
        ctx.moveTo(x0-sx*bl,y0); ctx.lineTo(x0,y0); ctx.lineTo(x0,y0-sy*bl);
      }
      ctx.stroke();
    }
  }

  return {
    label:"Orbital", band:BAND,
    init(T){ build(T); },
    frame(dt, S){
      ST.acc+=dt;
      ST.redraw=ST.acc>=REDRAW_MS;
      if(ST.redraw) ST.acc=0;
      // swell quickly on a kick, settle slowly, so bass reads as a breath and not a flicker
      const e=S.energy, k=Math.min(1,(e>ST.energy?0.08:0.025)*dt/16);
      ST.energy+=(e-ST.energy)*k;
      ST.breath=clamp(ST.energy*1.4,0,1);
      ST.spin=(STILL_SPIN+S.t*SPIN)%TAU;
    },
    draw(T){ if(ST.redraw || !T.orbital) drawBand(T, ST.spin, ST.breath); },
    sky(K, S){ if(ST.redraw || !ST.sky) drawSkyAll(K, S.t, ST.breath, false); },
    still(T){ drawBand(T, STILL_SPIN, 0.3); },
    stillSky(K){ drawSkyAll(K, STILL_T, 0.3, true); }
  };
})();
SCENES.orbital=ORBITAL;
