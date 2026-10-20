/* =========================================================================
   HUD STYLE: LCARS (Accent)
   LCARS with its console colors built from the accent instead of the classic
   orange and lilac. Everything else is LCARS's own: the style's base is
   "lcars", so the body carries hud-lcars too, and the canvas parts are
   LCARS_HUD's, which read the --lc-* colors this style swaps.
   The seven colors keep their classic roles. Each is set in OKLCh: the
   lightness near the classic color's (0.69 to 0.89), so black button text
   reads the same on any hue, and the hue a little either side of the
   accent's. The saturated ones (orange, peach, gold, periwinkle) take the
   accent's chroma, raised to console strength unless the accent is close to
   gray, which gives a monochrome console; the muted ones (tan, lilac,
   blue-violet) are capped near the classic lilac's. Out-of-gamut colors lose
   chroma, never lightness. theme() writes them to --lca-* on the root, and
   hud/lcars-accent.css points the --lc-* colors at those.
   ========================================================================= */
const LCARS_ACCENT={
  // name, OKLab lightness (0: the accent's own, held to 0.72..0.86),
  // saturated or muted, chroma factor, hue offset in degrees
  ROLE:[ ["or",0,1,1,0], ["pch",0.77,1,1,-18], ["gold",0.86,1,0.9,14], ["per",0.71,1,1,24],
         ["tan",0.89,0,0.9,-8], ["lil",0.75,0,1,40], ["bv",0.69,0,0.85,18] ],
  SAT:0.14, MUTED:0.085,

  lin(c){ c/=255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); },
  gam(c){ return c<=0.0031308 ? 12.92*c : 1.055*Math.pow(c, 1/2.4)-0.055; },

  // OKLCh of an {r,g,b}, hue in radians
  lch({r,g,b}){
    r=this.lin(r); g=this.lin(g); b=this.lin(b);
    const l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b),
          m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b),
          s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b);
    const A=1.9779984951*l-2.4285922050*m+0.4505937099*s,
          B=0.0259040371*l+0.7827717662*m-0.8086757660*s;
    return [0.2104542553*l+0.7936177850*m-0.0040720468*s, Math.hypot(A,B), Math.atan2(B,A)];
  },

  // linear sRGB of an OKLCh color
  rgb(L, C, h){
    const A=C*Math.cos(h), B=C*Math.sin(h);
    const l=(L+0.3963377774*A+0.2158037573*B)**3,
          m=(L-0.1055613458*A-0.0638541728*B)**3,
          s=(L-0.0894841775*A-1.2914855480*B)**3;
    return [ 4.0767416621*l-3.3077115913*m+0.2309699292*s,
            -1.2684380046*l+2.6097574011*m-0.3413193965*s,
            -0.0041960863*l-0.7034186147*m+1.7076147010*s ];
  },

  // the color at L and h with the most chroma up to C that sRGB can show
  hex(L, C, h){
    const ok=c=>this.rgb(L,c,h).every(v=>v>=-1e-4 && v<=1+1e-4);
    if(!ok(C)){
      let lo=0, hi=C;
      for(let i=0;i<20;i++){ const m=(lo+hi)/2; if(ok(m)) lo=m; else hi=m; }
      C=lo;
    }
    return "#"+this.rgb(L,C,h).map(v=>Math.round(this.gam(clamp(v,0,1))*255).toString(16).padStart(2,"0")).join("");
  },

  theme(){
    const [L0, C0, h]=this.lch(parseColor(CFG.accent));
    // near-gray accents stay gray; anything with a hue gets console strength
    const u=clamp((C0-0.01)/0.04, 0, 1), k=u*u*(3-2*u);
    const sat=C0+(Math.max(C0, this.SAT)-C0)*k, mut=Math.min(C0, this.MUTED);
    const root=document.documentElement.style;
    for(const [name, L, s, f, dh] of this.ROLE)
      root.setProperty("--lca-"+name, this.hex(L || clamp(L0, 0.72, 0.86), (s ? sat : mut)*f, h+dh*Math.PI/180));
  }
};
HUDS["lcars-accent"]=Object.assign({}, HUDS.lcars, {
  label:"LCARS (Accent)", base:"lcars",
  theme:()=>LCARS_ACCENT.theme()
});
