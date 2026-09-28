/* =========================================================================
   SCENE: SOLAR SYSTEM
   A tactical orrery that shows the solar system as it is right now. The star
   sits at the center of the primary monitor and eight planets sit on nested
   ellipses, the orbit plane seen from about 27 degrees above its edge. Each
   planet is at its real heliocentric longitude for the current date and moves
   at its real speed, so it looks still: Mercury, the fastest, covers four
   degrees a day. The Moon circles Earth at its real place and is labeled
   with its real phase, and Jupiter's four big moons are where they really
   are (Io laps in under two days). Orbit radii are spaced for the screen,
   not to scale. Each planet is a small sphere lit by the star, so its phase
   follows its place on the plot: a crescent on the near side, full on the
   far side. A bearing ring marked in ecliptic longitude frames the plane,
   and the star rides its barycenter wobble, a few pixels following Jupiter.
   The star's glow, a reticle and a scan cursor keep the scene alive.

   Everything lives on the sky canvas; the band is the minimum and stays
   empty. The static layer (stars, orbits, belt, axes, bearing ring) is baked
   once per palette or size into an offscreen canvas that covers only the
   system, and painted onto the sky once. After that a redraw touches only
   the rects the moving parts covered last time: each is restored from the
   cache, then every planet, trail, label and the star glow is drawn at its
   new place. At 4K that is a few hundred thousand pixels a redraw instead
   of eight million, and redraws run at about 30 fps: nothing here moves
   fast enough to need more.
   ========================================================================= */
const SOLAR=(()=>{
  const TAU=Math.PI*2, D2R=Math.PI/180;
  const TILT=0.46;                      // minor/major axis of every orbit
  const COSE=Math.sqrt(1-TILT*TILT);    // how far starlight can point at the camera
  const RING=1.09;                      // bearing ring radius, in outer-orbit radii
  const REDRAW_MS=30;
  const NPH=25;                         // phase steps per planet sprite
  const NT=14;                          // trail segments (alpha steps)
  /* rn: orbit radius as a share of the outer orbit. sz: disk radius in px at
     4K. alb: brightness of the lit side. */
  const BODIES=[
    { name:"MERCURY", au:"0.39 AU", rn:0.15, sz:3.4, alb:0.70 },
    { name:"VENUS",   au:"0.72 AU", rn:0.23, sz:5.0, alb:1.00 },
    { name:"EARTH",   au:"1.00 AU", rn:0.31, sz:5.3, alb:0.92 },
    { name:"MARS",    au:"1.52 AU", rn:0.40, sz:4.1, alb:0.78 },
    { name:"JUPITER", au:"5.20 AU", rn:0.59, sz:11.5, alb:0.95 },
    { name:"SATURN",  au:"9.58 AU", rn:0.73, sz:9.8, alb:0.90 },
    { name:"URANUS",  au:"19.2 AU", rn:0.87, sz:7.2, alb:0.84 },
    { name:"NEPTUNE", au:"30.1 AU", rn:1.00, sz:7.0, alb:0.84 }
  ];
  /* of: body index. r: orbit in px at 4K, in the planet's own (tilted) plane.
     g: index into the ephemeris' Galilean moons; the Moon has none. */
  const MOONS=[
    { of:2, r:15, sz:2.1 },
    { of:4, r:15, sz:0.9, g:0 },
    { of:4, r:20, sz:0.9, g:1 },
    { of:4, r:27, sz:1.2, g:2 },
    { of:4, r:35, sz:1.0, g:3 }
  ];
  const EARTH=2, SAT=5, JUP=4;

  /* ---------------- ephemeris ----------------
     Where everything really is, now. Planets from JPL's Keplerian elements for
     1800 to 2050 (Standish, "Keplerian Elements for Approximate Positions of
     the Major Planets", table 1): arcminutes for the inner planets and well
     under a degree for the outer ones, far finer than a pixel of this plot.
     The Moon from the leading terms of its longitude series (Meeus, table
     47.A), about a tenth of a degree. Jupiter's moons from their mean
     longitudes (Meeus, ch. 44), a degree or two.
     Every angle is an ecliptic longitude: 0 is the vernal equinox, drawn to
     the right, and angles grow counterclockwise, which is the way the planets
     move seen from the north. The ELEM rows are a, e, I, L, longitude of
     perihelion, longitude of node, then the rate of each per Julian century. */
  const ELEM=[
    [ 0.38709927, 0.20563593, 7.00497902, 252.25032350,  77.45779628,  48.33076593,
      0.00000037, 0.00001906,-0.00594749,149472.67411175, 0.16047689,-0.12534081],
    [ 0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718,  76.67984255,
      0.00000390,-0.00004107,-0.00078890, 58517.81538729, 0.00268329,-0.27769418],
    [ 1.00000261, 0.01671123,-0.00001531, 100.46457166, 102.93768193,   0.0,
      0.00000562,-0.00004392,-0.01294668, 35999.37244981, 0.32327364,  0.0],
    [ 1.52371034, 0.09339410, 1.84969142,  -4.55343205, -23.94362959,  49.55953891,
      0.00001847, 0.00007882,-0.00813131, 19140.30268499, 0.44441088,-0.29257343],
    [ 5.20288700, 0.04838624, 1.30439695,  34.39644051,  14.72847983, 100.47390909,
     -0.00011607,-0.00013253,-0.00183714,  3034.74612775, 0.21252668, 0.20469106],
    [ 9.53667594, 0.05386179, 2.48599187,  49.95424423,  92.59887831, 113.66242448,
     -0.00125060,-0.00050991, 0.00193609,  1222.49362201,-0.41897216,-0.28867794],
    [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630,  74.01692503,
     -0.00196176,-0.00004397,-0.00242939,   428.48202785, 0.40805281, 0.04240589],
    [30.06992276, 0.00859048, 1.77004347, -55.12002969,  44.96476227, 131.78422574,
      0.00026291, 0.00005105, 0.00035372,   218.45945325,-0.32241464,-0.00508664]
  ];
  function helioLon(el, T){
    const a=el[0]+el[6]*T, e=el[1]+el[7]*T, I=(el[2]+el[8]*T)*D2R, L=el[3]+el[9]*T;
    const wb=el[4]+el[10]*T, Om=(el[5]+el[11]*T)*D2R, w=wb*D2R-Om;
    const M=(((L-wb)%360+540)%360-180)*D2R;
    let E=M+e*Math.sin(M);
    for(let i=0;i<6;i++) E-=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));
    const xp=a*(Math.cos(E)-e), yp=a*Math.sqrt(1-e*e)*Math.sin(E);
    const cw=Math.cos(w), sw=Math.sin(w), cO=Math.cos(Om), sO=Math.sin(Om), cI=Math.cos(I);
    return Math.atan2((cw*sO+sw*cO*cI)*xp+(-sw*sO+cw*cO*cI)*yp,
                      (cw*cO-sw*sO*cI)*xp+(-sw*cO-cw*sO*cI)*yp);
  }
  const PHASES=[[11,"NEW MOON"],[79,"WAXING CRESCENT"],[101,"FIRST QUARTER"],[169,"WAXING GIBBOUS"],
                [191,"FULL MOON"],[259,"WANING GIBBOUS"],[281,"LAST QUARTER"],[349,"WANING CRESCENT"],[361,"NEW MOON"]];
  function ephem(ms){
    const jd=ms/86400000+2440587.5, d=jd-2451545.0;
    const lon=ELEM.map(el=>helioLon(el, d/36525));
    const Mm=(134.963+13.064993*d)*D2R, Ms=(357.529+0.98560028*d)*D2R;
    const D=(297.850+12.190749*d)*D2R, F=(93.272+13.229350*d)*D2R;
    const moon=(218.316+13.176396*d
      +6.289*Math.sin(Mm)+1.274*Math.sin(2*D-Mm)+0.658*Math.sin(2*D)+0.214*Math.sin(2*Mm)
      -0.186*Math.sin(Ms)-0.114*Math.sin(2*F)+0.059*Math.sin(2*D-2*Mm)+0.057*Math.sin(2*D-Ms-Mm)
      +0.053*Math.sin(2*D+Mm)+0.046*Math.sin(2*D-Ms))*D2R;
    // the Sun seen from Earth is Earth's heliocentric longitude turned half round
    const el=(((moon-lon[EARTH]-Math.PI)/D2R)%360+360)%360;
    const t=jd-2443000.5;
    const gal=[106.07719+203.488955790*t, 175.73161+101.374724735*t,
               120.55883+50.317609207*t, 84.44459+21.571071177*t].map(v=>v*D2R);
    const ph=PHASES.find(p=>el<p[0])[1];
    return { lon, moon, gal, phase:ph+" · "+Math.round((1-Math.cos(el*D2R))/2*100)+"%" };
  }
  function today(){
    const n=new Date(), p=v=>String(v).padStart(2,"0");
    return n.getFullYear()+"-"+p(n.getMonth()+1)+"-"+p(n.getDate());
  }

  const S={ G:null, need:true, fno:0, skyF:-9, acc:REDRAW_MS, redraw:true, e:0,
            terr:null, rects:[], font:"monospace", eph:null, ephAt:-1e12, day:"",
            moonLbls:null, moonDir:null, placedAt:null, placedG:null };

  // mulberry32: a plain LCG's consecutive draws correlate, and the belt came out in streaks
  function rng(seed){
    let a=seed|0;
    return ()=>{
      a=(a+0x6D2B79F5)|0;
      let t=Math.imul(a^(a>>>15), a|1);
      t^=t+Math.imul(t^(t>>>7), t|61);
      return ((t^(t>>>14))>>>0)/4294967296;
    };
  }
  function mk(w,h){
    const c=document.createElement("canvas"); c.width=Math.max(1,w|0); c.height=Math.max(1,h|0); return c;
  }
  function rgbOf(h,s,l){
    s/=100; l/=100;
    const a=s*Math.min(l,1-l), f=n=>{ const q=(n+h/30)%12; return 255*(l-a*Math.max(-1,Math.min(q-3,9-q,1))); };
    return [f(0),f(8),f(4)];
  }

  /* Line lightness follows the waves (PAL.l+8, capped at 80), and saturation
     eases off as the accent gets paler, so ice stays ice instead of going cobalt. */
  function tones(){
    const h=PAL.h, l=PAL.l, s=PAL.s*clamp(1-(l-58)/90,0.62,1);
    return { h, s, line:clamp(l+8,0,80), hi:clamp(l+22,64,92), txt:clamp(l+14,62,88),
             glow:clamp(l+6,52,80), core:clamp(l+34,86,95) };
  }

  /* ---------------- geometry ---------------- */
  function primaryRect(K, SC){
    const live=SC && SC.screens && SC.screens.length;
    const L=live ? SC.screens : (LAY.screens||[]);
    const P=L[live ? SC.primary : (LAY.primary||0)];
    return P && P.w>0 && P.h>0 ? P : {x:0, y:0, w:K.w, h:K.h};
  }
  /* The outer orbit is sized to pass between the corner stacks: they are
     25rem wide inside a margin that grows on an ultrawide (see screenVars).
     A portrait monitor stacks its panels above and below instead, so there
     the system takes the width. */
  function geom(K, SC){
    const P=primaryRect(K,SC), u=Math.max(0.42, Math.min(P.w,P.h)/2160);
    let A;
    if(P.w/P.h<1.3) A=0.38*P.w;
    else{
      const rem=clamp(0.013*Math.min(P.w,P.h),9,30)*(+CFG.uiScale||1);
      const edge=Math.max(0.022,(1-2*P.h/P.w)/2)*P.w;
      const col=Math.min(25*rem, 0.34*P.w);
      A=Math.min((P.w/2-edge-col)*0.86, 0.9*P.h);
    }
    A=Math.max(A, 150*u);
    return { u, A, B:A*TILT, R1:A*RING, cx:P.x+P.w/2, cy:P.y+P.h*0.52, w:K.w, h:K.h };
  }
  function pt(G, r, th){ return [G.cx+r*Math.cos(th), G.cy-r*TILT*Math.sin(th)]; }

  /* ---------------- sprites ---------------- */
  /* A lit sphere, light from +x in the sprite's frame tipped lz toward the
     camera. The body is nearly opaque, so the orbit line under a planet
     passes behind it, and the night limb keeps a faint rim so a crescent
     still reads as a whole disk. Built once per palette and size. */
  function sphere(rd, lz, alb, lit, dark){
    const n=Math.ceil(rd*2+4), c=mk(n,n), g=c.getContext("2d");
    const im=g.createImageData(n,n), d=im.data, m=n/2;
    const lx=Math.sqrt(Math.max(0,1-lz*lz));
    for(let j=0;j<n;j++) for(let i=0;i<n;i++){
      const x=(i+0.5-m)/rd, y=(j+0.5-m)/rd, q=x*x+y*y, dd=Math.sqrt(q);
      const cov=clamp((1-dd)*rd+0.5,0,1);
      if(cov<=0) continue;
      const z=Math.sqrt(Math.max(0,1-q)), lam=x*lx+z*lz;
      let I=clamp((lam+0.05)/0.32,0,1); I=I*I*(3-2*I)*(0.6+0.4*Math.max(0,lam));
      // earthshine and a faint rim on the night side
      const rim=(0.06+Math.pow(clamp((dd-0.66)/0.34,0,1),2)*0.26)*(1-I);
      const v=clamp(I*alb+rim,0,1), o=(j*n+i)*4;
      d[o]=dark[0]+(lit[0]-dark[0])*v; d[o+1]=dark[1]+(lit[1]-dark[1])*v; d[o+2]=dark[2]+(lit[2]-dark[2])*v;
      d[o+3]=255*cov*(0.9+0.1*v);
    }
    g.putImageData(im,0,0);
    return c;
  }
  function radial(rd, h, s, l, list){
    const n=Math.ceil(rd*2)+2, c=mk(n,n), g=c.getContext("2d");
    const gr=g.createRadialGradient(n/2,n/2,0,n/2,n/2,rd);
    for(let i=0;i<list.length;i+=2) gr.addColorStop(list[i], hslStr(h,s,l,list[i+1]));
    g.fillStyle=gr; g.fillRect(0,0,n,n);
    return c;
  }
  /* A callout: a leader off a 45 degree diagonal toward one corner (dir is
     "ur", "dr", "ul" or "dl"), an underline, the name above it and the detail
     below, all in device pixels so it lands 1:1 and stays crisp. dotR is the
     radius of the thing it points at. */
  const DIRS=["ur","dr","ul","dl"];
  function label(name, sub, dotR, G, T, dir){
    const k=G.k, u=G.u, fz=Math.max(9,14*u), sz=Math.max(8,fz*0.8);
    const sg=dir.charAt(0)==="d"?1:-1, sx=dir.charAt(1)==="l"?-1:1;
    const rr=dotR+3.5*u, e0=rr*0.7071+1.5*u, e1=e0+11*u, base=sg*e1;
    const g0=mk(4,4).getContext("2d");
    const setF=(g,px)=>{ g.font=`${(px*k).toFixed(2)}px ${S.font}`; try{ g.letterSpacing=(px*0.16*k).toFixed(2)+"px"; }catch(e){} };
    setF(g0,fz); const wN=g0.measureText(name).width/k;
    setF(g0,sz); const wS=g0.measureText(sub).width/k;
    const w=Math.max(wN,wS)+5*u;
    const x0=sx>0 ? e0-2 : -(e1+w)-2, x1=sx>0 ? e1+w+2 : -e0+2;
    const y0=Math.min(sg*e0, base-4*u-fz*1.1)-2, y1=Math.max(sg*e0, base+3*u+sz*1.3)+2;
    const ox=Math.floor(x0*k), oy=Math.floor(y0*k);
    const W=Math.ceil(x1*k)-ox, H=Math.ceil(y1*k)-oy;
    const c=mk(W,H), g=c.getContext("2d");
    const X=v=>v*k-ox, Y=v=>v*k-oy;
    const ly=Math.round(Y(base))+0.5;
    g.strokeStyle=hslStr(T.h,T.s,T.line,0.34); g.lineWidth=1;
    g.beginPath();
    g.moveTo(X(sx*e0),Y(sg*e0)); g.lineTo(X(sx*e1),ly); g.lineTo(Math.round(X(sx*(e1+w))),ly);
    g.stroke();
    // right-hand callouts read from the leader out, left-hand ones end at it
    g.textAlign=sx>0 ? "left" : "right";
    const tx=Math.round(X(sx*(e1+2*u)));
    setF(g,fz); g.textBaseline="alphabetic";
    g.fillStyle=hslStr(T.h,T.s*0.85,T.txt,0.66);
    g.fillText(name, tx, Math.round(Y(base-4*u)));
    setF(g,sz); g.textBaseline="top";
    g.fillStyle=hslStr(T.h,T.s*0.7,T.txt-8,0.40);
    g.fillText(sub, tx, Math.round(Y(base+3*u)));
    return { cv:c, ox, oy, w:W, h:H };
  }
  function labels(name, sub, dotR, G, T){
    const set={ sub };
    for(const d of DIRS) set[d]=label(name, sub, dotR, G, T, d);
    return set;
  }
  function ovl(a, b){
    const w=Math.min(a[2],b[2])-Math.max(a[0],b[0]), h=Math.min(a[3],b[3])-Math.max(a[1],b[1]);
    return w>0 && h>0 ? w*h : 0;
  }
  // where a callout lands for a body at x,y, in CSS px, snapped as it is drawn
  function lrect(L, x, y, k){
    const X=Math.round(x*k)+L.ox, Y=Math.round(y*k)+L.oy;
    return [X/k, Y/k, (X+L.w)/k, (Y+L.h)/k];
  }
  /* Real positions put the planets wherever they are, so two callouts can
     land on each other (Venus beside Earth, say). Each callout takes the
     corner that overlaps least with the bodies and the callouts already
     placed, and keeps its last corner unless another is clearly better, so
     nothing hops about. Runs when the ephemeris does, once a second. */
  function placeLabels(G, P, luna){
    const k=G.k, u=G.u, box=[G.bx/k, G.by/k, (G.bx+G.bw)/k, (G.by+G.bh)/k];
    const obst=P.map(p=>{ const r=p.r+4*u; return [p.x-r, p.y-r, p.x+r, p.y+r]; });
    const lr=luna.z+2*u;
    obst.push([luna.x-lr, luna.y-lr, luna.x+lr, luna.y+lr]);
    const jobs=P.map((p,i)=>({ set:p.b.lbls, x:p.x, y:p.y, own:i, prev:p.b.dir, pref:DIRS,
                               put:d=>{ p.b.dir=d; } }));
    jobs.splice(EARTH+1, 0, { set:S.moonLbls, x:luna.x, y:luna.y, own:P.length, prev:S.moonDir,
                              pref:["dr","dl","ur","ul"], put:d=>{ S.moonDir=d; } });
    const placed=[];
    for(const j of jobs){
      let best=j.pref[0], bestS=Infinity, prevS=Infinity;
      for(const d of j.pref){
        const R=lrect(j.set[d], j.x, j.y, k);
        let sc=0;
        for(let q=0;q<obst.length;q++) if(q!==j.own) sc+=ovl(R, obst[q]);
        for(const Q of placed) sc+=ovl(R, Q);
        // outside the cached box it could never be erased again
        if(R[0]<box[0] || R[1]<box[1] || R[2]>box[2] || R[3]>box[3]) sc+=1e9;
        if(d===j.prev) prevS=sc;
        if(sc<bestS){ bestS=sc; best=d; }
      }
      const d=(j.prev && prevS<=bestS+20*u*u) ? j.prev : best;
      j.put(d);
      placed.push(lrect(j.set[d], j.x, j.y, k));
    }
  }

  /* ---------------- the static layer ---------------- */
  function build(K, SC){
    const k=K.ctx.canvas.width/Math.max(1,K.w);
    const G=geom(K,SC), T=tones(), u=G.u, A=G.A, h=T.h, s=T.s;
    G.k=k; G.gen=PAL.gen; G.cw=K.ctx.canvas.width; G.ch=K.ctx.canvas.height;
    try{ S.font=getComputedStyle(document.body).fontFamily||"monospace"; }catch(e){}
    // the cached box: the ring, its numbers, and room for Neptune's callout
    const hw=Math.max(G.R1+80*u, A+170*u);
    const top=Math.max(G.R1*TILT+70*u, G.B+95*u), bot=G.R1*TILT+120*u;
    G.bx=clamp(Math.floor((G.cx-hw)*k),0,G.cw); G.by=clamp(Math.floor((G.cy-top)*k),0,G.ch);
    G.bw=Math.max(1, clamp(Math.ceil((G.cx+hw)*k),0,G.cw)-G.bx);
    G.bh=Math.max(1, clamp(Math.ceil((G.cy+bot)*k),0,G.ch)-G.by);
    const inBox=(x,y)=>x*k>=G.bx-2 && x*k<G.bx+G.bw+2 && y*k>=G.by-2 && y*k<G.by+G.bh+2;

    /* Stars: sparse and still, thinner inside the ring so the plane stays
       clean. Split into the ones the cache holds and the ones outside it. */
    const r=rng(9173), px=1/k, N=Math.round(K.w*K.h/19000);
    G.starsIn=[]; G.starsOut=[];
    const sty=[];
    for(let i=0;i<6;i++){ G.starsIn.push([]); G.starsOut.push([]); }
    for(let i=0;i<N;i++){
      const x=r()*K.w, y=r()*K.h, q=r(), cls=q<0.03?2:q<0.2?1:0, lvl=Math.min(5,(cls*2+r()*2)|0);
      const dx=(x-G.cx)/G.R1, dy=(y-G.cy)/(G.R1*TILT);
      if(dx*dx+dy*dy<1.1 && r()<0.75) continue;
      const sz=Math.max(px, cls===2?1.8:cls===1?1.3:1);
      (inBox(x,y)?G.starsIn:G.starsOut)[lvl].push(x,y,sz);
    }
    const sl=clamp(PAL.l+22,0,90), ss=clamp(s*0.4,0,100);
    for(let i=0;i<6;i++) sty.push(hslStr(h,ss,sl,(0.16+i*0.1).toFixed(3)));
    G.starSty=sty;

    const cv=mk(G.bw,G.bh), c=cv.getContext("2d");
    c.setTransform(k,0,0,k,-G.bx,-G.by);
    stars(c, G, G.starsIn);

    // a faint pool of light round the star, which the breathing glow sits in
    const pr=0.26*A;
    c.save(); c.translate(G.cx,G.cy); c.scale(1,0.62);
    const pg=c.createRadialGradient(0,0,0,0,0,pr);
    pg.addColorStop(0,hslStr(h,s,T.glow,0.09)); pg.addColorStop(0.3,hslStr(h,s,T.glow,0.04));
    pg.addColorStop(1,hslStr(h,s,T.glow,0));
    c.fillStyle=pg; c.fillRect(-pr,-pr,2*pr,2*pr); c.restore();

    // the belt between Mars and Jupiter: dust, not a ring
    const nb=Math.round(A*1.7);
    const belt=[[],[],[]];
    for(let i=0;i<nb;i++){
      const rad=A*(0.495+0.015*((r()+r()+r())-1.5)*2), th=r()*TAU, [x,y]=pt(G,rad,th);
      belt[(r()*3)|0].push(x,y);
    }
    belt.forEach((L,i)=>{
      c.fillStyle=hslStr(h,s,T.line,(0.05+i*0.04).toFixed(3));
      c.beginPath(); const z=Math.max(px,(i===2?1.4:1)*u);
      for(let j=0;j<L.length;j+=2) c.rect(L[j]-z/2,L[j+1]-z/2,z,z);
      c.fill();
    });

    // axes through the star, dashed, with a tick where each orbit crosses
    c.lineWidth=px;
    c.setLineDash([2*u,7*u]);
    c.strokeStyle=hslStr(h,s,T.line,0.075);
    c.beginPath();
    c.moveTo(G.cx-G.R1,G.cy); c.lineTo(G.cx+G.R1,G.cy);
    c.moveTo(G.cx,G.cy-G.R1*TILT); c.lineTo(G.cx,G.cy+G.R1*TILT);
    c.stroke(); c.setLineDash([]);
    c.strokeStyle=hslStr(h,s,T.line,0.16);
    c.beginPath();
    for(const b of BODIES){
      const a=b.rn*A, bb=a*TILT, t=3*u;
      c.moveTo(G.cx-a,G.cy-t); c.lineTo(G.cx-a,G.cy+t);
      c.moveTo(G.cx+a,G.cy-t); c.lineTo(G.cx+a,G.cy+t);
      c.moveTo(G.cx-t*1.6,G.cy-bb); c.lineTo(G.cx+t*1.6,G.cy-bb);
      c.moveTo(G.cx-t*1.6,G.cy+bb); c.lineTo(G.cx+t*1.6,G.cy+bb);
    }
    c.stroke();

    // the orbits: fainter on the far side, like air between you and them
    for(const b of BODIES){
      const a=b.rn*A, bb=a*TILT;
      const lg=c.createLinearGradient(0,G.cy-bb,0,G.cy+bb);
      lg.addColorStop(0,hslStr(h,s,T.line,0.07)); lg.addColorStop(0.5,hslStr(h,s,T.line,0.12));
      lg.addColorStop(1,hslStr(h,s,T.line,0.2));
      c.strokeStyle=lg; c.lineWidth=px;
      c.beginPath(); c.ellipse(G.cx,G.cy,a,bb,0,0,TAU); c.stroke();
    }

    // bearing ring: the ring, a degree scale laid in the plane, numbers every 30
    const R1=G.R1;
    const rg=c.createLinearGradient(0,G.cy-R1*TILT,0,G.cy+R1*TILT);
    rg.addColorStop(0,hslStr(h,s,T.line,0.12)); rg.addColorStop(1,hslStr(h,s,T.line,0.24));
    c.strokeStyle=rg; c.lineWidth=px;
    c.beginPath(); c.ellipse(G.cx,G.cy,R1,R1*TILT,0,0,TAU); c.stroke();
    // an inner hairline makes it a bezel, not a ninth orbit
    const ri=R1-4*u;
    c.globalAlpha=0.5; c.beginPath(); c.ellipse(G.cx,G.cy,ri,ri*TILT,0,0,TAU); c.stroke(); c.globalAlpha=1;
    const tick=(lenFn, step, skip)=>{
      c.beginPath();
      for(let d=0; d<360; d+=step){
        if(skip && d%skip===0) continue;
        const th=d*D2R, [x0,y0]=pt(G,R1,th), [x1,y1]=pt(G,R1+lenFn(d),th);
        c.moveTo(x0,y0); c.lineTo(x1,y1);
      }
      c.stroke();
    };
    c.strokeStyle=rg;
    tick(()=>5*u, 2.5, 10);
    c.strokeStyle=hslStr(h,s,T.line,0.24); tick(()=>9*u, 10, 30);
    c.strokeStyle=hslStr(h,s,T.line,0.34); tick(()=>16*u, 30, 0);
    const bf=Math.max(8,11*u);
    c.font=`${bf}px ${S.font}`; try{ c.letterSpacing=(bf*0.12).toFixed(2)+"px"; }catch(e){}
    c.textAlign="center"; c.textBaseline="middle";
    c.fillStyle=hslStr(h,s*0.5,T.txt,0.30);
    for(let bear=0; bear<360; bear+=30){
      // ecliptic longitude: 000 is the vernal equinox on the right, growing counterclockwise
      const th=bear*D2R, [x,y]=pt(G,R1+16*u,th);
      let nx=TILT*Math.cos(th), ny=-Math.sin(th); const nl=Math.hypot(nx,ny); nx/=nl; ny/=nl;
      const off=6*u+Math.abs(nx)*bf*1.3+Math.abs(ny)*bf*0.6;
      c.fillText(String(bear).padStart(3,"0"), x+nx*off, y+ny*off);
    }
    // the plot's caption, under the 180 mark
    const cf=Math.max(8,12*u), cy2=G.cy+R1*TILT+16*u+bf*1.6+26*u;
    c.font=`${cf}px ${S.font}`; try{ c.letterSpacing=(cf*0.3).toFixed(2)+"px"; }catch(e){}
    c.fillStyle=hslStr(h,s*0.8,T.txt,0.36);
    c.fillText("SOL \u00b7 HELIOCENTRIC \u00b7 LIVE", G.cx, cy2);
    c.font=`${cf*0.82}px ${S.font}`; try{ c.letterSpacing=(cf*0.22).toFixed(2)+"px"; }catch(e){}
    c.fillStyle=hslStr(h,s*0.6,T.txt-10,0.24);
    c.fillText("ECLIPTIC LONGITUDE \u00b7 "+S.day+" \u00b7 RADII NOT TO SCALE", G.cx, cy2+cf*1.7);
    const cwid=150*u;
    c.strokeStyle=hslStr(h,s,T.line,0.16); c.lineWidth=px; c.beginPath();
    c.moveTo(G.cx-cwid,cy2-cf*1.2); c.lineTo(G.cx+cwid,cy2-cf*1.2);
    c.stroke();
    try{ c.letterSpacing="0px"; }catch(e){}
    G.cache=cv;

    /* ---- moving parts ---- */
    const lit=rgbOf(h,T.s*0.6,T.hi), dark=rgbOf(h,T.s*0.6,6);
    for(const b of BODIES){
      const rd=Math.max(1.2,b.sz*u*k);
      b.spr=[];
      for(let i=0;i<NPH;i++) b.spr.push(sphere(rd, -1+2*i/(NPH-1), b.alb, lit, dark));
      b.lbls=labels(b.name, b.au, b.sz*u, G, T);
    }
    G.T=T; S.moonLbls=null;          // the Moon's callout follows its phase, see moving()
    G.moonRing=hslStr(h,s,T.line,0.16);
    G.moonDot=hslStr(h,s*0.3,T.hi,0.95);
    G.halo=radial(32, h, s, T.glow, [0,0.5, 0.3,0.16, 0.6,0.04, 1,0]);
    G.glowR=58*u;
    G.glow=radial(G.glowR*1.15*k, h, s*0.7, T.glow, [0,0.6, 0.05,0.45, 0.14,0.2, 0.32,0.07, 0.6,0.02, 1,0]);
    G.coreR=3.4*u;
    G.core=radial(Math.max(2,G.coreR*k), h, s*0.3, T.core, [0,0.95, 0.35,0.85, 0.6,0.3, 1,0]);
    G.trailSty=[];
    for(let j=0;j<NT;j++) G.trailSty.push(hslStr(h,s,T.hi,(0.5*Math.pow(1-j/NT,1.7)).toFixed(3)));
    G.markSty=hslStr(h,s,T.line,0.2);
    G.reticle=hslStr(h,s,T.line,0.24);
    G.cursor=hslStr(h,s,T.hi,0.42);
    G.ringB=hslStr(h,s*0.5,T.hi,0.28); G.ringF=hslStr(h,s*0.5,T.hi,0.5);
    G.moon=hslStr(h,s*0.4,T.hi,0.7);
    S.G=G;
    return G;
  }

  function stars(ctx, G, lists){
    for(let i=0;i<6;i++){
      const L=lists[i]; if(!L.length) continue;
      ctx.fillStyle=G.starSty[i]; ctx.beginPath();
      for(let j=0;j<L.length;j+=3) ctx.rect(L[j],L[j+1],L[j+2],L[j+2]);
      ctx.fill();
    }
  }

  /* ---------------- painting ---------------- */
  function full(K, G, withSystem){
    const ctx=K.ctx;
    ctx.save(); ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,G.cw,G.ch);
    ctx.restore();
    stars(ctx, G, G.starsOut);
    if(withSystem){
      ctx.save(); ctx.setTransform(1,0,0,1,0,0);
      ctx.drawImage(G.cache, G.bx, G.by);
      ctx.restore();
    }else stars(ctx, G, G.starsIn);
    S.rects.length=0;
  }
  // put back what the moving parts covered, straight from the cache
  function restore(ctx, G){
    ctx.save(); ctx.setTransform(1,0,0,1,0,0);
    for(const R of S.rects){
      ctx.clearRect(R[0],R[1],R[2],R[3]);
      ctx.drawImage(G.cache, R[0]-G.bx, R[1]-G.by, R[2], R[3], R[0], R[1], R[2], R[3]);
    }
    ctx.restore();
    S.rects.length=0;
  }
  // a device-pixel rect, padded and clipped to the cached box
  function mark(G, x0, y0, x1, y1){
    const k=G.k;
    const a=clamp(Math.floor(x0*k)-3, G.bx, G.bx+G.bw), b=clamp(Math.floor(y0*k)-3, G.by, G.by+G.bh);
    const c=clamp(Math.ceil(x1*k)+3, G.bx, G.bx+G.bw), d=clamp(Math.ceil(y1*k)+3, G.by, G.by+G.bh);
    if(c>a && d>b) S.rects.push([a,b,c-a,d-b]);
  }

  /* Saturn's rings, half at a time: the far half goes under the planet and
     the near half over it. The ring plane is fixed in space, so from a fixed
     camera it keeps the same tilt all the way round. */
  const RROT=-0.36, RCS=Math.cos(RROT), RSN=Math.sin(RROT);
  function rings(ctx, G, p, from, sty){
    ctx.strokeStyle=sty; ctx.lineWidth=Math.max(1/G.k,0.9*G.u); ctx.beginPath();
    for(const f of [2.3,1.75]){
      const ra=p.r*f, rb=ra*0.35, c=Math.cos(from), s=Math.sin(from);
      ctx.moveTo(p.x+ra*c*RCS-rb*s*RSN, p.y+ra*c*RSN+rb*s*RCS);
      ctx.ellipse(p.x,p.y,ra,rb,RROT,from,from+Math.PI);
    }
    ctx.stroke();
  }

  function moving(ctx, G, t, br, e){
    const k=G.k, u=G.u, A=G.A, lw=Math.max(1/k,1.3*u), E=S.eph;
    ctx.setTransform(k,0,0,k,0,0);
    const P=BODIES.map((b,i)=>{
      const th=E.lon[i], c=Math.cos(th), s=Math.sin(th);
      const a=b.rn*A, x=G.cx+a*c, y=G.cy-a*TILT*s;
      const dth=Math.min(0.9, 250*u/a)/NT;
      return { b, th, c, s, a, x, y, dth, r:b.sz*u,
               x0:x, y0:y, x1:x, y1:y };
    });
    const grow=(p,x,y,m)=>{ if(x-m<p.x0) p.x0=x-m; if(x+m>p.x1) p.x1=x+m; if(y-m<p.y0) p.y0=y-m; if(y+m>p.y1) p.y1=y+m; };
    // the trail's extent, sampled along the arc it covers
    for(const p of P) for(let q=1;q<=NT;q++){ const aa=p.th-q*p.dth; grow(p, G.cx+p.a*Math.cos(aa), G.cy-p.a*TILT*Math.sin(aa), lw+1); }
    // the Moon's place, which its callout and the label layout both need
    const EP=P[EARTH], lmr=MOONS[0].r*u;
    const luna={ x:EP.x+lmr*Math.cos(E.moon), y:EP.y-lmr*TILT*Math.sin(E.moon), z:Math.max(1/k,MOONS[0].sz*u) };
    if(!S.moonLbls || S.moonLbls.sub!==E.phase){ S.moonLbls=labels("MOON", E.phase, luna.z, G, G.T); S.placedAt=null; }
    if(S.placedAt!==S.ephAt || S.placedG!==G){ placeLabels(G, P, luna); S.placedAt=S.ephAt; S.placedG=G; }

    // trails: one path per alpha step across every planet
    ctx.lineWidth=lw; ctx.lineCap="butt";
    for(let j=0;j<NT;j++){
      ctx.beginPath();
      for(const p of P){
        const a0=-(p.th-j*p.dth), bb=p.a*TILT;
        ctx.moveTo(G.cx+p.a*Math.cos(a0), G.cy+bb*Math.sin(a0));
        ctx.ellipse(G.cx,G.cy,p.a,bb,0,a0,a0+p.dth,false);
      }
      ctx.strokeStyle=G.trailSty[j]; ctx.stroke();
    }

    // the star, off its barycenter by a few pixels, opposite Jupiter and Saturn
    const J=P[JUP], Sa=P[SAT], wob=4*u;
    const sx=G.cx-wob*(J.c+0.3*Sa.c)/1.3, sy=G.cy+wob*TILT*(J.s+0.3*Sa.s)/1.3;
    const gs=G.glowR*1.15*(1+0.05*br+0.1*e);
    ctx.globalAlpha=clamp(0.6+0.2*br+0.35*e,0,1);
    ctx.drawImage(G.glow, sx-gs, sy-gs, 2*gs, 2*gs);
    ctx.globalAlpha=0.85+0.15*br;
    ctx.drawImage(G.core, sx-G.coreR, sy-G.coreR, 2*G.coreR, 2*G.coreR);
    ctx.globalAlpha=1;
    // a slow reticle round the star
    const rr=30*u, rot=t*TAU/120;
    ctx.strokeStyle=G.reticle; ctx.lineWidth=1/k; ctx.beginPath();
    for(let q=0;q<4;q++){ const a0=rot+q*Math.PI/2+0.35; ctx.moveTo(sx+rr*Math.cos(a0),sy+rr*Math.sin(a0)); ctx.arc(sx,sy,rr,a0,a0+0.9); }
    ctx.stroke();
    const sm=Math.max(gs, rr+2*u)+2;
    mark(G, sx-sm, sy-sm, sx+sm, sy+sm);

    // a scan cursor creeping round the bearing ring, a lap every five minutes
    const R1=G.R1, ct=0.6+t*TAU/300, cw=0.1, dl=5*u/R1;
    ctx.strokeStyle=G.cursor; ctx.lineWidth=Math.max(1/k,1.3*u); ctx.beginPath();
    ctx.ellipse(G.cx,G.cy,R1,R1*TILT,0,-ct-cw,-ct+cw);
    ctx.stroke();
    const [tx,ty]=pt(G,R1-3*u,ct), [ax,ay]=pt(G,R1-12*u,ct-dl), [bx,by]=pt(G,R1-12*u,ct+dl);
    ctx.fillStyle=G.cursor; ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(ax,ay); ctx.lineTo(bx,by); ctx.closePath(); ctx.fill();
    let cx0=Math.min(tx,ax,bx), cx1=Math.max(tx,ax,bx), cy0=Math.min(ty,ay,by), cy1=Math.max(ty,ay,by);
    for(let q=-4;q<=4;q++){ const [x,y]=pt(G,R1,ct+q*cw/4); cx0=Math.min(cx0,x); cx1=Math.max(cx1,x); cy0=Math.min(cy0,y); cy1=Math.max(cy1,y); }
    mark(G, cx0-2*u, cy0-2*u, cx1+2*u, cy1+2*u);

    // planets far to near, so a near one passes in front
    const order=P.slice().sort((p,q)=>q.s-p.s);
    for(const p of order){
      const b=p.b, bi=BODIES.indexOf(b), r=p.r;
      const moons=MOONS.filter(m=>m.of===bi).map(m=>{
        const luna=m.g==null, ph=luna ? E.moon : E.gal[m.g], mr=m.r*u;
        return { x:p.x+mr*Math.cos(ph), y:p.y-mr*TILT*Math.sin(ph), back:Math.sin(ph)>0,
                 z:Math.max(1/k,m.sz*u), luna, mr };
      });
      // the soft glow, stronger toward full phase
      const lz=p.s*COSE, hr=r*3.2;
      ctx.globalAlpha=(0.1+0.14*(lz+1)/2)*b.alb;
      ctx.drawImage(G.halo, p.x-hr, p.y-hr, 2*hr, 2*hr);
      ctx.globalAlpha=1;
      grow(p, p.x, p.y, hr);
      // the Moon gets its orbit drawn and a round body; Jupiter's are specks
      const moonBody=(m)=>{
        if(m.luna){ ctx.fillStyle=G.moonDot; ctx.beginPath(); ctx.arc(m.x,m.y,m.z,0,TAU); ctx.fill(); }
        else{ ctx.fillStyle=G.moon; ctx.fillRect(m.x-m.z/2,m.y-m.z/2,m.z,m.z); }
      };
      for(const m of moons) if(m.luna){
        ctx.strokeStyle=G.moonRing; ctx.lineWidth=1/k;
        ctx.beginPath(); ctx.ellipse(p.x,p.y,m.mr,m.mr*TILT,0,0,TAU); ctx.stroke();
        grow(p, p.x, p.y, m.mr+2);
      }
      for(const m of moons){ if(m.back) moonBody(m); grow(p,m.x,m.y,m.z+1); }
      if(bi===SAT){ rings(ctx, G, p, Math.PI, G.ringB); grow(p, p.x, p.y, r*2.5); }
      // the sphere, turned so its lit side faces the star
      const idx=Math.round((lz+1)/2*(NPH-1)), spr=b.spr[idx];
      const phi=Math.atan2(p.s*TILT, -p.c), cs=Math.cos(phi), sn=Math.sin(phi);
      ctx.setTransform(cs,sn,-sn,cs,p.x*k,p.y*k);
      ctx.drawImage(spr, -spr.width/2, -spr.height/2);
      ctx.setTransform(k,0,0,k,0,0);
      if(bi===SAT) rings(ctx, G, p, 0, G.ringF);
      for(const m of moons) if(!m.back) moonBody(m);
      // the Moon's callout, rebuilt only when its phase text changes
      for(const m of moons) if(m.luna){
        const L=S.moonLbls[S.moonDir], X=Math.round(m.x*k)+L.ox, Y=Math.round(m.y*k)+L.oy;
        ctx.setTransform(1,0,0,1,0,0); ctx.drawImage(L.cv, X, Y); ctx.setTransform(k,0,0,k,0,0);
        grow(p, X/k, Y/k, 0); grow(p, (X+L.w)/k, (Y+L.h)/k, 0);
      }
    }

    // marker rings, one path
    ctx.strokeStyle=G.markSty; ctx.lineWidth=1/k; ctx.beginPath();
    for(const p of P){ const rr2=p.r+3.5*u; ctx.moveTo(p.x+rr2,p.y); ctx.arc(p.x,p.y,rr2,0,TAU); }
    ctx.stroke();

    // callouts, snapped to device pixels
    ctx.setTransform(1,0,0,1,0,0);
    for(const p of P){
      const L=p.b.lbls[p.b.dir], X=Math.round(p.x*k)+L.ox, Y=Math.round(p.y*k)+L.oy;
      ctx.drawImage(L.cv, X, Y);
      grow(p, X/k, Y/k, 0); grow(p, (X+L.w)/k, (Y+L.h)/k, 0);
    }
    ctx.setTransform(k,0,0,k,0,0);
    for(const p of P) mark(G, p.x0, p.y0, p.x1, p.y1);
  }

  function paint(K, SC, t, br, e, forceFull){
    const k=K.ctx.canvas.width/Math.max(1,K.w), now=Date.now(), day=today();
    // the caption carries the date, so a new day rebuilds the cached layer
    if(day!==S.day){ S.day=day; S.need=true; }
    // nothing moves a pixel in a second, so the ephemeris runs at 1 Hz
    if(!S.eph || now-S.ephAt>1000){ S.eph=ephem(now); S.ephAt=now; }
    let G=S.G, fresh=false;
    if(S.need || !G || G.w!==K.w || G.h!==K.h || G.k!==k || G.gen!==PAL.gen){ G=build(K,SC); S.need=false; fresh=true; }
    const sys=!!CFG.terrain;
    if(fresh || forceFull || S.terr!==sys){ full(K,G,sys); S.terr=sys; }
    else if(sys) restore(K.ctx,G);
    if(sys) moving(K.ctx, G, t, br, e);
  }

  return {
    label:"Solar System", band:0.05,
    // a canvas rebuild (resize, new screens, lost context) wipes the sky too
    init(T){ S.need=true; T.solClear=false; },
    frame(dt, SC){
      S.fno++;
      S.acc+=dt;
      S.redraw=S.acc>=REDRAW_MS;
      if(S.redraw) S.acc=0;
      // real sound only (the idle visualizer feeds SC.energy too); swell on a
      // kick and settle slowly, so bass reads as a breath, never a flicker
      const e=(AUD.live && CFG.audio) ? SC.energy : 0, tau=e>S.e ? 260 : 1500;
      S.e+=(e-S.e)*(1-Math.exp(-dt/tau));
    },
    draw(T){ if(!T.solClear){ T.ctx.clearRect(0,0,T.w,T.h); T.solClear=true; } },
    sky(K, SC){
      // a skipped frame means drawSky cleared the canvas, or game mode drew over it
      const gap=S.skyF!==S.fno-1; S.skyF=S.fno;
      if(!gap && !S.redraw && !S.need) return;
      const br=0.5+0.5*Math.sin(SC.t*TAU/10.5);
      paint(K, SC, SC.t, br, clamp(S.e*1.3,0,1), gap);
    },
    still(T){ T.ctx.clearRect(0,0,T.w,T.h); T.solClear=true; },
    stillSky(K, SC){
      S.need=true;
      paint(K, SC, 0, 0.5, 0, true);
      S.skyF=-9;
    }
  };
})();
SCENES.solar=SOLAR;
