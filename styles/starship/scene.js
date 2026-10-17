/* =========================================================================
   SCENE: STARSHIP
   A 3D starship turning slowly over the primary monitor: the Enterprise-D,
   the Enterprise-A, Voyager or the Defiant, picked by the "Ship" property.
   Each hull is built at boot from a few hundred superellipse stations
   (SHIPGEOM above) and drawn with WebGL (SHIPGL above) in one of two looks:
   a lit studio model, or a hologram in the HUD accent with callouts and a
   projector pad.

   The ship has its own pair of canvases, sized to a box on the primary
   monitor rather than to the span: a WebGL canvas for the hull and a 2D one
   over it for the caption and callouts. The band stays empty, and the sky
   keeps the drifting stars, so a span reads as one field with the ship in
   front of it. Both canvases hide with CSS whenever the scene is not
   starship, the scene is switched off, or a background image replaces it.

   The ship redraws at about 30 fps. Audio energy brightens the warp grilles
   and bussards a little. Game mode draws one frame at a fixed three-quarter
   view and leaves it.
   ========================================================================= */
const STARSHIP=(()=>{
  const REDRAW_MS=33, TAU=Math.PI*2, DEG=String.fromCharCode(176), DOT=String.fromCharCode(183);
  const ORDER=["galaxy","constitution","intrepid","defiant"];
  const YAW0=-0.62, STILL_T=0;
  const ST={ cv:null, lab:null, ctx:null, R:null, failed:false, id:"", geos:{}, box:null, lay:"",
             acc:REDRAW_MS, redraw:true, e:0, side:{}, ly:{}, font:"" };
  const sm=(a,b,x)=>{ const u=clamp((x-a)/(b-a),0,1); return u*u*(3-2*u); };

  function dom(){
    if(ST.cv || ST.failed) return !!ST.cv;
    const css=document.createElement("style");
    css.textContent=
      "#ship-gl,#ship-lab{position:fixed;left:0;top:0;pointer-events:none;z-index:1;display:none}"+
      "body[data-scene=starship]:not(.no-terrain) #ship-gl,body[data-scene=starship]:not(.no-terrain) #ship-lab{display:block}"+
      "body.has-bgmedia:not(.bg-keep-scene) #ship-gl,body.has-bgmedia:not(.bg-keep-scene) #ship-lab{display:none}"+
      // kept over a picture, the stars rise to z 2; the ship stays in front of them
      "body.has-bgmedia.bg-keep-scene #ship-gl,body.has-bgmedia.bg-keep-scene #ship-lab{z-index:3}";
    document.head.appendChild(css);
    const stage=document.getElementById("stage"), at=document.getElementById("screens");
    ST.cv=document.createElement("canvas"); ST.cv.id="ship-gl";
    ST.lab=document.createElement("canvas"); ST.lab.id="ship-lab";
    stage.insertBefore(ST.cv, at); stage.insertBefore(ST.lab, at);
    ST.R=SHIPGL.create(ST.cv);
    if(!ST.R){ ST.failed=true; console.warn("CyberOS HUD: the starship scene needs WebGL"); return false; }
    ST.ctx=ST.lab.getContext("2d");
    return true;
  }

  /* The box: centered on the primary monitor, a little above the middle,
     where the HUD's side columns leave the most room. */
  function layout(){
    const S=(LAY.screens && LAY.screens.length) ? LAY.screens : [{x:0,y:0,w:window.innerWidth,h:window.innerHeight}];
    const P=S[LAY.primary||0] || S[0];
    const k=clamp(+CFG.shipSize||1, 0.5, 1.8);
    const w=Math.round(P.w*0.66*k), h=Math.round(P.h*0.72*k);
    const x=Math.round(P.x+P.w/2-w/2), y=Math.round(P.y+P.h*0.47-h/2);
    // past ~4.5 Mpx a moving model gains nothing a viewer can see
    const dpr=Math.min(window.devicePixelRatio||1, 2);
    const q=Math.min(dpr, Math.sqrt(4.5e6/Math.max(1,w*h)));
    const sig=x+","+y+","+w+","+h+","+q.toFixed(3);
    if(sig===ST.lay) return;
    ST.lay=sig; ST.box={x,y,w,h,q};
    [ST.cv,ST.lab].forEach(c=>{ c.style.left=x+"px"; c.style.top=y+"px"; c.style.width=w+"px"; c.style.height=h+"px"; });
    ST.lab.width=Math.max(2,Math.round(w*q)); ST.lab.height=Math.max(2,Math.round(h*q));
    ST.ctx.setTransform(q,0,0,q,0,0);
    ST.ly={};
  }

  function ship(){
    let id=CFG.shipModel;
    if(!SHIPS[id]) id=ORDER.find(k=>SHIPS[k]);
    if(id!==ST.id){
      if(!ST.geos[id]) ST.geos[id]=SHIPGEOM.finish(SHIPS[id].build(SHIPGEOM));
      ST.R.load(ST.geos[id], SHIPS[id]);
      ST.id=id; ST.side={}; ST.ly={};
    }
    return SHIPS[id];
  }

  function accent(){
    const s=PAL.s/100, l=PAL.l/100, a=s*Math.min(l,1-l);
    const f=n=>{ const k=(n+PAL.h/30)%12; return l-a*Math.max(-1,Math.min(k-3,9-k,1)); };
    return [f(0),f(8),f(4)];
  }

  function pose(t){
    const hold=CFG.shipMotion==="hold";
    return {
      yaw:   hold ? YAW0+0.42*Math.sin(t*TAU/96) : YAW0-t*TAU/150,
      pitch: 0.27+0.05*Math.sin(t*TAU/53),
      roll:  0.022*Math.sin(t*TAU/71+1.3)
    };
  }

  function render(t, still){
    if(!dom()) return;
    layout();
    const S=ship(), B=ST.box, R=ST.R, P=pose(t);
    const look=CFG.shipLook==="holo" ? "holo" : "lit";
    R.begin(Math.round(B.w*B.q), Math.round(B.h*B.q));
    R.draw({ yaw:P.yaw, pitch:P.pitch, roll:P.roll, look, accent:accent(), t,
             energy:still ? 0.2 : ST.e, glow:clamp(+CFG.glow,0,2) });
    R.end();
    overlay(S, look, P, still);
  }

  /* Caption under the ship; in the hologram, callouts on both sides with
     leaders to their parts. A label changes sides only well past the middle,
     and slides to its new height, so the turn never makes them jump. */
  function overlay(S, look, P, still){
    const c=ST.ctx, B=ST.box, R=ST.R, q=B.q;
    c.clearRect(0,0,B.w,B.h);
    const font=ST.font || (ST.font=getComputedStyle(document.body).fontFamily);
    const fs=clamp(B.h*0.021, 10, 30);
    const sp=v=>{ try{ c.letterSpacing=v.toFixed(1)+"px"; }catch(e){} };
    const hdg=((-P.yaw*180/Math.PI)%360+360)%360;
    c.textAlign="center"; c.textBaseline="alphabetic";
    c.font="600 "+fs.toFixed(1)+"px "+font; sp(fs*0.32);
    c.fillStyle=PAL.bright; c.globalAlpha=0.88;
    const y0=B.h*0.94;
    c.fillText(S.name+"  "+DOT+"  "+S.reg, B.w/2, y0);
    c.font=(fs*0.62).toFixed(1)+"px "+font; sp(fs*0.22);
    c.fillStyle=PAL.accent; c.globalAlpha=0.72;
    c.fillText(S.cls+"  "+DOT+"  "+S.len.toFixed(1)+" M  "+DOT+"  HDG "+hdg.toFixed(1)+DEG, B.w/2, y0+fs*1.25);
    sp(0); c.globalAlpha=1;
    if(look!=="holo" || !S.callouts || !S.callouts.length) return;

    const ctr=R.project(R.center), cw=ctr ? ctr[3] : 0, k=R.last ? R.last.k : 1;
    const items=S.callouts.map((co,i)=>{
      const p=R.project(co.at);
      // nearer than the ship's center -> on the side facing us
      const near=(cw-p[3])/Math.max(1e-6, k*R.len);
      return { i, text:co.text, x:p[0]/q, y:p[1]/q, a:0.22+0.78*sm(-0.16,0.06,near) };
    });
    items.forEach(it=>{
      const d=(it.x-B.w/2)/B.w, prev=ST.side[it.i];
      let s=prev===undefined ? (d<0?-1:1) : prev;
      if(prev===-1 && d>0.1) s=1;
      if(prev===1 && d<-0.1) s=-1;
      ST.side[it.i]=s; it.side=s;
    });
    const lh=fs*1.7, fl=fs*0.62;
    c.font=fl.toFixed(1)+"px "+font; sp(fl*0.2); c.textBaseline="middle";
    [-1,1].forEach(side=>{
      const col=items.filter(it=>it.side===side).sort((a,b)=>a.y-b.y);
      let yp=-1e9;
      col.forEach(it=>{
        const ty=clamp(Math.max(it.y, yp+lh), B.h*0.07, B.h*0.84); yp=ty;
        const cur=ST.ly[it.i];
        it.ly = (still || cur===undefined) ? ty : cur+(ty-cur)*0.12;
        ST.ly[it.i]=it.ly;
      });
      col.forEach(it=>{
        const tw=c.measureText(it.text).width;
        const lx=side<0 ? B.w*0.09 : B.w*0.91;
        const ex=side<0 ? lx+tw+fs*0.6 : lx-tw-fs*0.6;
        c.globalAlpha=it.a;
        c.strokeStyle=PAL.accent; c.lineWidth=1;
        c.beginPath();
        c.moveTo(lx, it.ly+fl*0.85); c.lineTo(ex, it.ly+fl*0.85); c.lineTo(it.x, it.y);
        c.stroke();
        c.fillStyle=PAL.bright;
        c.beginPath(); c.arc(it.x, it.y, 2.4, 0, TAU); c.fill();
        c.globalAlpha=it.a*0.5;
        c.beginPath(); c.arc(it.x, it.y, 6, 0, TAU); c.stroke();
        c.globalAlpha=it.a;
        c.textAlign=side<0 ? "left" : "right";
        c.fillText(it.text, lx, it.ly);
      });
    });
    sp(0); c.globalAlpha=1;
  }

  return {
    label:"Starship", band:0.05,
    init(T){ T.shClean=false; },
    frame(dt, S){
      ST.acc+=dt;
      ST.redraw=ST.acc>=REDRAW_MS;
      if(ST.redraw) ST.acc=0;
      const k=Math.min(1,(S.energy>ST.e?0.1:0.03)*dt/16);
      ST.e+=(S.energy-ST.e)*k;
      if(ST.redraw && CFG.terrain && sceneOn()) render(S.t, false);
    },
    // the band is not used: keep it empty
    draw(T){ if(!T.shClean){ T.ctx.clearRect(0,0,T.w,T.h); T.shClean=true; } },
    still(T){ T.ctx.clearRect(0,0,T.w,T.h); T.shClean=true; if(T===TERS[0]) render(STILL_T, true); }
  };
})();
SCENES.starship=STARSHIP;
