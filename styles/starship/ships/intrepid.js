/* USS Voyager NCC-74656, Intrepid class. Bow +x, stern at x 0; the saucer rim sits near y 0. */
SHIPS.intrepid={
  name:"U.S.S. VOYAGER", reg:"NCC-74656", cls:"INTREPID CLASS",
  len:344, beam:132.4, height:64,
  hull:[0.70,0.73,0.78], defl:[0.35,0.7,1.0], deck:3.4,
  callouts:[
    { text:"MAIN BRIDGE", at:[205,33.3,0] },
    { text:"SAUCER SECTION", at:[262,14.2,34] },
    { text:"MAIN DEFLECTOR", at:[196.11,-12.95,0] },
    { text:"WARP NACELLE", at:[50,-8.6,59.5] },
    { text:"BUSSARD COLLECTOR", at:[99.66,-9.61,64.71] },
    { text:"IMPULSE ENGINES", at:[25.1,-12.8,40.6] },
    { text:"SHUTTLEBAY", at:[19.2,-7.3,0] }],
  build(G){
    const M=G.mesh(), MAT=G.MATS, Mt=Math;
    // ---- a copy of the sweep math, to place details on a skin ----
    const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const norm=a=>{ const l=Mt.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l]; };
    const cr=(a,b,c,d,t)=>{ const t2=t*t,t3=t2*t; return 0.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3); };
    const spow=(v,e)=>Mt.sign(v)*Mt.pow(Mt.abs(v),e);
    const FL=["x","y","z","w","t","b","n","nt","nb"];
    function fill(s){ const o=Object.assign({x:0,y:0,z:0,w:0,n:2},s); if(o.t===undefined)o.t=o.w; if(o.b===undefined)o.b=o.t;
      if(o.nt===undefined)o.nt=o.n; if(o.nb===undefined)o.nb=o.n; return o; }
    function skin(st,res,side){
      side=side||[0,0,1]; const run=st.map(fill), D=[];
      for(let i=0;i<run.length-1;i++){
        const a=run[Mt.max(0,i-1)],b=run[i],c=run[i+1],d=run[Mt.min(run.length-1,i+2)],r=b.r||res;
        for(let k=0;k<r;k++){ const t=k/r,s={}; FL.forEach(f=>{ s[f]=cr(a[f],b[f],c[f],d[f],t); });
          s.w=Mt.max(0,s.w); s.t=Mt.max(0,s.t); s.b=Mt.max(0,s.b); s.nt=Mt.max(0.6,s.nt); s.nb=Mt.max(0.6,s.nb); D.push(s); }
      }
      D.push(Object.assign({},run[run.length-1]));
      D.forEach((s,i)=>{ const a=D[i-1]||s, c=D[i+1]||s, T=norm(sub([c.x,c.y,c.z],[a.x,a.y,a.z]));
        let S=sub(side,T.map(v=>v*dot(side,T))); if(Mt.hypot(S[0],S[1],S[2])<1e-6) S=[0,1,0]; S=norm(S);
        s.T=T; s.S=S; s.U=cross(S,T); });
      const ring=(s,a)=>{ const ca=Mt.cos(a), sa=Mt.sin(a), top=sa>=0, ex=2/(top?s.nt:s.nb);
        const X=spow(ca,ex)*s.w, Y=spow(sa,ex)*(top?s.t:s.b);
        return [s.x+s.S[0]*X+s.U[0]*Y, s.y+s.S[1]*X+s.U[1]*Y, s.z+s.S[2]*X+s.U[2]*Y]; };
      const at=(u,a)=>{ u=Mt.max(0,Mt.min(D.length-1.0001,u)); const i=Mt.floor(u), f=u-i, p=ring(D[i],a), q=ring(D[i+1],a);
        return [p[0]+(q[0]-p[0])*f, p[1]+(q[1]-p[1])*f, p[2]+(q[2]-p[2])*f]; };
      const ux=x=>{ let lo=0, hi=D.length-1; if(x<=D[0].x) return 0; if(x>=D[hi].x) return hi;
        while(hi-lo>1){ const m=(lo+hi)>>1; if(D[m].x<x) lo=m; else hi=m; } return lo+(x-D[lo].x)/((D[hi].x-D[lo].x)||1); };
      const nrm=(u,a)=>{ const e=0.01, n=norm(cross(sub(at(u,a+e),at(u,a-e)), sub(at(u+e,a),at(u-e,a))));
        const i=Mt.min(D.length-1,Mt.max(0,Mt.round(u))), p=at(u,a);
        return dot(n,sub(p,[D[i].x,D[i].y,D[i].z]))<0 ? n.map(v=>-v) : n; };
      // the section at u, its fields interpolated between rings (so details have no steps)
      const sec=u=>{ u=Mt.max(0,Mt.min(D.length-1.0001,u)); const i=Mt.floor(u), f=u-i, s={};
        ["w","t","b","nt","nb"].forEach(k=>{ s[k]=D[i][k]+(D[i+1][k]-D[i][k])*f; }); return s; };
      // ring angle of the top-half point at lateral offset z (sweeps along x)
      const az=(u,z)=>{ const s=sec(u), q=Mt.min(1,Mt.abs(z)/s.w), c=Mt.pow(q,s.nt/2), a=Mt.acos(c);
        return z>=0 ? a : Mt.PI-a; };
      // ring angle on the +side half at height dy above the path
      const ay=(u,dy)=>{ const s=sec(u), up=dy>=0, q=Mt.min(1,Mt.abs(dy)/(up?s.t:s.b));
        return (up?1:-1)*Mt.asin(Mt.pow(q,(up?s.nt:s.nb)/2)); };
      return { D, at, ux, nrm, az, ay };
    }
    // a sheet that follows a skin, lifted off it: o.map(s,t) -> [u,a] with s,t in 0..1 (or o.u, o.a ranges);
    // o.off lift in meters (or fn(s,t)); o.n grid size
    function patch(sk,o){
      const nu=o.n[0], na=o.n[1];
      const map=o.map||((s,t)=>[o.u[0]+(o.u[1]-o.u[0])*s, o.a[0]+(o.a[1]-o.a[0])*t]);
      const V=[], N=[];
      for(let i=0;i<=nu;i++) for(let j=0;j<=na;j++){
        const s=i/nu, t=j/na, ua=map(s,t), p=sk.at(ua[0],ua[1]), n=sk.nrm(ua[0],ua[1]);
        const d=typeof o.off==="function"?o.off(s,t):o.off;
        V.push([p[0]+n[0]*d, p[1]+n[1]*d, p[2]+n[2]*d]); N.push(n);
      }
      sheet(V,N,nu,na,o.mat,o.mirror);
    }
    // a lifted grid of points V ((nu+1) x (na+1)) with outward normals N
    function sheet(V,N,nu,na,matName,mirror){
      const mat=MAT[matName||"hull"];
      (mirror?[1,-1]:[1]).forEach(mz=>{
        const b0=M.p.length/3;
        V.forEach(v=>{ M.p.push(v[0],v[1],v[2]*mz); M.m.push(mat); M.w.push(0); M.c.push(0); });
        const P=k=>[M.p[k*3],M.p[k*3+1],M.p[k*3+2]];
        for(let i=0;i<nu;i++) for(let j=0;j<na;j++){
          const a=b0+i*(na+1)+j, b=a+1, c=a+na+1, d=c+1, n=N[a-b0];
          const f=cross(sub(P(d),P(a)),sub(P(b),P(c)));   // from the diagonals: holds when a row collapses to a point
          if(dot(f,[n[0],n[1],n[2]*mz])>=0) M.i.push(a,c,b, b,c,d); else M.i.push(a,b,c, b,d,c);
        }
      });
    }
    // a bar along points [x,y,z]: w along the side vector (thickness), t/b across
    function bar(pts,o){
      G.sweep(M,Object.assign({ res:1, seg:o.seg||12, st:pts.map(p=>({ x:p[0], y:p[1], z:p[2], w:p[3]!==undefined?p[3]:o.w, t:p[4]!==undefined?p[4]:o.t, b:p[4]!==undefined?p[4]:o.t, n:o.n||4 })) }, o));
    }
    // a closed skin through rings of points (same count each), ends capped
    function loft(R,o){
      const mat=MAT[o.mat||"hull"], n=R[0].length;
      (o.mirror?[1,-1]:[1]).forEach(mz=>{
        const b0=M.p.length/3, cen=R.map(r=>r.reduce((c,p)=>[c[0]+p[0]/n,c[1]+p[1]/n,c[2]+p[2]/n],[0,0,0]));
        R.forEach(r=>r.forEach(p=>{ M.p.push(p[0],p[1],p[2]*mz); M.m.push(mat); M.w.push(o.win?1:0); M.c.push(0); }));
        const P=k=>[M.p[k*3],M.p[k*3+1],M.p[k*3+2]];
        const tri=(a,b,c,out)=>{ const f=cross(sub(P(b),P(a)),sub(P(c),P(a))); if(dot(f,out)>=0) M.i.push(a,b,c); else M.i.push(a,c,b); };
        for(let i=0;i<R.length-1;i++) for(let j=0;j<n;j++){
          const a=b0+i*n+j, b=b0+i*n+(j+1)%n, c=a+n, d=b+n, cc=cen[i].slice(); cc[2]*=mz;
          const out=sub(P(a),cc); tri(a,c,b,out); tri(b,c,d,out);
        }
        [[0,1],[R.length-1,-1]].forEach(([i,dir])=>{
          const c0=M.p.length/3, cc=cen[i].slice(), nb=cen[i+dir].slice(); cc[2]*=mz; nb[2]*=mz;
          M.p.push(cc[0],cc[1],cc[2]); M.m.push(mat); M.w.push(0); M.c.push(0);
          for(let j=0;j<n;j++) tri(c0, b0+i*n+j, b0+i*n+(j+1)%n, sub(cc,nb));
        });
      });
    }
    // monotone cubic through [[x,y],...]: smooth, never overshoots
    function mono(P){
      const n=P.length, X=P.map(p=>p[0]), V=P.map(p=>p[1]), d=[], m=[];
      for(let i=0;i<n-1;i++) d.push((V[i+1]-V[i])/(X[i+1]-X[i]));
      m[0]=d[0]; m[n-1]=d[n-2];
      for(let i=1;i<n-1;i++) m[i]=d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2;
      for(let i=0;i<n-1;i++){ if(d[i]===0){ m[i]=m[i+1]=0; continue; }
        const a=m[i]/d[i], b=m[i+1]/d[i], h=a*a+b*b; if(h>9){ const t=3/Mt.sqrt(h); m[i]=t*a*d[i]; m[i+1]=t*b*d[i]; } }
      return x=>{ if(x<=X[0]) return V[0]; if(x>=X[n-1]) return V[n-1];
        let lo=0, hi=n-1; while(hi-lo>1){ const k=(lo+hi)>>1; if(X[k]<=x) lo=k; else hi=k; }
        const h=X[hi]-X[lo], t=(x-X[lo])/h, t2=t*t, t3=t2*t;
        return (2*t3-3*t2+1)*V[lo]+(t3-2*t2+t)*h*m[lo]+(-2*t3+3*t2)*V[hi]+(t3-t2)*h*m[hi]; };
    }
    const lerp=(a,b,f)=>a+(b-a)*f, clamp=(v,a,b)=>Mt.max(a,Mt.min(b,v));
    // the front of a sweep along +x (path at height yp, K from skin): the forward-most x of its skin at (y,z)
    const fx=(K,yp,y,z)=>{ const D=K.D, dy=y-yp, up=dy>=0, g=s=>{ const h=up?s.t:s.b, e=up?s.nt:s.nb;
        return s.w<1e-6||h<1e-6 ? 1 : Mt.pow(Mt.abs(z)/s.w,e)+Mt.pow(Mt.abs(dy)/h,e)-1; };
      for(let i=D.length-2;i>=0;i--){ const a=g(D[i]); if(a<=0){ const b=g(D[i+1]); return b<=0?D[i+1].x:lerp(D[i].x,D[i+1].x,a/(a-b)); } }
      return D[0].x; };
    // a sheet on that front face over z0..z1 and y0..y1, lifted d meters along the face normal
    function face(K,yp,z0,z1,y0,y1,d,mat,nz){
      const V=[], N=[], nu=nz||8, F=(y,z)=>fx(K,yp,y,z), h=0.05;
      for(let i=0;i<=nu;i++) for(let j=0;j<=1;j++){ const z=lerp(z0,z1,i/nu), y=lerp(y0,y1,j), x=F(y,z),
        n=norm([1,-(F(y+h,z)-F(y-h,z))/(2*h),-(F(y,z+h)-F(y,z-h))/(2*h)]);
        V.push([x+n[0]*d, y+n[1]*d, z+n[2]*d]); N.push(n); }
      sheet(V,N,nu,1,mat);
    }

    // ---- upper hull: stern, dorsal body and saucer, one skin ----
    // smooth profiles in x (meters, from the reference masks): chine height (the saucer rim), half
    // width, dorsal line, depth under the chine, section exponent; the raised spine is a separate skin
    const Y=mono([[0,-13.7],[12,-13.6],[17,-12.9],[23,-12],[28.5,-11.3],[35,-10.5],[46,-9.3],[57,-8.2],[69,-7.2],[80,-6.2],
      [92,-5.3],[103,-4.6],[114,-4.2],[126,-3.9],[143,-3.6],[160,-3.3],[177,-3],[195,-2.7],[206,-2],[218,-1],[229,-0.4],
      [240,0],[269,0.1],[298,0.3],[321,0.5],[338,0.7],[344,0.85]]);
    const W0=mono([[0,5.2],[1.5,12],[3,15],[5.8,18],[8.5,19.6],[11.4,20.7],[17.2,23],[23,23.2],[30,23.2],[60,22.9],[80,22.9],
      [86,23.4],[91.6,24],[97.4,24.7],[103,25.3],[108.8,25.8],[114.6,26.4],[120.4,27],[125,27.6],[128,28.5],[131,30.2],
      [134.5,32.6],[137.6,34.4],[143,38.5],[149,42.4],[155,46.4],[160,50],[166,53.6],[172,56.8],[177.6,59.2],[183,61.2],
      [189,62.5],[195,63.6],[200,64.4],[206,64.8],[212,65.15],[217.8,65.3],[223,65.2],[229,64.95],[235,64.6],[240,64.2],
      [246,63.5],[252,62.6],[257.7,61.7],[263.6,60.45],[269.4,59.2],[275,57.7],[280.8,56],[286,54.25],[292,52.1],
      [298,49.8],[303.5,46.8],[309.3,43.4],[315,39.7],[320.7,35.7],[326.5,31],[332.9,25.3],[335.1,22.8],[337.2,20.2],
      [338.9,17.7],[340.5,15.2],[341.5,12.7],[342.5,10.1],[343.2,7.6],[343.7,5],[344,0]]);
    // the saucer's plan less the rim band, which stands 0.45 m proud of it
    const W=x=>Mt.max(0,W0(x)-0.4*clamp((x-124)/22,0,1));
    const TOP=mono([[0,-14.6],[1,-12.5],[2,-11.8],[3,-11.3],[10,-11.1],[12,-10.7],[14,-9.7],[17,-8.7],[20,-7.4],[23,-4.9],
      [26,-2.4],[28.5,-1.6],[34.5,-0.3],[40,0.4],[46,1],[51,1.6],[57,2.3],[63,2.7],[69,3.2],[74,3.6],[80,4.1],[86,4.6],
      [92,5.2],[97,6.2],[103,7.3],[109,8.6],[114,10.3],[120,12.3],[126,14.8],[132,18.2],[137,20.6],[143,23],[149,25.1],
      [155,26.7],[160,27.7],[166,28.2],[172,28.3],[190,28.2],[210,28],[218,27.7],[223,27.3],[229,26.1],[235,24.7],[240,23.9],
      [246,23.5],[252,23.1],[258,22.6],[264,21.8],[269,21.1],[275,20.2],[281,19.4],[286,18.6],[292,17.6],[296,17.36],[298,17.15],[300,16.15],
      [302,15.47],[304,15.13],[306,14.71],[308,14.15],[310,13.5],[312,12.8],[315,11.8],[321,10.1],[326.5,8.6],[332,7],[338,5.2],[341,4.1],[343,3.1],[343.7,2.5],[344,0.85]]);
    const BOT=mono([[0,1.3],[3,2.3],[6,2.4],[12,2.4],[17,3.4],[23,4],[28.5,4.5],[35,5],[103,5],[126,4],[150,3],[180,2.6],
      [200,2],[206,1.9],[212,2.5],[218,3.8],[225,5.4],[232,6.3],[240,6.8],[258,6.8],[264,6.6],[275,6.2],[281,6],[286,5.4],
      [292,4.8],[298,4.2],[303.5,3.6],[309,3.2],[321,3.1],[326.5,2.9],[332.4,2.4],[338,2.3],[341,1.8],[343,1.4],[343.7,1.1],[344,0]]);
    const RIDGE=mono([[30,0],[36,0.8],[44,1.2],[130,1.2],[150,1.5],[178,2.2],[296,2.2],[298,2.05],[300,1.2],[302,0.62],[306,0.38],
      [310,0.15],[312,0],[344,0]]);
    const NT=mono([[0,2.5],[28,2.5],[34,2.6],[100,2.6],[114,2.35],[126,2.05],[137,1.8],[150,1.6],[162,1.55],[344,1.55]]);
    const xs=[0,0.6,1.2,2,3,4.5,6,8,10,12,14,16,18,20,22,24,26,28.5,31];
    for(let x=34;x<330;x+=3) xs.push(x);
    xs.push(330,332.5,334.5,336.5,338,339.5,340.7,341.7,342.5,343.1,343.5,343.8,344);
    const ust=xs.map(x=>({ x, y:Y(x), w:W(x), t:Mt.max(0,TOP(x)-Y(x)-RIDGE(x)), b:BOT(x), nt:NT(x), nb:x<30?2.5:2 }));
    const UH=skin(ust,2);
    G.sweep(M,{ st:ust, seg:72, res:2, win:1 });

    // ---- dorsal spine and the raised center of the saucer ----
    // it runs on past the bow knee at x 300 and tapers out at x 312.5, so it ends with no flat cap
    const SPW=mono([[30,3],[36,6.5],[60,7],[130,7.5],[150,10],[172,15],[190,17.5],[240,17.5],[270,12.5],[286,9],[300,7.5],
      [306,6.4],[310,4.6],[312.5,0]]);
    const sst=[];
    for(let x=30;x<=312.5;x=x<297?x+3:x<312?x+1:x+0.5){ const u=UH.ux(x), top=UH.at(u,Mt.PI/2)[1];
      sst.push({ x, y:top+RIDGE(x)-0.6, w:SPW(x), t:0.6, b:4.5, nt:3.5, nb:2 }); }
    const SP=skin(sst,1);
    G.sweep(M,{ st:sst, seg:32, res:1 });
    // the raised plateau around the bridge: rounded in plan, its front a 45 degree face (officers' mess) at x 231-234.6
    const pst=[[160,6,2.6],[168,15,3.3],[176,19,3.5],[200,19.5,3.4],[214,19.5,3.1],[222,19,3],[227,17.5,3],[230,14.5,2.95],
      [231.4,12.4,2.55],[232.4,9.9,1.8],[233.4,5.8,0.75],[234.3,2.2,0.25],[234.6,0,0]].map(r=>({ x:r[0], y:25, w:r[1], t:r[2], b:7, nt:6, nb:6 }));
    const PL=skin(pst,3);
    G.sweep(M,{ seg:40, res:3, st:pst });

    // ---- secondary hull: the belly under the chine, its top inside the upper hull ----
    const KEEL=mono([[14,-16],[16,-17.2],[20,-18],[35,-18.5],[55,-19.2],[66,-20],[70,-21.2],[74,-23.4],[77,-25.6],[80,-27.1],
      [84,-28.2],[90,-28.9],[97,-29.4],[103,-30],[109,-30.7],[114,-31.1],[120,-31.6],[126,-32.1],[132,-32.3],[137,-32.6],
      [143,-33],[149,-33.4],[155,-33.5],[160,-33.3],[166,-33],[172,-32.5],[176,-31.8],[180,-30.7],[184,-28.8],[188,-26],
      [190,-22.7],[192,-18.6],[194,-14.8],[196,-11.6],[198,-9.6],[200,-6.6],[202,-4.6],[203.5,-3.4],[205,-2.6]]);
    const BW=mono([[14,15],[17,19],[20,20.5],[26,22],[35,22.4],[55,22.5],[80,22.6],[86,23],[97,24.2],[109,25.2],[120,25.8],
      [132,26.3],[143,26.6],[152,26.8],[163,26.8],[172,26.3],[178,25.6],[184,24.6],[190,23.4],[195,21.8],[199,19],[202,15],
      [204,9],[205,0]]);
    const bx=[14,15,16.5,18,20,23,26];
    for(let x=29;x<180;x+=3) bx.push(x);
    for(let x=180;x<205;x+=1.5) bx.push(x);
    bx.push(205);
    const bst=bx.map(x=>({ x, y:Y(x), w:BW(x), t:x<204?3:0, b:Mt.max(0,Y(x)-KEEL(x)), nt:4, nb:2.3 }));
    const BH=skin(bst,2);
    G.sweep(M,{ st:bst, seg:56, res:2, win:1 });

    // the red pinstripe along the belly, level with the nacelles
    patch(BH,{ n:[48,2], off:0.2, mat:"trim", mirror:true,
      map:(s,t)=>{ const x=lerp(108,189,s), u=BH.ux(x); return [u, BH.ay(u,-14.3-Y(x)+(2*t-1)*0.35)]; } });

    // ---- bridge module and dome; the module ends in a face over the plateau ----
    const mst=[[178,5,1.5],[180,10.5,4],[182,13,5],[190,14.6,5.1],[205,14.6,5],[211,13.8,4.4],[213.5,12.8,3.3],[216,11.5,3.15],
      [217.5,9.5,3.05],[218.3,6.5,2.3],[218.8,3,1],[219,0,0]].map(r=>({ x:r[0], y:26, w:r[1], t:r[2], b:r[2]?5:0, nt:4 }));
    const MD=skin(mst,4);
    G.sweep(M,{ seg:48, st:mst });
    G.saucer(M,{ x:205, fwd:8.5, aft:8, side:8, seg:48, prof:[[0,33.3],[0.5,33.15],[0.8,32.4],[1,30.6],[1,28.5]] });
    // window rows on the two tier faces (studio front photo): five on the plateau, three pairs on the module front
    face(PL,25,-9.5,9.5,26.2,27.4,0.3,"dark",16);
    [-7.2,-3.6,0,3.6,7.2].forEach(z=>face(PL,25,z-1.15,z+1.15,26.4,27.2,0.45,"lamp",2));
    face(MD,26,-6,6,28.15,28.85,0.3,"dark",12);
    [-4.9,-3.1,-0.9,0.9,3.1,4.9].forEach(z=>face(MD,26,z-0.7,z+0.7,28.25,28.75,0.45,"lamp",2));

    // ---- nacelles ----
    const nrows=[[14.4,-14.5,2.5,2,2,59.8],[15.2,-14.5,5.5,4,4,59.8],[16.8,-14.5,7.7,5.1,5.1,59.8],[20,-14.4,8.4,5.6,5.6,59.8],
      [40,-14.3,8.3,5.7,5.7,59.6],[65,-14.3,8,5.7,5.7,59.3],[86,-14.3,7.6,5.7,5.7,58.9],[90,-14.1,7,5.6,5.6,59.2],
      // the nose: blunt from above, a wedge from the side
      [95,-13.7,6.6,5.6,5.6,59.4],[100,-13.55,6.25,4.85,4.5,59.4],[104,-13.55,5.85,3.7,3.5,59.4],[107,-13.6,5.45,2.5,2.4,59.4],
      [109,-13.6,4.8,1.6,1.6,59.4],[110.3,-13.6,3.3,1,1,59.4],[111.1,-13.6,1.2,0.45,0.45,59.4],[111.4,-13.6,0,0,0,59.4]];
    const nst=nrows.map(r=>({ x:r[0], y:r[1], z:r[5], w:r[2], t:r[3], b:r[4], n:3 }));
    const NH=skin(nst,3);
    G.sweep(M,{ st:nst, seg:40, res:3, mirror:true });

    // ---- pylons: swept wings lofted span-wise, chord along x ----
    // [z, trailing x, leading x, y, half thickness]
    const py=[[16,21,76,-13.2,2.3],[24,21,76,-13.2,2.3],[30,22,76.5,-13.3,2.25],[35,23.5,77,-13.4,2.2],[40,27,77.5,-13.6,2.15],
      [44,33,78.5,-13.8,2.1],[47,38,80,-14,2.05],[50,40.5,82.5,-14.1,2],[54,41.5,84.5,-14.2,2]];
    const pR=[];
    for(let i=0;i<py.length-1;i++) for(let k=0;k<(i===py.length-2?5:4);k++){
      const f=k/4, A=py[Mt.max(0,i-1)], B=py[i], C=py[i+1], D=py[Mt.min(py.length-1,i+2)];
      const v=[0,1,2,3,4].map(c=>cr(A[c],B[c],C[c],D[c],f));
      const ring=[];
      for(let j=0;j<28;j++){ const a=j/28*2*Mt.PI;
        ring.push([(v[1]+v[2])/2+spow(Mt.cos(a),2/3)*(v[2]-v[1])/2, v[3]+spow(Mt.sin(a),2/3)*v[4], v[0]]); }
      pR.push(ring);
    }
    loft(pR,{ mirror:true });

    // ---- navigational deflector: a dark dish in the belly's grey front housing; short glowing ribs on the lower
    // arc, a copper frame splitting the black center into three panels. Dish coords: X across (+z), V up the face ----
    const A3=1.5*Mt.PI, dc=[BH.ux(193.6),A3], dr=[BH.ux(199.2)-BH.ux(193.6), 0.98];
    const dsh=(X,V)=>[dc[0]+dr[0]*V, dc[1]+dr[1]*X];
    const ell=(r0,r1,th0,th1,cv,sx,sv)=>(s,t)=>{ const r=lerp(r0,r1,s), th=lerp(th0,th1,t);
      return dsh(r*Mt.sin(th)*(sx||1), (cv||0)+r*Mt.cos(th)*(sv||1)); };
    const quad=(P,o)=>patch(BH,Object.assign({ n:[2,2], map:(s,t)=>{ const a=[lerp(P[0][0],P[1][0],t),lerp(P[0][1],P[1][1],t)],
      b=[lerp(P[3][0],P[2][0],t),lerp(P[3][1],P[2][1],t)]; return dsh(lerp(a[0],b[0],s),lerp(a[1],b[1],s)); } },o));
    patch(BH,{ map:ell(0,1,0,2*Mt.PI), n:[8,72], off:0.15, mat:"dark" });
    patch(BH,{ map:ell(1,1.12,0,2*Mt.PI), n:[2,72], off:0.3, mat:"hull2" });
    // the grey housing around the dish carries no windows: a plain skin over its flanks (the belly bottom has none)
    [1,-1].forEach(sd=>patch(BH,{ n:[3,36], off:0.24, mat:"hull", map:(s,t)=>{ const r=lerp(1.12,1.75,s), a=Mt.asin(Mt.min(1,0.6/r)),
      th=sd*lerp(a,Mt.PI-a,t); return dsh(r*Mt.sin(th), r*Mt.cos(th)); } }));
    // a dense ring of short ribs on the outer third, a black center
    for(let k=0;k<56;k++){ const th=Mt.PI/2-0.32+(k+0.5)/56*(Mt.PI+0.64);
      patch(BH,{ map:ell(0.68,0.97,th-0.018,th+0.018), n:[3,1], off:0.35, mat:"deflector" }); }
    patch(BH,{ map:ell(0.92,1,0,2*Mt.PI,0.22,0.84,0.62), n:[1,64], off:0.45, mat:"trim" });
    [-1,1].forEach(sd=>quad([[sd*0.27,0.81],[sd*0.335,0.81],[sd*0.215,-0.38],[sd*0.15,-0.38]],{ off:0.45, mat:"trim" }));
    quad([[-0.04,0.26],[0.04,0.26],[0.04,0.34],[-0.04,0.34]],{ off:0.5, mat:"deflector" });

    // ---- saucer rim: a vertical band around the edge (windows), tapering into the body ----
    const RD=UH.D.filter(q=>q.x>=124), rp=[];
    RD.forEach(q=>rp.push(q)); for(let i=RD.length-2;i>=0;i--) rp.push(Object.assign({},RD[i],{side:1}));
    const raw=rp.map(q=>({ x:q.x, z:(q.side?1:-1)*Mt.max(0,q.w-0.1), y:q.y, t:q.t, b:q.b }));
    const rim=[]; let acc=0;
    for(let i=0;i<raw.length;i++){
      if(i) acc+=Mt.hypot(raw[i].x-raw[i-1].x, raw[i].z-raw[i-1].z);
      if(i && i<raw.length-1 && acc<(raw[i].x>334?0.6:2.2) && raw[i].x<344) continue; acc=0; rim.push(raw[i]);
    }
    // its inward depth tapers at the bow tip, where the hull is thin
    const band=rim.map(q=>{ const f=clamp((q.x-124)/22,0,1), xc=Mt.min(q.x,342.8);
      const hi=Mt.min(3.6,0.5*(TOP(xc)-Y(xc)-RIDGE(xc)))*f, lo=Mt.min(2.2,0.6*BOT(xc))*f;
      return { x:q.x, y:q.y+(hi-lo)/2, z:q.z, w:(hi+lo)/2, t:0.45*f, b:2.2*f*Mt.min(1,(344-q.x)/8+0.35), n:6, r:1 }; });
    G.sweep(M,{ st:band, side:[0,1,0], seg:24, res:1, win:1 });
    // RCS thruster blocks on the rim, two dark louvers across each
    [172.5,298].forEach(x0=>[-1,1].forEach(sd=>{
      const pts=rim.filter(q=>Mt.abs(q.x-x0)<4.5 && Mt.sign(q.z)===sd);
      if(pts.length<2) return;
      bar(pts.map(q=>[q.x, q.y+0.9, q.z+sd*0.55, 2.9, 1.0]),{ side:[0,1,0], mat:"trim", n:6 });
      const ins=pts.slice(1,-1).length>1?pts.slice(1,-1):pts;
      [-0.6,1.2].forEach(dy=>bar(ins.map(q=>[q.x, q.y+0.9+dy, q.z+sd*0.72, 0.4, 1.0]),{ side:[0,1,0], mat:"dark", n:6 }));
    }));
    // sensor palettes on the band: dark strips with grey greebles, pushed out along the rim's normal in plan
    [-1,1].forEach(sd=>{
      const R=rim.map((q,i)=>({ x:q.x, z:q.z, y:band[i].y })).filter(q=>Mt.sign(q.z)===sd).sort((a,b)=>a.x-b.x);
      const pos=x=>{ let i=0; while(i<R.length-2 && R[i+1].x<x) i++; const a=R[i], b=R[i+1], f=(x-a.x)/((b.x-a.x)||1);
        return [lerp(a.x,b.x,f), lerp(a.y,b.y,f), lerp(a.z,b.z,f)]; };
      const out=(x,d,dy)=>{ const p=pos(x), a=pos(x-0.5), b=pos(x+0.5), l=Mt.hypot(b[0]-a[0],b[2]-a[2])||1;
        return [p[0]-sd*(b[2]-a[2])/l*d, p[1]+(dy||0), p[2]+sd*(b[0]-a[0])/l*d]; };
      [[222,260,[224,0.45, 228.5,-0.4, 233,0.4, 238,-0.45, 243.5,0.35, 248,-0.4, 252.5,0.45, 257,-0.35]],
       [314,337,[316.5,-0.4, 320.5,0.4, 324.5,-0.35, 328.5,0.45, 332.5,-0.4]]].forEach(([x0,x1,gb])=>{
        const pts=[]; for(let k=0;k<=12;k++) pts.push(out(lerp(x0,x1,k/12),0.55));
        bar(pts,{ side:[0,1,0], w:1.1, t:0.25, mat:"dark", n:6 });
        for(let k=0;k<gb.length;k+=2)
          bar([out(gb[k]-0.75,0.84,gb[k+1]),out(gb[k]+0.75,0.84,gb[k+1])],{ side:[0,1,0], w:0.4, t:0.12, mat:"hull2", n:6 });
      });
    });

    // ---- upper sensor palette (a long greebled lozenge on the spine's forward end) and the auxiliary deflector ----
    const onTop=(K,x0,x1,hw,o)=>patch(K,Object.assign({ n:[16,8], map:(s,t)=>{ const x=lerp(x0,x1,s), u=K.ux(x); return [u, K.az(u,(2*t-1)*hw(s))]; } },o));
    onTop(SP,274,310.5,s=>Mt.min(1,3*s,3*(1-s))*4.8+0.5,{ n:[30,8], off:0.15, mat:"dark" });
    [[277,281,-2.6,1.2],[279,284,1.4,3.6],[283.5,287,-4.2,-1.4],[286,292,0.6,3.2],[290,293,-3.4,-0.6],[293.5,298,-2,1.6],
     [297,300,2.2,4.2],[300.5,304,-2.6,-0.4],[303,306,0.4,1.8]].forEach(r=>onTop(SP,r[0],r[1],()=>1,
      { n:[2,2], off:0.32, mat:"hull2", map:(s,t)=>{ const u=SP.ux(lerp(r[0],r[1],s)); return [u, SP.az(u,lerp(r[2],r[3],t))]; } }));
    // aux deflector: flat aft end with rounded corners, round front; a dark recess split by a copper frame
    // (outline, aft bar and two struts that splay toward the bow) into three panels
    const adf=h=>s=>h*Mt.sqrt(Mt.max(0,1-Mt.max(0,(s-0.4)/0.6)**2))*Mt.sqrt(1-(1-Mt.min(1,s/0.07))**2);
    onTop(UH,313.6,332.6,adf(6),{ n:[24,8], off:0.12, mat:"dark" });
    onTop(UH,315.2,331.2,adf(4.7),{ n:[24,8], off:0.2, mat:"dark" });
    const af=adf(4.7), afm=(t0,t1,s1)=>(s,t)=>{ const q=s*(s1||1), u=UH.ux(lerp(315.2,331.2,q)); return [u, UH.az(u,(2*lerp(t0,t1,t)-1)*af(q))]; };
    [[0,0.12],[0.88,1]].forEach(r=>patch(UH,{ n:[24,1], off:0.3, mat:"trim", map:afm(r[0],r[1]) }));
    patch(UH,{ n:[3,6], off:0.3, mat:"trim", map:afm(0,1,0.07) });
    [-1,1].forEach(sd=>patch(UH,{ n:[6,1], off:0.3, mat:"trim",
      map:(s,t)=>{ const u=UH.ux(lerp(316,328.8,s)); return [u, UH.az(u,sd*(lerp(1.6,3.05,s)+(t-0.5)*0.8))]; } }));

    // ---- dorsal phaser arcs ----
    const arc=[[193,41],[205,42.5],[220,42.7],[235,41.5],[250,38],[263,33],[275,26.5],[285,19],[292,11]];
    const arcAt=s=>{ const f=s*(arc.length-1), i=Mt.min(arc.length-2,Mt.floor(f)), g=f-i;
      return [lerp(arc[i][0],arc[i+1][0],g), lerp(arc[i][1],arc[i+1][1],g)]; };
    [-1,1].forEach(sd=>{
      const pts=[];
      for(let k=0;k<=40;k++){ const q=arcAt(k/40), u=UH.ux(q[0]), a=UH.az(u,sd*q[1]), p=UH.at(u,a), n=UH.nrm(u,a);
        pts.push([p[0]+n[0]*0.15, p[1]+n[1]*0.15, p[2]+n[2]*0.15]); }
      bar(pts,{ side:[0,1,0], w:0.6, t:0.8, mat:"dark", n:6 });
    });

    // ---- dorsal saucer details (voy-views top), port side given, mirrored: window wells with three lit windows on
    // their inboard sill, the two dark wedges ahead of the arcs, escape pod hatches turned with the rim ----
    const deck=(f,o)=>patch(UH,Object.assign({ n:[2,2], mirror:true, map:(s,t)=>{ const q=f(s,t), u=UH.ux(q[0]); return [u, UH.az(u,q[1])]; } },o));
    [[207,219,-56.5,-52],[234,242.5,-47,-44],[255,266.5,-58,-54],[210,222,-30.5,-25.5]].forEach(r=>{
      deck((s,t)=>[lerp(r[0],r[1],s), lerp(r[2],r[3],t)],{ n:[3,2], off:0.15, mat:"dark" });
      const l=(r[1]-r[0])/3;
      for(let k=0;k<3;k++) deck((s,t)=>[r[0]+l*(k+0.15+0.7*s), r[3]-0.25+0.5*t],{ off:0.25, mat:"lamp" });
    });
    deck((s,t)=>{ const a=[lerp(288.5,290.8,t), lerp(-22.6,-20.3,t)]; return [lerp(a[0],293.3,s), lerp(a[1],-27.4,s)]; },{ off:0.15, mat:"dark" });
    const dW=x=>(W(x+1)-W(x-1))/2;
    [[152.6,-19.1],[157.3,-22.2],[195.3,-59.3],[200.7,-59.6],[218,-61],[223.8,-54.4],[229.6,-53.4],[244.2,-51.5],
     [263.6,-38.8],[302.4,-39.8],[316,-30]].forEach(h=>{ const g=dW(h[0]), l=Mt.hypot(1,g);
      deck((s,t)=>[h[0]+((s-0.5)*3.4+(t-0.5)*3.2*g)/l, h[1]+(-(s-0.5)*3.4*g+(t-0.5)*3.2)/l],{ off:0.12, mat:"hull2" }); });

    // ---- nacelle details: outboard warp grilles (narrow strip, wide bulb aft of the collar), the ribbed collar,
    // red bussard strips on the nose's upper corners ----
    const gh=x=>x<18?0:x<19?1.5*(x-18):x<71?1.5:x<79?1.5+2.5*(0.5-0.5*Mt.cos(Mt.PI*(x-71)/8)):x<86.5?4:x<88.5?4*Mt.sqrt(Mt.max(0,1-((x-86.5)/2)**2)):0;
    const gA=x=>Mt.asin(Mt.min(1,Mt.pow(gh(x)/5.7,1.5)));
    patch(NH,{ n:[72,6], off:0.25, mat:"grille", mirror:true,
      map:(s,t)=>{ const x=lerp(18,88.5,s); return [NH.ux(x), (2*t-1)*gA(x)]; } });
    const bh=x=>x<95.5?0:x<97?0.4*(x-95.5)/1.5:x<103?0.4:x<108?0.4*(108-x)/5:0;
    [0.6,Mt.PI-0.6].forEach(a0=>patch(NH,{ n:[24,6], off:0.25, mat:"bussard", mirror:true,
      map:(s,t)=>{ const x=lerp(95.5,108,s); return [NH.ux(x), a0+(2*t-1)*bh(x)]; } }));
    patch(NH,{ u:[NH.ux(89.8),NH.ux(93.6)], a:[0,2*Mt.PI], n:[3,48], off:0.2, mat:"hull2", mirror:true });
    [90.5,91.7,92.9].forEach(x=>patch(NH,{ u:[NH.ux(x-0.25),NH.ux(x+0.25)], a:[0,2*Mt.PI], n:[1,48], off:0.3, mat:"dark", mirror:true }));
    // red pinstripe along the top, just inboard of center, 0.35 m wide
    patch(NH,{ n:[30,1], off:0.2, mat:"trim", mirror:true, map:(s,t)=>{ const u=NH.ux(lerp(30,88,s)), p=NH.at(u,1.74), q=NH.at(u,1.76);
      return [u, 1.75+(2*t-1)*0.175*0.02/Mt.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])]; } });

    // ---- impulse engines: flat-topped boxes on the pylon roots; glowing vertical fins in a dark recess aft,
    // a red vent on the squared front ----
    // rings [x, w, t, b, skew] around (y0,z0); skew slides each ring point forward by skew*outboard offset, so the
    // aft face runs parallel to the pylon's swept trailing edge; a repeated ring is a crease
    const sbox=(R,y0,z0,o)=>loft(R.map(r=>{ const P=[];
      for(let j=0;j<28;j++){ const a=j/28*2*Mt.PI, s=Mt.sin(a), X=spow(Mt.cos(a),1/3)*r[1], Y=spow(s,1/3)*(s>=0?r[2]:r[3]);
        P.push([r[0]+r[4]*X, y0+Y, z0+X]); } return P; }),o);
    const ZI=40.6, aft=z=>27+0.8*(z-ZI);
    sbox([[27,3,3,2.4,0.8],[28.4,3.7,4,3.2,0.8],[28.4,3.7,4,3.2,0.8],[57.6,3.7,4,3.2,0],[57.6,3.7,4,3.2,0],[59.2,3.2,3.1,2.5,0]],
      -12.6,ZI,{ mirror:true });
    sbox([[26.6,2.7,2.4,1.9,0.8],[27.2,2.7,2.4,1.9,0.8]],-12.8,ZI,{ mirror:true, mat:"dark" });
    for(let j=0;j<5;j++){ const z=ZI+(j-2)*1.15, x=aft(z);
      G.sweep(M,{ mirror:true, seg:8, res:1, mat:"impulse", st:[{x:x-1.9, y:-12.8, z, w:0.18, t:2.2, b:1.7, n:6},{x:x+0.1, y:-12.8, z, w:0.18, t:2.2, b:1.7, n:6}] }); }
    G.sweep(M,{ mirror:true, seg:16, res:1, mat:"trim", st:[{x:52.5, y:-8.7, z:ZI, w:3.1, t:0.3, b:0.3, n:6},{x:57.2, y:-8.7, z:ZI, w:3.1, t:0.3, b:0.3, n:6}] });

    // ---- shuttlebay door on the stern slope ----
    patch(UH,{ n:[10,16], off:0.15, mat:"dark",
      map:(s,t)=>{ const x=lerp(13.5,26.5,s), u=UH.ux(x), hw=lerp(8.5,11,s); return [u, UH.az(u,(2*t-1)*hw)]; } });
    return M;
  }
};
