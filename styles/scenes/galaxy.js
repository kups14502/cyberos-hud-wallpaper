/* =========================================================================
   SCENE: GALAXY
   A spiral galaxy seen 60 degrees from face-on, turning slowly over the
   primary monitor. Two grand-design arms, with fainter fragments between
   them, wind out of a small dusty bulge as log spirals, built from tens of
   thousands of fine star points with dark lanes along their inner edges. Above that pattern a
   few thousand resolved stars orbit at their own speeds, the inner ones
   faster, and the young blue ones are born in the arms, drift downstream and
   fade out again. A faint halo, a still and very sparse background field,
   and a thin reference ellipse with a tick scale complete it.

   Everything lives on the sky canvas; the band is kept at its minimum and
   left empty. Cost is held down by baking:
     * the disk (star grain, the unresolved arm light and the dust lanes) is
       one face-on texture baked into ImageData: the densities once per size,
       the colors once per palette. The arm pattern turns as a rigid density
       wave, so one rotate + squash drawImage per redraw turns the whole disk;
     * the bulge is rounder than the disk, so it is a separate sprite baked
       in screen space, with the near side's dust silhouetted against it;
     * only the resolved stars move on their own: ~2000 fillRects counting-
       sorted into cached alpha buckets, each dimmed by the dust map as it
       passes through a lane;
     * the sky redraws at about 30 fps: the rim moves a few pixels a second,
       and a canvas keeps its pixels in between.
   ========================================================================= */
const GALAXY=(()=>{
  const D2R=Math.PI/180, TAU=Math.PI*2, DEG=String.fromCharCode(176);
  const INC=60*D2R, CI=Math.cos(INC), SI=Math.sin(INC);
  const PA=13*D2R, CPA=Math.cos(PA), SPA=Math.sin(PA);   // major axis falls to the right
  const QB=0.72;                  // the bulge's apparent axis ratio: it is rounder than the disk
  const TURN=1080, WP=TAU/TURN;   // the arm pattern turns once in 18 minutes
  const WIND=1/Math.tan(23*D2R);  // log spiral pitch
  const RA=0.11;                  // where the arms leave the bulge, in disk radii
  const TEXS=0.72;                // disk texels per device px along the major axis
  const RE=1.04;                  // reference ellipse, in disk radii
  const REDRAW_MS=30, LEV=16;
  const T0=210, STILL_T=T0+95;

  /* Two grand-design arms, then fragments between them: short, fainter
     stretches, some wound a little tighter or looser, so the disk reads as
     flocculent between the main arms instead of as two clean ribbons. */
  const ARMS=[
    {ph:0,              amp:1.00, r0:0.09, r1:1.00, dust:1.00, w:1.00},
    {ph:Math.PI,        amp:0.92, r0:0.09, r1:0.97, dust:0.95, w:1.00},
    {ph:1.55,           amp:0.40, r0:0.28, r1:0.74, dust:0.55, w:0.86},
    {ph:1.55+Math.PI,   amp:0.34, r0:0.36, r1:0.82, dust:0.50, w:0.86},
    {ph:0.85,           amp:0.24, r0:0.52, r1:0.94, dust:0.30, w:1.14},
    {ph:4.45,           amp:0.22, r0:0.48, r1:0.90, dust:0.30, w:1.14}
  ];
  ARMS.forEach((A,i)=>{
    A.id=i; A.fi=Math.min(0.07,0.3*(A.r1-A.r0)); A.fo=Math.min(0.3,0.5*(A.r1-A.r0));
    // brighter and fainter stretches along the arm, tabled over log radius
    A.cl=new Float32Array(1025);
    for(let q=0;q<=1024;q++){
      const L=q/256-1;
      A.cl[q]=0.25+1.6*Math.pow(0.65*vn(L*5.5+i*17.3,i*3.1,0)+0.35*vn(L*13+i*5.1,i*7.7,0),1.4);
    }
  });
  const ST={ acc:REDRAW_MS, redraw:true, e:0, breath:0, G:null, ydirty:true, knots:null };

  const sm=(a,b,x)=>{ const u=clamp((x-a)/(b-a),0,1); return u*u*(3-2*u); };
  const wrap=a=>a-TAU*Math.round(a/TAU);
  const sig=r=>0.030+0.060*r;                          // arm half-width grows outward
  const env=(A,r)=>sm(A.r0,A.r0+A.fi,r)*(1-sm(A.r1-A.fo,A.r1,r));
  const armTh=(A,L)=>A.ph-WIND*A.w*L+0.12*Math.sin(2.1*L+A.ph*1.3);
  const clumps=(A,L)=>A.cl[clamp(((L+1)*256+0.5)|0,0,1024)];
  const taper=r=>1-sm(0.74,1.0,r);
  // Rotation: the inner disk turns faster than the pattern, the rim nearly with it.
  const omega=r=>WP*(1+1.15*Math.exp(-r/0.24));

  // seeded, so the galaxy is the same on every boot and every still
  function rng(seed){
    let s=seed>>>0;
    return ()=>{ s=(s+0x6D2B79F5)>>>0; let t=Math.imul(s^(s>>>15),s|1);
      t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; };
  }
  const gauss=R=>Math.sqrt(-2*Math.log(R()+1e-12))*Math.cos(TAU*R());
  function hash2(x,y){
    let h=Math.imul(x,374761393)^Math.imul(y,668265263);
    h=Math.imul(h^(h>>>13),1274126177);
    return ((h^(h>>>16))>>>0)/4294967296;
  }
  // value noise; P>0 makes it wrap in x with that period
  function vn(x,y,P){
    const X=Math.floor(x), Y=Math.floor(y);
    let u=x-X, v=y-Y; u=u*u*(3-2*u); v=v*v*(3-2*v);
    const x0=P?((X%P)+P)%P:X, x1=P?(((X+1)%P)+P)%P:X+1;
    const a=hash2(x0,Y), b=hash2(x1,Y), c=hash2(x0,Y+1), d=hash2(x1,Y+1);
    return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
  }
  function rgb(h,s,l){
    s/=100; l/=100;
    const a=s*Math.min(l,1-l);
    const f=n=>{ const k=(n+h/30)%12; return 255*(l-a*Math.max(-1,Math.min(k-3,9-k,1))); };
    return [f(0),f(8),f(4)];
  }
  function mk(w,h){
    if(typeof OffscreenCanvas!=="undefined"){ try{ return new OffscreenCanvas(w,h); }catch(e){} }
    const c=document.createElement("canvas"); c.width=w; c.height=h; return c;
  }
  function freeze(c){
    if(c.transferToImageBitmap){ try{ return c.transferToImageBitmap(); }catch(e){} }
    return c;
  }

  /* Arm light and lane dust at one point of the face-on disk. d is the
     distance across the arm in arm widths; the lane sits on the arm's
     upstream edge, where the gas catching up with the pattern piles up. */
  function field(r, f, o){
    const L=Math.log(Math.max(r,0.02)/RA), s=sig(r);
    let arm=0, lane=0, wing=0;
    for(const A of ARMS){
      const e=env(A,r); if(e<=0) continue;
      const d=wrap(f-armTh(A,L))*r/s, q=(d+0.85)/0.32, c=A.amp*e*clumps(A,L);
      arm+=c*Math.exp(-0.5*d*d);
      wing+=c*Math.exp(-0.08*d*d);
      lane+=A.dust*e*Math.exp(-0.5*q*q);
    }
    o[0]=arm; o[1]=lane; o[2]=wing;
  }
  function pickArm(R){
    let w=0; for(const A of ARMS) w+=A.amp*(A.r1-A.r0);
    let x=R()*w;
    for(const A of ARMS){ x-=A.amp*(A.r1-A.r0); if(x<=0) return A; }
    return ARMS[0];
  }
  // a point on an arm, a little downstream of its crest
  function onArm(R, A, spread, bias){
    let r=0, L=0;
    for(let n=0;n<16;n++){
      r=A.r0+(A.r1-A.r0)*Math.pow(R(),0.9); L=Math.log(r/RA);
      if(R()*1.55<env(A,r)*clumps(A,L)) break;
    }
    const a=armTh(A,L)+(gauss(R)*spread+bias)*sig(r)/r;
    return [r*Math.cos(a), r*Math.sin(a)];
  }
  // star-forming knots along the arms, fixed in the pattern
  function knots(){
    if(ST.knots) return ST.knots;
    const R=rng(9127), K=[];
    while(K.length<220){
      const A=pickArm(R), p=onArm(R, A, 0.45, 0.25), r=Math.hypot(p[0],p[1]);
      if(r<0.16) continue;
      K.push({x:p[0], y:p[1], s:0.004+0.006*R(), w:0.4+R()});
    }
    return (ST.knots=K);
  }

  /* screen offset of a disk point, in disk radii */
  const PX=(x,y)=>x*CPA-y*CI*SPA, PY=(x,y)=>x*SPA+y*CI*CPA;

  function tones(){
    const l=PAL.l, h=PAL.h, s=PAL.s*clamp(1-(l-50)/55,0.3,1);
    return { h, s,
      old:rgb(h,s*0.28,clamp(l+8,78,92)), young:rgb(h,Math.min(85,s*1.5),clamp(l-6,60,76)),
      haze:rgb(h,Math.min(80,s*1.2),clamp(l-10,50,66)), core:rgb(h,s*0.22,clamp(l+4,84,94)),
      bul:rgb(h,s*0.5,clamp(l-4,66,82)), line:clamp(l+8,0,80), text:clamp(l,58,82) };
  }

  /* ---------------- layout: geometry and every star list ---------------- */
  function primary(K, SC){
    const live=SC && SC.screens && SC.screens.length;
    const L=live ? SC.screens : (LAY.screens && LAY.screens.length ? LAY.screens : null);
    const P=L ? (L[live ? SC.primary : (LAY.primary||0)] || L[0]) : null;
    return P || {x:0, y:0, w:K.w, h:K.h};
  }
  /* Size 1 is the largest disk whose reference ellipse and caption still fit
     the primary: HX and HY are the tilted ellipse's half extents per disk
     radius, fp*5 the caption's height below it. At 60 degrees the disk is about
     half as tall as it is wide, so past 1 its ends reach the neighboring
     monitors of a span and the primary crops its top and bottom. */
  const HX=RE*Math.hypot(CPA, CI*SPA), HY=RE*Math.hypot(SPA, CI*CPA);
  function layout(K, P, k, key, size){
    const fp=clamp(Math.min(P.w,P.h)*0.0078,9,17);
    const fit=Math.max(40, Math.min((P.w*0.46)/HX, (P.h*0.45-fp*5)/HY));
    const R=fit*size;
    const G={ key, k, P, R, cx:P.x+P.w/2, cy:P.y+P.h*0.5, dx:P.w*0.005, dy:P.h*0.006,
              u:clamp(Math.min(P.w,P.h)/2160,0.45,1.5), af:clamp((R/1188)*(R/1188),0.1,3), gen:-1 };
    // the texture is capped: past this a big disk only gets a little softer
    G.Rt=Math.max(64, Math.min(2048, Math.round(R*k*TEXS)));
    G.tn=2*Math.ceil(G.Rt*1.03)+4; G.tc=G.tn/2;
    const px=1/k;

    // the distant field: very sparse, still, faint
    let r=rng(31337);
    const nb=Math.round(K.w*K.h/24000);
    G.bg=[[],[],[],[],[]];
    for(let i=0;i<nb;i++){
      const q=Math.pow(r(),3), b=Math.min(4,(q*5)|0);
      G.bg[b].push(r()*K.w, r()*K.h, Math.max(px, q>0.9 ? 1.6 : 1));
    }
    G.bg=G.bg.map(a=>Float32Array.from(a));
    // a few far galaxies, tiny and dim, kept off the main disk
    G.far=[];
    const nf=Math.max(2, Math.round(K.w*K.h/1.4e6));
    for(let i=0;i<nf*6 && G.far.length<nf;i++){
      const x=r()*K.w, y=r()*K.h, ex=(x-G.cx)/R, ey=(y-G.cy)/(R*0.6);
      if(ex*ex+ey*ey<1.9) continue;
      const a=(3+7*r()*r())*G.u;
      G.far.push(x, y, a, a*(0.25+0.6*r()), r()*Math.PI, 0.10+0.14*r());
    }
    // halo: a round, thin cloud of old stars around the whole galaxy
    G.halo=[[],[],[],[]];
    const nh=Math.round(340*G.af);
    for(let i=0;i<nh;i++){
      const rho=Math.pow(Math.pow(0.15,-0.2)+r()*(Math.pow(1.3,-0.2)-Math.pow(0.15,-0.2)),-5);
      const a=r()*TAU, u=rho*Math.cos(a), v=rho*Math.sin(a)*0.84;
      const f=(0.35+0.65*Math.pow(r(),2))*(1-sm(0.9,1.3,rho));
      if(f<0.06) continue;
      G.halo[Math.min(3,(f*4)|0)].push(R*(u*CPA-v*SPA), R*(u*SPA+v*CPA), px);
    }
    G.halo=G.halo.map(a=>Float32Array.from(a));

    // resolved disk stars: an old, even population that only orbits
    r=rng(777);
    const no=Math.round(1400*G.af), O=G.old={ n:no, r:new Float32Array(no), p:new Float64Array(no),
      om:new Float32Array(no), m:new Float32Array(no), zx:new Float32Array(no), zy:new Float32Array(no), sz:new Float32Array(no) };
    for(let i=0;i<no;i++){
      let rr=0; do{ rr=-0.27*Math.log(r()*r()+1e-9); }while(rr>0.98 || rr<0.03);
      const z=gauss(r)*0.010, u=r();
      O.r[i]=rr; O.p[i]=r()*TAU; O.om[i]=omega(rr);
      O.m[i]=(0.16+0.62*Math.pow(u,4))*taper(rr);
      O.zx[i]=z*SI*SPA*R; O.zy[i]=-z*SI*CPA*R;
      O.sz[i]=px*(u>0.93 ? 1.5 : 1);
    }
    // and young ones, born in the arms, that drift downstream and fade
    const ny=Math.round(650*G.af);
    G.yng={ n:ny, r:new Float32Array(ny), p:new Float64Array(ny), om:new Float32Array(ny),
      tb:new Float64Array(ny), L:new Float32Array(ny), m:new Float32Array(ny),
      zx:new Float32Array(ny), zy:new Float32Array(ny), sz:new Float32Array(ny) };
    ST.ydirty=true;
    const n=no+ny;
    G.buf={ x:new Float32Array(n), y:new Float32Array(n), s:new Float32Array(n), k:new Uint8Array(n),
            o:new Int32Array(n), cnt:new Int32Array(2*LEV+1), at:new Int32Array(2*LEV) };
    return G;
  }
  function spawnYoung(G, i, t, R, anyAge){
    const Y=G.yng, KN=knots();
    let x, y;
    if(R()<0.45){ const kn=KN[(R()*KN.length)|0]; x=kn.x+gauss(R)*kn.s*1.8; y=kn.y+gauss(R)*kn.s*1.8; }
    else { const p=onArm(R, pickArm(R), 0.6, 0.35); x=p[0]; y=p[1]; }
    const rr=Math.hypot(x,y), a=Math.atan2(y,x), om=omega(rr), L=45+95*R();
    const tb=t-(anyAge ? R()*L : 0), u=R(), z=gauss(R)*0.006;
    Y.r[i]=rr; Y.om[i]=om; Y.tb[i]=tb; Y.L[i]=L;
    Y.p[i]=a+WP*tb-om*tb;                 // on the arm as the pattern stood at birth
    Y.m[i]=0.28+0.72*Math.pow(u,3);
    Y.sz[i]=(u>0.9 ? 1.6 : 1)/G.k;
    Y.zx[i]=z*SI*SPA*G.R; Y.zy[i]=-z*SI*CPA*G.R;
  }

  /* ---------------- baking ---------------- */
  function splat(S, N, M, x, y, v){
    const fx=x-0.5, fy=y-0.5, i=Math.floor(fx), j=Math.floor(fy);
    if(i<0 || j<0 || i+1>=N || j+1>=M) return;
    const tx=fx-i, ty=fy-j, p=j*N+i;
    S[p]+=v*(1-tx)*(1-ty); S[p+1]+=v*tx*(1-ty); S[p+N]+=v*(1-tx)*ty; S[p+N+1]+=v*tx*ty;
  }
  // Soft shoulder instead of a hard clip: linear up to 0.5, then easing to 1.
  const knee=a=>a<0.5 ? a : 1-0.25/a;

  /* The face-on disk. Arm light and dust are smooth, so they are evaluated
     on a grid F texels apart and interpolated; only the stars are placed at
     full resolution. None of it depends on the palette, so it is kept, and a
     color change only reruns paintDisk. The dust grid also serves the moving
     stars. */
  function densDisk(G){
    const Rt=G.Rt, N=G.tn, c=G.tc, F=4, NC=Math.ceil(N/F)+2;
    const Hc=new Float32Array(NC*NC), Ec=new Float32Array(NC*NC).fill(1), o=[0,0,0];
    for(let j=0;j<NC;j++){
      const y=(j*F+0.5-c)/Rt;
      for(let i=0;i<NC;i++){
        const x=(i*F+0.5-c)/Rt, r=Math.hypot(x,y);
        if(r>1.06) continue;
        const f=Math.atan2(y,x), tp=taper(r);
        field(r,f,o);
        Hc[j*NC+i]=(0.34*Math.exp(-r/0.10)+0.30*Math.exp(-r/0.2)+0.07*Math.exp(-r/0.45)
                   +(0.75*o[0]+0.22*o[2])*Math.exp(-r/0.55))*tp;
        // lanes broken into clumps, feathered spurs across the arms, a thin even layer
        const cl=0.3+1.2*(0.62*vn(x*6.5+3.1,y*6.5+1.7,0)+0.38*vn(x*14+9.3,y*14+4.4,0));
        const Lr=Math.log(Math.max(r,0.02));
        const sp=1-Math.abs(2*vn((f+1.3*Lr)*(40/TAU), Lr*3.4, 40)-1);
        const spur=Math.pow(sp,8)*sm(0.16,0.3,r)*(1-sm(0.7,0.95,r));
        Ec[j*NC+i]=Math.exp(-(2.0*o[1]*cl+0.9*spur*(0.25+o[0])+0.15*Math.exp(-r/0.35))*tp);
      }
    }
    // HII glow over each knot
    const KN=knots();
    for(const kn of KN){
      const sc=kn.s*1.9*Rt/F, gx=(kn.x*Rt+c-0.5)/F, gy=(kn.y*Rt+c-0.5)/F, a=0.17*kn.w;
      const e=Math.ceil(sc*3);
      for(let j=Math.max(0,Math.floor(gy-e)); j<=Math.min(NC-1,Math.ceil(gy+e)); j++)
        for(let i=Math.max(0,Math.floor(gx-e)); i<=Math.min(NC-1,Math.ceil(gx+e)); i++){
          const dx=(i-gx)/sc, dy=(j-gy)/sc;
          Hc[j*NC+i]+=a*Math.exp(-0.5*(dx*dx+dy*dy));
        }
    }

    const So=new Float32Array(N*N), Sy=new Float32Array(N*N), R=rng(4242);
    const ta=(Rt/855)*(Rt/855), toT=(x)=>x*Rt+c;
    // old stars: an exponential disk, a little denser along the arms
    const no=Math.round(70000*ta);
    for(let n=0;n<no;n++){
      let r=0; do{ r=-0.25*Math.log(R()*R()+1e-9); }while(r>1.02);
      const f=R()*TAU; field(r,f,o);
      if(R()>(0.45+0.55*Math.min(1,o[0]))*taper(r)) continue;
      splat(So, N, N, toT(r*Math.cos(f)), toT(r*Math.sin(f)), 0.05+0.40*Math.pow(R(),5));
    }
    // young stars: the arms themselves, and tight clusters in the knots
    const ny=Math.round(60000*ta);
    for(let n=0;n<ny;n++){
      const p=onArm(R, pickArm(R), R()<0.4 ? 0.4 : 1.05, 0.2);
      splat(Sy, N, N, toT(p[0]), toT(p[1]), 0.06+0.55*Math.pow(R(),6));
    }
    for(const kn of KN){
      const m=Math.round((22+40*kn.w)*Math.min(1,ta*1.5+0.3));
      for(let n=0;n<m;n++)
        splat(Sy, N, N, toT(kn.x+gauss(R)*kn.s), toT(kn.y+gauss(R)*kn.s), 0.08+0.5*Math.pow(R(),4));
    }

    // stars kept as a total and the young share of it
    const Yf=new Uint8Array(N*N);
    for(let i=0;i<N*N;i++){ const t=So[i]+Sy[i]; if(t>0){ Yf[i]=Math.round(Sy[i]/t*255); So[i]=t; } }
    for(let q=0;q<Hc.length;q++) Hc[q]*=0.30;
    G.dd={ Hc, Ec, NC, F, St:So, Yf };
    G.dust={ Ec, NC, F };
  }
  function paintDisk(G, C){
    const D=G.dd, Hc=D.Hc, Ec=D.Ec, NC=D.NC, F=D.F, St=D.St, Yf=D.Yf;
    const Rt=G.Rt, N=G.tn, c=G.tc;
    const img=new ImageData(N,N), px=img.data;
    const Co=C.old, Cy=C.young, Ch=C.haze;
    for(let j=0;j<N;j++){
      const y=(j+0.5-c)/Rt, fy=j/F, gj=fy|0, ty=fy-gj;
      const xr=Math.sqrt(Math.max(0,1.07-y*y))*Rt;
      const i0=Math.max(0,Math.floor(c-xr)), i1=Math.min(N-1,Math.ceil(c+xr));
      for(let i=i0;i<=i1;i++){
        const fx=i/F, gi=fx|0, tx=fx-gi, q=gj*NC+gi;
        const h0=Hc[q]+(Hc[q+1]-Hc[q])*tx, h1=Hc[q+NC]+(Hc[q+NC+1]-Hc[q+NC])*tx;
        const h=h0+(h1-h0)*ty;
        const s=j*N+i, st=St[s], yf=Yf[s]/255, so=st*(1-yf), sy=st*yf, tot=st+h;
        if(tot<0.0008) continue;
        const e0=Ec[q]+(Ec[q+1]-Ec[q])*tx, e1=Ec[q+NC]+(Ec[q+NC+1]-Ec[q+NC])*tx;
        const a=knee(tot*(e0+(e1-e0)*ty)), w=1/tot, p=s*4;
        px[p]  =(Co[0]*so+Cy[0]*sy+Ch[0]*h)*w;
        px[p+1]=(Co[1]*so+Cy[1]*sy+Ch[1]*h)*w;
        px[p+2]=(Co[2]*so+Cy[2]*sy+Ch[2]*h)*w;
        px[p+3]=a*255+hash2(i,j);          // dithered, so the faint glow does not band
      }
    }
    const cv=mk(N,N); cv.getContext("2d").putImageData(img,0,0);
    G.disk=freeze(cv);
  }

  /* The bulge, in screen space: a steep glow, fine grain, a tiny nucleus,
     and the near half of the inner disk's dust crossing in front of it. */
  function densBulge(G){
    const Rd=G.R*G.k, a=0.34*Rd, b=a*QB;
    const hw=Math.ceil(Math.hypot(a*CPA,b*SPA))+2, hh=Math.ceil(Math.hypot(a*SPA,b*CPA))+2;
    const W=hw*2, H=hh*2, S=new Float32Array(W*H), R=rng(5151);
    const n=Math.round(2600*G.af);
    for(let i=0;i<n;i++){
      const rho=Math.min(0.3,-0.05*Math.log(R()*R()+1e-9)), t=R()*TAU;
      const u=rho*Math.cos(t), v=rho*Math.sin(t)*QB;
      splat(S, W, H, (u*CPA-v*SPA)*Rd+hw, (u*SPA+v*CPA)*Rd+hh, 0.03+0.22*Math.pow(R(),4));
    }
    const ns=1.5*G.k, M=new Uint8Array(W*H);
    for(let j=0;j<H;j++) for(let i=0;i<W;i++){
      const X=i+0.5-hw, Y=j+0.5-hh;
      const u=(X*CPA+Y*SPA)/Rd, v=(-X*SPA+Y*CPA)/Rd, rho=Math.hypot(u,v/QB);
      if(rho>0.34){ S[j*W+i]=0; continue; }
      let I=0.62*(0.40*Math.exp(-rho/0.022)+0.34*Math.exp(-rho/0.075)+0.10*Math.exp(-(rho/0.17)*(rho/0.17)))
            *(1-sm(0.22,0.34,rho))
           +0.14*Math.exp(-(X*X+Y*Y)/(ns*ns))+S[j*W+i];
      if(v>0){
        const y=v/CI, rd=Math.hypot(u,y), w=Math.pow(y/Math.max(rd,1e-6),1.3);
        const d1=(rd-0.15)/0.016, d2=(rd-0.225)/0.02;
        I*=Math.exp(-w*(1.25*Math.exp(-0.5*d1*d1)+0.45*Math.exp(-0.5*d2*d2)+0.3*sm(0.04,0.14,rd)));
      }
      S[j*W+i]=I; M[j*W+i]=Math.round(sm(0,0.18,rho)*255);
    }
    G.db={ W, H, I:S, M };
    G.bw=W/G.k; G.bh=H/G.k;
  }
  function paintBulge(G, C){
    const D=G.db, W=D.W, H=D.H, S=D.I, M=D.M, Cc=C.core, Cb=C.bul;
    const img=new ImageData(W,H), px=img.data;
    for(let j=0;j<H;j++) for(let i=0;i<W;i++){
      const q=j*W+i, I=S[q]; if(I<=0) continue;
      const m=M[q]/255, p=q*4;
      px[p]=Cc[0]+(Cb[0]-Cc[0])*m; px[p+1]=Cc[1]+(Cb[1]-Cc[1])*m; px[p+2]=Cc[2]+(Cb[2]-Cc[2])*m;
      px[p+3]=knee(I)*255+hash2(i+7,j);
    }
    const cv=mk(W,H); cv.getContext("2d").putImageData(img,0,0);
    G.bulge=freeze(cv);
  }

  /* The HUD layer: a reference ellipse just outside the disk, solid on the
     near half and dotted on the far one, a 10 degree tick scale, and a tiny
     caption. It fades out toward the ends of the major axis, where the
     corner panels are. */
  function bakeOverlay(G, C, ctx){
    const R=G.R, A=RE*R, ov={};
    const arc=(a0,a1)=>{ const p=new Path2D();
      for(let d=a0;d<=a1;d++){ const t=d*D2R, x=RE*Math.cos(t), y=RE*Math.sin(t);
        if(d===a0) p.moveTo(PX(x,y)*R, PY(x,y)*R); else p.lineTo(PX(x,y)*R, PY(x,y)*R); }
      return p; };
    ov.near=arc(0,180); ov.far=arc(180,360);
    ov.ticks=new Path2D();
    for(let d=0;d<360;d+=10){
      const t=d*D2R, c=Math.cos(t), s=Math.sin(t), l=RE+(d%30 ? 0.016 : 0.03);
      ov.ticks.moveTo(PX(RE*c,RE*s)*R, PY(RE*c,RE*s)*R);
      ov.ticks.lineTo(PX(l*c,l*s)*R, PY(l*c,l*s)*R);
    }
    const g=ctx.createLinearGradient(-A*CPA,-A*SPA,A*CPA,A*SPA);
    [[0,0],[0.1,0],[0.32,0.16],[0.68,0.16],[0.9,0],[1,0]].forEach(([o,a])=>g.addColorStop(o,hslStr(C.h,C.s,C.line,a)));
    ov.grad=g;
    ov.dash=[2/G.k, 7/G.k];
    ov.mark=hslStr(C.h,C.s,C.line,0.6);
    ov.read=hslStr(C.h,clamp(C.s*0.7,0,100),C.text,0.5);
    // caption under the near side, baked once
    let fam="monospace";
    try{ const cs=getComputedStyle(document.body); fam=cs.getPropertyValue("--bl-font").trim()||cs.fontFamily||fam; }catch(e){}
    const fp=clamp(Math.min(G.P.w,G.P.h)*0.0078,9,17), dp=fp*G.k;
    ov.font=`500 ${fp}px ${fam}`; ov.fs=fp;
    const lines=["SPIRAL DISK  //  SA(s)bc", "INC 60.0"+DEG+"   PA 13.0"+DEG+"   PATTERN 18 MIN"];
    const cv=mk(4,4); let x=cv.getContext("2d");
    const setF=q=>{ q.font=`500 ${dp}px ${fam}`; try{ q.letterSpacing=(dp*0.22).toFixed(1)+"px"; }catch(e){} };
    setF(x);
    const lw=Math.ceil(Math.max(...lines.map(s=>x.measureText(s).width)))+8, lh=Math.ceil(dp*1.6);
    cv.width=lw; cv.height=lh*2+4; x=cv.getContext("2d"); setF(x);
    x.textAlign="center"; x.textBaseline="middle";
    x.fillStyle=hslStr(C.h,clamp(C.s*0.7,0,100),C.text,0.42); x.fillText(lines[0], lw/2, lh*0.5+2);
    x.fillStyle=hslStr(C.h,clamp(C.s*0.7,0,100),C.text,0.28); x.fillText(lines[1], lw/2, lh*1.5+2);
    ov.label=freeze(cv); ov.lw=lw/G.k; ov.lh=(lh*2+4)/G.k;
    // centered under the disk center, clear of the ellipse across its width.
    // The minor axis's end sits left of center because of the tilt.
    const bx=PX(0,0)*R;
    let by=PY(0,RE)*R, bi=Infinity;
    for(let d=0;d<360;d+=2){
      const t=d*D2R, x=PX(RE*Math.cos(t),RE*Math.sin(t))*R, y=PY(RE*Math.cos(t),RE*Math.sin(t))*R;
      if(Math.abs(x-bx)<ov.lw/2+fp && y>0){ by=Math.max(by,y); bi=Math.min(bi,y); }
    }
    // Past size 1 there is no room under the ellipse on the primary, so the
    // caption moves just inside it, and once the ellipse leaves the screen it
    // stays on the primary's bottom edge.
    const lim=G.P.h*0.46, below=by+fp*1.6;
    ov.lx=bx-ov.lw/2;
    ov.ly=below+ov.lh<=lim ? below : Math.min(bi-fp*1.2-ov.lh, lim-ov.lh);
    G.ov=ov;
  }

  function bake(G, ctx){
    const C=tones();
    G.gen=PAL.gen;
    // ~170 ms once per size at 4K; a palette change only repaints, ~50 ms
    if(!G.dd){ densDisk(G); densBulge(G); }
    paintDisk(G, C);
    paintBulge(G, C);
    bakeOverlay(G, C, ctx);
    const sl=clamp(PAL.l+25,0,92), ss=clamp(C.s*0.45,0,100);
    G.bgSty=[0.12,0.2,0.3,0.42,0.6].map(a=>hslStr(C.h,ss,sl,a));
    G.haloSty=[0.10,0.17,0.25,0.34].map(a=>hslStr(C.h,ss,sl,a));
    const oS=`hsl(${C.h} ${(C.s*0.28).toFixed(1)}% ${clamp(PAL.l+8,78,92)}% / `;
    const yS=`hsl(${C.h} ${Math.min(85,C.s*1.5).toFixed(1)}% ${clamp(PAL.l,70,86)}% / `;
    G.sty=[];
    for(let b=0;b<LEV;b++) G.sty.push(oS+((b+1)/LEV*0.8).toFixed(3)+")");
    for(let b=0;b<LEV;b++) G.sty.push(yS+((b+1)/LEV*0.95).toFixed(3)+")");
    const fg=ctx.createRadialGradient(0,0,0,0,0,1);
    fg.addColorStop(0, hslStr(C.h,ss,sl,0.9)); fg.addColorStop(0.35, hslStr(C.h,ss,sl,0.3));
    fg.addColorStop(1, hslStr(C.h,ss,sl,0));
    G.farG=fg;
  }

  function ensure(K, SC){
    const P=primary(K, SC), k=K.ctx.canvas.width/Math.max(1,K.w);
    const size=clamp(+CFG.galaxySize||1, 0.3, 3);
    const key=[K.w,K.h,k.toFixed(4),P.x,P.y,P.w,P.h,size].join(",");
    if(!ST.G || ST.G.key!==key) ST.G=layout(K, P, k, key, size);
    if(ST.G.gen!==PAL.gen) bake(ST.G, K.ctx);
    return ST.G;
  }

  /* ---------------- per redraw ---------------- */
  function rects(ctx, a, ox, oy){
    for(let i=0;i<a.length;i+=3) ctx.fillRect(a[i]+ox, a[i+1]+oy, a[i+2], a[i+2]);
  }
  function backdrop(ctx, G){
    for(let b=0;b<G.bg.length;b++){ if(!G.bg[b].length) continue; ctx.fillStyle=G.bgSty[b]; rects(ctx, G.bg[b], 0, 0); }
    const F=G.far; ctx.fillStyle=G.farG;
    for(let i=0;i<F.length;i+=6){
      ctx.globalAlpha=F[i+5];
      ctx.save(); ctx.translate(F[i],F[i+1]); ctx.rotate(F[i+4]); ctx.scale(F[i+2],F[i+3]);
      ctx.fillRect(-1,-1,2,2); ctx.restore();
    }
    ctx.globalAlpha=1;
  }

  /* The resolved stars: positions from each star's own orbit, brightness
     from its magnitude, its age (young ones) and the dust it is behind,
     looked up in the pattern's frame. Counting-sorted into alpha buckets so
     every bucket is one fillStyle. */
  function stars(ctx, G, cx, cy, t, psi, still, R){
    const B=G.buf, BX=B.x, BY=B.y, BS=B.s, BK=B.k, cnt=B.cnt;
    const D=G.dust, Ec=D.Ec, NC=D.NC, sF=G.Rt/D.F, oF=(G.tc-0.5)/D.F;
    const cp=Math.cos(psi), sp=Math.sin(psi), RR=G.R;
    cnt.fill(0);
    let nv=0;
    const put=(r, ph, zx, zy, m, sz, cls)=>{
      const x=r*Math.cos(ph), y=r*Math.sin(ph);
      const gi=((x*cp+y*sp)*sF+oF+0.5)|0, gj=((y*cp-x*sp)*sF+oF+0.5)|0;
      const e=(gi>=0 && gj>=0 && gi<NC && gj<NC) ? Ec[gj*NC+gi] : 1;
      const v=m*e; if(v<0.04) return;
      const b=cls*LEV+Math.min(LEV-1,(v*LEV)|0);
      BX[nv]=cx+RR*(x*CPA-y*CI*SPA)+zx-sz*0.5; BY[nv]=cy+RR*(x*SPA+y*CI*CPA)+zy-sz*0.5;
      BS[nv]=sz; BK[nv]=b; cnt[b+1]++; nv++;
    };
    const O=G.old;
    for(let i=0;i<O.n;i++) put(O.r[i], O.p[i]+O.om[i]*t, O.zx[i], O.zy[i], O.m[i], O.sz[i], 0);
    const Y=G.yng;
    for(let i=0;i<Y.n;i++){
      let age=t-Y.tb[i];
      if(age>Y.L[i] || age<0){ spawnYoung(G, i, t, R, still); age=t-Y.tb[i]; }
      const f=sm(0,7,age)*(1-sm(Y.L[i]-9,Y.L[i],age));
      put(Y.r[i], Y.p[i]+Y.om[i]*t, Y.zx[i], Y.zy[i], Y.m[i]*f, Y.sz[i], 1);
    }
    const Ob=B.o, at=B.at;
    for(let b=1;b<=2*LEV;b++) cnt[b]+=cnt[b-1];
    at.set(cnt.subarray(0,2*LEV));
    for(let i=0;i<nv;i++) Ob[at[BK[i]]++]=i;
    for(let b=0;b<2*LEV;b++){
      let m=cnt[b]; const e=cnt[b+1]; if(m===e) continue;
      ctx.fillStyle=G.sty[b];
      for(;m<e;m++){ const i=Ob[m]; ctx.fillRect(BX[i],BY[i],BS[i],BS[i]); }
    }
  }

  function overlay(ctx, G, cx, cy, psi){
    const O=G.ov, R=G.R, u=G.u;
    ctx.save(); ctx.translate(cx,cy);
    ctx.lineWidth=1/G.k; ctx.strokeStyle=O.grad;
    ctx.stroke(O.near); ctx.stroke(O.ticks);
    ctx.setLineDash(O.dash); ctx.stroke(O.far); ctx.setLineDash([]);
    // a caret riding the ellipse with the pattern, and its phase readout
    const am=psi+0.4, ca=Math.cos(am), sa=Math.sin(am);
    const f=1-sm(0.42,0.82,Math.abs(ca));
    if(f>0.02){
      const X=PX(RE*ca,RE*sa)*R, Y=PY(RE*ca,RE*sa)*R, l=Math.hypot(X,Y)||1, dx=-X/l, dy=-Y/l;
      ctx.globalAlpha=f;
      ctx.fillStyle=O.mark;
      ctx.beginPath();
      ctx.moveTo(X+dx*u, Y+dy*u);
      ctx.lineTo(X-dx*8*u-dy*4*u, Y-dy*8*u+dx*4*u);
      ctx.lineTo(X-dx*8*u+dy*4*u, Y-dy*8*u-dx*4*u);
      ctx.closePath(); ctx.fill();
      let deg=(am/D2R)%360; if(deg<0) deg+=360;
      ctx.font=O.font; ctx.textAlign="center"; ctx.textBaseline="middle";
      try{ ctx.letterSpacing=(O.fs*0.18).toFixed(1)+"px"; }catch(e){}
      ctx.fillStyle=O.read;
      ctx.globalAlpha=f*(Y<0 ? 1 : sm(O.lw*0.55, O.lw*0.85, Math.abs(X-O.lx-O.lw/2)));
      ctx.fillText("ROT "+deg.toFixed(1)+DEG, X-dx*(14*u+O.fs*1.4), Y-dy*(14*u+O.fs*1.4));
      try{ ctx.letterSpacing="0px"; }catch(e){}
      ctx.globalAlpha=1;
    }
    ctx.restore();
    ctx.drawImage(O.label, cx+O.lx, cy+O.ly, O.lw, O.lh);
  }

  function render(K, SC, t, breath, still){
    const G=ensure(K, SC), ctx=K.ctx;
    ctx.clearRect(0,0,K.w,K.h);
    backdrop(ctx, G);
    if(!CFG.terrain) return;
    // The whole galaxy wanders a few pixels over minutes, so even the core
    // never holds one spot on an OLED panel.
    const cx=G.cx+G.dx*Math.sin(t*TAU/523+0.7), cy=G.cy+G.dy*Math.sin(t*TAU/701+2.1);
    const psi=WP*t;
    for(let b=0;b<G.halo.length;b++){ if(!G.halo[b].length) continue; ctx.fillStyle=G.haloSty[b]; rects(ctx, G.halo[b], cx, cy); }
    ctx.globalAlpha=clamp(0.84+0.2*breath,0,1);
    ctx.drawImage(G.bulge, cx-G.bw/2, cy-G.bh/2, G.bw, G.bh);
    ctx.globalAlpha=1;
    ctx.save();
    ctx.translate(cx,cy); ctx.rotate(PA); ctx.scale(1,CI); ctx.rotate(psi);
    const s=G.R/G.Rt; ctx.scale(s,s);
    ctx.drawImage(G.disk, -G.tc, -G.tc);
    ctx.restore();
    let R=Math.random;
    if(still || ST.ydirty){
      // a still is the same composition every time; live starts with every age
      R=still ? rng(0x51A7) : Math.random;
      for(let i=0;i<G.yng.n;i++) spawnYoung(G, i, t, R, true);
      ST.ydirty=still;
    }
    stars(ctx, G, cx, cy, t, psi, still, R);
    overlay(ctx, G, cx, cy, psi);
  }

  return {
    label:"Galaxy", band:0.05,
    init(T){ T.gxClean=false; },
    frame(dt, S){
      ST.acc+=dt;
      ST.redraw=ST.acc>=REDRAW_MS;
      if(ST.redraw) ST.acc=0;
      // swell quickly on a kick, settle slowly: a breath, not a flicker
      const k=Math.min(1,(S.energy>ST.e?0.08:0.025)*dt/16);
      ST.e+=(S.energy-ST.e)*k;
      ST.breath=clamp(ST.e*1.4,0,1);
    },
    // the band is not used: keep it empty
    draw(T){ if(!T.gxClean){ T.ctx.clearRect(0,0,T.w,T.h); T.gxClean=true; } },
    sky(K, S){ if(ST.redraw || !ST.G) render(K, S, T0+S.t, ST.breath, false); },
    still(T){ T.ctx.clearRect(0,0,T.w,T.h); T.gxClean=true; },
    stillSky(K, S){ render(K, S, STILL_T, 0.3, true); }
  };
})();
SCENES.galaxy=GALAXY;
