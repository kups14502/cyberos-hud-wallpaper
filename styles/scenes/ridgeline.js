/* ---- Ridgeline: a slow flyover of the game-mode mountains ----
   The world is a fixed heightfield and the camera glides forward over it, so
   each ridge is sampled once, cached, and only re-projected per frame. Rows sit
   at fixed world depths. The valley runs straight down world x = 0, which
   projects to T.cx: the eye always has a path to the pass and the glow behind
   it.
   Hidden lines go the other way round from drawMountainsOne: rows are walked
   near to far against a floating horizon (the highest point drawn so far at
   each x), and only what clears it is kept. The canvas rasterizes a concave
   fill as a mask the size of its bounding box, so a fill per row, as the
   game-mode mountains do once, costs a full-band mask 80 times a frame; here
   the whole range is one fill under its own silhouette, and every line of
   one light tier and brightness goes into one stroke. A row enters at the
   far plane at zero alpha and rises out of the haze as it nears, and leaves
   through the foreground fade, so nothing pops. */
SCENES.ridgeline=(function(){
  "use strict";
  const SP=0.6;          // world depth between rows
  const DX=0.3;          // world width between columns
  const CAM_Y=1.7;       // camera altitude; the valley floor sits near 0
  const Z_FAR=50;        // far plane: rows are born here at zero alpha
  const FADE_FAR=12;     // depth over which a new row fades in
  const Z_MIN=0.8;       // nothing nearer than this is ever on screen
  const HORIZON=0.42;    // horizon as a share of the design height
  const SPEED=0.85;      // world units per second
  const STILL_Z=12;      // game mode's view: a narrow pass under tall walls
  const RES=3;           // px between floating-horizon samples
  const EPS=0.75;        // px a line may sit under the horizon and still show
  const HAZE_A=0.55;     // how much of the sky a far ridge hides while it fades in
  const ODD_IN=22, ODD_OUT=32;   // depths over which every other slope line fades out
  const RING=Math.ceil((Z_FAR-Z_MIN)/SP)+6;
  // three light tiers by altitude (valley floor, slopes, crests), as alpha
  // multipliers, so the peaks carry the light and the floor stays quiet.
  // band3 takes the sum of two heights, the mean of a segment's ends x 2.
  const RIDGE_A=[0.42, 0.80, 1.20], SLOPE_A=[0.19, 0.36, 0.50];
  const band3=(h2)=> h2<0.32 ? 0 : h2<0.84 ? 1 : 2;
  // a row's brightness is quantized so rows share strokes: level l means
  // alpha (l/LQ)^2, fine steps near zero where a far row is fading in
  const LQ=40, LV=46, LA=new Float32Array(LV);
  for(let l=0;l<LV;l++) LA[l]=(l/LQ)*(l/LQ);
  const level=(a)=>{ const l=Math.round(Math.sqrt(a)*LQ); return l<LV? l : LV-1; };

  // the flight starts from game mode's composed view
  const S={ camZ:STILL_Z, e:0, cmax:0, ring:[], ringK:[] };

  /* ---- deterministic gradient noise, so the range is the same every boot ---- */
  const PERM=new Uint8Array(512);
  { let s=90210; const p=[]; for(let i=0;i<256;i++) p.push(i);
    for(let i=255;i>0;i--){ s=(s*1103515245+12345)>>>0; const j=(s>>>8)%(i+1); const t=p[i]; p[i]=p[j]; p[j]=t; }
    for(let i=0;i<512;i++) PERM[i]=p[i&255]; }
  const GX=[1,-1,1,-1,1.41,-1.41,0,0], GY=[1,1,-1,-1,0,0,1.41,-1.41];
  function noise(x,y){
    const xi=Math.floor(x), yi=Math.floor(y), xf=x-xi, yf=y-yi, X=xi&255, Y=yi&255;
    const u=xf*xf*xf*(xf*(xf*6-15)+10), v=yf*yf*yf*(yf*(yf*6-15)+10);
    const a=PERM[X]+Y, b=PERM[X+1]+Y;
    const h00=PERM[a]&7, h10=PERM[b]&7, h01=PERM[a+1]&7, h11=PERM[b+1]&7;
    const n00=GX[h00]*xf+GY[h00]*yf,     n10=GX[h10]*(xf-1)+GY[h10]*yf;
    const n01=GX[h01]*xf+GY[h01]*(yf-1), n11=GX[h11]*(xf-1)+GY[h11]*(yf-1);
    const nx0=n00+(n10-n00)*u, nx1=n01+(n11-n01)*u;
    return nx0+(nx1-nx0)*v;
  }
  // ridged multifractal: sharp crests, detail only where the rock is already high
  function ridged(x,y){
    let sum=0, a=0.5, f=1, w=1, norm=0;
    for(let o=0;o<4;o++){
      let n=1-Math.abs(noise(x*f+o*17.3, y*f-o*9.1)); n*=n; n*=w; w=Math.min(1,n*1.8);
      sum+=n*a; norm+=a; a*=0.5; f*=2.03;
    }
    return sum/norm;
  }
  const sstep=(e0,e1,x)=>{ const t=clamp((x-e0)/(e1-e0),0,1); return t*t*(3-2*t); };

  /* Height at a world point, 0..1 before the per-row amplitude. The valley
     narrows into passes and opens into basins as you fly, but never leaves
     x = 0, so the path stays on the primary monitor's center line. */
  function height(x,z){
    const half=1.8+0.75*Math.sin(z*0.057+0.7)+0.4*Math.sin(z*0.131+2.1);
    const q=Math.abs(x);
    const wall=sstep(half, half+4.5, q);
    const r=ridged(x*0.12, z*0.12);
    // a slow second field groups the peaks into massifs with saddles between,
    // so the skyline rises and falls instead of reading as one row of teeth
    const massif=0.55+0.45*sstep(-0.45, 0.45, noise(x*0.045+11.3, z*0.045-4.2));
    const rock=wall*massif*(0.12+0.88*Math.pow(r,1.35));
    const floor=0.035*(1+noise(x*0.42+5.1, z*0.42));
    return Math.min(1, rock+floor*(1-wall*0.6));
  }
  // one cached row of heights per world depth index k
  function rowHeights(k){
    const i=((k%RING)+RING)%RING;
    if(S.ringK[i]!==k){
      const h=S.ring[i], z=k*SP, n=S.cmax;
      for(let c=-n;c<=n;c++) h[c+n]=height(c*DX, z);
      S.ringK[i]=k;
    }
    return S.ring[i];
  }
  function ensureCols(n){
    if(n<=S.cmax) return;
    S.cmax=n;
    S.ring=[]; S.ringK=[];
    for(let i=0;i<RING;i++){ S.ring.push(new Float64Array(2*n+1)); S.ringK.push(NaN); }
  }

  /* Visible lines wait here until the stroke pass, one list per light tier
     and brightness level: ridges as polylines split by NaN, slopes as
     segments. Shared by every canvas, since each is painted in one go. */
  const RB=[], RN=new Int32Array(3*LV), SB=[], SN=new Int32Array(3*LV);
  for(let i=0;i<3*LV;i++){ RB.push(new Float32Array(256)); SB.push(new Float32Array(256)); }
  function grow(L, b, need){
    const o=L[b]; if(need<=o.length) return o;
    const a=new Float32Array(Math.max(need, o.length*2)); a.set(o); L[b]=a; return a;
  }
  function rPt(b, x, y){ const k=RN[b], A=grow(RB, b, k+2); A[k]=x; A[k+1]=y; RN[b]=k+2; }
  function rEnd(b){ const k=RN[b], A=grow(RB, b, k+2); A[k]=NaN; A[k+1]=NaN; RN[b]=k+2; }
  function sSeg(b, x0, y0, x1, y1){
    const k=SN[b], A=grow(SB, b, k+4); A[k]=x0; A[k+1]=y0; A[k+2]=x1; A[k+3]=y1; SN[b]=k+4;
  }

  // one row's screen points and visibility, and the row in front of it. Sized
  // to the shared column count, which a wider canvas set up later can raise
  function rowArrays(r){
    const m=2*S.cmax+1; r.n=S.cmax;
    r.ax=new Float32Array(m); r.ay=new Float32Array(m); r.av=new Uint8Array(m);
    r.bx=new Float32Array(m); r.by=new Float32Array(m); r.bv=new Uint8Array(m);
  }

  /* Per-canvas geometry. The vertical framing follows the band as the
     PRIMARY monitor sees it, so a span frames the primary the way a single
     screen would, and the other monitors extend the same world sideways. A
     canvas of its own on another monitor is framed on that monitor. */
  function setup(T){
    const r=T.rl||(T.rl={});
    // LAY, not SC: SC.primary is only refreshed by sceneFrame, so on the first
    // build it still says 0 and would frame the span on the leftmost monitor
    const SS=T.screens||[], holds=(s)=> s && T.cx>=s.x && T.cx<=s.x+s.w;
    let P=SS[LAY.primary||0];
    if(!holds(P)) P=SS.find(holds)||P;
    let hd=T.h, half=T.w/2;
    if(P){ const b=P.y+P.h; if(b>T.h*0.3 && b<T.h-0.5) hd=b; half=P.w/2; }
    r.hd=hd; r.hz=Math.round(hd*HORIZON)+0.5;
    // a portrait monitor would see only the valley floor at this focal
    // length, so cap it to keep a usable field of view
    r.F=Math.min(hd*3.2, half/0.35);
    r.uL=T.cx/r.F; r.uR=(T.w-T.cx)/r.F;
    r.eTop=(r.hz-hd*0.07)/r.F;            // highest angle that stays inside the band
    r.zBot=CAM_Y*r.F/(hd-r.hz);           // flat ground meets the design bottom here
    const n=Math.ceil(Math.max(r.uL,r.uR)*(Z_FAR+2*SP)/DX)+3;
    ensureCols(n);
    rowArrays(r);
    // the floating horizon for hiding lines, and the two silhouettes the
    // ground is filled under: a faint one a new far row joins at once, and
    // the solid one it only rises into as it nears
    r.ns=Math.ceil(T.w/RES)+1;
    r.hh=new Float32Array(r.ns); r.hs=new Float32Array(r.ns); r.hm=new Float32Array(r.ns);
    r.gen=-1;
    buildRange(T, r);
  }

  /* The far range is so distant that flying forward never moves it, so it is
     built once per size as a Path2D in angle space. Its foot sits between the
     horizon and the far plane, standing in for the terrain the rows never
     reach, and it dips at the center so the horizon line shows through the
     end of the valley. */
  function rangeElev(u, seed, notch, amp, base){
    const au=Math.abs(u);
    const n=ridged(u*7.5+seed, seed*0.7);
    const gap=0.25+0.75*sstep(notch*0.2, notch, au);
    return -base+amp*n*gap;
  }
  function buildRange(T, r){
    const step=6/r.F, u0=-r.uL-step, u1=r.uR+step;
    const gapA=CAM_Y/Z_FAR;                    // far plane's floor, as an angle below the horizon
    r.far=[]; r.lowY=r.hz;
    [[3.1, 0.10, 0.034, gapA*0.30], [11.7, 0.22, 0.050, gapA*0.62]].forEach(([seed,notch,amp,base])=>{
      const line=new Path2D(), fill=new Path2D();
      let first=true, lastX=0, firstX=0;
      for(let u=u0; u<=u1+step*0.5; u+=step){
        const x=T.cx+u*r.F, y=r.hz-rangeElev(u,seed,notch,amp,base)*r.F;
        if(first){ line.moveTo(x,y); fill.moveTo(x,y); firstX=x; first=false; }
        else{ line.lineTo(x,y); fill.lineTo(x,y); }
        lastX=x; if(y>r.lowY) r.lowY=y;
      }
      fill.lineTo(lastX, T.h+2); fill.lineTo(firstX, T.h+2); fill.closePath();
      r.far.push({line, fill});
    });
  }

  /* Colors and gradients, rebuilt only when the palette or the size changes. */
  function styles(T, r){
    const ctx=T.ctx, lit=clamp(PAL.l+8,0,80), H=PAL.h, Sa=PAL.s;
    const col=(a)=>hslStr(H, Sa, lit, +a.toFixed(3));
    // lines fall off toward each monitor's side edges, where the panels sit
    const g=ctx.createLinearGradient(0,0,T.w,0);
    const spans=(T.screens||[]).map(s=>[Math.max(0,s.x), Math.min(T.w,s.x+s.w)])
                 .filter(s=>s[1]-s[0]>8).sort((a,b)=>a[0]-b[0]);
    const list=[]; let end=-1;
    spans.forEach(s=>{ if(s[0]>=end-0.5){ list.push(s); end=s[1]; } });
    if(!list.length) list.push([0,T.w]);
    const EDGE=0.42;
    list.forEach(([x0,x1])=>{
      const w=x1-x0;
      [[0,EDGE],[0.2,0.8],[0.36,1],[0.64,1],[0.8,0.8],[1,EDGE]].forEach(([f,a])=>{
        g.addColorStop(clamp((x0+f*w)/T.w,0,1), col(a));
      });
    });
    r.line=g;
    // the glow behind the pass: a unit radial gradient, stretched at draw time
    const gl=ctx.createRadialGradient(0,0,0,0,0,1);
    const gl2=clamp(PAL.l+4,0,78);
    gl.addColorStop(0,    hslStr(H, Sa, gl2, 0.30));
    gl.addColorStop(0.25, hslStr(H, Sa, gl2, 0.15));
    gl.addColorStop(0.6,  hslStr(H, Sa, gl2, 0.04));
    gl.addColorStop(1,    hslStr(H, Sa, gl2, 0));
    r.glow=gl;
    // mist over the far range and the ground past the far plane, so the
    // valley floor dissolves into haze instead of ending at a black edge
    const ms=ctx.createRadialGradient(0,0,0,0,0,1);
    ms.addColorStop(0,    hslStr(H, Sa, gl2, 0.16));
    ms.addColorStop(0.45, hslStr(H, Sa, gl2, 0.07));
    ms.addColorStop(1,    hslStr(H, Sa, gl2, 0));
    r.mist=ms;
    // the horizon line itself, bright at the pass and gone well before the panels
    const hw=(T.w-T.cx>T.cx? T.w-T.cx : T.cx);
    const hg=ctx.createLinearGradient(T.cx-hw,0,T.cx+hw,0);
    const L=clamp(PAL.l+16,0,86), k=(T.w? (r.F*0.55)/hw : 0.5);
    hg.addColorStop(0, hslStr(H, Sa, L, 0));
    hg.addColorStop(clamp(0.5-k*0.5,0,0.5), hslStr(H, Sa, L, 0));
    hg.addColorStop(0.5, hslStr(H, Sa, L, 0.75));
    hg.addColorStop(clamp(0.5+k*0.5,0.5,1), hslStr(H, Sa, L, 0));
    hg.addColorStop(1, hslStr(H, Sa, L, 0));
    r.hzLine=hg;
    r.farLine=col(1);
    // the foreground sinks into the background color toward the bottom edge.
    // The canvas hands back any opaque color as #rrggbb, which gives the
    // channels to build an alpha ramp from, whatever form PAL.bg is in.
    ctx.fillStyle=PAL.bg;
    const hx=String(ctx.fillStyle), ok=/^#[0-9a-f]{6}$/i.test(hx);
    const ch=(i)=> ok? parseInt(hx.slice(i,i+2),16) : 0;
    const bgA=(a)=>`rgba(${ch(1)},${ch(3)},${ch(5)},${a})`;
    r.footY=Math.round(r.hd*0.58);
    const ft=ctx.createLinearGradient(0, r.footY, 0, r.hd*0.985);
    [[0,0],[0.35,0.2],[0.7,0.62],[1,1]].forEach(([f,a])=>ft.addColorStop(f, bgA(a)));
    r.foot=ft;
    r.gen=PAL.gen;
  }

  /* The geometry pass, near to far. Each row's slope lines back to the row
     in front and its ridge line are tested against the horizon of everything
     nearer, the parts that clear it go to the stroke lists, and the ridge then
     raises the horizon. */
  function march(T, r, camZ, e, lowY0){
    if(r.n!==S.cmax) rowArrays(r);
    const F=r.F, cx=T.cx, hz=r.hz, n=S.cmax, NS=r.ns, H=r.hh, HS=r.hs, HM=r.hm, iR=1/RES;
    H.fill(1e6); HS.fill(lowY0); HM.fill(lowY0);
    RN.fill(0); SN.fill(0);
    const kFar=Math.floor((camZ+Z_FAR)/SP);
    const kNear=Math.ceil((camZ+Z_MIN)/SP);
    let ax=r.ax, ay=r.ay, av=r.av, px=r.bx, py=r.by, pv=r.bv;
    let ph=null, pc0=0, pc1=-1, paS=0, podd=1;
    const span=Z_FAR-r.zBot, lift=1+0.22*e;
    for(let k=kNear;k<=kFar;k++){
      const d=k*SP-camZ;
      const h=rowHeights(k);
      // amplitude grows a little with depth, and is capped so the tallest
      // peak this row can hold stays inside the band
      const amp=Math.min(3.0+0.07*d, (CAM_Y+r.eTop*d)*0.94);
      const inv=F/d;
      const c0=Math.max(-n, Math.floor(-r.uL*(d+SP)/DX)-1);
      const c1=Math.min( n, Math.ceil ( r.uR*(d+SP)/DX)+1);
      const aFar=sstep(Z_FAR, Z_FAR-FADE_FAR, d);
      // only the very nearest rows fade by depth, since their facets are
      // coarse; the rest leave through the foreground fade drawn last
      const aNear=sstep(r.zBot*0.45, r.zBot*0.95, d);
      const depth=clamp(1-(d-r.zBot)/span, 0, 1);
      const a=aFar*aNear*(0.32+0.68*depth)*lift;
      // slopes fade in later than crests: rows still in the haze overlap,
      // and their slope lines would stack into a gray hatch
      const aS=a*aFar;
      // far rows are dense on screen, so every other slope line fades out
      // with distance: fewer lines where they would only read as a hatch
      const oddA=sstep(ODD_OUT, ODD_IN, d);

      let minY=1e9;
      for(let c=c0;c<=c1;c++){
        const j=c+n, y=hz+(CAM_Y-h[j]*amp)*inv;
        ax[j]=cx+c*DX*inv; ay[j]=y;
        if(y<minY) minY=y;
      }
      if(minY>r.hd){
        // under the solid foot: nothing here shows, but the next row's
        // slope lines still run down to it
        for(let c=c0;c<=c1;c++) av[c+n]=1;
      }else{
        // slope lines from this row forward to the one in front
        if(ph){
          const lo=Math.max(c0,pc0), hi=Math.min(c1,pc1), split=podd<0.999;
          for(let c=lo;c<=hi;c++){
            const odd=split && (c&1), sa=odd? paS*podd : paS;
            const lv=level(sa); if(!lv) continue;
            const j=c+n, bxj=ax[j], byj=ay[j];
            let ib=Math.round(bxj*iR); if(ib<0) ib=0; else if(ib>=NS) ib=NS-1;
            if(byj>=H[ib]+EPS) continue;            // the far end is behind nearer ground
            const b=band3(h[j]+ph[j])*LV+lv, fx=px[j], fy=py[j], dx=fx-bxj, dy=fy-byj;
            if(dx<-2*RES || dx>2*RES){
              // a long one, out at the sides: nearer ground can rise between
              // its ends, so it is walked unless three points along it clear
              if(pv[j]){
                let clear=true;
                for(let q=0.25;q<0.8 && clear;q+=0.25){
                  let ii=Math.round((bxj+dx*q)*iR); if(ii<0) ii=0; else if(ii>=NS) ii=NS-1;
                  clear= byj+dy*q < H[ii]+EPS;
                }
                if(clear){ sSeg(b, bxj, byj, fx, fy); continue; }
              }
              const st=Math.ceil((dx<0? -dx : dx)*iR);
              let on=true, sx=bxj, sy=byj;
              for(let q=1;q<=st;q++){
                const t=q/st, x=bxj+dx*t, y=byj+dy*t;
                let ii=Math.round(x*iR); if(ii<0) ii=0; else if(ii>=NS) ii=NS-1;
                const v= q===st? pv[j]===1 : y<H[ii]+EPS;
                if(v!==on){
                  const tm=(q-0.5)/st, xm=bxj+dx*tm, ym=byj+dy*tm;
                  if(on) sSeg(b, sx, sy, xm, ym); else{ sx=xm; sy=ym; }
                  on=v;
                }
              }
              if(on) sSeg(b, sx, sy, fx, fy);
              continue;
            }
            if(pv[j]){ sSeg(b, bxj, byj, fx, fy); continue; }
            // the near end is hidden: stop where the line meets the ground in front
            let jf=Math.round(fx*iR); if(jf<0) jf=0; else if(jf>=NS) jf=NS-1;
            if(dy<=0.01) continue;
            let t=(H[jf]-byj)/dy; if(t<=0) continue; if(t>1) t=1;
            sSeg(b, bxj, byj, bxj+dx*t, byj+dy*t);
          }
        }
        // the ridge line, walked sample by sample against the horizon. A row
        // fading in rises out of the ground line into each silhouette, so
        // neither ever gains a whole peak in one frame
        const lvR=a>0.004? level(a) : 0;
        const sol=sstep(Z_FAR-4, Z_FAR-FADE_FAR, d), haze=sol<1, shz=sstep(Z_FAR, Z_FAR-5, d);
        let i=Math.round(ax[c0+n]*iR); if(i<0) i=0; else if(i>=NS) i=NS-1;
        let pd=ay[c0+n]-H[i]-EPS, pxs=ax[c0+n], vis=pd<0, open=-1;
        av[c0+n]=vis?1:0;
        for(let c=c0;c<c1;c++){
          const j=c+n, x0=ax[j], y0=ay[j], x1=ax[j+1], y1=ay[j+1];
          const bk=lvR? band3(h[j]+h[j+1])*LV+lvR : -1;
          if(vis && bk!==open){ if(open>=0) rEnd(open); open=bk; if(bk>=0) rPt(bk, x0, y0); }
          const sl=(y1-y0)/(x1-x0);
          let i0=Math.floor(x0*iR)+1, i1=Math.floor(x1*iR);
          if(i0<0) i0=0; if(i1>=NS) i1=NS-1;
          for(let s=i0;s<=i1;s++){
            const xs=s*RES, ys=y0+(xs-x0)*sl, hv=H[s], dv=ys-hv-EPS;
            if((dv<0)!==vis){
              // it crosses the horizon between the last sample and this one
              let xc=pxs+(xs-pxs)*pd/(pd-dv); if(xc<x0) xc=x0;
              const yc=y0+(xc-x0)*sl;
              if(!vis){ open=bk; if(bk>=0) rPt(bk, xc, yc); }
              else{ if(open>=0){ rPt(open, xc, yc); rEnd(open); } open=-1; }
              vis=!vis;
            }
            if(ys<hv) H[s]=ys;
            const yl=lowY0+(ys-lowY0)*sol;
            if(yl<HS[s]) HS[s]=yl;
            if(haze){ const ym=lowY0+(ys-lowY0)*shz; if(ym<HM[s]) HM[s]=ym; }
            pd=dv; pxs=xs;
          }
          if(vis && open>=0) rPt(open, x1, y1);
          av[j+1]=vis?1:0;
        }
        if(open>=0) rEnd(open);
        // a peak between two samples still has to hide what is behind it
        for(let c=c0;c<=c1;c++){
          const j=c+n; let s=Math.round(ax[j]*iR);
          if(s<0 || s>=NS) continue;
          const y=ay[j]; if(y<H[s]) H[s]=y;
          const yl=lowY0+(y-lowY0)*sol; if(yl<HS[s]) HS[s]=yl;
          if(haze){ const ym=lowY0+(y-lowY0)*shz; if(ym<HM[s]) HM[s]=ym; }
        }
      }
      // swap: this row is the one in front of the next
      let t=px; px=ax; ax=t; t=py; py=ay; ay=t; t=pv; pv=av; av=t;
      ph=h; pc0=c0; pc1=c1; paS=aS; podd=oddA;
    }
    r.ax=ax; r.ay=ay; r.av=av; r.bx=px; r.by=py; r.bv=pv;
  }

  function strokeRidges(ctx, b, off){
    const A=RB[b], m=RN[b]; let pen=false;
    for(let k=0;k<m;k+=2){
      const x=A[k];
      if(x!==x){ pen=false; continue; }
      if(pen) ctx.lineTo(x, A[k+1]+off); else{ ctx.moveTo(x, A[k+1]+off); pen=true; }
    }
  }

  function paint(T, camZ, e){
    const r=T.rl; if(!r) return;
    if(r.gen!==PAL.gen) styles(T, r);
    const ctx=T.ctx, F=r.F, cx=T.cx, hz=r.hz, dpr=T.dpr;
    const gap=CAM_Y/Z_FAR*F, lowY0=Math.max(r.lowY, hz+gap*1.35);
    march(T, r, camZ, e, lowY0);
    ctx.clearRect(0,0,T.w,T.h);

    // 1. glow behind the pass
    const RX=Math.min(F*0.62, T.w), RY=hz*0.78;
    ctx.globalAlpha=clamp(0.85+0.5*e, 0, 1);
    ctx.setTransform(dpr*RX,0,0,dpr*RY,dpr*cx,dpr*hz);
    ctx.fillStyle=r.glow; ctx.fillRect(-1,-1,2,2);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    // 2. the horizon line, seen only where the far range dips below it
    // a wide faint pass under a thin one reads as glow without shadowBlur
    ctx.strokeStyle=r.hzLine;
    ctx.globalAlpha=clamp(0.22+0.12*e, 0, 1); ctx.lineWidth=5;
    ctx.beginPath(); ctx.moveTo(0,hz); ctx.lineTo(T.w,hz); ctx.stroke();
    ctx.globalAlpha=clamp(0.5+0.25*e, 0, 1); ctx.lineWidth=1;
    ctx.stroke();
    // 3. the far range, two layers of it
    ctx.fillStyle=PAL.bg; ctx.strokeStyle=r.farLine;
    for(let i=0;i<r.far.length;i++){
      const f=r.far[i];
      ctx.globalAlpha=1; ctx.fill(f.fill);
      ctx.globalAlpha=(i? 0.20 : 0.11)*(1+0.3*e); ctx.stroke(f.line);
    }
    // 4. mist lying in the far valley
    ctx.globalAlpha=clamp(0.9+0.3*e, 0, 1);
    ctx.setTransform(dpr*Math.min(F*0.75, T.w),0,0,dpr*gap*1.1,dpr*cx,dpr*(hz+gap*0.25));
    ctx.fillStyle=r.mist; ctx.fillRect(-1,-1,2,2);
    ctx.setTransform(dpr,0,0,dpr,0,0);

    // 5. the ground: a faint fill under the ridges still fading in, then one
    // solid fill under the silhouette of the whole range. Everything under
    // the ground line is solid anyway, so the faint one stops there
    const HS=r.hs, HM=r.hm, NS=r.ns;
    ctx.fillStyle=PAL.bg;
    let m0=0, m1=NS-1;
    while(m0<NS && HM[m0]>=lowY0) m0++;
    while(m1>m0 && HM[m1]>=lowY0) m1--;
    if(m0<m1){
      ctx.globalAlpha=HAZE_A;
      ctx.beginPath(); ctx.moveTo(m0*RES, lowY0+1);
      for(let i=m0;i<=m1;i++) ctx.lineTo(i*RES, HM[i]);
      ctx.lineTo(m1*RES, lowY0+1); ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha=1;
    ctx.beginPath(); ctx.moveTo(0, HS[0]);
    for(let i=1;i<NS;i++) ctx.lineTo(i*RES, HS[i]);
    ctx.lineTo((NS-1)*RES, T.h+2); ctx.lineTo(0, T.h+2); ctx.closePath();
    ctx.fill();

    // 6. the lines. The economy surface drops the CSS glow on .terrain, so
    // the crests carry their own: faint copies a pixel above and below, which
    // stay cheap hairlines where a wide stroke would rasterize as a mask
    ctx.strokeStyle=r.line;
    if(document.body.classList.contains("economy")){
      for(let l=1;l<LV;l++){
        const b=2*LV+l; if(!RN[b]) continue;
        ctx.globalAlpha=clamp(LA[l]*0.3,0,1);
        ctx.beginPath(); strokeRidges(ctx, b, -1.25); strokeRidges(ctx, b, 1.25); ctx.stroke();
      }
    }
    for(let t=0;t<3;t++){
      for(let l=1;l<LV;l++){
        const b=t*LV+l;
        if(SN[b]){
          const A=SB[b], m=SN[b];
          ctx.globalAlpha=clamp(LA[l]*SLOPE_A[t],0,1);
          ctx.beginPath();
          for(let k=0;k<m;k+=4){ ctx.moveTo(A[k],A[k+1]); ctx.lineTo(A[k+2],A[k+3]); }
          ctx.stroke();
        }
        if(RN[b]){
          ctx.globalAlpha=clamp(LA[l]*RIDGE_A[t],0,1);
          ctx.beginPath(); strokeRidges(ctx, b, 0); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha=1;
    // 7. the foreground fade, solid below the primary monitor's bottom edge
    ctx.fillStyle=r.foot; ctx.fillRect(0, r.footY, T.w, T.h-r.footY+1);
  }

  /* The sky: stars at infinity do not move when the camera flies forward, so
     these hold still and only breathe, each on its own slow period. Nothing
     in it changes faster than the eye can follow, so it is repainted on every
     fourth frame and the canvas keeps its pixels in between. */
  const SKY={ w:0, h:0, stars:null, cols:null, gen:-1, n:0 };
  function skyStars(K){
    SKY.w=K.w; SKY.h=K.h; SKY.stars=[];
    const n=clamp(Math.round(K.w*K.h/27000), 40, 1000);
    for(let i=0;i<n;i++){
      const big=Math.random()<0.06;
      SKY.stars.push({ x:Math.random()*K.w, y:Math.random()*K.h,
        s:big? rnd(1.6,2.3) : rnd(0.8,1.4), a:big? rnd(0.6,0.9) : rnd(0.2,0.55),
        w:rnd(0.35,0.8), p:rnd(0,Math.PI*2) });
    }
  }
  function skyPaint(K, t){
    if(SKY.w!==K.w || SKY.h!==K.h || !SKY.stars) skyStars(K);
    if(SKY.gen!==PAL.gen){
      // alpha quantized to 1/20 steps so fillStyle strings come from a small cache
      const l=clamp(PAL.l+25,0,90);
      SKY.cols=Array.from({length:21},(_,j)=>hslStr(PAL.h, PAL.s, l, +(j/20).toFixed(2)));
      SKY.gen=PAL.gen;
    }
    const ctx=K.ctx, c=SKY.cols, st=SKY.stars;
    ctx.clearRect(0,0,K.w,K.h);
    for(let i=0;i<st.length;i++){
      const s=st[i], a=s.a*(0.78+0.22*Math.sin(t*s.w+s.p));
      ctx.fillStyle=c[clamp(Math.round(a*20),0,20)];
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
  }

  return {
    label:"Ridgeline", band:0.52,
    init(T){ setup(T); },
    frame(dt, SCx){
      // only real music moves it: the idle visualizer wave would otherwise
      // make the range breathe with no sound playing
      const want=(AUD.live && CFG.audio) ? SCx.energy : 0;
      S.e+=(want-S.e)*(1-Math.exp(-dt/650));
      S.camZ+=dt*0.001*SPEED*(1+0.35*S.e);
    },
    draw(T){ paint(T, S.camZ, S.e); },
    sky(K, SCx){
      // a new size repaints at once, so a resize never shows a stretched frame
      if((SKY.n++&3) && SKY.w===K.w && SKY.h===K.h && SKY.gen===PAL.gen) return;
      skyPaint(K, SCx.t);
    },
    // game mode shows one composed view, and the flight resumes from it, so
    // the cut happens on entry, while a game has the screen, never on exit
    still(T){ S.camZ=STILL_Z; paint(T, STILL_Z, 0); },
    stillSky(K, SCx){ skyPaint(K, SCx.t); }
  };
})();
