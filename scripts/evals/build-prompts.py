#!/usr/bin/env python3
"""Builds evals/prompts.json from a compact spec + evals/mocks.json.
Every eval tolerates the context reads our tool descriptions encourage (optional nodes with realistic
mockOutput) before the required calls, and verification reads after them."""
import json, copy
M = json.load(open("evals/mocks.json"))
def opt(name, mock=None, args=None):
    n = {"functionName": name, "arguments": args or {}, "optional": True}
    if mock: n["mockOutput"] = M[mock]
    return n
def req(name, args=None, mock=None):
    n = {"functionName": name, "arguments": args or {}}
    if mock: n["mockOutput"] = M[mock]
    return n
def pre(room="room_living", skip=(), sel="selection_none"):
    reads = [opt("get_selection", sel), opt("get_scene_summary", "scene_summary"), opt("get_room_details", room)]
    nodes = reads + [opt("get_scene_summary", "scene_summary"), opt("get_selection", sel), opt("get_room_details", room), opt("get_scene_summary", "scene_summary")]
    return [n for n in nodes if n["functionName"] not in skip]
def post(skip=()):
    nodes = [opt("get_conflicts", "conflicts_living"), opt("get_design_report", "report_living"), opt("get_room_details", "room_living"), opt("get_cart", "cart_empty"), opt("get_scene_summary", "scene_summary"), opt("get_selection", "selection_none"), opt("get_conflicts", "conflicts_living"), opt("get_room_details", "room_living")]
    return [n for n in nodes if n["functionName"] not in skip]
def ev(name, prompt, calls, room="room_living", pre_skip=(), post_skip=(), sel="selection_none"):
    return {"name": name, "messages": [{"role": "user", "type": "message", "content": prompt}],
            "expectedCall": pre(room, pre_skip, sel) + calls + post(post_skip)}
P = lambda s: {"$pattern": s}
E = [
 ev("direct: scene overview", "What rooms are in this home and what's in them?", [req("get_scene_summary", {}, "scene_summary")] + [opt("get_room_details", "room_living") for _ in range(12)], pre_skip=("get_scene_summary","get_room_details"), post_skip=("get_scene_summary",)),
 ev("direct: room details", "Show me the details of the living room, including the walls and where everything is.", [req("get_room_details", {"room": P("(?i)living")}, "room_living")], pre_skip=("get_room_details",), post_skip=("get_room_details",)),
 ev("direct: selection", "What did I just click on?", [req("get_selection", {}, "selection_none")], pre_skip=("get_selection",), post_skip=("get_selection",)),
 ev("direct: measure wall", "How long is the north wall of the living room and how much of it is free?", [dict(req("measure", {"subject": P("(?i)north")}, "measure_south"), alternatives=[{"functionName": "get_room_details", "arguments": {"room": P("(?i)living")}}])], pre_skip=("get_room_details",)),
 ev("direct: conflicts", "Is anything wrong with the layout in the main bedroom?", [req("get_conflicts", {"room": P("(?i)bed|main")}, "conflicts_bed1")], room="room_bed1", pre_skip=("get_conflicts",), post_skip=("get_conflicts",)),
 ev("direct: design report", "Critique the living room design for me.", [req("get_design_report", {}, "report_living")]),
 ev("direct: search under budget that fits", "Find a sofa under $800 that fits the north wall of the living room.", [req("search_catalog", {"category": "sofa", "max_price_usd": {"$lte": 800}}, "search_sofa_800")]),
 ev("direct: product details", "Tell me about the Endre sofa — dimensions, price and which walls it fits.", [opt("search_catalog", "search_nook"), req("get_product", {"product": P("(?i)endre")}, "product_endre")]),
 ev("direct: cart", "What's in my cart and how much is it?", [req("get_cart", {}, "cart_empty")]),
 ev("direct: mode switch", "Switch to build mode.", [req("set_mode", {"mode": "build"})]),
 ev("direct: place with wall anchor", "Put a Liva sofa against the north wall of the living room, centred.", [opt("search_catalog", "search_sofa_800"), opt("get_product", "product_endre"), req("place_furniture", {"product": P("(?i)liva"), "anchor": {"wall": P("(?i)north")}})]),
 ev("direct: move with facing", "Move the sofa to the west wall so it faces the window.", [req("move_furniture", {"item": P("(?i)sofa"), "anchor": {"wall": P("(?i)west")}})]),
 ev("direct: remove", "Remove the armchair.", [req("remove_furniture", {"item": P("(?i)armchair|selected")})]),
 ev("direct: colorway", "Make the sofa sage green.", [req("set_colorway", {"item": P("(?i)sofa|selected"), "colorway": P("(?i)sage")})]),
 ev("direct: arrange media", "Arrange the living room for movie nights.", [req("arrange_room", {"style": "media"})]),
 ev("direct: time of day", "Show me what it looks like in the evening.", [req("set_time_of_day", {"time": "evening"})]),
 ev("direct: accessibility", "Turn on accessibility mode.", [req("set_accessibility_mode", {"enabled": True})]),
 ev("direct: undo", "Undo that.", [req("undo", {})]),
 ev("direct: save variant", "Save this layout as 'Cosy'.", [req("save_variant", {"name": P("(?i)cosy")})]),
 ev("direct: preview in room", "Let me see how the Nook armchair would look in the living room before I buy it, next to the sofa.", [opt("search_catalog", "search_nook"), opt("get_product", "product_endre"), req("preview_in_room", {"product": P("(?i)nook")})]),
 ev("direct: add to cart", "Add the sofa to my cart.", [req("update_cart", {"action": "add"}), opt("get_cart", "cart_empty")]),
 ev("direct: export board", "Export a design board for the living room.", [req("export_design_board", {})]),
 ev("direct: add a window (build)", "Add a 120 cm window in the middle of the north wall of the second bedroom.", [opt("set_mode", None, {"mode": "build"}), req("add_opening", {"kind": "window", "wall": P("(?i)north"), "width_cm": {"$gte": 110, "$lte": 130}})], room="room_bed2"),
 ev("ambiguous: 'this' via selection", "Move this a bit to the left.", [req("move_furniture", {})], sel="selection_sofa"),
 ev("ambiguous: does it fit → measure", "Would a 240 cm sofa fit along the south wall of the living room?", [dict(req("measure", {"subject": P("(?i)south")}, "measure_south"), alternatives=[{"functionName": "get_room_details", "arguments": {"room": P("(?i)living")}}])], pre_skip=("get_room_details",)),
 ev("multi: wheelchair friendly", "Make the main bedroom wheelchair friendly and fix whatever gets in the way.", [req("set_accessibility_mode", {"enabled": True}), opt("get_room_details", "room_bed1"), req("get_conflicts", {}, "conflicts_bed1")] + [opt("move_furniture") for _ in range(4)] + [opt("arrange_room"), opt("get_conflicts", "conflicts_bed1"), opt("move_furniture"), opt("move_furniture"), opt("get_conflicts", "conflicts_bed1")], room="room_bed1", pre_skip=("get_conflicts",), post_skip=("get_conflicts",)),
 ev("multi: budget shopping", "I have $1,500. Find me a desk and a chair for the second bedroom in a japandi style and put them in the room.", [req("search_catalog", {"category": "desk"}, "search_desk"), req("search_catalog", {"category": "chair"}, "search_chair"), opt("get_product", "product_endre"), opt("get_product", "product_endre"), req("place_furniture", {}), req("place_furniture", {})], room="room_bed2"),
 ev("multi: compare two layouts", "Save this as 'Before', then rearrange the living room for conversation, save that as 'After', and show me both side by side.", [req("save_variant", {"name": P("(?i)before")}), req("arrange_room", {"style": "conversation"}), req("save_variant", {"name": P("(?i)after")}), req("compare_variants", {})]),
 ev("multi: checkout handoff", "I'm happy with the living room. Put everything that's in it into the cart and give me the checkout link.", [req("update_cart", {"action": "add"})] + [opt("update_cart", None, {"action": "add"}) for _ in range(12)] + [opt("get_cart", "cart_empty"), req("get_checkout_link", {})]),
 ev("ambiguous: warm it up (palette)", "The main bedroom feels cold — warm it up.", [req("apply_palette", {"palette": P("warm-clay|ochre-sun|terrazzo")}), opt("set_time_of_day")], room="room_bed1"),
 ev("ambiguous: clear the room (confirm)", "Start the living room from scratch.", [req("clear_room", {"room": P("(?i)living")})]),
 ev("ambiguous: focus camera", "Let me look at the kitchen from above.", [req("set_view", {"view": "plan", "focus": P("(?i)kitchen")})], room="room_kitchen"),
]
json.dump(E, open("evals/prompts.json", "w"), indent=2)
print(len(E), "evals written")
