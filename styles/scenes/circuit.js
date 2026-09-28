/* =========================================================================
   SCENE: CIRCUIT
   A circuit board, laid out once per desktop: one processor, low in the
   middle of the primary monitor, bus bundles fanning out from its pins with
   proper 45-degree miters, small chips where a bus runs out, and passives
   and a few longer traces filling the gaps near it. The copper fades with an
   elliptical falloff around the processor, so the board thins out into the
   black instead of stopping on an edge, and it keeps clear of every panel's
   real box (read from the DOM, never per frame). On a span the processor's
   east and west buses run on across the seams onto the side monitors, which
   carry only those buses, the chips they end in and a few passives.

   The board never moves, so it is drawn once into the band canvas and left
   there: a canvas keeps its pixels, and a band that does not change costs the
   compositor nothing per frame. Only the light moves: comets running along
   the traces, vias flaring as they arrive, and the processor's glow and die
   cells, which follow the music. All of it is drawn into the sky canvas,
   which sits under the band, so every pulse reads as light under the copper.
   A comet dims with the copper under its head, so none runs bright over a
   trace that has already faded out.

   The layout lives in viewport px and is seeded from the desktop geometry,
   so a given desktop always gets the same board, and a band canvas (one
   across the span, or one per monitor) draws its own window onto it.
   Geometry lives in Path2D objects built once; a palette change only
   restyles them.
   ========================================================================= */
(function(){
"use strict";

// y-down compass, index = direction: E, SE, S, SW, W, NW, N, NE
const DX=[1,1,0,-1,-1,-1,0,1], DY=[0,1,1,1,0,-1,-1,-1];
const RS=Math.SQRT1_2;
const perpX=d=>-DY[d]*((d&1)?RS:1);
const perpY=d=> DX[d]*((d&1)?RS:1);

/* Copper alpha rises with the local board density from nothing at the rim,
   so a trace fades out rather than ending on a line. `b` lifts the
   processor's own buses, so they read as the spine of the board. Drawn in
   NLV log-spaced levels, one path each: a trace is cut into short runs, each
   at the level of its own density. */
const NLV=18, A_LO=0.008, A_HI=0.36, LVK=Math.log(A_HI/A_LO)/(NLV-1);
const LVA=Array.from({length:NLV},(_,i)=>A_LO*Math.exp(LVK*i));
const cuA=(w,b)=>(0.26+0.09*Math.min(b,1))*Math.pow(clamp(w*(1+0.5*b),0,1),0.85);
const lvOf=a=> a<A_LO*0.7 ? -1 : clamp(Math.round(Math.log(a/A_LO)/LVK),0,NLV-1);
// small chips, passives and legends fade in four steps
const PB=[0.25,0.5,0.75,1];
const pfOf=w=>clamp(cuA(w,0.6)/0.3,0,1);
const pbOf=w=>{ const f=pfOf(w); return f<0.12 ? -1 : clamp(Math.round(f*4)-1,0,3); };
// comet tail, oldest step first: a long quadratic fade reads as the copper
// still warm behind the packet rather than a dash sliding along
const TAIL_A=[0.025,0.05,0.085,0.13,0.19,0.27,0.37,0.5,0.66,0.85];
// comet strength classes, picked each frame from the copper under the head
const CF=[0.16,0.3,0.5,0.75,1];
const cfOf=f=> f<0.1?-1 : f<0.22?0 : f<0.4?1 : f<0.62?2 : f<0.87?3 : 4;
const FLARE_LIFE=0.6;

const ST={ frames:0, eSlow:0, burstAt:-9, kick:0, core:0.3,
           gen:-1, sty:null, spr:null, glow:null, sprCtx:null, kw:-1, k:1, font:"", head:0.9,
           L:null, dirty:true, rects:[], pend:null, rt:-9 };

function rng(seed){
  let a=(seed>>>0)||1;
  return ()=>{ a=(a+0x6D2B79F5)>>>0; let t=a;
    t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296; };
}
const ss=(a,b,x)=>{ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };

/* ---------------- the panels ----------------
   Every panel's box, padded by 1.5rem at its screen's zoom, in viewport px.
   Reading a box forces a layout, so this runs once a second and when the
   board is laid out, never per frame. */
function readRects(){
  const out=[], S=(LAY.screens && LAY.screens.length) ? LAY.screens : [{el:document, zoom:1}];
  let rem=16;
  try{ rem=parseFloat(getComputedStyle(document.documentElement).fontSize)||16; }catch(e){}
  for(const s of S){
    if(!s.el) continue;
    const pad=1.5*rem*(s.zoom||1);
    s.el.querySelectorAll(".win, #os-label").forEach(el=>{
      const r=el.getBoundingClientRect();
      if(r.width>1 && r.height>1) out.push({x0:r.left-pad, y0:r.top-pad, x1:r.right+pad, y1:r.bottom+pad});
    });
  }
  return out;
}
function sameRects(A,B){
  if(!A || !B || A.length!==B.length) return false;
  for(let i=0;i<A.length;i++){
    const a=A[i], b=B[i];
    if(Math.abs(a.x0-b.x0)>6 || Math.abs(a.y0-b.y0)>6 || Math.abs(a.x1-b.x1)>6 || Math.abs(a.y1-b.y1)>6) return false;
  }
  return true;
}
/* A panel that moved or grew lays the board out again, but only once the
   boxes have held still for a second, so a drag in edit mode does not
   rebuild it every second. The first boxes to appear count at once. */
function checkRects(t){
  ST.rt=t;
  const R=readRects();
  if(sameRects(R,ST.rects)){ ST.pend=null; return; }
  if(!ST.rects.length || sameRects(R,ST.pend)) ST.dirty=true;
  else ST.pend=R;
}

/* ---------------- generation ---------------- */

// the processor's falloff: 1 around it, 0 at the rim of an ellipse
function ell(G,x,y){
  const dx=(x-G.fx)/G.rx, dy=(y-G.fy)/(y<G.fy?G.ryU:G.ryD);
  return 1-ss(G.e0,1,Math.sqrt(dx*dx+dy*dy));
}
// On a span: a corridor along the processor's row that carries its east and
// west buses across the seams, fading out toward the far edge of the desktop.
function cor(G,x,y){
  const c = x<G.fx ? G.cxL : G.cxR;
  if(!c) return 0;
  const u=Math.abs(x-G.fx)/c, v=Math.abs(y-G.fy)/G.cy;
  return (1-ss(0.5,1,u))*(1-ss(0.3,1,v));
}
function regionAt(G,x,y){
  const R=G.R;
  for(let i=0;i<R.length;i++){ const r=R[i]; if(x>=r.x0 && x<=r.x1 && y>=r.y0 && y<=r.y1) return r; }
  return null;
}
// 0..1: what the rest leaves of the board here. Zero off the band, feathered
// at the band's top and the desktop's outer edges, zero over every panel.
function mask(G,x,y){
  const r=regionAt(G,x,y); if(!r) return 0;
  let w=ss(r.y0,r.y0+r.tf,y)*ss(G.ux0,G.ux0+G.m,x)*ss(G.ux1,G.ux1-G.m,x);
  if(w<=0) return 0;
  const P=G.rects;
  for(let i=0;i<P.length;i++){
    const R=P[i], ox=Math.max(R.x0-x,x-R.x1,0), oy=Math.max(R.y0-y,y-R.y1,0);
    if(ox<G.fade && oy<G.fade){ w*=ss(0,G.fade,Math.sqrt(ox*ox+oy*oy)); if(w<=0) return 0; }
  }
  return w;
}
function dens(G,x,y){
  const m=mask(G,x,y);
  return m>0 ? m*Math.max(ell(G,x,y), G.cmax*cor(G,x,y)) : 0;
}
// the filler follows the processor's falloff only, never the span corridor
function densFill(G,x,y){ const m=mask(G,x,y); return m>0 ? m*ell(G,x,y) : 0; }
// filler thins by 40% past 1.5 chip widths from the processor's edge
function cut(G,x,y){
  const e=Math.max(Math.abs(x-G.fx),Math.abs(y-G.fy))-G.H;
  return 1-0.4*ss(0.8,1.2,e/(3*G.H));
}
const inside=(G,x,y)=> regionAt(G,x,y)!==null;
function cellAt(G,x,y){
  const i=Math.round((x-G.fx)/G.p)-G.i0, j=Math.round((y-G.fy)/G.p)-G.j0;
  return (i<0||j<0||i>=G.cols||j>=G.rows) ? -1 : j*G.cols+i;
}
// A 3x3 neighborhood check keeps different buses at least one empty lane apart.
function blocked(G,x,y,id,par){
  const i=Math.round((x-G.fx)/G.p)-G.i0, j=Math.round((y-G.fy)/G.p)-G.j0;
  for(let b=j-1;b<=j+1;b++){ if(b<0||b>=G.rows) continue;
    for(let a=i-1;a<=i+1;a++){ if(a<0||a>=G.cols) continue;
      const v=G.occ[b*G.cols+a]; if(v!==0 && v!==id && v!==par) return true; } }
  return false;
}
function markSeg(G,ax,ay,bx,by,id){
  const n=Math.max(1,Math.ceil(Math.hypot(bx-ax,by-ay)/(G.p*0.5)));
  for(let t=0;t<=n;t++){
    const c=cellAt(G,ax+(bx-ax)*t/n, ay+(by-ay)*t/n);
    if(c>=0 && G.occ[c]===0) G.occ[c]=id;
  }
}
// lattice rects, in node units relative to the processor
function markNodes(G,i0,j0,i1,j1,id){
  for(let j=j0;j<=j1;j++) for(let i=i0;i<=i1;i++){
    const a=i-G.i0, b=j-G.j0;
    if(a>=0 && b>=0 && a<G.cols && b<G.rows) G.occ[b*G.cols+a]=id;
  }
}
function nodesFree(G,i0,j0,i1,j1){
  for(let j=j0;j<=j1;j++) for(let i=i0;i<=i1;i++){
    const a=i-G.i0, b=j-G.j0;
    if(a<0 || b<0 || a>=G.cols || b>=G.rows || G.occ[b*G.cols+a]!==0) return false;
    if(!inside(G,G.fx+i*G.p,G.fy+j*G.p)) return false;
  }
  return true;
}
function stepFree(G,x,y,c,k,id,par,from){
  const p=G.p, nx=perpX(c)*p, ny=perpY(c)*p, sx=DX[c]*p, sy=DY[c]*p;
  for(let m=0;m<k;m++){
    const o=m-(k-1)/2, bx=x+nx*o, by=y+ny*o;
    for(let t=from;t<=3;t++) if(blocked(G,bx+sx*t/3,by+sy*t/3,id,par)) return false;
  }
  return true;
}

/* Walk a bus centerline across the lattice. A fanout bus takes a stub, a
   45-degree diagonal and turns back outward; any bus may drift by 45 degrees
   later, but never more than 90 off its first heading, so it cannot loop.
   A bus with a `home` row (the span corridor) only jogs: a short diagonal,
   toward home when it has strayed, then straight on again. */
function route(G,sx,sy,d0,k,o){
  const p=G.p, V=[sx,sy], D=[];
  let x=sx,y=sy,d=d0,seg=0,steps=0,turn=0,phase=o.bend?0:2,end="via";
  const minSeg=Math.max(2,Math.ceil(k*0.5)+1), jog=o.home!==undefined;
  if(!o.par && !stepFree(G,x,y,d,k,o.id,0,0)) return null;
  while(steps<o.max){
    let want=d;
    if(phase===0 && seg>=o.stub){ want=(d+o.bend+8)&7; phase=1; }
    else if(phase===1 && seg>=o.diag){ want=(d-o.bend+8)&7; phase=2; }
    else if(phase===2 && jog && d!==d0 && seg>=minSeg+1) want=d0;
    else if(phase===2 && seg>=minSeg && steps>=o.calm && G.rnd()<o.turn){
      const c=(d+1)&7;
      if(jog && Math.abs(y-o.home)>3*p) want=((DY[c]>0)===(y<o.home)) ? c : (d+7)&7;
      else want=G.rnd()<0.5 ? c : (d+7)&7;
    }
    let nd=-1;
    const tries = want!==d ? [want,d] : (seg>=minSeg ? [d,(d+1)&7,(d+7)&7] : [d]);
    for(let q=0;q<tries.length;q++){
      const c=tries[q], dt=((c-d+12)%8)-4;
      if(c!==d && (seg<1 || Math.abs(turn+dt)>2)) continue;
      if(stepFree(G,x,y,c,k,o.id,o.par,1)){ nd=c; break; }
    }
    if(nd<0) break;
    const nx=x+DX[nd]*p, ny=y+DY[nd]*p;
    if(!inside(G,nx,ny)){
      const r=regionAt(G,x,y);
      if(o.run && r && ny>r.y1 && nd===d){ x=nx; y=ny+p; steps++; end="run"; }
      break;
    }
    if(dens(G,nx,ny)<o.thr){ end="fade"; break; }
    if(nd!==d){ V.push(x,y); D.push(d); turn+=((nd-d+12)%8)-4; d=nd; seg=0; }
    x=nx; y=ny; seg++; steps++;
  }
  if(steps<1) return null;
  V.push(x,y); D.push(d);
  return {V,D,end,k,steps,id:o.id,d};
}

// Offset every trace of a bus from its centerline, mitered at the bends so
// the bundle keeps its pitch through a 45-degree turn.
function busTraces(B,p){
  const V=B.V, D=B.D, nv=V.length/2, out=[];
  for(let m=0;m<B.k;m++){
    const off=(m-(B.k-1)/2)*p, pts=new Float32Array(nv*2);
    for(let j=0;j<nv;j++){
      let px,py;
      if(j===0){ px=perpX(D[0]); py=perpY(D[0]); }
      else if(j===nv-1){ px=perpX(D[D.length-1]); py=perpY(D[D.length-1]); }
      else{
        const ax=perpX(D[j-1]), ay=perpY(D[j-1]), bx=perpX(D[j]), by=perpY(D[j]);
        const q=1+ax*bx+ay*by; px=(ax+bx)/q; py=(ay+by)/q;
      }
      pts[2*j]=V[2*j]+px*off; pts[2*j+1]=V[2*j+1]+py*off;
    }
    out.push(pts);
  }
  return out;
}
function cumOf(pts){
  const n=pts.length/2, c=new Float32Array(n);
  for(let i=1;i<n;i++) c[i]=c[i-1]+Math.hypot(pts[2*i]-pts[2*i-2], pts[2*i+1]-pts[2*i-1]);
  return c;
}
function trimEnd(pts,e){
  if(e<=0) return pts;
  const c=cumOf(pts), n=c.length, L=c[n-1]-e;
  if(L<=0) return pts;
  let i=0; while(i<n-2 && c[i+1]<L) i++;
  const t=(L-c[i])/((c[i+1]-c[i])||1), out=new Float32Array((i+2)*2);
  out.set(pts.subarray(0,(i+1)*2));
  out[2*i+2]=pts[2*i]+(pts[2*i+2]-pts[2*i])*t;
  out[2*i+3]=pts[2*i+1]+(pts[2*i+3]-pts[2*i+1])*t;
  return out;
}
function pointAt(tr,a,out){
  const P=tr.pts, C=tr.cum, n=C.length;
  let i=0; while(i<n-2 && C[i+1]<a) i++;
  const t=clamp((a-C[i])/((C[i+1]-C[i])||1),0,1);
  out[0]=P[2*i]+(P[2*i+2]-P[2*i])*t; out[1]=P[2*i+1]+(P[2*i+3]-P[2*i+1])*t;
}
const PT=[0,0];
// how bright a comet may be at arc a: its copper's alpha against a bright trace's
const fadeAt=(tr,a)=>tr.fa[clamp(Math.round(a/tr.fs),0,tr.fa.length-1)];

function addVia(G,x,y,r){
  G.sg.vias.push(x,y,r,dens(G,x,y));
  const c=cellAt(G,x,y); if(c>=0 && G.occ[c]===0) G.occ[c]=-1;
}
function addTrace(G,pts,o){
  const cum=cumOf(pts), len=cum[cum.length-1];
  if(len<G.p*0.8) return null;
  for(let i=1;i<pts.length/2;i++) markSeg(G,pts[2*i-2],pts[2*i-1],pts[2*i],pts[2*i+1],o.id);
  const n=pts.length/2, boost=o.boost||0;
  const tr={ pts, cum, len, boost, chip:!!o.chip, bus:o.bus||null, sg:G.sg, nodes:[] };
  // the comet fade, sampled every two cells; vis0 is how far the trace stays
  // bright from its start, eff its length weighted by that brightness
  const fs=G.p*2, nf=Math.max(2,Math.ceil(len/fs)+1), fa=new Float32Array(nf);
  let eff=0, vis0=-1;
  for(let i=0;i<nf;i++){
    pointAt(tr,Math.min(len,i*fs),PT);
    fa[i]=Math.min(1,cuA(dens(G,PT[0],PT[1]),boost)/0.2);
    eff+=fa[i]; if(vis0<0 && fa[i]<0.5) vis0=i*fs;
  }
  tr.fa=fa; tr.fs=fs; tr.eff=eff/nf*len; tr.vis0=vis0<0 ? len : vis0;
  if(o.n0) tr.nodes.push(0, pts[0], pts[1], o.n0*fa[0]);
  if(o.n1) tr.nodes.push(len, pts[2*n-2], pts[2*n-1], o.n1*fa[nf-1]);
  let wsum=0;
  for(let i=0;i<n;i++) wsum+=dens(G,pts[2*i],pts[2*i+1]);
  tr.w=wsum/n;
  G.sg.traces.push(tr);
  return tr;
}

/* Turn a routed bus into traces. `end` decides the far end: staggered vias,
   a small chip, or nothing when the bus runs off the bottom of the monitor. */
function finishBus(G,B,o){
  const p=G.p, rv=p*0.3;
  let pts=busTraces(B,p);
  let ic=null;
  if((B.end==="fade" || B.end==="via") && o.ic && B.k>=2 && !(B.d&1) && G.rnd()<o.ic) ic=tryIC(G,B);
  const stag=(!ic && B.end!=="run") ? (G.rnd()<0.5?1:-1) : 0;
  const group=[];
  for(let m=0;m<B.k;m++){
    let q=pts[m];
    if(stag) q=trimEnd(q, (stag>0? m : B.k-1-m)*p*0.7);
    const n=q.length/2, ex=q[2*n-2], ey=q[2*n-1];
    const tr=addTrace(G,q,{id:B.id, boost:o.boost, chip:o.chip, n0:o.n0||(o.startVia?1:0),
                            n1: B.end==="run" ? 0 : (ic? 0.9 : 1)});
    if(!tr) continue;
    tr.bus=group; group.push(tr);
    if(o.startVia) addVia(G,q[0],q[1],rv);
    if(B.end!=="run" && !ic){
      if(o.pads && G.rnd()<o.pads) G.sg.pads.push(ex-p*0.3,ey-p*0.3,p*0.6,p*0.6,dens(G,ex,ey));
      else addVia(G,ex,ey,rv);
    }
  }
  if(ic) icBack(G,ic,o);
  return group;
}

/* A small chip where a straight bus ends, its front pins taking the bus.
   Some pass the bus on out of the back; the rest leave the back pins bare. */
function tryIC(G,B){
  const p=G.p, k=B.k, d=B.D[B.D.length-1], nv=B.V.length/2;
  const ex=B.V[2*nv-2], ey=B.V[2*nv-1];
  const depth=clamp(Math.round(k*0.6)+1,2,4), half=(k+1)/2;
  const ax=DX[d], ay=DY[d], cx=perpX(d), cy=perpY(d);
  const span=Math.ceil(half)+1;
  for(let u=1;u<=depth+3;u++) for(let v=-span;v<=span;v++){
    const x=ex+(ax*u+cx*v)*p, y=ey+(ay*u+cy*v)*p;
    if(!inside(G,x,y) || dens(G,x,y)<0.1) return null;
    const c=cellAt(G,x,y); if(c<0 || (G.occ[c]!==0 && G.occ[c]!==B.id)) return null;
  }
  const id=++G.id;
  for(let u=1;u<=depth+2;u++) for(let v=-span+1;v<=span-1;v++){
    const c=cellAt(G,ex+(ax*u+cx*v)*p, ey+(ay*u+cy*v)*p); if(c>=0) G.occ[c]=id;
  }
  // body corners along/across, in px from the bus end
  const a0=0.75*p, a1=(depth+1.25)*p, h=half*p;
  const P=(a,c)=>[ex+ax*a+cx*c, ey+ay*a+cy*c];
  const ic={ d, k, id, ex, ey, depth, body:[P(a0,-h),P(a1,-h),P(a1,h),P(a0,h)], pins:[], w:dens(G,ex,ey) };
  for(let m=0;m<k;m++){
    const off=(m-(k-1)/2)*p;
    ic.pins.push(P(0.4*p,off), P((depth+1.6)*p,off));
  }
  ic.notch=P(a0,0);
  ic.label=P((a0+a1)/2, h+0.85*p);
  ic.n=++G.sg.nIC+1;
  G.sg.ics.push(ic);
  return ic;
}
function icBack(G,ic,o){
  const p=G.p, d=ic.d, k=ic.k;
  const bx=ic.ex+DX[d]*(ic.depth+2)*p, by=ic.ey+DY[d]*(ic.depth+2)*p;
  if(!(dens(G,bx,by)>0.12 && G.rnd()<0.6)) return;
  // on the span corridor the bus runs on out toward the far edge
  const far = d===0 ? G.cxR : d===4 ? G.cxL : 0;
  const B=route(G,bx,by,d,k,{id:++G.id, par:ic.id, bend:0, max:far?Math.ceil(far/p):40,
                             thr:0.03+G.rnd()*0.06, turn:far?0.02:0.12, calm:2, run:true,
                             home:far?G.fy:undefined});
  if(B && B.steps>=4) finishBus(G,B,{boost:o.boost*0.5, n0:0.8, ic:0.25, pads:0.2});
}

/* The processor: a package on the lattice with pin groups on every side.
   Each group leaves as a bus; the few pins between groups escape through a
   short "dog-bone" stub to a via, the way a real fanout does. */
function addChip(G,ci,cj,main){
  const p=G.p, h=main?9:6, cx=G.fx+ci*p, cy=G.fy+cj*p, id=++G.id;
  if(!nodesFree(G,ci-h-2,cj-h-2,ci+h+2,cj+h+2)) return false;
  markNodes(G,ci-h-1,cj-h-1,ci+h+1,cj+h+1,id);
  const groups = main ? [[-2,2],[-7,-4],[4,7]] : [[-4,-2],[2,4]];
  const bones  = main ? [-8,-3,3,8] : [-5,0,5];
  const chip={ x:cx, y:cy, H:(h+0.5)*p, pins:[], main, id };
  G.H=chip.H;
  G.sg.chips.push(chip);
  const busList=[];
  for(const g of groups) for(let side=0;side<4;side++) busList.push([side,g]);
  for(const [side,g] of busList){
    const out=side*2, ax=-DY[out], ay=DX[out];            // along the side
    const k=g[1]-g[0]+1, c=(g[0]+g[1])/2;
    const sx=cx+DX[out]*(h+1)*p+ax*c*p, sy=cy+DY[out]*(h+1)*p+ay*c*p;
    const bend = c===0 ? 0 : (c>0?1:-1);
    const far = out===0 ? G.cxR : out===4 ? G.cxL : 0;
    const B=route(G,sx,sy,out,k,{ id:++G.id, par:id, bend, stub:1+(G.rnd()*2|0),
      diag:2+(G.rnd()*(main?6:4)|0), max:far ? Math.ceil(far/p)+20 : (main?140:70),
      thr:0.025+G.rnd()*0.07, turn:far?0.02:0.07, calm:bend?0:10, run:true,
      home:far?G.fy:undefined });
    if(!B) continue;
    finishBus(G,B,{boost:main?0.9:0.6, chip:true, n0:0.7, ic:main?0.55:0.35, pads:0.1});
  }
  for(let side=0;side<4;side++) for(const b of bones){
    const out=side*2, ax=-DY[out], ay=DX[out];
    const x=cx+DX[out]*(h+1)*p+ax*b*p, y=cy+DY[out]*(h+1)*p+ay*b*p;
    const tw = b===0 ? out : (b>0 ? (out+1)&7 : (out+7)&7);
    const x1=x+DX[out]*p, y1=y+DY[out]*p, x2=x1+DX[tw]*p*(b===0?1.5:1), y2=y1+DY[tw]*p*(b===0?1.5:1);
    const bid=++G.id;
    if(blocked(G,x2,y2,bid,id)) continue;
    const tr=addTrace(G,new Float32Array([x,y,x1,y1,x2,y2]),{id:bid, boost:0.6, chip:true, n0:0.7, n1:1});
    if(tr) addVia(G,x2,y2,p*0.3);
  }
  // pin pads for every group and bone
  const all=[]; for(const g of groups) for(let i=g[0];i<=g[1];i++) all.push(i);
  for(const b of bones) all.push(b);
  for(let side=0;side<4;side++){
    const out=side*2, ax=-DY[out], ay=DX[out];
    for(const i of all){
      const px=cx+DX[out]*(chip.H+0.2*p)+ax*i*p, py=cy+DY[out]*(chip.H+0.2*p)+ay*i*p;
      const lw=0.42*p, ll=0.8*p;
      if(DX[out]) chip.pins.push(px-ll/2,py-lw/2,ll,lw); else chip.pins.push(px-lw/2,py-ll/2,lw,ll);
    }
  }
  return true;
}

// A two-pad passive (a decoupling cap or a resistor) with its silkscreen box.
function addPassive(G,i,j,horiz,label){
  const i1=horiz?i+1:i, j1=horiz?j:j+1;
  if(!nodesFree(G,i-1,j-1,i1+1,j1+1)) return false;
  const id=++G.id; markNodes(G,i-1,j-1,i1+1,j1+1,id);
  const p=G.p, x0=G.fx+i*p, y0=G.fy+j*p, x1=G.fx+i1*p, y1=G.fy+j1*p, w=dens(G,(x0+x1)/2,(y0+y1)/2);
  const pw=horiz?0.55*p:0.8*p, ph=horiz?0.8*p:0.55*p;
  G.sg.pads.push(x0-pw/2,y0-ph/2,pw,ph,w, x1-pw/2,y1-ph/2,pw,ph,w);
  const m=0.55*p, n=0.6*p;
  G.sg.boxes.push(horiz ? [x0-m,y0-n,x1-x0+2*m,2*n,w] : [x0-n,y0-m,2*n,y1-y0+2*m,w]);
  if(label && G.sg.text.length<14)
    G.sg.text.push(horiz ? [label,(x0+x1)/2,y0-n-0.55*p,w] : [label,x1+n+0.3*p,(y0+y1)/2,w,"left"]);
  return true;
}
// is there copper two nodes out from (i,j)? A passive placed there sits beside it
function nearCopper(G,i,j){
  for(let b=j-2;b<=j+2;b++) for(let a=i-2;a<=i+2;a++){
    if(Math.max(Math.abs(a-i),Math.abs(b-j))!==2) continue;
    const u=a-G.i0, v=b-G.j0;
    if(u>=0 && v>=0 && u<G.cols && v<G.rows && G.occ[v*G.cols+u]>0) return true;
  }
  return false;
}

/* Where the board can go: for every monitor, the part of it that a band
   canvas covers (the band with the most overlap). The primary gets the
   processor; the others only what its buses carry out to them. */
function regions(){
  if(typeof TERS==="undefined" || !TERS.length) return null;
  const B=TERS.map(T=>({x0:T.x, y0:T.y, x1:T.x+T.w, y1:T.y+T.h}));
  let S=(LAY.screens||[]).filter(s=>s.w>0 && s.h>0), pi=LAY.primary|0;
  if(!S.length){
    const T=TERS[0], lh=T.h/SCENES.circuit.band;
    S=[{x:T.x, y:T.y+T.h-lh, w:T.w, h:lh}]; pi=0;
  }
  const R=[]; let prim=null;
  S.forEach((s,i)=>{
    let best=null, ba=0;
    for(const b of B){
      const x0=Math.max(b.x0,s.x), x1=Math.min(b.x1,s.x+s.w), y0=Math.max(b.y0,s.y), y1=Math.min(b.y1,s.y+s.h);
      if(x1>x0 && y1>y0 && (x1-x0)*(y1-y0)>ba){ ba=(x1-x0)*(y1-y0); best={x0,x1,y0,y1,s}; }
    }
    if(!best || best.x1-best.x0<240 || best.y1-best.y0<160) return;
    best.tf=(best.y1-best.y0)*0.18;
    R.push(best); if(i===pi) prim=best;
  });
  if(!R.length) return null;
  if(!prim) prim=R.reduce((a,b)=>(b.x1-b.x0)*(b.y1-b.y0)>(a.x1-a.x0)*(a.y1-a.y0) ? b : a);
  return {R, prim, pi};
}

function genBoard(L,geo){
  const {R,prim}=geo, s=prim.s;
  const rem=clamp(0.013*Math.min(s.w,s.h),9,30), remU=rem*clamp(+CFG.uiScale||1,0.5,2);
  const p=Math.max(6,Math.round(rem*0.58));
  const sg={ p, lw:p>=22?1.5:1, traces:[], vias:[], pads:[], chips:[], ics:[], boxes:[], text:[], nIC:1, paths:null };
  const ux0=Math.min(...R.map(r=>r.x0)), ux1=Math.max(...R.map(r=>r.x1));
  const uy0=Math.min(...R.map(r=>r.y0)), uy1=Math.max(...R.map(r=>r.y1));
  const seed=(Math.round(s.w)*73856093) ^ (Math.round(s.h)*19349663) ^ (geo.pi*83492791) ^ Math.round(ux1-ux0);
  const G={ L, sg, p, rnd:rng(seed), id:0, R, prim, ux0, ux1, uy0, uy1, rects:ST.rects,
            fade:3.5*remU, m:p*2, e0:0.3, cmax:0.4, nc:1, H:p*9.5 };
  G.fx=Math.round(s.x+s.w/2)+0.5;
  G.fy=Math.round(clamp(s.y+s.h*0.6, prim.y0+(prim.y1-prim.y0)*0.38, prim.y1-(prim.y1-prim.y0)*0.22))+0.5;
  // The ellipse reaches its rim near the inside edge of the corner stacks
  // (the layout engine's own rules: 25rem columns, the 2:1 ultrawide guard)
  // and at the top of the band, so the panels only ever trim its faint rim.
  const edge=Math.max(0.022,(1-2*s.h/s.w)/2)*s.w;
  const colW=Math.min(25*remU,(s.w/s.h<1.3?0.46:0.34)*s.w);
  G.rx=clamp(s.w/2-edge-0.8*colW, 0.4*Math.min(s.w,s.h), 0.5*s.w);
  G.ryU=Math.max(p*8, G.fy-prim.y0);
  G.ryD=0.5*Math.min(s.h,1.2*s.w);
  // a monitor beside the primary opens the corridor on that side
  G.cxL=R.some(r=>r!==prim && r.x1<=prim.x0+1) ? G.fx-ux0 : 0;
  G.cxR=R.some(r=>r!==prim && r.x0>=prim.x1-1) ? ux1-G.fx : 0;
  G.cy=0.3*s.h;
  G.i0=Math.floor((ux0-G.fx)/p)-1; G.j0=Math.floor((uy0-G.fy)/p)-1;
  G.cols=Math.ceil((ux1-G.fx)/p)+2-G.i0; G.rows=Math.ceil((uy1-G.fy)/p)+2-G.j0;
  G.occ=new Int32Array(G.cols*G.rows);

  if(!addChip(G,0,0,true)) addChip(G,0,0,false);
  const h=9;
  // decoupling caps hug the processor's corners
  for(const [sx,sy] of [[1,1],[-1,1],[1,-1],[-1,-1]]){
    if(addPassive(G, sx>0?h+3:-h-4, sy*(h+3), true, "C"+G.nc)) G.nc++;
    if(addPassive(G, sx*(h+3), sy>0?h+5:-h-6, false, null)) G.nc++;
  }
  /* Fill, on the primary only: passives, a few stitching via fields close
     to the processor, and short buses. A filler bus must run at least four
     cells on every lane, or it is a stub that routes nowhere. */
  const pi0=Math.floor((prim.x0-G.fx)/p), pj0=Math.floor((prim.y0-G.fy)/p);
  const pc=Math.ceil((prim.x1-G.fx)/p)-pi0+1, pr=Math.ceil((prim.y1-G.fy)/p)-pj0+1, Rn=G.rnd;
  for(let a=0;a<pc*pr*0.5;a++){
    const i=pi0+(Rn()*pc|0), j=pj0+(Rn()*pr|0), x=G.fx+i*p, y=G.fy+j*p;
    const w=densFill(G,x,y), c=cut(G,x,y);
    if(Rn()>w*w*1.15*c) continue;
    const roll=Rn();
    if(roll<0.035){ addPassive(G,i,j,Rn()<0.6, Rn()<0.3?(Rn()<0.5?"R":"C")+(G.nc++):null); continue; }
    if(roll<0.05){
      if(c<0.99) continue;
      const aw=2+(Rn()*2|0), ah=2+(Rn()*3|0);
      if(!nodesFree(G,i-1,j-1,i+aw,j+ah)) continue;
      markNodes(G,i-1,j-1,i+aw,j+ah,-1);
      for(let v=0;v<ah;v++) for(let u=0;u<aw;u++) G.sg.vias.push(x+u*p,y+v*p,p*0.24,w);
      continue;
    }
    const d=Rn()<0.7 ? (Rn()*4|0)*2 : (Rn()*4|0)*2+1;
    const kr=Rn(), k=kr<0.45?1:kr<0.75?2:kr<0.92?3:4;
    const B=route(G,x,y,d,k,{ id:++G.id, par:0, bend:0, max:4+(Rn()*(8+16*w)|0), thr:0.03,
                              turn:0.2, calm:0, run:true });
    if(!B || B.steps<4+Math.ceil((k-1)*0.7)) continue;
    finishBus(G,B,{boost:0, startVia:true, ic:0.08, pads:0.22});
  }
  // a few passives on each side monitor, each set beside the copper there
  for(const r of R){
    if(r===prim) continue;
    let n=3+(Rn()*2|0);
    for(let a=0;a<600 && n>0;a++){
      const i=Math.round((r.x0+Rn()*(r.x1-r.x0)-G.fx)/p), j=Math.round((r.y0+Rn()*(r.y1-r.y0)-G.fy)/p);
      if(dens(G,G.fx+i*p,G.fy+j*p)<0.15 || !nearCopper(G,i,j)) continue;
      if(addPassive(G,i,j,Rn()<0.7, Rn()<0.5?(Rn()<0.5?"R":"C")+(G.nc++):null)) n--;
    }
  }
  buildPaths(sg,G);
  L.sgs.push(sg);
}

function buildPaths(sg,G){
  const mk=n=>Array.from({length:n},()=>new Path2D());
  const P={ tr:mk(NLV), via:mk(NLV), pad:mk(NLV), silk:mk(4), icBody:mk(4), icPins:mk(4),
            body:new Path2D(), pins:new Path2D(), csilk:new Path2D(), inner:new Path2D(),
            die:new Path2D(), dieGrid:new Path2D() };
  const run=sg.p*3;
  for(const tr of sg.traces){
    const q=tr.pts, n=q.length/2, b=tr.boost;
    // a run's level comes from the density a little ahead of where it starts
    const lvAt=(x,y,i)=>{ const j=Math.min(i,n-1); return lvOf(cuA(dens(G,(x+q[2*j])/2,(y+q[2*j+1])/2),b)); };
    let px=q[0], py=q[1], acc=0, lv=lvAt(px,py,1), cur=lv<0?null:P.tr[lv];
    if(cur) cur.moveTo(px,py);
    for(let i=1;i<n;i++){
      const x=q[2*i], y=q[2*i+1], L=Math.hypot(x-px,y-py);
      let t0=0;
      while(L>0 && acc+L*(1-t0)>run){
        const t=t0+(run-acc)/L, mx=px+(x-px)*t, my=py+(y-py)*t;
        if(cur) cur.lineTo(mx,my);
        lv=lvAt(mx,my,i); cur=lv<0?null:P.tr[lv];
        if(cur) cur.moveTo(mx,my);
        acc=0; t0=t;
      }
      acc+=L*(1-t0);
      if(cur) cur.lineTo(x,y);
      px=x; py=y;
    }
  }
  const V=sg.vias;
  for(let i=0;i<V.length;i+=4){
    const lv=lvOf(cuA(V[i+3],0.7)); if(lv<0) continue;
    const x=V[i], y=V[i+1], r=V[i+2], path=P.via[lv];
    path.moveTo(x+r,y); path.arc(x,y,r,0,Math.PI*2);
    path.moveTo(x+r*0.45,y); path.arc(x,y,r*0.45,0,Math.PI*2,true);   // the drill hole
  }
  const D=sg.pads;
  for(let i=0;i<D.length;i+=5){ const lv=lvOf(cuA(D[i+4],0.8)); if(lv>=0) P.pad[lv].rect(D[i],D[i+1],D[i+2],D[i+3]); }
  for(const b of sg.boxes){ const k=pbOf(b[4]); if(k>=0) P.silk[k].rect(b[0],b[1],b[2],b[3]); }
  const p=sg.p;
  for(const c of sg.chips){
    const H=c.H, x=c.x, y=c.y, ch=1.4*p;
    P.body.moveTo(x-H+ch,y-H); P.body.lineTo(x+H,y-H); P.body.lineTo(x+H,y+H);
    P.body.lineTo(x-H,y+H); P.body.lineTo(x-H,y-H+ch); P.body.closePath();
    const I=H-0.6*p; P.inner.rect(x-I,y-I,2*I,2*I);
    // a coarse die: its cells must stay a readable size at 4K
    const Dh=H*0.42; P.die.rect(x-Dh,y-Dh,2*Dh,2*Dh);
    const n=c.main?6:5, cell=2*Dh/n, g=cell*0.2;
    for(let a=0;a<n;a++) for(let b=0;b<n;b++) P.dieGrid.rect(x-Dh+a*cell+g,y-Dh+b*cell+g,cell-2*g,cell-2*g);
    c.die={ x0:x-Dh+g, y0:y-Dh+g, cell, sz:cell-2*g, n, v:new Float32Array(n*n), dh:Dh };
    const pr=0.28*p; P.csilk.moveTo(x-H+ch+0.5*p+pr,y-H+ch+0.5*p); P.csilk.arc(x-H+ch+0.5*p,y-H+ch+0.5*p,pr,0,Math.PI*2);
    const pn=c.pins; for(let i=0;i<pn.length;i+=4) P.pins.rect(pn[i],pn[i+1],pn[i+2],pn[i+3]);
    sg.text.push([c.main?"U1":"U"+(sg.nIC+1), x-H, y-H-1.3*p, 1, "left"]);
    c.lab=[c.main?"CYBERCORE":"IO-"+(sg.p|0), x, y+Dh+(H-Dh)*0.5];
  }
  for(const ic of sg.ics){
    const k=pbOf(ic.w); if(k<0) continue;
    const b=ic.body, B=P.icBody[k], N=P.icPins[k];
    B.moveTo(b[0][0],b[0][1]); for(let i=1;i<4;i++) B.lineTo(b[i][0],b[i][1]); B.closePath();
    const pw=0.4*p, pl=0.7*p, hor=!(ic.d%4===2);
    for(const [x,y] of ic.pins){ if(hor) N.rect(x-pl/2,y-pw/2,pl,pw); else N.rect(x-pw/2,y-pl/2,pw,pl); }
    const r=0.3*p, a=Math.atan2(DY[ic.d],DX[ic.d]);
    P.silk[k].moveTo(ic.notch[0]+r*Math.cos(a-Math.PI/2),ic.notch[1]+r*Math.sin(a-Math.PI/2));
    P.silk[k].arc(ic.notch[0],ic.notch[1],r,a-Math.PI/2,a+Math.PI/2);
    sg.text.push(["U"+ic.n, ic.label[0], ic.label[1], ic.w]);
  }
  sg.paths=P;
}

function genLayout(){
  const L={ sgs:[], pulses:[], flares:[], cdf:null, pick:[], rate:0, acc:0 };
  const geo=regions();
  if(geo) genBoard(L,geo);
  // pulses favor the processor's buses and the copper that is actually lit
  let acc=0; const w=[];
  for(const sg of L.sgs) for(const tr of sg.traces){
    if(tr.len<sg.p*4 || tr.eff<sg.p*3) continue;
    acc+=tr.eff*(tr.chip?2.4:1)*(0.25+tr.w);
    L.pick.push(tr); w.push(acc);
    L.rate+=tr.eff/sg.p/300;
  }
  L.cdf=Float64Array.from(w);
  return L;
}
// the board, laid out again whenever a band was resized or a panel moved
function ensure(){
  if(ST.L && !ST.dirty) return ST.L;
  ST.dirty=false; ST.pend=null;
  ST.rects=readRects();
  const L=ST.L=genLayout();
  // a few seconds of traffic up front, so a fresh board is never empty
  for(let i=0;i<60;i++) stepLayout(L,0.05,0.6,false);
  return L;
}

/* ---------------- light ---------------- */

function pickTrace(L){
  const n=L.pick.length; if(!n) return null;
  const r=Math.random()*L.cdf[n-1];
  let lo=0, hi=n-1;
  while(lo<hi){ const m=(lo+hi)>>1; if(L.cdf[m]<r) lo=m+1; else hi=m; }
  return L.pick[lo];
}
function flare(L,x,y,r,str){
  if(L.flares.length>=90 || str<0.03) return;
  L.flares.push({x,y,r,str,age:0});
}
function launch(L,tr,dir,delay,v,tail){
  const p=tr.sg.p;
  L.pulses.push({ tr, dir, s:-delay, v:v||p*(12+Math.random()*6), tail:tail||p*(9+Math.random()*6), c:-1, f:0 });
}
function spawn(L,burst){
  let tr=pickTrace(L); if(!tr) return;
  if(burst){ for(let i=0;i<6 && !(tr.chip && tr.bus && tr.bus.length>2);i++) tr=pickTrace(L); }
  const dir = tr.chip ? (Math.random()<(burst?0.9:0.6)?1:-1) : (Math.random()<0.5?1:-1);
  const p=tr.sg.p;
  // a packet: every lane of the bus fires together, a little ragged
  if(tr.bus && tr.bus.length>1 && (burst || Math.random()<(tr.chip?0.45:0.25))){
    const v=p*(14+Math.random()*5), tail=p*(10+Math.random()*5);
    for(const t of tr.bus) launch(L,t,dir,Math.random()*p*1.5,v,tail);
  }else launch(L,tr,dir,0);
}
// head position in the trace's own direction (0 = its first point)
const headA=(P)=>{ const s=Math.min(P.s,P.tr.len); return P.dir>0 ? s : P.tr.len-s; };

function stepLayout(L,dt,rate,burst){
  L.acc+=dt*L.rate*rate;
  let n=0;
  while(L.acc>=1 && n<6){ L.acc-=1; n++; if(L.pulses.length<160) spawn(L,false); }
  if(L.acc>1) L.acc=1;
  if(burst) for(let b=0;b<2 && L.pulses.length<160;b++) spawn(L,true);
  const P=L.pulses;
  for(let i=P.length-1;i>=0;i--){
    const q=P[i], tr=q.tr, s0=q.s;
    q.s+=q.v*dt;
    // a node lights when the head crosses it
    const N=tr.nodes;
    for(let j=0;j<N.length;j+=4){
      const a = q.dir>0 ? N[j] : tr.len-N[j];
      if(a===0 ? (s0<=0 && q.s>0) : (a>s0 && a<=q.s)){
        const p=tr.sg.p;
        flare(L,N[j+1],N[j+2],p*(a>0?1.5:1.0),N[j+3]*(a>0?1:0.5));
        if(a>0 && tr.chip && q.dir<0) ST.kick=Math.min(1,ST.kick+0.05);
      }
    }
    if(q.s-q.tail>tr.len){ P[i]=P[P.length-1]; P.pop(); }
  }
  const F=L.flares;
  for(let i=F.length-1;i>=0;i--){ F[i].age+=dt; if(F[i].age>FLARE_LIFE){ F[i]=F[F.length-1]; F.pop(); } }
  // the die computes: cells light at the pulse rate and cool off over ~0.7 s
  const cool=Math.exp(-dt/0.7);
  for(const sg of L.sgs) for(const c of sg.chips){
    const D=c.die, V=D.v;
    for(let i=0;i<V.length;i++) V[i]*=cool;
    D.acc=(D.acc||0)+dt*rate*(c.main?4:2);
    let m=burst?3:0;
    while(D.acc>=1){ D.acc-=1; m++; }
    while(m-->0) V[Math.random()*V.length|0]=0.6+0.4*Math.random();
  }
}

function styles(ctx){
  if(ST.gen===PAL.gen && ST.sprCtx===ctx) return;
  ST.gen=PAL.gen; ST.sprCtx=ctx;
  const h=PAL.h, s=PAL.s, lit=clamp(PAL.l+8,0,80), hot=clamp(PAL.l+32,62,94);
  // on OLED black a pale accent's heads come close to white: take the
  // bright front of every comet down a fifth
  const om=CFG.oledMode?0.8:1;
  ST.head=0.9*om;
  ST.sty={ tail:TAIL_A.map(a=>hslStr(h,s,hot,a>=0.5?a*om:a)), halo:hslStr(h,s,lit,0.045), body:hslStr(h,s,hot,0.13),
           cell:Array.from({length:8},(_,j)=>hslStr(h,s,hot,0.06*j)) };
  // one unit sprite per look, scaled by the transform: heads and flares...
  const g=ctx.createRadialGradient(0,0,0,0,0,1);
  g.addColorStop(0,   hslStr(h,clamp(s-40,0,100),97,0.95));
  g.addColorStop(0.12,hslStr(h,s,hot,0.55));
  g.addColorStop(0.4, hslStr(h,s,lit,0.14));
  g.addColorStop(1,   hslStr(h,s,lit,0));
  ST.spr=g;
  // ...and the processor's core glow, which has no hot center
  const c=ctx.createRadialGradient(0,0,0,0,0,1);
  c.addColorStop(0,  hslStr(h,s,lit,0.55));
  c.addColorStop(0.45,hslStr(h,s,lit,0.18));
  c.addColorStop(1,  hslStr(h,s,lit,0));
  ST.glow=c;
}

function emitRange(ctx,tr,a,b){
  if(a<0) a=0; if(b>tr.len) b=tr.len; if(b-a<0.5) return;
  const P=tr.pts, C=tr.cum, n=C.length;
  let i=0; while(i<n-2 && C[i+1]<=a) i++;
  let t=(a-C[i])/((C[i+1]-C[i])||1);
  ctx.moveTo(P[2*i]+(P[2*i+2]-P[2*i])*t, P[2*i+1]+(P[2*i+3]-P[2*i+1])*t);
  while(i<n-2 && C[i+1]<b){ i++; ctx.lineTo(P[2*i],P[2*i+1]); }
  t=(b-C[i])/((C[i+1]-C[i])||1);
  ctx.lineTo(P[2*i]+(P[2*i+2]-P[2*i])*t, P[2*i+1]+(P[2*i+3]-P[2*i+1])*t);
}

function sprite(ctx,g,x,y,r,a){
  const k=ST.k;
  ctx.globalAlpha=a; ctx.fillStyle=g;
  ctx.setTransform(k*r,0,0,k*r,k*x,k*y);
  ctx.fillRect(-1,-1,2,2);
}

/* Everything that glows, in viewport px on the sky: the core glow under the
   processor, flares, then tails (one path per alpha step and strength class,
   all pulses at once), then heads. */
function drawLight(K,L){
  const ctx=K.ctx;
  styles(ctx);
  if(ctx.canvas.width!==ST.kw){ ST.kw=ctx.canvas.width; ST.k=ctx.getTransform().a||1; }
  const k=ST.k, sty=ST.sty;
  ctx.setTransform(k,0,0,k,0,0);
  ctx.clearRect(0,0,K.w,K.h);
  if(!L || !L.sgs.length) return;
  const core=clamp(ST.core,0,1), lw=L.sgs[0].p;
  // the processor lights the board around it: a wide pool and a tighter core
  for(const sg of L.sgs) for(const c of sg.chips){
    sprite(ctx,ST.glow,c.x,c.y,c.H*(c.main?3.6:2.6),core*(c.main?0.30:0.16));
    sprite(ctx,ST.glow,c.x,c.y,c.H*1.35,core*(c.main?0.6:0.35));
    const D=c.die, V=D.v;
    ctx.globalAlpha=1; ctx.setTransform(k,0,0,k,0,0);
    for(let i=0;i<V.length;i++){
      const j=Math.round(V[i]*7); if(!j) continue;
      ctx.fillStyle=sty.cell[j];
      ctx.fillRect(D.x0+(i%D.n)*D.cell, D.y0+((i/D.n)|0)*D.cell, D.sz, D.sz);
    }
  }
  for(const f of L.flares){
    const u=1-f.age/FLARE_LIFE, a=f.str*u*u*(f.age<0.06?f.age/0.06:1);
    if(a>0.01) sprite(ctx,ST.spr,f.x,f.y,f.r*(1.2+0.6*(1-u)),a*0.8);
  }
  // grade every live pulse by the copper under its head
  const P=L.pulses;
  for(const q of P){
    if(q.s<=0){ q.c=-1; continue; }
    q.f=fadeAt(q.tr,headA(q)); q.c=cfOf(q.f);
  }
  ctx.setTransform(k,0,0,k,0,0);
  ctx.lineJoin="round";
  for(let c=0;c<CF.length;c++){
    ctx.globalAlpha=CF[c];
    // soft body along the front of each tail: one path, stroked wide then narrow
    ctx.lineCap="round"; ctx.beginPath();
    let any=false;
    for(const q of P){
      if(q.c!==c) continue;
      const h=headA(q), t=q.tail*0.35;
      if(q.dir>0) emitRange(ctx,q.tr,h-t,h); else emitRange(ctx,q.tr,h,h+t);
      any=true;
    }
    if(!any) continue;
    ctx.strokeStyle=sty.halo; ctx.lineWidth=Math.max(5,lw*0.62); ctx.stroke();
    ctx.strokeStyle=sty.body; ctx.lineWidth=Math.max(2.5,lw*0.24); ctx.stroke();
    ctx.lineCap="butt"; ctx.lineWidth=Math.max(1.25,lw*0.1);
    for(let j=0;j<TAIL_A.length;j++){
      ctx.strokeStyle=sty.tail[j]; ctx.beginPath();
      for(const q of P){
        if(q.c!==c) continue;
        const seg=q.tail/TAIL_A.length, a0=q.s-q.tail+j*seg, a1=a0+seg;
        if(a1<=0) continue;
        // tail steps in travel distance, mapped onto the trace's own direction
        if(q.dir>0) emitRange(ctx,q.tr,a0,Math.min(a1,q.s));
        else emitRange(ctx,q.tr,q.tr.len-Math.min(a1,q.s),q.tr.len-a0);
      }
      ctx.stroke();
    }
  }
  for(const q of P){
    if(q.c<0 || q.s>q.tr.len) continue;
    pointAt(q.tr,headA(q),PT);
    sprite(ctx,ST.spr,PT[0],PT[1],lw*1.05,ST.head*q.f);
  }
  ctx.globalAlpha=1;
  ctx.setTransform(k,0,0,k,0,0);
}

/* ---------------- the board ---------------- */

// one band's window onto the board, which lives in viewport px
function drawBoard(T,L){
  const ctx=T.ctx;
  ctx.clearRect(0,0,T.w,T.h);
  T.cbGen=PAL.gen; T.cbL=L;
  if(!L.sgs.length) return;
  const h=PAL.h, s=PAL.s, lit=clamp(PAL.l+8,0,80);
  const col=a=>hslStr(h,s,lit,a);
  if(!ST.font){
    try{ ST.font=getComputedStyle(document.body).fontFamily; }catch(e){}
    ST.font=ST.font||"Consolas, monospace";
  }
  ctx.save(); ctx.translate(-T.x,-T.y);
  for(const sg of L.sgs){
    const P=sg.paths, p=sg.p;
    ctx.lineWidth=sg.lw; ctx.lineJoin="round"; ctx.lineCap="butt";
    for(let v=0;v<NLV;v++){ ctx.strokeStyle=col(LVA[v]); ctx.stroke(P.tr[v]); }
    for(let v=0;v<NLV;v++){ ctx.fillStyle=col(Math.min(0.39,LVA[v]*1.5)); ctx.fill(P.via[v]); ctx.fill(P.pad[v]); }
    // small chips and silkscreen, dimmed with the board around them
    for(let b=0;b<4;b++){
      const f=PB[b];
      ctx.fillStyle=col(0.025*f); ctx.fill(P.icBody[b]);
      ctx.strokeStyle=col(0.34*f); ctx.stroke(P.icBody[b]);
      ctx.fillStyle=col(0.36*f); ctx.fill(P.icPins[b]);
      ctx.strokeStyle=col(0.16*f); ctx.stroke(P.silk[b]);
    }
    // the processor: a whisper of fill, a crisp outline, the die and its cells
    ctx.fillStyle=col(0.025); ctx.fill(P.body);
    ctx.strokeStyle=col(0.34); ctx.stroke(P.body);
    ctx.strokeStyle=col(0.10); ctx.stroke(P.inner);
    ctx.fillStyle=col(0.04); ctx.fill(P.die);
    ctx.fillStyle=col(0.07); ctx.fill(P.dieGrid);
    ctx.strokeStyle=col(0.28); ctx.stroke(P.die);
    ctx.fillStyle=col(0.36); ctx.fill(P.pins);
    ctx.strokeStyle=col(0.16); ctx.stroke(P.csilk);
    // silkscreen legends, never under 12 px at 4K
    const fs=Math.max(8,Math.round(p*0.8));
    ctx.font=`${fs}px ${ST.font}`; ctx.textBaseline="middle";
    try{ ctx.letterSpacing=(fs*0.12).toFixed(1)+"px"; }catch(e){}
    for(const t of sg.text){
      const f=pfOf(t[3]); if(f<0.12) continue;
      ctx.textAlign=t[4]||"center";
      ctx.fillStyle=col(0.28*f);
      ctx.fillText(t[0],t[1],t[2]);
    }
    for(const c of sg.chips){
      ctx.textAlign="center"; ctx.fillStyle=col(0.26);
      ctx.font=`${Math.max(9,Math.round(p*(c.main?0.95:0.8)))}px ${ST.font}`;
      try{ ctx.letterSpacing=(p*0.22).toFixed(1)+"px"; }catch(e){}
      ctx.fillText(c.lab[0],c.lab[1],c.lab[2]);
    }
    try{ ctx.letterSpacing="0px"; }catch(e){}
  }
  ctx.restore();
}

/* A composed frame for game mode: packets caught mid-flight on some of the
   processor's buses, a few lone comets out on the board, the vias they just
   reached still lit, and a calm core. Seeded, so every still is the same. */
function stillLight(L){
  const r=rng(0x51ED+L.pick.length);
  const seen=new Set(), buses=[], lone=[], pulses=[], flares=[];
  for(const tr of L.pick){
    if(tr.chip && tr.bus && tr.bus.length>1){ if(!seen.has(tr.bus)){ seen.add(tr.bus); buses.push(tr.bus); } }
    else if(tr.eff>tr.sg.p*6) lone.push(tr);
  }
  const take=(A,n)=>{ const out=[]; A=A.slice();
    while(out.length<n && A.length){ const i=r()*A.length|0; out.push(A[i]); A[i]=A[A.length-1]; A.pop(); }
    return out; };
  const nb=Math.max(4,Math.round(2+buses.length*0.3));
  // packets sit on the lit stretch of a bus, not out where it has faded
  for(const B of take(buses,nb)){
    let m=Infinity; for(const t of B) m=Math.min(m,t.vis0);
    const p=B[0].sg.p, s=m*(0.3+0.45*r()), tail=p*(10+r()*4);
    for(const t of B) pulses.push({tr:t,dir:1,s:s+r()*p*1.2,v:0,tail,c:-1,f:0});
  }
  for(const tr of take(lone,Math.round(nb*1.3))){
    const p=tr.sg.p, dir=r()<0.5?1:-1, arrive=r()<0.4;
    pulses.push({tr,dir,s:tr.len*(arrive?0.97:0.35+0.45*r()),v:0,tail:p*(9+r()*6),c:-1,f:0});
    if(!arrive) continue;
    const N=tr.nodes, want=dir>0?tr.len:0;
    for(let j=0;j<N.length;j+=4) if(N[j]===want && N[j+3]>0.03) flares.push({x:N[j+1],y:N[j+2],r:p*1.5,str:N[j+3],age:0.1});
  }
  // a still die: a scatter of cells at rest, the same one every time
  for(const sg of L.sgs) for(const c of sg.chips){
    const V=c.die.v; for(let i=0;i<V.length;i++) V[i]=r()<0.2 ? 0.25+0.6*r() : 0;
  }
  return {sgs:L.sgs, pulses, flares};
}

SCENES.circuit={
  label:"Circuit",
  band:0.7,
  // a band was (re)sized: lay the board out again once every band is known
  init(){ ST.dirty=true; },
  frame(dt,S){
    ST.frames++;
    if(!(S.t>=ST.rt && S.t-ST.rt<1)) checkRects(S.t);
    const L=ensure();
    const sec=Math.min(dt,64)*0.001;
    // kicks: the low band jumping above its own recent level fires the processor
    const e=S.energy||0;
    ST.eSlow+= (e-ST.eSlow)*(1-Math.exp(-sec/0.5));
    const burst = e-ST.eSlow>0.06 && e>0.1 && S.t-ST.burstAt>0.28;
    if(burst){ ST.burstAt=S.t; ST.kick=Math.min(1,ST.kick+0.35); }
    ST.kick*=Math.exp(-sec/0.5);
    ST.core+= ((0.25+0.9*e+ST.kick)-ST.core)*(1-Math.exp(-sec/0.25));
    stepLayout(L,sec,0.45+2.2*e,burst);
  },
  draw(T){
    const L=ensure();
    // redraw on a new palette or layout, or when a frame went by without us
    // (the band was cleared while the scene was hidden)
    if(T.cbGen!==PAL.gen || T.cbL!==L || T.cbF!==ST.frames-1) drawBoard(T,L);
    T.cbF=ST.frames;
  },
  // light with no board under it would be comets crossing empty black
  sky(K){ if(CFG.terrain) drawLight(K,ensure()); else K.ctx.clearRect(0,0,K.w,K.h); },
  still(T){ drawBoard(T,ensure()); T.cbF=-9; },
  stillSky(K){
    if(!CFG.terrain){ K.ctx.clearRect(0,0,K.w,K.h); return; }
    ST.core=0.45; drawLight(K,stillLight(ensure()));
  }
};
})();
