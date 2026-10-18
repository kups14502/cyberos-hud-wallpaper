/* USS Enterprise NCC-1701-A, Constitution class refit (movie era).
   Frame: x 0 at the nacelle sterns to 305 at the saucer bow, y 0 at the keel, z starboard.
   Most parts are lofts: sections held upright (in the y-z plane) at stations along x, so a
   rising or falling centerline never tilts them. */
SHIPS.constitution={
  name:"U.S.S. ENTERPRISE", reg:"NCC-1701-A", cls:"CONSTITUTION CLASS",
  len:305, beam:141.7, height:71,
  hull:[0.74,0.75,0.77], defl:[0.40,0.65,1.0], deck:2.04,
  callouts:[
    {text:"MAIN BRIDGE", at:[233.6,72.1,0]},
    {text:"SAUCER SECTION", at:[268,58.96,30]},
    {text:"WARP NACELLE", at:[85,63.1,55.79]},
    {text:"BUSSARD COLLECTOR", at:[149.62,63.23,50.46]},
    {text:"MAIN DEFLECTOR", at:[188.55,21.8,0]},
    {text:"IMPULSE ENGINES", at:[158.7,57.2,4.6]},
    {text:"SHUTTLEBAY", at:[80.63,20.25,0]}],
  build(G){
    const Math=globalThis.Math; // a local binding: global lookups are slow inside the node vm that tools/ use
    const M=G.mesh(), V=()=>M.p.length/3, MAT=G.MATS;
    const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
    const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s], dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    const unit=a=>mul(a,1/(Math.hypot(a[0],a[1],a[2])||1));
    const spow=(v,e)=>Math.sign(v)*Math.pow(Math.abs(v),e);
    const cr=(a,b,c,d,t)=>{ const t2=t*t, t3=t2*t; return 0.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3); };
    const KEYS=["x","y","z","w","t","b","nt","nb"];
    // Catmull-Rom over the listed keys of each station; k:1 splits the run (a crease)
    function smooth(st, keys, res){
      const runs=[]; let cur=[st[0]];
      for(let i=1;i<st.length;i++){ cur.push(st[i]); if(st[i].k && i<st.length-1){ runs.push(cur); cur=[st[i]]; } }
      runs.push(cur);
      const out=[];
      runs.forEach((run,ri)=>{
        for(let i=0;i<run.length-1;i++){
          const a=run[Math.max(0,i-1)], b=run[i], c=run[i+1], d=run[Math.min(run.length-1,i+2)], r=b.r||res;
          for(let j=0;j<r;j++){ const s={run:ri}; keys.forEach(f=>{ s[f]=cr(a[f],b[f],c[f],d[f],j/r); }); out.push(s); }
        }
        out.push(Object.assign({run:ri}, run[run.length-1]));
      });
      return out;
    }
    // rings -> skin: R[i] is a closed ring of seg+1 points; caps close the two ends
    function skin(R, run, o, wc){
      const mat=MAT[o.mat||"hull"]||0, win=o.win?1:0, seg=R[0].length-1;
      (o.mirror?[1,-1]:[1]).forEach(mz=>{
        const base=[];
        R.forEach((ring,i)=>{ base.push(V()); ring.forEach((p,j)=>{ M.p.push(p[0],p[1],p[2]*mz); M.m.push(mat); M.w.push(win); M.c.push(wc(i,j)); }); });
        for(let i=0;i<R.length-1;i++){
          if(run[i]!==run[i+1]) continue;
          for(let j=0;j<seg;j++){
            const a=base[i]+j, b=a+1, c=base[i+1]+j, d=c+1;
            if((mz>0)!==!!o.flip) M.i.push(a,c,b, b,c,d); else M.i.push(a,b,c, b,d,c);
          }
        }
        if(o.cap!==false) [[0,1],[R.length-1,-1]].forEach(([i,dir])=>{
          const ring=R[i], c=ring.slice(0,seg).reduce((s,p)=>add(s,p),[0,0,0]).map(v=>v/seg);
          if(ring.every(p=>Math.hypot(p[0]-c[0],p[1]-c[1],p[2]-c[2])<1e-4)) return;
          const ci=V(); M.p.push(c[0],c[1],c[2]*mz); M.m.push(mat); M.w.push(0); M.c.push(0);
          const s0=V(); ring.forEach(p=>{ M.p.push(p[0],p[1],p[2]*mz); M.m.push(mat); M.w.push(0); M.c.push(0); });
          for(let j=0;j<seg;j++){ const a=s0+j, b=a+1; if((dir>0)===((mz>0)!==!!o.flip)) M.i.push(ci,a,b); else M.i.push(ci,b,a); }
        });
      });
    }
    function prep(st){ return st.map(s=>{ const q=Object.assign({z:0,n:2},s); if(q.b===undefined) q.b=q.t;
      if(q.nt===undefined) q.nt=q.n; if(q.nb===undefined) q.nb=q.n; return q; }); }
    // loft along x: stations {x,y,z,w,t,b,n,nt,nb,k,r}; w across (z), t up, b down
    function loft(o){
      const D=smooth(prep(o.st),KEYS,o.res||4), seg=o.seg||40, R=[], u=[0];
      D.forEach((s,i)=>{
        if(i) u.push(u[i-1]+(D[i-1].run===s.run?Math.abs(s.x-D[i-1].x):0));
        R.push(Array.from({length:seg+1},(_,j)=>ring(s,(j%seg)/seg*Math.PI*2)));
      });
      skin(R, D.map(s=>s.run), o, i=>u[i]);
      return D;
    }
    // a point on a loft section at angle a (0 starboard, PI/2 up)
    function ring(q, a){
      const ca=Math.cos(a), sa=Math.sin(a), top=sa>=0, ex=2/Math.max(0.6,top?q.nt:q.nb);
      return [q.x, q.y+spow(sa,ex)*Math.max(0,top?q.t:q.b), q.z+spow(ca,ex)*Math.max(0,q.w)];
    }
    // the section at a fractional index into dense stations, straight between rings like the skin
    function at(D, s){
      const i=Math.max(0,Math.min(D.length-2,Math.floor(s))), f=Math.max(0,Math.min(1,s-i)), a=D[i], b=D[i+1], l=(u,v)=>u+(v-u)*f;
      return { x:l(a.x,b.x), y:l(a.y,b.y), z:l(a.z,b.z), w:l(a.w,b.w), t:l(a.t,b.t), b:l(a.b,b.b), nt:l(a.nt,b.nt), nb:l(a.nb,b.nb) };
    }
    const sAt=(D,x)=>{ for(let i=0;i<D.length-1;i++) if(D[i+1].x>=x) return i+(x-D[i].x)/((D[i+1].x-D[i].x)||1); return D.length-1; };
    // a point on the lower half of a section, dz across from its center
    function low(q, dz){
      const ca=spow(Math.max(-1,Math.min(1,dz/Math.max(1e-6,q.w))),Math.max(0.6,q.nb)/2), sa=-Math.sqrt(Math.max(0,1-ca*ca));
      return [q.x, q.y+spow(sa,2/Math.max(0.6,q.nb))*q.b, q.z+dz];
    }
    // a raised panel on a surface: P(u,v) a surface point (u,v 0..1), C(u,v) a point inside the body;
    // the face stands d0 out along the normal, the walls run back to d1; own vertices keep edges crisp
    // win:1 lights windows on the face (columns run along u, in meters); d1===d0 leaves out the walls
    function panel(o){
      const mi=MAT[o.mat]||0, nu=o.nu, nv=o.nv, wn=o.win?1:0, S=[];
      for(let i=0;i<=nu;i++){ const r=[]; for(let j=0;j<=nv;j++) r.push(o.P(i/nu,j/nv)); S.push(r); }
      (o.mirror?[1,-1]:[1]).forEach(mz=>{
        // normals from the grid's own neighbors
        const Gd=S.map((r,i)=>r.map((p0,j)=>{
          const p=[p0[0],p0[1],p0[2]*mz], q=(a,b)=>{ const t=S[a][b]; return [t[0],t[1],t[2]*mz]; }, c=o.C(i/nu,j/nv);
          let n=unit(cross(sub(q(Math.min(nu,i+1),j),q(Math.max(0,i-1),j)), sub(q(i,Math.min(nv,j+1)),q(i,Math.max(0,j-1)))));
          if(dot(n,sub(p,[c[0],c[1],c[2]*mz]))<0) n=mul(n,-1);
          return [add(p,mul(n,o.d0)), add(p,mul(n,o.d1))]; }));
        const L=[0]; for(let i=1;i<=nu;i++){ const a=Gd[i-1][nv>>1][0], b=Gd[i][nv>>1][0]; L.push(L[i-1]+Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2])); }
        const put=(p,w,c)=>{ M.p.push(p[0],p[1],p[2]); M.m.push(mi); M.w.push(w||0); M.c.push(c||0); return V()-1; };
        const F=Gd.map((r,i)=>r.map(q=>put(q[0],wn,L[i])));
        for(let i=0;i<nu;i++) for(let j=0;j<nv;j++) M.i.push(F[i][j],F[i+1][j],F[i][j+1], F[i][j+1],F[i+1][j],F[i+1][j+1]);
        if(o.d1===o.d0) return;
        const E=[]; for(let j=0;j<nv;j++) E.push(Gd[0][j]); for(let i=0;i<nu;i++) E.push(Gd[i][nv]);
        for(let j=nv;j>0;j--) E.push(Gd[nu][j]); for(let i=nu;i>0;i--) E.push(Gd[i][0]); E.push(Gd[0][0]);
        for(let k=0;k<E.length-1;k++){ const a=put(E[k][0]), b=put(E[k+1][0]), c=put(E[k][1]), d=put(E[k+1][1]); M.i.push(a,c,b, b,c,d); }
      });
    }
    // cut the start of a mirrored, capped loft (built at v0, dense stations D) where g(p)<0: each cut
    // vertex slides along its seam to the exact plane crossing, and the start cap becomes the flat face
    function chisel(v0, D, seg, g, mat){
      const nR=D.length, per=nR*(seg+1)+2*(seg+2), O=[];
      for(let j=0;j<=seg;j++){
        const a=(j%seg)/seg*Math.PI*2; let lo=0, hi=nR-1;
        for(let it=0;it<30;it++){ const m=(lo+hi)/2; if(g(ring(at(D,m),a))<0) lo=m; else hi=m; }
        O.push(ring(at(D,(lo+hi)/2),a));
      }
      const c=O.slice(0,seg).reduce((s,p)=>add(s,p),[0,0,0]).map(v=>v/seg);
      [1,-1].forEach((mz,k)=>{
        const b=v0+k*per, set=(i,p,m)=>{ M.p[i*3]=p[0]; M.p[i*3+1]=p[1]; M.p[i*3+2]=p[2]*mz; if(m!==undefined) M.m[i]=m; };
        for(let i=0;i<nR;i++) for(let j=0;j<=seg;j++){ const vi=b+i*(seg+1)+j; if(g([M.p[vi*3],M.p[vi*3+1],0])<0) set(vi,O[j]); }
        const cc=b+nR*(seg+1); set(cc,c,MAT[mat]); for(let j=0;j<=seg;j++) set(cc+1+j,O[j],MAT[mat]);
      });
    }
    // lathe about a vertical axis: prof [[r,y,k]], radii fwd / aft / side, plan superellipse n
    function lathe(o){
      const P=o.prof.map(p=>({r:p[0],y:p[1],k:p[2]}));
      const D=smooth(P,["r","y"],o.res||3), seg=o.seg||96, n=o.n||2, R=[];
      D.forEach(s=>{
        const r=Math.max(0,s.r), ring=[];
        for(let j=0;j<=seg;j++){
          const a=(j%seg)/seg*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a), ex=2/n;
          ring.push([o.x+spow(sa,ex)*r*(sa>=0?o.fwd:o.aft), s.y, (o.z||0)+spow(ca,ex)*r*o.side]);
        }
        R.push(ring);
      });
      const L=Math.PI*o.side;
      skin(R, D.map(s=>s.run), o, (i,j)=>j/seg*2*L);
    }
    // a flat blade through stations [leading edge, trailing edge, half thickness]
    function blade(o){
      const st=o.st, C=st.map(s=>mul(add(s[0],s[1]),0.5));
      const span=sub(C[C.length-1],C[0]), chord=st.reduce((a,s)=>add(a,sub(s[0],s[1])),[0,0,0]);
      const N=unit(cross(span,chord)), seg=o.seg||28, n=o.n||3, R=[];
      st.forEach((s,i)=>{
        const H=mul(sub(s[0],s[1]),0.5), ring=[];
        for(let j=0;j<=seg;j++){
          const a=(j%seg)/seg*Math.PI*2;
          ring.push(add(add(C[i],mul(H,spow(Math.cos(a),2/n))), mul(N,s[2]*spow(Math.sin(a),2/n))));
        }
        R.push(ring);
      });
      // keep the winding outward: compare a face normal with the way out of the blade
      const a=R[0][0], b=R[0][1], c=R[1][0], f=cross(sub(c,a),sub(b,a));
      skin(R, R.map(()=>0), Object.assign({}, o, {flip:dot(f,sub(a,C[0]))<0}), ()=>0);
    }
    // squash every vertex from v0 on that lies past a limit onto it, along one axis
    function flat(v0, ax, f, below){
      for(let i=v0;i<V();i++){
        const p=[M.p[i*3],M.p[i*3+1],M.p[i*3+2]], lim=f(p);
        if(below ? p[ax]<lim : p[ax]>lim) M.p[i*3+ax]=lim;
      }
    }
    // rings over a plan outline: R[j] the outline's radius at angle j/seg about c=[x,z] (x along sin, z along cos,
    // as lathe does); prof [[f, d, y, k]] top first, each ring at radius f*R-d; d and y may be functions
    // (d of the angle, y of x,z); k:1 a hard edge; no smoothing
    function plan(o){
      const seg=o.R.length, R=[], run=[]; let ri=0;
      o.prof.forEach((p,i)=>{
        const ring=[];
        for(let j=0;j<=seg;j++){
          const a=(j%seg)/seg*Math.PI*2, d=typeof p[1]==="function"?p[1](a):p[1], r=Math.max(0,p[0]*o.R[j%seg]-d);
          const x=o.c[0]+Math.sin(a)*r, z=o.c[1]+Math.cos(a)*r;
          ring.push([x, typeof p[2]==="function"?p[2](x,z):p[2], z]);
        }
        R.push(ring); run.push(ri);
        if(p[3] && i<o.prof.length-1){ ri++; R.push(ring); run.push(ri); }
      });
      const L=R.map(r=>{ let s=0; return r.map((q,j)=>j?(s+=Math.hypot(q[0]-r[j-1][0],q[2]-r[j-1][2])):0); });
      skin(R, run, o, (i,j)=>L[i][j]);
    }
    // an outline's radius at seg angles about c, by bisection on a point test
    function outline(c, inside, seg){
      return Array.from({length:seg},(_,j)=>{ const a=j/seg*Math.PI*2; let lo=0, hi=40;
        for(let it=0;it<20;it++){ const m=(lo+hi)/2; if(inside(c[0]+Math.sin(a)*m, c[1]+Math.cos(a)*m)) lo=m; else hi=m; }
        return lo; });
    }
    // the convex hull of two circles (plan x,z), as a point test
    const capsule=(x1,r1,x2,r2)=>(x,z)=>{
      for(let k=0;k<=32;k++){ const s=k/32, dx=x-(x1+(x2-x1)*s), r=r1+(r2-r1)*s; if(dx*dx+z*z<=r*r) return true; } return false; };
    // one flat convex polygon with its own vertices
    function poly(P, mat, out){
      const mi=MAT[mat]||0, b=V(), N=[0,0,0], o=out||[0,1,0];
      P.forEach((p,k)=>{ const q=P[(k+1)%P.length]; N[0]+=(p[1]-q[1])*(p[2]+q[2]); N[1]+=(p[2]-q[2])*(p[0]+q[0]); N[2]+=(p[0]-q[0])*(p[1]+q[1]);
        M.p.push(p[0],p[1],p[2]); M.m.push(mi); M.w.push(0); M.c.push(0); });
      const f=dot(N,o)>=0;
      for(let k=1;k<P.length-1;k++){ if(f) M.i.push(b,b+k,b+k+1); else M.i.push(b,b+k+1,b+k); }
    }
    // a convex polygon (2D) pushed out by g on every side
    function grow(P, g){
      let A=0; const n=P.length; P.forEach((p,i)=>{ const q=P[(i+1)%n]; A+=p[0]*q[1]-q[0]*p[1]; });
      const s=A>0?1:-1;
      return P.map((p,i)=>{ const a=P[(i+n-1)%n], b=P[(i+1)%n];
        const e1=unit([p[0]-a[0],p[1]-a[1],0]), e2=unit([b[0]-p[0],b[1]-p[1],0]);
        const n1=[s*e1[1],-s*e1[0]], n2=[s*e2[1],-s*e2[0]], k=g/(1+n1[0]*n2[0]+n1[1]*n2[1]);
        return [p[0]+(n1[0]+n2[0])*k, p[1]+(n1[1]+n2[1])*k]; });
    }
    // a box: center c, half-axis vectors X, Y, Z; flat faces
    function blk(c, X, Y, Z, mat){
      const P=(i,j,k)=>add(c,add(mul(X,i),add(mul(Y,j),mul(Z,k))));
      [[X,Y,Z],[Y,Z,X],[Z,X,Y]].forEach((_,f)=>[1,-1].forEach(sg=>{
        const q=f===0?[[sg,-1,-1],[sg,1,-1],[sg,1,1],[sg,-1,1]]:f===1?[[-1,sg,-1],[-1,sg,1],[1,sg,1],[1,sg,-1]]:[[-1,-1,sg],[1,-1,sg],[1,1,sg],[-1,1,sg]];
        const pts=q.map(([i,j,k])=>P(i,j,k)), b=V(), n=cross(sub(pts[1],pts[0]),sub(pts[2],pts[0])), out=dot(n,sub(pts[0],c))>0;
        pts.forEach(p=>{ M.p.push(p[0],p[1],p[2]); M.m.push(MAT[mat]||0); M.w.push(0); M.c.push(0); });
        if(out) M.i.push(b,b+1,b+2, b,b+2,b+3); else M.i.push(b,b+2,b+1, b,b+3,b+2);
      }));
    }

    // ---- saucer: center x 234, radius 71 fore and aft, 72.3 across ----
    const SC=234, SF=71, SS=72.3, SP=[
      [0,65.0],[6,64.9],[12,64.6],[17,64.1],[21,63.5],[25,62.4],[29,61.3],[33,60.5],[37,59.85],[41,59.4],
      [46,58.85],[52,58.5],[60,58.35],[67,58.3],[69.6,58.2],[70.6,57.8],[71,57.0],[71,56.2],[70.6,55.0],
      [70.1,53.9],[69.4,52.3],[68.3,51.2],[66,50.95],[50,50.92],[37,50.88],[33,50.65],[29,50.05],[25,49.1],
      [21,47.85],[17,46.5],[13,44.7],[10,43.45],[8.2,42.85],[7.4,42.45],[6.6,41.7],[5.4,40.75],[3.8,40.0],[2,39.6],[0,39.45]]
      .map(([r,y])=>[r/SF,y]);
    lathe({ x:SC, fwd:SF, aft:SF, side:SS, seg:144, prof:SP });
    // the same dense profile the lathe made: the top surface (center out) and the rim (top down)
    const SD=smooth(SP.map(p=>({r:p[0],y:p[1]})),["r","y"],3), stop=[], rim=[];
    for(let i=0;i<SD.length && SD[i].r<0.995;i++) stop.push(SD[i]);
    SD.forEach((s,i)=>{ if(i && s.r>0.94 && s.y<58.3 && s.y>51.3) rim.push(s); });
    const lerp=(a,b,f)=>a+(b-a)*f;
    // the saucer's top surface height over a plan point
    const ground=(x,z)=>{ const r=Math.hypot((x-SC)/SF, z/SS);
      for(let i=0;i<stop.length-1;i++) if(stop[i+1].r>=r) return lerp(stop[i].y, stop[i+1].y, (r-stop[i].r)/((stop[i+1].r-stop[i].r)||1));
      return stop[stop.length-1].y; };
    // a point on the rim at plan angle a (lathe convention) and height y, pushed d out
    const rimAt=(a,y,d)=>{ let r=1;
      for(let i=0;i<rim.length-1;i++){ const p=rim[i], q=rim[i+1]; if((p.y-y)*(q.y-y)<=0){ r=lerp(p.r,q.r,(y-p.y)/((q.y-p.y)||1)); break; } }
      return [SC+Math.sin(a)*(r*SF+d), y, Math.cos(a)*(r*SS+d)]; };
    // rim: three grooves, then lit windows in two rows, in runs with gaps (angles in degrees, 90 the bow)
    [57.25,55.12,52.95].forEach(y=>panel({ mat:"hull2", nu:144, nv:1, d0:0.04, d1:0.04,
      P:(u,v)=>rimAt(u*Math.PI*2, y+(v-0.5)*0.32, 0), C:()=>[SC,y,0] }));
    const winRun=(y,a0,a1)=>panel({ win:1, nu:Math.max(2,Math.round((a1-a0)/1.5)), nv:1, d0:0.06, d1:0.06,
      P:(u,v)=>rimAt((a0+(a1-a0)*u)*Math.PI/180, y+(v-0.5)*1.25, 0), C:()=>[SC,y,0] });
    [[14,40],[50,130],[140,166],[194,220],[230,252],[288,310],[320,346]].forEach(([a,b])=>winRun(55.98,a,b));
    [[20,38],[60,80],[100,120],[142,160],[200,218],[232,248],[292,308],[322,340]].forEach(([a,b])=>winRun(53.94,a,b));
    // RCS thruster blocks over the rim edge at the four diagonals
    [45,135,225,315].forEach(g=>{ const a=g*Math.PI/180, o=[Math.sin(a),0,Math.cos(a)], t=[Math.cos(a),0,-Math.sin(a)];
      blk(add([SC,58.35,0],mul(o,70.2)), mul(o,1.7), [0,0.55,0], mul(t,2.3), "paint");
      [-1,1].forEach(s=>blk(add([SC,58.35,0],add(mul(o,71.95),mul(t,s*1.1))), mul(o,0.2), [0,0.32,0], mul(t,0.55), "dark")); });

    // ---- B/C deck: a teardrop wall (round end forward) on a fillet, a capped top, the bridge tier and dome ----
    const BC=[231,0], BR=outline(BC, capsule(235.2,11.2,216.9,3.0), 96);
    const aftw=a=>Math.pow(Math.max(0,-Math.sin(a)),2);   // 1 straight aft
    const dw=a=>0.45+3.0*aftw(a), wy0=65.3, wy1=66.9, foot=(f)=>(x,z)=>lerp(wy0,ground(x,z),f);
    plan({ c:BC, R:BR, win:0, prof:[[0,0,68.42],[1,a=>dw(a)+3.6,68.4],[1,a=>dw(a)+2.3,68.3],[1,a=>dw(a)+1.3,68.0],
      [1,a=>dw(a)+0.6,67.6],[1,a=>dw(a)+0.15,67.05],[1,dw,wy1,1],[1,0,wy0,1],[1,-0.45,foot(0.45)],[1,-1.2,foot(0.78)],
      [1,-2.0,foot(0.95)],[1,-2.8,(x,z)=>ground(x,z)-0.25]] });
    // windows on the wall, and a red pinstripe along its top and its foot
    const wallD=y=>a=>dw(a)*(y-wy0)/(wy1-wy0)-0.05;
    plan({ c:BC, R:BR, win:1, cap:false, prof:[[1,wallD(66.75),66.75],[1,wallD(65.55),65.55]] });
    [[66.8,66.62],[65.5,65.33]].forEach(([y0,y1])=>plan({ c:BC, R:BR, mat:"trim", cap:false, prof:[[1,a=>wallD(y0)(a)-0.02,y0],[1,a=>wallD(y1)(a)-0.02,y1]] }));
    // bridge tier: a squared block aft of the dome, and a sloped ring skirt round it
    loft({ seg:32, st:[
      {x:224.2,y:69.0,w:0,t:0,b:0},
      {x:224.3,y:69.0,w:3.8,t:1.25,b:1.2,n:5},
      {x:225.2,y:69.0,w:4.5,t:1.5,b:1.2,n:5},
      {x:231.5,y:69.0,w:4.5,t:1.5,b:1.2,n:5},
      {x:232.5,y:69.0,w:4.2,t:1.5,b:1.2,n:5}] });
    lathe({ x:234.2, fwd:1, aft:1, side:1, seg:64, mat:"hull2", prof:[[4.0,70.62],[4.6,70.5],[7.3,68.75],[7.6,68.45],[7.6,68.1]] });
    // the dome, warm, ringed at its foot
    lathe({ x:234.2, fwd:3.85, aft:3.85, side:3.85, seg:48, mat:"paint", prof:[[0,72.02],[0.4,71.93],[0.68,71.66],[0.87,71.25],[0.97,70.85],[1,70.55]] });
    lathe({ x:234.2, fwd:1, aft:1, side:1, seg:48, mat:"hull2", cap:false, prof:[[3.8,70.82],[4.15,70.68],[4.2,70.45]] });

    // ---- markings on the saucer top: panel rings, the registry and name (dark, red edged), escape pods, phaser banks ----
    [30.6,37.8,45.0,52.3,59.6,66.8].forEach(r=>panel({ mat:"hull2", nu:144, nv:1, d0:0.03, d1:0.03,
      P:(u,v)=>{ const a=u*Math.PI*2, rr=r+(v-0.5)*0.34, x=SC+Math.cos(a)*rr, z=Math.sin(a)*rr*SS/SF; return [x,ground(x,z),z]; }, C:()=>[SC,40,0] }));
    // and sixteen radial seams, one every 22.5 degrees from the bow
    for(let k=0;k<16;k++){ const g=k*Math.PI/8, c=Math.cos(g), s=Math.sin(g);
      panel({ mat:"hull2", nu:20, nv:1, d0:0.03, d1:0.03, P:(u,v)=>{ const r=24+43.6*u, t=(v-0.5)*0.3, x=SC+c*r-s*t, z=(s*r+c*t)*SS/SF;
        return [x,ground(x,z),z]; }, C:()=>[SC,40,0] }); }
    const GS=0.2, GC=0.3, Q=(u0,v0,u1,v1)=>[[u0,v0],[u1,v0],[u1,v1],[u0,v1]];
    const K=(u,v,su,sv)=>[[u,v+sv*GC],[u+su*GS,v+sv*GC],[u+su*GC,v+sv*GS],[u+su*GC,v]];
    const ring0=w=>[Q(0,GC,GS,1-GC),Q(w-GS,GC,w,1-GC),Q(GC,1-GS,w-GC,1),Q(GC,0,w-GC,GS),K(0,1,1,-1),K(w,1,-1,-1),K(0,0,1,1),K(w,0,-1,1)];
    const FONT={
      N:[0.9,[Q(0,0,GS,1),Q(0.7,0,0.9,1),[[0,1],[0.27,1],[0.9,0],[0.63,0]]]],
      C:[0.82,[Q(0,GC,GS,1-GC),K(0,1,1,-1),Q(GC,1-GS,0.82,1),K(0,0,1,1),Q(GC,0,0.82,GS)]],
      "-":[0.55,[Q(0.06,0.4,0.49,0.6)]],
      "1":[0.45,[Q(0.25,0,0.45,1),[[0.02,0.6],[0.25,0.82],[0.25,1],[0.02,0.78]]]],
      "7":[0.82,[Q(0,0.8,0.82,1),[[0.22,0],[0.47,0],[0.82,0.8],[0.57,0.8]]]],
      "0":[0.9,ring0(0.9)],
      A:[0.92,[[[0,0],[0.24,0],[0.58,1],[0.34,1]],[[0.68,0],[0.92,0],[0.58,1],[0.34,1]],Q(0.17,0.25,0.75,0.43)]],
      U:[0.75,[Q(0,GC,GS,1),Q(0.55,GC,0.75,1),Q(GC,0,0.45,GS),K(0,0,1,1),K(0.75,0,-1,1)]],
      S:[0.75,[Q(GC,0.8,0.75,1),K(0,1,1,-1),Q(0,0.5,GS,1-GC),Q(0,0.4,0.75,0.6),Q(0.55,GC,0.75,0.5),Q(0,0,0.45,GS),K(0.75,0,-1,1)]],
      ".":[0.3,[Q(0.05,0,0.25,0.2)]], " ":[0.35,[]],
      E:[0.7,[Q(0,0,GS,1),Q(GS,0.8,0.7,1),Q(GS,0.4,0.6,0.6),Q(GS,0,0.7,GS)]],
      T:[0.75,[Q(0,0.8,0.75,1),Q(0.275,0,0.475,0.8)]],
      R:[0.75,[Q(0,0,GS,1),Q(GS,0.8,0.45,1),K(0.75,1,-1,-1),Q(0.55,0.4,0.75,1-GC),Q(GS,0.4,0.55,0.6),[[0.33,0.4],[0.58,0.4],[0.75,0],[0.5,0]]]],
      P:[0.72,[Q(0,0,GS,1),Q(GS,0.8,0.42,1),K(0.72,1,-1,-1),Q(0.52,0.4,0.72,1-GC),Q(GS,0.4,0.52,0.6)]],
      I:[0.2,[Q(0,0,GS,1)]]};
    // a line of text on the saucer top along a circle of radius r about the saucer center, centered at plan angle
    // g (degrees, 0 the bow, positive to starboard), tops toward the center: it reads from the bow
    function text(str, o){
      const h=o.h, gap=o.gap||0.16, ws=[...str].map(ch=>FONT[ch][0]), tot=ws.reduce((s,w)=>s+w,0)+gap*(ws.length-1);
      let u0=-tot/2;
      [...str].forEach((ch,i)=>{
        const w=ws[i], f=o.g*Math.PI/180-(u0+w/2)*h/o.r;   // glyph center angle: u runs starboard to port
        const cx=SC+Math.cos(f)*o.r, cz=Math.sin(f)*o.r, T=[Math.sin(f),-Math.cos(f)], N=[-Math.cos(f),-Math.sin(f)];
        const map=([u,v])=>{ const x=cx+(u-w/2)*h*T[0]+(v-0.5)*h*N[0], z=cz+(u-w/2)*h*T[1]+(v-0.5)*h*N[1]; return [x,ground(x,z),z]; };
        FONT[ch][1].forEach(P=>{
          if(o.edge) poly(grow(P,o.edge/h).map(map).map(p=>[p[0],p[1]+0.05,p[2]]),"trim");
          poly(P.map(map).map(p=>[p[0],p[1]+0.09,p[2]]),o.mat||"dark");
        });
        u0+=w+gap;
      });
    }
    text("NCC-1701-A",{ r:40.1, g:0, h:8.2, edge:0.32 });
    text("U.S.S. ENTERPRISE",{ r:22.9, g:0, h:3.0, gap:0.2 });
    text("ENTERPRISE",{ r:25.5, g:180, h:1.7, gap:0.2 });
    text("NCC-1701-A",{ r:28.0, g:180, h:2.2 });
    // a flat square or rectangle on the saucer top: center at radius r, angle g, half sizes along and across the radius
    const pad=(r,g,hr,ht,dy,mat)=>{ const f=g*Math.PI/180, R=[Math.cos(f),Math.sin(f)], T=[-Math.sin(f),Math.cos(f)];
      poly([[-1,-1],[1,-1],[1,1],[-1,1]].map(([i,j])=>{ const x=SC+(r+i*hr)*R[0]+j*ht*T[0], z=(r+i*hr)*R[1]+j*ht*T[1]; return [x,ground(x,z)+dy,z]; }),mat); };
    // escape pods: a ring of sixteen, four more further out
    for(let k=0;k<16;k++){ const g=3.4+22.5*k; if(Math.abs(((g+180)%360)-180)>160) continue; pad(54.5,g,1.12,1.12,0.05,"trim"); pad(54.5,g,0.9,0.9,0.09,"hull2"); }
    [-3.5,86.5,-93.5].forEach(g=>{ pad(61.5,g,1.12,1.12,0.05,"trim"); pad(61.5,g,0.9,0.9,0.09,"hull2"); });
    // phaser banks: a warm pad with two dark emitter domes, fore, port and starboard, and aft by the impulse deck
    [[29.5,0],[29.4,90],[29.4,-90],[38.7,180]].forEach(([r,g])=>{ pad(r,g,1.1,1.9,0.14,"paint");
      [-0.85,0.85].forEach(s=>{ const f=g*Math.PI/180, x=SC+r*Math.cos(f)-s*Math.sin(f), z=r*Math.sin(f)+s*Math.cos(f);
        lathe({ x, z, fwd:0.55, aft:0.55, side:0.55, seg:12, mat:"dark", prof:[[0,ground(x,z)+0.5],[0.7,ground(x,z)+0.42],[1,ground(x,z)+0.18]] }); }); });

    // ---- impulse deck: a square-cornered box aft, the dome, then a round-nosed tab (keyhole plan) ----
    loft({ seg:36, st:[
      {x:159.3,y:57.3,w:9.6,t:2.2,b:4.6,n:5,k:1},
      {x:162,  y:57.3,w:9.6,t:2.2,b:4.4,n:5},
      {x:170,  y:57.3,w:9.3,t:2.2,b:2.5,n:5},
      {x:176,  y:57.3,w:8.4,t:2.15,b:2.4,n:3},
      {x:181,  y:57.3,w:6.4,t:2.1,b:2.4,n:2.5},
      {x:184.5,y:57.3,w:3.6,t:2.05,b:2.4,n:3},
      {x:191,  y:57.3,w:3.5,t:1.75,b:2.0,n:3},
      {x:193.2,y:57.3,w:2.3,t:1.4,b:1.6,n:2.2},
      {x:193.8,y:57.3,w:0,t:0,b:0}] });
    lathe({ x:177, fwd:7.8, aft:7.8, side:7.8, seg:40, prof:[[0,60.5],[0.6,60.3],[1,59.6],[1,58,1]] });
    // on the dome: a glowing disc with dark radial ribs, inside a raised ring
    lathe({ x:177, fwd:3.55, aft:3.55, side:3.55, seg:40, mat:"deflector", prof:[[0,60.72],[1,60.6,1],[1,60.3]] });
    lathe({ x:177, fwd:1, aft:1, side:1, seg:48, prof:[[3.75,60.2],[3.75,60.5,1],[5.3,60.4,1],[5.3,60.0]] });
    for(let k=0;k<28;k++){
      const a=(k+0.5)/28*Math.PI*2, d=[Math.sin(a),0,Math.cos(a)], P=(r,h)=>add([177,60.72-0.12*r/3.55+h,0],mul(d,r));
      blade({ mat:"dark", n:4, seg:8, st:[[P(1.2,0.08),P(1.2,-0.1),0.07],[P(3.4,0.08),P(3.4,-0.1),0.07]] });
    }
    // the two engines fill the aft face; each glows inside a dark frame set 0.2 m back
    [-4.6,4.6].forEach(z=>{
      loft({ mat:"impulse", seg:16, st:[{x:158.7,y:57.2,z,w:3.6,t:2.1,b:2.4,n:6},{x:159.8,y:57.2,z,w:3.6,t:2.1,b:2.4,n:6}] });
      loft({ mat:"dark", seg:16, st:[{x:158.9,y:57.2,z,w:3.9,t:2.3,b:2.6,n:6},{x:159.6,y:57.2,z,w:3.9,t:2.3,b:2.6,n:6}] });
    });

    // ---- secondary hull: ends in the deflector housing face at x 186.4 ----
    let v0=V();
    const SEC=loft({ seg:48, st:[
      {x:76,  y:22.0, w:4.0,  t:6.0,  b:4.6,  n:2.4},
      {x:79,  y:21.8, w:5.4,  t:6.2,  b:4.5,  n:2.4},
      {x:81.5,y:21.6, w:7.0,  t:6.4,  b:5.3,  n:2.4},
      {x:84.5,y:21.4, w:9.0,  t:6.6,  b:6.1,  n:2.5},
      {x:88,  y:21.3, w:10.2, t:6.2,  b:6.6,  n:2.5},
      {x:97,  y:21.2, w:10.9, t:6.6,  b:7.3,  n:2.4},
      {x:104, y:20.8, w:11.7, t:7.7,  b:8.6,  n:2.3},
      {x:109, y:20.0, w:12.3, t:9.2,  b:9.2,  n:2.2},
      {x:113, y:19.0, w:12.9, t:10.8, b:11.4, n:2.15},
      {x:117, y:18.0, w:13.6, t:12.5, b:13.0, n:2.1},
      {x:126, y:18.0, w:15.0, t:14.0, b:14.2, n:2.05},
      {x:136, y:17.6, w:16.1, t:16.2, b:15.2, n:2},
      {x:148, y:17.5, w:16.9, t:16.9, b:16.4, n:2},
      {x:160, y:17.6, w:17.3, t:16.8, b:16.8, n:2},
      {x:170, y:17.6, w:16.9, t:16.0, b:15.6, n:2},
      {x:177, y:17.4, w:15.6, t:14.6, b:14.2, n:2.1},
      {x:182, y:17.3, w:13.6, t:12.0, b:12.2, n:2.2},
      {x:184.5,y:17.7,w:11.6, t:11.0, b:10.9, n:2.3},
      {x:186.4,y:17.8,w:10.6, t:10.4, b:10.3, n:2.4}] });
    // stern: the shuttlebay face is a flat slope, bottom further aft
    const SX=y=>79.0+(y-17.2)*0.86;
    flat(v0, 0, p=>SX(p[1]), true);
    // a point on the hull's flank at height y: o 1 starboard, -1 port
    const flankOf=D=>{ const X=D.map(s=>s.x), sI=x=>{ let lo=0, hi=X.length-1;
        while(hi-lo>1){ const m=(lo+hi)>>1; if(X[m]>=x) hi=m; else lo=m; } return lo+(x-X[lo])/((X[hi]-X[lo])||1); };
      return (x,y,o)=>{ const q=at(D,sI(x)), up=y>q.y, n=up?q.nt:q.nb,
        sa=spow(Math.max(-1,Math.min(1,(y-q.y)/(up?q.t:q.b))),n/2);
        return [x, y, q.z+o*spow(Math.sqrt(Math.max(0,1-sa*sa)),2/n)*q.w]; }; };
    const SF2=flankOf(SEC), secTop=x=>{ const q=at(SEC,sAt(SEC,x)); return q.y+q.t; };
    // lit window runs on both flanks: [row height, x from, x to]
    [[21.3,100,112],[21.3,118,134],[21.3,139,156],[21.3,160,172],[13.14,140,152],[13.14,160,171],
     [17.22,110,122],[25.38,150,158],[25.38,164,171]].forEach(([y,x0,x1])=>panel({ win:1, mirror:true, nu:Math.ceil((x1-x0)/1.5), nv:1, d0:0.05, d1:0.05,
      P:(u,v)=>SF2(x0+(x1-x0)*u, y+(v-0.5)*1.2, 1), C:u=>[x0+(x1-x0)*u, 18, 0] }));
    // the pennant along each flank, widening forward, and the arrowhead insignia in a red disc
    panel({ mirror:true, mat:"trim", nu:24, nv:1, d0:0.05, d1:0.05,
      P:(u,v)=>SF2(132+40*u, 18.3+(v-0.5)*(0.06+0.5*u*u), 1), C:u=>[132+40*u, 18, 0] });
    panel({ mirror:true, mat:"trim", nu:20, nv:3, d0:0.06, d1:0.06,
      P:(u,v)=>{ const a=u*Math.PI*2, r=0.08+1.72*v; return SF2(174.6+Math.cos(a)*r, 18.3+Math.sin(a)*r, 1); }, C:()=>[174.6,18.3,0] });
    [[[1.45,0],[-1.0,1.0],[-0.45,0]],[[1.45,0],[-0.45,0],[-1.0,-1.0]]].forEach(T=>[1,-1].forEach(o=>{
      const pts=T.map(([a,b])=>{ const p=SF2(174.6+a,18.3+b*1.05,1); return [p[0],p[1],o*(p[2]+0.09)]; });
      poly(pts,"paint",[0,0,o]); }));
    // six dark panes low on each flank, forward
    for(let k=0;k<6;k++){ const x0=156+k*1.75; panel({ mirror:true, mat:"dark", nu:2, nv:2, d0:0.05, d1:0.05,
      P:(u,v)=>SF2(x0+1.45*u, 8.25+1.85*v, 1), C:()=>[x0,17,0] }); }
    // a dorsal spine from the shuttlebay hood to the neck, a light at its aft end
    loft({ seg:20, st:[90.4,91,94,100,106,112,118,124,130,136,141].map((x,i)=>({ x, y:secTop(x)+0.05, w:i?1.25:0.6, t:i?0.6:0.3, b:0.9, n:2.6 })) });
    lathe({ x:90.6, fwd:0.45, aft:0.45, side:0.45, seg:12, mat:"lamp", prof:[[0,secTop(90.6)+0.95],[0.8,secTop(90.6)+0.75],[1,secTop(90.6)+0.45],[0.6,secTop(90.6)+0.1]] });
    // shuttlebay: clamshell doors, a half cone on the stern slope with its foot level, apex at the top
    const DA=[SX(26.8),26.8,0], DB=[SX(18.4),18.4,0], DRb=4.2, DDb=1.5;
    const door=(t,th)=>{ const b=[DB[0]-DDb*Math.sin(th), DB[1], DRb*Math.cos(th)]; return add(DA,mul(sub(b,DA),t)); };
    panel({ mat:"hull", nu:28, nv:8, d0:0, d1:0, P:(u,v)=>door(v,Math.PI*u), C:(u,v)=>add(door(v,Math.PI/2),[3,0,0]) });
    poly(Array.from({length:15},(_,k)=>door(1,Math.PI*k/14)),"hull2",[0,-1,0]);
    for(let k=1;k<7;k++) panel({ mat:"dark", nu:1, nv:6, d0:0.04, d1:0.04,
      P:(u,v)=>door(0.1+0.9*v, Math.PI*k/7+(u-0.5)*0.05), C:(u,v)=>add(door(v,Math.PI/2),[3,0,0]) });

    // ---- main deflector: a ring on the housing face, a concave ribbed dish, the antenna ----
    const DY=17.8, DR=7.95, dishX=r=>188.3+(r/DR)*(r/DR), O=(x,r,k)=>({x,y:DY,w:r,t:r,b:r,k});
    // the ring runs forward, folds over its lip and back inside
    loft({ seg:48, cap:false, st:[O(186.2,9.7),O(187.0,9.55),O(187.8,9.3),O(188.6,8.8),O(189.35,8.5,1),
      O(189.6,8.3),O(189.6,7.85,1),O(189.2,7.85)] });
    // the dish runs backward as it closes, so its skin faces forward
    loft({ mat:"deflector", seg:48, cap:false, st:[7.95,7,6,5,4,3,2,1,0].map(r=>O(dishX(r),r)) });
    for(let k=0;k<32;k++){
      const a=(k+0.5)/32*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a);
      blade({ mat:"dark", n:4, seg:12, st:[2,3.5,5,6.5,7.6].map(r=>{
        const B=[dishX(r),DY+r*sa,r*ca], s=2*r/(DR*DR), n=unit([1,-s*sa,-s*ca]);
        return [add(B,mul(n,0.12)),add(B,mul(n,-0.1)),0.06]; }) });
    }
    loft({ seg:20, st:[O(188.2,1.6),O(189.0,1.15),O(189.7,0.5),O(190.1,0.3)] });
    loft({ seg:20, st:[O(189.95,0),O(190.05,0.35),O(190.25,0.52),O(190.5,0.55),O(190.7,0.45),O(190.85,0.22),O(190.9,0)] });
    // four clamp blocks on the housing at 90 degree steps, riding the hull's taper from x 180.6 to 183.4
    [[0,1,14.25,12.6],[0,-1,14.25,12.6],[1,0,12.8,11.5],[-1,0,12.85,11.55]].forEach(([cy,cz,r0,r1])=>{
      loft({ seg:20, st:[[180.6,0.65],[180.9,1],[183.1,1],[183.4,0.65]].map(([x,s],i)=>{
        const f=(x-180.6)/2.8, r=r0+(r1-r0)*f, yc=17.33+0.19*f;
        return { x, y:yc+cy*r, z:cz*r, w:(cz?0.9:1.3)*s, t:(cz?1.3:0.9)*s, b:(cz?1.3:0.9)*s, n:4, k:i===1||i===2?1:0 }; }) });
    });

    // ---- dorsal neck: a slab leaning forward, saucer to secondary hull ----
    const NECK=loft({ seg:32, st:[
      {x:137,  y:29,   w:1.5, t:1.0, b:1.0, n:3},
      {x:140.5,y:30.8, w:2.6, t:3.2, b:3.3, n:3},
      {x:145,  y:32.7, w:2.9, t:5.15,b:5.2, n:3.5},
      {x:150,  y:34.8, w:2.9, t:7.3, b:7.3, n:3.5},
      {x:155,  y:37.0, w:2.9, t:9.4, b:9.5, n:3.5},
      {x:160,  y:39.1, w:2.9, t:11.6,b:11.6,n:3.5},
      {x:164,  y:41,   w:2.9, t:13.5,b:13.5,n:3.5},
      {x:172,  y:41.3, w:2.9, t:13.7,b:13.7,n:3.5},
      {x:180,  y:41.5, w:2.9, t:13.5,b:13.5,n:3.5},
      {x:182.6,y:41.5, w:2.9, t:13.5,b:13.5,n:3.5,k:1},
      {x:182.8,y:46.6, w:2.9, t:8.4, b:8.4, n:3.5,k:1},
      {x:188,  y:47.85,w:2.9, t:7.15,b:7.15,n:3.5},
      {x:193,  y:49.2, w:2.9, t:5.8, b:5.8, n:3.5},
      {x:198,  y:50.5, w:2.9, t:4.5, b:4.5, n:3.3},
      {x:203,  y:51.4, w:2.7, t:3.3, b:3.3, n:3},
      {x:208,  y:51.6, w:2.2, t:2.6, b:3.2, n:3},
      {x:212,  y:51.6, w:0.6, t:1.4, b:1.4, n:3}] });
    // windows in a strip up each flank near the leading edge
    const NF=flankOf(NECK);
    panel({ win:1, mirror:true, nu:3, nv:8, d0:0.05, d1:0.05, P:(u,v)=>NF(176.7+3.6*u, 36.6+13.9*v, 1), C:(u,v)=>[178.5,36.6+13.9*v,0] });
    // photon torpedo housing at the neck's foot, two launcher ports in its face
    loft({ seg:28, st:[
      {x:172,y:33.4,w:5.6,t:2.4,b:2.4,n:5},{x:183.3,y:33.4,w:6.2,t:2.5,b:2.5,n:5,k:1},
      {x:184,y:33.4,w:5.6,t:1.9,b:1.9,n:5}] });
    [-2.3,2.3].forEach(z=>poly([[184.05,32.75,z-1.2],[184.05,32.75,z+1.2],[184.05,34.0,z+1.2],[184.05,34.0,z-1.2]],"dark",[1,0,0]));

    // ---- nacelles ----
    const NZ=49.15;
    const nac=[ // x, top, bottom, half-width, z center
      [-1,69.2,56.6,2.2,49.15],[3,69.2,56.6,2.7,49.15],[7,69.25,56.5,3.6,49.1],
      [9.5,69.25,56.4,5.67,50.33],[13,69.3,56.4,5.95,50.05],[24,69.6,56.5,6.55,49.45],[38,70.0,56.6,6.85,48.95],
      [46,70.1,55.6,6.6,49.15],[54,70.3,55.2,6.45,49.15],[64,70.9,55.2,6.45,49.15],[100,71.1,55.2,6.45,49.15],
      [122,71.2,55.3,6.45,49.15],[125,71.3,55.4,7.05,49.15],[143,71.3,55.9,7.05,49.15],[145.2,71.25,56.6,6.92,49.15],[146.4,71.15,57.9,6.7,49.15]]
      .map(([x,tp,bt,w,z])=>{ const yc=Math.max(bt+0.3,tp-5.5); return { x, y:yc, z, w, t:tp-yc, b:yc-bt, nt:2.3, nb:3, r:x<13?8:undefined, k:x===9.5?1:0 }; });
    v0=V();
    const NAC=loft({ mirror:true, seg:44, st:nac });
    // aft end: a flat chisel, the top reaching furthest back
    chisel(v0, NAC, 44, p=>p[0]-(69.15-p[1])*0.78, "hull2");
    loft({ mirror:true, seg:20, st:[
      {x:3.4,y:60.2,z:NZ,w:3.0,t:0.6,b:0.6,n:4},{x:4.2,y:60.2,z:NZ,w:3.4,t:0.7,b:0.7,n:4},{x:11,y:60.2,z:50.1,w:5.2,t:0.7,b:0.7,n:4}] });
    // nose: a raked hull cap; the ramscoop is a dark recess inside a white rim, split by three struts
    const ND=loft({ mirror:true, seg:44, st:[
      {x:145.9,y:65.7,z:NZ,w:7.05,t:5.72,b:8.85,nt:2.3,nb:3},
      {x:147.5,y:65.7,z:NZ,w:6.5, t:5.15,b:6.1, nt:2.3,nb:2.6},
      {x:149.5,y:66.2,z:NZ,w:5.6, t:4.2, b:3.0, nt:2.2,nb:2.2},
      {x:151.3,y:67.0,z:NZ,w:4.4, t:2.8, b:1.1, nt:2,nb:2},
      {x:152.4,y:67.8,z:NZ,w:2.8, t:1.2, b:0.9},
      {x:152.9,y:68.1,z:NZ,w:0,t:0,b:0}] });
    const NC=s=>{ const q=at(ND,s); return [q.x,q.y,q.z]; }, s0=sAt(ND,146.5), s1=sAt(ND,152.0);
    panel({ mirror:true, mat:"dark", nu:22, nv:14, d0:0.12, d1:-0.4,
      P:(u,v)=>{ const q=at(ND,s0+(s1-s0)*u); return low(q,(v*2-1)*Math.max(0.3,q.w-1.2)); },
      C:u=>NC(s0+(s1-s0)*u) });
    // the ramscoop also runs back over the top: two dark strips either side of a white spine
    const hi=(q,dz)=>{ const ca=spow(Math.max(-1,Math.min(1,dz/Math.max(1e-6,q.w))),q.nt/2), sa=Math.sqrt(Math.max(0,1-ca*ca));
      return [q.x, q.y+spow(sa,2/q.nt)*q.t, q.z+dz]; };
    const top=(x,dz)=>{ const P=[];
      if(x<=146.4){ const q=at(NAC,sAt(NAC,x)); P.push(hi(q,Math.min(dz,q.w-0.5))); }
      if(x>=145.9){ const q=at(ND,sAt(ND,x)); P.push(hi(q,Math.min(dz,q.w-0.5))); }
      return P.reduce((a,p)=>p[1]>a[1]?p:a); };
    [0,1].forEach(sd=>panel({ mirror:true, mat:"dark", nu:32, nv:2, d0:0.1, d1:-0.4,
      P:(u,v)=>{ const x=133+19.3*(1-(1-u)*(1-u)), p=top(x,0.6+1.8*v); return sd?[p[0],p[1],2*NZ-p[2]]:p; },
      C:u=>[133+19.3*(1-(1-u)*(1-u)),64.5,NZ] }));
    [-2.6,0,2.6].forEach(c=>{
      let e=s0; while(e<s1+0.3 && at(ND,e+0.05).w-1.2>Math.abs(c)+0.1) e+=0.05;
      const b=sAt(ND,146.2);
      panel({ mirror:true, mat:"hull", nu:24, nv:2, d0:0.32, d1:-0.3,
        P:(u,v)=>low(at(ND,b+(e-b)*u),c+(v*2-1)*0.35), C:u=>NC(b+(e-b)*u) });
    });
    // a point on the nacelle flank at height y: o 1 outboard, -1 inboard
    const NX=NAC.map(s=>s.x), nS=x=>{ let lo=0, hi=NX.length-1;
      while(hi-lo>1){ const m=(lo+hi)>>1; if(NX[m]>=x) hi=m; else lo=m; } return lo+(x-NX[lo])/((NX[hi]-NX[lo])||1); };
    const flank=(x,y,o)=>{ const q=at(NAC,nS(x)), up=y>q.y, n=up?q.nt:q.nb,
      sa=spow(Math.max(-1,Math.min(1,(y-q.y)/(up?q.t:q.b))),n/2);
      return [x, y, q.z+o*spow(Math.sqrt(Math.max(0,1-sa*sa)),2/n)*q.w]; };
    // warp grilles on both faces: round aft end, forward end cut on the nose rake; a dark frame round
    // each, and five dark ribs along it
    const gx0=y=>47+3.5*(1-Math.sqrt(Math.max(0,1-Math.pow((y-63.1)/2.85,2)))), gx1=y=>119.3+(y-63.1)*1.05;
    [1,-1].forEach(o=>{
      panel({ mirror:true, mat:"dark", nu:32, nv:12, d0:0.05, d1:-0.3,
        P:(u,v)=>{ const y=63.1-3.25*Math.cos(Math.PI*v), x0=46.6+3.9*(1-Math.sin(Math.PI*v)), x1=119.7+(y-63.1)*1.05;
          return flank(x0+(x1-x0)*u,y,o); }, C:u=>[47+75*u,63.1,NZ] });
      panel({ mirror:true, mat:"grille", nu:32, nv:12, d0:0.1, d1:0.1,
        P:(u,v)=>{ const y=63.1-2.85*Math.cos(Math.PI*v), x0=gx0(y), x1=gx1(y); return flank(x0+(x1-x0)*u,y,o); }, C:u=>[47+75*u,63.1,NZ] });
      [-1.9,-0.95,0,0.95,1.9].forEach(dy=>{ const y=63.1+dy;
        panel({ mirror:true, mat:"dark", nu:24, nv:1, d0:0.16, d1:0.16,
          P:(u,v)=>{ const yy=y+(v-0.5)*0.24, x0=gx0(y)+0.4, x1=gx1(y)-0.3; return flank(x0+(x1-x0)*u,yy,o); }, C:u=>[47+75*u,63.1,NZ] }); });
    });
    // intercooler vent ahead of each grille: a raked parallelogram with round corners
    [1,-1].forEach(o=>panel({ mirror:true, mat:"dark", nu:20, nv:10, d0:0.2, d1:-0.3,
      P:(u,v)=>{ const s=-0.995*Math.cos(Math.PI*u), y=63.15+2.75*(2*v-1)*Math.pow(1-Math.pow(Math.abs(s),5),0.2);
        const xa=128.3+(y-63.15)*1.05, xf=134.6+(y-63.15)*0.6; return flank(xa+(xf-xa)*(s+1)/2,y,o); },
      C:u=>[125+11*u,63.1,NZ] }));
    // keel fairing under each nacelle where the pylon meets it
    loft({ mirror:true, seg:28, st:[
      {x:64,y:56.5,z:NZ,w:0,t:0,b:0},
      {x:67,y:56.5,z:NZ,w:3.2,t:1.5,b:1.6,n:2.5},
      {x:75,y:56.5,z:NZ,w:4.2,t:1.5,b:2.8,n:2.5},
      {x:100,y:56.5,z:NZ,w:4.4,t:1.5,b:3.3,n:2.5},
      {x:110,y:56.5,z:NZ,w:4.0,t:1.5,b:3.1,n:2.5},
      {x:114,y:56.5,z:NZ,w:2.6,t:1.5,b:2.0,n:2.5},
      {x:115.2,y:56.5,z:NZ,w:0,t:0,b:0}] });
    // a long panel down the top of each nacelle, pointed aft
    panel({ mirror:true, mat:"hull2", nu:40, nv:4, d0:0.08, d1:-0.25,
      P:(u,v)=>{ const x=20+88*u, w=1.9*Math.sqrt(Math.max(0,Math.min(1,(x-20)/40)))*Math.sqrt(Math.max(0,1-Math.pow(Math.max(0,x-100)/8,2)));
        return hi(at(NAC,nS(x)),(2*v-1)*Math.max(0.05,w)); }, C:u=>[20+88*u,64,NZ] });
    // the registry on both flanks of both nacelles, toward the aft end; each reads from outside
    [1,-1].forEach(o=>[1,-1].forEach(mz=>{
      const dir=o*mz, h=1.1, str="NCC-1701-A", ws=[...str].map(ch=>FONT[ch][0]), gap=0.16, tot=ws.reduce((a,w)=>a+w,0)+gap*(ws.length-1);
      let u0=-tot/2;
      [...str].forEach((ch,i)=>{ const w=ws[i];
        FONT[ch][1].forEach(P=>{ const pts=P.map(([u,v])=>{ const x=15+dir*(u0+u)*h, y=67.0+v*h, p=flank(x,y,o), q=flank(x,y+0.05,o);
            const n=unit(cross([1,0,0],sub(q,p))), m=o>0?n:mul(n,-1); return [p[0]+m[0]*0.06*o, p[1]+m[1]*0.06*o, (p[2]+m[2]*0.06*o)*mz]; });
          poly(pts,"dark",[0,0.4,o*mz]); });
        u0+=w+gap; });
    }));

    // ---- pylons: hull top sides up and out to the nacelle keels ----
    const LE=y=>[106.9+(50-y)*1.5, y, 41.2-((106.9+(50-y)*1.5)-108)*1.04];
    const TE=y=>[70.6+(53-y)*2.25, y, 37.8-((70.6+(53-y)*2.25)-81)*0.74];
    const PST=[[LE(26.5),TE(28.5),1.3],[LE(30),TE(31.5),1.3],[LE(42),TE(42),1.3],[LE(55),TE(55),1.3],
      [add(LE(55),[-0.6,3.5,0]),add(TE(55),[0,3.5,0]),1.3]];
    blade({ mirror:true, n:3, seg:28, st:PST });
    // a darker panel down the aft half of each pylon face
    const PC=PST.map(s=>mul(add(s[0],s[1]),0.5)), PN=unit(cross(sub(PC[PC.length-1],PC[0]), PST.reduce((a,s)=>add(a,sub(s[0],s[1])),[0,0,0])));
    const pyl=(y,f,sd)=>{ const l=LE(y), t=TE(y), a=1-2*f;
      return add(add(mul(add(l,t),0.5),mul(sub(l,t),0.5*a)), mul(PN,sd*1.3*Math.cbrt(Math.max(0,1-Math.abs(a*a*a))))); };
    [1,-1].forEach(sd=>panel({ mirror:true, mat:"hull2", nu:10, nv:4, d0:0.05, d1:-0.2,
      P:(u,v)=>pyl(42+12.5*u, 0.42+0.42*v, sd), C:u=>{ const y=42+12.5*u; return mul(add(LE(y),TE(y)),0.5); } }));
    // beacons on the aft tops of the nacelles
    lathe({ x:2.6, z:NZ, mirror:true, fwd:0.4, aft:0.4, side:0.4, seg:12, mat:"lamp", prof:[[0,70.25],[0.8,70.1],[1,69.85],[0.6,69.5]] });
    // running lights on the saucer rim
    [[234,56.6,72.3],[234,56.6,-72.3]].forEach(([x,y,z])=>lathe({ x, z, fwd:0.6, aft:0.6, side:0.6, seg:12, mat:"lamp",
      prof:[[0,y+0.6],[0.7,y+0.42],[1,y],[0.7,y-0.42],[0,y-0.6]] }));
    return M;
  }
};
