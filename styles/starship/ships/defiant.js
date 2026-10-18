/* USS Defiant NX-74205, Defiant class.
   Modeled in stern-up coordinates and shifted at the end: X meters forward
   of the stern, D meters down from the top of the dorsal spine, z starboard.
   Every body is a loft of rounded-rectangle rings; the nacelles are lofted
   outboard (across their width) so their slanted front faces come for free. */
SHIPS.defiant={
  name:"U.S.S. DEFIANT", reg:"NX-74205", cls:"DEFIANT CLASS",
  len:170.68, beam:134.11, height:30.1,
  hull:[0.54,0.56,0.59], defl:[0.36,0.64,1.0], deck:3,
  callouts:[
    { text:"MAIN BRIDGE", at:[34.7,7.45,0] },
    { text:"WARP NACELLE", at:[-15.92,5.6,48.17] },
    { text:"PULSE PHASER CANNON", at:[8.46,-4.97,53.75] },
    { text:"MAIN DEFLECTOR", at:[83.77,-7.72,0] },
    { text:"TARGETING SENSORS", at:[35.66,1.32,37.07] },
    { text:"IMPULSE ENGINES", at:[-57.22,1.6,28.4] },
    { text:"WARP FIELD GRILLE", at:[-46.09,-3.07,47.08] }],
  build(G){
    const M=G.mesh(), X0=85.34, Y0=14, PI=Math.PI;
    const P=(X,D,z)=>[X-X0, Y0-D, z];

    // monotone cubic through [[x,y],...]: no overshoot, so steps stay steps
    function tab(T){
      const n=T.length, X=T.map(p=>p[0]), Y=T.map(p=>p[1]), d=[], m=[];
      for(let i=0;i<n-1;i++) d.push((Y[i+1]-Y[i])/(X[i+1]-X[i]));
      m[0]=d[0]; m[n-1]=d[n-2];
      for(let i=1;i<n-1;i++) m[i]=d[i-1]*d[i]<=0 ? 0 : (d[i-1]+d[i])/2;
      for(let i=0;i<n-1;i++){
        if(d[i]===0){ m[i]=m[i+1]=0; continue; }
        const a=m[i]/d[i], b=m[i+1]/d[i], s=a*a+b*b;
        if(s>9){ const t=3/Math.sqrt(s); m[i]=t*a*d[i]; m[i+1]=t*b*d[i]; }
      }
      return x=>{
        if(x<=X[0]) return Y[0]; if(x>=X[n-1]) return Y[n-1];
        let i=0; while(x>X[i+1]) i++;
        const h=X[i+1]-X[i], t=(x-X[i])/h, t2=t*t, t3=t2*t;
        return (2*t3-3*t2+1)*Y[i]+(t3-2*t2+t)*h*m[i]+(-2*t3+3*t2)*Y[i+1]+(t3-t2)*h*m[i+1];
      };
    }
    // rounded rectangle in [-1,1]^2, corners K=[[ku,ky] x4] top-right, top-left, bottom-left, bottom-right; starts on the right side
    function rr(nh,nv,nc,K){
      const Q=[], seg=(x0,y0,x1,y1,n)=>{ for(let k=0;k<n;k++){ const t=k/n; Q.push([x0+(x1-x0)*t, y0+(y1-y0)*t]); } };
      const arc=(cx,cy,c,a0)=>{ for(let k=0;k<nc;k++){ const a=a0+k/nc*PI/2; Q.push([cx+c[0]*Math.cos(a), cy+c[1]*Math.sin(a)]); } };
      const [a,b,c,d]=K;
      seg(1,-1+d[1], 1,1-a[1], nv);      arc(1-a[0],1-a[1],a,0);
      seg(1-a[0],1, -1+b[0],1, nh);      arc(-1+b[0],1-b[1],b,PI/2);
      seg(-1,1-b[1], -1,-1+c[1], nv);    arc(-1+c[0],-1+c[1],c,PI);
      seg(-1+c[0],-1, 1-d[0],-1, nh);    arc(1-d[0],-1+d[1],d,1.5*PI);
      return Q;
    }
    /* one section: lateral center lc, half-width w; top / bottom depths dt, db
       (numbers or functions of the lateral coordinate); corner radii rt, rb in m
       (or r4: top-right, top-left, bottom-left, bottom-right);
       taper narrows the lower half, tt the upper; map(l, D) -> [x,y,z] */
    function sec(o, map){
      const w=o.w, dt0=typeof o.dt==="number"?o.dt:o.dt(o.lc||0), db0=typeof o.db==="number"?o.db:o.db(o.lc||0);
      const hh=Math.max(1e-3,(db0-dt0)/2), lc=o.lc||0, tp=o.taper||0, tt=o.tt||0;
      const rb=o.rb!==undefined?o.rb:o.rt, R4=o.r4||[o.rt,o.rt,rb,rb];
      const Q=rr(o.nh||16,o.nv||4,o.nc||5,R4.map(r=>[Math.min(0.999,r/w),Math.min(0.999,r/hh)]));
      return Q.map(([cu,cy])=>{
        const l=lc+w*cu*(1-tp*Math.max(0,-cy)-tt*Math.max(0,cy));
        const dt=typeof o.dt==="number"?o.dt:o.dt(l), db=typeof o.db==="number"?o.db:o.db(l);
        const dm=(dt+db)/2, D=dm-cy*(db-dt)/2;
        return map(l,D);
      });
    }
    /* stitch rings into a closed skin; ring.k = hard crease (no shared normals) */
    function loft(R, o){
      o=o||{};
      const mat=G.MATS[o.mat||"hull"], win=o.win?1:0, N=R[0].p.length, i0=M.i.length;
      const add=(ring,w)=>{ const s=M.p.length/3; ring.p.forEach(q=>{ M.p.push(q[0],q[1],q[2]); M.m.push(mat); M.w.push(w&&o.wf?o.wf(q):w); M.c.push(ring.c||0); }); return s; };
      let prev=-1;
      R.forEach((ring,r)=>{
        const a=add(ring,win);
        if(prev>=0) for(let j=0;j<N;j++){ const j1=(j+1)%N; M.i.push(prev+j,a+j,prev+j1, prev+j1,a+j,a+j1); }
        prev=ring.k && r<R.length-1 ? add(ring,win) : a;
      });
      if(o.cap!==false) [0,R.length-1].forEach((r,e)=>{
        if((e?o.cap1:o.cap0)===false) return;
        const ring=R[r].p, c=[0,0,0]; ring.forEach(q=>{ c[0]+=q[0]/N; c[1]+=q[1]/N; c[2]+=q[2]/N; });
        const ci=M.p.length/3; M.p.push(c[0],c[1],c[2]); M.m.push(mat); M.w.push(0); M.c.push(0);
        const s=add({p:ring},0);
        for(let j=0;j<N;j++){ const j1=(j+1)%N; if(e===0) M.i.push(ci,s+j,s+j1); else M.i.push(ci,s+j1,s+j); }
      });
      // outward = positive signed volume
      let v=0; const p=M.p, I=M.i;
      for(let t=i0;t<I.length;t+=3){
        const a=I[t]*3, b=I[t+1]*3, c=I[t+2]*3;
        v+=p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])-p[a+1]*(p[b]*p[c+2]-p[b+2]*p[c])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]);
      }
      if(v<0) for(let t=i0;t<I.length;t+=3){ const x=I[t+1]; I[t+1]=I[t+2]; I[t+2]=x; }
    }
    // the skins paint and lettering are laid on: [from, to, open] triangle ranges of M.i, for the top and each
    // side (a closed loft faces outward, so only its faces toward the ray are kept; an open one keeps both)
    const SK={ top:[], s1:[], s2:[] }, skin=(k,f,o)=>{ const a=M.i.length; f(); SK[k].push(a,M.i.length,o?1:0); };
    // stations from a list of [from, to, step] runs
    // how far a span [a,b] pulls in at X to round its ends with radius r
    const rnd=(a,b,r,X)=>{ const d=Math.min(X-a,b-X); return d<r ? r-Math.sqrt(Math.max(0,r*r-(r-d)*(r-d))) : 0; };
    function stations(runs){ const S=[]; runs.forEach(([a,b,s])=>{ const n=Math.max(1,Math.round((b-a)/s)); for(let i=0;i<=n;i++){ const x=a+(b-a)*i/n; if(!S.length || x-S[S.length-1]>1e-6) S.push(x); } }); return S; }
    // a round boss: prof [[r, D, crease], ...] from the center outward
    function disc(X, z, prof, o){
      const N=o.n||72;
      loft(prof.map(([r,D,k])=>{ const p=[]; for(let j=0;j<N;j++){ const a=j/N*2*PI; p.push(P(X+r*Math.cos(a),D,z+r*Math.sin(a))); } return { p, k }; }),o);
    }
    // a round plate laid on a surface surf(X,z) -> D: prof [[r, h, crease], ...], h off the surface (sg 1 above, -1 below)
    function plate(Xc, prof, surf, sg, o){
      const N=o.n||72;
      loft(prof.map(([r,h,k])=>{ const p=[]; for(let j=0;j<N;j++){ const a=j/N*2*PI, X=Xc+r*Math.cos(a), z=r*Math.sin(a); p.push(P(X,surf(X,z)-sg*h,z)); } return { p, k }; }),o);
    }
    // an X-loft: f(X) -> section options; o.mz mirrors to port; o.lim(D) caps the half-width; creases at the listed X
    function xbody(xs, f, o, crease){
      const L=o.lim ? (l,D)=>Math.sign(l)*Math.min(Math.abs(l),o.lim(D)) : l=>l;
      const R=xs.map(X=>{ const s=f(X); return { p:sec(s,(l,D)=>P(X,D,L(l,D)*(o.mz||1))), c:X, k:crease&&crease.some(c=>Math.abs(c-X)<1e-6) }; });
      loft(R,o);
    }

    /* ---------------- main hull ----------------
       ends at X 127.5 in a slot for the module; two jaws carry the rim on */
    const HW=tab([[0.8,17],[9.3,17.6],[9.7,21.2],[13.2,23.35],[17,24],[24.9,25.5],[28.4,26.2],[28.9,30.6],[29.8,32],[34,32.75],[38,33.1],
      [41,33.45],[50,37.6],[60,41.6],[70,44.6],[80,46.6],[88,47.3],[95,46.6],[99,45.65],[102.4,44.85],[105.7,43.75],[109.1,42.55],
      [112.5,41.15],[115.9,40.05],[119.4,38.25],[122.8,36.45],[126.2,34.25],[129.6,31.75],[133,28.45],[136.4,25.45],[139.9,21.65],
      [143.3,16.75],[146,11.5],[148,5]]);
    const HT=tab([[1.0,9.2],[3.4,8.8],[6.7,8.0],[10.1,7.3],[13.7,6.2],[17.1,6.0],[20.5,5.4],[24,4.8],[30,4.5],[90,4.5],[100,5.0],
      [108,6.0],[115,6.9],[122,7.9],[130,8.7],[138,9.4],[144,10],[148,11]]);
    // keel depth, a deeper outboard band, and a shallow channel down the centerline
    const HB=tab([[0.8,15.5],[3.4,16.2],[6.7,17.0],[10.1,18.3],[13.7,19.1],[17.1,19.6],[20.5,19.8],[24,20.5],[27.2,20.8],[30,20.85],[140,20.85],[145,20.6],[148,18]]);
    const HO=tab([[0.8,15.5],[3.4,16.2],[6.7,17.0],[10.1,18.3],[13.7,19.1],[17.1,19.6],[20.5,19.8],[24,20.5],[27.2,20.8],[29.5,21.5],
      [31,22.2],[40,22.3],[50,21.4],[88,21.4],[95,22.2],[102,22.4],[106,22.3],[112,22.1],[120,21.7],[130,21.3],[140,21.2],[145,20.6],[148,18]]);
    const HC=tab([[0.8,15.5],[13.7,18.2],[20.5,18.6],[24,18.7],[30,18.4],[140,18.4],[148,17]]);
    const HR=tab([[0,2.5],[28,2.5],[34,4.5],[90,6],[148,5]]);
    const sstep=(a,b,x)=>{ const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); };
    const hsec=X=>{ const ht=HT(X), hb=HB(X), hc=HC(X), ho=HO(X);
      return { dt:l=>{ const a=Math.abs(l)-27; return ht+0.13*(a>3?a:a>-3?(a+3)*(a+3)/12:0); },
               db:l=>hc+(hb-hc)*sstep(13.6,16.2,Math.abs(l))+(ho-hb)*sstep(21.5,26,Math.abs(l)) }; };
    const HBOT=(X,z)=>hsec(X).db(z), HTOP=(X,z)=>hsec(X).dt(z);
    // one row of window cells (3.45 m) low on each side wall of the forward hull, from abreast of the bridge to the
    // targeting sensors (the hull's window coordinate runs 6.9 m behind X, which shifts the renderer's lit pattern)
    const hwin={ win:1, wf:q=>{ const X=q[0]+X0, D=Y0-q[1];
      return X>89.6 && X<114 && Math.abs(q[2])>HW(X)-1.2 && Math.abs(D-15.7)<0.8 ? 1 : 0; } };
    const SLOT=127.5, SZ=14;
    // the stern center sits back between two corner nubs
    const C0=M.c.length;
    skin("top",()=>xbody(stations([[2.3,9.3,1.2],[9.3,9.7,0.4],[9.7,28.4,1.2],[28.4,28.9,0.5],[28.9,SLOT,1.25]]),
      X=>Object.assign(hsec(X),{ w:HW(X), rt:HR(X), nh:48, nv:4, nc:6 }), hwin, [9.3,9.7,28.4,28.9]));
    for(let i=C0;i<M.c.length;i++) M.c[i]-=6.9;
    [1,-1].forEach(mz=>xbody([0.45,1.2,1.9,2.6], X=>{ const W=HW(X); return Object.assign(hsec(X),{ lc:(W+10.3)/2, w:(W-10.3)/2, r4:[HR(X),0.3,0.3,HR(X)], nh:6, nv:3, nc:5 }); }, { mz }));
    const jaw=X=>{ const W=Math.max(SZ+0.25,HW(X)), r=Math.min(HR(X),(W-SZ)*0.95);
      return Object.assign(hsec(X),{ lc:(SZ+W)/2, w:(W-SZ)/2, r4:[r,0.25,0.25,r] }); };
    [1,-1].forEach(mz=>skin("top",()=>xbody(stations([[SLOT,142,1],[142,144.8,0.4]]), X=>Object.assign(jaw(X),{ nh:14, nv:4, nc:6 }), Object.assign({ mz, cap0:false },hwin))));

    /* skins laid on the hull's outboard rim: hside(X) walks the section from the
       keel round the side to the deck as [l, D, nl, nD] (n the outward normal);
       hrun keeps the stretch where f(l,D)>=0, resampled to N points */
    const HS=new Map();
    function hside(X,reach){
      const key=X+"/"+reach; if(HS.has(key)) return HS.get(key);
      // sec()'s mapping, sampled densely round the outboard reach m only
      const o=X<SLOT ? Object.assign(hsec(X),{ lc:0, w:HW(X), r4:[HR(X)] }) : jaw(X), w=o.w, lc=o.lc, hh=(o.db(lc)-o.dt(lc))/2;
      const ku=Math.min(0.999,o.r4[0]/w), ky=Math.min(0.999,o.r4[0]/hh), c0=Math.min(1-ku,Math.max(-1+ku,1-reach/w)), nf=Math.max(1,Math.ceil((1-ku-c0)*w/0.5)), S=[];
      const put=(cu,cy)=>{ const l=lc+w*cu, dt=o.dt(l), db=o.db(l); S.push([l,(dt+db)/2-cy*(db-dt)/2]); };
      for(let k=0;k<nf;k++) put(c0+(1-ku-c0)*k/nf,-1);
      for(let k=0;k<11;k++){ const a=1.5*PI+k/11*PI/2; put(1-ku+ku*Math.cos(a),-1+ky+ky*Math.sin(a)); }
      for(let k=0;k<8;k++) put(1,-1+ky+2*(1-ky)*k/8);
      for(let k=0;k<11;k++){ const a=k/11*PI/2; put(1-ku+ku*Math.cos(a),1-ky+ky*Math.sin(a)); }
      for(let k=0;k<=nf;k++) put(1-ku-(1-ku-c0)*k/nf,1);
      const R=S.map((q,i)=>{ const a=S[Math.max(0,i-1)], b=S[Math.min(S.length-1,i+1)], tl=b[0]-a[0], ty=a[1]-b[1], L=Math.hypot(tl,ty)||1;
        return [q[0],q[1],ty/L,tl/L]; });
      HS.set(key,R); return R;
    }
    const lerp=(a,b,t)=>a.map((v,k)=>v+(b[k]-v)*t);
    function hrun(S,f,N){
      const g=S.map(q=>f(q[0],q[1]));
      let a=g.findIndex(v=>v>=0), b=a; while(b+1<S.length && g[b+1]>=0) b++;
      if(a<0){ a=g.indexOf(Math.max(...g)); b=a; }
      const R=S.slice(a,b+1);
      if(a>0) R.unshift(lerp(S[a-1],S[a],g[a-1]/(g[a-1]-g[a])));
      if(b<S.length-1) R.push(lerp(S[b],S[b+1],g[b]/(g[b]-g[b+1])));
      const c=[0]; for(let i=1;i<R.length;i++) c.push(c[i-1]+Math.hypot(R[i][0]-R[i-1][0],R[i][1]-R[i-1][1]));
      const out=[]; let j=0;
      for(let k=0;k<N;k++){ const s=c[c.length-1]*k/(N-1); while(j<R.length-2 && c[j+1]<s) j++; out.push(lerp(R[j],R[j+1],Math.min(1,(s-c[j])/((c[j+1]-c[j])||1)))); }
      return out;
    }
    // a skin off m proud of the rim: one ring per X, f(X) -> the stretch to cover
    function hskin(xs,f,N,off,mat,reach){
      const RR=xs.map(X=>[X,hrun(hside(X,reach||7.5),f(X),N)]);
      [1,-1].forEach(mz=>loft(RR.map(([X,R])=>{ const p=[];
        R.forEach(q=>p.push(P(X,q[1]+off*q[3],(q[0]+off*q[2])*mz)));
        for(let k=R.length-1;k>=0;k--){ const q=R[k]; p.push(P(X,q[1]-0.3*q[3],(q[0]-0.3*q[2])*mz)); }
        return { p }; }),{ mat }));
    }
    // targeting sensors: an angled panel on each forward flank (side view: slanted ends, the bottom rising forward), a dark stepped plate in it
    hskin(stations([[115,116.2,0.6],[116.2,128.4,2],[128.4,131.5,0.8]]), X=>{ const t=9.2+0.05*(X-115), W=Math.max(SZ+0.25,HW(X)),
      b=X<116.2 ? t+(20.6-t)*(X-115)/1.2 : X<128.4 ? 20.6-1.4*(X-116.2)/12.2 : 19.2+(t-19.2)*(X-128.4)/3.1;
      return (l,D)=>Math.min(D-t, Math.max(t+0.6,b)-D, l-W+7); }, 10, 0.15, "hull2");
    hskin(stations([[119.8,122.6,1.4],[122.6,123.4,0.8],[123.4,126.8,1.7]]), X=>(l,D)=>Math.min(D-15.2-(X<122.6?0:1.1*sstep(122.6,123.4,X)), 18.4-D, l-HW(X)+7), 6, 0.25, "dark");
    // the dark cut aft of them: a slit round the rim, and a groove along the deck and keel inboard of the panel
    hskin(stations([[112.9,114.4,0.75]]), X=>l=>l-31, 16, 0.1, "dark", 11);
    [1,-1].forEach(s=>hskin(stations([[114.4,129.5,3]]), X=>(l,D)=>Math.min(l-30, 30.6-l, s*(15-D)), 3, 0.06, "dark", 11));

    /* ---------------- dorsal spine: narrow aft, running into the round bridge platform ---------------- */
    const SPN=tab([[21.4,12.8],[29,13.7],[50,16.7],[61,18.8],[72,20.8],[80,21.6],[86,0]]);
    const SW=X=>Math.max(X<86?SPN(X):0, 22.5*Math.sqrt(Math.max(0,1-Math.pow((X-86)/22.5,2))));
    const ST=tab([[21.4,5.0],[22.6,3.1],[24,1.8],[30,1.6],[38,1.35],[42,1.25],[45,1.0],[58,1.0],[62,0.85],[70,0.7],[75,0.6],[90,0.6],[95,0.95],[99,1.35],[102,1.8],[105.6,2.4],[108.6,3.6]]);
    skin("top",()=>xbody(stations([[21.4,24,0.4],[24,104,1.2],[104,108.5,0.45]]), X=>({ w:Math.max(0.4,SW(X)), dt:ST(X), db:8.5, rt:1.2, rb:0.5, tt:0.05, nh:16, nv:3, nc:4 }), {}));
    const SF=X=>0.95*(SW(X)-1.2);   // edge of the spine's flat top

    /* ---------------- forward deck: the raised inner ellipse, cut by the slot ---------------- */
    const FW=tab([[90,24],[100,23.5],[110,21],[118,17.5],[124,15.2],[SLOT,14.2]]);
    const FT=tab([[90,4.0],[100,4.6],[108.9,5.2],[112.6,5.7],[116,6.2],[119.3,6.7],[122.7,7.2],[126,7.5],[SLOT,7.6]]);
    skin("top",()=>xbody(stations([[90,SLOT,1]]), X=>({ w:FW(X), dt:FT(X), db:12, rt:1.2, rb:0.5, nh:16, nv:3, nc:4 }), {}));
    // sensor pallets flanking the centerline: dark greebled wells, stepped aft-inboard, the outer fore corner cut
    { const zi=tab([[112.3,10.2],[114.9,10.2],[115.3,5.4],[120.1,5.4]]), zo=X=>Math.min(17.6-1.2*Math.max(0,X-116.3),FW(X)-1);
      const box=(x0,x1,z0,z1,h,mz)=>xbody([x0,x1], X=>({ lc:(z0+z1)/2, w:(z1-z0)/2, dt:FT(X)-0.1-h, db:FT(X), rt:0.08, nh:1, nv:1, nc:1 }), { mat:"hull2", mz });
      [1,-1].forEach(mz=>{
        xbody(stations([[112.3,113.1,0.4],[113.1,114.7,0.8],[114.7,115.5,0.2],[115.5,119.3,0.95],[119.3,120.1,0.4]]),
          X=>{ const a=zi(X), b=zo(X)-rnd(112.3,120.1,0.8,X); return { lc:(a+b)/2, w:(b-a)/2, dt:FT(X)-0.1, db:FT(X)+0.3, rt:0.05, nh:2, nv:1, nc:1 }; }, { mat:"dark", mz });
        box(112.9,114.5,13.2,16.6,0.45,mz); box(113.2,114.4,10.8,12.4,0.6,mz); box(115.9,117.5,6.1,8.3,0.35,mz);
        box(117.7,119.4,6.3,10.4,0.55,mz); box(116.2,117.9,10.0,12.9,0.3,mz);
      }); }

    /* ---------------- deflector / torpedo module ---------------- */
    const MW=tab([[124,12.6],[143,13],[146.7,13.05],[150.1,12.85],[153.5,12.25],[156.9,11.75],[160.4,11.05],[163.8,10.35],[167.2,9.55],[169.6,8.6],[170.6,7.2]]);
    const MT=tab([[124,7.4],[133,7.4],[136.4,7.8],[139.8,8.3],[143.2,8.8],[146.6,9.6],[149.9,10.4],[153.3,11.4],[156.7,12.5],[160.3,13.7],[163.7,15.0],[167,16.9],[169.6,18.7],[170.6,19.6]]);
    const MB=tab([[124,17.6],[127.5,18.6],[131,20.3],[135,21.3],[140,21.7],[143.2,23.2],[146.6,24.35],[150,24.55],[163.7,24.75],[165.5,24.5],[167,23.6],[169,21.6],[170.6,20.3]]);
    // narrow below (front view: a trapezoid with open notches beside it), a little fuller where it clears the jaws
    const MK=X=>0.35+0.15*sstep(141,146.5,X), MLW=tab([[18.3,14],[18.9,10.6],[19.6,10.25],[21.4,9.35],[22.8,8.35],[23.5,7.75],[24.1,6.4],[24.7,4.6],[25.3,0.5]]);
    const xsM=stations([[124,166,1],[166,170.6,0.4]]), MN=2*14+2*7+4*5, T0=M.i.length;
    skin("top",()=>xbody(xsM, X=>({ w:MW(X), dt:MT(X), db:MB(X), rt:1.2, rb:3.5, taper:MK(X), nh:14, nv:7, nc:5 }), { lim:MLW }));
    /* the deflector: lenses laid on the module's lower front along rays cast aft
       from the front view: a rim, the glow inside it, a Y strut across the glow */
    const cast=(()=>{
      // the module's triangles near the deflector, binned on a 1 m grid in (y, z)
      const p=M.p, I=M.i, B=[], key=(y,z)=>(Math.floor(y)+40)*64+Math.floor(z)+32;
      // (the loft emits its MN-point rings in station order: skip the spans aft of X 162)
      for(let t=T0+6*MN*Math.max(0,xsM.findIndex(x=>x>162)-1);t<I.length;t+=3){ const a=I[t]*3, b=I[t+1]*3, c=I[t+2]*3;
        if(Math.max(p[a],p[b],p[c])<163-X0) continue;
        const y0=Math.min(p[a+1],p[b+1],p[c+1]), y1=Math.max(p[a+1],p[b+1],p[c+1]); if(y1<Y0-25.5||y0>Y0-19) continue;
        const z0=Math.min(p[a+2],p[b+2],p[c+2]), z1=Math.max(p[a+2],p[b+2],p[c+2]);
        for(let y=Math.floor(y0);y<=y1;y++) for(let z=Math.floor(z0);z<=z1;z++){ const k=key(y,z); (B[k]||(B[k]=[])).push(a,b,c); } }
      return (D,z)=>{ const y=Y0-D, L=B[key(y,z)]||[]; let best=null;
        for(let i=0;i<L.length;i+=3){ const a=L[i], b=L[i+1], c=L[i+2];
          const ay=p[a+1], az=p[a+2], by=p[b+1]-ay, bz=p[b+2]-az, cy=p[c+1]-ay, cz=p[c+2]-az, py=y-ay, pz=z-az, det=by*cz-bz*cy;
          if(Math.abs(det)<1e-12) continue;
          const s=(py*cz-pz*cy)/det, t=(by*pz-bz*py)/det; if(s<-1e-7||t<-1e-7||s+t>1+1e-7) continue;
          const bx=p[b]-p[a], cx=p[c]-p[a], x=p[a]+s*bx+t*cx; if(best && x<=best[0]) continue;
          const nx=by*cz-bz*cy, ny=bz*cx-bx*cz, nz=bx*cy-by*cx, l=Math.hypot(nx,ny,nz)||1;
          best=[x,nx/l,ny/l,nz/l]; }
        return best || [170.6-X0,1,0,0]; };
    })();
    // outline O ([z, D] points) shrunk toward (zc, Dc) in rings at scales S, off m proud; closed by a sunk copy of the outline
    function decal(O,zc,Dc,off,mat,S){
      const c0=[cast(Dc,zc),Dc,zc], H=[O.map(()=>c0)], K=S.length;
      S.forEach(s=>H.push(O.map(([z,D])=>{ const zz=zc+(z-zc)*s, DD=Dc+(D-Dc)*s; return [cast(DD,zz),DD,zz]; })));
      const ring=(h,o)=>({ p:h.map(([c,D,z])=>[c[0]+o*c[1], Y0-D+o*c[2], z+o*c[3]]) });
      loft(H.map(h=>ring(h,off)).concat([ring(H[K],-0.2)]),{ mat, cap0:false });
    }
    // closed polygon through the corners, resampled every ds m
    const poly=(C,ds)=>{ const O=[]; C.forEach((a,i)=>{ const b=C[(i+1)%C.length], n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/ds)); for(let k=0;k<n;k++) O.push(lerp(a,b,k/n)); }); return O; };
    // a front-view outline: half-width a, D from d0 to d1, top corner radius rt, bottom corners rz x rd
    const lens=(a,d0,d1,rt,rz,rd)=>{ const C=[], arc=(cz,cD,qz,qd,a0)=>{ for(let k=0;k<=6;k++){ const t=a0+k/6*PI/2; C.push([cz+qz*Math.cos(t), cD-qd*Math.sin(t)]); } };
      arc(a-rt,d0+rt,rt,rt,0); arc(-a+rt,d0+rt,rt,rt,PI/2); arc(-a+rz,d1-rd,rz,rd,PI); arc(a-rz,d1-rd,rz,rd,1.5*PI);
      return poly(C.filter((q,i)=>i===0||Math.hypot(q[0]-C[i-1][0],q[1]-C[i-1][1])>1e-6),0.8); };
    decal(lens(7.8,19.9,24.45,0.4,7.8,4.0),0,22.2,0.06,"hull2",[0.5,0.78,1]);
    decal(lens(6.6,20.3,23.3,0.35,4.2,2.4),0,21.8,0.16,"deflector",[0.35,0.6,0.8,1]);
    [1,-1].forEach(s=>{ const a=[2.95*s,20.15], b=[0.95*s,23.2], d=[b[0]-a[0],b[1]-a[1]], L=Math.hypot(d[0],d[1]), q=[-d[1]/L*0.36,d[0]/L*0.36];
      decal(poly([[a[0]+q[0],a[1]+q[1]],[b[0]+q[0],b[1]+q[1]],[b[0]-q[0],b[1]-q[1]],[a[0]-q[0],a[1]-q[1]]],0.4),(a[0]+b[0])/2,(a[1]+b[1])/2,0.26,"hull",[0.5,1]); });
    decal(poly([[1.0,23.0],[-1.0,23.0],[-1.0,24.3],[1.0,24.3]],0.4),0,23.65,0.26,"hull",[0.5,1]);
    // dark lining of the slot, showing as a gap around the module
    xbody(stations([[SLOT-0.1,145.6,0.75]]), X=>({ w:SZ-0.1, dt:MT(X)+0.5, db:l=>Math.abs(l)>10.8 ? 18.75 : Math.min(19.3,MB(X)-1), rt:1.4, rb:0.4, nh:14, nv:4, nc:4 }), { mat:"dark" });
    // the U-shaped clamp under the module's root, open toward the bow
    xbody(stations([[127,129.2,0.55]]), X=>({ w:7.5, dt:MB(X)-1.2, db:MB(X)+0.2, rt:0.3, rb:0.15, nh:8, nv:2, nc:3 }), { mat:"hull2" });
    [1,-1].forEach(mz=>xbody(stations([[128.6,137,1.05]]), X=>({ lc:6.6, w:0.9, dt:MB(X)-1.8, db:MB(X)+0.2, rt:0.2, nh:2, nv:2, nc:3 }), { mat:"hull2", mz }));

    /* ---------------- warp nacelles ----------------
       local frame: u along the pod from its rear face, v outboard from the
       rear inner corner; the pod toes out 8.3 deg toward the bow */
    const th=8.3*PI/180, ct=Math.cos(th), sn=Math.sin(th);
    const NX=(u,v)=>41.2+u*ct-v*sn, NZ=(u,v)=>33.95+u*sn+v*ct;
    // depths from the front view, +0.7 m to the side view's datum
    const NTOP=tab([[-5,6.6],[-2,6.2],[1.5,6.5],[4.1,7.0],[6.7,7.7],[9.3,8.3],[11.8,9.1],[14.4,10.0],[17.1,11.2],[19.6,12.7],[21.4,14.3],[22.4,16.0],[22.9,17.3]]);
    const NBOT=tab([[-5,23.4],[-4,25.4],[-2.5,26.6],[0,27.0],[4.1,26.6],[6.7,26.4],[9.3,26.0],[11.8,25.7],[14.4,25.2],[17.1,24.4],[19.6,23.3],[21.4,21.7],[22.4,19.7],[22.9,17.9]]);
    const UF=tab([[-5,54.2],[0,55.0],[6,55.45],[22.9,53.24]]), VO=22.9, RP=3.5, NR=(hh,r)=>Math.min(r||3.2,hh*0.95);
    const ends=v=>{ const e=v>VO-RP ? RP-Math.sqrt(Math.max(0,RP*RP-Math.pow(v-(VO-RP),2))) : 0; return [e, UF(v)-e]; };
    // the end faces sit back a little where the glow plates stand on them
    const endsB=v=>{ const [u0,u1]=ends(v), k=1-sstep(20.5,22,v); return [u0+0.12*sstep(-3,-1.5,v)*k, u1-0.15*sstep(0,2,v)*k]; };
    // the outboard rear grows taller for the grille bay; the front corners tighten outboard so the front face stays tall
    const NA=(u,v)=>sstep(8,14,v)*Math.max(0,1-u/15), NT=(u,v)=>NTOP(v)-1.5*NA(u,v), NB=(u,v)=>NBOT(v)+0.4*NA(u,v);
    // (a bigger rear bottom radius and less growth below keep the side view's chamfered rear corner)
    const RS=v=>sstep(2,8,v), RFT=v=>4.2-1.8*RS(v), RFB=v=>4.8-2.2*RS(v), RRT=1.6, RRB=2.1;
    // the flat part of the front (f) or rear face: [top, bottom]
    const face=(f,v)=>{ const [u0,u1]=endsB(v), hh=(NBOT(v)-NTOP(v))/2, u=f?u1:u0, h2=(NB(u,v)-NT(u,v))/2;
      return [NT(u,v)+Math.min(0.999,NR(hh,f?RFT(v):RRT)/hh)*h2, NB(u,v)-Math.min(0.999,NR(hh,f?RFB(v):RRB)/hh)*h2]; };
    const GT=v=>16.35-0.28*(v-12.2), GB=v=>21.5-0.135*(v-12.2);
    const BT=tab([[-1.8,7.3],[0,7.5],[6,8.6],[10,9.8],[14,11.0],[18,12.9],[21.5,15.5]]), BB=tab([[-1.8,23.6],[0,24.5],[6,24.9],[10,24.4],[14,24.0],[18,22.8],[21.5,19.0]]);
    /* the front trim band follows the slanted front face, so in the side view its lower half would turn
       forward again (a '<'); SH(D) shifts it aft in u so it keeps sweeping back to the keel */
    const ubF=v=>{ const [u0,u1]=ends(v); return Math.min(u1-0.5,Math.max(u0+0.5,UF(v)-3.6-0.3*u0)); };
    const SV=stations([[0,VO,0.5]]), XU=tab(SV.map(v=>[NTOP(v)-0.1,NX(ubF(v),v)])), XL=tab(SV.slice().reverse().map(v=>[NBOT(v)+0.1,NX(ubF(v),v)]));
    const BD0=NBOT(VO)+0.1, BD1=NBOT(0)+0.1, BDm=NTOP(VO)-0.1, bsl=(XU(BDm)-XU(BDm-1.5))/1.5;
    // (the side view's slope at mid-height carries on and eases out 6 m lower; the keel ends nearly square across the pod bottom)
    const SH=D=>{ if(D<=BD0) return 0; const e=Math.min(D-BD0,6); return Math.max(0,(XL(D)-XL(BD0)-bsl*(e-e*e/12))/ct); };
    function nacelle(mz){
      const Q=(u,v,D)=>P(NX(u,v),D,NZ(u,v)*mz);
      const vs=stations([[-5,-2,0.5],[-2,18,1],[18,22.9,0.35]]);
      const i0=M.i.length;
      loft(vs.map(v=>{
        const [u0,u1]=endsB(v), hh=(NBOT(v)-NTOP(v))/2;
        return { p:sec({ lc:(u0+u1)/2, w:(u1-u0)/2, dt:u=>NT(u,v), db:u=>NB(u,v), r4:[NR(hh,RFT(v)),NR(hh,RRT),NR(hh,RRB),NR(hh,RFB(v))], nh:26, nv:6, nc:6 },
          (u,D)=>Q(u,v,D)), c:v };
      }),{});
      SK.top.push(i0,M.i.length,0); SK[mz>0?"s1":"s2"].push(i0,M.i.length,0);
      /* a plate pr proud of the front (f) or rear face, v from va to vb, D from top(v) to bot(v)
         kept on the flat face, its ends rounded with radius rc */
      const fp=(f,va,vb,top,bot,pr,rc,mat)=>loft(stations([[va,va+rc,rc/3],[va+rc,vb-rc,1.1],[vb-rc,vb,rc/3]]).map(v=>{
        const [u0,u1]=endsB(v), [ft,fb]=face(f,v), d=Math.min(v-va,vb-v), q=d<rc ? rc-Math.sqrt(Math.max(0,rc*rc-(rc-d)*(rc-d))) : 0;
        let t=Math.max(top(v),ft+0.08)+q, b=Math.min(bot(v),fb-0.08)-q;
        if(b-t<0.05){ const m=(t+b)/2; t=m-0.025; b=m+0.025; }
        const ua=f ? u1+pr : u0-pr, ub=f ? u1-1 : u0+1;
        return { p:sec({ lc:(ua+ub)/2, w:Math.abs(ua-ub)/2, dt:t, db:b, rt:0.1, nh:1, nv:3, nc:2 }, (u,D)=>Q(u,v,D)), c:v };
      }),{ mat });
      // front: a dark recess over the face, the pulse phaser glow in it, two bars across the glow
      fp(true,1,21.6,v=>0,v=>99,0.06,2,"dark");
      fp(true,5.5,18.5,GT,GB,0.21,1.2,"bussard");
      [[17.9,0.28],[20.4,0.25]].forEach(([d,s])=>fp(true,5.9,18.1,v=>d-s*(v-12.2)-0.2,v=>d-s*(v-12.2)+0.2,0.3,0.2,"dark"));
      // rear: the warp grille bay, a dark recess with the blue glow, a strut and a fine diamond mesh over all of the glow
      fp(false,-1.8,21.6,v=>BT(v)-0.35,v=>BB(v)+0.35,0.06,2.6,"dark");
      fp(false,-1.4,21.2,BT,BB,0.15,2.3,"grille");
      fp(false,7.6,10,v=>BT(v)+0.3,v=>BB(v)-0.3,0.3,0.3,"hull2");
      // a strand of the mesh, stepped every meter so it follows the face where it curves toward the outboard tip
      // (a straight chord would sink into the glow plate there)
      const bar=(a,b)=>{ const dv=b[0]-a[0], dd=b[1]-a[1], L=Math.hypot(dv,dd), nv=-dd/L*0.07, nd=dv/L*0.07, n=Math.max(1,Math.ceil(L));
        const pts=[]; for(let i=0;i<=n;i++) pts.push([a[0]+dv*i/n, a[1]+dd*i/n]);
        loft(pts.map(([v,D])=>({ p:[[0.22,1],[0.3,1],[0.3,-1],[0.22,-1]].map(([pr,s])=>Q(endsB(v)[0]-pr,v+s*nv,D+s*nd)) })),{ mat:"dark" }); };
      // the two bays either side of the strut, edge to edge of the glow
      [[-1.2,7.55],[10.05,21.0]].forEach(([va,vb])=>{
        const ok=(v,D)=>D>BT(v)+0.18 && D<BB(v)-0.18, s=0.84, p=1.05, da=BT((va+vb)/2), db=BB((va+vb)/2);
        [s,-s].forEach(sl=>{ for(let k=-24;k<=24;k++){
          const Dl=v=>(da+db)/2+sl*(v-(va+vb)/2)+k*p; let run=null;
          for(let i=0;i<=80;i++){ const v=va+(vb-va)*i/80; if(ok(v,Dl(v))){ if(!run) run=[v,v]; else run[1]=v; } else if(run) break; }
          if(run && run[1]-run[0]>0.2) bar([run[0],Dl(run[0])],[run[1],Dl(run[1])]);
        } });
      });
      // trim bands wrapping the pod near both ends, straight across the rounded outboard end
      const band=front=>loft(stations([[-5,-2,1],[-2,18,2],[18,22.9,0.5]]).concat([VO+0.12]).map(v=>{
        const vv=Math.min(v,VO), [u0,u1]=ends(vv), ub=front ? ubF(vv) : Math.min(u1-0.5,Math.max(u0+0.5,3.6+0.3*u0));
        return { p:sec({ lc:ub, w:0.4, dt:NT(ub,vv)-0.1, db:NB(ub,vv)+0.1, rt:0.05, nh:2, nv:6, nc:2 },
          (u,D)=>Q(front ? u-SH(D) : u,v,D)), c:v };
      }),{ mat:"trim" });
      band(true); band(false);
      // registry stripe and chevron along the outboard edge
      const RD=(NTOP(VO)+NBOT(VO))/2, sd=[-sn,0,ct*mz], rs=(u,d,o)=>{ const q=Q(u,VO+0.1,RD+d); return Object.assign({ x:q[0], y:q[1], z:q[2], w:0.06, n:4 },o); };
      G.sweep(M,{ side:sd, seg:8, res:1, mat:"trim", st:stations([[10,41.2,3.1]]).map(u=>rs(u,0,{ t:0.6, b:0.6 })) });
      G.sweep(M,{ side:sd, seg:8, res:1, mat:"paint", st:stations([[13,37,3]]).map(u=>rs(u,0,{ w:0.09, t:0.12, b:0.12 })) });
      // fairing on the inboard rear of the pod (the fin in the side view)
      const FH=tab([[2.5,6.6],[5,4.4],[9,3.9],[13,4.3],[19,6.4]]), FV=tab([[2.5,1.0],[6,2.4],[13,2.4],[19,0.9]]);
      loft(stations([[2.5,19,0.6]]).map(u=>({ p:sec({ lc:0.2, w:FV(u), dt:FH(u), db:8, rt:1.1, rb:0.2, tt:0.2, nh:6, nv:3, nc:4 },
        (v,D)=>Q(u,v,D)), c:u })),{});
    }
    nacelle(1); nacelle(-1);

    /* ---------------- bridge platform: two terraces and the bridge block ---------------- */
    const BC=86;
    [[13.6,0.1,0],[9.0,0.2,0.1]].forEach(([R,h,h0])=>{
      skin("top",()=>plate(BC,[[0,h],[4,h],[7.5,h],[11,h]].filter(q=>q[0]<R-1).concat([[R-0.35,h,1],[R,h0+0.02,1],[R,h0-0.3]]),ST,1,{ n:Math.round(R*7), cap:false }),1);
      plate(BC,[[R,h0-0.1],[R,h0+0.05,1],[R+0.4,h0+0.05,1],[R+0.4,h0-0.1]],ST,1,{ mat:"dark", n:Math.round(R*7), cap:false });
    });
    const BW=tab([[76.8,0.8],[77.4,4.3],[78.6,4.9],[84,5.0],[87,4.4],[89.3,3.0],[90.3,1.5],[90.6,0.5]]);
    // the side and front silhouettes leave no height for more: the dome top is the model's top
    const bx=stations([[76.8,78.6,0.3],[78.6,88.4,1.1],[88.4,90.6,0.3]]);
    xbody(bx, X=>({ w:BW(X), dt:ST(X)-0.3, db:ST(X)-0.05, rt:0.3, rb:0.05, tt:0.15, nh:8, nv:2, nc:4 }), { mat:"hull2" });
    xbody([76.5].concat(bx.slice(1,-1),[90.9]), X=>({ w:BW(Math.min(90.6,Math.max(76.8,X)))+0.35, dt:ST(X)-0.225, db:ST(X)-0.05, rt:0.05, nh:8, nv:1, nc:2 }), { mat:"dark" });
    disc(81.2,0,[[0,-0.08],[0.8,-0.07],[1.3,-0.045],[1.6,-0.01],[1.75,0.03,1],[1.75,0.2]].map(([r,d,k])=>[r,ST(81.2)-0.3+d,k]),{ n:28 });

    /* ---------------- paint and lettering, laid on the hull by rays cast along one axis ----------------
       caster(ax, sg, R): the triangles in the ranges R of M.i, binned by centroid on a 2 m grid across
       axis ax; it maps a point (a, b) of that plane to the outermost hit seen from the sg side,
       [x,y,z, nx,ny,nz] with the normal toward that side (a hit is searched in the 3 x 3 cells around) */
    function caster(ax,sg,R){
      const p=M.p, I=M.i, A=ax===0?2:0, B=ax===1?2:1, a0=-45, b0=-36, na=90, nb=72, st=new Int32Array(na*nb+1), fs=ax===2?sg:-sg;
      let n=0; for(let r=0;r<R.length;r+=3) n+=(R[r+1]-R[r])/3;
      const C=new Int32Array(n), T=new Int32Array(n);
      let m=0;
      for(let r=0;r<R.length;r+=3) for(let t=R[r], open=R[r+2];t<R[r+1];t+=3){
        const a=I[t]*3, b=I[t+1]*3, c=I[t+2]*3, xa=p[a+A], ya=p[a+B], xb=p[b+A], yb=p[b+B], xc=p[c+A], yc=p[c+B];
        if(!open && fs*((xb-xa)*(yc-ya)-(yb-ya)*(xc-xa))<=0) continue;
        const i=Math.floor((xa+xb+xc)/6)-a0, j=Math.floor((ya+yb+yc)/6)-b0;
        if(i<0||j<0||i>=na||j>=nb) continue;
        const k=i*nb+j; C[m]=k; T[m++]=t; st[k+1]++;
      }
      for(let k=1;k<st.length;k++) st[k]+=st[k-1];
      const L=new Int32Array(m), cur=st.slice(0,-1);
      for(let s=0;s<m;s++) L[cur[C[s]]++]=T[s];
      return (qa,qb)=>{
        const i0=Math.floor(qa/2)-a0, j0=Math.floor(qb/2)-b0;
        let best=null, bv=-1e9;
        for(let i=Math.max(0,i0-1);i<=Math.min(na-1,i0+1);i++) for(let j=Math.max(0,j0-1);j<=Math.min(nb-1,j0+1);j++)
        for(let k=st[i*nb+j];k<st[i*nb+j+1];k++){
          const t=L[k], a=I[t]*3, b=I[t+1]*3, c=I[t+2]*3;
          const ua=p[b+A]-p[a+A], ub=p[b+B]-p[a+B], va=p[c+A]-p[a+A], vb=p[c+B]-p[a+B], det=ua*vb-ub*va;
          if(Math.abs(det)<1e-9) continue;
          const wa=qa-p[a+A], wb=qb-p[a+B], s=(wa*vb-wb*va)/det, r=(ua*wb-ub*wa)/det;
          if(s<-1e-6||r<-1e-6||s+r>1+1e-6) continue;
          const h=p[a+ax]+s*(p[b+ax]-p[a+ax])+r*(p[c+ax]-p[a+ax]);
          if(sg*h<=bv) continue; bv=sg*h;
          const e=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]], f=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]];
          const n=[e[1]*f[2]-e[2]*f[1], e[2]*f[0]-e[0]*f[2], e[0]*f[1]-e[1]*f[0]], l=Math.hypot(n[0],n[1],n[2])*(n[ax]*sg<0?-1:1);
          best=[0,0,0,n[0]/l,n[1]/l,n[2]/l]; best[A]=qa; best[B]=qb; best[ax]=h;
        }
        return best;
      };
    }
    // ship-frame wrappers: top (X, z) from above; sides (X, D) from starboard or port
    // @t casters
    const CT=caster(1,1,SK.top), CS=[caster(2,1,SK.s1), caster(2,-1,SK.s2)];
    const top=(X,z)=>CT(X-X0,z), side=sg=>(X,D)=>CS[sg>0?0:1](X-X0,Y0-D);
    const lay=(cs,q,o)=>{ const h=cs(q[0],q[1]); return h ? [h[0]+o*h[3],h[1]+o*h[4],h[2]+o*h[5]] : null; };
    // a paint panel: convex outline C (plane points) laid off m proud, its rim sunk into the hull
    function panel(cs,C,mat,off){
      const O=poly(C,0.9), c=[0,0]; O.forEach(q=>{ c[0]+=q[0]/O.length; c[1]+=q[1]/O.length; });
      const rm=Math.max(...O.map(q=>Math.hypot(q[0]-c[0],q[1]-c[1]))), K=Math.max(1,Math.ceil(rm/1.3)), H=O.map(q=>cs(q[0],q[1])), m=lay(cs,c,off);
      if(!m || H.some(h=>!h)) return;
      const at=o=>({ p:H.map(h=>[h[0]+o*h[3],h[1]+o*h[4],h[2]+o*h[5]]) }), R=[{ p:O.map(()=>m) }];
      for(let k=1;k<K;k++){ const s=k/K; R.push({ p:O.map(q=>lay(cs,[c[0]+(q[0]-c[0])*s,c[1]+(q[1]-c[1])*s],off)) }); }
      R.push(Object.assign(at(off),{ k:1 }), at(-0.25));
      if(R.every(r=>r.p.every(q=>q))) loft(R,{ mat, cap:false });
    }
    // rows of points -> a quad strip
    function strip(R,mat){
      const m=G.MATS[mat], s0=M.p.length/3, n=R[0].length;
      R.forEach(r=>r.forEach(q=>{ M.p.push(q[0],q[1],q[2]); M.m.push(m); M.w.push(0); M.c.push(0); }));
      for(let i=0;i<R.length-1;i++) for(let j=0;j<n-1;j++){ const a=s0+i*n+j, b=a+n; M.i.push(a,b,a+1, a+1,b,b+1); }
    }
    // a squared, extended sans: [advance, polylines]; cap height 1, stroke centerlines
    const FONT={ "N":[1.2,[[0,0,0,1,1.2,0,1.2,1]]], "X":[1.2,[[0,0,1.2,1],[0,1,1.2,0]]], "-":[0.6,[[0,0.5,0.6,0.5]]],
      "7":[1.15,[[0,1,1.15,1,0.4,0]]], "4":[1.2,[[0.9,0,0.9,1,0,0.32,1.2,0.32]]], " ":[0.35,[]], ".":[0,[[0,0.06,0.001,0.06]]],
      "2":[1.2,[[0,1,1.02,1,1.2,0.82,1.2,0.68,1.02,0.5,0.18,0.5,0,0.32,0,0,1.2,0]]],
      "0":[1.2,[[0.18,0,1.02,0,1.2,0.18,1.2,0.82,1.02,1,0.18,1,0,0.82,0,0.18,0.18,0]]],
      "5":[1.2,[[1.2,1,0,1,0,0.5,1.02,0.5,1.2,0.32,1.2,0.18,1.02,0,0,0]]],
      "U":[1.2,[[0,1,0,0.18,0.18,0,1.02,0,1.2,0.18,1.2,1]]], "S":[1.2,[[1.2,1,0.18,1,0,0.82,0,0.68,0.18,0.5,1.02,0.5,1.2,0.32,1.2,0.18,1.02,0,0,0]]],
      "D":[1.2,[[0,0,0,1,0.95,1,1.2,0.75,1.2,0.25,0.95,0,0,0]]], "E":[1.1,[[1.1,1,0,1,0,0,1.1,0],[0,0.5,0.9,0.5]]],
      "F":[1.1,[[1.1,1,0,1,0,0],[0,0.5,0.9,0.5]]], "I":[0,[[0,0,0,1]]], "A":[1.3,[[0,0,0.65,1,1.3,0],[0.26,0.4,1.04,0.4]]],
      "T":[1.2,[[0,1,1.2,1],[0.6,1,0.6,0]]] };
    /* a line of text centered on s=0: cap height h; L(s, t) maps text space (s along the line, t up, m) to the
       caster's plane; each stroke is a strip off m proud, cut every 0.5 m so it follows the hull */
    function text(cs,str,h,L,off,o){
      o=o||{}; const w=(o.w||0.17), sp=o.sp||0.32, ch=[...str], W=ch.reduce((s,c)=>s+FONT[c][0]+w+sp,-sp);
      let x=-W/2;
      ch.forEach(c=>{ const g=FONT[c];
        g[1].forEach(pl=>{ for(let i=0;i+3<pl.length;i+=2){
          const p=[(x+w/2+pl[i])*h,(w/2+pl[i+1]*(1-w))*h], q=[(x+w/2+pl[i+2])*h,(w/2+pl[i+3]*(1-w))*h];
          let d=[q[0]-p[0],q[1]-p[1]]; const l=Math.hypot(d[0],d[1]); d=l>1e-6?[d[0]/l,d[1]/l]:[1,0];
          const hw=w*h/2, n=[-d[1]*hw,d[0]*hw], a=[p[0]-d[0]*hw,p[1]-d[1]*hw], tl=l+2*hw, k=Math.max(1,Math.ceil(tl/0.5)), R=[];
          for(let j=0;j<=k;j++){ const s=tl*j/k, m=[a[0]+d[0]*s,a[1]+d[1]*s];
            R.push([lay(cs,L(m[0]+n[0],m[1]+n[1]),off), lay(cs,L(m[0]-n[0],m[1]-n[1]),off)]); }
          if(R.every(r=>r[0]&&r[1])) strip(R,o.mat||"dark");
        } });
        x+=g[0]+w+sp; });
    }
    // @t paint
    // darker panels (port outlines in X, z; mirrored), from the studio model's paint
    const arc=(r0,r1,f0,f1,n)=>{ const C=[]; for(let k=0;k<=n;k++){ const f=(f0+(f1-f0)*k/n)*PI/180; C.push([BC+r1*Math.cos(f),r1*Math.sin(f)]); }
      for(let k=n;k>=0;k--){ const f=(f0+(f1-f0)*k/n)*PI/180; C.push([BC+r0*Math.cos(f),r0*Math.sin(f)]); } return C; };
    const PAN=[
      // the band across the forward hull, from the spine's nose out to the nacelle's front
      [[106.4,-16.6],[111,-16.6],[111,-19.2],[106.4,-20.4]], [[106.2,-23.2],[110.9,-22.4],[110.9,-30.4],[105.6,-30.8]],
      [[105.6,-30.8],[110.9,-30.4],[106.6,-39.2],[101.6,-39.6]],
      // the forward deck's tip and the jaws beside the module
      [[121,-7.2],[126.6,-7.2],[126.6,-12.8],[121.6,-14.6]], [[129,-16.6],[137.5,-16.6],[135,-24.5],[128.6,-25.5]],
      [[117.6,-20.8],[124,-19.2],[126.6,-24.2],[119.2,-26.8]],
      // aft hull and stern
      [[12,-15],[21,-15],[21,-21],[12,-20.4]], [[23.5,-19.2],[34,-19.6],[34,-24.5],[23.5,-24]], [[10,-6.5],[16,-6.5],[16,-12.6],[10,-12.6]],
      // spine: a patch aft of the platform, the band round it outside the stripe
      [[63.5,-14.6],[70.4,-15.6],[70.4,-19.2],[63.5,-18]], arc(19.9,20.9,-118,-96,4), arc(19.9,20.9,-96,-70,4),
      // two arrows on the spine, pointing forward
      [[54,-9.7],[58.4,-9.7],[60.6,-10.95],[58.4,-12.2],[54,-12.2]],
      // the module: two plates either side of the targeting array's root
      [[131,-3.4],[139,-3.4],[139,-10.4],[132.6,-10.4]]];
    [1,-1].forEach(sg=>PAN.forEach(C=>panel(top,C.map(q=>[q[0],q[1]*sg]),"hull2",0.05)));
    // the light panels: the module's targeting array and two arcs aft on the platform
    const LIT=[[[140,-7.4],[149.4,-7.4],[149.4,-1.5],[141.8,-1.5]], [[150.5,-6.3],[154.3,-6.3],[154.3,-1.5],[150.5,-1.5]],
      [[155.2,-6.3],[165.2,-6.3],[166.6,-4.8],[166.6,-1.5],[155.2,-1.5]], arc(14.6,19,-172,-153,4)];
    [1,-1].forEach(sg=>LIT.forEach(C=>panel(top,C.map(q=>[q[0],q[1]*sg]),"paint",0.05)));
    // nacelle tops ([u, v] outlines): the big dark triangle forward, the vent plate aft
    const NP=[[[31,18.2],[51,18.2],[51,2]], [[6,7.4],[19,7.4],[19,13.6],[6,13.6]]];
    [1,-1].forEach(mz=>{ const T=(u,v)=>[NX(u,v),mz*NZ(u,v)];
      NP.forEach(C=>panel(top,C.map(q=>T(q[0],q[1])),"hull2",0.05));
      for(let k=0;k<5;k++){ const v=8.4+k*1.05; panel(top,[T(7.5,v),T(17.5,v),T(17.5,v+0.4),T(7.5,v+0.4)],"dark",0.09); } });
    // raised vent plates with ribs across them, and two round sensor domes (port X, z; mirrored)
    const vent=(C,ax,n)=>{ panel(top,C,"hull2",0.2);
      const [a,b,c]=C, e=[b[0]-a[0],b[1]-a[1]], f=[c[0]-b[0],c[1]-b[1]], d=ax?f:e, g=ax?e:f, w=0.12/Math.hypot(d[0],d[1]);
      const at=(t,u)=>[a[0]+d[0]*t+g[0]*u, a[1]+d[1]*t+g[1]*u];
      for(let k=0;k<n;k++){ const t=(k+0.6)/(n+0.2); panel(top,[at(t-w,0.12),at(t+w,0.12),at(t+w,0.88),at(t-w,0.88)],"dark",0.26); } };
    [1,-1].forEach(sg=>{ const Z=q=>[q[0],q[1]*sg];
      vent([[79.4,-25.6],[83.6,-25.6],[83.6,-28.8],[79.4,-28.8]].map(Z),0,6);
      vent([[15.4,-8.6],[18.4,-8.6],[18.4,-12],[15.4,-12]].map(Z),1,5);
      const T=(u,v)=>[NX(u,v),sg*NZ(u,v)];
      panel(top,[T(4,4.6),T(12.5,4.6),T(12.5,7.2),T(4,7.2)],"hull2",0.22);
      [[87.8,-28.3,1.05],[106.8,-20,0.85]].forEach(([X,z,r])=>{ const C=[]; for(let k=0;k<14;k++){ const a=k/14*2*PI; C.push([X+r*Math.cos(a),sg*z+r*Math.sin(a)]); }
        panel(top,C,"hull2",0.3); panel(top,C.map(q=>[X+(q[0]-X)*0.55,sg*z+(q[1]-sg*z)*0.55]),"dark",0.36); }); });
    // the module's ribbed center bar
    panel(top,[[149.6,-0.6],[165.4,-0.6],[165.4,0.6],[149.6,0.6]],"hull2",0.05);
    for(let X=150.4;X<165;X+=1.2) panel(top,[[X,-0.5],[X+0.4,-0.5],[X+0.4,0.5],[X,0.5]],"dark",0.08);
    // @t text
    // U.S.S. DEFIANT around the front of the platform, read from the bow; the letters stand inward
    { const rb=19.5, h=2.8, rm=rb-h/2;
      text(top,"U.S.S.DEFIANT",h,(s,t)=>{ const a=-s/rm, r=rb-t; return [BC+r*Math.cos(a), r*Math.sin(a)]; },0.08,{ w:0.2 }); }
    // the registry across the module's tip, read from the bow
    text(top,"NX-74205",1.25,(s,t)=>[168.8-t,-s],0.08,{ w:0.2 });
    [1,-1].forEach(mz=>{
      // on each nacelle top along its outboard edge, read from outboard
      text(top,"NX-74205",1.8,(s,t)=>{ const u=23+mz*s, v=17-t; return [NX(u,v),mz*NZ(u,v)]; },0.08,{ w:0.2 });
      // and on its outboard side, over and under the registry stripe
      text(side(mz),"NX-74205",1.6,(s,t)=>[57.5+mz*s,16.6-t],0.08,{ w:0.2 });
      text(side(mz),"U.S.S. DEFIANT",0.95,(s,t)=>[56.5+mz*s,20.6-t],0.08,{ w:0.2 });
    });

    /* ---------------- dorsal trim: centerline stripes, the U around the platform, plasma vents ---------------- */
    // a stripe pair on the centerline over the surface top(X); sg -1 runs it under the keel instead
    const stripe=(xs,top,sg)=>{ sg=sg||1;
      G.sweep(M,{ st:xs.map(X=>({ x:X-X0, y:Y0-top(X)+0.04*sg, z:0.9, w:0.3, t:sg>0?0.05:0.4, b:sg>0?0.4:0.05, n:4 })), seg:8, res:1, mat:"trim", mirror:true }); };
    // dorsal: from the stern over the spine's aft ramp, broken by the ribbed bar, ending at the bridge platform
    const TS=X=>X<21.4 ? HT(X) : Math.min(HT(X),ST(X));
    stripe(stations([[4,9.5,1.4]]),TS); stripe(stations([[10.3,21,1.3],[21,24.6,0.4],[24.6,27.6,1]]),TS); stripe(stations([[30.2,35,1.2]]),ST);
    stripe(stations([[51.4,63.3,1.5]]),ST); stripe(stations([[110,121,1.1]]),FT);
    // ventral: along the keel channel, around the ring and the aft cross panel
    [[11,28.8,3],[35.3,67.2,8],[103.4,113.5,5],[120.5,125.5,5]].forEach(r=>stripe(stations([r]),HC,-1));
    // the aft spine: two dark ribbed slots with lighter rims, and a raised ribbed bar between them
    [1,-1].forEach(mz=>{
      xbody(stations([[32.1,33.9,0.45],[33.9,45.3,2.3],[45.3,47.1,0.45]]), X=>({ lc:7.65, w:3.55-rnd(32.1,47.1,1.9,X), dt:ST(X)-0.12, db:ST(X)+0.4, rt:0.12, nh:3, nv:1, nc:1 }), { mz });
      xbody(stations([[32.5,34,0.5],[34,45.2,2.25],[45.2,46.7,0.5]]), X=>({ lc:7.65, w:3.15-rnd(32.5,46.7,1.5,X), dt:ST(X)-0.17, db:ST(X)+0.4, rt:0.08, nh:3, nv:1, nc:2 }), { mat:"dark", mz });
      [35.5,38.5,41.5,44.5].forEach(x=>xbody([x-0.2,x+0.2], X=>({ lc:7.65, w:2.95, dt:ST(X)-0.22, db:ST(X)-0.1, rt:0.03, nh:1, nv:1, nc:1 }), { mat:"hull2", mz }));
    });
    xbody(stations([[35.2,51.2,1.6]]), X=>({ w:0.9, dt:ST(X)-0.18, db:ST(X)+0.2, rt:0.15, nh:4, nv:2, nc:3 }), { mat:"hull2" });
    { const ring=(X,h)=>({ p:sec({ w:0.8, dt:ST(X)-h, db:ST(X)+0.1, rt:0.08, nh:2, nv:1, nc:1 },(l,D)=>P(X,D,l)), k:1 }), R=[ring(35.25,0.12)];
      for(let k=0;k<16;k++){ const a=35.4+k, b=35.95+k; R.push(ring(a,0.12),ring(a,0.32),ring(b,0.32),ring(b,0.12)); }
      loft(R.concat([ring(51.15,0.12)]),{}); }
    const chev=(xa,xb,za,y,o)=>G.sweep(M,{ seg:12, res:1, mat:"trim", side:[0,1,0], st:[
      Object.assign({ x:xa-X0, y:y(xa), z:za },o), Object.assign({ x:xb-X0, y:y(xb), z:0, k:1 },o), Object.assign({ x:xa-X0, y:y(xa), z:-za },o)] });
    // the arrowheads: a filled delta ahead of the dorsal stripes, and one at the end of each nacelle stripe
    const delta=(cs,x0,x1,y,h,s,off)=>{ const t=[x1,y], n=[x0+(x1-x0)*0.3,y];
      panel(cs,[t,[x0,y-h*s],n],"paint",off); panel(cs,[t,n,[x0,y+h*s]],"paint",off); };
    delta(top,120.9,124.4,0,1.9,1,0.07);
    { const RD=(NTOP(VO)+NBOT(VO))/2; [1,-1].forEach(mz=>delta(side(mz),79.2,83.6,RD,1.05,1,0.12)); }
    const UZ=tab([[25,11.6],[35,12.9],[45,14.0],[55,15.4],[62,16.5],[70,17.8],[76,18.7],[80,19.1],[84,19.3],[86,19.3]]);
    [1,-1].forEach(sg=>{
      const st=[], at=(X,z)=>st.push({ x:X-X0, y:Y0-ST(X)+0.04, z:sg*z, w:0.3, t:0.05, b:0.4, n:4 });
      for(let X=25;X<86;X+=2.5) at(X,Math.min(UZ(X),SF(X)-0.35));
      for(let i=0;i<=8;i++){ const f=21.5*i/8*PI/180; at(BC+19.3*Math.sin(f),19.3*Math.cos(f)); }
      G.sweep(M,{ st, seg:8, res:1, mat:"trim" });
    });
    [[50,23.5],[56,24.4],[62.5,25.5],[68.5,26.5]].forEach(([X,z])=>[1,-1].forEach(sg=>{ const d=HTOP(X,z);
      disc(X,sg*z,[[1.0,d+0.15],[1.0,d-0.1,1],[1.6,d-0.1,1],[1.6,d+0.15]],{ mat:"grille", n:20 }); }));
    // transverse sensor pod under the keel, aft of the ventral ring
    loft(stations([[-7.6,7.6,0.8]]).map(z=>({ p:sec({ lc:62, w:1.6*Math.sqrt(Math.max(0.02,1-Math.pow(z/7.6,4))), dt:HBOT(62,z)-0.15, db:HBOT(62,z)+0.47, rt:0.05, rb:0.3, nh:4, nv:2, nc:3 },
      (x,D)=>P(x,D,z)) })),{ mat:"hull2" });

    /* ---------------- ventral: the ring under the bridge, its red arcs, the shuttlebay hatch, module markings ---------------- */
    const VC=85.2;
    // open plates whose rims sink into the keel; extra rings follow the channel's edge
    const vp=(R,h,h2,o)=>plate(VC,[[0,h]].concat([13.6,14.6,15.4,16.2].filter(r=>r<R-0.4).map(r=>[r,h]),[[R-0.3,h,1],[R,h2,1],[R,-0.5]]),HBOT,-1,Object.assign({ cap:false },o));
    vp(17.8,0.15,0.03,{ mat:"hull2", n:112 }); vp(10.2,0.42,0.24,{ n:72 }); vp(5.8,0.6,0.46,{ n:44 });
    xbody(stations([[VC-2.1,VC+2.1,0.6]]), X=>({ w:2.1, dt:HC(X)+0.4, db:HC(X)+0.75, rt:0.1, rb:0.3, nh:4, nv:2, nc:3 }), { mat:"hull2" });
    [1,-1].forEach(sg=>{ const st=[];
      for(let i=0;i<=20;i++){ const a=(-47+94*i/20)*PI/180, X=VC+17*Math.sin(a), z=sg*17*Math.cos(a); st.push({ x:X-X0, y:Y0-HBOT(X,z)-0.16, z, w:0.08, t:0.3, b:0.3, n:4 }); }
      G.sweep(M,{ st, side:[0,1,0], seg:8, res:2, mat:"trim" });
    });
    { const st=[]; for(let X=141;X<=156+1e-6;X+=1.5) st.push({ x:X-X0, y:Y0-MB(X)-0.01, z:0, w:0.6, t:0.4, b:0.05, n:4 });
      G.sweep(M,{ st, seg:12, res:1, mat:"trim" }); }
    chev(156,159,1.7,X=>Y0-MB(X)-0.06,{ w:0.06, t:0.33, b:0.33, n:4 });

    /* ---------------- impulse engines and the stern ---------------- */
    [1,-1].forEach(sg=>{
      const round=(x0,x1,z,D,r,mat)=>xbody([x0,x1], X=>({ lc:z, w:r, dt:D-r, db:D+r, rt:r, nh:2, nv:2, nc:10 }), { mat, mz:sg });
      round(29.4,28.3,28.4,12.4,2.1,"dark");
      round(28.9,28.12,28.4,12.4,1.8,"impulse");
    });
    // aft torpedo launcher on the recessed stern face
    xbody([3.1,2.0], X=>({ w:8.1, dt:10.7, db:14.9, rt:1.2, nh:8, nv:3, nc:5 }), { mat:"dark" });
    xbody([2.8,1.75], X=>({ w:7.3, dt:11.2, db:14.4, rt:0.8, nh:8, nv:2, nc:5 }), { mat:"hull2" });
    return M;
  }
};
