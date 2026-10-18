/* =========================================================================
   HUD STYLE: Terminal (canvas parts; the panel CSS is hud/terminal.css)
   Everything is drawn on a grid of character cells. The visualizer is a
   text-mode spectrum analyzer: columns of stacked █ cells with the top cell
   cut to the nearest eighth (▁▂▃▄▅▆▇), over the faint grid of unlit cells,
   with a peak mark that holds and falls. The sparklines are one row of the
   same block columns. Colors come from PAL and are rebuilt only when PAL.gen
   moves; each frame is a few batched rect paths.
   ========================================================================= */
const TERM_HUD={
  gen:-1, c:null,
  g:null, peak:null, hold:null, tPrev:0,  // visualizer geometry and peak-hold state
  sg:new WeakMap(),                       // context -> sparkline geometry

  pal(){
    if(this.gen===PAL.gen && this.c) return this.c;
    this.gen=PAL.gen;
    const h=PAL.h, s=PAL.s, l=PAL.l, hi=clamp(l+28,0,96), sh=clamp(s-10,0,100);
    this.c={
      fg:   hslStr(h,s,l,0.9),
      hi:   hslStr(h,sh,hi,1),
      peak: hslStr(h,sh,hi,0.85),
      ghost:hslStr(h,s,l,0.045),
      base: hslStr(h,s,l,0.4),
      dim:  hslStr(h,s,l,0.5),
      stub: hslStr(h,s,l,0.3),
      text: PAL.accent
    };
    return this.c;
  },

  font(px, w){ return `${w||400} ${px}px "Cascadia Mono","Cascadia Code",Consolas,monospace`; },

  /* column amplitude, resampled from the 64 bins and lifted on a perceptual
     curve so quiet passages still light a cell or two */
  amp(bins, i, N){
    const f=i/(N-1)*63, k=Math.floor(f), r=f-k;
    const a=bins[k]||0, b=bins[Math.min(63,k+1)]||0;
    return Math.pow(clamp(a+(b-a)*r, 0, 1), 0.7);
  },

  /* Cell geometry for the visualizer: rows of character height, columns a
     glyph wide with a sliver between them, and the unlit cells as one path.
     Rebuilt only when the canvas changes size. */
  geo(w, h){
    const G=this.g;
    if(G && G.w===w && G.h===h) return G;
    const rows=Math.max(3, Math.round(h/Math.max(9, Math.min(26, h/4.6))));
    const rh=Math.floor((h-2)/rows), gap=Math.max(1, Math.round(rh*0.1)), ch=rh-gap;
    const pitch=Math.max(5, Math.round(rh*0.62)), N=clamp(Math.floor((w+pitch*0.25)/pitch), 12, 64);
    const bw=Math.max(3, Math.round(pitch*0.78));
    const x0=Math.round((w-(N*pitch-(pitch-bw)))/2), base=Math.round(h-1-((h-2)-rows*rh)/2);
    const xs=new Int32Array(N), ghost=new Path2D();
    for(let i=0;i<N;i++){
      xs[i]=x0+i*pitch;
      for(let r=0;r<rows;r++) ghost.rect(xs[i], base-(r+1)*rh+gap, bw, ch);
    }
    this.peak=new Float32Array(N); this.hold=new Float32Array(N);
    return (this.g={w, h, rows, rh, gap, ch, pitch, N, bw, x0, base, xs, ghost});
  },

  audio(ctx, w, h, bins, t){
    const c=this.pal(), G=this.geo(w,h);
    const dt=clamp(t-(this.tPrev||t), 0, 100); this.tPrev=t;
    const {rows, rh, gap, ch, N, bw, xs, base}=G, E=rows*8;
    ctx.fillStyle=c.ghost; ctx.fill(G.ghost);
    const body=new Path2D(), head=new Path2D(), peaks=new Path2D();
    for(let i=0;i<N;i++){
      const e=Math.round(this.amp(bins,i,N)*E);       // height in eighths of a cell
      const full=e>>3, part=e&7, x=xs[i];
      for(let r=0;r<full;r++) (r===full-1 && !part ? head : body).rect(x, base-(r+1)*rh+gap, bw, ch);
      if(part){
        const ph=Math.max(1, Math.round(ch*part/8));
        head.rect(x, base-full*rh-ph, bw, ph);
      }
      // peak: holds ~0.5 s, then falls at three cells a second
      if(e>=this.peak[i]){ this.peak[i]=e; this.hold[i]=500; }
      else if(this.hold[i]>0) this.hold[i]-=dt;
      else this.peak[i]=Math.max(0, this.peak[i]-dt*0.024);
      const p=this.peak[i];
      if(p>e+1.5){
        const pr=Math.floor(p/8), pp=p-pr*8;
        const y=Math.round(base-pr*rh-ch*pp/8);
        peaks.rect(x, y-1, bw, Math.max(1, Math.round(ch/8)));
      }
    }
    ctx.fillStyle=c.fg;   ctx.fill(body);
    ctx.fillStyle=c.hi;   ctx.fill(head);
    ctx.fillStyle=c.peak; ctx.fill(peaks);
  },

  /* Game mode: the analyzer is parked. The cell grid stays, one ▁ per
     column sits on the floor, and the mode is printed in brackets. */
  audioStill(ctx, w, h, label){
    const c=this.pal(), G=this.geo(w,h);
    const {rows, rh, ch, N, bw, xs, base}=G;
    ctx.fillStyle=c.ghost; ctx.fill(G.ghost);
    const cs=getComputedStyle(ctx.canvas.parentElement);
    const px=clamp(Math.round(parseFloat(cs.fontSize)*0.86)||12, 8, 22);
    ctx.font=this.font(px, 600);
    try{ ctx.letterSpacing=(px*0.16).toFixed(1)+"px"; }catch(e){}
    const txt="[ "+label+" ]", tw=ctx.measureText(txt).width;
    const cx=w/2, cy=Math.round(base-rows*rh/2), half=tw/2+px*0.6;
    const stubs=new Path2D(), sh=Math.max(1, Math.round(ch/8));
    for(let i=0;i<N;i++){
      const x=xs[i];
      if(x+bw>cx-half && x<cx+half) continue;
      stubs.rect(x, base-sh, bw, sh);
    }
    ctx.fillStyle=c.stub; ctx.fill(stubs);
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillStyle=c.text;
    ctx.fillText(txt, cx+px*0.08, cy);
  },

  /* One row of block columns, ▁ to █ in eighths, oldest at the left. The
     64 samples are folded into as many columns as fit (each column shows
     the peak of its samples), and the scale floats at x1.2 the window max,
     at least 20, so an idle machine still shows its texture. */
  spark(ctx, w, h, data){
    const c=this.pal(), n=data.length;
    if(n<2) return;
    let S=this.sg.get(ctx);
    if(!S || S.w!==w || S.h!==h){
      const ch=Math.max(4, Math.floor(h)-1), pitch=Math.max(3, Math.round(ch*0.3));
      const bw=Math.max(2, pitch-Math.max(1, Math.round(pitch*0.2)));
      const N=clamp(Math.floor((w+pitch-bw)/pitch), 4, 64), x0=Math.round(w-(N*pitch-(pitch-bw)));
      const ghost=new Path2D();
      for(let j=0;j<N;j++) ghost.rect(x0+j*pitch, 0, bw, ch);
      S={w, h, ch, pitch, bw, N, x0, ghost}; this.sg.set(ctx, S);
    }
    let mx=0; for(let i=0;i<n;i++) if(data[i]>mx) mx=data[i];
    const top=clamp(mx*1.2, 20, 100), {ch, pitch, bw, N, x0}=S;
    ctx.fillStyle=c.ghost; ctx.fill(S.ghost);
    const body=new Path2D();
    let lastX=0, lastH=0;
    for(let j=0;j<N;j++){
      const a=Math.floor(j*n/N), b=Math.max(a+1, Math.floor((j+1)*n/N));
      let v=0; for(let i=a;i<b;i++) if(data[i]>v) v=data[i];
      const e=Math.max(1, Math.round(clamp(v/top,0,1)*8));
      const bh=Math.max(1, Math.round(ch*e/8)), x=x0+j*pitch;
      if(j===N-1){ lastX=x; lastH=bh; } else body.rect(x, ch-bh, bw, bh);
    }
    ctx.fillStyle=c.fg; ctx.fill(body);
    ctx.fillStyle=c.hi; ctx.fillRect(lastX, ch-lastH, bw, lastH);
  }
};
HUDS.terminal={
  label:"Terminal",
  audio:(ctx,w,h,bins,t)=>TERM_HUD.audio(ctx,w,h,bins,t),
  audioStill:(ctx,w,h,label)=>TERM_HUD.audioStill(ctx,w,h,label),
  spark:(ctx,w,h,data)=>TERM_HUD.spark(ctx,w,h,data)
};
