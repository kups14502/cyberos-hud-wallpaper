/* USS Enterprise NCC-1701-D, Galaxy class. Nacelle tails at x 0, saucer bow at x 642.5,
   keel at y 1.5, bridge at y 141.4. Fitted to ref/galaxy.jpg (side), galaxy-top.jpg, galaxy-front.jpg;
   escape pods, registry and paint read off galaxy-top.jpg and the studio model photos (galaxy-extra-*). */
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
  function sau(r, th, up, y0){ return sauCS(r, Math.cos(th), Math.sin(th), up, y0); }
  // the same from the angle's cosine and sine; y0 skips the profile lookups when the caller has them
  function sauCS(r, c, s, up, y0){
    let x=SC.x+r*(c>=0?SC.f:SC.a)*c; const z=r*SC.s*s;
    if(x-SC.cut<60) x=SC.cut+3*Math.log(1+Math.exp((x-SC.cut)/3));
    // the notches on the aft rim that hold the saucer impulse engines
    const az=Math.abs(z), k=(az-100)/8, q=(146-az)/8;
    if(c<0 && k>0 && q>0){ const wgt=Math.min(1,k)*Math.min(1,q), sw=wgt*wgt*(3-2*wgt);
      x+=sw*(296+1.5*Math.log(1+Math.exp((x-296)/1.5))-x); }
    const y=up ? (y0?y0[0]:UP(r)) : y0 ? (c>0?c*c:0)*y0[0]+(c<0?c*c:0)*y0[1]+s*s*y0[2] : (c>0?c*c:0)*LF(r)+(c<0?c*c:0)*LA(r)+s*s*LL(r);
    return [x,y,z];
  }

  /* ---- nacelle (starboard; the build mirrors it): a sweep along x about y 70, z 127.8, ending
     at the cowl round the back of the bussard ---- */
  const NZ=127.8, NY=70;
  const NAC=[
    {x:0,w:0,t:0,b:0,r:3},{x:1.2,w:9,t:5.5,b:5.8,r:3},{x:4,w:16,t:9.6,b:10.2,r:3},{x:9,w:22,t:12.8,b:13.4,r:3},
    {x:17,w:25,t:14.4,b:15.2,r:3},{x:28,w:25.9,t:15.4,b:15.6,r:3},{x:80,w:25.4,t:15.9,b:15.6,r:3},{x:140,w:23.35,t:15.5,b:15.4,r:3},
    {x:180,w:21.1,t:14.1,b:15,r:3},{x:196,w:20.9,t:12.9,b:14.5,r:2},{x:200,w:20.4,t:12.3,b:13.8,r:3},{x:211,w:19.5,t:12,b:13.4,r:2},
    {x:217,w:19.1,t:11.7,b:12.6}];
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
    const K=D.fk||(D.fk=Object.keys(D[0]));
    for(let i=0;i<D.length-1;i++) if(v<=D[i+1][k]){
      const a=D[i], b=D[i+1], f=(v-a[k])/((b[k]-a[k])||1), o={};
      for(let j=0;j<K.length;j++){ const q=K[j]; o[q]=a[q]+(b[q]-a[q])*f; }
      return o;
    }
    return D[D.length-1];
  }
  // a two-slot cache: the grilles ask for the same few stations over and over
  const ND=dense(NAC, 6), NC=[[NaN,null],[NaN,null]];
  const nsec=x=>{ if(NC[0][0]===x) return NC[0][1]; if(NC[1][0]===x) return NC[1][1]; NC.unshift([x,at(ND,"x",x)]); NC.pop(); return NC[0][1]; };
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
  const BD=dense(BODY, 4, ["x","w","t","nt"]);
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
    hull:[0.62,0.66,0.70], defl:[1.0,0.3,0.05], deck:3.6,
    callouts:[
      { text:"MAIN BRIDGE", at:[433.5,141.4,0] },
      { text:"SAUCER SECTION", at:sau(0.62,0.6,true) },
      { text:"MAIN SHUTTLEBAY", at:[346.5,domeAt(347.5,0)-1.2,0] },
      { text:"MAIN DEFLECTOR", at:dp(-10,0,0) },
      { text:"IMPULSE ENGINE", at:[194.3,61,0] },
      { text:"WARP NACELLE", at:npt(110,Math.PI/2,0) },
      { text:"BUSSARD COLLECTOR", at:[252.6,NY+0.5,NZ] }],
    build(G){
      const M=G.mesh(), MAT=G.MATS;
      const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
      const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
      /* a grid of points P[i][j] as a sheet; out(p) gives an outward hint for the winding;
         wc[i][j] window coordinates and skip(i,j) cells left open (both optional) */
      function sheet(P, o){
        const mat=MAT[o.mat||"hull"], win=o.win?1:0, nj=P[0].length;
        (o.mirror?[1,-1]:[1]).forEach(mz=>{
          const b0=M.p.length/3;
          for(let i=0;i<P.length;i++){ const row=P[i], wr=o.wc&&o.wc[i];
            for(let j=0;j<nj;j++){ const p=row[j]; M.p.push(p[0],p[1],p[2]*mz); M.m.push(mat); M.w.push(win); M.c.push(wr?wr[j]:0); } }
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
            if(o.skip && o.skip(i,j)) continue;
            const a=b0+i*nj+j, b=a+1, c=a+nj, d=c+1;
            if(!flip) M.i.push(a,b,c, b,d,c); else M.i.push(a,c,b, b,c,d);
          }
        });
      }

      // ---- saucer: top dome, rim band, lower dome (separate sheets: hard creases at the rim) ----
      const NS=120, rr=t=>0.993*(0.5*t+0.5*(1-(1-t)*(1-t)));
      const ring=f=>{ const R=[]; for(let j=0;j<=NS;j++) R.push(f(j/NS*Math.PI*2)); return R; };
      const CS=[]; for(let j=0;j<=NS;j++){ const a=j/NS*Math.PI*2; CS.push([Math.cos(a),Math.sin(a)]); }
      const dome2=(r,up)=>{ const y0=up?[UP(r)]:[LF(r),LA(r),LL(r)]; return CS.map(q=>sauCS(r,q[0],q[1],up,y0)); };
      const arc=P=>P.map(row=>{ let u=0; return row.map((p,j)=>{ if(j) u+=Math.hypot(p[0]-row[j-1][0],p[2]-row[j-1][2]); return u; }); });
      const out=p=>[p[0]-SC.x, p[1]-106, p[2]];
      const top=[], bot=[], rim=[];
      for(let i=0;i<=38;i++) top.push(dome2(rr(i/38),true));
      for(let i=28;i>=0;i--) bot.push(dome2(rr(i/28),false));
      const edge=(th,up,dy,k)=>{ const p=sau(0.993,th,up), q=sau(1,th,true); return [q[0]+(p[0]-q[0])*k, p[1]+dy, q[2]+(p[2]-q[2])*k]; };
      rim.push(top[top.length-1], ring(th=>edge(th,true,-0.6,0.3)), ring(th=>edge(th,true,-1.5,0)),
               ring(th=>edge(th,false,1.5,0)), ring(th=>edge(th,false,0.6,0.3)), bot[0]);
      // main shuttlebay: a recess in the dome aft of the deck (its door is the deck's aft face). The
      // top sheet leaves the cells over it open and a finer patch with the recess fills them.
      const bayDepth=(x,z)=>{ const c=v=>{ v=Math.min(1,Math.max(0,v)); return v*v*(3-2*v); };
        return 3.6*c((x-326)/16)*c((37-Math.abs(z))/1.6)*c((351-x)/2); };
      const BI=[16,22], BJ=[53,67];
      sheet(top,{ out, skip:(i,j)=>i>=BI[0]&&i<BI[1]&&j>=BJ[0]&&j<BJ[1] });
      { const P=[];
        for(let a=0;a<=(BI[1]-BI[0])*3;a++){ const r=rr((BI[0]+a/3)/38), R=[];
          for(let b=0;b<=(BJ[1]-BJ[0])*3;b++){ const p=sau(r,(BJ[0]+b/3)/NS*Math.PI*2,true); p[1]-=bayDepth(p[0],p[2]); R.push(p); }
          P.push(R); }
        sheet(P,{ out }); }
      sheet(rim,{ out, win:1, wc:arc(rim) });
      sheet(bot,{ out });
      // phaser arrays: a band round the dorsal dome (open aft) and one round the ventral dome
      const band=(r0,r1,a0,a1,up,n,mat,d)=>{ const P=[];
        [r0,r1].forEach(r=>{ const R=[]; for(let j=0;j<=n;j++){ const p=sau(r,a0+(a1-a0)*j/n,up); p[1]+=up?d:-d; R.push(p); } P.push(R); });
        sheet(P,{ mat, out:p=>[0,up?1:-1,0] }); };
      // the dorsal strip: a gray band between two dark lines
      band(0.763,0.787,-2.72,2.72,true,140,"hull2",0.18);
      band(0.763,0.7655,-2.72,2.72,true,140,"dark",0.21);
      band(0.7845,0.787,-2.72,2.72,true,140,"dark",0.21);
      band(0.583,0.598,-2.55,2.55,false,120,"dark",0.18);

      // ---- secondary hull: the upper body (widest at y 25) and one lens-shaped keel under it ----
      G.sweep(M,{ win:1, seg:56, res:4, st:BODY });
      G.sweep(M,{ win:1, seg:56, res:4, st:[
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

      let pyFace=null;
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
        // the outboard face of the rising part at (x, y), lifted d (the registry is painted there)
        pyFace=(x,y,d)=>{ let i=PD.findIndex(s=>s.z>110); while(i<PD.length-2 && PD[i+1].y<y) i++;
          const a=PD[i], b=PD[i+1], f=(y-a.y)/(b.y-a.y), L=k=>a[k]+(b[k]-a[k])*f, l=Math.hypot(b.y-a.y,b.z-a.z);
          const ny=(b.z-a.z)/l, nz=-(b.y-a.y)/l, xc=(L("le")+L("te"))/2, hw=(L("le")-L("te"))/2;
          const Y=-L("t")*Math.sqrt(Math.max(0,1-Math.pow((x-xc)/hw,2)))-d;
          return [x, L("y")+ny*Y, L("z")+nz*Y]; };
      }

      // ---- nacelles ----
      G.sweep(M,{ mirror:true, seg:48, res:6, st:NAC.map(s=>Object.assign({y:NY,z:NZ},NAC_N,s)) });
      const BUS=[{x:213,w:15,t:7.0},{x:224,w:16.2,t:7.6},{x:236,w:15.6,t:7.4},{x:244,w:12.8,t:6.4},
        {x:249.5,w:8.6,t:4.4},{x:252,w:2.8,t:1.5},{x:252.6,w:0,t:0}];
      G.sweep(M,{ mirror:true, mat:"bussard", seg:40, res:3, st:BUS.map(s=>Object.assign({y:NY+0.5,z:NZ,n:2.6,b:s.t},s)) });
      // the cowl is a clamshell: its lip runs forward over the bussard's crown and under its keel (x 239)
      // and is cut back at the flanks (x 219), so the bussard shows its full length from the side;
      // a gray shell from the nacelle's end to the lip, then a maroon collar ring
      {
        const BSD=dense(BUS, 3, ["x","w","t"]), e=2/2.6, xl=a=>219+20*Math.pow(Math.abs(Math.sin(a)),1.6);
        const bp=(x,a,d)=>{ const q=at(BSD,"x",x); return [x, NY+0.5+spow(Math.sin(a),e)*(q.t+d), NZ+spow(Math.cos(a),e)*(q.w+d)]; };
        const shell=[], collar=[], J=48, out=p=>[0,p[1]-NY-0.5,p[2]-NZ];
        for(let i=0;i<=6;i++){ const f=i/6, R=[];
          for(let j=0;j<=J;j++){ const a=j/J*2*Math.PI, c=npt(217,a,0), x=217+f*(xl(a)-217), b=bp(x,a,0.65), g=Math.sin(a)>0?1-(1-f)*(1-f):Math.pow(f,1.6);
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
        G.sweep(M,{ mat:"dark", mirror:true, seg:16, res:1, st:[x-1.1,x+1.1].map(xx=>({ x:xx, y:hoodTop(xx)+0.1, z:NZ, w:6, t:0.22, b:0.22, n:6 })) }); });
      // the copper field coils between the grilles and the bussard
      for(let i=0;i<5;i++){
        const x0=200+i*2, a=nsec(x0), b=nsec(x0+1.6);
        G.sweep(M,{ mirror:true, mat:"trim", seg:48, res:1, st:[a,b].map((q,k)=>Object.assign({ x:x0+k*1.6, y:NY, z:NZ, w:q.w+0.35, t:q.t+0.35, b:q.b+0.35 }, NAC_N)) });
      }
      // two red lines along each nacelle's top, aft from a Starfleet delta (red, a white one inside)
      const nsk=(x,z,d)=>{ const c=Math.pow(Math.abs(z)/nsec(x).w,NAC_N.nt/2)*Math.sign(z); return npt(x,Math.acos(c),d); };
      [-3.2,3.2].forEach(z0=>{
        const P=[];
        for(let i=0;i<=12;i++){ const x=74+i/12*102, row=[]; [z0-0.55,z0+0.55].forEach(z=>row.push(nsk(x,z,0.15))); P.push(row); }
        sheet(P,{ mat:"trim", mirror:true, out:p=>[0,1,0] });
      });
      [[1,"trim",0.2],[0.6,"paint",0.26]].forEach(([k,mat,d])=>{
        const A=[[4.8,0],[-4,3.6],[-1.9,0],[-4,-3.6]].map(q=>nsk(181.5+q[0]*k,q[1]*k,d));
        sheet([[A[0],A[0],A[0]],[A[1],A[2],A[3]]],{ mat, mirror:true, out:p=>[0,1,0] }); });
      // warp field grilles: lifted strips on the outboard and inboard flanks, flaring at the front
      [0, Math.PI].forEach(a0=>{
        // they run round the tail too: there the band of the two sides meets across the cap
        const P=[], X=[0.12,0.45,0.9,1.5,2.2,3.0]; for(let x=4;x<150;x+=6) X.push(x); for(let x=150;x<=195.01;x+=2.25) X.push(x);
        X.forEach(x=>{
          const h=3.2+7.8*Math.pow(Math.max(0,(x-160)/35),1.6);
          const s=nsec(x), row=[];
          for(let j=0;j<=16;j++){
            const v=-1+2*j/16, up=v>=0, tt=up?s.t:s.b, nn=up?NAC_N.nt:NAC_N.nb;
            const q=Math.min(tt>h?0.97:1,Math.abs(v)*h/tt), a=Math.sign(v)*Math.asin(Math.pow(q,nn/2));
            row.push(npt(x, a0===0 ? a : Math.PI-a, 0.4));
          }
          P.push(row);
        });
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
      const DECK=[[347.5,37.5,2.2,3.2],[351,37.6,2.2,3.2],[358,37.3,1.7,2],[380,36,1.3],[405,35.5,1.4],[420,45,1.8],
        [440,54.5,3.3],[452,56,3.6],[462,55,2.7],[472,51,1.4],[482,42,1.5],[490,27,1.4],[495,12,1.0],[497.5,0,0]]
        .map(q=>({ x:q[0], y:dome(q[0])-1.5, w:q[1], t:q[2]+1.5, b:q[3]||1.5, nt:5, nb:q[3]?5:2 }));
      G.sweep(M,{ seg:48, res:4, st:DECK });
      // the top of the deck (or of the saucer where there is no deck) over a plan point
      const DKD=dense(DECK, 4, ["x","y","w","t"]);
      const deckAt=(x,z)=>{ if(x<347.5) return domeAt(x,z); const s=at(DKD,"x",x), a=Math.abs(z)/(s.w||1e-6);
        return Math.max(domeAt(x,z), a<1 ? s.y+s.t*Math.pow(1-Math.pow(a,5),0.2) : 0); };
      // the RCS pods at the crescent's tips (a sweep out along z), each with a red thruster mark
      const pod=[[44,0,0],[46,7.5,138.5],[50,9,138.7],[55,8.6,138.6],[61,6.2,138],[67,3.6,137],[71,1.4,136],[72.5,0,135.6]];
      G.sweep(M,{ mirror:true, side:[-1,0,0], seg:28, res:3, st:pod.map(q=>{ const y=domeAt(452,q[0])-1;
        return { x:452, y:y, z:q[0], w:q[1], t:q[1]?q[2]-y:0, b:q[1]?1:0, nt:2.6, nb:2 }; }) });
      const podTop=mono(pod.slice(1,-1).map(q=>[q[0],q[2]]));
      G.sweep(M,{ mat:"trim", mirror:true, side:[-1,0,0], seg:16, res:1, st:[57.5,60].map(z=>({ x:451, y:podTop(z)+0.05, z:z, w:1.6, t:0.3, b:0.3, n:4 })) });
      // bridge module; the observation lounge is its aft end (windows placed with the panes below)
      const BRM=[{x:422,w:0,t:0,b:0},{x:423,w:9,t:2},{x:426.5,w:12.5,t:3.3},{x:433.5,w:14,t:3.4},
        {x:441,w:12.5,t:3.0},{x:447,w:8,t:1.8},{x:449,w:0,t:0}].map(s=>Object.assign({ y:137.1, b:1, nt:2.6, nb:2 },s));
      G.sweep(M,{ seg:48, res:4, st:BRM });
      // the bridge itself, a low dome on the module's forward half
      G.sweep(M,{ seg:36, res:3, st:[{x:430,w:0,t:0},{x:431,w:4.6,t:3.7},{x:434.5,w:7,t:4.3},{x:439.5,w:6.4,t:4.1},{x:442.5,w:3.5,t:3.5},{x:443.5,w:0,t:0}]
        .map(s=>Object.assign({ y:137.1, b:0.5, nt:2.2, nb:2 },s)) });
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
      const bay=[]; for(let i=0;i<=3;i++){ const y=101.2+i*2.2, row=[]; for(let j=0;j<=6;j++) row.push(kpt(y,8.6+j*3.4,0.35)); bay.push(row); }
      sheet(bay,{ mat:"dark", mirror:true, out:p=>[-1,0.9,0] });
      // torpedo launchers: aft, in the tail between the pylons, and forward, at the foot of the neck
      G.sweep(M,{ mat:"dark", seg:16, res:1, st:[{x:37.2,y:23.6,w:7,t:1.3,b:1.3,n:5},{x:37.9,y:23.6,w:7,t:1.3,b:1.3,n:5}] });
      G.sweep(M,{ mat:"dark", seg:16, res:1, st:[{x:321.4,y:49.6,w:6.5,t:1.2,b:1.2,n:5},{x:322.5,y:49.6,w:6.5,t:1.2,b:1.2,n:5}] });
      // main impulse engine, at the foot of the neck's aft slope
      G.sweep(M,{ seg:24, st:[{x:195,y:57,w:14,t:9.6,b:10,nt:4,nb:8},{x:210,y:57.5,w:14,t:9.8,b:10,nt:4,nb:8},{x:222,y:60,w:7,t:5,b:8,nt:3,nb:4}] });
      G.sweep(M,{ mat:"impulse", seg:24, res:1, st:[{x:194.3,y:61,w:12.6,t:4.2,b:4.2,n:4},{x:194.8,y:61,w:12.6,t:4.2,b:4.2,n:4}] });
      // saucer impulse engines, on the aft rim either side of the neck
      G.sweep(M,{ mat:"impulse", mirror:true, seg:24, res:1, st:[{x:295.6,y:106.3,z:123.5,w:14.5,t:2.9,b:2.9,n:5},{x:297,y:106.3,z:123.5,w:14.5,t:2.9,b:2.9,n:5}] });

      // ---- lit window panes on the faces too flat for the renderer's window rows ----
      const nrm=a=>{ const l=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l]; };
      let seed=7; const rnd=()=>(seed=seed*16807%2147483647)/2147483647;
      // a pane at p, its long side along u, lifted d along the normal n
      const pane=(p,u,n,L,H,d,mat)=>{
        const k=u[0]*n[0]+u[1]*n[1]+u[2]*n[2]; let ux=u[0]-n[0]*k, uy=u[1]-n[1]*k, uz=u[2]-n[2]*k;
        const l=Math.sqrt(ux*ux+uy*uy+uz*uz)||1, hl=L/2/l; ux*=hl; uy*=hl; uz*=hl;
        const hh=H/2/hl, vx=(n[1]*uz-n[2]*uy)*hh, vy=(n[2]*ux-n[0]*uz)*hh, vz=(n[0]*uy-n[1]*ux)*hh;
        const cx=p[0]+n[0]*d, cy=p[1]+n[1]*d, cz=p[2]+n[2]*d, b0=M.p.length/3, m=mat===undefined?MAT.lamp:mat;
        M.p.push(cx-ux-vx,cy-uy-vy,cz-uz-vz, cx+ux-vx,cy+uy-vy,cz+uz-vz, cx+ux+vx,cy+uy+vy,cz+uz+vz, cx-ux+vx,cy-uy+vy,cz-uz+vz);
        M.m.push(m,m,m,m); M.w.push(0,0,0,0); M.c.push(0,0,0,0);
        M.i.push(b0,b0+1,b0+2, b0,b0+2,b0+3); };
      const nearImpulse=(th,z)=>Math.cos(th)<0 && Math.abs(z)>92 && Math.abs(z)<154;
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
        // and a lit band round the bridge module's flanks
        for(let x=429;x<=445;x+=1.9){ const q=at(BD2,"x",x), z=q.w*Math.pow(1-Math.pow(0.6,2.6),1/2.6)+0.02;
          [z,-z].forEach(zz=>pane([x,137.1+0.6*q.t,zz], [1,0,0], slope(bh,x,zz*0.995), 1.3, 0.55, 0.1)); }
      }

      // main shuttlebay door, on the deck's aft face over the recess
      pane([347.5,dome(347.5)-1.1,0],[0,0,1],[-1,0,0],66,5.6,0.12,MAT.dark);

      // ---- saucer dressing: aztec paint, escape pods, windows, registry ----
      const hsh=(a,b)=>{ const s=Math.sin(a*127.1+b*311.7)*43758.5453; return s-Math.floor(s); };
      const rawX=(r,th)=>SC.x+r*(Math.cos(th)>=0?SC.f:SC.a)*Math.cos(th);
      const DKT=[]; for(let x=347;x<=499;x++) DKT.push(at(DKD,"x",x).w);
      const DKW=x=>{ if(x<347.5||x>498) return -9; const i=Math.floor(x-347), f=x-347-i; return DKT[i]+(DKT[i+1]-DKT[i])*f; };
      // the plan's radial direction (ellipse gradient) at a point
      const radial=(x,z)=>{ const dx=x-SC.x, f=dx>0?SC.f:SC.a; return nrm([dx/(f*f),0,z/(SC.s*SC.s)]); };
      const lowAt=(x,z)=>{ const dx=x-SC.x, u=dx/(dx>0?SC.f:SC.a), v=z/SC.s; return sau(Math.hypot(u,v),Math.atan2(v,u),false)[1]; };
      // a cell of the saucer grid is usable away from the aft cut, the impulse notches and the deck
      const open=(r,th,up)=>{ const x=rawX(r,th), z=r*SC.s*Math.sin(th);
        if(x<SC.cut+5 || (nearImpulse(th,z) && r>0.8) || (up && x>318 && x<352 && Math.abs(z)<41)) return false;
        return up ? Math.abs(z)>DKW(x)+2.5 : !inNeck(sau(r,th,false),4) && !(x>432&&x<476&&Math.abs(z)<17); };
      // aztec: light panels in zones of rings that share one angular grid, so blocks step between zones
      const strip=(r0,r1,t0,t1,up,d)=>{ const n=Math.max(1,Math.ceil((t1-t0)*r1*SC.s/7)), P=[];
        [r0,r1].forEach(r=>{ const R=[]; for(let j=0;j<=n;j++){ const p=sau(r,t0+(t1-t0)*j/n,up); p[1]+=up?d:-d; R.push(p); } P.push(R); });
        sheet(P,{ mat:"paint", mirror:true, out:()=>[0,up?1:-1,0] }); };
      [[1,[.27,.31,.35,.39],.6],[1,[.39,.43,.47],.53],[1,[.47,.51,.55,.585],.7],[1,[.585,.62,.655,.69],.59],[1,[.69,.73,.762],.72],
       [1,[.79,.82,.85],.61],[1,[.85,.88,.91],.74],[1,[.91,.94,.965,.988],.65]].forEach(([up,R,lean],zi)=>{
        const na=Math.round(Math.PI*R[1]*(SC.s+SC.f)/2/(6+3*hsh(zi,1)));
        for(let k=0;k<R.length-1;k++){ let j0=-1;
          for(let j=0;j<=na;j++){
            const th=(j+0.5)/na*Math.PI;
            const v=j<na && open((R[k]+R[k+1])/2,th,up) && 0.55*hsh(zi*7+3,Math.floor(j/3))+0.3*hsh(zi*5+k,Math.floor(j/2)+40)+0.15*hsh(k+zi*11,j)>lean;
            if(v && j0<0) j0=j;
            if(!v && j0>=0){ strip(R[k],R[k+1],j0/na*Math.PI,j/na*Math.PI,!!up,0.07); j0=-1; }
          }
        }
      });
      // escape pod hatches, read off galaxy-top.jpg (starboard; mirrored)
      const POD=[[599.5,10],[599.1,17.8],[598.5,25.7],[597.5,33.4],[588.1,75],[585.6,82.4],[580.8,45.8],[579.9,96.3],[579,53.6],[577,61.3],
        [576.7,103.1],[574.8,68.9],[573.2,109.8],[572.4,76.4],[569.7,116.2],[565.8,122.7],[565.3,93.9],[561.8,128.8],[561.6,101.2],[557.8,108.2],
        [553.6,115],[552.9,140.9],[549.2,121.6],[548,146.7],[543,152.8],[539,36.7],[539,135.1],[537.8,158.1],[537.3,44.3],[535.2,51.8],
        [534.1,140.9],[533,59.2],[532.2,163.3],[528.9,146.4],[524.8,78.6],[523.3,151.8],[521,85.3],[518.8,173.3],[517.1,91.8],[512.7,98.2],
        [512.1,160.1],[511.8,177.4],[505.2,164.1],[504.6,181.2],[485.1,126.9],[478.2,33.2],[478.1,130.4],[473.7,40],[468.2,45.8],[456.6,30.8],
        [449.2,32.2],[424.9,129.7],[418,126.1],[395.1,179.6],[387.6,175.3],[381.2,171.1],[380.7,151.8],[375.2,146.1],[371.9,163.6],[370,140.5],
        [366.4,158.2],[364.9,134.6],[360.8,152.2],[355.3,146.1],[350.4,139.6],[342.2,128.2],[337.8,121.3],[333.8,114.6],[331.2,78.3],[330,107.6],
        [328.6,70.9],[326.6,100.6],[326.2,63.2],[323.4,93.5],[318.7,81.9],[317.8,15.9],[317.4,8.1],[316.1,74.3],[313.6,66.2],[307.9,87.8],
        [305.1,80],[302.6,72.7],[300.6,65.1],[299,57.4],[297.2,49.8],[294.2,27.9],[293.6,20.1],[293.4,12.1],[293,4.2],[317.4,0]];
      const pods=[]; POD.forEach(([x,z])=>(z?[z,-z]:[0]).forEach(zz=>pods.push([x,zz])));
      pods.forEach(([x,z])=>{ const r=radial(x,z), p=[x,deckAt(x,z),z], n=slope(deckAt,x,z);
        pane(p, [-r[2],0,r[0]], n, 5.5, 5.5, 0.11, MAT.dark); pane(p, [-r[2],0,r[0]], n, 4.5, 4.5, 0.14, MAT.paint); });
      // windows in broken concentric rows: radial slits in rooms of two to four, a room lit or dark
      const PG={}; pods.forEach(q=>{ const k=Math.round(q[0]/10)*100+Math.round(q[1]/10); (PG[k]=PG[k]||[]).push(q); });
      const nearPod=(x,z)=>{ const i=Math.round(x/10), j=Math.round(z/10);
        for(let a=i-1;a<=i+1;a++) for(let b=j-1;b<=j+1;b++){ const L=PG[a*100+b]; if(L) for(const q of L) if(Math.abs(q[0]-x)<5 && Math.abs(q[1]-z)<5) return true; }
        return false; };
      [[.975,1,.7],[.95,1,.35],[.925,1,.5],[.9,1,.3],[.872,1,.25],[.84,1,.2],[.81,1,.35],[.745,1,.3],[.715,1,.25],[.68,1,.15],[.62,1,.15],
       [.56,1,.15],[.5,1,.12],[.44,1,.12],[.36,1,.12],
       [.965,0,.45],[.92,0,.45],[.875,0,.4],[.83,0,.45],[.78,0,.35],[.73,0,.4],[.68,0,.35],[.635,0,.25]]
        .forEach(([r,up,fill])=>{
        const step=1.7/(r*(SC.s+SC.f)/2), n=Math.floor(Math.PI/step), U=!!up, e=0.002;
        const Y=q=>U?[UP(q)]:[LF(q),LA(q),LL(q)], y0=Y(r), y1=Y(r+e);
        let left=0, lit=false;
        for(let j=0;j<n;j++){
          if(left<=0){ left=2+Math.floor(rnd()*3); lit=rnd()<0.5; j+=Math.round((1-fill)/fill*(left+1.5)*(0.4+1.2*rnd())); if(j>=n) break; }
          left--;
          const th=(j+0.5)*step, c=Math.cos(th), sn=Math.sin(th);
          if(!open(r,th,U)) continue;
          const p=sauCS(r,c,sn,U,y0);
          if(U && (nearPod(p[0],p[2]) || (p[0]>504 && p[0]<536 && Math.abs(p[2])<58))) continue;
          if(!U && p[0]>506 && p[0]<530 && Math.abs(p[2])<52) continue;
          const dt=sub(sauCS(r,Math.cos(th+e),Math.sin(th+e),U,y0),p); let n0=nrm(cross(dt,sub(sauCS(r+e,c,sn,U,y1),p)));
          if((n0[1]>0)!==U) n0=[-n0[0],-n0[1],-n0[2]];
          const rd=radial(p[0],p[2]), mat=lit?MAT.lamp:MAT.dark;
          pane(p, rd, n0, 2.4, 0.75, 0.2, mat);
          pane([p[0],p[1],-p[2]], [rd[0],0,-rd[2]], [n0[0],n0[1],-n0[2]], 2.4, 0.75, 0.2, mat);
        }
      });
      // registry: a squared, extended sans; glyphs are polylines in a unit-high box (width first)
      const fil=(P,r,cl)=>{ const o=[]; if(!cl) o.push(P[0]);
        for(let i=cl?0:1;i<(cl?P.length:P.length-1);i++){ const a=P[(i-1+P.length)%P.length], b=P[i], c=P[(i+1)%P.length];
          const u=[a[0]-b[0],a[1]-b[1]], v=[c[0]-b[0],c[1]-b[1]], lu=Math.hypot(u[0],u[1]), lv=Math.hypot(v[0],v[1]), rr2=Math.min(r,lu/2,lv/2);
          const p0=[b[0]+u[0]/lu*rr2,b[1]+u[1]/lu*rr2], p1=[b[0]+v[0]/lv*rr2,b[1]+v[1]/lv*rr2];
          for(let k=0;k<=4;k++){ const t=k/4; o.push([(1-t)*(1-t)*p0[0]+2*t*(1-t)*b[0]+t*t*p1[0], (1-t)*(1-t)*p0[1]+2*t*(1-t)*b[1]+t*t*p1[1]]); } }
        if(cl) o.push(o[0]); else o.push(P[P.length-1]);
        return o; };
      const GL={
        N:[.9,[[[0,0],[0,1],[.9,0],[.9,1]]]], C:[.86,[fil([[.86,1],[0,1],[0,0],[.86,0]],.3)]], "0":[.86,[fil([[0,0],[0,1],[.86,1],[.86,0]],.3,1)]],
        "1":[.32,[[[0,.78],[.3,1],[.3,0]]]], "7":[.82,[[[0,1],[.82,1],[.24,0]]]], D:[.88,[fil([[0,1],[.88,1],[.88,0],[0,0]],.3).concat([[0,1]])]],
        "-":[.42,[[[.04,.5],[.38,.5]]]], ".":[.12,[[[.06,.06],[.0601,.06]]]], " ":[.4,[]],
        U:[.86,[fil([[0,1],[0,0],[.86,0],[.86,1]],.3)]], S:[.86,[fil([[.86,1],[0,1],[0,.5],[.86,.5],[.86,0],[0,0]],.22)]],
        E:[.8,[[[.8,1],[0,1],[0,0],[.8,0]],[[0,.5],[.62,.5]]]], T:[.84,[[[0,1],[.84,1]],[[.42,1],[.42,0]]]],
        R:[.86,[fil([[0,0],[0,1],[.86,1],[.86,.5],[0,.5]],.22),[[.5,.5],[.86,0]]]], P:[.86,[fil([[0,0],[0,1],[.86,1],[.86,.5],[0,.5]],.22)]],
        I:[.12,[[[.06,0],[.06,1]]]] };
      // lay a string along s (centered), its glyphs' up along t; map(s,t) -> point on the hull, out = outward hint
      // each polyline is one strip with mitred joins and square ends
      const write=(str,H,sw,sp,map,out,mat)=>{
        let W=-sp; for(const ch of str) W+=GL[ch][0]*H+sp;
        let s0=-W/2; const h=sw/2, un=(a,b)=>{ const x=b[0]-a[0], y=b[1]-a[1], l=Math.hypot(x,y); return l>1e-6?[x/l,y/l]:[1,0]; };
        for(const ch of str){ const g=GL[ch];
          g[1].forEach(L0=>{
            const L=L0.map(q=>[s0+q[0]*H,(q[1]-0.5)*H]), n=L.length, cl=Math.hypot(L[0][0]-L[n-1][0],L[0][1]-L[n-1][1])<1e-6, P=[[],[]];
            for(let i=0;i<n;i++){
              const dp=i>0?un(L[i-1],L[i]):cl?un(L[n-2],L[0]):null, dn=i<n-1?un(L[i],L[i+1]):cl?un(L[0],L[1]):null;
              let c=L[i], m;
              if(dp && dn){ const a=[-dp[1]-dn[1],dp[0]+dn[0]], l=Math.hypot(a[0],a[1])||1, k=Math.min(2,1/Math.max(0.2,(a[0]*-dn[1]+a[1]*dn[0])/l));
                m=[a[0]/l*k,a[1]/l*k]; }
              else { const d=dp||dn; m=[-d[1],d[0]]; c=[c[0]+d[0]*h*(dp?1:-1),c[1]+d[1]*h*(dp?1:-1)]; }
              P[0].push(map(c[0]-m[0]*h,c[1]-m[1]*h)); P[1].push(map(c[0]+m[0]*h,c[1]+m[1]*h)); }
            sheet(P,{ mat:Object.keys(MAT).find(k=>MAT[k]===mat), out:()=>out }); });
          s0+=g[0]*H+sp; } };
      // dorsal: read from the bow (tops aft, N to starboard); ventral: read from below (tops forward)
      write("NCC-1701-D",12.5,3.0,2.6,(s,t)=>{ const x=524-t, z=-s; return [x,deckAt(x,z)+0.13,z]; },[0,1,0],MAT.trim);
      write("NCC-1701-D",12.5,2.3,2.6,(s,t)=>{ const x=524-t, z=-s; return [x,deckAt(x,z)+0.17,z]; },[0,1,0],MAT.dark);
      write("U.S.S. ENTERPRISE",3.4,0.62,0.9,(s,t)=>{ const x=514.2-t, z=-s; return [x,deckAt(x,z)+0.16,z]; },[0,1,0],MAT.dark);
      write("NCC-1701-D",9,1.6,3.4,(s,t)=>{ const x=518+t, z=-s; return [x,lowAt(x,z)-0.16,z]; },[0,-1,0],MAT.dark);
      // and on the pylons' outboard faces, read from either side
      write("NCC-1701-D",3.6,0.62,1.1,(s,t)=>pyFace(73+s,35.5+t,0.2),[0,0,1],MAT.dark);
      write("NCC-1701-D",3.6,0.62,1.1,(s,t)=>{ const p=pyFace(73-s,35.5+t,0.2); return [p[0],p[1],-p[2]]; },[0,0,-1],MAT.dark);
      // RCS thruster quads on the rim, fore and aft of abeam
      [0.91,2.23].forEach(th=>[1,-1].forEach(m=>{
        const p=sau(1,th*m,true), q=sau(0.993,th*m,false), c=[p[0],(p[1]+q[1])/2-1.2,p[2]], r=radial(p[0],p[2]);
        pane(c,[-r[2],0,r[0]],r,7,3.4,0.3,MAT.paint);
        [-1.6,1.6].forEach(o=>pane([c[0]-r[2]*o,c[1],c[2]+r[0]*o],[-r[2],0,r[0]],r,1.6,1.4,0.42,MAT.dark)); }));
      // the dorsal spine: down the neck's aft face from the saucer to the impulse engine, then along
      // the secondary hull's ridge to the tail; a red line runs along its crest
      { const sp=(st,w)=>{ G.sweep(M,{ side:[0,0,-1], seg:20, res:3, st:st.map(q=>({ x:q[0], y:q[1], w:q[2]*w, t:1.2, b:1.4, nt:4, nb:2 })) });
          G.sweep(M,{ mat:"trim", side:[0,0,-1], seg:12, res:3, st:st.map(q=>({ x:q[0]+q[3]*1.1, y:q[1]+q[4]*1.1, w:0.42, t:0.16, b:0.2, n:4 })) }); };
        const nk=[113,108,102,96,90,84,78,72.5].map((y,i,A)=>{ const p=kpt(y,0,-0.6), q=kpt(A[Math.min(i+1,A.length-1)],0,-0.6), o=kpt(A[Math.max(i-1,0)],0,-0.6);
          const t=nrm([q[0]-o[0],q[1]-o[1],0]); return [p[0],p[1],3.1,t[1],-t[0]]; });
        sp(nk,1);
        const rg=[192,180,165,150,135,120,105,90,78,68].map(x=>[x,25+at(BD,"x",x).t-0.55,1-(192-x)/260,0,1]);
        sp(rg,3.6); }
      // two dark vents on each nacelle's top, near the tail
      [-4.3,4.3].forEach(z=>{ const p=nsk(39.5,z,0), q=nsk(40,z,0), n=nrm(sub(nsk(39.5,z,1),p));
        pane(p,sub(q,p),n,21,3.4,0.18,MAT.dark); pane([p[0],p[1],-p[2]],[q[0]-p[0],q[1]-p[1],p[2]-q[2]],[n[0],n[1],-n[2]],21,3.4,0.18,MAT.dark); });
      // window rows over the secondary hull's back, fanning out with the beam: slits across the
      // row, two or three to a room
      [0.2,0.29,0.38,0.47,0.56,0.65,0.74].forEach(v=>{ let left=0, lit=false;
        const f=(x,u)=>{ const q=at(BD,"x",x); return [x, 25+q.t*Math.pow(1-Math.pow(u,q.nt),1/q.nt), u*q.w]; };
        for(let x=92+5*rnd();x<=292;x+=1.6){
          if(left<=0){ left=2+Math.floor(rnd()*2); lit=rnd()<0.5; x+=1.6*(2+Math.floor(rnd()*6)); }
          left--;
          const p=f(x,v);
          if(inNeck(p,2) || (x>186 && x<228 && p[2]<18)) continue;
          let n=nrm(cross(sub(f(x+0.6,v),p),sub(f(x,v+0.01),p))); if(n[1]<0) n=[-n[0],-n[1],-n[2]];
          const mat=lit?MAT.lamp:MAT.dark;
          pane(p,[1,0,0],n,0.75,2.2,0.2,mat); pane([p[0],p[1],-p[2]],[1,0,0],[n[0],n[1],-n[2]],0.75,2.2,0.2,mat);
        }
      });
      // deck rows along the secondary hull's upper flanks: tall windows in pairs
      [28.6,32.2,35.8,39.4].forEach(y=>{
        for(let x=141+4*rnd();x<=290;x+=5.2){
          if(rnd()<0.35) continue;
          const lit=rnd()<0.7;
          for(const dx of [0,1.6]){
            const p=bpt(x+dx,y);
            if(inNeck(p,2)) continue;
            let n=nrm(cross(sub(bpt(x+dx+0.5,y),p),sub(bpt(x+dx,y+0.3),p)));
            if(n[2]<0) n=n.map(c=>-c);
            [1,-1].forEach(m=>pane([p[0],p[1],p[2]*m],[1,0,0],[n[0],n[1],n[2]*m],0.8,1.6,0.2,lit?MAT.lamp:MAT.dark));
          }
        }
      });

      return M;
    }
  };
})();
