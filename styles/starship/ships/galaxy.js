/* USS Enterprise NCC-1701-D, Galaxy class. Nacelle tails at x 0, saucer bow at x 642.5,
   keel at y 1.5, bridge at y 141.4. Fitted to ref/galaxy.jpg (side), galaxy-top.jpg, galaxy-front.jpg. */
SHIPS.galaxy=(()=>{
  const spow=(v,e)=>Math.sign(v)*Math.pow(Math.abs(v),e);
  // monotone cubic through [[x,y],...]: smooth, never overshoots
  function mono(P){
    const n=P.length, X=P.map(p=>p[0]), Y=P.map(p=>p[1]), d=[], m=[];
    for(let i=0;i<n-1;i++) d.push((Y[i+1]-Y[i])/(X[i+1]-X[i]));
    m[0]=d[0]; m[n-1]=d[n-2];
    for(let i=1;i<n-1;i++) m[i]=d[i-1]*d[i]<=0 ? 0 : (d[i-1]+d[i])/2;
    for(let i=0;i<n-1;i++){
      if(d[i]===0){ m[i]=m[i+1]=0; continue; }
      const a=m[i]/d[i], b=m[i+1]/d[i], h=a*a+b*b;
      if(h>9){ const t=3/Math.sqrt(h); m[i]=t*a*d[i]; m[i+1]=t*b*d[i]; }
    }
    return x=>{
      if(x<=X[0]) return Y[0]; if(x>=X[n-1]) return Y[n-1];
      let i=0; while(x>X[i+1]) i++;
      const h=X[i+1]-X[i], t=(x-X[i])/h, t2=t*t, t3=t2*t;
      return (2*t3-3*t2+1)*Y[i]+(t3-2*t2+t)*h*m[i]+(-2*t3+3*t2)*Y[i+1]+(t3-t2)*h*m[i+1];
    };
  }

  /* ---- saucer: an ellipse in plan (fore 187, aft 191, side 239 m about x 455), cut soft at
     x 269; the upper dome is one profile, the lower one differs fore, aft and abeam ---- */
  const SC={ x:455, f:187, a:191, s:239, cut:269 };
  const UP=mono([[0,135.2],[.1,135.1],[.2,134.7],[.3,134],[.4,132.7],[.5,130.5],[.6,127.6],[.7,124.3],
                 [.8,120.2],[.9,115.3],[.95,112.4],[.993,109.8]]);
  const lift=P=>P.map(p=>[p[0], p[1]+(p[0]<0.75 ? 1.4*(1-p[0]/0.75) : 0)]);
  const LF=mono(lift([[0,82.6],[.14,83.6],[.25,85.2],[.36,87.8],[.465,91.2],[.57,95.5],[.68,100.6],[.75,102.3],[.85,103.2],[.993,104.0]]));
  const LA=mono(lift([[0,82.6],[.18,83.4],[.28,85.1],[.39,87.4],[.49,88.8],[.6,92.5],[.7,98],[.78,101.5],[.86,102.6],[.993,102.8]]));
  const LL=mono(lift([[0,82.6],[.2,82.4],[.3,83.4],[.4,85.4],[.5,88.1],[.6,92.3],[.667,96],[.733,99.9],[.8,102.5],[.9,102.8],[.993,102.8]]));
  function sau(r, th, up){
    const c=Math.cos(th), s=Math.sin(th);
    let x=SC.x+r*(c>=0?SC.f:SC.a)*c; const z=r*SC.s*s;
    x=SC.cut+3*Math.log(1+Math.exp((x-SC.cut)/3));
    // the notches on the aft rim that hold the saucer impulse engines
    const az=Math.abs(z), k=(az-100)/8, q=(146-az)/8;
    if(c<0 && k>0 && q>0){ const wgt=Math.min(1,k)*Math.min(1,q), sw=wgt*wgt*(3-2*wgt);
      x+=sw*(296+1.5*Math.log(1+Math.exp((x-296)/1.5))-x); }
    const y=up ? UP(r) : (c>0?c*c:0)*LF(r)+(c<0?c*c:0)*LA(r)+s*s*LL(r);
    return [x,y,z];
  }

  /* ---- nacelle (starboard; the build mirrors it): a sweep along x about y 70, z 127.8; the last
     stations are the cowl lip round the back of the bussard ---- */
  const NZ=127.8, NY=70;
  const NAC=[
    {x:0,w:0,t:0,b:0,r:3},{x:1.2,w:9,t:5.5,b:5.8,r:3},{x:4,w:16,t:9.6,b:10.2,r:3},{x:9,w:22,t:12.8,b:13.4,r:3},
    {x:17,w:25,t:14.4,b:15.2,r:3},{x:28,w:25.9,t:15.4,b:15.6,r:6},{x:80,w:25.4,t:15.9,b:15.6,r:6},{x:140,w:23.35,t:15.5,b:15.4,r:5},
    {x:180,w:21.1,t:14.1,b:15,r:3},{x:196,w:20.9,t:12.9,b:14.5,r:2},{x:200,w:20.4,t:12.3,b:13.8,r:3},{x:211,w:19.5,t:12,b:13.4,r:2},
    {x:217,w:19.1,t:11.7,b:12.6,r:2},{x:222,w:18.7,t:11.2,b:12,r:1},{x:223.5,w:18.4,t:10.8,b:11.5,r:2},{x:226,w:17.6,t:10.3,b:10.8,r:2},
    {x:230,w:16.7,t:9.4,b:9.7}];
  const NAC_N={nt:4.2, nb:3.0};
  // the sweep's own station smoothing, so details can sit on a skin
  function cr(a,b,c,d,t){ const t2=t*t, t3=t2*t; return 0.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3); }
  function dense(st, res, F){
    F=F||["x","w","t","b"]; const out=[];
    for(let i=0;i<st.length-1;i++){
      const a=st[Math.max(0,i-1)], b=st[i], c=st[i+1], d=st[Math.min(st.length-1,i+2)];
      const r=b.r||res;
      for(let k=0;k<r;k++){ const s={}; F.forEach(f=>{ s[f]=Math.max(0,cr(a[f],b[f],c[f],d[f],k/r)); }); out.push(s); }
    }
    out.push(Object.assign({}, st[st.length-1]));
    return out;
  }
  // a dense station list sampled at path coordinate v along key k (linear between stations)
  function at(D, k, v){
    for(let i=0;i<D.length-1;i++) if(v<=D[i+1][k]){
      const a=D[i], b=D[i+1], f=(v-a[k])/((b[k]-a[k])||1), o={};
      for(const q in a) o[q]=a[q]+(b[q]-a[q])*f;
      return o;
    }
    return D[D.length-1];
  }
  const ND=dense(NAC, 6), nsec=x=>at(ND,"x",x);
  // point on the nacelle skin at x, ring angle a (0 = outboard, pi/2 = top), lifted off by d
  function npt(x, a, d){
    const s=nsec(x), up=Math.sin(a)>=0, e=2/(up?NAC_N.nt:NAC_N.nb);
    const X=spow(Math.cos(a),e)*s.w, Y=spow(Math.sin(a),e)*(up?s.t:s.b);
    const p=[x, NY+Y, NZ+X];
    if(!d) return p;
    const q=npt(x, a+0.01, 0), r=npt(x+0.5, a, 0);
    const u=[q[0]-p[0],q[1]-p[1],q[2]-p[2]], v=[r[0]-p[0],r[1]-p[1],r[2]-p[2]];
    let n=[u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const l=Math.hypot(n[0],n[1],n[2])||1; n=n.map(c=>c/l);
    if(n[1]*Y+n[2]*X<0) n=n.map(c=>-c);
    return [p[0]+n[0]*d, p[1]+n[1]*d, p[2]+n[2]*d];
  }

  /* ---- dorsal neck stations, bottom to top: [y, aft edge x, fore edge x, half beam] ---- */
  const NECK=[[28,240,305,50],[34,236,311,51],[40,228,316.5,48],[46,214,320,40],[53,195,323.5,25],[60,198,327,21.5],
              [67,205,330.5,21],[74,214,334,23],[81,223,339.5,29],[87,231,346,40],[94,240,354,55],[104,250,362,68],
              [108,256,366,64],[111,261,368,56],[113.5,268,368,42],[115.6,276,368,26],[116.8,284,368,13],[117.3,291,366,4],[117.4,294,364,0]]
    .map(q=>({ y:q[0], w:q[3], t:280-q[1], b:q[2]-280 }));
  const KD=dense(NECK, 3, ["y","w","t","b"]);
  // a point on the neck's aft face at height y, abeam z, lifted d meters aft
  const kpt=(y,z,d)=>{ const s=at(KD,"y",y); return [280-s.t*Math.pow(Math.max(0,1-Math.pow(Math.abs(z)/s.w,2.4)),1/2.4)-d, y, z]; };
  // is p inside the neck, with m meters to spare
  const inNeck=(p,m)=>{ if(p[1]<28||p[1]>117.4) return false; const s=at(KD,"y",p[1]), dx=p[0]-280, e=dx<0?2.4:2.2;
    return Math.pow(Math.abs(dx)/((dx<0?s.t:s.b)+m),e)+Math.pow(Math.abs(p[2])/(s.w+m),e)<1; };

  /* ---- secondary hull's upper body: [x, half beam, height above y 25, depth below] ---- */
  const BODY=[[55,0,0,0],[62,10,10,4],[80,28,14,5],[110,47,18,5.5],[140,60,21.5,5.5],[160,64,24,13],[180,68.5,26,13],
    [205,72.5,27,13],[235,74.3,27.5,13],[255,73.8,28,13],[275,70,28.5,13],[290,63,29,13],[298,54,27,7],[302,40,22,3],[303.5,0,0,0]]
    .map(q=>({ x:q[0], y:25, w:q[1], t:q[2], b:q[3], nt:q[0]<130?1.8:q[0]<165?1.4:1.25, nb:q[0]>=160&&q[0]<=290?1.6:2 }));
  const BD=dense(BODY, 5, ["x","w","t","nt"]);
  // the upper body's flank at x, height y (starboard)
  const bpt=(x,y)=>{ const s=at(BD,"x",x), h=Math.min(0.999,Math.max(0,(y-25)/s.t)); return [x, y, s.w*Math.pow(1-Math.pow(h,s.nt),1/s.nt)]; };

  // the deflector dish: center, outward normal (forward and down), half sizes; the dish face
  // rises k = dk(rho) along the normal (rho 1 at the rim, 0 at the crown); dp(u,z,d) is a point
  // on the face at u up and z abeam, lifted d
  const DF={ c:[304.5,24.5,0], n:[Math.cos(0.72),-Math.sin(0.72),0], w:37, h:15.8 };
  const dpt=(k,u,z)=>[DF.c[0]+DF.n[0]*k-DF.n[1]*u, DF.c[1]+DF.n[1]*k+DF.n[0]*u, z||0];
  const DSH=[{x:0.1,w:1},{x:0.9,w:0.8},{x:1.3,w:0}], DK=dense(DSH,4,["x","w"]);
  const dk=r=>{ for(let i=0;i<DK.length-1;i++){ const a=DK[i], b=DK[i+1];
    if(r>=b.w) return a.x+(b.x-a.x)*Math.min(1,(a.w-r)/((a.w-b.w)||1)); } return 1.3; };
  const dp=(u,z,d)=>dpt(dk(Math.hypot(u/DF.h,z/DF.w))+d, u, z);
  // the saucer's dome height over a plan point
  const domeAt=(x,z)=>UP(Math.hypot((x-SC.x)/(x>SC.x?SC.f:SC.a), z/SC.s));

  return {
    name:"U.S.S. ENTERPRISE", reg:"NCC-1701-D", cls:"GALAXY CLASS",
    len:642.51, beam:463.73, height:195.26,
    hull:[0.62,0.66,0.70], defl:[1.0,0.55,0.18], deck:3.6,
    callouts:[
      { text:"MAIN BRIDGE", at:[433.5,141.4,0] },
      { text:"SAUCER SECTION", at:sau(0.62,0.6,true) },
      { text:"MAIN SHUTTLEBAY", at:[343.5,domeAt(343.5,0)+1.1,0] },
      { text:"MAIN DEFLECTOR", at:dp(-10,0,0) },
      { text:"IMPULSE ENGINE", at:[194.3,61,0] },
      { text:"WARP NACELLE", at:npt(110,Math.PI/2,0) },
      { text:"BUSSARD COLLECTOR", at:[252.6,NY+0.5,NZ] }],
    build(G){
      const M=G.mesh(), MAT=G.MATS;
      const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
      const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
      /* a grid of points P[i][j] as a sheet; out(p) gives an outward hint for the winding;
         wc[i][j] window coordinates (optional) */
      function sheet(P, o){
        const mat=MAT[o.mat||"hull"], win=o.win?1:0, nj=P[0].length;
        (o.mirror?[1,-1]:[1]).forEach(mz=>{
          const b0=M.p.length/3;
          P.forEach((row,i)=>row.forEach((p,j)=>{ M.p.push(p[0],p[1],p[2]*mz); M.m.push(mat); M.w.push(win); M.c.push(o.wc?o.wc[i][j]:0); }));
          // winding from the first cell with some area
          let flip=false;
          for(let i=0;i<P.length-1;i++){ let done=false;
            for(let j=0;j<nj-1;j++){
              const a=P[i][j], b=P[i][j+1], c=P[i+1][j], f=cross(sub(b,a),sub(c,a));
              if(Math.hypot(f[0],f[1],f[2])<1e-6) continue;
              flip=dot(f, o.out(a))<0; done=true; break;
            }
            if(done) break;
          }
          if(mz<0) flip=!flip;
          for(let i=0;i<P.length-1;i++) for(let j=0;j<nj-1;j++){
            const a=b0+i*nj+j, b=a+1, c=a+nj, d=c+1;
            if(!flip) M.i.push(a,b,c, b,d,c); else M.i.push(a,c,b, b,c,d);
          }
        });
      }

      // ---- saucer: top dome, rim band, lower dome (separate sheets: hard creases at the rim) ----
      const NS=168, rr=t=>0.993*(0.5*t+0.5*(1-(1-t)*(1-t)));
      const ring=f=>{ const R=[]; for(let j=0;j<=NS;j++) R.push(f(j/NS*Math.PI*2)); return R; };
      const arc=P=>P.map(row=>{ let u=0; return row.map((p,j)=>{ if(j) u+=Math.hypot(p[0]-row[j-1][0],p[2]-row[j-1][2]); return u; }); });
      const out=p=>[p[0]-SC.x, p[1]-106, p[2]];
      const top=[], bot=[], rim=[];
      for(let i=0;i<=38;i++) top.push(ring(th=>sau(rr(i/38),th,true)));
      for(let i=38;i>=0;i--) bot.push(ring(th=>sau(rr(i/38),th,false)));
      const edge=(th,up,dy,k)=>{ const p=sau(0.993,th,up), q=sau(1,th,true); return [q[0]+(p[0]-q[0])*k, p[1]+dy, q[2]+(p[2]-q[2])*k]; };
      rim.push(top[top.length-1], ring(th=>edge(th,true,-0.6,0.3)), ring(th=>edge(th,true,-1.5,0)),
               ring(th=>edge(th,false,1.5,0)), ring(th=>edge(th,false,0.6,0.3)), bot[0]);
      sheet(top,{ out });
      sheet(rim,{ out, win:1, wc:arc(rim) });
      sheet(bot,{ out });
      // phaser arrays: a band round the dorsal dome (open aft) and one round the ventral dome
      const band=(r0,r1,a0,a1,up,n)=>{ const P=[];
        [r0,r1].forEach(r=>{ const R=[]; for(let j=0;j<=n;j++){ const p=sau(r,a0+(a1-a0)*j/n,up); p[1]+=up?0.18:-0.18; R.push(p); } P.push(R); });
        sheet(P,{ mat:"dark", out:p=>[0,up?1:-1,0] }); };
      band(0.768,0.782,-2.72,2.72,true,140);
      band(0.585,0.597,-2.55,2.55,false,120);

      // ---- secondary hull: the upper body (widest at y 25) and one lens-shaped keel under it ----
      G.sweep(M,{ win:1, seg:56, res:5, st:BODY });
      G.sweep(M,{ win:1, seg:56, res:5, st:[
        [132,0,0],[140,28,3.5],[150,44,6.5],[160,52,12],[170,59,19],[180,64,20.5],[220,64,20.5],[245,63,17.4],
        [265,60,15.1],[285,52,12],[296,40,6.5],[301,0,0]]
        .map(q=>({ x:q[0], y:22, w:q[1], t:Math.min(q[1],6), b:q[2], nt:2, nb:1.4 })) });
      // the aft hull between the pylons: a thin plate continuing the pylons, a little fuller amidships
      G.sweep(M,{ seg:40, st:[
        {x:37.5,y:23.5,w:0,t:0,b:0},
        {x:38,y:23.5,w:40,t:3.4,b:3.4,n:3},
        {x:41,y:23.5,w:55,t:4.2,b:3.8,n:3},
        {x:60,y:23.5,w:60,t:5.5,b:4,n:2.6},
        {x:100,y:23.5,w:62,t:6.5,b:4.2,n:2.6},
        {x:120,y:23.5,w:55,t:6,b:4,n:2.6},
        {x:130,y:23.5,w:30,t:4,b:3,n:2.4},
        {x:133,y:23.5,w:0,t:0,b:0}] });
      // dorsal neck: a vertical sweep about x 280 (t reaches aft, b forward, w abeam)
      G.sweep(M,{ win:1, wa:"v", seg:56, res:3, st:NECK.map(s=>Object.assign({ x:280, z:0, nt:2.4, nb:2.2 },s)) });

      // ---- pylons: out from the hull, then up to the nacelles (U seen from the bow). The chord
      // stays along x everywhere, so the edges never tilt: [z, y, leading x, trailing x, half thickness] ----
      {
        const PD=dense([[30,23.5,133,37.5,3.4],[57,23.3,133,33.6,3.3],[66,23.3,122.4,32.1,3.3],[80,23.3,114.3,30.8,3.2],
          [93,23.8,110.6,29.8,3.2],[101,24.5,110,29.5,3.2],[114.8,28.5,111,32.5,3.2],[122.3,35,111.5,36.4,3.2],
          [125.8,43,113,41.5,3.2],[126.5,48,118.5,45,3.6],[126.8,52,127.5,43,6],[127,56.5,140,40,9.5]]
          .map(q=>({ z:q[0], y:q[1], le:q[2], te:q[3], t:q[4] })), 5, ["z","y","le","te","t"]);
        const R=PD.map((s,i)=>{
          const a=PD[Math.max(0,i-1)], c=PD[Math.min(PD.length-1,i+1)], l=Math.hypot(c.y-a.y,c.z-a.z)||1;
          const ny=(c.z-a.z)/l, nz=-(c.y-a.y)/l, xc=(s.le+s.te)/2, hw=(s.le-s.te)/2, cen=[xc,s.y,s.z], row=[];
          for(let j=0;j<=28;j++){ const g=Math.PI*(1+j/14), X=Math.cos(g)*hw, Y=Math.sin(g)*s.t, p=[xc+X, s.y+ny*Y, s.z+nz*Y];
            p.c=cen; row.push(p); }
          return row; });
        const cap=r=>r.map(p=>{ const q=p.c.slice(); q.c=p.c; return q; });
        sheet([cap(R[0])].concat(R,[cap(R[R.length-1])]),{ mirror:true, out:p=>sub(p,p.c) });
      }

      // ---- nacelles ----
      G.sweep(M,{ mirror:true, seg:48, res:6, st:NAC.map(s=>Object.assign({y:NY,z:NZ},NAC_N,s)) });
      const BUS=[{x:213,w:15,t:7.0},{x:224,w:16.2,t:7.6},{x:236,w:15.6,t:7.4},{x:244,w:12.8,t:6.4},
        {x:249.5,w:8.6,t:4.4},{x:252,w:2.8,t:1.5},{x:252.6,w:0,t:0}];
      G.sweep(M,{ mirror:true, mat:"bussard", seg:40, res:3, st:BUS.map(s=>Object.assign({y:NY+0.5,z:NZ,n:2.6,b:s.t},s)) });
      // the cowl lip runs forward over the bussard's top (aft at the keel, x 231, fore at the crown, x 239.5);
      // a gray shell from the cowl's front face to the lip, then a maroon collar ring
      {
        const BSD=dense(BUS, 3, ["x","w","t"]), e=2/2.6, xl=a=>231+8.5*Math.pow((1+Math.sin(a))/2,2);
        const bp=(x,a,d)=>{ const q=at(BSD,"x",x); return [x, NY+0.5+spow(Math.sin(a),e)*(q.t+d), NZ+spow(Math.cos(a),e)*(q.w+d)]; };
        const shell=[], collar=[], J=48, out=p=>[0,p[1]-NY-0.5,p[2]-NZ];
        for(let i=0;i<=5;i++){ const f=i/5, g=1-(1-f)*(1-f), R=[];
          for(let j=0;j<=J;j++){ const a=j/J*2*Math.PI, c=npt(230,a,0), x=230+f*(xl(a)-230), b=bp(x,a,0.65);
            R.push([x, c[1]+(b[1]-c[1])*g, c[2]+(b[2]-c[2])*g]); }
          shell.push(R); }
        [[0,0.65],[0.3,0.95],[1.3,0.95],[1.6,0.1]].forEach(([dx,d])=>{ const R=[];
          for(let j=0;j<=J;j++){ const a=j/J*2*Math.PI; R.push(bp(xl(a)+dx,a,d)); } collar.push(R); });
        sheet(shell,{ mirror:true, out });
        sheet(collar,{ mat:"trim", mirror:true, out });
      }
      // a raised hood on the cowl's top, out over the bussard, with three dark vents across it
      // [x, top above NY, half beam, path y above NY]
      const HOOD=[[212,13.0,15,10.4],[218,12.9,15.5,9.8],[224,12.4,15.5,9.5],[230,10.8,14.5,6.5],[235,9.8,13,5.4],[239,9.0,10,5.0],[241,8.2,0,6]]
        .map(q=>({ x:q[0], y:NY+q[3], z:NZ, w:q[2], t:q[1]-q[3], b:2, nt:4, nb:2 }));
      G.sweep(M,{ mirror:true, seg:32, res:3, st:HOOD });
      const HD=dense(HOOD, 3, ["x","y","t"]), hoodTop=x=>{ const q=at(HD,"x",x); return q.y+q.t; };
      [221.7,225.6,229.4].forEach(x=>{
        G.sweep(M,{ mat:"dark", mirror:true, seg:16, st:[x-1.1,x+1.1].map(xx=>({ x:xx, y:hoodTop(xx)+0.1, z:NZ, w:6, t:0.22, b:0.22, n:6 })) }); });
      // the copper field coils between the grilles and the bussard
      for(let i=0;i<4;i++){
        const x0=199.8+i*2.75, a=nsec(x0), b=nsec(x0+1.7);
        G.sweep(M,{ mirror:true, mat:"trim", seg:48, st:[a,b].map((q,k)=>Object.assign({ x:x0+k*1.7, y:NY, z:NZ, w:q.w+0.35, t:q.t+0.35, b:q.b+0.35 }, NAC_N)) });
      }
      // two red lines along each nacelle's top
      [-3.2,3.2].forEach(z0=>{
        const P=[];
        for(let i=0;i<=12;i++){ const x=96+i/12*96, sw=nsec(x).w, row=[];
          [z0-0.55,z0+0.55].forEach(z=>{ const c=Math.pow(Math.abs(z)/sw,NAC_N.nt/2)*Math.sign(z); row.push(npt(x,Math.acos(c),0.15)); });
          P.push(row); }
        sheet(P,{ mat:"trim", mirror:true, out:p=>[0,1,0] });
      });
      // warp field grilles: lifted strips on the outboard and inboard flanks, flaring at the front
      [0, Math.PI].forEach(a0=>{
        const P=[], nx=60;
        for(let i=0;i<=nx;i++){
          const x=4+i/nx*191, h=3.2+7.8*Math.pow(Math.max(0,(x-160)/35),1.6);
          const s=nsec(x), row=[];
          for(let j=0;j<=16;j++){
            const v=-1+2*j/16, up=v>=0, tt=up?s.t:s.b, nn=up?NAC_N.nt:NAC_N.nb;
            const q=Math.min(0.97,Math.abs(v)*h/tt), a=Math.sign(v)*Math.asin(Math.pow(q,nn/2));
            row.push(npt(x, a0===0 ? a : Math.PI-a, 0.4));
          }
          P.push(row);
        }
        sheet(P,{ mat:"grille", mirror:true, out:p=>[0,0,a0===0?1:-1] });
      });

      // ---- deflector: a housing set into the hull front, the dish on its face ----
      const D=DF.n, dsw=(k,o)=>Object.assign({ x:DF.c[0]+D[0]*k, y:DF.c[1]+D[1]*k, z:0 }, o);
      G.sweep(M,{ side:[0,0,1], seg:48, st:[
        dsw(-14,{w:46,t:25,b:25}), dsw(-6,{w:43.5,t:21,b:21}), dsw(0,{w:41,t:18.6,b:18.6})] });
      G.sweep(M,{ mat:"deflector", side:[0,0,1], seg:64, st:DSH.map(s=>dsw(s.x,{w:DF.w*s.w,t:DF.h*s.w,b:DF.h*s.w})) });
      // a ribbed rim round the dish, a bright rounded ring round the hub, a small dark hub
      const dring=(r0,r1,n,W0,H0,W1,H1,e,d)=>{ const P=[];
        for(let i=0;i<=n;i++){ const f=i/n, W=W0+(W1-W0)*f, H=H0+(H1-H0)*f, R=[];
          for(let j=0;j<=r1;j++){ const g=r0+j/r1*2*Math.PI; R.push(dp(spow(Math.sin(g),2/e)*H, spow(Math.cos(g),2/e)*W, d)); }
          P.push(R); }
        return P; };
      sheet(dring(0,96,2,DF.w*0.86,DF.h*0.86,DF.w,DF.h,2,0.2),{ out:()=>DF.n });
      for(let k=0;k<28;k++){ const g=(k+0.5)/28*2*Math.PI, P=[];
        [0.86,0.93,1].forEach(r=>{ const z=Math.cos(g)*DF.w*r, u=Math.sin(g)*DF.h*r, tl=Math.hypot(Math.sin(g)*DF.w,Math.cos(g)*DF.h);
          const dz=-Math.sin(g)*DF.w/tl*0.5, du=Math.cos(g)*DF.h/tl*0.5;
          P.push([dp(u-du,z-dz,0.35), dp(u+du,z+dz,0.35)]); });
        sheet(P,{ mat:"hull2", out:()=>DF.n });
      }
      sheet(dring(0,48,1,14.3,7.4,10.8,4.6,3.2,0.3),{ mat:"lamp", out:()=>DF.n });
      G.sweep(M,{ mat:"dark", side:[0,0,1], seg:24, st:[dsw(1.25,{w:4.2,t:1.9,b:1.9}), dsw(1.45,{w:3.6,t:1.6,b:1.6}), dsw(1.6,{w:0,t:0,b:0})] });

      // ---- dorsal superstructure: a low deck from the main shuttlebay forward to the bridge ----
      const dome=x=>UP(Math.abs(x-SC.x)/(x>SC.x?SC.f:SC.a));
      // [x, half beam, top above the dome]: a straight-sided plate from the main shuttlebay, then a broad
      // crescent round the bridge whose horns end in the RCS pods
      const DECK=[[338,39,0.4],[346,39,1.0],[356,37.5,1.3],[380,36,1.3],[405,35.5,1.4],[420,45,1.8],
        [440,54.5,3.3],[452,56,3.6],[462,55,2.7],[472,51,1.4],[482,42,1.5],[490,27,1.4],[495,12,1.0],[497.5,0,0]]
        .map(q=>({ x:q[0], y:dome(q[0])-1.5, w:q[1], t:q[2]+1.5, b:1.5, nt:5, nb:2 }));
      G.sweep(M,{ seg:48, res:4, st:DECK });
      // the top of the deck (or of the saucer where there is no deck) over a plan point
      const DKD=dense(DECK, 4, ["x","y","w","t"]);
      const deckAt=(x,z)=>{ const s=at(DKD,"x",x), a=Math.abs(z)/(s.w||1e-6);
        return Math.max(domeAt(x,z), a<1 ? s.y+s.t*Math.pow(1-Math.pow(a,5),0.2) : 0); };
      // the RCS pods at the crescent's tips (a sweep out along z), each with a red thruster mark
      const pod=[[44,0,0],[46,7.5,138.5],[50,9,138.7],[55,8.6,138.6],[61,6.2,138],[67,3.6,137],[71,1.4,136],[72.5,0,135.6]];
      G.sweep(M,{ mirror:true, side:[-1,0,0], seg:28, res:3, st:pod.map(q=>{ const y=domeAt(452,q[0])-1;
        return { x:452, y:y, z:q[0], w:q[1], t:q[1]?q[2]-y:0, b:q[1]?1:0, nt:2.6, nb:2 }; }) });
      const podTop=mono(pod.slice(1,-1).map(q=>[q[0],q[2]]));
      G.sweep(M,{ mat:"trim", mirror:true, side:[-1,0,0], seg:16, st:[57.5,60].map(z=>({ x:451, y:podTop(z)+0.05, z:z, w:1.6, t:0.3, b:0.3, n:4 })) });
      // main shuttlebay door, on the ramp at the deck's aft end
      G.sweep(M,{ mat:"dark", seg:16, st:[{x:337,y:dome(337)+0.4,w:35,t:0.3,b:0.3,n:6},{x:350,y:dome(350)+1.2,w:35,t:0.3,b:0.3,n:6}] });
      // bridge module; the observation lounge is its aft end (windows placed with the panes below)
      const BRM=[{x:422,w:0,t:0,b:0},{x:423,w:9,t:2},{x:426.5,w:12.5,t:3.9},{x:433.5,w:14,t:4.3},
        {x:441,w:12.5,t:3.8},{x:447,w:8,t:2.2},{x:449,w:0,t:0}].map(s=>Object.assign({ y:137.1, b:1, nt:2.6, nb:2 },s));
      G.sweep(M,{ seg:48, res:4, st:BRM });
      // Ten Forward: the big windows across the bow, on the rim
      for(let k=-9;k<=9;k++){
        const t0=(k*2.3-0.8)*Math.PI/180, t1=(k*2.3+0.8)*Math.PI/180, P=[];
        [105.6,107.6].forEach(y=>{ P.push([t0,t1].map(th=>{ const q=sau(1,th,true), n=[Math.cos(th)/SC.f, 0, Math.sin(th)/SC.s], l=Math.hypot(n[0],n[2]);
          return [q[0]+n[0]/l*0.22, y, q[2]+n[2]/l*0.22]; })); });
        sheet(P,{ mat:"lamp", out:p=>[p[0]-SC.x,0,p[2]] });
      }
      // captain's yacht, under the saucer
      G.sweep(M,{ seg:32, st:[{x:436,w:0,t:0,b:0},{x:438,w:8,b:1.2},{x:446,w:13,b:2},{x:462,w:13,b:2},{x:470,w:8,b:1.2},{x:472,w:0,b:0}]
        .map(s=>Object.assign({ y:84.2, t:1, n:2.4 },s)) });
      // shuttlebays 2 and 3, on the aft slope of the neck
      const bay=[]; for(let i=0;i<=4;i++){ const y=95.5+i*2.1, row=[]; for(let j=0;j<=4;j++) row.push(kpt(y,17.5+j*3,0.35)); bay.push(row); }
      sheet(bay,{ mat:"dark", mirror:true, out:p=>[-1,0.9,0] });
      // torpedo launchers: aft, in the tail between the pylons, and forward, at the foot of the neck
      G.sweep(M,{ mat:"dark", seg:16, st:[{x:37.2,y:23.6,w:7,t:1.3,b:1.3,n:5},{x:37.9,y:23.6,w:7,t:1.3,b:1.3,n:5}] });
      G.sweep(M,{ mat:"dark", seg:16, st:[{x:321.4,y:49.6,w:6.5,t:1.2,b:1.2,n:5},{x:322.5,y:49.6,w:6.5,t:1.2,b:1.2,n:5}] });
      // main impulse engine, at the foot of the neck's aft slope
      G.sweep(M,{ seg:24, st:[{x:195,y:57,w:14,t:9.6,b:10,nt:4,nb:8},{x:210,y:57.5,w:14,t:9.8,b:10,nt:4,nb:8},{x:222,y:60,w:7,t:5,b:8,nt:3,nb:4}] });
      G.sweep(M,{ mat:"impulse", seg:24, st:[{x:194.3,y:61,w:12.6,t:4.2,b:4.2,n:4},{x:194.8,y:61,w:12.6,t:4.2,b:4.2,n:4}] });
      // saucer impulse engines, on the aft rim either side of the neck
      G.sweep(M,{ mat:"impulse", mirror:true, seg:24, st:[{x:295.6,y:106.3,z:123.5,w:14.5,t:2.9,b:2.9,n:5},{x:297,y:106.3,z:123.5,w:14.5,t:2.9,b:2.9,n:5}] });

      // ---- lit window panes on the faces too flat for the renderer's window rows ----
      const nrm=a=>{ const l=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l]; };
      let seed=7; const rnd=()=>(seed=seed*16807%2147483647)/2147483647;
      // a pane at p, its long side along u, lifted d along the normal n
      const pane=(p,u,n,L,H,d,mat)=>{
        u=nrm(sub(u,n.map(c=>c*dot(u,n)))); const v=cross(n,u), b0=M.p.length/3;
        [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([a,b])=>{
          for(let k=0;k<3;k++) M.p.push(p[k]+n[k]*d+u[k]*a*L/2+v[k]*b*H/2);
          M.m.push(mat===undefined?MAT.lamp:mat); M.w.push(0); M.c.push(0); });
        M.i.push(b0,b0+1,b0+2, b0,b0+2,b0+3); };
      const nearImpulse=(th,z)=>Math.cos(th)<0 && Math.abs(z)>92 && Math.abs(z)<154;
      // concentric rows over the saucer's outer annulus, top and bottom
      [[0.86,1],[0.91,1],[0.955,1],[0.90,0],[0.95,0]].forEach(([r,up])=>{
        for(let k=0;k<150;k++){
          if(rnd()<0.4) continue;
          const th=(k+0.5)/150*2*Math.PI, p=sau(r,th,!!up);
          if(nearImpulse(th,p[2]) || (!up && inNeck(p,3))) continue;
          const dt=sub(sau(r,th+0.003,!!up),p); let n=nrm(cross(dt,sub(sau(r+0.003,th,!!up),p)));
          if((n[1]>0)!==!!up) n=n.map(c=>-c);
          pane(p,dt,n,2.2,0.9,0.2);
        }
      });
      // the dark slots ringing the bridge (an oval of x 409-469, z +/-26), radial, on the deck
      const slope=(f,x,z)=>{ const e=0.3; return nrm([-(f(x+e,z)-f(x-e,z))/(2*e), 1, -(f(x,z+e)-f(x,z-e))/(2*e)]); };
      for(let k=0;k<44;k++){ const g=(k+0.5)/44*2*Math.PI, x=439+30*Math.cos(g), z=26*Math.sin(g);
        pane([x,deckAt(x,z),z], [Math.cos(g)/30,0,Math.sin(g)/26], slope(deckAt,x,z), 2.2, 0.8, 0.15, MAT.dark); }
      // observation lounge windows across the bridge module's aft face
      {
        const BD2=dense(BRM, 4, ["x","w","t"]), bh=(x,z)=>{ const s=at(BD2,"x",x), a=Math.abs(z)/(s.w||1e-6);
          return a<1 ? 137.1+s.t*Math.pow(1-Math.pow(a,2.6),1/2.6) : 136; };
        for(let z=-4.8;z<=4.9;z+=2.4){ let lo=422, hi=430;
          for(let i=0;i<24;i++){ const m=(lo+hi)/2; if(bh(m,z)<138.5) lo=m; else hi=m; }
          pane([lo,138.5,z], [0,0,1], slope(bh,lo,z), 1.8, 0.7, 0.12); }
      }
      // deck rows along the secondary hull's upper flanks
      [28.6,32.2,35.8,39.4].forEach(y=>{
        for(let x=141;x<=290;x+=4.2){
          if(rnd()<0.4) continue;
          const p=bpt(x,y);
          if(inNeck(p,2)) continue;
          let n=nrm(cross(sub(bpt(x+0.5,y),p),sub(bpt(x,y+0.3),p)));
          if(n[2]<0) n=n.map(c=>-c);
          [1,-1].forEach(m=>pane([p[0],p[1],p[2]*m],[1,0,0],[n[0],n[1],n[2]*m],2.2,0.9,0.2));
        }
      });

      return M;
    }
  };
})();
