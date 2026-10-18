/* =========================================================================
   HUD STYLE: Minimal (canvas parts; the panel CSS is hud/minimal.css)
   The visualizer is a row of thin rounded bars standing on a baseline of
   dots, so silence still reads as a quiet row rather than an empty space.
   Sparklines are a single line with a dot on the newest reading. Every mark
   is stroked twice from one path: a wider dark pass first, which does for
   the canvases what the text shadow does for the panel text over a bright
   scene. Colors are rebuilt only when PAL.gen moves; a frame builds a few
   paths and allocates nothing else.
   ========================================================================= */
const MINIMAL_HUD={
  gen:-1, c:null,
  N:56,                                   // visualizer bars (the 64 bins are resampled)

  pal(){
    if(this.gen===PAL.gen && this.c) return this.c;
    this.gen=PAL.gen;
    // A pale accent (l > 80) would draw near-white strokes, so lightness is
    // capped and the accent's chroma held, as the other styles do.
    const h=PAL.h, L=clamp(PAL.l+6,38,78), Lh=clamp(PAL.l+24,0,92);
    const C=l=>Math.max(0.01, 1-Math.abs(l/50-1));
    const sat=l=> l<PAL.l ? PAL.s*Math.min(1, C(PAL.l)/C(l)) : PAL.s;
    const s=sat(L), sh=sat(Lh);
    this.c={
      bar:  hslStr(h,s,L,0.9),
      dot:  hslStr(h,s,L,0.32),
      line: hslStr(h,s,L,0.95),
      head: hslStr(h,sh,Lh,1),
      base: hslStr(h,s,L,0.18),
      text: hslStr(h,clamp(PAL.s-35,0,100),66,0.8),
      dark: "rgba(0,0,0,0.38)"
    };
    return this.c;
  },

  /* bar i, resampled from the 64 bins and lifted so quiet passages show */
  amp(bins, i){
    const f=i/(this.N-1)*63, k=Math.floor(f), r=f-k;
    const a=bins[k]||0, b=bins[Math.min(63,k+1)]||0;
    return Math.pow(clamp(a+(b-a)*r, 0, 1), 0.75);
  },

  audio(ctx, w, h, bins, t){
    const c=this.pal(), N=this.N, pitch=w/N;
    const lw=clamp(pitch*0.3, 1.5, 5), r=lw/2;
    const yb=Math.round(h-r-1.5), top=r+1, span=yb-top;
    const bars=new Path2D(), dots=new Path2D();
    for(let i=0;i<N;i++){
      const x=Math.round((i+0.5)*pitch)+((lw|0)&1 ? 0.5 : 0);
      const v=this.amp(bins,i)*span;
      if(v>lw*0.6){ bars.moveTo(x,yb); bars.lineTo(x,yb-v); }
      else dots.rect(x-r, yb-r, lw, lw);
    }
    ctx.lineCap="round";
    ctx.strokeStyle=c.dark; ctx.lineWidth=lw+2; ctx.stroke(bars);
    ctx.fillStyle=c.dot; ctx.fill(dots);
    ctx.strokeStyle=c.bar; ctx.lineWidth=lw; ctx.stroke(bars);
  },

  /* Game mode: the bars are parked. A hairline runs across the middle with
     the mode set into a gap in it. */
  audioStill(ctx, w, h, label){
    const c=this.pal(), mid=Math.round(h/2)+0.5;
    const cs=getComputedStyle(ctx.canvas.parentElement);
    const px=clamp(Math.round(parseFloat(cs.fontSize)*0.62)||10, 8, 18);
    ctx.font=`600 ${px}px "Segoe UI Variable Small","Segoe UI",sans-serif`;
    try{ ctx.letterSpacing=(px*0.26).toFixed(1)+"px"; }catch(e){}
    ctx.textAlign="center"; ctx.textBaseline="middle";
    const gap=ctx.measureText(label).width/2+px*1.2, cx=w/2;
    const ln=new Path2D();
    ln.moveTo(0,mid); ln.lineTo(Math.max(0,cx-gap),mid);
    ln.moveTo(Math.min(w,cx+gap),mid); ln.lineTo(w,mid);
    ctx.lineWidth=1;
    ctx.strokeStyle=c.base; ctx.stroke(ln);
    ctx.lineJoin="round"; ctx.lineWidth=Math.max(2, px*0.22);
    ctx.strokeStyle=c.dark; ctx.strokeText(label, cx+px*0.13, mid+1);
    ctx.fillStyle=c.text;
    ctx.fillText(label, cx+px*0.13, mid+1);
  },

  /* One line, scaled to 1.25x the window's peak (at least 12) so an idle
     machine still shows its texture, and a dot on the newest sample. */
  spark(ctx, w, h, data){
    const c=this.pal(), n=data.length;
    if(n<2) return;
    let mx=0; for(let i=0;i<n;i++) if(data[i]>mx) mx=data[i];
    const top=clamp(mx*1.25, 12, 100);
    const lw=clamp(h/18, 1, 3), r=lw*1.4;
    const x0=1, x1=w-r-1, y0=r+1, yb=h-lw-1, sx=(x1-x0)/(n-1);
    const ln=new Path2D();
    for(let i=0;i<n;i++){
      const y=yb-clamp(data[i]/top,0,1)*(yb-y0);
      i ? ln.lineTo(x0+i*sx, y) : ln.moveTo(x0, y);
    }
    ctx.fillStyle=c.base;
    ctx.fillRect(0, Math.round(h-1), w, 1);
    ctx.lineJoin="round"; ctx.lineCap="round";
    ctx.strokeStyle=c.dark; ctx.lineWidth=lw+2; ctx.stroke(ln);
    ctx.strokeStyle=c.line; ctx.lineWidth=lw;   ctx.stroke(ln);
    const yl=yb-clamp(data[n-1]/top,0,1)*(yb-y0);
    ctx.fillStyle=c.head;
    ctx.beginPath(); ctx.arc(x1, yl, r, 0, Math.PI*2); ctx.fill();
  }
};
HUDS.minimal={
  label:"Minimal",
  audio:(ctx,w,h,bins,t)=>MINIMAL_HUD.audio(ctx,w,h,bins,t),
  audioStill:(ctx,w,h,label)=>MINIMAL_HUD.audioStill(ctx,w,h,label),
  spark:(ctx,w,h,data)=>MINIMAL_HUD.spark(ctx,w,h,data)
};
