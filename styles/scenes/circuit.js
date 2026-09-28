/* =========================================================================
   SCENE: CIRCUIT
   A circuit board, laid out once per canvas size: a processor at each
   monitor's lower middle (the primary's at T.cx), bus bundles fanning out
   from its pins with proper 45-degree miters, smaller chips where a bus runs
   out, and short traces, passives and via fields filling the gaps. Density
   falls off toward the corners, where the panels sit.

   The board never moves, so it is drawn once into the band canvas and left
   there: a canvas keeps its pixels, and a band that does not change costs the
   compositor nothing per frame. Only the light moves: comets running along
   the traces, vias flaring as they arrive, and the processor's glow and die
   cells, which follow the music. All of it is drawn into the sky canvas,
   which sits under the band, so every pulse reads as light under the copper.

   The layout is seeded from the canvas geometry, so a given desktop always
   gets the same board. Geometry lives in Path2D objects built at init; a
   palette change only restyles them.
   ========================================================================= */
(function(){
"use strict";

// y-down compass, index = direction: E, SE, S, SW, W, NW, N, NE
const DX=[1,1,0,-1,-1,-1,0,1], DY=[0,1,1,1,0,-1,-1,-1];
const RS=Math.SQRT1_2;
const perpX=d=>-DY[d]*((d&1)?RS:1);
const perpY=d=> DX[d]*((d&1)?RS:1);

// copper alpha by level, far to near; the top level is only for the
// processor's own buses, so they read as the spine of the board
const LV_A=[0.055,0.09,0.135,0.19,0.26,0.34];
// comet tail, oldest step first: a long quadratic fade reads as the copper
// still warm behind the packet rather than a dash sliding along
const TAIL_A=[0.025,0.05,0.085,0.13,0.19,0.27,0.37,0.5,0.66,0.85];
const CLS_A=[0.5,1];                          // pulses on dim traces vs bright ones
const FLARE_LIFE=0.6;

const ST={ frames:0, eSlow:0, burstAt:-9, kick:0, core:0.3,
           gen:-1, sty:null, spr:null, glow:null, sprCtx:null, kw:-1, k:1, font:"" };

function rng(seed){
  let a=(seed>>>0)||1;
  return ()=>{ a=(a+0x6D2B79F5)>>>0; let t=a;
    t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296; };
}
const ss=(a,b,x)=>{ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };

/* ---------------- generation ---------------- */

// 0..1: how much board belongs here. Radial around the processor, zero over
// the panel stacks, feathered at the band top and the monitor edges.
function dens(G,x,y){
  const dx=(x-G.fx)/G.rx, dy=(y-G.fy)/G.ry;
  let w=1-ss(0.1,1,Math.sqrt(dx*dx+dy*dy));
  if(w<=0) return 0;
  for(let i=0;i<G.rects.length;i++){
    const R=G.rects[i];
    const ox=Math.max(R.x0-x,x-R.x1,0), oy=Math.max(R.y0-y,y-R.y1,0);
    if(ox<G.fade && oy<G.fade) w*=ss(0,G.fade,Math.sqrt(ox*ox+oy*oy));
  }
  w*=ss(G.y0,G.y0+G.topFade,y);
  const m=G.p*2;
  return w*ss(G.x0,G.x0+m,x)*ss(G.x1,G.x1-m,x);
}
const inside=(G,x,y)=> x>=G.x0 && x<=G.x1 && y>=G.y0 && y<=G.y1;
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
   later, but never more than 90 off its first heading, so it cannot loop. */
function route(G,sx,sy,d0,k,o){
  const p=G.p, V=[sx,sy], D=[];
  let x=sx,y=sy,d=d0,seg=0,steps=0,turn=0,phase=o.bend?0:2,end="via";
  const minSeg=Math.max(2,Math.ceil(k*0.5)+1);
  if(!o.par && !stepFree(G,x,y,d,k,o.id,0,0)) return null;
  while(steps<o.max){
    let want=d;
    if(phase===0 && seg>=o.stub){ want=(d+o.bend+8)&7; phase=1; }
    else if(phase===1 && seg>=o.diag){ want=(d-o.bend+8)&7; phase=2; }
    else if(phase===2 && seg>=minSeg && steps>=o.calm && G.rnd()<o.turn) want=(d+(G.rnd()<0.5?1:7))&7;
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
      if(o.run && ny>G.y1 && nd===d){ x=nx; y=ny+p; steps++; end="run"; }
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

function addVia(G,x,y,r){
  G.sg.vias.push(x,y,r,dens(G,x,y));
  const c=cellAt(G,x,y); if(c>=0 && G.occ[c]===0) G.occ[c]=-1;
}
function addTrace(G,pts,o){
  const cum=cumOf(pts), len=cum[cum.length-1];
  if(len<G.p*0.8) return null;
  for(let i=1;i<pts.length/2;i++) markSeg(G,pts[2*i-2],pts[2*i-1],pts[2*i],pts[2*i+1],o.id);
  const n=pts.length/2;
  const tr={ pts, cum, len, boost:o.boost||0, chip:!!o.chip, bus:o.bus||null, sg:G.sg,
             nodes:[], lvl:0 };
  if(o.n0) tr.nodes.push(0, pts[0], pts[1], o.n0);
  if(o.n1) tr.nodes.push(len, pts[2*n-2], pts[2*n-1], o.n1);
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

/* A small chip where a straight bus ends, its front pins taking the bus. Half
   of them pass the bus on out of the back, the rest end in short stubs. */
function tryIC(G,B){
  const p=G.p, k=B.k, d=B.D[B.D.length-1], nv=B.V.length/2;
  const ex=B.V[2*nv-2], ey=B.V[2*nv-1];
  const depth=clamp(Math.round(k*0.6)+1,2,4), half=(k+1)/2;
  const ax=DX[d], ay=DY[d], cx=perpX(d), cy=perpY(d);
  const span=Math.ceil(half)+1;
  for(let u=1;u<=depth+3;u++) for(let v=-span;v<=span;v++){
    const x=ex+(ax*u+cx*v)*p, y=ey+(ay*u+cy*v)*p;
    if(!inside(G,x,y) || dens(G,x,y)<0.04) return null;
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
  if(dens(G,bx,by)>0.12 && G.rnd()<0.6){
    const B=route(G,bx,by,d,k,{id:++G.id, par:ic.id, bend:0, max:40, thr:0.05+G.rnd()*0.08,
                               turn:0.12, calm:2, run:true});
    if(B && B.steps>=3){ finishBus(G,B,{boost:o.boost*0.5, n0:0.8, ic:0.25, pads:0.2}); return; }
  }
  for(let m=0;m<k;m++){
    const off=(m-(k-1)/2)*p, x=bx+perpX(d)*off, y=by+perpY(d)*off;
    const len=(1+((m+(G.rnd()<0.5?0:1))&1))*p;
    const q=new Float32Array([x,y, x+DX[d]*len, y+DY[d]*len]);
    if(blocked(G,q[2],q[3],++G.id,ic.id)) continue;
    const tr=addTrace(G,q,{id:G.id, boost:o.boost*0.5, n0:0.8, n1:1});
    if(tr) addVia(G,q[2],q[3],p*0.3);
  }
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
  G.sg.chips.push(chip);
  const busList=[];
  for(const g of groups) for(let side=0;side<4;side++) busList.push([side,g]);
  for(const [side,g] of busList){
    const out=side*2, ax=-DY[out], ay=DX[out];            // along the side
    const k=g[1]-g[0]+1, c=(g[0]+g[1])/2;
    const sx=cx+DX[out]*(h+1)*p+ax*c*p, sy=cy+DY[out]*(h+1)*p+ay*c*p;
    const bend = c===0 ? 0 : (c>0?1:-1);
    const B=route(G,sx,sy,out,k,{ id:++G.id, par:id, bend, stub:1+(G.rnd()*2|0),
      diag:2+(G.rnd()*(main?6:4)|0), max:main?140:70, thr:0.035+G.rnd()*0.1,
      turn:0.07, calm:bend?0:10, run:true });
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
    G.sg.text.push(horiz ? [label,(x0+x1)/2,y0-n-0.45*p,w] : [label,x1+n+0.3*p,(y0+y1)/2,w,"left"]);
  return true;
}

function genScreen(L,T,s,main,seed){
  const x0=Math.max(0,s.x), x1=Math.min(T.w,s.x+s.w), y0=Math.max(0,s.y), y1=Math.min(T.h,s.y+s.h);
  if(x1-x0<240 || y1-y0<160) return;
  const rem=clamp(0.013*Math.min(s.w,s.h),9,30), remU=rem*clamp(+CFG.uiScale||1,0.5,2);
  const p=Math.max(6,Math.round(rem*0.58));
  const sg={ p, lw:p>=22?1.5:1, traces:[], vias:[], pads:[], chips:[], ics:[], boxes:[], text:[], nIC:1, paths:null };
  const G={ L, sg, p, rnd:rng(seed), id:0, x0,x1,y0,y1, rects:[], fade:2.5*remU, topFade:(y1-y0)*0.18 };
  G.fx=Math.round(main ? T.cx : s.x+s.w/2)+0.5;
  G.fy=Math.round(clamp(s.y+s.h*0.6, y0+(y1-y0)*0.38, y1-(y1-y0)*0.22))+0.5;
  // Where the four corner stacks sit (the layout engine's own rules: 25rem
  // columns, the 2:1 ultrawide guard), so the board can leave them black.
  const edge=Math.max(0.022,(1-2*s.h/s.w)/2)*s.w;
  const colW=Math.min(25*remU,(s.w/s.h<1.3?0.46:0.34)*s.w);
  const top=s.y+0.04*s.h, bot=s.y+0.955*s.h, lx=s.x+edge, rx=s.x+s.w-edge;
  G.rects=[ {x0:lx,x1:lx+colW,y0:top,y1:top+26*remU}, {x0:rx-colW,x1:rx,y0:top,y1:top+17*remU},
            {x0:lx,x1:lx+colW,y0:bot-33*remU,y1:bot}, {x0:rx-colW,x1:rx,y0:bot-19*remU,y1:bot} ];
  G.rx=clamp(s.w/2-edge-0.35*colW, 0.2*s.w, 0.5*s.w);
  G.ry=0.5*Math.min(s.h,1.2*s.w);
  G.i0=Math.floor((x0-G.fx)/p)-1; G.j0=Math.floor((y0-G.fy)/p)-1;
  G.cols=Math.ceil((x1-G.fx)/p)+2-G.i0; G.rows=Math.ceil((y1-G.fy)/p)+2-G.j0;
  G.occ=new Int32Array(G.cols*G.rows);

  if(!addChip(G,0,0,main)) addChip(G,0,0,false);
  const h=main?9:6;
  // decoupling caps hug the processor's corners
  let nc=1;
  for(const [sx,sy] of [[1,1],[-1,1],[1,-1],[-1,-1]]){
    if(addPassive(G, sx>0?h+3:-h-4, sy*(h+3), true, "C"+nc)) nc++;
    if(addPassive(G, sx*(h+3), sy>0?h+5:-h-6, false, null)) nc++;
  }
  // fill: short buses, passives and via fields, seeded where the density is
  const area=G.cols*G.rows, R=G.rnd;
  for(let a=0;a<area*0.5;a++){
    const i=G.i0+(R()*G.cols|0), j=G.j0+(R()*G.rows|0), x=G.fx+i*p, y=G.fy+j*p;
    const w=dens(G,x,y);
    if(R()>w*w*1.15) continue;
    const roll=R();
    if(roll<0.035){ addPassive(G,i,j,R()<0.6, R()<0.3?(R()<0.5?"R":"C")+(nc++):null); continue; }
    if(roll<0.05){
      const aw=2+(R()*3|0), ah=2+(R()*4|0);
      if(!nodesFree(G,i-1,j-1,i+aw,j+ah)) continue;
      markNodes(G,i-1,j-1,i+aw,j+ah,-1);
      for(let v=0;v<ah;v++) for(let u=0;u<aw;u++) G.sg.vias.push(x+u*p,y+v*p,p*0.24,w);
      continue;
    }
    const d=R()<0.7 ? (R()*4|0)*2 : (R()*4|0)*2+1;
    const kr=R(), k=kr<0.45?1:kr<0.75?2:kr<0.92?3:4;
    const B=route(G,x,y,d,k,{ id:++G.id, par:0, bend:0, max:3+(R()*(6+16*w)|0), thr:0.03,
                              turn:0.2, calm:0, run:true });
    if(!B || B.steps<3) continue;
    finishBus(G,B,{boost:0, startVia:true, ic:0.08, pads:0.22});
  }
  buildPaths(sg,G);
  L.sgs.push(sg);
}

/* Split each trace into short runs, each at the copper level of its own
   density, so a long bus fades smoothly instead of in steps. */
function lvOf(w,b,top){ return clamp(Math.floor(w*5+b),0,top||4); }
function buildPaths(sg,G){
  const P={ tr:[], via:[], pad:[], silk:new Path2D(), body:new Path2D(), pins:new Path2D(),
            die:new Path2D(), dieFill:new Path2D(), dieGrid:new Path2D(), inner:new Path2D() };
  for(let v=0;v<LV_A.length;v++){ P.tr.push(new Path2D()); P.via.push(new Path2D()); P.pad.push(new Path2D()); }
  const run=sg.p*4;
  for(const tr of sg.traces){
    const q=tr.pts, n=q.length/2, top=tr.boost>0.5?5:4;
    // a run's level comes from the density a little ahead of where it starts
    const lvAt=(x,y,i)=>{ const j=Math.min(i,n-1); return lvOf(dens(G,(x+q[2*j])/2,(y+q[2*j+1])/2),tr.boost,top); };
    let px=q[0], py=q[1], acc=0, cur=P.tr[lvAt(px,py,1)];
    cur.moveTo(px,py);
    for(let i=1;i<n;i++){
      const x=q[2*i], y=q[2*i+1], L=Math.hypot(x-px,y-py);
      let t0=0;
      while(L>0 && acc+L*(1-t0)>run){
        const t=t0+(run-acc)/L, mx=px+(x-px)*t, my=py+(y-py)*t;
        cur.lineTo(mx,my);
        cur=P.tr[lvAt(mx,my,i)]; cur.moveTo(mx,my);
        acc=0; t0=t;
      }
      acc+=L*(1-t0);
      cur.lineTo(x,y); px=x; py=y;
    }
    tr.lvl=lvOf(tr.w,tr.boost);
  }
  const V=sg.vias;
  for(let i=0;i<V.length;i+=4){
    const x=V[i], y=V[i+1], r=V[i+2], path=P.via[lvOf(V[i+3],0.7)];
    path.moveTo(x+r,y); path.arc(x,y,r,0,Math.PI*2);
    path.moveTo(x+r*0.45,y); path.arc(x,y,r*0.45,0,Math.PI*2,true);   // the drill hole
  }
  const D=sg.pads;
  for(let i=0;i<D.length;i+=5) P.pad[lvOf(D[i+4],0.8)].rect(D[i],D[i+1],D[i+2],D[i+3]);
  for(const b of sg.boxes) P.silk.rect(b[0],b[1],b[2],b[3]);
  const p=sg.p;
  for(const c of sg.chips){
    const H=c.H, x=c.x, y=c.y, ch=1.4*p;
    P.body.moveTo(x-H+ch,y-H); P.body.lineTo(x+H,y-H); P.body.lineTo(x+H,y+H);
    P.body.lineTo(x-H,y+H); P.body.lineTo(x-H,y-H+ch); P.body.closePath();
    const I=H-0.6*p; P.inner.rect(x-I,y-I,2*I,2*I);
    const Dh=H*0.42; P.die.rect(x-Dh,y-Dh,2*Dh,2*Dh); P.dieFill.rect(x-Dh,y-Dh,2*Dh,2*Dh);
    const n=c.main?8:6, cell=2*Dh/n, g=cell*0.3;
    for(let a=0;a<n;a++) for(let b=0;b<n;b++) P.dieGrid.rect(x-Dh+a*cell+g,y-Dh+b*cell+g,cell-2*g,cell-2*g);
    c.die={ x0:x-Dh+g, y0:y-Dh+g, cell, sz:cell-2*g, n, v:new Float32Array(n*n) };
    const pr=0.28*p; P.silk.moveTo(x-H+ch+0.5*p+pr,y-H+ch+0.5*p); P.silk.arc(x-H+ch+0.5*p,y-H+ch+0.5*p,pr,0,Math.PI*2);
    const pn=c.pins; for(let i=0;i<pn.length;i+=4) P.pins.rect(pn[i],pn[i+1],pn[i+2],pn[i+3]);
    sg.text.push([c.main?"U1":"U"+(sg.nIC+1), x-H, y-H-1.3*p, 1, "left"]);
    c.lab=[c.main?"CYBERCORE":"IO-"+(sg.p|0), x, y+Dh+(H-Dh)*0.5];
  }
  for(const ic of sg.ics){
    const b=ic.body;
    P.body.moveTo(b[0][0],b[0][1]); for(let i=1;i<4;i++) P.body.lineTo(b[i][0],b[i][1]); P.body.closePath();
    const pw=0.4*p, pl=0.7*p, hor=!(ic.d%4===2);
    for(const [x,y] of ic.pins){ if(hor) P.pins.rect(x-pl/2,y-pw/2,pl,pw); else P.pins.rect(x-pw/2,y-pl/2,pw,pl); }
    const r=0.3*p; P.silk.moveTo(ic.notch[0]+r*DX[ic.d],ic.notch[1]+r*DY[ic.d]);
    P.silk.arc(ic.notch[0],ic.notch[1],r, Math.atan2(DY[ic.d],DX[ic.d])-Math.PI/2, Math.atan2(DY[ic.d],DX[ic.d])+Math.PI/2);
    sg.text.push(["U"+ic.n, ic.label[0], ic.label[1], ic.w]);
  }
  sg.paths=P;
}

function genLayout(T){
  const L={ sgs:[], pulses:[], flares:[], cdf:null, pick:[], rate:0, acc:0, drawn:-1, last:-9 };
  let S=(T.screens||[]).filter(s=>s.w>0 && s.h>0);
  if(!S.length) S=[{x:0, y:T.h-T.h/SCENES.circuit.band, w:T.w, h:T.h/SCENES.circuit.band}];
  // the primary is the screen holding T.cx; a per-monitor band holds only its own
  S.forEach((s,i)=>{
    const main = T.cx>=s.x && T.cx<s.x+s.w;
    const seed=(Math.round(s.w)*73856093) ^ (Math.round(s.h)*19349663) ^ (i*83492791) ^ Math.round(T.w);
    genScreen(L,T,s,main,seed);
  });
  // pulses favor the processor's buses and the brighter copper
  let acc=0; const w=[];
  for(const sg of L.sgs) for(const tr of sg.traces){
    if(tr.len<sg.p*4) continue;
    acc+=tr.len*(tr.chip?2.4:1)*(0.25+tr.w);
    L.pick.push(tr); w.push(acc);
    L.rate+=tr.len/sg.p/300;
  }
  L.cdf=Float64Array.from(w);
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
  if(L.flares.length>=90) return;
  L.flares.push({x,y,r,str,age:0});
}
function launch(L,tr,dir,delay,v,tail){
  const p=tr.sg.p;
  L.pulses.push({ tr, dir, s:-delay, v:v||p*(12+Math.random()*6), tail:tail||p*(9+Math.random()*6),
                  cls:tr.lvl>=2?1:0 });
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
        const x=N[j+1], y=N[j+2], p=tr.sg.p;
        flare(L,x,y,p*(a>0?1.5:1.0),N[j+3]*(a>0?1:0.5)*(q.cls?1:0.6));
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
    D.acc=(D.acc||0)+dt*rate*(c.main?7:3);
    let m=burst?5:0;
    while(D.acc>=1){ D.acc-=1; m++; }
    while(m-->0) V[Math.random()*V.length|0]=0.6+0.4*Math.random();
  }
}

function styles(ctx){
  if(ST.gen===PAL.gen && ST.sprCtx===ctx) return;
  ST.gen=PAL.gen; ST.sprCtx=ctx;
  const h=PAL.h, s=PAL.s, lit=clamp(PAL.l+8,0,80), hot=clamp(PAL.l+32,62,94);
  ST.sty={ tail:TAIL_A.map(a=>hslStr(h,s,hot,a)), halo:hslStr(h,s,lit,0.045), body:hslStr(h,s,hot,0.13),
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

function emitRange(ctx,tr,a,b,ox,oy){
  if(a<0) a=0; if(b>tr.len) b=tr.len; if(b-a<0.5) return;
  const P=tr.pts, C=tr.cum, n=C.length;
  let i=0; while(i<n-2 && C[i+1]<=a) i++;
  let t=(a-C[i])/((C[i+1]-C[i])||1);
  ctx.moveTo(ox+P[2*i]+(P[2*i+2]-P[2*i])*t, oy+P[2*i+1]+(P[2*i+3]-P[2*i+1])*t);
  while(i<n-2 && C[i+1]<b){ i++; ctx.lineTo(ox+P[2*i],oy+P[2*i+1]); }
  t=(b-C[i])/((C[i+1]-C[i])||1);
  ctx.lineTo(ox+P[2*i]+(P[2*i+2]-P[2*i])*t, oy+P[2*i+1]+(P[2*i+3]-P[2*i+1])*t);
}
function pointAt(tr,a,out){
  const P=tr.pts, C=tr.cum, n=C.length;
  let i=0; while(i<n-2 && C[i+1]<a) i++;
  const t=clamp((a-C[i])/((C[i+1]-C[i])||1),0,1);
  out[0]=P[2*i]+(P[2*i+2]-P[2*i])*t; out[1]=P[2*i+1]+(P[2*i+3]-P[2*i+1])*t;
}
const PT=[0,0];

function sprite(ctx,g,x,y,r,a){
  const k=ST.k;
  ctx.globalAlpha=a; ctx.fillStyle=g;
  ctx.setTransform(k*r,0,0,k*r,k*x,k*y);
  ctx.fillRect(-1,-1,2,2);
}

/* Everything that glows, for every band: the core glow under each processor,
   flares, then tails (one path per alpha step, all pulses at once), then heads. */
function drawLight(K,list){
  const ctx=K.ctx;
  styles(ctx);
  if(ctx.canvas.width!==ST.kw){ ST.kw=ctx.canvas.width; ST.k=ctx.getTransform().a||1; }
  const k=ST.k, sty=ST.sty;
  ctx.setTransform(k,0,0,k,0,0);
  ctx.clearRect(0,0,K.w,K.h);
  const core=clamp(ST.core,0,1);
  for(const [L,ox,oy] of list){
    // the processor lights the board around it: a wide pool and a tighter core
    for(const sg of L.sgs) for(const c of sg.chips){
      sprite(ctx,ST.glow,ox+c.x,oy+c.y,c.H*(c.main?3.6:2.6),core*(c.main?0.30:0.16));
      sprite(ctx,ST.glow,ox+c.x,oy+c.y,c.H*1.35,core*(c.main?0.6:0.35));
      const D=c.die, V=D.v;
      ctx.globalAlpha=1; ctx.setTransform(k,0,0,k,0,0);
      for(let i=0;i<V.length;i++){
        const j=Math.round(V[i]*7); if(!j) continue;
        ctx.fillStyle=sty.cell[j];
        ctx.fillRect(ox+D.x0+(i%D.n)*D.cell, oy+D.y0+((i/D.n)|0)*D.cell, D.sz, D.sz);
      }
    }
    for(const f of L.flares){
      const u=1-f.age/FLARE_LIFE, a=f.str*u*u*(f.age<0.06?f.age/0.06:1);
      if(a>0.01) sprite(ctx,ST.spr,ox+f.x,oy+f.y,f.r*(1.2+0.6*(1-u)),a*0.8);
    }
  }
  ctx.setTransform(k,0,0,k,0,0);
  ctx.lineJoin="round";
  for(let c=0;c<2;c++){
    ctx.globalAlpha=CLS_A[c];
    // soft body along the front of each tail: one path, stroked wide then narrow
    ctx.lineCap="round"; ctx.beginPath();
    let any=false, lw=1;
    for(const [L,ox,oy] of list) for(const q of L.pulses){
      if(q.cls!==c || q.s<=0) continue;
      const h=headA(q), t=q.tail*0.35;
      if(q.dir>0) emitRange(ctx,q.tr,h-t,h,ox,oy); else emitRange(ctx,q.tr,h,h+t,ox,oy);
      any=true; lw=q.tr.sg.p;
    }
    if(!any) continue;
    ctx.strokeStyle=sty.halo; ctx.lineWidth=Math.max(5,lw*0.62); ctx.stroke();
    ctx.strokeStyle=sty.body; ctx.lineWidth=Math.max(2.5,lw*0.24); ctx.stroke();
    ctx.lineCap="butt"; ctx.lineWidth=Math.max(1.25,lw*0.1);
    for(let j=0;j<TAIL_A.length;j++){
      ctx.strokeStyle=sty.tail[j]; ctx.beginPath();
      for(const [L,ox,oy] of list) for(const q of L.pulses){
        if(q.cls!==c || q.s<=0) continue;
        const h=headA(q), seg=q.tail/TAIL_A.length, back=q.s-q.tail+j*seg;
        // tail steps in travel distance, mapped onto the trace's own direction
        const a0=back, a1=back+seg;
        if(a1<=0) continue;
        if(q.dir>0) emitRange(ctx,q.tr,a0,Math.min(a1,q.s),ox,oy);
        else emitRange(ctx,q.tr,q.tr.len-Math.min(a1,q.s),q.tr.len-a0,ox,oy);
      }
      ctx.stroke();
    }
  }
  for(const [L,ox,oy] of list) for(const q of L.pulses){
    if(q.s<=0 || q.s>q.tr.len) continue;
    pointAt(q.tr,headA(q),PT);
    sprite(ctx,ST.spr,ox+PT[0],oy+PT[1],q.tr.sg.p*1.05,CLS_A[q.cls]*0.9);
  }
  ctx.globalAlpha=1;
  ctx.setTransform(k,0,0,k,0,0);
}

/* ---------------- the board ---------------- */

function drawBoard(T,L){
  const ctx=T.ctx;
  ctx.clearRect(0,0,T.w,T.h);
  const h=PAL.h, s=PAL.s, lit=clamp(PAL.l+8,0,80);
  if(!ST.font){
    try{ ST.font=getComputedStyle(document.body).fontFamily; }catch(e){}
    ST.font=ST.font||"Consolas, monospace";
  }
  for(const sg of L.sgs){
    const P=sg.paths, p=sg.p;
    ctx.lineWidth=sg.lw; ctx.lineJoin="round"; ctx.lineCap="butt";
    for(let v=0;v<LV_A.length;v++){ ctx.strokeStyle=hslStr(h,s,lit,LV_A[v]); ctx.stroke(P.tr[v]); }
    for(let v=0;v<5;v++){
      ctx.fillStyle=hslStr(h,s,lit,LV_A[v]*1.5); ctx.fill(P.via[v]); ctx.fill(P.pad[v]);
    }
    // packages: a whisper of fill, a crisp outline, the die and its cells
    ctx.fillStyle=hslStr(h,s,lit,0.025); ctx.fill(P.body);
    ctx.strokeStyle=hslStr(h,s,lit,0.34); ctx.stroke(P.body);
    ctx.strokeStyle=hslStr(h,s,lit,0.10); ctx.stroke(P.inner);
    ctx.fillStyle=hslStr(h,s,lit,0.04); ctx.fill(P.dieFill);
    ctx.fillStyle=hslStr(h,s,lit,0.07); ctx.fill(P.dieGrid);
    ctx.strokeStyle=hslStr(h,s,lit,0.28); ctx.stroke(P.die);
    ctx.fillStyle=hslStr(h,s,lit,0.36); ctx.fill(P.pins);
    ctx.strokeStyle=hslStr(h,s,lit,0.16); ctx.stroke(P.silk);
    // silkscreen legends
    const fs=Math.max(7,Math.round(p*0.6));
    ctx.font=`${fs}px ${ST.font}`; ctx.textBaseline="middle";
    try{ ctx.letterSpacing=(fs*0.12).toFixed(1)+"px"; }catch(e){}
    for(const t of sg.text){
      ctx.textAlign=t[4]||"center";
      ctx.fillStyle=hslStr(h,s,lit,0.12+0.14*clamp(t[3],0,1));
      ctx.fillText(t[0],t[1],t[2]);
    }
    for(const c of sg.chips){
      ctx.textAlign="center"; ctx.fillStyle=hslStr(h,s,lit,0.26);
      ctx.font=`${Math.max(7,Math.round(p*(c.main?0.7:0.55)))}px ${ST.font}`;
      try{ ctx.letterSpacing=(p*0.22).toFixed(1)+"px"; }catch(e){}
      ctx.fillText(c.lab[0],c.lab[1],c.lab[2]);
    }
    try{ ctx.letterSpacing="0px"; }catch(e){}
  }
  L.drawn=PAL.gen;
}

/* A composed frame for game mode: packets caught mid-flight on some of the
   processor's buses, a few lone comets out on the board, the vias they just
   reached still lit, and a calm core. Seeded, so every still is the same. */
function stillLight(L){
  const r=rng(0x51ED+L.pick.length), keep=L.pulses, kf=L.flares;
  L.pulses=[]; L.flares=[];
  const seen=new Set(), buses=[], lone=[];
  for(const tr of L.pick){
    if(tr.chip && tr.bus && tr.bus.length>1){ if(!seen.has(tr.bus)){ seen.add(tr.bus); buses.push(tr.bus); } }
    else if(tr.len>tr.sg.p*6) lone.push(tr);
  }
  const take=(A,n)=>{ const out=[]; A=A.slice();
    while(out.length<n && A.length){ const i=r()*A.length|0; out.push(A[i]); A[i]=A[A.length-1]; A.pop(); }
    return out; };
  const nb=Math.max(4,Math.round(L.sgs.length*2+buses.length*0.3));
  for(const B of take(buses,nb)){
    let m=Infinity; for(const t of B) m=Math.min(m,t.len);
    const p=B[0].sg.p, s=m*(0.3+0.45*r()), tail=p*(10+r()*4);
    for(const t of B) L.pulses.push({tr:t,dir:1,s:s+r()*p*1.2,v:0,tail,cls:t.lvl>=2?1:0});
  }
  for(const tr of take(lone,Math.round(nb*1.3))){
    const p=tr.sg.p, dir=r()<0.5?1:-1, arrive=r()<0.4;
    L.pulses.push({tr,dir,s:tr.len*(arrive?0.97:0.35+0.45*r()),v:0,tail:p*(9+r()*6),cls:tr.lvl>=2?1:0});
    if(!arrive) continue;
    const N=tr.nodes, want=dir>0?tr.len:0;
    for(let j=0;j<N.length;j+=4) if(N[j]===want) L.flares.push({x:N[j+1],y:N[j+2],r:p*1.5,str:N[j+3],age:0.1});
  }
  // a still die: a scatter of cells at rest, the same one every time
  for(const sg of L.sgs) for(const c of sg.chips){
    const V=c.die.v; for(let i=0;i<V.length;i++) V[i]=r()<0.2 ? 0.25+0.6*r() : 0;
  }
  const out={pulses:L.pulses, flares:L.flares};
  L.pulses=keep; L.flares=kf;
  return out;
}

function bands(){ return (typeof TERS!=="undefined" ? TERS : []).filter(T=>T.circuit); }
const LIST=[];
function lightList(still){
  LIST.length=0;
  for(const T of bands()){
    if(still){
      const L=T.circuit, S=stillLight(L);
      LIST.push([{sgs:L.sgs, pulses:S.pulses, flares:S.flares}, T.x, T.y]);
    }else LIST.push([T.circuit, T.x, T.y]);
  }
  return LIST;
}

SCENES.circuit={
  label:"Circuit",
  band:0.7,
  init(T){
    const L=T.circuit=genLayout(T);
    // a few seconds of traffic up front, so a fresh board is never empty
    for(let i=0;i<60;i++) stepLayout(L,0.05,0.6,false);
  },
  frame(dt,S){
    ST.frames++;
    const sec=Math.min(dt,64)*0.001;
    // kicks: the low band jumping above its own recent level fires the processor
    const e=S.energy||0;
    ST.eSlow+= (e-ST.eSlow)*(1-Math.exp(-sec/0.5));
    const burst = e-ST.eSlow>0.06 && e>0.1 && S.t-ST.burstAt>0.28;
    if(burst){ ST.burstAt=S.t; ST.kick=Math.min(1,ST.kick+0.35); }
    ST.kick*=Math.exp(-sec/0.5);
    ST.core+= ((0.25+0.9*e+ST.kick)-ST.core)*(1-Math.exp(-sec/0.25));
    const rate=0.45+2.2*e;
    for(const T of bands()) stepLayout(T.circuit,sec,rate,burst);
  },
  draw(T){
    const L=T.circuit||(T.circuit=genLayout(T));
    // redraw when the palette changed, or when a frame went by without us
    // (the band was cleared while the scene was hidden)
    if(L.drawn!==PAL.gen || L.last!==ST.frames-1) drawBoard(T,L);
    L.last=ST.frames;
  },
  // light with no board under it would be comets crossing empty black
  sky(K){ if(CFG.terrain) drawLight(K,lightList(false)); else K.ctx.clearRect(0,0,K.w,K.h); },
  still(T){
    const L=T.circuit||(T.circuit=genLayout(T));
    drawBoard(T,L); L.last=-9;
  },
  stillSky(K){
    if(!CFG.terrain){ K.ctx.clearRect(0,0,K.w,K.h); return; }
    ST.core=0.45; drawLight(K,lightList(true));
  }
};
})();
