/* =========================================================================
   STARSHIP GEOMETRY
   Every hull is built from one primitive, the sweep: a run of stations along
   a path, each a superellipse cross-section, smoothed with Catmull-Rom and
   stitched into a closed skin. A saucer is a sweep down the vertical axis.

   Ship frame, in meters: +x forward (bow), +y dorsal, +z starboard.

   sweep(M, o)   o.st      stations {x,y,z, w, t, b, n, nt, nb, k}
                             w  half-width along the side vector
                             t  half-height above the path (toward up)
                             b  half-height below it
                             n  superellipse exponent: 2 ellipse, 3-6 a
                                rounded box, under 2 pinched; nt / nb set
                                the top and bottom halves on their own
                             k  1 = a hard crease at this station
                 o.side    side reference, default [0,0,1]; the up vector is
                           side x tangent, so a sweep along +x has up = +y
                 o.seg     points around a section (default 40)
                 o.res     subdivisions per span (default 4)
                 o.cap     close open ends with a flat fan (default true)
                 o.mat     material name (see MATS)
                 o.mirror  also emit the copy mirrored to -z
                 o.win     1 = this skin can carry lit windows
                 o.wa      window run axis: "u" along the path, "v" around
   saucer(M, o)  o.x, o.y   center; o.prof  [[r, y], ...] top pole to bottom
                           pole, r from 0 to 1; o.fwd / o.aft / o.side  the
                           radii in each direction; o.n  plan superellipse
   ========================================================================= */
const SHIPGEOM=(()=>{
  const MATS={ hull:0, hull2:1, grille:2, bussard:3, deflector:4, impulse:5, dark:6, trim:7, lamp:8 };
  function mesh(){ return { p:[], m:[], w:[], c:[], i:[] }; }

  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const norm=a=>{ const l=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l]; };
  const FIELDS=["x","y","z","w","t","b","n","nt","nb"];

  function cr(a,b,c,d,t){
    const t2=t*t, t3=t2*t;
    return 0.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);
  }
  function fill(s){
    const o=Object.assign({x:0,y:0,z:0,w:0,n:2}, s);
    if(o.t===undefined) o.t=o.h!==undefined ? o.h : o.w;
    if(o.b===undefined) o.b=o.h!==undefined ? o.h : o.t;
    if(o.nt===undefined) o.nt=o.n;
    if(o.nb===undefined) o.nb=o.n;
    return o;
  }
  // one smooth run of stations -> dense stations
  function dense(run, res){
    if(run.length<2) return run.slice();
    const out=[];
    for(let i=0;i<run.length-1;i++){
      const a=run[Math.max(0,i-1)], b=run[i], c=run[i+1], d=run[Math.min(run.length-1,i+2)];
      const r=b.r||res;
      for(let k=0;k<r;k++){
        const t=k/r, s={};
        FIELDS.forEach(f=>{ s[f]=cr(a[f],b[f],c[f],d[f],t); });
        // a spline overshoots; a negative radius would turn the skin inside out
        s.w=Math.max(0,s.w); s.t=Math.max(0,s.t); s.b=Math.max(0,s.b);
        s.n=Math.max(0.6,s.n); s.nt=Math.max(0.6,s.nt); s.nb=Math.max(0.6,s.nb);
        out.push(s);
      }
    }
    out.push(Object.assign({}, run[run.length-1]));
    return out;
  }
  function spow(v,e){ return Math.sign(v)*Math.pow(Math.abs(v),e); }

  function sweep(M, o){
    const st=o.st.map(fill), res=o.res||4, seg=o.seg||40, mat=MATS[o.mat||"hull"]||0;
    const side=o.side||[0,0,1], win=o.win?1:0, wa=o.wa||"u";
    // split at creases: each run is smoothed alone and owns its own rings
    const runs=[]; let cur=[st[0]];
    for(let i=1;i<st.length;i++){
      cur.push(st[i]);
      if(st[i].k && i<st.length-1){ runs.push(cur); cur=[st[i]]; }
    }
    runs.push(cur);
    const all=[]; runs.forEach((r,ri)=>{ dense(r,res).forEach((s,j)=>{ s.run=ri; all.push(s); }); });
    // tangents from the dense path, per run
    for(let i=0;i<all.length;i++){
      const s=all[i];
      let a=all[i-1], c=all[i+1];
      if(!a || a.run!==s.run) a=s;
      if(!c || c.run!==s.run) c=s;
      if(a===s && c===s){ s.T=[1,0,0]; continue; }
      // a crease ring takes the tangent of its own run only
      s.T=norm(sub([c.x,c.y,c.z],[a.x,a.y,a.z]));
    }
    const copies=o.mirror ? [1,-1] : [1];
    copies.forEach(mz=>{
      let u=0, prev=null, ringStart=[];
      for(let i=0;i<all.length;i++){
        const s=all[i], T=s.T;
        if(prev && prev.run===s.run) u+=Math.hypot(s.x-prev.x,s.y-prev.y,s.z-prev.z);
        prev=s;
        let S=sub(side, T.map(v=>v*dot(side,T)));
        if(Math.hypot(S[0],S[1],S[2])<1e-6) S=[0,1,0];
        S=norm(S);
        const U=cross(S,T);
        ringStart.push(M.p.length/3);
        let v=0, lp=null;
        for(let j=0;j<=seg;j++){
          const a=(j%seg)/seg*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a);
          const top=sa>=0, ex=2/(top?s.nt:s.nb);
          const X=spow(ca,ex)*s.w, Y=spow(sa,ex)*(top?s.t:s.b);
          let px=s.x+S[0]*X+U[0]*Y, py=s.y+S[1]*X+U[1]*Y, pz=s.z+S[2]*X+U[2]*Y;
          if(lp) v+=Math.hypot(px-lp[0],py-lp[1],pz-lp[2]);
          lp=[px,py,pz];
          M.p.push(px, py, pz*mz); M.m.push(mat); M.w.push(win); M.c.push(wa==="u"?u:v);
        }
      }
      for(let i=0;i<all.length-1;i++){
        if(all[i].run!==all[i+1].run) continue;
        const a0=ringStart[i], b0=ringStart[i+1];
        for(let j=0;j<seg;j++){
          const a=a0+j, b=a0+j+1, c=b0+j, d=b0+j+1;
          if(mz>0) M.i.push(a,c,b, b,c,d); else M.i.push(a,b,c, b,d,c);
        }
      }
      // creases: duplicate ring of the next run starts where the last ended,
      // so nothing to stitch; caps close the two open ends
      if(o.cap!==false){
        [[0,1],[all.length-1,-1]].forEach(([idx,dir])=>{
          const s=all[idx]; if(s.w<1e-6 && s.t<1e-6 && s.b<1e-6) return;
          const r0=ringStart[idx], cidx=M.p.length/3;
          M.p.push(s.x, s.y, s.z*mz); M.m.push(mat); M.w.push(0); M.c.push(0);
          const rs=M.p.length/3;
          for(let j=0;j<=seg;j++){
            M.p.push(M.p[(r0+j)*3], M.p[(r0+j)*3+1], M.p[(r0+j)*3+2]); M.m.push(mat); M.w.push(0); M.c.push(0);
          }
          for(let j=0;j<seg;j++){
            const a=rs+j, b=rs+j+1;
            if((dir>0)===(mz>0)) M.i.push(cidx,a,b); else M.i.push(cidx,b,a);
          }
        });
      }
    });
    return M;
  }

  /* A saucer: a sweep straight down through its center. With the side
     vector +z and the path going down, the section's "up" points forward,
     so t is the forward radius and b the aft one. */
  function saucer(M, o){
    const x=o.x||0, z=o.z||0, f=o.fwd, a=o.aft!==undefined?o.aft:o.fwd, sd=o.side!==undefined?o.side:o.fwd;
    const st=o.prof.map(p=>({ x:x, y:p[1], z:z, w:sd*p[0], t:f*p[0], b:a*p[0], n:o.n||2, k:p[2]?1:0, r:p[3] }));
    return sweep(M, { st:st, side:[0,0,1], seg:o.seg||96, res:o.res||3, mat:o.mat, cap:o.cap,
                      mirror:o.mirror, win:o.win, wa:"v" });
  }

  /* Smooth normals (area weighted), only across vertices that are shared. */
  function finish(M){
    const n=new Float32Array(M.p.length), P=M.p, I=M.i;
    for(let k=0;k<I.length;k+=3){
      const a=I[k]*3, b=I[k+1]*3, c=I[k+2]*3;
      const e1=[P[b]-P[a],P[b+1]-P[a+1],P[b+2]-P[a+2]], e2=[P[c]-P[a],P[c+1]-P[a+1],P[c+2]-P[a+2]];
      const f=cross(e1,e2);
      for(const q of [a,b,c]){ n[q]+=f[0]; n[q+1]+=f[1]; n[q+2]+=f[2]; }
    }
    for(let q=0;q<n.length;q+=3){
      const l=Math.hypot(n[q],n[q+1],n[q+2])||1; n[q]/=l; n[q+1]/=l; n[q+2]/=l;
    }
    let lo=[1e9,1e9,1e9], hi=[-1e9,-1e9,-1e9];
    for(let q=0;q<P.length;q+=3) for(let k=0;k<3;k++){ lo[k]=Math.min(lo[k],P[q+k]); hi[k]=Math.max(hi[k],P[q+k]); }
    return { pos:new Float32Array(P), nrm:n, mat:new Float32Array(M.m), win:new Float32Array(M.w),
             wc:new Float32Array(M.c), idx:new Uint32Array(I), lo:lo, hi:hi, tris:I.length/3 };
  }

  return { MATS, mesh, sweep, saucer, finish };
})();
const SHIPS={};
