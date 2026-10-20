/* =========================================================================
   HUD STYLE: LCARS (canvas parts; the panel CSS is hud/lcars.css)
   The visualizer is a bank display: forty segmented columns in five banks,
   one palette color per bank (bass in orange through to treble in
   periwinkle), each bank standing on its own rounded rail. The loud top of
   the scale lights in the Alert color, and a short peak block holds over
   each column. The sparklines are column charts in the color of their group
   in the System Monitor, the newest reading in tan. The colors are the
   stylesheet's --lc-* (LCARS (Accent) builds them from the accent), read
   again when the palette changes; that and the size invalidate the cached
   geometry. The per-frame work is a handful of batched rect paths.
   ========================================================================= */
const LCARS_HUD={
  FONT:'"Bahnschrift Condensed","Bahnschrift SemiCondensed",Bahnschrift,"Arial Narrow",sans-serif',
  PER:8, GAP:1.25,                        // columns per bank, gap between banks in columns
  C:null, cGen:-1,                        // console colors as r,g,b, and the PAL.gen they were read at
  g:null, peak:null, hold:null, tPrev:0,

  rgba(c,a){ return `rgba(${c[0]},${c[1]},${c[2]},${a})`; },

  /* Bank colors bass to treble; spark colors by canvas, and whether a reading
     of 90+ is an alert (traffic is not). r,g,b so the dim cells need no
     per-frame string work. */
  cols(){
    if(this.C && this.cGen===PAL.gen) return this.C;
    const cs=getComputedStyle(document.body), c={};
    const CLASSIC={ or:"#FF9900", tan:"#FFCC99", pch:"#FF9966", lil:"#CC99CC", per:"#9999FF", gold:"#FFCC66" };
    for(const k in CLASSIC){
      const v=parseColor(cs.getPropertyValue("--lc-"+k).trim()||CLASSIC[k], parseColor(CLASSIC[k]));
      c[k]=[v.r, v.g, v.b];
    }
    this.cGen=PAL.gen; this.g=null;
    return (this.C={ BANK:[c.or, c.gold, c.tan, c.lil, c.per],
                     SPARK:{ "sp-cpu":[...c.or,1], "sp-gpu":[...c.per,1], "sp-net":[...c.pch,0] },
                     TAN:this.rgba(c.tan,1), OR:this.rgba(c.or,1) });
  },

  font(ctx, px){
    ctx.font=`400 ${px}px ${this.FONT}`;
    try{ ctx.fontStretch="condensed"; }catch(e){}
  },

  /* Columns, segments, the unlit cells and the rails depend only on the
     canvas size, so they are built once per size. */
  geo(w, h){
    const BANK=this.cols().BANK, G=this.g;
    if(G && G.w===w && G.h===h) return G;
    const B=BANK.length, P=this.PER, N=B*P;
    const rail=Math.max(2, Math.round(h*0.045)), yb=h-rail-Math.max(2, Math.round(h*0.04));
    const nSeg=12, pitch=Math.max(3, Math.floor((yb-1)/nSeg));
    const seg=Math.max(2, pitch-Math.max(1, Math.round(pitch*0.3)));
    const cw=w/(N+(B-1)*this.GAP), bw=Math.max(2, Math.round(cw*0.7));
    const xs=new Int32Array(N), ghost=[], rails=[];
    for(let b=0;b<B;b++){ ghost.push(new Path2D()); rails.push(new Path2D()); }
    for(let i=0;i<N;i++){
      const b=Math.floor(i/P);
      xs[i]=Math.round((i+b*this.GAP)*cw+(cw-bw)/2);
      for(let j=0;j<nSeg;j++) ghost[b].rect(xs[i], yb-(j+1)*pitch+(pitch-seg), bw, seg);
    }
    // each bank's rail: a bar with rounded ends under its columns
    for(let b=0;b<B;b++){
      const x0=xs[b*P], x1=xs[b*P+P-1]+bw, r=rail/2, y=h-rail;
      const p=rails[b];
      p.moveTo(x0+r, y); p.lineTo(x1-r, y);
      p.arc(x1-r, y+r, r, -Math.PI/2, Math.PI/2);
      p.lineTo(x0+r, y+rail);
      p.arc(x0+r, y+r, r, Math.PI/2, Math.PI*1.5);
      p.closePath();
    }
    if(!this.peak || this.peak.length!==N){ this.peak=new Float32Array(N); this.hold=new Float32Array(N); }
    const fill=BANK.map(c=>this.rgba(c,1)), dim=BANK.map(c=>this.rgba(c,0.11)),
          park=BANK.map(c=>this.rgba(c,0.32)), railC=BANK.map(c=>this.rgba(c,0.85));
    return (this.g={w, h, N, B, P, rail, yb, nSeg, pitch, seg, cw, bw, xs, ghost, rails, fill, dim, park, railC});
  },

  /* amplitude of column i, resampled from the 64 bins on a perceptual curve */
  amp(bins, i, N){
    const f=i/(N-1)*63, k=Math.floor(f), r=f-k;
    const a=bins[k]||0, b=bins[Math.min(63,k+1)]||0;
    return Math.pow(clamp(a+(b-a)*r, 0, 1), 0.7);
  },

  audio(ctx, w, h, bins, t){
    const G=this.geo(w,h), {N, B, P, yb, nSeg, pitch, seg, bw, xs}=G, off=pitch-seg;
    const dt=clamp(t-(this.tPrev||t), 0, 100); this.tPrev=t;
    for(let b=0;b<B;b++){ ctx.fillStyle=G.dim[b]; ctx.fill(G.ghost[b]); ctx.fillStyle=G.railC[b]; ctx.fill(G.rails[b]); }
    const hotAt=Math.round(nSeg*0.8), hot=new Path2D();
    const body=[], peaks=[];
    for(let b=0;b<B;b++){ body.push(new Path2D()); peaks.push(new Path2D()); }
    for(let i=0;i<N;i++){
      const b=Math.floor(i/P), a=this.amp(bins,i,N), x=xs[i];
      const n=a>0.02 ? Math.min(nSeg, Math.max(1, Math.round(a*nSeg))) : 0;
      for(let j=0;j<n;j++) (j>=hotAt ? hot : body[b]).rect(x, yb-(j+1)*pitch+off, bw, seg);
      // peak hold: ~0.5 s, then a fall of 8 segments a second
      if(n>=this.peak[i]){ this.peak[i]=n; this.hold[i]=500; }
      else if(this.hold[i]>0) this.hold[i]-=dt;
      else this.peak[i]=Math.max(0, this.peak[i]-dt*0.008);
      const p=Math.round(this.peak[i]);
      if(p>n) peaks[b].rect(x, yb-p*pitch+off, bw, Math.max(1, Math.round(seg*0.45)));
    }
    for(let b=0;b<B;b++){ ctx.fillStyle=G.fill[b]; ctx.fill(body[b]); ctx.fill(peaks[b]); }
    ctx.fillStyle=PAL.alert; ctx.fill(hot);
  },

  /* Game mode: the banks are parked, one dim cell per column on its rail,
     and the mode sits on a button set into the middle of the grid. */
  audioStill(ctx, w, h, label){
    const G=this.geo(w,h), {N, B, P, yb, nSeg, pitch, seg, bw, xs}=G, off=pitch-seg;
    const cs=getComputedStyle(ctx.canvas.parentElement);
    const px=clamp(Math.round(parseFloat(cs.fontSize)*1.05)||13, 9, 30);
    this.font(ctx, px);
    try{ ctx.letterSpacing=(px*0.12).toFixed(1)+"px"; }catch(e){}
    const tw=ctx.measureText(label).width;
    const ph=Math.round(px*1.25), pw=Math.round(tw+px*2.2), r=ph/2;
    const cx=Math.round(w/2), x0=cx-pw/2;
    const py=Math.round(Math.max(1, yb-pitch-(nSeg-1)*pitch/2-ph/2));
    const m=Math.max(2, pitch*0.4);
    for(let b=0;b<B;b++){
      const cells=new Path2D(), lit=new Path2D();
      for(let i=b*P;i<b*P+P;i++){
        const x=xs[i], under=x+bw>x0-px*0.4 && x<x0+pw+px*0.4;
        lit.rect(x, yb-pitch+off, bw, seg);
        for(let j=1;j<nSeg;j++){
          const y=yb-(j+1)*pitch+off;
          if(under && y+seg>py-m && y<py+ph+m) continue;
          cells.rect(x, y, bw, seg);
        }
      }
      ctx.fillStyle=G.dim[b]; ctx.fill(cells);
      ctx.fillStyle=G.park[b]; ctx.fill(lit);
      ctx.fillStyle=G.railC[b]; ctx.fill(G.rails[b]);
    }
    const pill=new Path2D();
    pill.moveTo(x0+r, py); pill.lineTo(x0+pw-r, py);
    pill.arc(x0+pw-r, py+r, r, -Math.PI/2, Math.PI/2);
    pill.lineTo(x0+r, py+ph);
    pill.arc(x0+r, py+r, r, Math.PI/2, Math.PI*1.5);
    pill.closePath();
    ctx.fillStyle=this.cols().OR; ctx.fill(pill);
    ctx.fillStyle="#000"; ctx.textAlign="right"; ctx.textBaseline="alphabetic";
    ctx.fillText(label, x0+pw-r*0.9, py+ph-Math.round(px*0.2));
    try{ ctx.letterSpacing="0px"; }catch(e){}
  },

  /* Column chart: one flat-topped column per sample, rising from a dim rail.
     The scale floats (x1.2 of the window max, at least 20), so an idle
     machine still shows its texture; CPU and GPU readings of 90 and up
     turn Alert. */
  spark(ctx, w, h, data){
    const n=data.length;
    if(n<2) return;
    const C=this.cols(), c=C.SPARK[ctx.canvas.id]||C.SPARK["sp-cpu"];
    let mx=0; for(let i=0;i<n;i++) if(data[i]>mx) mx=data[i];
    const top=clamp(mx*1.2, 20, 100), hotAt=c[3] ? 90 : 1e9;
    const yb=Math.floor(h)-1, span=yb-1, sw=(w-1)/n, bw=Math.max(1, Math.round(sw*0.62));
    const cols=new Path2D(), hot=new Path2D();
    for(let i=0;i<n-1;i++){
      const v=data[i], hh=Math.max(1, Math.round(clamp(v/top,0,1)*span));
      (v>=hotAt ? hot : cols).rect(Math.round(1+i*sw), yb-hh, bw, hh);
    }
    ctx.fillStyle=this.rgba(c,0.22); ctx.fillRect(0, yb, w, 1);
    ctx.fillStyle=this.rgba(c,0.95); ctx.fill(cols);
    ctx.fillStyle=PAL.alert; ctx.fill(hot);
    const v=data[n-1], hh=Math.max(1, Math.round(clamp(v/top,0,1)*span));
    ctx.fillStyle=v>=hotAt ? PAL.alert : C.TAN;
    ctx.fillRect(Math.round(1+(n-1)*sw), yb-hh, bw, hh+1);
  }
};
HUDS.lcars={
  label:"LCARS (Star Trek)",
  audio:(ctx,w,h,bins,t)=>LCARS_HUD.audio(ctx,w,h,bins,t),
  audioStill:(ctx,w,h,label)=>LCARS_HUD.audioStill(ctx,w,h,label),
  spark:(ctx,w,h,data)=>LCARS_HUD.spark(ctx,w,h,data)
};
