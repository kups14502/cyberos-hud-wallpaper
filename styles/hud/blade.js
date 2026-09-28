/* =========================================================================
   HUD STYLE: Blade (canvas parts; the panel CSS is hud/blade.css)
   The visualizer is a mirrored LED meter: segmented columns above the axis,
   a dim reflection below it, and peak ticks that hold and then fall. The
   sparklines are stepped areas with a bright top edge, which reads as a
   sampled instrument rather than a smoothed chart. Colors come from PAL and
   are rebuilt only when PAL.gen moves; the per-frame work is a handful of
   batched rect paths.
   ========================================================================= */
const BLADE_HUD={
  gen:-1, c:null,
  N:48,                                  // visualizer columns (bins are resampled)
  peak:null, hold:null, tPrev:0, g:null, // peak-hold state per column, made in geo()
  sparkGrad:new WeakMap(),               // context -> {gen, h, g}

  pal(){
    if(this.gen===PAL.gen && this.c) return this.c;
    this.gen=PAL.gen;
    // Pale accents (l > 85) would wash out, so strokes are capped the way the
    // scenes do it and brightness comes from alpha instead. Pulling lightness
    // down at full saturation raises chroma (pale ice turns sky blue), so a
    // capped tone is held at the accent's own chroma.
    const h=PAL.h, lit=clamp(PAL.l+8,0,80), hi=clamp(PAL.l+22,0,90), hd=clamp(PAL.l+30,0,96);
    const C=l=>Math.max(0.01, 1-Math.abs(l/50-1));
    const sat=l=> l<PAL.l ? PAL.s*Math.min(1, C(PAL.l)/C(l)) : PAL.s;
    const s=sat(lit), sh=sat(hi);
    this.c={
      bar:  hslStr(h,s,lit,0.72),
      cap:  hslStr(h,sh,hi,0.98),
      hot:  hslStr(h,sh,hi,0.8),
      refl: hslStr(h,s,lit,0.2),
      refl2:hslStr(h,s,lit,0.08),
      peak: hslStr(h,sh,hi,0.9),
      axis: hslStr(h,s,lit,0.4),
      tick: hslStr(h,s,lit,0.22),
      stub: hslStr(h,s,lit,0.16),
      ghostA:hslStr(h,s,lit,0.03),
      ghostB:hslStr(h,s,lit,0),
      edge: hslStr(h,sh,hi,0.95),
      fillA:hslStr(h,s,lit,0.36),
      fillB:hslStr(h,s,lit,0.02),
      grid: hslStr(h,s,lit,0.14),
      head: hslStr(h,sat(hd),hd,1),
      label:PAL.accent
    };
    return this.c;
  },

  /* amplitude of column i, resampled from the 64 bins and lifted on a
     perceptual curve, so quiet passages still light a few segments */
  amp(bins, i){
    const f=i/(this.N-1)*63, k=Math.floor(f), r=f-k;
    const a=bins[k]||0, b=bins[Math.min(63,k+1)]||0;
    return Math.pow(clamp(a+(b-a)*r, 0, 1), 0.7);
  },

  /* Column and segment geometry, plus the unlit LED grid, only change with
     the canvas size, so they are built once per size. */
  geo(w, h){
    const G=this.g;
    if(G && G.w===w && G.h===h) return G;
    const N=this.N, mid=Math.round(h/2);
    const pitch=Math.max(3, Math.round((mid-3)/13));
    const seg=Math.max(2, pitch-Math.max(1, Math.round(pitch*0.34)));
    const nSeg=Math.floor((mid-3)/pitch);
    const x0=Math.round(w*0.01), cw=(w-2*x0)/N, bw=Math.max(2, Math.round(cw*0.62));
    if(!this.peak){ this.peak=new Float32Array(N); this.hold=new Float32Array(N); }
    const xs=new Int32Array(N);
    const ghost=new Path2D();
    for(let i=0;i<N;i++){
      xs[i]=Math.round(x0+i*cw+(cw-bw)/2);
      for(let j=0;j<nSeg;j++) ghost.rect(xs[i], mid-2-(j+1)*pitch+(pitch-seg), bw, seg);
    }
    return (this.g={w, h, mid, pitch, seg, nSeg, x0, cw, bw, xs, ghost});
  },

  audio(ctx, w, h, bins, t){
    const c=this.pal(), G=this.geo(w,h), N=this.N;
    const dt=clamp(t-(this.tPrev||t), 0, 100); this.tPrev=t;
    const {mid, pitch, seg, nSeg, bw, xs}=G, off=pitch-seg;

    // Unlit cells fade out upward from the axis: a full field at one alpha
    // reads as a dirty screen at idle.
    if(G.ghostGen!==PAL.gen){
      const gr=ctx.createLinearGradient(0, mid-2, 0, mid-2-nSeg*pitch);
      gr.addColorStop(0,c.ghostA); gr.addColorStop(1,c.ghostB);
      G.ghostFill=gr; G.ghostGen=PAL.gen;
    }
    ctx.fillStyle=G.ghostFill; ctx.fill(G.ghost);
    // the top quarter of the scale is the loud zone, lit at full strength
    const body=new Path2D(), hot=new Path2D(), caps=new Path2D(), refl=new Path2D(), refl2=new Path2D(), peaks=new Path2D();
    const hotAt=Math.round(nSeg*0.74);
    for(let i=0;i<N;i++){
      const a=this.amp(bins,i);
      const n=a>0.02 ? Math.min(nSeg, Math.max(1, Math.round(a*nSeg))) : 0;
      const x=xs[i];
      for(let j=0;j<n;j++){
        (j===n-1 ? caps : j>=hotAt ? hot : body).rect(x, mid-2-(j+1)*pitch+off, bw, seg);
        // reflection: the half nearest the axis a little stronger than the rest
        (j<n*0.5 ? refl : refl2).rect(x, mid+2+j*pitch, bw, seg);
      }
      // peak hold: sits for ~0.45 s, then falls at 9 segments a second
      if(n>=this.peak[i]){ this.peak[i]=n; this.hold[i]=450; }
      else if(this.hold[i]>0) this.hold[i]-=dt;
      else this.peak[i]=Math.max(0, this.peak[i]-dt*0.009);
      const p=Math.round(this.peak[i]);
      if(p>n) peaks.rect(x, mid-2-p*pitch+off, bw, Math.max(1, Math.round(seg*0.5)));
    }
    ctx.fillStyle=c.refl2; ctx.fill(refl2);
    ctx.fillStyle=c.refl;  ctx.fill(refl);
    ctx.fillStyle=c.bar;   ctx.fill(body);
    ctx.fillStyle=c.hot;   ctx.fill(hot);
    ctx.fillStyle=c.cap;   ctx.fill(caps);
    ctx.fillStyle=c.peak;  ctx.fill(peaks);

    // axis with a tick every 8 columns, and bracket ends
    ctx.fillStyle=c.axis;
    ctx.fillRect(0, mid, w, 1);
    ctx.fillStyle=c.tick;
    for(let i=0;i<=N;i+=8) ctx.fillRect(Math.round(G.x0+i*G.cw), mid-3, 1, 7);
    ctx.fillRect(0, mid-6, 1, 13); ctx.fillRect(w-1, mid-6, 1, 13);
  },

  /* Game mode: the meter is stowed. One faint slat per column on each side
     of the axis, and the mode stenciled in a bracketed tag. */
  audioStill(ctx, w, h, label){
    const c=this.pal(), N=this.N, mid=Math.round(h/2);
    const cs=getComputedStyle(ctx.canvas.parentElement);
    const px=clamp(Math.round(parseFloat(cs.fontSize)*0.78)||11, 8, 20);
    ctx.font=`600 ${px}px Bahnschrift, "Segoe UI", sans-serif`;
    try{ ctx.letterSpacing=(px*0.3).toFixed(1)+"px"; }catch(e){}
    ctx.textAlign="center"; ctx.textBaseline="middle";
    const tw=ctx.measureText(label).width, gap=tw/2+px*1.6, cx=w/2;

    const pitch=Math.max(3, Math.round((mid-3)/13)), seg=Math.max(2, pitch-Math.max(1,Math.round(pitch*0.34)));
    const x0=Math.round(w*0.01), cw=(w-2*x0)/N, bw=Math.max(2, Math.round(cw*0.62));
    const stubs=new Path2D();
    for(let i=0;i<N;i++){
      const x=Math.round(x0+i*cw+(cw-bw)/2);
      if(Math.abs(x+bw/2-cx)<gap) continue;
      stubs.rect(x, mid-2-seg, bw, seg);
      stubs.rect(x, mid+2, bw, seg);
    }
    ctx.fillStyle=c.stub; ctx.fill(stubs);
    ctx.fillStyle=c.axis;
    ctx.fillRect(0, mid, Math.max(0,cx-gap), 1);
    ctx.fillRect(Math.min(w,cx+gap), mid, w, 1);
    ctx.fillStyle=c.tick;
    ctx.fillRect(0, mid-6, 1, 13); ctx.fillRect(w-1, mid-6, 1, 13);
    // bracket tag around the label
    const bx=Math.round(cx-gap+px*0.5), bx2=Math.round(cx+gap-px*0.5), bh=Math.round(px*0.9), arm=Math.round(px*0.45);
    ctx.fillStyle=c.axis;
    ctx.fillRect(bx, mid-bh, 1, bh*2+1);   ctx.fillRect(bx, mid-bh, arm, 1); ctx.fillRect(bx, mid+bh, arm, 1);
    ctx.fillRect(bx2, mid-bh, 1, bh*2+1);  ctx.fillRect(bx2-arm+1, mid-bh, arm, 1); ctx.fillRect(bx2-arm+1, mid+bh, arm, 1);
    ctx.fillStyle=c.label;
    ctx.fillText(label, cx+px*0.15, mid+1);
  },

  /* Stepped area: one flat step per sample, a bright top edge, and a head
     block on the newest reading. The scale floats (x1.2 of the window max,
     at least 20) so an idle machine still shows its texture without every
     graph pinned to the ceiling. */
  spark(ctx, w, h, data){
    const c=this.pal(), n=data.length;
    if(n<2) return;
    let mx=0; for(let i=0;i<n;i++) if(data[i]>mx) mx=data[i];
    const top=clamp(mx*1.2, 20, 100);
    const yb=Math.floor(h)-1, span=yb-2, sw=(w-2)/n;
    let g=this.sparkGrad.get(ctx);
    if(!g || g.gen!==PAL.gen || g.h!==h){
      const gr=ctx.createLinearGradient(0,1,0,yb);
      gr.addColorStop(0,c.fillA); gr.addColorStop(1,c.fillB);
      g={gen:PAL.gen, h:h, g:gr}; this.sparkGrad.set(ctx,g);
    }
    const ys=new Array(n);
    for(let i=0;i<n;i++) ys[i]=Math.round(yb-clamp(data[i]/top,0,1)*span)+0.5;

    const area=new Path2D();
    area.moveTo(1, yb);
    for(let i=0;i<n;i++){ area.lineTo(1+i*sw, ys[i]); area.lineTo(1+(i+1)*sw, ys[i]); }
    area.lineTo(w-1, yb); area.closePath();
    ctx.fillStyle=g.g; ctx.fill(area);

    // baseline and a tick every 8 samples
    ctx.fillStyle=c.grid;
    ctx.fillRect(0, yb, w, 1);
    for(let i=0;i<=n;i+=8) ctx.fillRect(Math.round(1+i*sw), yb-2, 1, 2);

    const edge=new Path2D();
    edge.moveTo(1, ys[0]);
    for(let i=0;i<n;i++){ edge.lineTo(1+i*sw, ys[i]); edge.lineTo(1+(i+1)*sw, ys[i]); }
    ctx.strokeStyle=c.edge; ctx.lineWidth=1; ctx.lineJoin="miter";
    ctx.stroke(edge);

    ctx.fillStyle=c.head;
    ctx.fillRect(Math.round(w-1-Math.max(2,sw)), ys[n-1]-1.5, Math.max(2,Math.round(sw)), 3);
  }
};
HUDS.blade={
  label:"Blade",
  audio:(ctx,w,h,bins,t)=>BLADE_HUD.audio(ctx,w,h,bins,t),
  audioStill:(ctx,w,h,label)=>BLADE_HUD.audioStill(ctx,w,h,label),
  spark:(ctx,w,h,data)=>BLADE_HUD.spark(ctx,w,h,data)
};
