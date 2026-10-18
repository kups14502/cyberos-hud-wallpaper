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
    const hsh=(a,b)=>{ const v=Mt.sin(a*12.9898+b*78.233)*43758.5453; return v-Mt.floor(v); };
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
    const RIDGE=mono([[30,0],[36,0.8],[44,1.2],[130,1.2],[150,1.5],[162,1.2],[170,0.3],[174,0],[344,0]]);
    // the bow: from x 275 the saucer alone carries the dorsal line, one smooth curve to x 315 (Hermite with the
    // neighboring profile's end slopes), so nothing bends across the nose
    const BOWTOP=[];
    for(let x=277;x<315;x+=2){ const t=(x-275)/40, t2=t*t, t3=t2*t;
      BOWTOP.push([x, (2*t3-3*t2+1)*20.2+(t3-2*t2+t)*40*-0.15+(-2*t3+3*t2)*11.8+(t3-t2)*40*-0.3]); }
    const TOP=mono([[0,-14.6],[1,-12.5],[2,-11.8],[3,-11.3],[10,-11.1],[12,-10.7],[14,-9.7],[17,-8.7],[20,-7.4],[23,-4.9],
      [26,-2.4],[28.5,-1.6],[34.5,-0.3],[40,0.4],[46,1],[51,1.6],[57,2.3],[63,2.7],[69,3.2],[74,3.6],[80,4.1],[86,4.6],
      [92,5.2],[97,6.2],[103,7.3],[109,8.6],[114,10.3],[120,12.3],[126,14.8],[132,18.2],[137,20.6],[143,23],[149,25.1],
      [155,26.7],[160,27.7],[166,28.2],[172,28.3],[190,28.2],[210,28],[218,27.7],[223,27.3],[229,26.1],[235,24.7],[240,23.9],
      [246,23.5],[252,23.1],[258,22.6],[264,21.8],[269,21.1],[275,20.2],...BOWTOP,[315,11.8],[321,10.1],[326.5,8.6],[332,7],[338,5.2],[341,4.1],[343,3.1],[343.7,2.5],[344,0.85]]);
    const BOT=mono([[0,1.3],[3,2.3],[6,2.4],[12,2.4],[17,3.4],[23,4],[28.5,4.5],[35,5],[103,5],[126,4],[150,3],[180,2.6],
      [200,2],[206,1.9],[212,2.5],[218,3.8],[225,5.4],[232,6.3],[240,6.8],[258,6.8],[264,6.6],[275,6.2],[281,6],[286,5.4],
      [292,4.8],[298,4.2],[303.5,3.6],[309,3.2],[321,3.1],[326.5,2.9],[332.4,2.4],[338,2.3],[341,1.8],[343,1.4],[343.7,1.1],[344,0]]);
    const NT=mono([[0,2.5],[28,2.5],[34,2.6],[100,2.6],[114,2.35],[126,2.05],[137,1.8],[150,1.6],[162,1.55],[344,1.55]]);
    const xs=[0,0.6,1.2,2,3,4.5,6,8,10,12,14,16,18,20,22,24,26,28.5,31];
    for(let x=34;x<264;x+=3) xs.push(x);
    for(let x=264;x<330;x++) xs.push(x);
    xs.push(330,332.5,334.5,336.5,338,339.5,340.7,341.7,342.5,343.1,343.5,343.8,344);
    const ust=xs.map(x=>({ x, y:Y(x), w:W(x), t:Mt.max(0,TOP(x)-Y(x)-RIDGE(x)), b:BOT(x), nt:NT(x), nb:x<30?2.5:2 }));
    const UH=skin(ust,1);
    const uh0=M.p.length/3;
    G.sweep(M,{ st:ust, seg:192, res:1, win:1 });
    const uh1=M.p.length/3;

    // ---- recesses cut into the nose (the studio model's): the upper sensor palette, a shallow lozenge full of
    // greebles, and the auxiliary deflector, a deep oval opening near the tip with a lit interior. The skin's
    // vertices inside each outline drop straight down, so the walls and floor are the hull itself ----
    const PALT={ x0:274, x1:307.5, d:0.85 }, AUX={ cx:323.5, a:8.5, b:5.3, n:2.6, d:2.6 };
    const palW=x=>{ const s=(x-PALT.x0)/(PALT.x1-PALT.x0); return s<=0||s>=1 ? 0 : Mt.min(1,2.6*s,2.6*(1-s))*4.1+0.25; };
    const auxR=(x,z)=>Mt.pow(Mt.pow(Mt.abs(x-AUX.cx)/AUX.a,AUX.n)+Mt.pow(Mt.abs(z)/AUX.b,AUX.n),1/AUX.n);
    // how deep the cut is at plan (x,z); the walls take half a meter
    const cut=(x,z)=>{ let d=0; const w=palW(x);
      if(w>0) d=PALT.d*clamp((w-Mt.abs(z))/0.5,0,1);
      const r=auxR(x,z); if(r<1) d=Mt.max(d, AUX.d*clamp((1-r)*AUX.b/0.5,0,1));
      return d; };
    for(let k=uh0;k<uh1;k++){ const x=M.p[k*3], y=M.p[k*3+1], z=M.p[k*3+2];
      if(x<272 || y<Y(x)+0.5) continue;
      const d=cut(x,z); if(d>0){ M.p[k*3+1]=y-d; M.w[k]=0; } }

    // ---- dorsal spine: a flat band along the neck, ending where the bridge deck begins; from there the saucer's
    // own dome carries the dorsal line, falling smoothly from the bridge to the nose ----
    const SPW=mono([[30,3],[36,6.5],[60,7],[130,7.5],[150,10],[162,8],[170,3],[174,0]]);
    const sst=[];
    for(let x=30;x<=174;x+=(x<165?3:1)){ const u=UH.ux(x), tt=UH.at(u,Mt.PI/2)[1]+RIDGE(x);
      sst.push({ x, y:tt-0.6, w:SPW(x), t:0.6, b:4.5, nt:3.5, nb:2 }); }
    const SP=skin(sst,1), SPX=mono(sst.map(s=>[s.x,s.w]));
    G.sweep(M,{ st:sst, seg:32, res:1 });
    // the bridge deck: a low rounded rise 0.8 m proud of the dome; it ends in a short steep face, curved in plan,
    // the indent that holds the officers' mess windows under a lip
    const PT=x=>TOP(Mt.min(x,226))+0.8-25;
    const pst=[[160,5],[168,12],[176,15.5],[200,16.5],[214,16.5],[222,16],[226,15],[229,13.2],[231,11],[232.6,8.4],[233.7,5.4],
      [234.4,2.4],[234.6,0]].map(r=>({ x:r[0], y:25, w:r[1], t:r[1]?PT(r[0]):0, b:7, nt:2.3, nb:6 }));
    const PL=skin(pst,3), PLW=mono(pst.map(r=>[r.x,r.w]));
    G.sweep(M,{ seg:48, res:3, st:pst });

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
    const BH=skin(bst,1);
    G.sweep(M,{ st:bst, seg:56, res:1, win:1 });

    // the red pinstripe along the belly, level with the nacelles
    patch(BH,{ n:[48,2], off:0.2, mat:"trim", mirror:true,
      map:(s,t)=>{ const x=lerp(108,189,s), u=BH.ux(x); return [u, BH.ay(u,-14.3-Y(x)+(2*t-1)*0.35)]; } });

    // ---- bridge module and dome; the module ends in a face over the plateau ----
    const mst=[[178,5,1.5],[180,10.5,4],[182,13,5],[190,14.6,5.1],[205,14.6,5],[211,13.8,4.4],[213.5,12.8,3.3],[216,11.5,3.15],
      [217.5,9.5,3.05],[218.3,6.5,2.3],[218.8,3,1],[219,0,0]].map(r=>({ x:r[0], y:26, w:r[1], t:r[2], b:r[2]?5:0, nt:4 }));
    const MD=skin(mst,4), MDW=mono(mst.map(r=>[r.x,r.w]));
    G.sweep(M,{ seg:48, st:mst });
    G.saucer(M,{ x:205, fwd:8.5, aft:8, side:8, seg:48, prof:[[0,33.3],[0.5,33.15],[0.8,32.4],[1,30.6],[1,28.5]] });
    // window rows on the two tier faces (studio front photo): five on the plateau, three pairs on the module front
    face(PL,25,-9,9,25.95,26.85,0.15,"dark",18);
    [-7.5,-5,-2.5,0,2.5,5,7.5].forEach(z=>face(PL,25,z-0.8,z+0.8,26.15,26.65,0.3,"lamp",2));
    const lip=[]; for(let k=0;k<=24;k++){ const z=lerp(-8.6,8.6,k/24); lip.push([fx(PL,25,26.95,z)+0.3, 26.95, z]); }
    bar(lip,{ side:[0,1,0], w:0.16, t:0.5, mat:"hull" });
    face(MD,26,-6,6,28.15,28.85,0.3,"dark",12);
    [-4.9,-3.1,-0.9,0.9,3.1,4.9].forEach(z=>face(MD,26,z-0.7,z+0.7,28.25,28.75,0.45,"lamp",2));
    // and three on each front corner of the module (studio front photo)
    [213.7,214.9,216.1].forEach(x=>{ const u=MD.ux(x), a=MD.ay(u,2.3), p=MD.at(u,a), n=MD.nrm(u,a), q=MD.at(u+0.05,a), r=MD.at(u-0.05,a);
      const T=norm(sub(q,r)), B=cross(n,T), V=[], N=[];
      for(let i=0;i<2;i++) for(let j=0;j<2;j++){ const e=(i-0.5)*0.75, f=(j-0.5)*0.55;
        V.push([p[0]+n[0]*0.15+T[0]*e+B[0]*f, p[1]+n[1]*0.15+T[1]*e+B[1]*f, p[2]+n[2]*0.15+T[2]*e+B[2]*f]); N.push(n); }
      sheet(V,N,1,1,"lamp",true); });

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
    G.sweep(M,{ st:band, side:[0,1,0], seg:16, res:1, win:1 });
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

    // ---- the recesses' insides: sheets laid on the cut floor, lifted h above it ----
    const onFloor=(f,o)=>{ const nu=o.n[0], na=o.n[1], V=[], N=[];
      for(let i=0;i<=nu;i++) for(let j=0;j<=na;j++){ const q=f(i/nu,j/na), u=UH.ux(q[0]), a=UH.az(u,q[1]), p=UH.at(u,a);
        V.push([p[0], p[1]-cut(q[0],q[1])+o.h, p[2]]); N.push(UH.nrm(u,a)); }
      sheet(V,N,nu,na,o.mat); };
    // a lip around an outline on the surface: plan points [x,z], pushed out by e
    const lipAt=(pts,o)=>bar(pts.map(q=>{ const u=UH.ux(q[0]), a=UH.az(u,q[1]), p=UH.at(u,a), n=UH.nrm(u,a);
      return [p[0]+n[0]*o.lift, p[1]+n[1]*o.lift, p[2]+n[2]*o.lift]; }),{ side:[0,1,0], w:o.w, t:o.t, n:3, seg:8, mat:o.mat });
    // upper sensor palette: a dark floor packed with greeble blocks at a few heights, all below the rim
    onFloor((s,t)=>{ const x=lerp(PALT.x0+0.6,PALT.x1-0.6,s); return [x, (2*t-1)*Mt.max(0,palW(x)-0.55)]; },{ n:[40,8], h:0.04, mat:"dark" });
    for(let k=0;k<70;k++){ const x=lerp(PALT.x0+2,PALT.x1-2,hsh(k,3)), w=palW(x)-0.75; if(w<0.6) continue;
      const lx=0.6+1.5*hsh(k,8), lz=Mt.min(2*w,0.45+1.2*hsh(k,9)), z=(2*hsh(k,5)-1)*(w-lz/2), m=hsh(k,11);
      onFloor((s,t)=>[x+(s-0.5)*lx, z+(t-0.5)*lz],{ n:[1,1], h:0.12+0.5*hsh(k,13), mat:m<0.45?"hull2":m<0.7?"hull":m<0.85?"paint":"dark" }); }
    const pl=[]; for(let k=0;k<=24;k++){ const x=lerp(PALT.x0,PALT.x1,k/24); pl.push([x, palW(x)+0.15]); }
    lipAt(pl,{ lift:0.05, w:0.18, t:0.16, mat:"hull" });
    lipAt(pl.map(q=>[q[0],-q[1]]),{ lift:0.05, w:0.18, t:0.16, mat:"hull" });
    // auxiliary deflector: a deep oval opening, lit warm inside, a grey lattice across it and a round dark port aft
    const ovalZ=(x,k)=>AUX.b*k*Mt.pow(Mt.max(0,1-Mt.pow(Mt.abs(x-AUX.cx)/(AUX.a*k),AUX.n)),1/AUX.n);
    onFloor((s,t)=>{ const x=lerp(AUX.cx-AUX.a*0.86,AUX.cx+AUX.a*0.86,s); return [x, (2*t-1)*ovalZ(x,0.86)]; },{ n:[24,10], h:0.05, mat:"amber" });
    onFloor((s,t)=>{ const a=t*2*Mt.PI, r=1.9*s; return [AUX.cx-AUX.a*0.5+r*Mt.cos(a), r*Mt.sin(a)]; },{ n:[3,24], h:0.12, mat:"dark" });
    [-3.2,0.2,3.6].forEach(dx=>{ const x=AUX.cx+dx, w=ovalZ(x,0.86);
      onFloor((s,t)=>[x+(s-0.5)*0.55, (2*t-1)*w],{ n:[1,8], h:0.75, mat:"hull2" }); });
    onFloor((s,t)=>{ const x=lerp(AUX.cx-AUX.a*0.2,AUX.cx+AUX.a*0.8,s); return [x, (t-0.5)*0.5]; },{ n:[10,1], h:0.75, mat:"hull2" });
    const al=[]; for(let k=0;k<=48;k++){ const a=k/48*2*Mt.PI, c=Mt.cos(a), sn=Mt.sin(a);
      al.push([AUX.cx+(AUX.a+0.2)*Mt.sign(c)*Mt.pow(Mt.abs(c),2/AUX.n), (AUX.b+0.2)*Mt.sign(sn)*Mt.pow(Mt.abs(sn),2/AUX.n)]); }
    lipAt(al,{ lift:0.05, w:0.22, t:0.2, mat:"hull" });

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
      deck((s,t)=>[lerp(r[0],r[1],s), lerp(r[2],r[3],t)],{ n:[3,2], off:0.12, mat:"dark" });
      deck((s,t)=>[lerp(r[0]+0.5,r[1]-0.5,s), lerp(r[2]+0.45,r[3]-1.4,t)],{ n:[3,2], off:0.2, mat:"hull2" });
      const l=(r[1]-r[0])/3;
      for(let k=0;k<3;k++) deck((s,t)=>[r[0]+l*(k+0.15+0.7*s), r[3]-1.15+0.75*t],{ off:0.26, mat:"lamp" });
    });
    deck((s,t)=>{ const a=[lerp(288.5,290.8,t), lerp(-22.6,-20.3,t)]; return [lerp(a[0],293.3,s), lerp(a[1],-27.4,s)]; },{ off:0.15, mat:"dark" });
    const dW=x=>(W(x+1)-W(x-1))/2;
    // escape pod hatches: light cream squares turned with the rim
    const HT=[[152.6,-19.1],[157.3,-22.2],[195.3,-59.3],[200.7,-59.6],[218,-61],[223.8,-54.4],[229.6,-53.4],[244.2,-51.5],
     [263.6,-38.8],[302.4,-39.8],[316,-30]];
    HT.forEach(h=>{ const g=dW(h[0]), l=Mt.hypot(1,g);
      [[4.5,4.3,0.1,"hull2"],[3.8,3.6,0.18,"paint"]].forEach(q=>
        deck((s,t)=>[h[0]+((s-0.5)*q[0]+(t-0.5)*q[1]*g)/l, h[1]+(-(s-0.5)*q[0]*g+(t-0.5)*q[1])/l],{ off:q[2], mat:q[3] })); });
    // short aft phaser strips (cream, dark rim) and the tan sensor grids, as plan quads
    const pq=(C,o)=>deck((s,t)=>{ const a=[lerp(C[0][0],C[1][0],s),lerp(C[0][1],C[1][1],s)], b=[lerp(C[3][0],C[2][0],s),lerp(C[3][1],C[2][1],s)];
      return [lerp(a[0],b[0],t), lerp(a[1],b[1],t)]; },o);
    const cap=(x0,z0,x1,z1,hw)=>{ const l=Mt.hypot(x1-x0,z1-z0), nx=-(z1-z0)/l*hw, nz=(x1-x0)/l*hw;
      return [[x0-nx,z0-nz],[x1-nx,z1-nz],[x1+nx,z1+nz],[x0+nx,z0+nz]]; };
    pq(cap(145.2,-33.4,154.9,-42,1.35),{ n:[6,2], off:0.12, mat:"dark" });
    pq(cap(145.9,-34.1,154.2,-41.3,0.85),{ n:[6,2], off:0.22, mat:"paint" });
    [[[183.8,-34.8],[188.1,-35],[192,-24.4],[187.5,-24]],[[312,-17.85],[315.6,-17.9],[321.5,-12.3],[316.3,-11.9]]].forEach(C=>{
      pq(C,{ n:[2,4], off:0.12, mat:"paint" });
      for(let k=1;k<5;k++){ const f=k/5, a=[lerp(C[0][0],C[3][0],f),lerp(C[0][1],C[3][1],f)], b=[lerp(C[1][0],C[2][0],f),lerp(C[1][1],C[2][1],f)];
        pq(cap(a[0],a[1],b[0],b[1],0.12),{ off:0.18, mat:"hull2" }); } });

    // ---- dorsal windows (studio model): ones, pairs and threes in rings that follow the rim, between the aft
    // grooves and on both sides of the phaser arcs; port side placed, mirrored ----
    const dW0=x=>(W0(x+0.25)-W0(x-0.25))*2;
    const offC=(d,x)=>{ const g=dW0(x), l=Mt.hypot(1,g); return [x+d*g/l, -(W0(x)-d/l)]; };
    const segD=(P,x,z)=>{ let m=1e9; for(let i=0;i<P.length-1;i++){ const a=P[i], b=P[i+1], dx=b[0]-a[0], dz=b[1]-a[1],
      f=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1); m=Mt.min(m,Mt.hypot(x-a[0]-f*dx,z-a[1]-f*dz)); } return m; };
    const arcP=arc.map(q=>[q[0],-q[1]]);
    const KO=[[205.5,220.5,-58,-50.5],[232.5,244,-48.5,-42.5],[253.5,268,-59.5,-52.5],[208.5,223.5,-32,-24],[286.5,295,-28.5,-19],
      [142.5,157.5,-44,-31.5],[182,194,-36.5,-22.5],[310.5,323,-19.5,-10.5],[165,181,-64,-51],[288,304,-57,-44],[261,274,-23,0],[272,309,-6.5,0],[311,336,-8.5,0]];
    const free=(x,z)=>{
      if(KO.some(b=>x>b[0]&&x<b[1]&&z>b[2]&&z<b[3])) return false;
      if(HT.some(h=>Mt.hypot(x-h[0],z-h[1])<3.6)) return false;
      if(x>30 && x<313 && -z<SPX(x)+2.5) return false;
      if(x>158 && x<236.5 && -z<PLW(x)+2.5) return false;
      return segD(arcP,x,z)>2.3; };
    const WV=[], WN=[];
    for(let r=0;r<9;r++){
      const d=4+5.5*r, P=[];
      for(let x=124;x<344;x+=0.5){ const q=offC(d,x); if(q[0]<344-d && W0(q[0])+q[1]>0.55*d) P.push(q); }
      let acc=hsh(r,1)*7.5, k=0;
      for(let i=1;i<P.length;i++){
        const a=P[i-1], b=P[i], l=Mt.hypot(b[0]-a[0],b[1]-a[1]); acc+=l;
        if(acc<7.5) continue; acc-=7.5; k++;
        const h=hsh(r*31+k,7), n=h<0.18?0:h<0.42?1:h<0.86?2:3; if(!n) continue;
        const tx=(b[0]-a[0])/l, tz=(b[1]-a[1])/l, g=1.12*(n-1)/2;
        if(!free(b[0]-tx*(g+0.6),b[1]-tz*(g+0.6)) || !free(b[0]+tx*(g+0.6),b[1]+tz*(g+0.6))) continue;
        for(let j=0;j<n;j++){ const o=(j-(n-1)/2)*1.12, x=b[0]+tx*o, z=b[1]+tz*o, u=UH.ux(x), an=UH.az(u,z), p=UH.at(u,an), nn=UH.nrm(u,an);
          const kk=tx*nn[0]+tz*nn[2], T=norm([tx-nn[0]*kk,-nn[1]*kk,tz-nn[2]*kk]), B=cross(nn,T);
          for(let ii=0;ii<2;ii++) for(let jj=0;jj<2;jj++){ const s=(ii-0.5)*0.7, q=(jj-0.5)*1.1;
            WV.push([p[0]+nn[0]*0.12+T[0]*s+B[0]*q, p[1]+nn[1]*0.12+T[1]*s+B[1]*q, p[2]+nn[2]*0.12+T[2]*s+B[2]*q]); WN.push(nn); } }
      }
    }
    for(let i=0;i<WV.length;i+=4) sheet(WV.slice(i,i+4),WN.slice(i,i+4),1,1,"lamp",true);
    // the aft grooves: dark lines on the rings between the window rows
    [[149.2,180.7],[154.8,183.3],[161.8,185.9],[172.8,182.3]].forEach((g,r)=>{
      const d=6.75+5.5*r, V=[], N=[], m=24;
      for(let i=0;i<=m;i++){ const x0=lerp(g[0],g[1],i/m), c=offC(d,x0);
        [-0.22,0.22].forEach(e=>{ const q=offC(d+e,x0), u=UH.ux(q[0]), a=UH.az(u,q[1]), p=UH.at(u,a), nn=UH.nrm(u,a);
          V.push([p[0]+nn[0]*0.1,p[1]+nn[1]*0.1,p[2]+nn[2]*0.1]); N.push(nn); }); }
      sheet(V,N,m,1,"dark",true);
    });

    // ---- registry on the dorsal saucer, read from the bow: letter tops aft, running from starboard to port ----
    // glyphs in a unit box (u across, v up), polylines; widths in letter heights
    const c4=0.25, GLY={
      N:[1.2,[[0,0,0,1,1,0,1,1]]], C:[1.1,[[1,1,c4,1,0,1-c4,0,c4,c4,0,1,0]]], "-":[0.45,[[0,0.5,1,0.5]]],
      7:[1.05,[[0,1,1,1,0.3,0]]], 4:[1.1,[[0.74,0,0.74,1,0,0.36,1,0.36]]],
      6:[1.1,[[1,1,c4,1,0,1-c4,0,c4,c4,0,1-c4,0,1,c4,1,0.3,1-c4,0.55,0,0.55]]],
      5:[1.1,[[1,1,0,1,0,0.56,1-c4,0.56,1,0.31,1,c4,1-c4,0,0,0]]],
      U:[1.1,[[0,1,0,c4,c4,0,1-c4,0,1,c4,1,1]]], S:[1.1,[[1,1,c4,1,0,1-c4,0,0.62,0.15,0.5,0.85,0.5,1,0.38,1,c4,1-c4,0,0,0]]],
      ".":[0.17,[[0.5,0,0.5,0]]], " ":[0.4,[]], V:[1.15,[[0,1,0.5,0,1,1]]],
      O:[1.15,[[c4,1,1-c4,1,1,1-c4,1,c4,1-c4,0,c4,0,0,c4,0,1-c4,c4,1]]], Y:[1.15,[[0,1,0.5,0.48,1,1],[0.5,0.48,0.5,0]]],
      A:[1.15,[[0,0,0.5,1,1,0],[0.21,0.38,0.79,0.38]]], G:[1.1,[[1,1,c4,1,0,1-c4,0,c4,c4,0,1-c4,0,1,c4,1,0.48,0.55,0.48]]],
      E:[1,[[1,1,0,1,0,0,1,0],[0,0.5,0.82,0.5]]], R:[1.1,[[0,0,0,1,1-c4,1,1,1-c4,1,0.68,1-c4,0.45,0,0.45],[0.55,0.45,1,0]]] };
    // the top-most dorsal skin at plan (x, z): saucer, crown, plateau or bridge module
    const TOPS=[[SP,SPX,30,174],[PL,PLW,160,234.6],[MD,MDW,178,219]];
    const topAt=(x,z)=>{ let u=UH.ux(x), a=UH.az(u,z), p=UH.at(u,a), K=UH, b=a;
      TOPS.forEach(T=>{ if(x>T[2] && x<T[3] && Mt.abs(z)<T[1](x)-0.05){ const v=T[0].ux(x), c=T[0].az(v,z), q=T[0].at(v,c); if(q[1]>p[1]){ p=q; K=T[0]; u=v; b=c; } } });
      return [p,K.nrm(u,b)]; };
    const label=(txt,xb,H,gap)=>{
      const sw=0.19, hw=sw/2*H; let tw=-gap; for(const ch of txt) tw+=GLY[ch][0]+gap;
      let u0=tw/2;
      for(const ch of txt){ const g=GLY[ch], w=g[0];
        g[1].forEach(pl=>{ for(let i=0;i+3<pl.length;i+=2){
          const P=[pl[i],pl[i+1],pl[i+2],pl[i+3]].map((v,k)=>k%2?sw/2+v*(1-sw):sw/2+v*(w-sw));
          const z0=(u0-P[0])*H, x0=xb-P[1]*H, z1=(u0-P[2])*H, x1=xb-P[3]*H, l=Mt.hypot(x1-x0,z1-z0);
          const dx=l?(x1-x0)/l:0, dz=l?(z1-z0)/l:1, m=Mt.max(1,Mt.ceil(l/1.2)), V=[], N=[];
          for(let j=0;j<=m;j++){ const f=-hw+(l+2*hw)*j/m;
            [-1,1].forEach(e=>{ const q=topAt(x0+dx*f-dz*hw*e, z0+dz*f+dx*hw*e), p=q[0], n=q[1];
              V.push([p[0]+n[0]*0.1,p[1]+n[1]*0.1,p[2]+n[2]*0.1]); N.push(n); }); }
          sheet(V,N,m,1,"dark");
        } });
        u0-=w+gap;
      }
    };
    label("NCC-74656",271,3.35,0.32);
    label("U.S.S. VOYAGER",265.9,1.7,0.3);
    const pTop=(C,off,mat)=>{ const V=[], N=[];
      for(let i=0;i<=2;i++) for(let j=0;j<=2;j++){ const s=i/2, t=j/2, a=[lerp(C[0][0],C[1][0],s),lerp(C[0][1],C[1][1],s)],
        b=[lerp(C[3][0],C[2][0],s),lerp(C[3][1],C[2][1],s)], q=topAt(lerp(a[0],b[0],t),lerp(a[1],b[1],t)), p=q[0], n=q[1];
        V.push([p[0]+n[0]*off,p[1]+n[1]*off,p[2]+n[2]*off]); N.push(n); }
      sheet(V,N,2,2,mat); };
    const box=(x0,x1,z0,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
    [box(181.4,185,-4.9,-0.9),box(186.1,189.9,-5,-1),box(191,194.9,-5,-1),box(181.8,185,1.4,5.2),
     [[185.9,1],[195.8,1],[193.5,6.2],[185.9,6.2]],box(181.4,198.1,-0.2,0.9),[[196.8,-9],[199.5,-11.8],[201.9,-8],[199,-5.6]],
     box(200.8,204.5,-12.4,-8.6),box(212.3,216.3,-13,-8.8),box(217.4,221.6,-12.1,-7.8),box(212.5,216.6,8.7,12.9),
     box(217.6,221.8,8.4,12.6),[[196.2,-5.4],[199.7,-5.4],[198.4,-0.9],[196.2,-0.9]],box(172.4,175.4,-5.6,6)].forEach(C=>pTop(C,0.1,"paint"));

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
    // the top lid: a dark groove outlining it
    [0.86,Mt.PI-0.86].forEach(a0=>patch(NH,{ n:[30,1], off:0.18, mat:"dark", mirror:true, map:(s,t)=>[NH.ux(lerp(23.5,87.5,s)), a0+(t-0.5)*0.05] }));
    [23.5,87.5].forEach(x=>patch(NH,{ n:[1,12], off:0.18, mat:"dark", mirror:true, map:(s,t)=>[NH.ux(x+(s-0.5)*0.3), lerp(0.86,Mt.PI-0.86,t)] }));

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

    // ---- shuttlebay on the stern slope: a dark D-shaped opening, rounded forward, with the light door (landing
    // stripes) filling its aft part; tan shield grids on the stern flanks ----
    const onUH=(f,o)=>patch(UH,Object.assign({ map:(s,t)=>{ const q=f(s,t), u=UH.ux(q[0]); return [u, UH.az(u,q[1])]; } },o));
    onUH((s,t)=>{ const z=(2*t-1)*12.7; return [lerp(11,13.4+15.6*Mt.sqrt(Mt.max(0,1-Mt.pow(Mt.abs(z)/12.8,2.2))),s), z]; },{ n:[6,32], off:0.15, mat:"dark" });
    onUH((s,t)=>{ const e=Mt.abs(2*s-1); return [lerp(7.5,24.8,s), (2*t-1)*11.2*Mt.pow(1-Mt.pow(e,8),1/8)]; },{ n:[12,12], off:0.25, mat:"paint" });
    [[9.6,21.5,-7.9,-6.9],[9.6,21.5,6.9,7.9],[11.5,20.5,-0.5,0.5],[19.5,20.5,-7.9,7.9],[9.6,10.6,-7.9,7.9]].forEach(r=>
      onUH((s,t)=>[lerp(r[0],r[1],s), lerp(r[2],r[3],t)],{ n:[3,3], off:0.32, mat:"hull2" }));
    pq([[17.4,-16.4],[28.3,-19.6],[28.3,-22.2],[17.4,-19]],{ n:[4,2], off:0.12, mat:"paint", mirror:true });
    for(let k=1;k<6;k++){ const x=lerp(17.4,28.3,k/6); pq(cap(x,-16.4-3.2*k/6,x,-19-3.2*k/6,0.12),{ off:0.18, mat:"hull2", mirror:true }); }

    // ---- dorsal spine: the twin red pinstripes down its center, the aft torpedo launchers, a dark hatch to port ----
    const onSP=(f,o)=>patch(SP,Object.assign({ map:(s,t)=>{ const q=f(s,t), u=SP.ux(q[0]); return [u, SP.az(u,q[1])]; } },o));
    [-0.65,0.65].forEach(z=>onSP((s,t)=>[lerp(37,158,s), z+(t-0.5)*0.32],{ n:[40,1], off:0.1, mat:"trim" }));
    onSP((s,t)=>[lerp(129.5,138.4,s), (2*t-1)*6.6],{ n:[3,6], off:0.12, mat:"dark" });
    [-2.6,2.6].forEach(z=>onSP((s,t)=>[lerp(131,136.5,s), z+(2*t-1)*1.5],{ n:[2,2], off:0.22, mat:"paint" }));
    onSP((s,t)=>[lerp(146,154,s), lerp(-6.4,-1.6,t)],{ n:[2,2], off:0.12, mat:"dark" });
    return M;
  }
};
