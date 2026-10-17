/* =========================================================================
   STARSHIP RENDERER (WebGL 1)
   One mesh, two looks:
     * lit   a studio-model hull: key light, an accent-colored rim from
             behind, panel tone, lit window rows, glowing grilles, bussards,
             deflector and impulse engines;
     * holo  a tactical hologram in the HUD accent: dark glass with a
             Fresnel rim, station and waterline contours, a scan band
             running bow to stern, and a projector pad underneath.
   Glow is real bloom: emissive surfaces are drawn again into a half-
   resolution target with the hull as an occluder, blurred, and added.

     const R=SHIPGL.create(canvas)        null when WebGL is unavailable
     R.load(geo, ship)                    geo = SHIPGEOM.finish(...)
     R.begin(w, h)                        device px; clears both targets
     R.draw(o)                            o = { vp:[x,y,w,h], yaw, pitch, roll,
                                                look, accent:[r,g,b], t, energy,
                                                zoom, scan }
     R.end()                              blur + composite
     R.project([x,y,z])                   last view: -> [px, py, near] in
                                          CSS-free device px from the canvas
                                          top-left; near > 0 faces the camera
   ========================================================================= */
const SHIPGL=(()=>{
  const VS=`
attribute vec3 aP; attribute vec3 aN; attribute vec3 aX;
uniform mat4 uMVP;
varying vec3 vP; varying vec3 vN; varying vec3 vX;
void main(){ vP=aP; vN=aN; vX=aX; gl_Position=uMVP*vec4(aP,1.0); }`;
  const FS=`
#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec3 vP; varying vec3 vN; varying vec3 vX;
uniform vec3 uCam, uKey, uRim, uAcc, uHull, uDefl, uLo, uHi;
uniform float uLook, uPass, uT, uE, uLen, uDeck, uScan, uWinOn;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
// past 1.0 an emitter keeps its hue: scale by the brightest channel, then whiten the core a little
vec3 hue1(vec3 c){ float m=max(c.r,max(c.g,c.b)); return m>1.0 ? c/m+vec3((m-1.0)*0.1) : c; }
float grid(float v){ float d=abs(fract(v+0.5)-0.5); float w=fwidth(v); return 1.0-smoothstep(0.0, w*1.25, d); }
void main(){
  vec3 N=normalize(vN); if(!gl_FrontFacing) N=-N;
  vec3 V=normalize(uCam-vP);
  float m=floor(vX.x+0.5);
  float ndv=clamp(dot(N,V),0.0,1.0);
  vec3 emit=vec3(0.0);
  float pulse=1.0+0.55*uE;
  if(m==2.0) emit=vec3(0.20,0.40,1.0)*1.45*pulse;
  else if(m==3.0) emit=vec3(1.0,0.09,0.035)*1.6*(0.9+0.35*uE);
  else if(m==4.0) emit=uDefl*1.45;
  else if(m==5.0) emit=vec3(1.0,0.15,0.05)*1.4;
  else if(m==8.0) emit=vec3(1.0,0.96,0.86)*1.5;
  vec3 col;
  float a=1.0;
  if(uLook<0.5){
    // ---- lit ----
    vec3 alb=uHull;
    if(m==1.0) alb=uHull*0.74;
    else if(m==6.0) alb=uHull*0.18;
    else if(m==7.0) alb=vec3(0.66,0.16,0.08);
    else if(m>=2.0 && m<=5.0) alb=uHull*0.35;
    // panel tone: a triplanar cell grid, a few percent either way, plus faint seams
    vec3 an=abs(N); float cs=uLen/64.0;
    vec2 q= an.y>max(an.x,an.z) ? vP.xz : (an.x>an.z ? vP.zy : vP.xy);
    vec2 cell=floor(q/cs);
    float h=hash(cell), h2=hash(floor(q/(cs*0.5))+7.3);
    alb*=0.93+0.07*h+0.035*h2;
    float pl=max(grid(q.x/cs), grid(q.y/cs))*(1.0-smoothstep(0.08,0.3,fwidth(q.x/cs)));
    alb*=1.0-0.12*pl;
    float ndl=dot(N,uKey);
    float diff=max(ndl,0.0);
    vec3 F=normalize(vec3(-uKey.x,-0.2,-uKey.z));
    float fill=max(dot(N,F),0.0);
    float hemi=mix(0.035,0.10,N.y*0.5+0.5);
    vec3 H=normalize(uKey+V);
    float nh=max(dot(N,H),0.0);
    float spec=pow(nh,40.0)*0.42+pow(nh,8.0)*0.05;
    col=alb*(hemi+1.35*diff*vec3(1.0,0.97,0.92)+0.16*fill*mix(vec3(1.0),uAcc,0.5))+vec3(spec)*(0.4+0.6*diff);
    float fr=pow(1.0-ndv,2.6);
    col+=uAcc*fr*(0.12+1.1*max(dot(N,uRim),0.0));
    // lit windows on the near-vertical faces
    if(uWinOn>0.5 && vX.y>0.5 && abs(N.y)<0.6){
      float dy=vP.y/uDeck, dx=vX.z/(uDeck*1.15);
      float fy=fract(dy), fx=fract(dx);
      float sw=fwidth(dy);
      float on=step(0.42,hash(vec2(floor(dy),floor(dx))))*(1.0-smoothstep(0.25,0.6,sw));
      float wy=smoothstep(0.30-sw,0.30+sw,fy)*(1.0-smoothstep(0.58-sw,0.58+sw,fy));
      float fw=fwidth(dx);
      float wx=smoothstep(0.18-fw,0.18+fw,fx)*(1.0-smoothstep(0.78-fw,0.78+fw,fx));
      emit+=vec3(1.0,0.88,0.66)*on*wy*wx*1.1;
    }
    col=vec3(1.0)-exp(-col*1.3);
    col+=hue1(emit);
  }else{
    // ---- holo ----
    float fr=pow(1.0-ndv,3.4);
    float ndl=max(dot(N,uKey),0.0);
    float sv=vP.x/(uLen/30.0), wv=vP.y/(uLen/70.0);
    // contour lines fade out where they would be thinner than a pixel apart (moire)
    float st=grid(sv)*(1.0-smoothstep(0.12,0.35,fwidth(sv)));
    float wl=grid(wv)*(1.0-smoothstep(0.12,0.35,fwidth(wv)));
    float lines=max(st*0.6,wl*0.45)*(0.45+0.55*fr);
    float band=exp(-pow((vP.x-mix(uLo.x,uHi.x,uScan))/(uLen*0.03),2.0));
    float glow=(m>=2.0 && m<=5.0 || m==8.0) ? 1.0 : 0.0;
    col=uAcc*(0.025+0.05*ndl) + uAcc*fr*1.25 + uAcc*lines*0.62 + uAcc*band*(0.08+0.25*fr);
    vec3 hot=mix(uAcc,vec3(1.0),0.45);
    col+=hot*glow*0.65*pulse;
    emit=uAcc*(fr*0.45+lines*0.25+band*0.12) + hot*glow*0.9*pulse;
    a=0.92;
  }
  if(uPass>0.5){ gl_FragColor=vec4(emit,1.0); return; }
  gl_FragColor=vec4(col*a,a);
}`;
  // projector pad under the hologram: a flat disc, rings and ticks drawn in polar coordinates
  const PVS=`
attribute vec2 aQ; uniform mat4 uMVP; uniform float uR, uY; varying vec2 vQ;
void main(){ vQ=aQ; gl_Position=uMVP*vec4(aQ.x*uR, uY, aQ.y*uR, 1.0); }`;
  const PFS=`
#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec2 vQ; uniform vec3 uAcc; uniform float uRot, uPass;
float ring(float r, float c, float w){ float f=fwidth(r); return 1.0-smoothstep(w, w+f*1.5, abs(r-c)); }
void main(){
  float r=length(vQ); if(r>1.0) discard;
  float an=atan(vQ.y,vQ.x)+uRot;
  // angular size of a pixel, from the position derivatives (atan's seam would spike fwidth)
  float pa=length(abs(dFdx(vQ))+abs(dFdy(vQ)))/max(r,1e-3)/6.2831853;
  float a72=an/6.2831853*72.0, d72=abs(fract(a72+0.5)-0.5), f72=pa*72.0;
  float tick=(1.0-smoothstep(f72*0.5, f72*1.5, d72))*step(0.9,r)*step(r,0.97);
  float a8=an/6.2831853*8.0, d8=abs(fract(a8+0.5)-0.5), f8=pa*8.0;
  float mtk=(1.0-smoothstep(f8*1.0, f8*2.2, d8))*step(0.82,r)*step(r,0.99);
  float v=ring(r,0.985,0.003)*0.55 + ring(r,0.88,0.0015)*0.30 + ring(r,0.6,0.0012)*0.16;
  v+=tick*0.28+mtk*0.5;
  v+=smoothstep(1.0,0.2,r)*0.05;
  vec3 c=uAcc*v;
  if(uPass>0.5){ gl_FragColor=vec4(c*0.35,1.0); return; }
  gl_FragColor=vec4(c, clamp(v,0.0,1.0)*0.8);
}`;
  const QVS=`attribute vec2 aQ; varying vec2 vU; void main(){ vU=aQ*0.5+0.5; gl_Position=vec4(aQ,0.0,1.0); }`;
  const BLUR=`precision mediump float; varying vec2 vU; uniform sampler2D uTex; uniform vec2 uDir;
void main(){
  vec3 c=texture2D(uTex,vU).rgb*0.2270270;
  c+=texture2D(uTex,vU+uDir*1.3846154).rgb*0.3162162; c+=texture2D(uTex,vU-uDir*1.3846154).rgb*0.3162162;
  c+=texture2D(uTex,vU+uDir*3.2307692).rgb*0.0702703; c+=texture2D(uTex,vU-uDir*3.2307692).rgb*0.0702703;
  gl_FragColor=vec4(c,1.0);
}`;
  const COMP=`precision mediump float; varying vec2 vU; uniform sampler2D uA; uniform sampler2D uB; uniform float uK;
void main(){
  vec3 c=(texture2D(uA,vU).rgb*0.5+texture2D(uB,vU).rgb*0.8)*uK;
  float m=max(c.r,max(c.g,c.b));
  c*=(1.0-exp(-m))/max(m,1e-4);
  gl_FragColor=vec4(c, max(c.r,max(c.g,c.b)));
}`;

  /* ---- 4x4 matrices, column-major ---- */
  function mul(a,b){ const o=new Float32Array(16);
    for(let c=0;c<4;c++) for(let r=0;r<4;r++){ let s=0; for(let k=0;k<4;k++) s+=a[k*4+r]*b[c*4+k]; o[c*4+r]=s; } return o; }
  function persp(fy, asp, n, f){ const t=1/Math.tan(fy/2), o=new Float32Array(16);
    o[0]=t/asp; o[5]=t; o[10]=(f+n)/(n-f); o[11]=-1; o[14]=2*f*n/(n-f); return o; }
  function rotY(a){ const c=Math.cos(a), s=Math.sin(a), o=ident(); o[0]=c; o[2]=-s; o[8]=s; o[10]=c; return o; }
  function rotX(a){ const c=Math.cos(a), s=Math.sin(a), o=ident(); o[5]=c; o[6]=s; o[9]=-s; o[10]=c; return o; }
  function rotZ(a){ const c=Math.cos(a), s=Math.sin(a), o=ident(); o[0]=c; o[1]=s; o[4]=-s; o[5]=c; return o; }
  function trans(x,y,z){ const o=ident(); o[12]=x; o[13]=y; o[14]=z; return o; }
  function scal(s){ const o=ident(); o[0]=o[5]=o[10]=s; return o; }
  function ident(){ const o=new Float32Array(16); o[0]=o[5]=o[10]=o[15]=1; return o; }
  function xform(m,p){ const x=p[0],y=p[1],z=p[2];
    const w=m[3]*x+m[7]*y+m[11]*z+m[15];
    return [(m[0]*x+m[4]*y+m[8]*z+m[12])/w, (m[1]*x+m[5]*y+m[9]*z+m[13])/w, (m[2]*x+m[6]*y+m[10]*z+m[14])/w, w]; }
  // inverse of a rigid rotation (transpose of the 3x3 block)
  function rotT(m,v){ return [m[0]*v[0]+m[1]*v[1]+m[2]*v[2], m[4]*v[0]+m[5]*v[1]+m[6]*v[2], m[8]*v[0]+m[9]*v[1]+m[10]*v[2]]; }
  const nrm=v=>{ const l=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/l,v[1]/l,v[2]/l]; };

  function create(cv){
    let gl=null;
    const attrs={ alpha:true, premultipliedAlpha:true, antialias:true, depth:true, preserveDrawingBuffer:false };
    try{ gl=cv.getContext("webgl",attrs)||cv.getContext("experimental-webgl",attrs); }catch(e){}
    if(!gl) return null;
    const R={ gl, cv, ok:false, geo:null, shipDef:null, last:null };
    function init(){
      R.ext32=gl.getExtension("OES_element_index_uint");
      R.extD=gl.getExtension("OES_standard_derivatives");
      const prog=(vs,fs)=>{
        const p=gl.createProgram();
        [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]].forEach(([k,src])=>{
          const s=gl.createShader(k); gl.shaderSource(s,src); gl.compileShader(s);
          if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
          gl.attachShader(p,s);
        });
        gl.linkProgram(p);
        if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        const u={}, n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);
        for(let i=0;i<n;i++){ const a=gl.getActiveUniform(p,i); u[a.name]=gl.getUniformLocation(p,a.name); }
        return { p, u };
      };
      R.main=prog(VS,FS); R.pad=prog(PVS,PFS); R.blur=prog(QVS,BLUR); R.comp=prog(QVS,COMP);
      R.quad=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,R.quad);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]),gl.STATIC_DRAW);
      // pad disc: a 96-gon fan in the unit circle
      const d=[]; for(let i=0;i<96;i++){ const a=i/96*Math.PI*2, b=(i+1)/96*Math.PI*2;
        d.push(0,0, Math.cos(a)*1.02,Math.sin(a)*1.02, Math.cos(b)*1.02,Math.sin(b)*1.02); }
      R.disc=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,R.disc); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(d),gl.STATIC_DRAW);
      R.fb=[0,1,2].map(()=>({ f:gl.createFramebuffer(), t:gl.createTexture(), d:gl.createRenderbuffer(), w:0, h:0 }));
      R.ok=true;
      if(R.geo) upload();
    }
    function sizeFB(F, w, h, depth){
      if(F.w===w && F.h===h) return;
      F.w=w; F.h=h;
      gl.bindTexture(gl.TEXTURE_2D,F.t);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER,F.f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,F.t,0);
      if(depth){
        gl.bindRenderbuffer(gl.RENDERBUFFER,F.d);
        gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,F.d);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }
    function upload(){
      const g=R.geo, n=g.pos.length/3, buf=new Float32Array(n*9);
      for(let i=0;i<n;i++){
        buf.set([g.pos[i*3],g.pos[i*3+1],g.pos[i*3+2], g.nrm[i*3],g.nrm[i*3+1],g.nrm[i*3+2], g.mat[i],g.win[i],g.wc[i]], i*9);
      }
      // a ship change replaces the buffers; free the old ones first
      if(R.vbo){ gl.deleteBuffer(R.vbo); gl.deleteBuffer(R.ibo); }
      R.vbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,R.vbo); gl.bufferData(gl.ARRAY_BUFFER,buf,gl.STATIC_DRAW);
      R.ibo=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,R.ibo);
      if(R.ext32){ gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,g.idx,gl.STATIC_DRAW); R.itype=gl.UNSIGNED_INT; }
      else { gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(g.idx),gl.STATIC_DRAW); R.itype=gl.UNSIGNED_SHORT; }
      R.count=g.idx.length;
    }
    cv.addEventListener("webglcontextlost", e=>{ e.preventDefault(); R.ok=false; R.fb=null; R.vbo=R.ibo=null; });
    cv.addEventListener("webglcontextrestored", ()=>{ try{ init(); }catch(e){ console.warn("starship: GL restore failed", e); } });
    try{ init(); }catch(e){ console.warn("starship: GL init failed", e); return null; }

    R.load=function(geo, ship){
      R.geo=geo; R.shipDef=ship||{};
      const c=[(geo.lo[0]+geo.hi[0])/2,(geo.lo[1]+geo.hi[1])/2,(geo.lo[2]+geo.hi[2])/2];
      R.center=c; R.len=Math.max(1e-3, geo.hi[0]-geo.lo[0]);
      if(R.ok) upload();
    };
    R.begin=function(w,h){
      if(!R.ok) return;
      R.W=w; R.H=h;
      if(cv.width!==w) cv.width=w;
      if(cv.height!==h) cv.height=h;
      const bw=Math.max(2,Math.round(w/2)), bh=Math.max(2,Math.round(h/2));
      sizeFB(R.fb[0],bw,bh,true); sizeFB(R.fb[1],bw,bh,false); sizeFB(R.fb[2],bw,bh,false);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.viewport(0,0,w,h); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER,R.fb[0].f);
      gl.viewport(0,0,bw,bh); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      R.glowK=0;
    };
    function bindMesh(P){
      gl.bindBuffer(gl.ARRAY_BUFFER,R.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,R.ibo);
      const loc=n=>gl.getAttribLocation(P.p,n);
      [["aP",3,0],["aN",3,12],["aX",3,24]].forEach(([n,s,o])=>{ const l=loc(n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l,s,gl.FLOAT,false,36,o); });
    }
    R.draw=function(o){
      if(!R.ok || !R.geo) return;
      const sh=R.shipDef||{};
      const vp=o.vp||[0,0,R.W,R.H], asp=vp[2]/vp[3];
      const look=o.look==="holo"?1:0;
      // model: recenter, unit length, then the pose
      const g=R.geo, k=1/R.len;
      const pitch=o.pitch===undefined?0.33:o.pitch, yaw=o.yaw||0, roll=o.roll||0;
      const model=mul(rotZ(roll), mul(rotY(yaw), mul(scal(k), trans(-R.center[0],-R.center[1],-R.center[2]))));
      // camera: distance that keeps the turning ship inside the viewport
      const beam=(g.hi[2]-g.lo[2])*k, hgt=(g.hi[1]-g.lo[1])*k;
      const rh=0.5*Math.hypot(1,beam), rv=rh*Math.sin(Math.abs(pitch))+0.5*hgt*Math.cos(pitch);
      const fy=(o.fov||20)*Math.PI/180, fx=2*Math.atan(Math.tan(fy/2)*asp);
      const pad=look?1.06:1.0;
      let dist=Math.max(rh/Math.tan(fx/2), (rv+(look?0.12:0))/Math.tan(fy/2))*1.04*pad/(o.zoom||1);
      const view=mul(trans(0,look?0.04:0,-dist), rotX(pitch));
      const proj=persp(fy,asp,Math.max(0.01,dist-1.2),dist+1.2);
      const VM=mul(view,model), MVP=mul(proj,VM);
      R.last={ MVP, vp, k };
      // camera, key and rim lights in model space (meters)
      const inv=v=>rotT(mul(view,model),v);
      const camW=xform(invRigid(VM),[0,0,0]);
      const key=nrm(inv(nrm([-0.72,0.42,0.55]))), rim=nrm(inv(nrm([0.3,0.35,-0.9])));
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
      const P=R.main; gl.useProgram(P.p); bindMesh(P);
      const u=P.u;
      gl.uniformMatrix4fv(u.uMVP,false,MVP);
      gl.uniform3fv(u.uCam,camW.slice(0,3)); gl.uniform3fv(u.uKey,key); gl.uniform3fv(u.uRim,rim);
      gl.uniform3fv(u.uAcc,o.accent||[0,0.85,0.91]);
      gl.uniform3fv(u.uHull,sh.hull||[0.62,0.64,0.68]); gl.uniform3fv(u.uDefl,sh.defl||[0.35,0.6,1.0]);
      gl.uniform3fv(u.uLo,g.lo); gl.uniform3fv(u.uHi,g.hi);
      gl.uniform1f(u.uLook,look); gl.uniform1f(u.uT,o.t||0); gl.uniform1f(u.uE,o.energy||0);
      gl.uniform1f(u.uLen,R.len); gl.uniform1f(u.uDeck,sh.deck||3.6); gl.uniform1f(u.uScan,o.scan===undefined?((o.t||0)/14)%1:o.scan);
      gl.uniform1f(u.uWinOn,sh.windows===false?0:1);
      // main pass
      gl.viewport(vp[0],R.H-vp[1]-vp[3],vp[2],vp[3]);
      gl.uniform1f(u.uPass,0);
      if(look){ gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
      gl.drawElements(gl.TRIANGLES,R.count,R.itype,0);
      // glow pass, half resolution
      const F=R.fb[0], sx=F.w/R.W, sy=F.h/R.H;
      gl.bindFramebuffer(gl.FRAMEBUFFER,F.f);
      gl.viewport(Math.round(vp[0]*sx),Math.round((R.H-vp[1]-vp[3])*sy),Math.round(vp[2]*sx),Math.round(vp[3]*sy));
      gl.disable(gl.BLEND);
      gl.uniform1f(u.uPass,1);
      gl.drawElements(gl.TRIANGLES,R.count,R.itype,0);
      // projector pad (holo only): flat, under the keel, turning with the ship
      if(look){
        const Q=R.pad; gl.useProgram(Q.p);
        gl.bindBuffer(gl.ARRAY_BUFFER,R.disc);
        const l=gl.getAttribLocation(Q.p,"aQ"); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);
        const padM=mul(proj, mul(view, rotZ(roll)));
        gl.uniformMatrix4fv(Q.u.uMVP,false,padM);
        gl.uniform1f(Q.u.uR,0.46); gl.uniform1f(Q.u.uY,-(R.center[1]-g.lo[1])*k-0.09);
        gl.uniform3fv(Q.u.uAcc,o.accent||[0,0.85,0.91]); gl.uniform1f(Q.u.uRot,yaw);
        gl.depthMask(false);
        gl.uniform1f(Q.u.uPass,1); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE);
        gl.drawArrays(gl.TRIANGLES,0,96*3);
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        gl.viewport(vp[0],R.H-vp[1]-vp[3],vp[2],vp[3]);
        gl.uniform1f(Q.u.uPass,0); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES,0,96*3);
        gl.depthMask(true);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.disable(gl.BLEND);
      R.glowK=Math.max(R.glowK, o.glow===undefined?1:o.glow);
    };
    R.end=function(){
      if(!R.ok) return;
      const A=R.fb[0], B=R.fb[1], C=R.fb[2];
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      const quad=P=>{ gl.useProgram(P.p); gl.bindBuffer(gl.ARRAY_BUFFER,R.quad);
        const l=gl.getAttribLocation(P.p,"aQ"); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0); };
      const pass=(src,dst,dx,dy)=>{
        gl.bindFramebuffer(gl.FRAMEBUFFER,dst.f); gl.viewport(0,0,dst.w,dst.h);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,src.t);
        gl.uniform1i(R.blur.u.uTex,0); gl.uniform2f(R.blur.u.uDir,dx/src.w,dy/src.h);
        gl.drawArrays(gl.TRIANGLES,0,6);
      };
      quad(R.blur);
      pass(A,B,1.2,0); pass(B,A,0,1.2);    // tight, back into A
      pass(A,B,4,0); pass(B,C,0,4);        // wide
      pass(C,B,4,0); pass(B,C,0,4);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,R.W,R.H);
      quad(R.comp);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,A.t);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,C.t);
      gl.uniform1i(R.comp.u.uA,0); gl.uniform1i(R.comp.u.uB,1); gl.uniform1f(R.comp.u.uK,R.glowK);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE);
      gl.drawArrays(gl.TRIANGLES,0,6);
      gl.disable(gl.BLEND); gl.activeTexture(gl.TEXTURE0);
    };
    R.project=function(p){
      const L=R.last; if(!L) return null;
      const c=xform(L.MVP,p), vp=L.vp;
      return [vp[0]+(c[0]*0.5+0.5)*vp[2], vp[1]+(0.5-c[1]*0.5)*vp[3], c[2], c[3]];
    };
    return R;
  }
  // inverse of [R|t] where R is rotation*uniform scale
  function invRigid(m){
    const s2=m[0]*m[0]+m[1]*m[1]+m[2]*m[2];
    const o=new Float32Array(16);
    for(let r=0;r<3;r++) for(let c=0;c<3;c++) o[c*4+r]=m[r*4+c]/s2;
    o[15]=1;
    const t=[m[12],m[13],m[14]];
    for(let r=0;r<3;r++) o[12+r]=-(o[r]*t[0]+o[4+r]*t[1]+o[8+r]*t[2]);
    return o;
  }
  return { create };
})();
