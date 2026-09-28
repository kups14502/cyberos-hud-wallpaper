"""Add or update the scene_style / hud_style combos in a project.json, in WE's own layout.

    python tools/style_props.py <project.json> --scenes waves,datastream --huds classic,blade
                    [--scene-default waves] [--hud-default classic] [--test]
"""
import json
import sys

LABELS = {
    "waves": "Waves (flowing wireframe)", "datastream": "Data Stream", "solar": "Solar System",
    "galaxy": "Galaxy", "ridgeline": "Ridgeline", "topo": "Topographic", "orbital": "Orbital",
    "circuit": "Circuit", "outrun": "Horizon Sun",
    "classic": "Classic", "blade": "Blade", "glass": "Glass",
}


def ser(v, lvl=0):
    ind = "\t" * lvl
    if isinstance(v, dict):
        if not v:
            return "{}"
        items = []
        for k, x in v.items():
            key = ind + "\t" + json.dumps(k, ensure_ascii=False) + " : "
            if isinstance(x, (dict, list)) and x and not (isinstance(x, list) and all(not isinstance(e, (dict, list)) for e in x)):
                items.append(key + "\n" + ind + "\t" + ser(x, lvl + 1))
            else:
                items.append(key + ser(x, lvl + 1))
        return "{\n" + ",\n".join(items) + "\n" + ind + "}"
    if isinstance(v, list):
        if not v:
            return "[]"
        if all(not isinstance(e, (dict, list)) for e in v):
            return "[ " + ", ".join(json.dumps(e, ensure_ascii=False) for e in v) + " ]"
        return "[\n" + ",\n".join(ind + "\t" + ser(x, lvl + 1) for x in v) + "\n" + ind + "]"
    return json.dumps(v, ensure_ascii=False)


def arg(name, default=None):
    a = sys.argv
    return a[a.index(name) + 1] if name in a else default


path = sys.argv[1]
text = open(path, encoding="utf-8").read()
data = json.loads(text)
if "--test" in sys.argv:
    print("round trip identical:", ser(data) == text)
    sys.exit(0)

props = data["general"]["properties"]
scenes = arg("--scenes").split(",")
huds = arg("--huds").split(",")
fresh = "scene_style" not in props
if fresh:
    # make room right under the APPEARANCE header: orders 101 and 102
    for k, p in props.items():
        if p.get("order", 0) >= 101:
            p["order"] += 2
            if "index" in p:
                p["index"] += 2
props["scene_style"] = {
    "index": 1, "order": 101, "text": "Scene", "type": "combo",
    "options": [{"label": LABELS.get(s, s), "value": s} for s in scenes],
    "value": arg("--scene-default", props.get("scene_style", {}).get("value", "waves")),
}
props["hud_style"] = {
    "index": 2, "order": 102, "text": "Panel style", "type": "combo",
    "options": [{"label": LABELS.get(h, h), "value": h} for h in huds],
    "value": arg("--hud-default", props.get("hud_style", {}).get("value", "classic")),
}
# keep every object sorted by key, the way WE writes it
props["scene_style"] = dict(sorted(props["scene_style"].items()))
props["hud_style"] = dict(sorted(props["hud_style"].items()))
data["general"]["properties"] = dict(sorted(props.items()))
out = ser(data)
# no BOM: WE's parser rejects one and the wallpaper then renders nothing
with open(path, "w", encoding="utf-8", newline="") as f:
    f.write(out)
print(f"{path}: scene_style={props['scene_style']['value']} of {scenes}, hud_style={props['hud_style']['value']} of {huds}"
      + (" (inserted)" if fresh else " (updated)"))
