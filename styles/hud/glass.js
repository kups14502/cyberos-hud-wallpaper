/* =========================================================================
   HUD STYLE: GLASS  (canvas hooks; the panel look is hud/glass.css)
   Sparklines become smooth curves over a fill that fades to nothing, and the
   visualizer becomes one mirrored waveform, low frequencies in the middle and
   tapering to a point at both ends, instead of a row of bars.
   Colors are cached per palette (PAL.gen) and gradients per canvas and size,
   so a frame builds two or three paths and allocates nothing else.
   ========================================================================= */
(function(){
  "use strict";

  /* Palette strings. Strokes keep the accent's hue but cap its lightness, so
     a near-white accent still draws a line with some color in it instead of a
     gray smear, and a dark one is lifted enough to read on black. */
  const C={ gen:-1 };
  function pal(){
    if(C.gen===PAL.gen) return C;
    C.gen=PAL.gen;
    const h=PAL.h, s=PAL.s, L=clamp(PAL.l+8, 36, 82);
    C.line  = hslStr(h, s, L, 0.95);
    C.hair  = hslStr(h, s, L, 0.14);
    C.pill  = hslStr(h, s, L, 0.30);
    C.halo  = hslStr(h, s, L, 0.20);
    C.dot   = hslStr(h, clamp(s-10,0,100), clamp(PAL.l+28,0,96));
    C.f0    = hslStr(h, s, L, 0.28);
    C.f1    = hslStr(h, s, L, 0.07);
    C.fx    = hslStr(h, s, L, 0);       // same hue at zero alpha, so fades never gray out
    C.core  = hslStr(h, s, L, 0.30);
    C.coreHi= hslStr(h, clamp(s-10,0,100), clamp(PAL.l+20,0,94), 0.55);
    C.text  = hslStr(h, clamp(s-35,0,100), 66, 0.8);
    return C;
  }

  /* ---- sparklines (about 3 Hz) ---- */
  const SPK=new WeakMap();              // ctx -> {gen, h, grad, ys}
  function spark(ctx, w, h, data){
    const n=data.length;
    if(n<2 || w<4 || h<4) return;
    const P=pal();
    let st=SPK.get(ctx);
    if(!st){ st={gen:-1, h:0, grad:null, ys:new Float32Array(n)}; SPK.set(ctx, st); }
    if(st.gen!==PAL.gen || st.h!==h){
      const g=ctx.createLinearGradient(0,0,0,h);
      g.addColorStop(0, P.f0); g.addColorStop(0.6, P.f1); g.addColorStop(1, P.fx);
      st.gen=PAL.gen; st.h=h; st.grad=g;
    }
    if(st.ys.length!==n) st.ys=new Float32Array(n);
    // A 1-2-1 pass takes the jitter out of the samples, so the curve reads as
    // a trend rather than noise. The scale leaves a third of the box as
    // headroom, so a steady load sits mid-height instead of pinning a flat
    // slab to the top, and the floor keeps an idle 3% from filling the box.
    const ys=st.ys; let mx=0;
    for(let i=0;i<n;i++){
      const v=(data[i>0?i-1:0] + 2*data[i] + data[i<n-1?i+1:n-1])*0.25;
      ys[i]=v; if(v>mx) mx=v;
    }
    const top=Math.max(mx*1.5, 16), padL=1, padR=4.5, y0=3.5, y1=h-1.5;
    const dx=(w-padL-padR)/(n-1), sy=(y1-y0)/top;
    for(let i=0;i<n;i++) ys[i]=y1-ys[i]*sy;

    const curve=()=>{
      ctx.moveTo(padL, ys[0]);
      for(let i=1;i<n-1;i++){
        const x=padL+i*dx;
        ctx.quadraticCurveTo(x, ys[i], x+dx*0.5, (ys[i]+ys[i+1])*0.5);
      }
      ctx.lineTo(padL+(n-1)*dx, ys[n-1]);
    };
    ctx.beginPath(); curve();
    ctx.lineTo(padL+(n-1)*dx, y1); ctx.lineTo(padL, y1); ctx.closePath();
    ctx.fillStyle=st.grad; ctx.fill();

    ctx.strokeStyle=P.hair; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(padL, Math.round(y1)+0.5); ctx.lineTo(w-padR, Math.round(y1)+0.5); ctx.stroke();

    ctx.strokeStyle=P.line; ctx.lineWidth=1.25; ctx.lineJoin="round"; ctx.lineCap="round";
    ctx.beginPath(); curve(); ctx.stroke();

    const ex=padL+(n-1)*dx, ey=ys[n-1];
    ctx.fillStyle=P.halo; ctx.beginPath(); ctx.arc(ex, ey, 3.4, 0, 6.2832); ctx.fill();
    ctx.fillStyle=P.dot;  ctx.beginPath(); ctx.arc(ex, ey, 1.6, 0, 6.2832); ctx.fill();
  }

  /* ---- visualizer (up to 60 fps) ----
     k runs 0 at the center to S at either tip and maps onto the spectrum from
     the lowest bin outward. The top quarter of the bins carries almost nothing
     in real music, so it is left off. The taper pins both tips to the axis,
     which is what makes this read as one shape, not a graph, and two smoothing
     passes (mirrored at the center) keep the middle round instead of pointed.
     A brighter core at half height gives the shape some depth. */
  const AUDB=48;
  const AUDS=new WeakMap();             // ctx -> {gen, w, h, S, a, env, outer, inner}
  function lens(ctx, A, S, cx, dx, mid, k0){
    ctx.beginPath();
    ctx.moveTo(cx-S*dx, mid);
    for(let k=S-1;k>=1;k--){
      const x=cx-k*dx;
      ctx.quadraticCurveTo(x, mid-A[k]*k0, x+dx*0.5, mid-(A[k]+A[k-1])*0.5*k0);
    }
    for(let k=0;k<S;k++){
      const x=cx+k*dx;
      ctx.quadraticCurveTo(x, mid-A[k]*k0, x+dx*0.5, mid-(A[k]+A[k+1])*0.5*k0);
    }
    ctx.lineTo(cx+S*dx, mid);
    for(let k=S-1;k>=1;k--){
      const x=cx+k*dx;
      ctx.quadraticCurveTo(x, mid+A[k]*k0, x-dx*0.5, mid+(A[k]+A[k-1])*0.5*k0);
    }
    for(let k=0;k<S;k++){
      const x=cx-k*dx;
      ctx.quadraticCurveTo(x, mid+A[k]*k0, x-dx*0.5, mid+(A[k]+A[k+1])*0.5*k0);
    }
    ctx.closePath();
  }
  function audio(ctx, w, h, bins){
    const P=pal(), mid=h/2, maxA=Math.max(2, mid-3);
    let st=AUDS.get(ctx);
    if(!st){ st={gen:-1, w:0, h:0}; AUDS.set(ctx, st); }
    if(st.gen!==PAL.gen || st.w!==w || st.h!==h){
      const g=ctx.createLinearGradient(0, mid-maxA, 0, mid+maxA);
      g.addColorStop(0, P.fx); g.addColorStop(0.5, P.core); g.addColorStop(1, P.fx);
      const gi=ctx.createLinearGradient(0, mid-maxA*0.5, 0, mid+maxA*0.5);
      gi.addColorStop(0, P.fx); gi.addColorStop(0.5, P.coreHi); gi.addColorStop(1, P.fx);
      st.outer=g; st.inner=gi; st.gen=PAL.gen; st.w=w; st.h=h;
      st.S=clamp(Math.round(w/7), 24, 90);
      st.a=new Float32Array(st.S+1);
      st.env=new Float32Array(st.S+1);
      for(let k=0;k<=st.S;k++) st.env[k]=Math.pow(Math.cos(k/st.S*Math.PI*0.5), 1.25);
    }
    const S=st.S, A=st.a, env=st.env, N=bins.length, last=N-1;
    for(let k=0;k<=S;k++){
      // smoothstep between bins: the curve is level at every bin center, so a
      // strong bass bin crowns the middle instead of pinching it into a spike
      const f=k/S*AUDB, i0=f|0, u=f-i0, fr=u*u*(3-2*u);
      const v=(bins[i0<last?i0:last]||0)*(1-fr) + (bins[i0+1<last?i0+1:last]||0)*fr;
      // soft knee: quiet passages stay visible, loud ones never clip the box
      A[k]=(1-Math.exp(-clamp(v,0,2)*3.2))*maxA*env[k];
    }
    for(let pass=0;pass<2;pass++){
      let prev=A[1];
      for(let k=0;k<=S;k++){
        const cur=A[k], next=k<S ? A[k+1] : 0;
        A[k]=(prev+2*cur+next)*0.25; prev=cur;
      }
    }
    const cx=w/2, dx=(w/2-1)/S;

    lens(ctx, A, S, cx, dx, mid, 1);
    ctx.fillStyle=st.outer; ctx.fill();
    ctx.strokeStyle=P.line; ctx.lineWidth=1.2; ctx.lineJoin="round";
    ctx.stroke();
    lens(ctx, A, S, cx, dx, mid, 0.5);
    ctx.fillStyle=st.inner; ctx.fill();

    // the axis it breathes around
    ctx.strokeStyle=P.hair; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0, Math.round(mid)+0.5); ctx.lineTo(w, Math.round(mid)+0.5); ctx.stroke();
  }

  /* ---- game mode's parked visualizer (drawn once per entry) ----
     The axis alone, fading out toward both ends, with the mode set in a pill
     where the waveform's center would be. */
  function audioStill(ctx, w, h, label){
    const P=pal(), mid=Math.round(h/2)+0.5;
    const px=clamp(Math.round(h*0.12), 8, 16), ls=px*0.26;
    ctx.font=`600 ${px}px "Segoe UI Variable Small","Segoe UI",sans-serif`;
    try{ ctx.letterSpacing=ls.toFixed(1)+"px"; }catch(e){}
    ctx.textAlign="center"; ctx.textBaseline="middle";
    const tw=ctx.measureText(label).width, pw=tw+px*2.2, ph=px*2.1, r=ph/2;
    const x0=w/2-pw/2, x1=w/2+pw/2;

    const g=ctx.createLinearGradient(0,0,w,0);
    g.addColorStop(0, P.fx); g.addColorStop(0.5, P.pill); g.addColorStop(1, P.fx);
    ctx.strokeStyle=g; ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(w*0.03, mid); ctx.lineTo(x0-px*0.8, mid);
    ctx.moveTo(x1+px*0.8, mid); ctx.lineTo(w*0.97, mid);
    ctx.stroke();

    ctx.strokeStyle=P.pill;
    ctx.beginPath();
    ctx.moveTo(x0+r, mid-r); ctx.lineTo(x1-r, mid-r);
    ctx.arc(x1-r, mid, r, -Math.PI/2, Math.PI/2);
    ctx.lineTo(x0+r, mid+r);
    ctx.arc(x0+r, mid, r, Math.PI/2, Math.PI*1.5);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle=P.text;
    ctx.fillText(label, w/2+ls/2, mid+0.5);
    try{ ctx.letterSpacing="0px"; }catch(e){}
  }

  HUDS.glass={ label:"Glass", audio:audio, audioStill:audioStill, spark:spark };
})();
