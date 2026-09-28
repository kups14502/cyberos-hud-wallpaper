/* ---- Topographic: a live contour map of slowly morphing terrain ----
   A smooth height field (domain-warped simplex fBm with time as the third
   axis, over a broad massif under the primary monitor's lower center, so the
   map has somewhere for the eye to land) is contoured with marching squares
   and drawn as thin isolines, every fifth one an index contour carrying its
   elevation. Survey crosses mark a fixed lattice, the highest summits get a
   spot height, and a survey level climbs the massif once a minute, lighting
   the contours it passes. Index contours breathe with the music's low end.

   Cost control, because the band covers the whole layer:
     * the noise is sampled on a coarse grid (two fine cells per sample) and
       Catmull-Rom upsampled, since the field is far smoother than the grid;
     * only keyframes are sampled, KP seconds apart, and the next one is built
       a few rows per frame; every redraw is a plain lerp between two of them;
     * contours are redrawn at most ~30 fps, and past the economy line at most
       every other frame and ~20 fps. The morph is slow enough that a faster
       redraw would move nothing but subpixels, and the canvas keeps its
       pixels in between;
     * segments are chained into whole contours and drawn as curves through
       their midpoints: one path call per segment instead of two, and smooth
       on a grid far coarser than straight chords would need;
     * the plain contours are dropped behind the panels, where the panel fill
       would have hidden them anyway, and only the index contours carry on.
   Strokes share a small set of cached styles: alpha is quantized into NB
   buckets (mask x elevation), one Path2D per bucket. */
(function(){
  const KP=0.5;              // s between field keyframes
  const STEP=0.05;           // height between contours, in field units
  const ESTEP=20;            // meters per contour, so index contours land on 100s
  const ELEV0=1200;          // meters at field height 0
  const NB=12;               // alpha buckets
  const A_NORM=0.30, A_IDX=0.88, A_CROSS=0.42, A_LBL=0.80;
  const LBL_INSET=0.09;       // labels and spot heights stay this far (short edges) off the panels
  const T0=500;              // start the clock mid-morph, not on a noise lattice plane

  /* ---- 3D simplex noise (Gustavson). Fixed seed: every boot shows the same land. ---- */
  const PERM=new Uint8Array(512), PM12=new Uint8Array(512);
  (function(){
    const p=new Uint8Array(256);
    for(let i=0;i<256;i++) p[i]=i;
    let s=0x2f6b1d35;
    for(let i=255;i>0;i--){
      s^=s<<13; s^=s>>>17; s^=s<<5;
      const j=(s>>>0)%(i+1), t=p[i]; p[i]=p[j]; p[j]=t;
    }
    for(let i=0;i<512;i++){ PERM[i]=p[i&255]; PM12[i]=PERM[i]%12; }
  })();
  const GR=new Float64Array([1,1,0,-1,1,0,1,-1,0,-1,-1,0,1,0,1,-1,0,1,
                             1,0,-1,-1,0,-1,0,1,1,0,-1,1,0,1,-1,0,-1,-1]);
  const F3=1/3, G3=1/6;
  function noise(x,y,z){
    const s=(x+y+z)*F3;
    const i=Math.floor(x+s), j=Math.floor(y+s), k=Math.floor(z+s);
    const t=(i+j+k)*G3;
    const x0=x-i+t, y0=y-j+t, z0=z-k+t;
    let i1,j1,k1,i2,j2,k2;
    if(x0>=y0){
      if(y0>=z0){ i1=1;j1=0;k1=0;i2=1;j2=1;k2=0; }
      else if(x0>=z0){ i1=1;j1=0;k1=0;i2=1;j2=0;k2=1; }
      else { i1=0;j1=0;k1=1;i2=1;j2=0;k2=1; }
    }else{
      if(y0<z0){ i1=0;j1=0;k1=1;i2=0;j2=1;k2=1; }
      else if(x0<z0){ i1=0;j1=1;k1=0;i2=0;j2=1;k2=1; }
      else { i1=0;j1=1;k1=0;i2=1;j2=1;k2=0; }
    }
    const x1=x0-i1+G3, y1=y0-j1+G3, z1=z0-k1+G3;
    const x2=x0-i2+2*G3, y2=y0-j2+2*G3, z2=z0-k2+2*G3;
    const x3=x0-1+3*G3, y3=y0-1+3*G3, z3=z0-1+3*G3;
    const ii=i&255, jj=j&255, kk=k&255;
    let n=0, q, g;
    q=0.6-x0*x0-y0*y0-z0*z0;
    if(q>0){ g=PM12[ii+PERM[jj+PERM[kk]]]*3; q*=q; n+=q*q*(GR[g]*x0+GR[g+1]*y0+GR[g+2]*z0); }
    q=0.6-x1*x1-y1*y1-z1*z1;
    if(q>0){ g=PM12[ii+i1+PERM[jj+j1+PERM[kk+k1]]]*3; q*=q; n+=q*q*(GR[g]*x1+GR[g+1]*y1+GR[g+2]*z1); }
    q=0.6-x2*x2-y2*y2-z2*z2;
    if(q>0){ g=PM12[ii+i2+PERM[jj+j2+PERM[kk+k2]]]*3; q*=q; n+=q*q*(GR[g]*x2+GR[g+1]*y2+GR[g+2]*z2); }
    q=0.6-x3*x3-y3*y3-z3*z3;
    if(q>0){ g=PM12[ii+1+PERM[jj+1+PERM[kk+1]]]*3; q*=q; n+=q*q*(GR[g]*x3+GR[g+1]*y3+GR[g+2]*z3); }
    return 32*n;
  }

  /* The land, at (x,y) in units of the primary monitor's short edge, origin
     at its center. A slow warp bends the octaves into spurs and valleys
     instead of round blobs, and each octave morphs at its own rate so the map
     never just breathes. The massif rides the same warp, so it reads as one
     more mountain rather than a target painted on the screen. */
  const MX=0.04, MY=0.17, MR=1/(0.30*0.30), MH=0.75;
  function height(x,y,t){
    const wx=noise(x*0.9+3.1, y*0.9-1.7, t*0.0075);
    const wy=noise(x*0.9-5.3, y*0.9+2.9, t*0.0075+7.1);
    const qx=x+0.26*wx, qy=y+0.26*wy;
    const dx=qx-MX, dy=(qy-MY)*1.35;
    return 0.60*noise(qx*1.30,      qy*1.30,     t*0.010)
         + 0.28*noise(qx*2.6+11.3,  qy*2.6-4.1,  t*0.016)
         + 0.12*noise(qx*5.2-7.9,   qy*5.2+3.3,  t*0.025)
         + MH*Math.exp(-(dx*dx+dy*dy)*MR);
  }

  const smooth=(a,b,x)=>{ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };

  /* How loud the map may be at (x,y), 0..1. The panels sit in the corners, so
     the lines stay full strength in the corridor between the panel columns and
     in the lower half, and sink to a faint floor behind the panels and along
     the top where the clock and identity boxes are. The corridor comes from
     the same numbers the layout engine uses: a 25rem column, rem at 1.3% of
     the short edge, and the 2:1 content band on an ultrawide. A portrait
     screen stacks its panels at the top and the bottom only, so its middle
     band is open edge to edge. `inset` (in short edges) narrows the corridor;
     text uses it to keep off the panels. */
  function maskAt(S, pi, x, y, inset){
    let best=0;
    for(let n=0;n<S.length;n++){
      const s=S[n];
      if(x<s.x || x>s.x+s.w || y<s.y || y>s.y+s.h) continue;
      const sh=Math.min(s.w,s.h), v=(y-s.y)/s.h;
      const edge=Math.max(0.022, (1-2*s.h/s.w)/2);
      const rem=clamp(0.013*sh, 9, 30)*clamp(+CFG.uiScale||1, 0.5, 2);
      const colW=Math.min(25*rem, (s.w/s.h<1.3 ? 0.46 : 0.34)*s.w);
      const inner=s.w*(0.5-edge)-colW-(inset||0)*sh;
      const dx=Math.abs(x-(s.x+s.w/2)), tall=s.w<s.h;
      let hx=1-smooth(inner-0.10*sh, inner+0.14*sh, dx);
      if(tall) hx=1-(1-hx)*(1-smooth(0.22, 0.32, v)*(1-smooth(0.62, 0.71, v)));
      const top=smooth(0.03, tall ? 0.30 : 0.50, v);
      const foot=1-0.45*smooth(0.90, 1.0, v);
      let f=(0.20+0.80*hx*(0.30+0.70*top))*(0.50+0.50*top)*foot;
      if(n!==pi) f*=0.8;
      if(f>best) best=f;
    }
    return best;
  }

  /* ---- per-canvas state ---- */
  function setup(T){
    const S=(T.screens && T.screens.length) ? T.screens : [{x:0,y:0,w:T.w,h:T.h}];
    const pi=clamp((typeof LAY!=="undefined" && LAY.primary)|0, 0, S.length-1);
    const P=S[pi];
    const U=Math.max(320, Math.min(P.w,P.h));
    const cs=clamp(Math.round(U/72), 9, 36);
    const nx=Math.ceil(T.w/cs)+1, ny=Math.ceil(T.h/cs)+1;
    const ncx=Math.ceil((nx-1)/2)+4, ncy=Math.ceil((ny-1)/2)+4;
    const N=nx*ny;
    const G={ S, pi, U, cs, nx, ny, ncx, ncy,
              // world origin = the primary monitor's center, so the composition
              // there is the same on one monitor, a span, or per-monitor bands
              ox:P.x+P.w/2, oy:P.y+P.h/2,
              A:new Float32Array(N), B:new Float32Array(N), C:new Float32Array(N),
              H:new Float32Array(N), crs:new Float32Array(ncx*ncy), tmp:new Float32Array(ncy*nx),
              mask:new Float32Array((nx-1)*(ny-1)), rowOn:new Uint8Array(ny-1),
              mN:new Float32Array((nx-1)*(ny-1)), mI:new Float32Array((nx-1)*(ny-1)),
              foc:new Uint8Array((nx-1)*(ny-1)), lmask:new Float32Array((nx-1)*(ny-1)),
              ta:-1, cRow:0, cUp:false, drawn:-1,
              big: S.reduce((a,s)=>a+s.w*s.h, 0)>12e6, rest:false,
              ix:new Float32Array(5*4096),
              lwN:Math.max(1, U/2160), lwI:Math.max(1.3, 1.6*U/2160), lwS:Math.max(1.6, 2.0*U/2160),
              fz:Math.round(clamp(U*0.0072, 9, 18)),
              labels:[], peaks:[], pkAt:-1, pkTxtAt:0 };
    for(let j=0;j<ny-1;j++){
      let on=0;
      for(let i=0;i<nx-1;i++){
        const m=maskAt(S, pi, (i+0.5)*cs, (j+0.5)*cs);
        G.mask[j*(nx-1)+i]=m;
        // plain contours fade out behind the panels; index contours keep a floor
        G.mN[j*(nx-1)+i]=m*smooth(0.10, 0.45, m); G.mI[j*(nx-1)+i]=Math.max(m, 0.2);
        G.lmask[j*(nx-1)+i]=maskAt(S, pi, (i+0.5)*cs, (j+0.5)*cs, LBL_INSET);
        // the survey level's reach, as a bucket: the ground around the massif
        const fx=((i+0.5)*cs-G.ox)/U-MX, fy=((j+0.5)*cs-G.oy)/U-MY;
        G.foc[j*(nx-1)+i]=Math.round(NB*m*Math.exp(-(fx*fx/1.6+fy*fy)/(0.42*0.42)));
        if(m>=0.03) on=1;
      }
      G.rowOn[j]=on;
    }
    // survey crosses on a lattice pinned to the primary center
    const gs=U/5.5, arm=Math.max(2.5, U*0.0027);
    G.cross=[];
    const gx0=G.ox-Math.ceil(G.ox/gs)*gs, gy0=G.oy-Math.ceil(G.oy/gs)*gs;
    for(let y=gy0;y<T.h;y+=gs) for(let x=gx0;x<T.w;x+=gs){
      if(x<arm || y<arm) continue;
      const b=Math.round(maskAt(S, pi, x, y)*NB);
      if(b<1) continue;
      const p=G.cross[b]||(G.cross[b]=new Path2D());
      p.moveTo(x-arm,y); p.lineTo(x+arm,y); p.moveTo(x,y-arm); p.lineTo(x,y+arm);
    }
    // elevation label anchors: a loose ring around each screen's center, more on the primary
    const RING=[[-0.34,0.10],[0.30,0.02],[-0.04,0.30],[0.42,0.28],[-0.52,0.32],[0.08,-0.12]];
    S.forEach((s,n)=>{
      const sh=Math.min(s.w,s.h), cx=s.x+s.w/2, cy=s.y+s.h*0.55;
      const list = n===pi ? RING : RING.slice(0,3);
      list.forEach(a=>{
        const ax=cx+a[0]*sh, ay=cy+a[1]*sh;
        if(ax<0 || ax>T.w || ay<0 || ay>T.h) return;
        if(maskAt(S, pi, ax, ay, LBL_INSET)<0.7) return;
        G.labels.push({ ax, ay, k:null, x:ax, y:ay, ang:0, tx:ax, ty:ay, ta:0,
                        al:0, lost:false, txt:"", tw:0, gap2:0, w:1 });
      });
    });
    let fam="monospace";
    try{ fam=getComputedStyle(document.body).fontFamily||fam; }catch(e){}
    G.font=G.fz+"px "+fam;
    G.fontPk=Math.round(G.fz*0.9)+"px "+fam;
    T.topo=G;
    return G;
  }
  // the text mask under a point, from the cached cell grid
  function maskHere(G, x, y){
    const i=clamp((x/G.cs)|0, 0, G.nx-2), j=clamp((y/G.cs)|0, 0, G.ny-2);
    return G.lmask[j*(G.nx-1)+i];
  }

  /* ---- the field: coarse samples, upsampled, keyframed ---- */
  function coarseRows(G, t, from, to){
    const U=G.U, ncx=G.ncx, crs=G.crs;
    const bx=-G.ox/U, by=-G.oy/U, du=2*G.cs/U;
    for(let cj=from;cj<to;cj++){
      const wy=by+(cj-1)*du, r=cj*ncx;
      for(let ci=0;ci<ncx;ci++) crs[r+ci]=height(bx+(ci-1)*du, wy, t);
    }
  }
  // Catmull-Rom midpoints, separable: coarse rows to fine columns, then down
  function upsample(G, dst){
    const nx=G.nx, ny=G.ny, ncx=G.ncx, crs=G.crs, tmp=G.tmp;
    for(let cj=0;cj<G.ncy;cj++){
      const cr=cj*ncx, tr=cj*nx;
      for(let fx=0;fx<nx;fx++){
        if((fx&1)===0) tmp[tr+fx]=crs[cr+(fx>>1)+1];
        else{ const i=cr+((fx-1)>>1)+1; tmp[tr+fx]=(9*(crs[i]+crs[i+1])-crs[i-1]-crs[i+2])*0.0625; }
      }
    }
    for(let fy=0;fy<ny;fy++){
      const dr=fy*nx;
      if((fy&1)===0){ dst.set(tmp.subarray(((fy>>1)+1)*nx, ((fy>>1)+2)*nx), dr); continue; }
      const j=((fy-1)>>1)+1, r0=(j-1)*nx, r1=j*nx, r2=(j+1)*nx, r3=(j+2)*nx;
      for(let fx=0;fx<nx;fx++)
        dst[dr+fx]=(9*(tmp[r1+fx]+tmp[r2+fx])-tmp[r0+fx]-tmp[r3+fx])*0.0625;
    }
  }
  function keyframe(G, t, dst){ coarseRows(G, t, 0, G.ncy); upsample(G, dst); }
  // Advance the keyframes to time t, building the next one a slice at a time.
  function field(G, t){
    if(G.ta<0 || t<G.ta || t>=G.ta+3*KP){          // cold start, or the clock jumped
      G.ta=Math.floor(t/KP)*KP;
      keyframe(G, G.ta, G.A); keyframe(G, G.ta+KP, G.B);
      G.cRow=0; G.cUp=false;
    }
    while(t>=G.ta+KP){
      if(!G.cUp){ coarseRows(G, G.ta+2*KP, G.cRow, G.ncy); upsample(G, G.C); }
      const a=G.A; G.A=G.B; G.B=G.C; G.C=a;
      G.ta+=KP; G.cRow=0; G.cUp=false;
    }
    if(!G.cUp){
      // due by 3/4 of the period, so the swap never has to finish it in one go
      const want=Math.min(G.ncy, Math.ceil(G.ncy*(t-G.ta)/(KP*0.75))+1);
      if(want>G.cRow){ coarseRows(G, G.ta+2*KP, G.cRow, want); G.cRow=want; }
      if(G.cRow>=G.ncy){ upsample(G, G.C); G.cUp=true; }
    }
  }

  /* ---- cached styles, rebuilt when the palette changes ---- */
  const ST={ gen:-1 };
  function styles(){
    if(ST.gen===PAL.gen) return;
    ST.gen=PAL.gen;
    const h=PAL.h, s=PAL.s, lit=clamp(PAL.l+8,0,80), litI=clamp(PAL.l+20,0,88);
    ST.norm=[]; ST.idx=[]; ST.cross=[]; ST.scan=[];
    for(let b=0;b<=NB;b++){
      const f=b/NB;
      ST.norm[b] =hslStr(h, s, lit,  (f*A_NORM).toFixed(3));
      ST.idx[b]  =hslStr(h, s, litI, (f*A_IDX).toFixed(3));
      ST.cross[b]=hslStr(h, s, litI, (f*A_CROSS).toFixed(3));
      ST.scan[b] =hslStr(h, s, clamp(PAL.l+30,0,94), f.toFixed(3));
    }
    ST.label=hslStr(h, clamp(s-10,0,100), clamp(PAL.l+22,0,92));
  }

  /* ---- marching squares, chained ----
     A crossing point belongs to the cell edge it sits on, and the two cells
     sharing that edge share the point, so the segments come out linked into
     whole contours. Cell-length chords with a kink at every edge read as a
     polygon at 4K; curving them through their midpoints costs far less than a
     finer grid. The cell being contoured lives in module variables, so the
     hot loop passes nothing but edge numbers around. */
  // edge pairs for the unambiguous cases, as e1*4+e2 (0 top, 1 right, 2 bottom, 3 left)
  const SEGT=new Int8Array([-1, 12, 1, 13, 6, -1, 2, 14, 11, 2, -1, 6, 7, 1, 12, -1]);
  let C0=0, C1=0, C2=0, C3=0, CX=0, CY=0, CS=0, CL=0, EX=0, EY=0;
  let CI=0, CJ=0, CID=0, KI=0, NXR=0, NYR=0, NLV=0, TW=0, STB=0, STC=0;
  let IXB=null, NIX=0, CUR=null;
  /* Crossing points: position, level, and the two segments that meet there
     (neighbor + alpha bucket). bot/rgt remember the crossings on the last
     row's bottom edges and the last cell's right edge, per level, stamped so
     nothing has to be cleared between rows or frames. */
  let QX, QY, QA0, QA1, QB0, QB1, QK, QV, QBOT, QBOTS, QRGT, QRGTS, QN=0, QCAP=0, QTCAP=0, QRCAP=0;
  function qGrow(cap){
    const x=new Float32Array(cap), y=new Float32Array(cap), a0=new Int32Array(cap), a1=new Int32Array(cap),
          b0=new Uint8Array(cap), b1=new Uint8Array(cap), k=new Int16Array(cap);
    if(QCAP){ x.set(QX); y.set(QY); a0.set(QA0); a1.set(QA1); b0.set(QB0); b1.set(QB1); k.set(QK); }
    QX=x; QY=y; QA0=a0; QA1=a1; QB0=b0; QB1=b1; QK=k; QV=new Uint8Array(cap); QCAP=cap;
  }
  // a stamp no row or cell can carry, not even row -1 above the first
  const NOSTAMP=-2147483648;
  function qTables(tw, nl){
    if(2*tw>QTCAP){ QTCAP=2*tw; QBOT=new Int32Array(QTCAP); QBOTS=new Int32Array(QTCAP).fill(NOSTAMP); }
    if(2*nl>QRCAP){ QRCAP=2*nl; QRGT=new Int32Array(QRCAP); QRGTS=new Int32Array(QRCAP).fill(NOSTAMP); }
    if(STB>1e9 || STC>1e9){ QBOTS.fill(NOSTAMP); QRGTS.fill(NOSTAMP); STB=0; STC=0; }
  }
  function edgePt(e){
    if(e===0){ EX=CX+CS*(CL-C0)/(C1-C0); EY=CY; }
    else if(e===1){ EX=CX+CS; EY=CY+CS*(CL-C1)/(C2-C1); }
    else if(e===2){ EX=CX+CS*(CL-C3)/(C2-C3); EY=CY+CS; }
    else { EX=CX; EY=CY+CS*(CL-C0)/(C3-C0); }
  }
  function qNew(e, k){
    if(QN>=QCAP) qGrow(QCAP*2);
    edgePt(e);
    const n=QN++;
    QX[n]=EX; QY[n]=EY; QA0[n]=-1; QA1[n]=-1; QK[n]=k;
    return n;
  }
  // the crossing of level k on edge e of the current cell, shared with its neighbor
  function node(e, k){
    let s, n;
    if(e===0){
      s=((CJ+1)&1)*TW + KI*NXR + CI;
      return QBOTS[s]===STB+CJ-1 ? QBOT[s] : qNew(0, k);
    }
    if(e===3){
      if(CI>0){ s=((CI+1)&1)*NLV + KI; if(QRGTS[s]===STC+CID-1) return QRGT[s]; }
      return qNew(3, k);
    }
    n=qNew(e, k);
    if(e===2){ s=(CJ&1)*TW + KI*NXR + CI; QBOT[s]=n; QBOTS[s]=STB+CJ; }
    else     { s=(CI&1)*NLV + KI;         QRGT[s]=n; QRGTS[s]=STC+CID; }
    return n;
  }
  function seg(k, b, idx, e1, e2){
    const p=node(e1, k), q=node(e2, k);
    if(QA0[p]<0){ QA0[p]=q; QB0[p]=b; } else { QA1[p]=q; QB1[p]=b; }
    if(QA0[q]<0){ QA0[q]=p; QB0[q]=b; } else { QA1[q]=p; QB1[q]=b; }
    if(!idx) return;
    // index segments also go to a flat buffer, where the labels look for their line
    if(NIX+5>IXB.length){ const g=new Float32Array(IXB.length*2); g.set(IXB); IXB=CUR.ix=g; }
    IXB[NIX]=QX[p]; IXB[NIX+1]=QY[p]; IXB[NIX+2]=QX[q]; IXB[NIX+3]=QY[q]; IXB[NIX+4]=k; NIX+=5;
  }

  /* ---- chains to curves ---- */
  const CH={ x:new Float32Array(2048), y:new Float32Array(2048), b:new Uint8Array(2048) };
  function chGrow(){
    const n=CH.x.length*2, x=new Float32Array(n), y=new Float32Array(n), b=new Uint8Array(n);
    x.set(CH.x); y.set(CH.y); b.set(CH.b); CH.x=x; CH.y=y; CH.b=b;
  }
  let CHM=0, CHC=false;
  /* Walk the contour from `start` into CH: points, and the bucket of each
     segment. A crossing that lands next to a grid corner leaves a stub of a
     segment, and a midpoint curve turns on a stub like a corner, so points
     closer than MIN2 to the last one kept are merged into it. */
  let MIN2=0;
  function walk(start){
    let prev=-1, cur=start, m=0, nx=-1, cut=false;
    for(;;){
      if(m>=CH.x.length) chGrow();
      QV[cur]=1;
      const a=QA0[cur], x=QX[cur], y=QY[cur];
      let b;
      if(a>=0 && a!==prev){ nx=a; b=QB0[cur]; } else { nx=QA1[cur]; b=QB1[cur]; }
      const dx=m ? x-CH.x[m-1] : 1e9, dy=m ? y-CH.y[m-1] : 0;
      if(dx*dx+dy*dy<MIN2){ if(b>CH.b[m-1]) CH.b[m-1]=b; cut=true; }
      else { CH.x[m]=x; CH.y[m]=y; CH.b[m]=b; m++; cut=false; }
      if(nx<0 || QV[nx]) break;
      prev=cur; cur=nx;
    }
    CHC=(nx===start);
    if(CHC){
      const dx=CH.x[m-1]-CH.x[0], dy=CH.y[m-1]-CH.y[0];
      if(dx*dx+dy*dy<MIN2 && m>3) m--;
    }else if(cut && m>1){ CH.x[m-1]=QX[cur]; CH.y[m-1]=QY[cur]; }
    CHM=m;
  }
  // Pieces: the curve from one segment midpoint to the next, bent by the point
  // between them. A run of pieces in one bucket is one subpath.
  let EP=null, EB=-1, CUTS=null, NCUT=0, FOC=null;
  function cutAt(x, y){
    for(let q=0;q<NCUT;q++){
      const L=CUTS[q], dx=x-L.x, dy=y-L.y;
      if(dx*dx+dy*dy<L.gap2) return true;
    }
    return false;
  }
  function piece(P, b, x0, y0, cx, cy, x1, y1, curve){
    // the survey pass takes its weight from where it is, not from the contour
    if(FOC) b=FOC[Math.min((cy/CS)|0, NYR-2)*(NXR-1)+Math.min((cx/CS)|0, NXR-2)];
    if(b<1 || (NCUT && cutAt(cx, cy))){ EB=-1; return; }
    if(b!==EB){ EP=P[b]||(P[b]=new Path2D()); EP.moveTo(x0,y0); EB=b; }
    if(curve) EP.quadraticCurveTo(cx,cy,x1,y1); else EP.lineTo(x1,y1);
  }
  function emit(P){
    const X=CH.x, Y=CH.y, B=CH.b, m=CHM;
    EB=-1;
    if(!CHC){
      if(m<2) return;
      if(m===2){ piece(P, B[0], X[0],Y[0], X[0],Y[0], X[1],Y[1], false); return; }
      let mx=(X[0]+X[1])*0.5, my=(Y[0]+Y[1])*0.5;
      piece(P, B[0], X[0],Y[0], X[0],Y[0], mx,my, false);
      for(let i=1;i<m-1;i++){
        const nx=(X[i]+X[i+1])*0.5, ny=(Y[i]+Y[i+1])*0.5;
        piece(P, B[i-1]>B[i]?B[i-1]:B[i], mx,my, X[i],Y[i], nx,ny, true);
        mx=nx; my=ny;
      }
      piece(P, B[m-2], mx,my, X[m-1],Y[m-1], X[m-1],Y[m-1], false);
      return;
    }
    // A closed loop: the last point's segment leads back to the first. A loop
    // thinner than a third of a cell is a knob the grid barely caught, and it
    // would draw as a stray dash.
    if(m<3) return;
    let x0=X[0], x1=x0, y0=Y[0], y1=y0;
    for(let i=1;i<m;i++){
      const x=X[i], y=Y[i];
      if(x<x0) x0=x; else if(x>x1) x1=x;
      if(y<y0) y0=y; else if(y>y1) y1=y;
    }
    if(x1-x0<CS*0.34 || y1-y0<CS*0.34) return;
    let mx=(X[m-1]+X[0])*0.5, my=(Y[m-1]+Y[0])*0.5, bp=B[m-1];
    const sx=mx, sy=my;
    for(let i=0;i<m;i++){
      const j=i+1<m ? i+1 : 0;
      const nx=j ? (X[i]+X[j])*0.5 : sx, ny=j ? (Y[i]+Y[j])*0.5 : sy;
      piece(P, bp>B[i]?bp:B[i], mx,my, X[i],Y[i], nx,ny, true);
      mx=nx; my=ny; bp=B[i];
    }
  }

  // per level, for the frame: index or not, and the elevation weight (x NB)
  const LEL=new Float32Array(1024), LIDX=new Uint8Array(1024);
  function contour(T, G, pulse, dts, settle, kLoAll, kHiAll, scan, scanA){
    const ctx=T.ctx, nx=G.nx, ny=G.ny, cs=G.cs, H=G.H, mask=G.mask, MN=G.mN, MI=G.mI;
    const inv=1/STEP, PN=[], PI=[];
    IXB=G.ix; NIX=0; CUR=G; CS=cs; MIN2=(0.28*cs)*(0.28*cs);
    NXR=nx; NYR=ny; NLV=Math.min(kHiAll-kLoAll+1, 1024); TW=NLV*nx;
    for(let q=0;q<NLV;q++){
      const k=kLoAll+q;
      LIDX[q]=(k%5===0)?1:0;
      // higher ground reads brighter, so the relief shows without shading
      LEL[q]=(0.22+0.78*smooth(-0.55, 0.95, k*STEP))*NB;
    }
    qTables(TW, NLV);
    if(!QCAP) qGrow(16384);
    QN=0;
    for(let j=0;j<ny-1;j++){
      if(!G.rowOn[j]) continue;
      const r0=j*nx, r1=r0+nx, mr=j*(nx-1);
      CY=j*cs; CJ=j;
      for(let i=0;i<nx-1;i++){
        const m=mask[mr+i]; if(m<0.03) continue;
        const a0=H[r0+i], a1=H[r0+i+1], a2=H[r1+i+1], a3=H[r1+i];
        let mn=a0, mx=a0;
        if(a1<mn) mn=a1; else if(a1>mx) mx=a1;
        if(a2<mn) mn=a2; else if(a2>mx) mx=a2;
        if(a3<mn) mn=a3; else if(a3>mx) mx=a3;
        const kLo=Math.ceil(mn*inv), kHi=Math.ceil(mx*inv)-1;
        if(kLo>kHi) continue;
        C0=a0; C1=a1; C2=a2; C3=a3; CX=i*cs; CI=i; CID=mr+i;
        const mN=MN[mr+i], mI=MI[mr+i];
        for(let k=kLo;k<=kHi;k++){
          const ki=k-kLoAll, idx=LIDX[ki]===1;
          const b=((idx ? mI : mN)*LEL[ki]+0.5)|0;
          if(!idx && b<1) continue;
          const L=k*STEP; CL=L; KI=ki;
          const c=(a0>L?1:0)|(a1>L?2:0)|(a2>L?4:0)|(a3>L?8:0);
          if(c===5 || c===10){
            // saddle: the cell center decides which corners join
            if((c===5)===((a0+a1+a2+a3)*0.25>L)){ seg(k, b, idx, 0, 1); seg(k, b, idx, 2, 3); }
            else { seg(k, b, idx, 3, 0); seg(k, b, idx, 1, 2); }
          }else{ const e=SEGT[c]; seg(k, b, idx, e>>2, e&3); }
        }
      }
    }
    STB+=ny+2; STC+=(nx-1)*(ny-1)+2;
    const ix=IXB, nIx=NIX;
    IXB=null; CUR=null;

    labelsUpdate(ctx, G, ix, nIx, dts, settle);
    const LB=G.labels.filter(L=>L.k!==null && L.al>=0.04), cut=[];
    // the survey level: the few contours nearest it are drawn a second time, bright
    const sk0=Math.round(scan/STEP)-2, PS=[];
    // open contours first, from either end, then whatever is left is a loop
    const nQ=QN, V=QV;
    V.fill(0, 0, nQ);
    for(let pass=0;pass<2;pass++){
      for(let n=0;n<nQ;n++){
        if(V[n] || (pass===0 && QA1[n]>=0)) continue;
        const k=QK[n], s=k-sk0;
        walk(n);
        if(k%5===0){
          // index contours break where a label sits on them, the way a printed map does it
          cut.length=0;
          for(let q=0;q<LB.length;q++) if(LB[q].k===k) cut.push(LB[q]);
          CUTS=cut; NCUT=cut.length;
          emit(PI);
        }else emit(PN);
        if(s>=0 && s<5 && scanA>0){ FOC=G.foc; emit(PS[s]||(PS[s]=[])); FOC=null; }
        NCUT=0;
      }
    }
    CUTS=null;

    ctx.lineWidth=G.lwN;
    for(let b=1;b<=NB;b++) if(PN[b]){ ctx.strokeStyle=ST.norm[b]; ctx.stroke(PN[b]); }
    ctx.lineWidth=G.lwI;
    ctx.globalAlpha=pulse;
    for(let b=1;b<=NB;b++) if(PI[b]){ ctx.strokeStyle=ST.idx[b]; ctx.stroke(PI[b]); }
    // each survey contour's weight comes from its distance to the level, not a
    // bucket, so the brightness slides from line to line instead of stepping
    ctx.lineWidth=G.lwS;
    for(let s=0;s<5;s++){
      const P=PS[s]; if(!P) continue;
      const d=((sk0+s)*STEP-scan)/(0.85*STEP);
      const a=scanA*Math.exp(-d*d);
      if(a<0.01) continue;
      ctx.globalAlpha=a;
      for(let b=1;b<=NB;b++) if(P[b]){ ctx.strokeStyle=ST.scan[b]; ctx.stroke(P[b]); }
    }
    ctx.globalAlpha=1;
  }

  /* ---- elevation labels ----
     Each label hangs off a fixed anchor and rides the nearest index contour.
     Every redraw it moves to the closest point on the same contour level (with
     a slight pull back toward its anchor, so it never wanders off), and fades
     out if that level has left the area or drifted toward a panel. A faded
     label picks up whichever index contour now passes closest to its anchor. */
  const NEAR={ d2:0, x:0, y:0, a:0, k:0 };
  function upright(a){ if(a>Math.PI/2) a-=Math.PI; else if(a<-Math.PI/2) a+=Math.PI; return a; }
  function nearestOn(ix, nIx, k, px, py, r){
    let bd=r*r, found=false;
    for(let n=0;n<nIx;n+=5){
      if(k!==null && ix[n+4]!==k) continue;
      const x1=ix[n], y1=ix[n+1], x2=ix[n+2], y2=ix[n+3];
      // cheap reject before the projection
      if((x1<px-r && x2<px-r) || (x1>px+r && x2>px+r) ||
         (y1<py-r && y2<py-r) || (y1>py+r && y2>py+r)) continue;
      const dx=x2-x1, dy=y2-y1, l2=dx*dx+dy*dy; if(l2<1e-6) continue;
      const u=clamp(((px-x1)*dx+(py-y1)*dy)/l2, 0, 1);
      const qx=x1+dx*u, qy=y1+dy*u, d=(qx-px)*(qx-px)+(qy-py)*(qy-py);
      if(d<bd){ bd=d; found=true; NEAR.x=qx; NEAR.y=qy; NEAR.a=Math.atan2(dy,dx); NEAR.k=ix[n+4]; }
    }
    NEAR.d2=bd; NEAR.a=upright(NEAR.a);
    return found;
  }

  function labelsUpdate(ctx, G, ix, nIx, dts, settle){
    const LB=G.labels, U=G.U;
    const keepR=3.2*G.cs, acqR=0.16*U, dup2=(0.3*U)*(0.3*U);
    const fade=settle ? 1 : clamp(dts/0.9, 0, 1), sm=settle ? 1 : clamp(dts*6, 0, 1);
    for(const L of LB){
      if(L.k!==null && !L.lost){
        const px=L.tx+(L.ax-L.tx)*0.04, py=L.ty+(L.ay-L.ty)*0.04;
        if(nearestOn(ix, nIx, L.k, px, py, keepR) && maskHere(G, NEAR.x, NEAR.y)>=0.62){
          L.tx=NEAR.x; L.ty=NEAR.y; L.ta=NEAR.a;
        }else L.lost=true;
      }
      if(L.k===null && nearestOn(ix, nIx, null, L.ax, L.ay, acqR)){
        // take a level no other nearby label already carries
        const k=NEAR.k, nx0=NEAR.x, ny0=NEAR.y;
        const dup=LB.some(o=>o!==L && o.k===k && (o.x-nx0)*(o.x-nx0)+(o.y-ny0)*(o.y-ny0)<dup2);
        if(!dup){
          L.k=k; L.lost=false; L.x=L.tx=nx0; L.y=L.ty=ny0; L.ang=L.ta=NEAR.a;
          L.txt=String(ELEV0+k*ESTEP); L.al=settle?1:0;
          // as bright as the line it sits on, so a label never outshines a faint valley contour
          L.w=0.35+0.65*smooth(-0.55, 0.95, k*STEP);
          ctx.font=G.font; L.tw=ctx.measureText(L.txt).width;
          L.gap2=Math.pow(L.tw*0.5+G.fz*0.7, 2);
        }
      }
      if(L.k!==null){
        if(L.lost){ L.al-=fade; if(L.al<=0){ L.al=0; L.k=null; L.lost=false; } }
        else L.al=Math.min(1, L.al+fade);
        L.x+=(L.tx-L.x)*sm; L.y+=(L.ty-L.y)*sm;
        let d=L.ta-L.ang; if(d>Math.PI/2) d-=Math.PI; else if(d<-Math.PI/2) d+=Math.PI;
        L.ang=upright(L.ang+d*sm);
      }
    }
  }
  function labelsDraw(T, G){
    const ctx=T.ctx, LB=G.labels, dpr=T.dpr;
    ctx.font=G.font; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillStyle=ST.label;
    for(const L of LB){
      if(L.k===null || L.al<0.01) continue;
      ctx.globalAlpha=L.al*L.w*A_LBL;
      const c=Math.cos(L.ang), s=Math.sin(L.ang);
      ctx.setTransform(dpr*c, dpr*s, -dpr*s, dpr*c, dpr*L.x, dpr*L.y);
      ctx.fillText(L.txt, 0, 1);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.globalAlpha=1;
  }

  /* ---- spot heights ----
     Local maxima of the field in the bright part of the map, refined to
     subpixel with a parabola so they glide instead of hopping cell to cell.
     A marker lives as long as its summit does; new ones only fill free slots,
     so two near-equal hills never trade the marker back and forth. The search
     runs at ~8 Hz, the glide toward what it found every redraw. */
  const PK_MAX=3;
  function peaksUpdate(G, t, dts, settle){
    if(settle || !(t-G.pkAt<0.12 && t>=G.pkAt)){ G.pkAt=t; peaksFind(G, settle); }
    const PK=G.peaks;
    const fade=settle ? 1 : clamp(dts/1.2, 0, 1), sm=settle ? 1 : clamp(dts*8, 0, 1);
    // the height readout ticks at most twice a second, so digits never shimmer
    const retxt = settle || t-G.pkTxtAt>0.5;
    if(retxt) G.pkTxtAt=t;
    for(let n=PK.length-1;n>=0;n--){
      const p=PK[n];
      p.al = p.live ? Math.min(1, p.al+fade) : p.al-fade;
      if(p.al<=0){ PK.splice(n,1); continue; }
      p.x+=(p.tx-p.x)*sm; p.y+=(p.ty-p.y)*sm;
      if(retxt || !p.txt){
        const e=Math.round(ELEV0+p.h/STEP*ESTEP);
        if(e!==p.shown){ p.shown=e; p.txt=String(e); }
      }
    }
  }
  function peaksFind(G, settle){
    const nx=G.nx, ny=G.ny, H=G.H, cs=G.cs, mask=G.lmask, U=G.U;
    const cand=[];
    for(let j=2;j<ny-2;j++){
      if(!G.rowOn[j]) continue;
      for(let i=2;i<nx-2;i++){
        if(mask[j*(nx-1)+i]<0.68) continue;
        const c=j*nx+i, h=H[c];
        if(h<0.12 || h<=H[c-1] || h<=H[c+1] || h<=H[c-nx] || h<=H[c+nx] ||
           h<=H[c-nx-1] || h<=H[c-nx+1] || h<=H[c+nx-1] || h<=H[c+nx+1]) continue;
        const l=H[c-1], r=H[c+1], u=H[c-nx], d=H[c+nx];
        const ddx=l-2*h+r, ddy=u-2*h+d;
        const ox=ddx<0 ? clamp(0.5*(l-r)/ddx, -0.5, 0.5) : 0;
        const oy=ddy<0 ? clamp(0.5*(u-d)/ddy, -0.5, 0.5) : 0;
        cand.push({ x:(i+ox)*cs, y:(j+oy)*cs, h, used:false });
      }
    }
    cand.sort((a,b)=>b.h-a.h);
    const PK=G.peaks, near2=(0.07*U)*(0.07*U), sep2=(0.26*U)*(0.26*U);
    for(const p of PK){
      p.live=false;
      let best=null, bd=near2;
      for(const c of cand){
        if(c.used) continue;
        const d=(c.x-p.tx)*(c.x-p.tx)+(c.y-p.ty)*(c.y-p.ty);
        if(d<bd){ bd=d; best=c; }
      }
      if(best){ best.used=true; p.live=true; p.tx=best.x; p.ty=best.y; p.h=best.h; }
    }
    let live=PK.filter(p=>p.live).length;
    for(const c of cand){
      if(live>=PK_MAX) break;
      if(c.used) continue;
      if(PK.some(p=>(p.tx-c.x)*(p.tx-c.x)+(p.ty-c.y)*(p.ty-c.y)<sep2)) continue;
      PK.push({ x:c.x, y:c.y, tx:c.x, ty:c.y, h:c.h, al:settle?1:0, live:true, txt:"", shown:NaN });
      live++;
    }
  }
  function peaksDraw(T, G){
    const ctx=T.ctx, r=Math.max(3, G.U*0.0028);
    ctx.font=G.fontPk; ctx.textAlign="left"; ctx.textBaseline="middle";
    ctx.fillStyle=ST.label;
    for(const p of G.peaks){
      if(p.al<0.01) continue;
      ctx.globalAlpha=p.al*A_LBL;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y-r); ctx.lineTo(p.x+r*0.9, p.y+r*0.6); ctx.lineTo(p.x-r*0.9, p.y+r*0.6);
      ctx.closePath(); ctx.fill();
      ctx.fillText(p.txt, p.x+r*2.2, p.y+0.5);
    }
    ctx.globalAlpha=1;
  }

  /* ---- one full redraw of a band canvas ---- */
  function render(T, G, t, dts, settle){
    const n=G.nx*G.ny, H=G.H, A=G.A, B=G.B, u=clamp((t-G.ta)/KP, 0, 1);
    let lo=Infinity, hi=-Infinity;
    for(let i=0;i<n;i++){
      const h=A[i]+(B[i]-A[i])*u; H[i]=h;
      if(h<lo) lo=h; if(h>hi) hi=h;
    }
    styles();
    const ctx=T.ctx;
    ctx.clearRect(0,0,T.w,T.h);
    // Butt caps: a contour changes alpha bucket mid-line, and two round caps
    // meeting there would overlap into a brighter bead.
    ctx.lineWidth=1; ctx.lineCap="butt"; ctx.lineJoin="round";
    for(let b=1;b<=NB;b++) if(G.cross[b]){ ctx.strokeStyle=ST.cross[b]; ctx.stroke(G.cross[b]); }
    contour(T, G, settle ? 0.85 : TOPO.pulse, dts, settle, Math.ceil(lo/STEP), Math.ceil(hi/STEP),
            TOPO.scan, settle ? 0 : TOPO.scanA);
    labelsDraw(T, G);
    peaksUpdate(G, t, dts, settle);
    peaksDraw(T, G);
  }

  /* The survey level climbs from the valleys to the summits and starts over,
     lighting the contours it passes, so the relief reads as relief even where
     the lines are all the same weight. It is the same level on every canvas. */
  const SCAN_LO=-0.6, SCAN_HI=1.3, SCAN_T=64, A_SCAN=0.85;
  const TOPO={ t:T0, pulse:0.85, scan:0, scanA:0, skyKey:"" };
  function prep(T){ return T.topo || setup(T); }

  SCENES.topo={
    label:"Topographic", band:1.0,
    // a scene switch lands here too, and the last scene's stars must go
    init(T){ T.topo=null; TOPO.skyKey=""; prep(T); },
    frame(dt, S){
      TOPO.t=T0+S.t;
      const ph=(S.t/SCAN_T+0.35)%1;
      TOPO.scan=SCAN_LO+(SCAN_HI-SCAN_LO)*ph;
      TOPO.scanA=A_SCAN*smooth(0, 0.06, ph)*(1-smooth(0.94, 1, ph));
      // index contours swell a little with the low end of the music, eased so
      // a kick drum reads as a breath rather than a flash
      const want=0.78+0.22*clamp(S.energy*1.6, 0, 1);
      TOPO.pulse+=(want-TOPO.pulse)*clamp(dt/260, 0, 1);
    },
    draw(T){
      const G=prep(T), t=TOPO.t;
      field(G, t);
      // A desktop past the economy line redraws at most every other frame and
      // 20 times a second, so a machine that is already struggling gets half
      // the work; one monitor keeps ~30 fps.
      if(G.rest){ G.rest=false; return; }
      if(G.drawn>=0 && t>=G.drawn && t-G.drawn<(G.big ? 1/20 : 1/30)-0.004) return;
      G.rest=G.big;
      const dts=G.drawn>=0 ? clamp(t-G.drawn, 0, 0.25) : 0;
      G.drawn=t;
      render(T, G, t, dts, false);
    },
    // no stars over a map: the sky canvas is cleared once and left alone
    sky(K){
      const key=K.w+"x"+K.h;
      if(TOPO.skyKey===key) return;
      TOPO.skyKey=key; K.ctx.clearRect(0,0,K.w,K.h);
    },
    // game mode freezes the map where it stands, labels and summits settled in
    still(T){
      const G=prep(T), t=TOPO.t;
      G.ta=-1; field(G, t);
      G.labels.forEach(L=>{ L.k=null; L.al=0; L.lost=false; });
      G.peaks.length=0;
      render(T, G, t, 0, true);
      G.drawn=-1;
    }
  };
})();
