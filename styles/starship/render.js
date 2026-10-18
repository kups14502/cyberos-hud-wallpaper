/* =========================================================================
   STARSHIP RENDERER (WebGL 1)
   One mesh, two looks:
     * lit   a studio-model hull: a key lamp that falls off across the
             model, an accent-colored rim from behind, a soft fill and an
             overhead softbox; painted plates that differ in tone and sheen,
             lit window rows, glowing grilles, bussards, deflector and
             impulse engines;
     * holo  a tactical hologram in the HUD accent: dark glass with a
             Fresnel rim and an outline, station, waterline and deck
             contours, a scan band running bow to stern, and a projector
             pad underneath.
   Glow is real bloom: emissive surfaces are drawn again into a half-
   resolution target with the hull as an occluder, blurred, and added.
   Both looks share an occlusion bake made once per hull on load (see
   bake()): how open each vertex is, and toward where, so the saucer
   shades the hull under it and joints and crevices stay dark, without a
   shadow pass.

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

   Optional ship fields read here:
     hull        [r,g,b] paint, default [0.62,0.64,0.68]
     defl        [r,g,b] deflector glow, default [0.35,0.6,1.0]
     deck        deck height in meters for the window rows, default 3.6
     windows     false: no lit windows
     winDensity  share of windows lit, 0..1, default 0.58
     panel       plate height in meters (plates run twice as long), default hull
                 length / 64, at least 4
     aztec       plate tone and sheen strength, 0 flat paint .. 1.5; default 1 for
                 a light hull, down to 0.3 for a dark one
     occlusion   false: skip the occlusion bake
   ========================================================================= */
const SHIPGL=(()=>{
  const VS=`
attribute vec3 aP; attribute vec3 aN; attribute vec3 aX; attribute vec4 aO;
uniform mat4 uMVP;
varying vec3 vP; varying vec3 vN; varying vec3 vX; varying vec4 vO;
void main(){ vP=aP; vN=aN; vX=aX; vO=aO; gl_Position=uMVP*vec4(aP,1.0); }`;
  const FS=`
#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec3 vP; varying vec3 vN; varying vec3 vX; varying vec4 vO;
uniform vec3 uCam, uKey, uKeyP, uSoft, uRim, uFill, uUp, uAcc, uHull, uDefl, uLo, uHi;
uniform float uDbg, uKeyD, uLook, uPass, uT, uE, uLen, uDeck, uScan, uWinOn, uWinD, uPanel, uAzt, uOcc;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
// past 1.0 an emitter keeps its hue: scale by the brightest channel, then whiten the core a little
vec3 hue1(vec3 c){ float m=max(c.r,max(c.g,c.b)); return m>1.0 ? c/m+vec3((m-1.0)*0.1) : c; }
float grid(float v){ float d=abs(fract(v+0.5)-0.5); float w=fwidth(v); return 1.0-smoothstep(0.0, w*1.25, d); }
// contour lines fade out where they would be thinner than a pixel apart (moire)
float lines(float v){ return grid(v)*(1.0-smoothstep(0.12,0.35,fwidth(v))); }
// baked occlusion: how open the vertex is toward d, as a smooth function on the sphere (mean vO.w,
// first moment vO.xyz), over what an unblocked face with normal n would see
float vis(vec3 d, vec3 n){
  float v=vO.w+dot(vO.xyz,d), v0=0.5+0.75*dot(n,d);
  return mix(1.0, clamp(v/max(v0,0.3),0.0,1.0), uOcc);
}
void main(){
  vec3 N=normalize(vN); if(!gl_FrontFacing) N=-N;
  vec3 V=normalize(uCam-vP);
  float m=floor(vX.x+0.5);
  float ndv=clamp(dot(N,V),0.0,1.0);
  float pulse=1.0+0.55*uE;
  float glow=(m>=2.0 && m<=5.0 || m==8.0 || m==10.0) ? 1.0 : 0.0;
  float ao=vis(N,N);
  if(uLook>0.5){
    // ---- holo ----
    // the Fresnel rim, held back on big flat faces seen edge on (they would wash out) and kept
    // full where the hull curves away (curvature: how fast the normal turns, per hull length)
    float cv=length(fwidth(N))/max(length(fwidth(vP)),1e-5)*uLen;
    float fr=pow(1.0-ndv,3.4)*mix(0.5,1.0,smoothstep(3.0,14.0,cv));
    // and an outline a few pixels wide wherever the hull turns away from the camera
    fr+=0.55*(1.0-smoothstep(1.0,3.5,ndv/max(fwidth(ndv),1e-4)));
    float ndl=max(dot(N,uKey),0.0)*vis(uKey,N);
    float sv=vP.x/(uLen/30.0), wv=vP.y/(uLen/70.0), bv=vP.z/(uLen/15.0);
    // stations and waterlines; on near-flat decks, where waterlines never reach, buttock lines at
    // twice the station spacing; every fifth station is a major one
    float dk=smoothstep(0.82,0.97,abs(N.y));
    float ln=max(lines(sv)*0.55, lines(wv)*0.42);
    ln=max(ln, lines(bv)*0.36*dk);
    ln=max(ln, lines(sv/5.0)*0.95);
    ln*=0.45+0.55*fr;
    float band=exp(-pow((vP.x-mix(uLo.x,uHi.x,uScan))/(uLen*0.03),2.0));
    vec3 hot=mix(uAcc,vec3(1.0),0.45);
    vec3 emit=uAcc*(fr*0.45+ln*0.25+band*0.12) + hot*glow*0.9*pulse;
    if(uPass>0.5){ gl_FragColor=vec4(emit,1.0); return; }
    vec3 col=uAcc*(0.026+0.11*ndl)*ao + uAcc*fr*1.25 + uAcc*ln*0.62 + uAcc*band*(0.08+0.25*fr);
    col+=hot*glow*0.65*pulse;
    gl_FragColor=vec4(col*0.92,0.92);
    return;
  }
  // ---- lit ----
  // emitters: hotter where they face the camera
  vec3 emit=vec3(0.0);
  float core=ndv*ndv;
  if(m==2.0) emit=vec3(0.18,0.40,1.0)*(1.15+0.6*core)*pulse;
  else if(m==3.0) emit=mix(vec3(1.0,0.06,0.025), vec3(1.0,0.11,0.045), core)*(1.1+0.5*core)*(0.9+0.35*uE);
  else if(m==4.0) emit=uDefl*(1.1+0.8*core);
  else if(m==5.0) emit=vec3(1.0,0.15,0.05)*(1.1+0.6*core);
  else if(m==10.0) emit=vec3(1.0,0.40,0.14)*(0.7+0.4*core);   // a lit interior seen through an opening
  else if(m==8.0){
    // window lamps the ship file lays on: rooms of a few meters share a tone, a few burn cooler
    float h=hash(floor(vP.xz/(uDeck*3.0))+floor(vP.y/uDeck)*7.3);
    emit=mix(vec3(1.0,0.93,0.80), vec3(0.88,0.94,1.0), step(0.82,fract(h*7.0)))*(1.25+0.5*h);
  }
  // lit windows on the near-vertical faces (which window is lit is the same pattern ship files are
  // fitted to); rooms of a few windows share a brightness, a few rooms burn cooler, and rows too
  // fine to draw fade to their average
  if(uWinOn>0.5 && vX.y>0.5 && abs(N.y)<0.6){
    float dy=vP.y/uDeck, dx=vX.z/(uDeck*1.15);
    float sw=fwidth(dy), fw=fwidth(dx);
    float row=floor(dy), rm=floor(dx/5.0+hash(vec2(row,3.1)));
    float on=step(1.0-uWinD,hash(vec2(row,floor(dx))));
    float hr=hash(vec2(rm,row)+9.7);
    vec3 wc=mix(vec3(1.0,0.85,0.62), vec3(0.86,0.92,1.0), step(0.84,hash(vec2(rm,row)+5.1)))*(0.7+0.6*hr);
    float fy=fract(dy), fx=fract(dx);
    float wy=smoothstep(0.30-sw,0.30+sw,fy)*(1.0-smoothstep(0.58-sw,0.58+sw,fy));
    float wx=smoothstep(0.18-fw,0.18+fw,fx)*(1.0-smoothstep(0.78-fw,0.78+fw,fx));
    float far=smoothstep(0.22,0.55,max(sw,fw*0.6));
    emit+=mix(wc*on*wy*wx, vec3(1.0,0.85,0.62)*0.07*uWinD, far)*1.15;
  }
  if(uPass>0.5){ gl_FragColor=vec4(emit,1.0); return; }
  vec3 alb=uHull; float sk=1.0;
  if(m==1.0) alb=uHull*0.74;
  else if(m==6.0){ alb=uHull*0.18; sk=0.6; }
  else if(m==7.0) alb=vec3(0.66,0.16,0.08);
  else if(m==9.0) alb=uHull*vec3(1.10,1.06,0.96);
  else if(glow>0.5){ alb=uHull*0.1; sk=0.4; }   // dark glass over the emitter, so its hue stays
  // plates: staggered rows of plates twice as long as they are high on the face's main plane, each
  // split once; plates differ a little in tone and more in sheen, as the paint on a model does
  vec3 an=abs(N);
  vec2 q=(an.y>max(an.x,an.z) ? vP.xz : (an.x>an.z ? vP.zy : vP.xy))/uPanel*vec2(0.5,1.0);
  float pw=max(fwidth(q.x)*2.0,fwidth(q.y));
  float pf=1.0-smoothstep(0.1,0.3,pw);
  q.x+=hash(vec2(floor(q.y),7.0));
  vec2 c=floor(q), f=fract(q);
  float k1=0.3+0.4*hash(c+31.7), s1=step(k1,f.x);
  float id=hash(c+vec2(s1*1.7,5.3));
  float tone=id<0.55 ? 0.0 : (id<0.8 ? 0.022 : (id<0.94 ? -0.02 : 0.04));
  float gloss=id<0.55 ? 0.5 : (id<0.8 ? 0.85 : (id<0.94 ? 0.2 : 1.0));
  // seams: row and plate edges, in pixels
  float ex=min(min(f.x,1.0-f.x),abs(f.x-k1))/max(fwidth(q.x),1e-5), ey=min(f.y,1.0-f.y)/max(fwidth(q.y),1e-5);
  float seam=1.0-smoothstep(0.5,1.5,min(ex,ey));
  float sf=1.0-smoothstep(0.04,0.12,pw);
  // aztec: blocks three plates long and two rows high share a tone, so the paint reads in stepped
  // patches from further off than single plates do
  float pf2=1.0-smoothstep(0.3,0.9,pw);
  float bt=hash(floor(c/vec2(3.0,2.0))+vec2(4.1,8.7));
  float at=bt<0.5 ? 0.0 : (bt<0.78 ? 0.035 : -0.03);
  alb*=1.0+uAzt*(pf*tone+pf2*at);
  alb*=1.0-0.09*seam*sf;
  sk*=(1.0+uAzt*pf*(gloss-0.5)*0.9)*(1.0+uAzt*pf2*(bt-0.5)*0.3);
  // a broad drift in the paint, as on a hand-finished model
  vec3 u=vP/uLen;
  alb*=1.0+0.035*sin(u.x*17.0+2.0*sin(u.z*23.0))*sin(u.z*13.0+1.7*sin(u.y*29.0+u.x*7.0));
  // light: the key is a lamp a couple of hull lengths off, so it falls off across the model and
  // its highlight moves over parallel faces; then studio fill and sky, the highlight, the rim
  vec3 Lk=uKeyP-vP; float dl=length(Lk); Lk/=dl;
  float fall=mix(1.0, uKeyD*uKeyD/(dl*dl), 0.85);
  float ndl=dot(N,Lk);
  float vk=vis(Lk,N);
  float diff=max(ndl,0.0)*vk*fall;
  // the studio around the model, so faces turned from the key keep their form: a cool sky overhead
  // that darkens toward the sides, a faint warm bounce off the floor and the fill card, each shaded
  // by the occlusion toward it
  float up=dot(N,uUp);
  vec3 amb=vec3(0.075,0.085,0.10)*(0.3+0.7*smoothstep(-0.4,1.0,up))*vis(uUp,N)
          +vec3(0.05,0.042,0.034)*smoothstep(0.1,-1.0,up)*vis(-uUp,N)
          +0.11*max(dot(N,uFill)*0.8+0.2,0.0)*mix(vec3(0.85,0.9,1.0),uAcc,0.3)*ao;
  vec3 H=normalize(Lk+V);
  float nh=max(dot(N,H),0.0);
  vec3 dn=fwidth(N);
  float gp=mix(26.0,64.0,gloss*pf+0.5*(1.0-pf))/(1.0+dot(dn,dn)*80.0);   // wider where normals turn fast: no sparkle
  float spec=(pow(nh,gp)*0.38+pow(nh,9.0)*0.06)*sk*vk*fall*smoothstep(-0.05,0.25,ndl);
  // the big overhead softbox, seen as a broad sheen in the paint; it is what shows the plates
  float sh=pow(max(dot(N,normalize(uSoft+V)),0.0),10.0)*0.11*sk*(1.0+uAzt*pf*(gloss-0.5)*0.6)*ao*min(1.0,0.2+dot(uHull,vec3(0.3,0.59,0.11)));
  vec3 R=reflect(-V,N);
  float env=pow(1.0-ndv,3.0)*(0.04+0.20*smoothstep(-0.2,0.8,dot(R,uUp)))*sk*ao;
  vec3 col=alb*(amb*0.85+1.6*diff*vec3(1.0,0.96,0.9)) + vec3(spec+env+sh);
  float fr=pow(1.0-ndv,2.6);
  col+=uAcc*fr*(0.10+1.1*max(dot(N,uRim),0.0)*vis(uRim,N))*mix(1.0,ao,0.5);
  // film response: an exposure curve with a soft shoulder, then a toe that deepens the shadows
  col=vec3(1.0)-exp(-col*1.3);
  col=col*col/(col+0.06)*1.06;
  col+=hue1(emit);
  gl_FragColor=vec4(col,1.0);
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
  vec3 c=uAcc*v*0.8;
  if(uPass>0.5){ gl_FragColor=vec4(c*0.3,1.0); return; }
  gl_FragColor=vec4(c, clamp(v,0.0,1.0)*0.7);
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

  /* Occlusion bake, once per hull: the triangles are sampled into a voxel grid (160 cells along
     the longest axis), then 24 rays from each vertex march it, out to 14% of that length. Rays
     leave from 1.5 cells off the surface on their own side, so a hull's winding does not matter,
     and rays along the surface count little (they would meet the surface's own cells). A ray that
     hits counts as open in proportion to how far it got. Per vertex, over the sphere: the open
     share (w) and its first moment (xyz), so the shader can ask how open the vertex is toward any
     direction. Two passes of neighbor averaging smooth out the voxel grain. About 60-140 ms for a
     50-85k vertex hull on a desktop CPU, then cached on the geometry. */
  function bake(g){
    const P=g.pos, Nn=g.nrm, I=g.idx, nv=P.length/3, lo=g.lo, hi=g.hi;
    const L=Math.max(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]), RES=160, iv=RES/L, pad=4;
    const nx=Math.ceil((hi[0]-lo[0])*iv)+2*pad, ny=Math.ceil((hi[1]-lo[1])*iv)+2*pad, nz=Math.ceil((hi[2]-lo[2])*iv)+2*pad;
    const ox=lo[0]-pad/iv, oy=lo[1]-pad/iv, oz=lo[2]-pad/iv, sy=nx, sz=nx*ny;
    const G=new Uint8Array(nx*ny*nz);
    for(let k=0;k<I.length;k+=3){
      const a=I[k]*3, b=I[k+1]*3, c=I[k+2]*3;
      const ax=(P[a]-ox)*iv, ay=(P[a+1]-oy)*iv, az=(P[a+2]-oz)*iv;
      const ux=(P[b]-ox)*iv-ax, uy=(P[b+1]-oy)*iv-ay, uz=(P[b+2]-oz)*iv-az;
      const wx=(P[c]-ox)*iv-ax, wy=(P[c+1]-oy)*iv-ay, wz=(P[c+2]-oz)*iv-az;
      const e=Math.max(Math.hypot(ux,uy,uz),Math.hypot(wx,wy,wz),Math.hypot(wx-ux,wy-uy,wz-uz));
      const m=Math.max(1,Math.ceil(e*1.5)), im=1/m;
      for(let i=0;i<=m;i++) for(let j=0;j<=m-i;j++){
        const s=i*im, t=j*im;
        G[((ax+ux*s+wx*t)|0)+((ay+uy*s+wy*t)|0)*sy+((az+uz*s+wz*t)|0)*sz]=1;
      }
    }
    // a thickened copy for the longer steps, so they cannot slip through a one-voxel shell
    const T=new Uint8Array(G.length);
    for(let z=1;z<nz-1;z++) for(let y=1;y<ny-1;y++){ let q=1+y*sy+z*sz;
      for(let x=1;x<nx-1;x++,q++) if(G[q]||G[q-1]||G[q+1]||G[q-sy]||G[q+sy]||G[q-sz]||G[q+sz]) T[q]=1; }
    const K=24, D=new Float32Array(K*3);
    for(let i=0;i<K;i++){ const y=1-(i+0.5)/K*2, r=Math.sqrt(1-y*y), a=i*2.399963; D[i*3]=Math.cos(a)*r; D[i*3+1]=y; D[i*3+2]=Math.sin(a)*r; }
    const tmax=RES*0.14, ST=[];
    { let t=1.0; while(t<5.0){ ST.push(t); t+=0.85; } while(t<tmax){ ST.push(t); t+=Math.min(2.4,0.9+t*0.08); } }
    const ns=ST.length, out=new Float32Array(nv*4);
    for(let v=0;v<nv;v++){
      const px=(P[v*3]-ox)*iv, py=(P[v*3+1]-oy)*iv, pz=(P[v*3+2]-oz)*iv;
      const n0=Nn[v*3], n1=Nn[v*3+1], n2=Nn[v*3+2];
      let sw=0, sv=0, bx=0, by=0, bz=0;
      for(let k=0;k<K;k++){
        const dx=D[k*3], dy=D[k*3+1], dz=D[k*3+2], c=dx*n0+dy*n1+dz*n2, ac=c<0?-c:c;
        let w=ac>=0.3?1:ac/0.3; w=w*w*(3-2*w);
        if(w<0.02) continue;
        const o=c<0?-1.5:1.5, qx=px+n0*o, qy=py+n1*o, qz=pz+n2*o;
        let hit=tmax;
        for(let s=0;s<ns;s++){
          const t=ST[s], X=(qx+dx*t)|0, Y=(qy+dy*t)|0, Z=(qz+dz*t)|0;
          if(X<0||Y<0||Z<0||X>=nx||Y>=ny||Z>=nz) break;
          const q=X+Y*sy+Z*sz;
          if(t<5.0 ? G[q] : T[q]){ hit=t; break; }
        }
        const h=w*hit/tmax;
        sw+=w; sv+=h; bx+=h*dx; by+=h*dy; bz+=h*dz;
      }
      const k=sw>0 ? 3/sw : 0;
      out[v*4]=bx*k; out[v*4+1]=by*k; out[v*4+2]=bz*k; out[v*4+3]=sw>0 ? sv/sw : 1;
    }
    const acc=new Float32Array(nv*4), cnt=new Float32Array(nv);
    for(let it=0;it<2;it++){
      acc.set(out); cnt.fill(1);
      for(let k=0;k<I.length;k+=3) for(let e=0;e<3;e++){
        const a=I[k+e], b=I[k+(e+1)%3];
        for(let j=0;j<4;j++){ acc[a*4+j]+=out[b*4+j]; acc[b*4+j]+=out[a*4+j]; }
        cnt[a]++; cnt[b]++;
      }
      for(let v=0;v<nv;v++){ const r=1/cnt[v]; for(let j=0;j<4;j++) out[v*4+j]=acc[v*4+j]*r; }
    }
    return out;
  }

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
      const g=R.geo, n=g.pos.length/3, buf=new Float32Array(n*13), o=g.occ;
      for(let i=0;i<n;i++){
        const b=i*13;
        buf[b]=g.pos[i*3]; buf[b+1]=g.pos[i*3+1]; buf[b+2]=g.pos[i*3+2];
        buf[b+3]=g.nrm[i*3]; buf[b+4]=g.nrm[i*3+1]; buf[b+5]=g.nrm[i*3+2];
        buf[b+6]=g.mat[i]; buf[b+7]=g.win[i]; buf[b+8]=g.wc[i];
        if(o){ buf[b+9]=o[i*4]; buf[b+10]=o[i*4+1]; buf[b+11]=o[i*4+2]; buf[b+12]=o[i*4+3]; } else buf[b+12]=0.5;
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
      // the bake rides on the geometry, so a ship shown again does not bake twice
      if(geo.occ===undefined){
        geo.occ=null;
        if(R.shipDef.occlusion!==false){ try{ geo.occ=bake(geo); }catch(e){ console.warn("starship: occlusion bake failed", e); } }
      }
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
    const ATTR=[["aP",3,0],["aN",3,12],["aX",3,24],["aO",4,36]];
    function bindMesh(P){
      gl.bindBuffer(gl.ARRAY_BUFFER,R.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,R.ibo);
      ATTR.forEach(([n,s,o])=>{ const l=gl.getAttribLocation(P.p,n); if(l<0) return;
        gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l,s,gl.FLOAT,false,52,o); });
    }
    function unbindMesh(P){
      ATTR.forEach(([n])=>{ const l=gl.getAttribLocation(P.p,n); if(l>=0) gl.disableVertexAttribArray(l); });
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
      // camera and the studio's lights in model space (meters): key, rim, fill and up are fixed to the camera
      const inv=v=>nrm(rotT(VM,nrm(v)));
      const camW=xform(invRigid(VM),[0,0,0]);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
      const hull=sh.hull||[0.62,0.64,0.68], lum=0.3*hull[0]+0.59*hull[1]+0.11*hull[2];
      const P=R.main; gl.useProgram(P.p); bindMesh(P);
      const u=P.u;
      gl.uniformMatrix4fv(u.uMVP,false,MVP);
      gl.uniform3fv(u.uCam,camW.slice(0,3));
      const key=inv([-0.72,0.42,0.55]), kd=R.len*2.2;
      gl.uniform3fv(u.uKey,key); gl.uniform3fv(u.uRim,inv([0.3,0.35,-0.9]));
      gl.uniform3fv(u.uKeyP,[R.center[0]+key[0]*kd, R.center[1]+key[1]*kd, R.center[2]+key[2]*kd]); gl.uniform1f(u.uKeyD,kd);
      gl.uniform3fv(u.uFill,inv([0.8,-0.25,0.45])); gl.uniform3fv(u.uUp,inv([0,1,0])); gl.uniform3fv(u.uSoft,inv([-0.3,0.9,0.3]));
      gl.uniform3fv(u.uAcc,o.accent||[0,0.85,0.91]);
      gl.uniform3fv(u.uHull,hull); gl.uniform3fv(u.uDefl,sh.defl||[0.35,0.6,1.0]);
      gl.uniform3fv(u.uLo,g.lo); gl.uniform3fv(u.uHi,g.hi);
      gl.uniform1f(u.uLook,look); gl.uniform1f(u.uT,o.t||0); gl.uniform1f(u.uE,o.energy||0);
      gl.uniform1f(u.uLen,R.len); gl.uniform1f(u.uDeck,sh.deck||3.6); gl.uniform1f(u.uScan,o.scan===undefined?((o.t||0)/14)%1:o.scan);
      gl.uniform1f(u.uWinOn,sh.windows===false?0:1);
      gl.uniform1f(u.uWinD,sh.winDensity===undefined?0.58:Math.min(1,Math.max(0,+sh.winDensity)));
      gl.uniform1f(u.uPanel,sh.panel>0?+sh.panel:Math.max(4,R.len/64));
      gl.uniform1f(u.uAzt,sh.aztec===undefined?Math.min(1,Math.max(0.3,lum*2.5-0.9)):Math.min(1.5,Math.max(0,+sh.aztec)));
      gl.uniform1f(u.uOcc,g.occ?1:0);
      if(u.uDbg) gl.uniform1f(u.uDbg,o.dbg||0);
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
      unbindMesh(P);
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
